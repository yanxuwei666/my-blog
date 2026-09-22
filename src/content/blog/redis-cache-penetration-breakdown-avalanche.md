---
title: "Redis 缓存穿透、击穿、雪崩：区别、现象与对应解法"
description: "三个词经常被混着用，但它们的成因完全不同：穿透是查不存在的数据，击穿是单个热 key 过期，雪崩是一大批 key 同时过期。解法也就此分开。"
pubDate: 2026-08-26
tags: ["redis", "cache", "backend", "high-availability"]
draft: false
---

## 1. 现状与痛点

缓存三件套的问题描述长得很像，实际排查时对应的动作差别很大：

- 数据库 QPS 突然暴涨，但请求的参数值压根不在表里 → 穿透
- 只有一个商品 ID 变慢，其他一切正常 → 击穿
- 每天零点整服务抖 30 秒，日志里全是慢 SQL → 雪崩

把击穿当雪崩治，会去加一堆随机过期时间，结果那个热 key 照样被打穿。所以先把三个概念的边界划清，再谈解法。

## 2. 方案概述

### 2.1 三者对比

| | 触发条件 | 现象 | 核心解法 |
| --- | --- | --- | --- |
| 穿透 | 查询的数据在 DB 中不存在 | 每次都绕过缓存打到 DB | 空值缓存、布隆过滤器、参数校验 |
| 击穿 | 单个高并发 key 恰好过期 | 一个 key 引发 DB 瞬时尖峰 | 互斥重建、逻辑过期、热点 key 常驻 |
| 雪崩 | 大批 key 同时过期，或 Redis 宕机 | 一段时间内 DB 全面承压 | 过期时间打散、多级缓存、熔断限流 |

### 2.2 一句话记法

- 穿透：**数据本来就没有**
- 击穿：**一个 key 到期**
- 雪崩：**一批 key 到期 / 缓存整体不可用**

## 3. 实现步骤

### 3.1 穿透：先挡住不存在的查询

最省事的方案是把空结果也缓存，但 TTL 要短：

```java
public Product get(Long id) {
    String key = "product:" + id;
    String cached = redis.get(key);

    if (EMPTY.equals(cached)) {
        return null;                       // 命中空值，直接返回
    }
    if (cached != null) {
        return parse(cached);
    }

    Product product = dao.selectById(id);
    if (product == null) {
        redis.set(key, EMPTY, 60, SECONDS); // 空值只缓存 60 秒
        return null;
    }
    redis.set(key, json(product), 30, MINUTES);
    return product;
}
```

如果 id 是雪花 ID 或自增主键，攻击者可以构造大量不存在的 id，空值缓存会撑爆内存。这时上布隆过滤器：

```text
请求 id
  └─ 布隆过滤器判断是否存在
       ├─ 一定不存在 → 直接返回 null
       └─ 可能存在   → 走缓存 / DB
```

注意布隆过滤器有假阳性，且不支持删除。商品下架后需要重建，或者用可删除的 Cuckoo Filter。

前置校验也别省：`id <= 0`、长度异常、明显不合法的参数，在入口就拒掉。

### 3.2 击穿：只让一个请求去重建

```java
public Product getWithMutex(Long id) {
    String key = "product:" + id;
    Product cached = parse(redis.get(key));
    if (cached != null) return cached;

    String lockKey = "lock:" + id;
    // 加锁必须带超时，否则进程崩溃后 key 永久锁死
    if (!redis.setnx(lockKey, "1", 5, SECONDS)) {
        sleep(50);
        return getWithMutex(id);          // 自旋等待持锁者回填
    }

    try {
        Product product = dao.selectById(id);
        redis.set(key, json(product), 30 + random(0, 5), MINUTES);
        return product;
    } finally {
        redis.del(lockKey);
    }
}
```

更彻底的方案是**逻辑过期**：value 里带一个 `expireAt` 字段，缓存本身不设 TTL。读到已逻辑过期的数据时，直接返回旧值，同时丢一个异步任务去刷新。读请求永远不被阻塞，代价是会短暂读到旧数据。

```json
{ "data": { "id": 1, "name": "..." }, "expireAt": "2026-08-26T15:00:00Z" }
```

选型判断：一致性要求高用互斥锁，可用性要求高用逻辑过期。

### 3.3 雪崩：把过期时间打散

```java
// 基础 TTL + 随机偏移，避免同一批写入的 key 同时失效
int ttl = BASE_TTL + ThreadLocalRandom.current().nextInt(0, 300);
redis.set(key, value, ttl, SECONDS);
```

批量预热任务里尤其要做这件事。凌晨脚本一次性写入十万个 key、TTL 完全相同，就是给自己埋雷。

Redis 整体不可用时，靠缓存本身已经救不了，需要：

1. 客户端超时设短（比如 200ms），失败快速降级；
2. 本地缓存（Caffeine）兜住热点读；
3. 数据库侧限流或熔断，宁可返回降级数据也不要被打死。

## 4. 关键细节

**`setnx` 加锁要设超时。** 上面示例里的 5 秒过期是底线。锁的释放要用 Lua 判断 value 再删，避免删掉别人的锁。

**空值缓存要设上限。** 用 `maxmemory-policy` 控制，或者给空值单独设很短的 TTL，否则恶意构造的 key 会把内存吃满。

**缓存和数据库的一致性顺序。** 通用做法是「先更新 DB，再删缓存」（Cache Aside）。反过来先删缓存，会在并发下被旧值回填。延迟双删只在读多写少且能容忍短暂不一致时用。

**监控要能看到命中率。** 只监控 Redis 内存是不够的。命中率突然下跌，往往就是击穿或雪崩的前兆。

## 5. 常见问题

**用了 Spring Cache 的 `@Cacheable`，还需要关心这些吗？**
注解只帮你做读写，不解决穿透和击穿。默认它连 null 都不缓存，不存在的 id 每次都会打到 DB。需要显式配 `cacheNullValues`，热 key 重建仍要自己加锁。

**多级缓存怎么做？**
浏览器/CDN → 本地 Caffeine → Redis → DB。本地缓存 TTL 要短（秒级），并通过消息广播失效，否则多实例之间会长时间不一致。

**Redis 单点热 key 怎么办？**
再热的 key 也只在一个分片上。解法是把 key 打散成 `product:1#0` ~ `product:1#N` 多副本随机读，或者用只读副本分摊。

## 6. 总结与延伸

核心要点：

- 穿透查「不存在」，击穿查「一个 key」，雪崩查「一批 key」
- 空值缓存 + 布隆过滤器对付穿透
- 互斥锁或逻辑过期对付击穿
- TTL 打散 + 本地缓存 + 限流对付雪崩

可以继续拆的问题：

- 布隆过滤器的误判率与位数组大小怎么算
- Cache Aside 与延迟双删的适用边界
- Redis 持久化策略（RDB / AOF）对故障恢复时间的影响
