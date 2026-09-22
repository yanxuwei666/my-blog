---
title: "消息怎么做到不丢、不重、不乱序：生产、Broker、消费三段链路逐个设防"
description: "「消息丢了」是一个结论，不是一个原因。它可能发生在发送端没拿到 ack、Broker 刷盘前宕机、消费者手动提交位点却处理失败、或者死信队列没人看。这篇把三段链路拆开，每段给出配置和验证方法。"
pubDate: 2026-04-10
category: "中间件"
tags: ["mq", "backend", "distributed", "java"]
draft: false
---

## 1. 现状与痛点

订单服务用 MQ 通知积分服务，上线两周后的反馈：

1. 用户下单成功，积分没加——查了半天不知道丢在哪；
2. 有一次积分加了两倍——消费端「处理失败后重试」，但第一次其实成功了；
3. 偶尔出现「先收到退款消息，再收到支付成功消息」，状态机直接卡死。

对应到三个经典命题：**不丢、不重、有序**。它们互相冲突，不可能同时 100% 满足，工程上的答案是：

- 不丢：三段链路各自设防 + 最终对账兜底；
- 不重：接受「至少一次」投递，在消费端做幂等；
- 有序：只在必要的 key 上保证局部有序，别追求全局有序。

## 2. 方案概述

### 2.1 消息会丢的四个位置

```text
Producer ──①──> Broker ──②──> 存储 ──③──> Consumer ──④──> 业务落库
   发送失败        主从未同步      刷盘前宕机      拉到了但处理异常
```

| 环节 | 典型原因 | 对策 |
| --- | --- | --- |
| ① 发送 | 网络抖动、超时、异步发送没注册回调 | 同步发送 + 重试 + 本地消息表 |
| ② 复制 | 主节点 ack 后宕机，从节点还没同步 | 副本数 ≥ 2 + `acks=all` / 同步双写 |
| ③ 刷盘 | 异步刷盘时机器掉电 | 同步刷盘（性能有代价），或依赖副本 |
| ④ 消费 | 先提交位点后处理业务 | 业务成功后再提交 + 死信告警 |

### 2.2 投递语义怎么选

- **at most once**：允许丢，不允许重。日志采集、埋点。
- **at least once**：不允许丢，可能重。业务消息的默认选择。
- **exactly once**：语义上做不到，工程上等价于「at least once + 消费端幂等」。

所以「不丢 + 不重」的真实含义是：链路上用 at least once，消费端用幂等把它收敛成效果上的一次。

## 3. 实现步骤

### 3.1 生产端：先确保发出去

Kafka：

```properties
acks=all
retries=5
retry.backoff.ms=200
enable.idempotence=true          # Broker 侧去重，避免重试导致 Broker 存储重复
max.in.flight.requests.per.connection=5
delivery.timeout.ms=30000
```

RocketMQ（Spring 里用 `RocketMQTemplate`）：

```java
public void sendOrderPaid(OrderPaidMsg msg) {
    Message<OrderPaidMsg> message = MessageBuilder.withPayload(msg)
            .setHeader(RocketMQHeaders.KEYS, msg.getOrderNo())   // 业务键，便于控制台查询
            .build();

    SendResult result = rocketMQTemplate.syncSend("TOPIC_ORDER:tag_paid", message, 3000, 3);
    if (result.getSendStatus() != SendStatus.SEND_OK) {
        // 状态不是 OK 就落本地待发表，不要只打日志
        pendingMsgService.save(msg, result.getSendStatus().name());
        throw new BizException(ErrorCode.MQ_SEND_FAILED);
    }
}
```

注意 RocketMQ 的 `SLAVE_NOT_AVAILABLE`（主写成功、从不可用）也算发送成功，但已经不满足「不丢」，要按业务决定是重试还是告警。

**异步发送的坑**：

```java
// 错：回调里只打日志，进程重启就彻底丢了，且业务不知道自己没发出去
rocketMQTemplate.asyncSend(topic, msg, new SendCallback() {
    public void onSuccess(SendResult r) { log.info("ok"); }
    public void onException(Throwable e) { log.error("fail", e); }
});
```

要么同步发送，要么在业务事务里先写本地消息表，由定时任务补偿发送。

### 3.2 本地消息表：最朴素也最可靠

