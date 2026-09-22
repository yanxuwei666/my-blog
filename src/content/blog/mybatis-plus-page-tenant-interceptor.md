---
title: "MyBatis-Plus 分页与多租户插件：拦截器顺序、count 优化和三个不生效的坑"
description: "分页插件不是加个依赖就能用。拦截器注册顺序不对，租户条件会被分页 count 语句漏掉；深分页时 limit 100000,20 依然会扫十万行。这篇把改写机制、生效边界和排查顺序理一遍。"
pubDate: 2026-07-24
tags: ["mybatis", "java", "backend", "database"]
draft: false
---

## 1. 现状与痛点

一个中等规模的后台项目里，分页代码通常是这样的：

```java
// 手写两遍条件，改字段时永远会漏掉一处
long total = mapper.countByCondition(query);
List<OrderVO> list = mapper.selectByCondition(query, (page - 1) * size, size);
return new PageResult<>(total, list);
```

多租户再加一层，每条 SQL 都要记得拼 `AND tenant_id = ?`。漏一处就是数据越权，而这种 bug 在测试环境基本发现不了——测试库通常只有一个租户。

MyBatis-Plus 的插件把这两件事变成了配置，但很多人只做到「能跑」，然后在线上遇到 count 语句比查询还慢、租户条件莫名失效、`total` 永远是 0。

## 2. 方案概述

### 2.1 插件的本质是 SQL 改写拦截器

MyBatis-Plus 的 `MybatisPlusInterceptor` 是一个 MyBatis 原生拦截器，内部持有一组 `InnerInterceptor`。每个内部拦截器在语句执行前拿到 `MappedStatement` 和原始 SQL，用 JSqlParser 解析成语句对象，改完再序列化回字符串。

分页插件做两件事：给原 SQL 拼 `LIMIT ?,?`，并再生成一条 `SELECT COUNT(*)` 包着原 SQL 的 count 语句。租户插件做的事更简单：在 `WHERE` 里插入 `tenant_id = ?`。

理解「都是改 SQL」这一点很重要，因为所有奇怪行为都能从这里解释：

1. 改写发生在 Java 层，数据库看到的已经不是你以为的那条语句；
2. 解析失败或解析器不认识语法时，插件会静默跳过——不报错，只是不生效；
3. 多个拦截器改同一条 SQL，顺序决定结果。

### 2.2 注册顺序：租户在前，分页在后

这是最容易踩的一条。分页插件生成 count 语句时，会把查询 SQL 包一层：

```sql
SELECT COUNT(*) FROM ( 原查询 SQL ) TOTAL
```

如果分页插件先跑，它拿到的「原查询」还没有租户条件，生成的 count 就统计了全租户的数据。正确顺序永远是：**多租户 → 乐观锁/动态表名等其他改写 → 分页 → 防全表更新**。官方文档也明确要求分页插件放在最后（`BlockAttackInnerInterceptor` 除外，它要在分页之前判断）。

## 3. 实现步骤

### 3.1 配置类

```java
@Configuration
public class MybatisPlusConfig {

    @Bean
    public MybatisPlusInterceptor mybatisPlusInterceptor() {
        MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();

        // 1. 多租户：必须在分页之前 add
        TenantLineInnerInterceptor tenant = new TenantLineInnerInterceptor();
        tenant.setTenantLineHandler(new TenantHandler());
        interceptor.addInnerInterceptor(tenant);

        // 2. 乐观锁（有 version 字段才需要）
        interceptor.addInnerInterceptor(new OptimisticLockerInnerInterceptor());

        // 3. 分页：显式指定 DbType，别依赖自动推断
        PaginationInnerInterceptor page = new PaginationInnerInterceptor(DbType.MYSQL);
        page.setMaxLimit(500L);            // 单页上限，防止 size=100000 打挂库
        page.setOverflow(false);           // 页码越界返回空列表，而不是回到第一页
        interceptor.addInnerInterceptor(page);

        // 4. 防全表更新与删除
        interceptor.addInnerInterceptor(new BlockAttackInnerInterceptor());
        return interceptor;
    }
}
```

`DbType` 必须显式写。自动推断靠 `JdbcUtils.getDbType()` 读连接 URL，在动态数据源、或者数据源还没初始化时会被推断成其他方言，表现为分页 SQL 语法不对。

### 3.2 租户处理器

```java
public class TenantHandler implements TenantLineHandler {

    @Override
    public Expression getTenantId() {
        Long tenantId = TenantContext.getTenantId();
        return new LongValue(tenantId == null ? -1L : tenantId);
    }

    @Override
    public String getTenantIdColumn() {
        return "tenant_id";
    }

    /** 返回 true 表示这条表不参与租户过滤 */
    @Override
    public boolean ignoreTable(String tableName) {
        return TABLE_SET.contains(tableName.toLowerCase());
    }
}
```

`getTenantId()` 返回 `null` 时插件会跳过注入，很多人以为「没登录就不拼条件」是安全的，实际上是越权。宁可拼一个查不到数据的 `-1`。

### 3.3 分页用法

```java
public IPage<OrderVO> page(OrderQuery query) {
    Page<OrderVO> page = new Page<>(query.getPage(), query.getSize());
    // 列表接口只需要 total 和当页数据时，可以让 count 走简化语句
    page.setSearchCount(true);
    return orderMapper.selectOrderPage(page, query);
}
```

