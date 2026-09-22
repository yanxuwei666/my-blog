---
title: "MySQL 慢查询排查：从执行计划到索引失效的六种情况"
description: "慢查询的排查路径其实很短：开慢日志、抓 SQL、看执行计划、确认索引为什么没被用上。真正花时间的是最后一步，因为大部分索引失效都来自写法而不是表结构。"
pubDate: 2026-09-11
tags: ["mysql", "database", "performance", "index"]
draft: false
---

## 1. 现状与痛点

一个接口上线时 30ms，数据涨到五百万行之后变成 4s。第一反应通常是「加索引」，加完发现没变化，再猜是锁、是缓冲池、是网络。

多数情况其实更朴素：**索引建了，但这条 SQL 用不上它**。原因集中在几种写法上——对列做函数运算、隐式类型转换、联合索引顺序不对、`OR` 两侧字段不同、`LIKE '%xx'`、以及优化器自己算错了选择性。

所以排查顺序应该是：先确认慢在哪条 SQL，再看优化器为什么没走索引，最后才考虑改表结构或加缓存。

## 2. 方案概述

### 2.1 排查链路

```text
慢查询日志 / performance_schema
   └─ 拿到具体 SQL 与耗时分布
        └─ EXPLAIN 看访问类型、索引、扫描行数
             └─ 判断是索引缺失、索引失效，还是扫描量本身合理
                  └─ 改写 SQL 或调整索引
                       └─ 用真实数据量回归验证
```

### 2.2 关键指标怎么看

| 字段 | 关注点 | 危险信号 |
| --- | --- | --- |
| `type` | 访问类型 | `ALL`（全表扫描）、`index`（全索引扫描） |
| `key` | 实际用到的索引 | `NULL` |
| `rows` | 预估扫描行数 | 远大于结果集行数 |
| `filtered` | 过滤后剩余百分比 | 很低说明扫了大量无用数据 |
| `Extra` | 附加信息 | `Using filesort`、`Using temporary` |

`type` 从好到差大致是 `const > eq_ref > ref > range > index > ALL`。生产查询能稳定落在 `range` 以上就基本合格。

## 3. 实现步骤

### 3.1 先把慢查询抓出来

```sql
SET GLOBAL slow_query_log = ON;
SET GLOBAL long_query_time = 1;
SET GLOBAL log_queries_not_using_indexes = ON;
```

`log_queries_not_using_indexes` 会把小表全扫也记进来，日志量很大，排查完记得关掉。

不想改配置就直接问 `performance_schema`：

```sql
SELECT DIGEST_TEXT,
       COUNT_STAR,
       ROUND(AVG_TIMER_WAIT / 1e12, 3) AS avg_sec,
       ROUND(SUM_ROWS_SENT) AS rows_sent
FROM performance_schema.events_statements_summary_by_digest
ORDER BY AVG_TIMER_WAIT DESC
LIMIT 10;
```

### 3.2 看执行计划

```sql
EXPLAIN
SELECT id, order_no, user_id, amount, created_at
FROM t_order
WHERE user_id = 10086
  AND created_at >= '2026-09-01'
ORDER BY created_at DESC
LIMIT 20;
```

需要更细的信息用 `EXPLAIN ANALYZE`（MySQL 8.0.18+），它会真的执行并给出每一步的实际耗时和行数：

```sql
EXPLAIN ANALYZE SELECT ...;
```

注意 `EXPLAIN ANALYZE` 会执行语句，别在高峰期对大表跑。

### 3.3 建对联合索引

上面的查询理想索引是：

```sql
ALTER TABLE t_order ADD INDEX idx_user_created (user_id, created_at);
```

原因是 `user_id` 是等值条件放前面，`created_at` 承担范围过滤和排序，正好符合最左前缀，`ORDER BY` 也能复用索引避免 filesort。

如果把顺序反过来写成 `(created_at, user_id)`，范围条件出现在等值条件之前，`user_id` 就只能靠回表过滤，`type` 会退化成 `range`，排序也省不掉。

### 3.4 用覆盖索引省掉回表

