---
title: "Elasticsearch 中文检索：分词器选型、相关性调优和三个高频查询写法"
description: "搜索「苹果手机」却搜不到「iPhone 手机壳」，多半是分词器没选对；搜索结果第一条永远不相关，是 BM25 字段权重没调。这篇从 mapping 写到查询，给一套能落地的中文检索方案。"
pubDate: 2026-05-22
tags: ["elasticsearch", "search", "backend", "java"]
draft: false
---

## 1. 现状与痛点

用 MySQL 做站内搜索，写到第三版通常是这样的：

```sql
SELECT * FROM t_product
WHERE title LIKE CONCAT('%', #{kw}, '%')
   OR keywords LIKE CONCAT('%', #{kw}, '%')
ORDER BY CASE WHEN title LIKE CONCAT(#{kw}, '%') THEN 0 ELSE 1 END,
         sales DESC
LIMIT 20;
```

问题很明确：

1. `%kw%` 前置通配符用不上索引，数据量上百万后一条慢查询就能拖垮库；
2. 没有「相关性」概念，只能靠人工 CASE WHEN 排序；
3. 「手机壳」搜不到「保护套」，同义词完全没有；
4. 拼写错误、拼音、繁简差异统统不管。

Elasticsearch 解决的就是这四件事。但很多人接完之后的第一反应是「为什么我的中文搜索比 LIKE 还差」——问题基本出在分词器。

## 2. 方案概述

### 2.1 倒排索引三步走

```text
文档 "苹果手机壳 硅胶防摔"
  ↓ 分词（analysis）
[苹果, 手机, 手机壳, 硅胶, 防摔]
  ↓ 归一化（小写、繁简、停用词）
  ↓ 写入倒排表
term -> [docId...]
苹果   -> [1]
手机   -> [1]
手机壳 -> [1]
```

搜索时同样先分词，再拿 term 去查倒排表。这意味着：**索引时用哪个分词器，查询时就必须用哪个（或兼容的）**。两边不一致，就会出现「明明有这条数据却搜不到」。

### 2.2 分词器选型

| 方案 | 中文效果 | 特点 |
| --- | --- | --- |
| `standard` | 差 | 逐字切分，「苹果手机」变成 苹/果/手/机，召回一堆噪音 |
| IK（`ik_smart` / `ik_max_word`） | 好 | 词典分词，最常用；`ik_max_word` 细粒度、召回多，`ik_smart` 粗粒度、准确率高 |
| HanLP / SmartCN | 更好 | 支持词性、命名实体，配置复杂 |
| jieba 系 | 好 | 自定义词典灵活，ES 插件生态弱一些 |

实践中的默认组合：**索引用 `ik_max_word`（尽量多切，提高召回），搜索用 `ik_smart`（少切，提高准确）**。

```json
PUT /product
{
  "settings": {
    "analysis": {
      "analyzer": {
        "cn_index":  { "type": "custom", "tokenizer": "ik_max_word" },
        "cn_search": { "type": "custom", "tokenizer": "ik_smart" }
      },
      "normalizer": {
        "lower": { "type": "custom", "filter": ["lowercase"] }
      }
    }
  }
}
```

自定义词典是 IK 的核心价值，热更新比重启友好：

```text
# /usr/share/elasticsearch/config/ik/custom/mywords.db
苹果手表,8,n
iPhone15,nz
```

```properties
# IKAnalyzer.cfg.xml
<entry key="ext_dict">mywords.db</entry>
<entry key="ext_stopwords">stopwords/main_stopword.dic</entry>
```

改完词典后调用 `POST /_analyze` 验证，或者直接重启容器；IK 支持热加载词典（远程词典方式），比本地文件方式更适合多节点集群。

## 3. 实现步骤

### 3.1 mapping：一个字段多种用法

搜索场景几乎都需要「同一个字段既能分词又能精确匹配」，用 `fields` 而不是建两个字段：

```json
PUT /product/_mapping
{
  "properties": {
    "title": {
      "type": "text",
      "analyzer": "cn_index",
      "search_analyzer": "cn_search",
      "fields": {
        "keyword": { "type": "keyword", "ignore_above": 256 },
        "pinyin":  { "type": "text", "analyzer": "pinyin_analyzer" }
      }
    },
    "category_id": { "type": "long" },
    "sales":       { "type": "integer" },
    "create_time": { "type": "date", "format": "yyyy-MM-dd HH:mm:ss||epoch_millis" }
  }
}
```