```xml
<!-- 自定义 countId：复杂 join 时手写 count，比自动包一层快得多 -->
<select id="selectOrderPage" resultType="OrderVO">
    SELECT o.id, o.order_no, u.name
    FROM t_order o
    LEFT JOIN t_user u ON u.id = o.user_id
    <where>
        <if test="query.status != null">AND o.status = #{query.status}</if>
    </where>
    ORDER BY o.id DESC
</select>

<select id="selectOrderPage_COUNT" resultType="long">
    SELECT COUNT(*) FROM t_order o
    <where>
        <if test="query.status != null">AND o.status = #{query.status}</if>
    </where>
</select>
```

只要存在同名加 `_COUNT` 后缀的语句，分页插件就会用它代替自动生成的 count。对多表 join 的列表页，这是最划算的一次优化——count 不需要 join 那些只为回显字段存在的表。

另一个开关是 `page.setOptimizeJoinOfCountSql(true)`（或插件级别设置），让自动 count 去掉不影响结果集的 left join。

## 4. 关键细节

### 4.1 深分页不是插件能解决的问题

```sql
-- 插件生成的语句，MySQL 会扫过并丢弃前 100000 行
SELECT ... FROM t_order ORDER BY id DESC LIMIT 100000, 20;
```

`maxLimit` 只能挡住单页过大，挡不住页码过深。两种做法：

1. **游标分页**：前端不再传 `page`，传上一页最后一条的 `id`，SQL 变成 `WHERE id < #{cursor} ORDER BY id DESC LIMIT 20`。App 下拉刷新场景首选。
2. **延迟关联**：先在索引上分页取主键，再回表。

```sql
SELECT o.* FROM t_order o
JOIN (SELECT id FROM t_order ORDER BY create_time DESC LIMIT 100000, 20) t
  ON t.id = o.id;
```

导出场景直接上流式查询：`fetchSize = Integer.MIN_VALUE`（MySQL）配合 `ResultHandler`，不要一次性 `selectList`。

### 4.2 排序字段不能来自前端

```java
// 危险：order 参数被拼进 SQL，插件不会帮你参数化
page.addOrder(OrderItem.desc(query.getSortField()));
```

`ORDER BY` 不能用占位符，所以必须白名单校验：

```java
private static final Set<String> SORTABLE = Set.of("id", "create_time", "amount");

public void applySort(Page<?> page, String sort, String order) {
    if (!SORTABLE.contains(sort)) {
        throw new IllegalArgumentException("不支持的排序字段: " + sort);
    }
    page.addOrder("asc".equalsIgnoreCase(order)
        ? OrderItem.asc(sort) : OrderItem.desc(sort));
}
```

### 4.3 哪些语句不会被改写

- 用 `@InterceptorIgnore(tenantLine = "true", pagination = "true")` 标注的 Mapper 方法；
- JSqlParser 解析不了的语句（例如某些数据库私有语法、拼接不规范的 `${}`）；
- 存储过程调用、`statementType="CALLABLE"`；
- 租户插件只处理 `SELECT / INSERT / UPDATE / DELETE`，其中 `INSERT` 会自动补 `tenant_id` 列——如果你的 insert 语句是手写的列清单，会看到「字段重复」错误。

## 5. 常见问题

### 5.1 分页不生效，SQL 里没有 LIMIT

按这个顺序查：

1. `MybatisPlusInterceptor` 有没有被 `@Bean` 注册，或者被别的 `Interceptor` 配置覆盖掉；
2. Mapper 方法的第一个参数是不是 `IPage`，并且返回值也是 `IPage`（返回 `List` 时 total 拿不到）；
3. 传入的 `Page` 对象 `current/size` 是否为空或 0；
4. 数据源是不是动态的，导致 `DbType` 推断错。

### 5.2 total 正确但列表为空

多半是 `maxLimit` 或 `overflow` 的副作用：`size` 超过 `maxLimit` 会被截断，`overflow = true` 时页码越界会跳回第一页。生产环境建议 `overflow = false`，让越界老老实实返回空。

### 5.3 count 语句比查询还慢

自动 count 会保留 `ORDER BY`（虽然 MyBatis-Plus 会尝试去掉），也会保留 join。用 `_COUNT` 自定义语句，或者关掉 `searchCount` 改成前端「有没有下一页」的游标式交互。

### 5.4 和 ShardingSphere / 读写分离一起用

分片中间件也在改 SQL，两边的解析器互相不认识对方的产物是常见故障源。原则是让 MyBatis-Plus 的改写发生在最外层（应用侧），分片规则只认逻辑表名；上线前必须验证租户条件在路由到具体分表后仍然存在。

## 6. 总结与延伸

插件解决的是「重复劳动」，不是「性能」和「安全」。三条底线：

1. 拦截器顺序固定为 租户 → 乐观锁 → 分页 → 防全表，`DbType` 写死；
2. 复杂列表页给 `_COUNT` 自定义语句，深分页换游标；
3. 排序字段白名单，租户 ID 兜底值不能为空。

可以再往下了解的方向：`IllegalSQLInnerInterceptor`（开发环境用来拦截不走索引的 SQL）、`DynamicTableNameInnerInterceptor` 做分表示意、以及把 `PaginationInnerInterceptor` 换成游标实现后前端分页组件的改造。
