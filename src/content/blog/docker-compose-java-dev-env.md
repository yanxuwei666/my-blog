---
title: "用 Docker Compose 起一套 Java 本地开发环境（MySQL + Redis + Nacos）"
description: "本地开发环境的痛点通常不是装不上，而是换台机器就要重来。把 MySQL、Redis、Nacos 写进一份 compose 文件，连上初始化脚本，新同事一条命令就能跑起来。"
pubDate: 2026-08-12
tags: ["docker", "devops", "java", "local-environment"]
draft: false
---

## 1. 现状与痛点

新人入职第一天最常见的对话：

- 「MySQL 装好了吗？」→「装了，但密码和你们不一样」
- 「库表结构呢？」→「微信发你个 sql 文件」
- 「Nacos 起了吗？」→「起了，我本地端口是 8848 你改成 8849」

问题不在安装，在于**环境描述散落在聊天记录和个人习惯里**。换台机器、换个人就要重新对齐一遍，而且没人知道自己漏配了什么。

Docker Compose 的价值就是把这套东西变成一份可以 review、可以版本化的代码。

## 2. 方案概述

### 2.1 目标

一份 `docker-compose.yml` + 一个 `.env` + 初始化 SQL 目录，达成：

1. `docker compose up -d` 一条命令起全部依赖；
2. 端口、账号、库名全团队一致；
3. 表结构和基础数据在首次启动时自动导入；
4. 数据落在命名卷里，删容器不丢数据。

### 2.2 目录结构

```text
project/
├── docker/
│   ├── docker-compose.yml
│   ├── .env.example
│   └── init/
│       ├── 01-schema.sql
│       └── 02-seed.sql
└── ...
```

`init` 目录里的文件按文件名顺序执行，所以用 `01-`、`02-` 前缀控制依赖顺序。

## 3. 实现步骤

### 3.1 写 compose 文件

```yaml
name: mall-dev

services:
  mysql:
    image: mysql:8.0.36
    container_name: mall-mysql
    restart: unless-stopped
    ports:
      - "3306:3306"
    environment:
      MYSQL_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}
      MYSQL_DATABASE: ${DB_NAME}
      MYSQL_USER: ${DB_USER}
      MYSQL_PASSWORD: ${DB_PASSWORD}
      TZ: Asia/Shanghai
    command:
      - --character-set-server=utf8mb4
      - --collation-server=utf8mb4_unicode_ci
      - --default-time-zone=+08:00
    volumes:
      - mysql-data:/var/lib/mysql
      - ./init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1", "-p${DB_ROOT_PASSWORD}"]
      interval: 10s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7.2.4
    container_name: mall-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    command: ["redis-server", "--appendonly", "yes", "--requirepass", "${REDIS_PASSWORD}"]
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  nacos:
    image: nacos/nacos-server:v2.3.2
    container_name: mall-nacos
    restart: unless-stopped
    ports:
      - "8848:8848"
      - "9848:9848"
    environment:
      MODE: standalone
      PREFER_HOST_MODE: ip
      NACOS_AUTH_ENABLE: "true"
      NACOS_AUTH_TOKEN: ${NACOS_AUTH_TOKEN}
      NACOS_AUTH_IDENTITY_KEY: ${NACOS_AUTH_IDENTITY_KEY}
      NACOS_AUTH_IDENTITY_VALUE: ${NACOS_AUTH_IDENTITY_VALUE}
    depends_on:
      mysql:
        condition: service_healthy
    volumes:
      - nacos-logs:/home/nacos/logs

volumes:
  mysql-data:
  redis-data:
  nacos-logs:
```

### 3.2 凭证单独放

```bash
cp docker/.env.example docker/.env
```

```dotenv
# docker/.env.example —— 复制成 .env 后填本地值，.env 必须进 .gitignore
DB_ROOT_PASSWORD=root_dev_only
DB_NAME=mall
DB_USER=mall
DB_PASSWORD=mall_dev_only
REDIS_PASSWORD=redis_dev_only
NACOS_AUTH_TOKEN=SecretKey012345678901234567890123456789012345678901234567890123456789
NACOS_AUTH_IDENTITY_KEY=dev
NACOS_AUTH_IDENTITY_VALUE=dev
```

 compose 会自动读同目录的 `.env`。真实密码不要提交，示例值也不要用于任何非本地环境。