三条经验：

1. 需要排序/聚合的字段必须是 `keyword` 或数值类型，`text` 字段排序会报 `Fielddata is disabled`；
2. `index: false` 用于只展示不参与检索的字段（比如富文本正文），省磁盘；
3. 上线后 mapping 不能改，只能重建索引 + `_reindex`，所以第一次设计要留余地。

### 3.2 写入

```bash
POST /_bulk
{ "index": { "_index": "product", "_id": "1" } }
{"title":"苹果手机壳 硅胶防摔","category_id":10,"sales":320}
{ "index": { "_index": "product", "_id": "2" } }
{"title":"iPhone 保护套 磨砂","category_id":10,"sales":180}
```

Java 侧用官方 client：

```java
try (ElasticsearchClient client = esClient()) {
    SearchResponse<ProductDoc> resp = client.search(s -> s
            .index("product")
            .size(20)
            .query(q -> q.multiMatch(m -> m
                    .fields("title^3", "keywords^2", "description")
                    .analyzer("cn_search")
                    .query("苹果 手机壳")
                    .type(TextQueryType.BestFields)))
            .highlight(h -> h.fields("title", f -> f.preTags("<em>").postTags("</em>"))),
            ProductDoc.class);

    List<ProductDoc> hits = resp.hits().hits().stream()
            .map(Hit::source).toList();
}
```

### 3.3 查询：三种最常用的写法

**（1）搜索框模糊匹配 —— `multi_match` + `best_fields`**

```json
GET /product/_search
{
  "query": {
    "multi_match": {
      "query": "苹果 手机壳",
      "fields": ["title^3", "keywords^2", "description"],
      "type": "best_fields",
      "tie_breaker": 0.3,
      "minimum_should_match": "30%"
    }
  }
}
```

`minimum_should_match` 是控制「搜得准」还是「搜得多」的旋钮。默认所有分词是 OR 关系，噪音会很多；设成 `30%`~`70%` 立刻干净。

**（2）既要求完全包含又想要兜底 —— `bool` 分层**

```json
{
  "query": {
    "bool": {
      "must": [
        { "match": { "title": { "query": "苹果 手机壳", "analyzer": "cn_search" } } }
      ],
      "should": [
        { "match_phrase": { "title": { "query": "苹果手机壳", "slop": 2, "boost": 10 } } },
        { "term":  { "brand": { "value": "apple", "boost": 2 } } }
      ],
      "filter": [
        { "term":  { "category_id": 10 } },
        { "range": { "sales": { "gte": 100 } } }
      ]
    }
  }
}
```

`filter` 里的条件不参与打分，还能被缓存——所有不需要「相关性」的限制条件（状态、租户、时间范围）都放 `filter`，不要放 `must`。这是最便宜的一次性能优化。

`match_phrase` 用于「短语完全命中优先展示」，`slop` 控制允许的间隔词数。

**（3）翻页与导出**

```json
{ "search_after": [1719000000000, "prod_123"], "sort": [{"create_time": "desc"}, {"_id": "asc"}] }
```

`from + size` 受 `max_result_window`（默认 10000）限制，深翻页会加载大量排序数据。超过 1 万条的翻页用 `search_after`，全量导出用 PIT + `search_after` 或 scroll。

## 4. 关键细节

### 4.1 相关性调优：先量化再改权重

ES 默认用 BM25，三个可调因子：

```json
PUT /product/_settings
{
  "index": {
    "similarity": {
      "custom_bm25": { "type": "BM25", "b": 0.5, "k1": 1.4 }
    }
  }
}
```

- `k1` 控制词频饱和度，调大 = 更看重出现次数；
- `b` 控制长度归一化，调小 = 长文档不再被明显惩罚。

但 90% 的相关性问题不需要动这两个参数，按顺序排查更有效：

1. 分词结果对不对（`GET /product/_analyze`）；
2. 字段权重（`title^3`）；
3. `minimum_should_match`；
4. 是否有 `filter` 条件误放进 `must` 拉低了分数；
5. 业务分（销量、上新）用 `function_score` 叠加。

