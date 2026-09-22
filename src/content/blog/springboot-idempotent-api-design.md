---
title: "接口幂等落地：唯一索引、token 令牌和状态机，哪种适合你的写接口"
description: "用户连点两次、Feign 超时重试、MQ 重复投递，最后都变成数据库里两条一样的订单。幂等不是加一句「先查再插」，而是要保证同一个业务请求重复执行 N 次，结果和执行一次完全一样。"
pubDate: 2026-07-10
category: "后端框架"
tags: ["springboot", "java", "backend", "idempotency"]
draft: false
---

## 1. 现状与痛点

一个创建订单的接口，代码里写着：

```java
@PostMapping("/orders")
public Result<Long> create(@RequestBody @Valid OrderCreateDTO dto) {
    if (orderMapper.existsByBizKey(dto.getUserId(), dto.getSkuId())) {
        return Result.fail("请勿重复下单");
    }
    return Result.ok(orderService.create(dto));
}
```

看起来有防重，实际上三个问题：

1. `existsByBizKey` 和 `insert` 之间没有原子性，两个并发请求同时通过检查；
2. 前端换成「提交后按钮置灰」之前，用户双击就已经触发了；
3. 上游服务超时重试时，第一次请求可能已经成功，只是响应丢了——这时候「重复」是合法请求，返回失败反而让上游一直重试。

幂等的定义要卡严一点：**同一个业务操作，执行一次和执行多次，对系统状态的影响相同，且返回给调用方的结果相同**。

## 2. 方案概述

### 2.1 先分类，再选方案

| 场景 | 调用方能否传唯一标识 | 推荐方案 |
| --- | --- | --- |
| 用户表单重复提交 | 不能（前端没有 ID） | Token 令牌 |
| 服务间写接口（Feign / HTTP 重试） | 能（透传 requestId） | 唯一索引 + 幂等表 |
| MQ 消费 | 能（消息 ID / 业务键） | 消费记录表 + 业务状态机 |
| 支付、扣款这类强一致写 | 能（商户订单号） | 唯一索引 + 状态机 |
| 库存扣减这类增量操作 | 能（流水号） | 流水表唯一键，禁止读改写 |

选型只有一句话：**能落到数据库唯一约束的，优先唯一约束**。其他所有方案都是它的补充，不是替代。

### 2.2 三种机制的边界

- **唯一索引**：数据库帮你兜底，并发下绝对可靠，但只能处理「插入型」幂等，且拿到的是 `DuplicateKeyException`，需要转成业务语义。
- **Token 令牌**：解决「调用方没有唯一标识」的问题，本质是替客户端生成幂等键。有有效期和一次性消费的语义要处理好。
- **状态机**：解决「同一资源被多次推进」的问题，靠 `UPDATE ... WHERE status = 前置状态` 的受影响行数判断。

真实项目里通常是三者组合：唯一索引兜底 + 状态机推进 + token 补键。

## 3. 实现步骤

### 3.1 唯一索引 + 幂等表

表设计，关键是业务键上的唯一约束：

```sql
CREATE TABLE t_order (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  order_no      VARCHAR(32) NOT NULL,
  request_id    VARCHAR(64) NOT NULL COMMENT '调用方幂等键',
  user_id       BIGINT      NOT NULL,
  amount        DECIMAL(12,2) NOT NULL,
  status        TINYINT     NOT NULL DEFAULT 0,
  create_time   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_request_id (request_id),
  UNIQUE KEY uk_order_no (order_no)
);
```

业务层把重复键转成「返回首次结果」，而不是返回失败：

```java
@Service
public class OrderServiceImpl implements OrderService {

    @Override
    public Long create(OrderCreateCmd cmd) {
        try {
            OrderDO entity = OrderConverter.toEntity(cmd);
            orderMapper.insert(entity);
            return entity.getId();
        } catch (DuplicateKeyException e) {
            // 重复请求：返回第一次的结果，状态码 200，让调用方停止重试
            OrderDO exist = orderMapper.selectByRequestId(cmd.getRequestId());
            if (exist == null) {
                throw e; // 撞上了别的唯一键（比如 order_no），继续抛出让全局异常处理兜住
            }
            log.info("幂等命中, requestId={}, orderId={}", cmd.getRequestId(), exist.getId());
            return exist.getId();
        }
    }
}
```

注意 `@Transactional` 的方法里 catch `DuplicateKeyException` 后继续做数据库写操作，事务可能已被标记 rollback-only。上面的写法把 catch 放在事务方法外层，或者用 `Propagation.REQUIRES_NEW` 单独开一段。

### 3.2 用 AOP 把幂等做成通用能力

请求头带 `X-Request-Id`，切面负责查重和结果缓存：

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface Idempotent {
    /** 幂等键有效期，秒 */
    int expireSeconds() default 300;
    /** 键为空时是否拒绝请求 */
    boolean requireKey() default true;
}
```

```java
@Aspect
@Component
public class IdempotentAspect {

    private static final String KEY_PREFIX = "idem:";