```sql
CREATE TABLE t_msg_pending (
  id           BIGINT PRIMARY KEY AUTO_INCREMENT,
  biz_key      VARCHAR(64)  NOT NULL,
  topic        VARCHAR(64)  NOT NULL,
  payload      JSON         NOT NULL,
  status       TINYINT      NOT NULL DEFAULT 0 COMMENT '0待发送 1已发送 2已确认 3超限告警',
  retry_count  INT          NOT NULL DEFAULT 0,
  next_time    DATETIME     NOT NULL,
  create_time  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_biz_key (biz_key),
  KEY idx_status_next (status, next_time)
);
```

关键点：

1. 和业务写操作在**同一个本地事务**里插入这条记录，保证「业务成功 = 消息一定记下了」；
2. 定时任务扫 `status=0 AND next_time <= now()`，发送成功后置 1；
3. 消费端消费完回调或用事务消息确认，置 2；
4. `retry_count > 10` 置 3 并告警，人工介入。

RocketMQ 的事务消息（半消息 + 回查）本质上把这张表搬到了 Broker 侧，回查逻辑还是要你自己实现，所以多数团队宁愿用本地表——链路更短、更好排查。

### 3.3 Broker 端

Kafka：

```properties
# server.properties
min.insync.replicas=2
default.replication.factor=3
unclean.leader.election.enable=false   # 宁可不可用，也不让落后的副本当 leader（会丢数据）
log.flush.interval.messages=10000      # 依赖副本而非强制刷盘，性能更好
```

`acks=all` + `min.insync.replicas=2` 才是真的「多副本确认」，只设 `acks=all` 而 ISR 只有 1 个副本时，等于没设。

RocketMQ：

```properties
brokerRole=SYNC_MASTER      # 同步双写
flushDiskType=SYNC_FLUSH    # 同步刷盘，吞吐下降明显，只在强一致场景用
```

### 3.4 消费端：先处理，再提交

Kafka（关闭自动提交）：

```java
props.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, false);

while (running) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(500));
    for (ConsumerRecord<String, String> record : records) {
        try {
            handler.handle(record);                 // 业务先成功
        } catch (BizException e) {
            deadLetterProducer.send(record, e);     // 不可重试异常直接进死信
            continue;
        }
    }
    consumer.commitSync();                          // 一批处理完再提交位点
}
```

RocketMQ：

```java
@Override
public ConsumeConcurrentlyStatus consumeMessage(List<MessageExt> msgs, ConsumeConcurrentlyContext ctx) {
    for (MessageExt msg : msgs) {
        try {
            orderPaidHandler.handle(msg);
        } catch (RetryableException e) {
            return ConsumeConcurrentlyStatus.RECONSUME_LATER;   // 交给 Broker 退避重试
        } catch (Exception e) {
            log.error("不可恢复异常, 转死信 msgId={}", msg.getMsgId(), e);
            // 消费失败超过 maxReconsumeTimes 会自动进 %DLQ%消费组名
        }
    }
    return ConsumeConcurrentlyStatus.CONSUME_SUCCESS;
}
```

消费端幂等的做法（业务键唯一索引 / 消费记录表）见《接口幂等落地》一节，这里只强调一点：**重试和幂等是一套机制，缺一个就等于没做**。

### 3.5 死信队列必须有出口

```java
@Component
public class DlqMonitor {
    /** 定时扫描死信 Topic，写入人工处理表并告警 */
    @Scheduled(cron = "0 */5 * * * ?")
    public void scan() {
        List<DlqMessage> list = dlqConsumer.pull(100);
        for (DlqMessage m : list) {
            opsTicketService.create(m);      // 生成工单
            alertService.send("死信堆积: " + m.getTopic());
        }
    }
}
```

死信没出口，等于把「丢消息」变成了「延迟半年才发现丢消息」。

## 4. 关键细节

### 4.1 顺序消息：按业务键分区

全局有序需要单分区单消费者，吞吐直接归零。实际只需要「同一订单的消息有序」：

```java
// Kafka：用 orderNo 做 key，同一订单永远落同一分区
producer.send(new ProducerRecord<>("TOPIC_ORDER", orderNo, payload));

// RocketMQ：MessageQueueSelector 按业务键取模
producer.send(msg, (queues, m, arg) -> {
    String bizKey = (String) arg;
    return queues.get(Math.abs(bizKey.hashCode() % queues.size()));
}, orderNo);
```

再加两个约束：