如果查询只要 `order_no` 和 `amount`，把字段塞进索引即可避免回表：

```sql
ALTER TABLE t_order
  ADD INDEX idx_user_created_cover (user_id, created_at, order_no, amount);
```

`Extra` 出现 `Using index` 就说明命中了覆盖索引。代价是索引本身变大、写入变慢，只对高频查询这么做。

### 3.5 验证效果

```sql
-- 对比改造前后的 rows 与 Extra
EXPLAIN SELECT ...;

-- 真实耗时用基准脚本跑，不要只看一次
SELECT BENCHMARK(1, (SELECT COUNT(*) FROM t_order WHERE user_id = 10086));
```

至少确认三件事：`type` 不再是 `ALL`、`key` 不为 `NULL`、`rows` 下降到与结果集同一量级。

## 4. 索引失效的六种情况

### 4.1 对列使用函数或运算

```sql
-- 失效：DATE() 包住了索引列
SELECT * FROM t_order WHERE DATE(created_at) = '2026-09-01';

-- 正确：改成范围条件
SELECT * FROM t_order
WHERE created_at >= '2026-09-01' AND created_at < '2026-09-02';
```

### 4.2 隐式类型转换

```sql
-- 表字段是 varchar，传数字会走 CAST(列), 索引失效
SELECT * FROM t_user WHERE mobile = 13800001111;

-- 正确：类型对齐
SELECT * FROM t_user WHERE mobile = '13800001111';
```

这是字符集不一致的另一个变种：连接字符集和列字符集不同也会触发转换，`utf8mb4` 列配 `utf8` 连接就可能踩到。

### 4.3 违反最左前缀

```sql
INDEX idx_abc (a, b, c)

WHERE b = 2 AND c = 3        -- 用不上，缺 a
WHERE a = 1 AND c = 3        -- 只用上 a
WHERE a = 1 AND b > 2 AND c = 3  -- b 是范围，c 用不上
```

### 4.4 `LIKE` 以通配符开头

```sql
WHERE name LIKE '%张'   -- 失效
WHERE name LIKE '张%'   -- 可用
```

前置模糊是刚需时，考虑全文索引或者把搜索交给 ES，不要硬扫。

### 4.5 `OR` 两侧字段不同

```sql
WHERE user_id = 1 OR channel = 'APP'   -- 只有两个字段都有索引时才可能走 index_merge
```

多数情况下不如拆成两条查询用 `UNION ALL` 合并。

### 4.6 优化器判断失误

统计信息过期时，优化器可能放弃更优索引：

```sql
ANALYZE TABLE t_order;
```

仍然不生效再用 `FORCE INDEX (idx_user_created)`，但要清楚这是把决策从优化器手里抢过来，数据分布变化后容易反噬。

## 5. 常见问题

**`rows` 很小但实际很慢，为什么？**
`rows` 是预估。真实情况要看 `EXPLAIN ANALYZE` 的 `actual time` 和 `rows`。另外回表次数、排序落盘（`Using temporary; Using filesort`）都不会体现在 `rows` 上。

**`LIMIT 1000000, 20` 为什么慢？**
偏移量之前的百万行仍然要扫描再丢弃。改成游标式翻页：

```sql
SELECT * FROM t_order
WHERE id > #{lastId}
ORDER BY id
LIMIT 20;
```

**要不要给每个查询条件都建索引？**
不要。索引是写放大换来的读优化，单表索引数量控制在 5 个以内，优先合并高频查询的字段组合。

## 6. 总结与延伸

核心要点：

- 先抓 SQL 再看计划，不要凭感觉改表
- 联合索引顺序按「等值 → 范围 → 排序」来
- 索引失效绝大多数来自写法：函数、类型转换、最左前缀
- 覆盖索引和深翻页改写是收益最明显的两招

可以继续拆成专题的问题：

- `ORDER BY` 与 filesort 的判定规则
- 分区表在时间范围查询上的收益
- 直方图（`ANALYZE TABLE ... UPDATE HISTOGRAM`）对优化器的影响