    @Around("@annotation(meta)")
    public Object around(ProceedingJoinPoint pjp, Idempotent meta) throws Throwable {
        String requestId = RequestContextHolder.getRequestId();
        if (!StringUtils.hasText(requestId)) {
            if (meta.requireKey()) {
                throw new BizException(ErrorCode.MISSING_IDEMPOTENT_KEY);
            }
            return pjp.proceed();
        }
        String key = KEY_PREFIX + methodSignature(pjp) + ":" + requestId;

        // SET NX PX：抢到锁才执行业务
        Boolean ok = redis.opsForValue().setIfAbsent(key, "PROCESSING",
                Duration.ofSeconds(meta.expireSeconds()));
        if (!Boolean.TRUE.equals(ok)) {
            String cached = redis.opsForValue().get(key);
            if ("PROCESSING".equals(cached)) {
                throw new BizException(ErrorCode.REQUEST_IN_PROGRESS); // 让调用方稍后重试
            }
            return deserialize(cached);  // 首次结果已缓存，直接返回
        }

        Object result = pjp.proceed();
        redis.opsForValue().set(key, serialize(result),
                Duration.ofSeconds(meta.expireSeconds()));
        return result;
    }
}
```

这段代码有两个必须想清楚的点：

1. **锁的粒度**：key 里必须带方法签名，否则不同接口用了同一个 `requestId` 会互相污染；
2. **异常时删键**：业务抛异常要 `finally` 里删掉 `PROCESSING`，否则重试会被卡在「处理中」直到过期。

Redis 只能保证「不并发执行」，不能保证「不重复落库」。所以 AOP 方案后面仍然要有唯一索引兜底。

### 3.3 Token 令牌：给没有 ID 的表单补一个键

```java
@PostMapping("/order/token")
public Result<String> issueToken() {
    String token = UUID.randomUUID().toString().replace("-", "");
    redis.opsForValue().set("order:token:" + token, "1", Duration.ofMinutes(10));
    return Result.ok(token);
}
```

```java
@PostMapping("/orders")
public Result<Long> create(@RequestBody OrderCreateDTO dto,
                           @RequestHeader("X-Idem-Token") String token) {
    // DELETE 返回 1 才算拿到令牌，天然原子
    if (redis.delete("order:token:" + token) != 1) {
        throw new BizException(ErrorCode.REPEATED_SUBMIT);
    }
    return Result.ok(orderService.create(OrderConverter.toCmd(dto, token)));
}
```

令牌即幂等键，落库时写进 `request_id`，这样前端表单和数据库约束就串起来了。

### 3.4 状态机：推进型接口

```java
public boolean paySuccess(String orderNo, String tradeNo) {
    // 只有 待支付 -> 已支付 才能更新成功
    int rows = orderMapper.update(
        new LambdaUpdateWrapper<OrderDO>()
            .set(OrderDO::getStatus, OrderStatus.PAID)
            .set(OrderDO::getTradeNo, tradeNo)
            .eq(OrderDO::getOrderNo, orderNo)
            .eq(OrderDO::getStatus, OrderStatus.WAIT_PAY));
    return rows == 1;
}
```

回调重复推送时 `rows == 0`，此时要区分两种情况：查一下当前状态，如果已经是 `PAID` 且 `tradeNo` 一致，返回成功；`tradeNo` 不一致才告警。

## 4. 关键细节

### 4.1 MQ 消费幂等

消息 ID 不能当幂等键——同一条业务消息重发后 ID 会变。用业务键：

```java
@Override
public void onMessage(OrderPaidMsg msg) {
    try {
        consumeLogMapper.insert(new ConsumeLogDO(msg.getBizKey(), topic()));
    } catch (DuplicateKeyException e) {
        log.info("重复消息已忽略, bizKey={}", msg.getBizKey());
        return;
    }
    doBusiness(msg);
}
```

消费记录表和业务变更放在同一个本地事务里，才能避免「记录写了、业务没做」。跨库场景退化为「业务状态机 + 重试」，靠 `rows == 0` 判断重复。

### 4.2 库存扣减不要用读改写

```sql
-- 错：并发下会超卖
UPDATE t_stock SET stock = #{newStock} WHERE sku_id = #{skuId};

-- 对：把判断交给数据库
UPDATE t_stock SET stock = stock - #{count}
WHERE sku_id = #{skuId} AND stock >= #{count};
```

再叠加流水表 `uk_biz_key`，重复请求既不会多扣，也不会重复记流水。

### 4.3 幂等键从哪来

- 前端自己生成 UUID 放进请求头：实现简单，但要注意同一表单在两个标签页打开会共用键（如果希望各自独立，就在页面加载时生成）；
- 后端在「进入表单页」时下发：更可控，推荐；
- 网关统一生成 `traceId`：**不要**用它做幂等键，重试时 traceId 可能变化，且它覆盖不了业务语义。

## 5. 常见问题

### 5.1 GET 请求要不要做幂等

GET 按 HTTP 语义应该是安全的（不改状态），不需要幂等控制。如果某个 GET 会写库，说明接口设计有问题，改成 POST 并纳入幂等。

### 5.2 唯一索引冲突要不要返回失败

不要。调用方重试说明它没收到上次的响应，返回失败会让它继续重试，甚至触发人工补偿。正确做法是返回首次成功的结果，让重试自然停止。

### 5.3 只加 Redis 锁够不够

不够。锁有有效期，业务执行超过有效期后锁自动释放，重复请求就会进来；Redis 主从切换也可能丢键。锁负责「减少并发重复」，唯一索引负责「绝对不重复」。

### 5.4 本地消息表和对账

跨服务的写操作（比如下单成功后通知积分服务）无法靠单一数据库约束保证。这类场景要引入本地消息表 + 定时补偿，或者用幂等键做 T+1 对账。幂等是这套机制的前提，不是它的替代品。

## 6. 总结与延伸

一句话记住落地顺序：

1. 先给写接口设计业务唯一键，并建唯一索引；
2. 调用方没有键，就用 token 下发或网关透传补上；
3. 用 AOP/拦截器把查重和结果复用做成通用能力，异常路径一定要释放锁；
4. 推进型状态用 `WHERE status = 前置状态` 的受影响行数判断；
5. 最后用对账兜住跨服务的长链路。

延伸方向：分布式事务（Seata AT 与消息最终一致）、支付回调的验签与幂等组合、以及把 `X-Request-Id` 打通到日志链路里做全链路重复请求分析。