1. 消费端不能并发处理同一 key——RocketMQ 用 `MessageListenerOrderly`，Kafka 用单分区单线程；
2. **重试会破坏顺序**：一条消息卡住重试时，后面的消息要么阻塞等待（保序），要么跳过（乱序）。要么接受阻塞，要么在业务上用版本号兜底。

### 4.2 版本号兜底比强顺序更实用

```java
public void handle(OrderStatusMsg msg) {
    int rows = orderMapper.updateStatusByVersion(
        msg.getOrderNo(), msg.getStatus(), msg.getVersion());
    if (rows == 0) {
        // 版本落后或状态不对：交给重试或告警，不抛异常打爆消费线程
        log.warn("状态推进被忽略, orderNo={}, version={}", msg.getOrderNo(), msg.getVersion());
    }
}
```

```sql
UPDATE t_order SET status = #{newStatus}, version = #{version}
WHERE order_no = #{orderNo} AND version < #{version};
```

### 4.3 积压怎么处理

```bash
# Kafka 看 lag
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group order-group

# RocketMQ
sh mqadmin consumerProgress -n localhost:9876 -g order-group
```

处理顺序：

1. 先看是消费变慢还是生产暴增（`tps` 对比）；
2. 消费慢：查下游依赖 RT、GC、线程池；扩消费者实例数（不能超过分区/队列数，否则空转）；
3. 生产暴增（比如定时任务集中投递）：先削峰，生产端加发送限速；
4. 紧急情况：临时新建一个分区更多的 Topic + 多个消费组做「搬运转发」，把积压消息打散。

### 4.4 重复消息怎么定位

排查时最需要的信息是「这条消息被消费了几次」：

```java
log.info("consume topic={} msgId={} reconsumeTimes={} bizKey={}",
        msg.getTopic(), msg.getMsgId(), msg.getReconsumeTimes(), msg.getKeys());
```

`reconsumeTimes > 0` 却仍然成功，说明第一次是「处理成功但提交失败」——典型原因是消费超时被 Broker 判定失败重投。这时要检查消费逻辑耗时是否超过 `consumeTimeout`（RocketMQ 默认 15 分钟）或 Kafka 的 `max.poll.interval.ms`（默认 5 分钟）。

## 5. 常见问题

### 5.1 事务内发消息，回滚了消息还在

```java
@Transactional
public void createOrder() {
    orderMapper.insert(order);
    mqTemplate.syncSend(topic, msg);   // 事务回滚，消息已经出去了
}
```

正确做法：用 `TransactionSynchronizationManager.registerSynchronization` 在 `afterCommit` 里发；或者干脆用本地消息表。

### 5.2 消费超时导致重复

Kafka 里 `max.poll.interval.ms` 内没完成 `poll`，会被踢出消费组并触发 rebalance，位点提交失败 → 重投。解法是减小 `max.poll.records`、把耗时操作移出消费线程（转投线程池并同步等待）、或者延长间隔。

### 5.3 Rebalance 风暴

消费者频繁上下线会让整个组反复 rebalance，期间停止消费。检查：会话超时 `session.timeout.ms` 是否过短、是否有消费者处理慢被踢、是否用了范围分配却存在热点分区。Kafka 2.4+ 的增量协作者 rebalance（`CooperativeStickyAssignor`）能显著缓解。

### 5.4 要不要上事务消息

RocketMQ 事务消息解决了「本地事务与发送的原子性」，但代价是必须实现回查接口，且回查逻辑要能准确判断本地事务状态（一般还是查数据库）。中小规模场景，本地消息表 + 定时补偿更好维护。

## 6. 总结与延伸

三段链路的检查清单：

1. 生产端：同步发送 + 状态判断 + 失败落本地消息表（与业务同事务）；
2. Broker：副本数 ≥ 3、`acks=all` + `min.insync.replicas=2`、`unclean.leader.election=false`；
3. 消费端：先处理后提交、可重试异常交回 Broker、不可恢复异常进死信 + 告警；
4. 顺序：按业务键分区，同时接受「重试会破坏顺序」，用版本号兜底；
5. 兜底：每日对账任务比对生产计数与消费计数。

延伸方向：RocketMQ 事务消息与延迟消息、Kafka Streams 的 exactly-once（`processing.guarantee=exactly_once_v2`）、以及把消息链路纳入全链路追踪（`msgId` 与 traceId 关联），让「丢消息」在 5 分钟内被发现而不是半个月。