```json
{
  "function_score": {
    "query": { "match": { "title": "手机壳" } },
    "functions": [
      { "field_value_factor": { "field": "sales", "modifier": "log1p", "factor": 0.1 } },
      { "gauss": { "create_time": { "origin": "now", "scale": "30d", "decay": 0.5 } } }
    ],
    "boost_mode": "sum",
    "score_mode": "multiply"
  }
}
```

`log1p` 很关键，销量是长尾分布，直接乘会让爆款永远压过一切。

### 4.2 同义词与拼音

```json
PUT /product/_settings
{
  "analysis": {
    "filter": {
      "syn": { "type": "synonym_graph", "synonyms_path": "analysis/synonym.txt", "updateable": true }
    },
    "analyzer": {
      "cn_search_syn": { "tokenizer": "ik_smart", "filter": ["lowercase", "syn"] }
    }
  }
}
```

同义词放在 `search_analyzer` 而不是 `index_analyzer`，这样改词典不用重建索引。`updateable: true` 是热更新的前提。

拼音补的是「用户不会打字」的场景：

```json
"pinyin_analyzer": { "tokenizer": "my_pinyin" },
"my_pinyin": { "type": "pinyin", "keep_first_letter": true, "keep_full_pinyin": true, "limit_first_letter_length": 16 }
```

搜 `pingguo` 或 `pg` 能命中「苹果」。

### 4.3 高亮与摘要

```json
"highlight": {
  "type": "unified",
  "fields": { "title": {}, "content": { "fragment_size": 80, "number_of_fragments": 2 } }
}
```

`unified` 是速度和效果最平衡的实现。高亮需要原始文本，字段开 `term_vector` 会更快但更占空间——正文很长的列表页才值得开。

### 4.4 集群与性能

1. 分片数一旦定了不能改（除非 `_shrink`/`_split`），单分片建议控制在 20–50GB；
2. `refresh_interval` 默认 1s，写多读少的日志类索引改成 `30s` 甚至 `-1`，写入吞吐能翻倍；
3. 不需要 `_source` 的场景用 `_source: false` 或 `stored_fields: []` 减少传输；
4. 慢查询先看 `_slowlog`，不要凭感觉优化。

## 5. 常见问题

### 5.1 数据写进去了但搜不到

按顺序查：

1. `GET /index/_analyze` 看这个词被切成了什么；
2. `GET /index/_count` 确认文档真的存在（可能是别名指向错了）；
3. 是否刚写入还没 refresh（`refresh=wait_for` 或测试时手动 `POST /index/_refresh`）；
4. `filter` 条件是否把文档挡掉了（比如 `status` 字段类型不匹配，字符串写进了 long 字段）。

### 5.2 搜索结果顺序不稳定

同一批数据分数相同会导致顺序随机。`sort` 里加一个唯一字段兜底：

```json
"sort": [{ "_score": "desc" }, { "id": "asc" }]
```

### 5.3 中文聚合出现「同一个词两个桶」

分词后聚合会把「苹果手机」和「苹果 手机」当成不同值。聚合字段必须用 `keyword` 类型（或 `title.keyword`）。需要按分词聚合时，用 `aggregations` 里的子字段而不是原字段。

### 5.4 要不要用 ES 当主存储

不建议。ES 的近实时特性和弱事务能力决定了它适合做「查询视图」，数据源头仍然放 MySQL，通过 binlog（Canal/Flink CDC）或双写 + 定时对账同步。双写一定要留补偿任务，因为同步链路一定会丢。

## 6. 总结与延伸

上手顺序：

1. 装 IK，索引 `ik_max_word` + 搜索 `ik_smart`，先让分词正确；
2. mapping 用 `fields` 一次设计好，所有非相关性条件下到 `filter`；
3. 查询从 `multi_match` + `minimum_should_match` 起步，再加 `match_phrase` 提权；
4. 用 `function_score` 把业务分叠进去，而不是一上来调 BM25；
5. 建 20 条评测 query，每次改配置跑一遍对比。

延伸方向：向量检索与混合召回（`knn` + BM25 加权）、`search_as_you_type` 做输入联想、聚合驱动的筛选面板（facets）、以及用 `_reindex` + 别名的索引零停机重建。