### 3.3 初始化表结构

```sql
-- docker/init/01-schema.sql
CREATE TABLE IF NOT EXISTS t_product (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(128) NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    status TINYINT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_status_created (status, created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
```

```sql
-- docker/init/02-seed.sql
INSERT INTO t_product (name, price) VALUES
  ('测试商品 A', 19.90),
  ('测试商品 B', 29.90);
```

### 3.4 启动并验证

```bash
cd docker
docker compose up -d
docker compose ps
```

`ps` 里三个服务都应该是 `running (healthy)`。**只有 `running` 没有 `healthy`，说明健康检查没过**，先看日志：

```bash
docker compose logs -f mysql
```

逐个确认访问入口：

```bash
# MySQL：业务接入端口，3306
docker exec -it mall-mysql mysql -umall -p mall -e "SHOW TABLES;"

# Redis：6379，验证写入和过期
docker exec -it mall-redis redis-cli -a redis_dev_only set k1 v1 ex 30

# Nacos：8848 是控制台 + OpenAPI，9848 是 gRPC 客户端通道
curl -s "http://127.0.0.1:8848/nacos/v1/console/health/readiness"
```

控制台地址 `http://127.0.0.1:8848/nacos`，默认账号 `nacos/nacos`，本地起完第一件事就是改掉。

这里有个高频坑：**8848 和 9848 是两套入口**。Nacos 2.x 之后客户端通过 9848（= 主端口 + 1000）走 gRPC 长连接。只映射 8848 的话，控制台能打开，但应用注册会一直报连接失败。

### 3.5 应用侧配置

```yaml
spring:
  datasource:
    url: jdbc:mysql://127.0.0.1:3306/mall?useSSL=false&serverTimezone=Asia/Shanghai&allowPublicKeyRetrieval=true
    username: mall
    password: mall_dev_only
  data:
    redis:
      host: 127.0.0.1
      port: 6379
      password: redis_dev_only
  cloud:
    nacos:
      server-addr: 127.0.0.1:8848
```

## 4. 关键细节

**`depends_on` 不等于「等它就绪」。** 它只保证启动顺序。MySQL 容器起来了不代表能接受连接，必须配 `healthcheck` + `condition: service_healthy`。

**init 脚本只在数据卷为空时执行。** 改了 SQL 文件要重建才生效：

```bash
docker compose down -v    # -v 会删掉数据卷，本地数据先确认能丢
docker compose up -d
```

**端口冲突时改宿主机侧。** `"3307:3306"` 表示本机 3307 映射到容器 3306，容器内端口不用动，应用配置里改端口即可。

**MySQL 8 的默认认证插件。** 老版本 JDBC 驱动连不上 `caching_sha2_password`，要么升级驱动，要么在 `command` 里加 `--default-authentication-plugin=mysql_native_password`。

**不要在生产用 compose。** 这套编排没有滚动升级、没有健康摘流、没有资源隔离。生产环境按团队情况选 K8s 或托管服务。

## 5. 常见问题

**容器起不来，日志只有 `data directory looks like it already contains data`？**
数据卷里是旧版本 MySQL 的数据。本地直接 `docker compose down -v` 重来。

**为什么我改了 `.env` 没生效？**
`docker compose up` 不会重建已存在容器的环境变量，要 `docker compose up -d --force-recreate`。

**Nacos 控制台能开，应用注册失败？**
先看 9848 有没有映射，再看 `NACOS_AUTH_*` 三项是否配齐——开启鉴权后 token 长度不足会直接启动失败。

## 6. 总结与延伸

核心要点：

- 环境描述进仓库，凭证留本地
- 健康检查 + `service_healthy` 才是真的启动顺序保证
- 管理入口和业务接入入口要分清（Nacos 的 8848 / 9848 就是典型）
- compose 适合本地和小型部署，不适合生产

可以继续拆的问题：

- 用 Testcontainers 给集成测试起一次性依赖
- 多项目共用一套中间件时的网络与端口规划
- 把 compose 迁移到 K8s 时需要补哪些配置
