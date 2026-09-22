---
title: "Nginx + Keepalived 做高可用入口：VIP 漂移、误切换和健康检查写法"
description: "两台 Nginx + 一个虚拟 IP 是最基础的入口高可用方案，但真正上线时会遇到脑裂、健康检查只探进程不探服务、以及 Nginx reload 时被误判下线。这篇给一套能直接照抄的配置和排查顺序。"
pubDate: 2026-06-12
tags: ["nginx", "devops", "high-availability", "linux"]
draft: false
---

## 1. 现状与痛点

单机 Nginx 的架构长这样：

```text
用户 → 公网 IP → Nginx → 后端服务集群
```

Nginx 一挂，后面再健康的服务也访问不到。云上买 LB 最省事，但内网环境、混合云、或者需要精细改写请求头的场景，仍然要自己维护 Nginx。

自己维护就要回答三个问题：

1. Nginx 挂了，流量怎么在秒级切到另一台？
2. 后端某台服务挂了，Nginx 怎么知道？
3. 怎么保证「切换」本身不出故障——两台都以为对方死了（脑裂）怎么办？

## 2. 方案概述

Keepalived 负责第 1 个问题，用的是 VRRP 协议：

```text
        VIP 10.0.0.100
       /              \
  Nginx-A (MASTER, prio 100)   Nginx-B (BACKUP, prio 90)
       \              /
        后端服务集群 upstream
```

- 正常情况下 VIP 绑在 MASTER 的网卡上，ARP 应答也由它负责；
- MASTER 每 `advert_int` 秒发一次组播报文；
- BACKUP 超过 3 倍间隔没收到，就把 VIP 抢过来，同时发 gratuitous ARP 刷新交换机和上游缓存；
- 切换时间通常在 1–3 秒。

第 2 个问题靠 Nginx 自己的 `max_fails` / `fail_timeout` 被动健康检查，或者用 `nginx_upstream_check_module`（Tengine）做主动探测。

第 3 个问题靠 `track_script` 检测真实服务能力 + 单播 + 仲裁，下面细说。

## 3. 实现步骤

### 3.1 环境准备

两台机器，先确认 VRRP 组播能通（云环境常常被安全组拦掉，这时改用单播）：

```bash
yum install -y keepalived nginx       # 或 apt install keepalived nginx
modprobe ip_vs                         # LVS 相关，纯 VIP 场景可跳过
sysctl -w net.ipv4.ip_nonlocal_bind=1  # 允许绑定非本机 IP（可选）
```

`net.ipv4.ip_nonlocal_bind` 在需要本机 curl VIP 做自检时必须开，否则 keepalived 的健康检查脚本自己会连不上。

### 3.2 主配置（MASTER）

```nginx
! /etc/keepalived/keepalived.conf

global_defs {
    router_id NGINX_A              # 每台唯一，不要重复
    vrrp_skip_check_adv_addr
    vrrp_garp_interval 0
    vrrp_gna_interval 0
}

vrrp_script chk_nginx {
    script "/etc/keepalived/check_nginx.sh"
    interval 2          # 每 2 秒检测一次
    timeout 2
    fall 2              # 连续 2 次失败才判定不可用
    rise 2              # 连续 2 次成功才恢复
    weight -30          # 失败后把优先级降 30，触发抢占
}

vrrp_instance VI_1 {
    state BACKUP                    # 两边都写 BACKUP，靠优先级决定谁是主，避免启动瞬间双主
    interface eth0
    virtual_router_id 51            # 同网段内不同集群必须不同，否则互相干扰
    priority 100
    advert_int 1
    garp_master_delay 5
    mcast_src_ip 10.0.0.11

    authentication {
        auth_type PASS
        auth_pass MyVrrpPasswd       # 最长 8 位，超出的部分会被截断
    }

    unicast_src_ip 10.0.0.11
    unicast_peer {
        10.0.0.12                    # 云环境/交换机屏蔽组播时用单播
    }

    track_script {
        chk_nginx
    }

    virtual_ipaddress {
        10.0.0.100/24 dev eth0 label eth0:vip
    }

    track_interface {
        eth0
    }
}
```

### 3.3 健康检查脚本：探服务，不要探进程

最常见的错误写法是 `pidof nginx`。Nginx 主进程活着但 worker 全部卡死、或者 80 端口已经不响应，这种脚本永远返回成功。

```bash
#!/bin/bash
# /etc/keepalived/check_nginx.sh
# 返回非 0 即视为失败；连续 fall 次后优先级下降

URL="http://127.0.0.1/healthz"

# 1. 进程兜底：不在就拉起
if ! pidof nginx > /dev/null; then
    systemctl start nginx || exit 1
    sleep 2
fi

# 2. 真实探活：要求 2 秒内返回 200
code=$(curl -s -o /dev/null -w '%{http_code}' -m 2 "$URL")
if [ "$code" != "200" ]; then
    # 3. 连续失败达到阈值才放弃，避免抖动引发切换
    fails=$(cat /tmp/nginx_fails 2>/dev/null || echo 0)
    echo $((fails + 1)) > /tmp/nginx_fails
    [ "$fails" -ge 1 ] && exit 1     # 配合 fall=2
    exit 0
fi

echo 0 > /tmp/nginx_fails
exit 0
```

脚本必须可执行且属主为 root：`chmod 755 /etc/keepalived/check_nginx.sh`。另外 Keepalived 对脚本执行超时很敏感，`timeout 2` 一定要设，否则脚本卡住会导致整个 VRRP 状态机停摆。

Nginx 侧配一个不经过后端的本地探活 location：

```nginx
server {
    listen 80;
    location = /healthz {
        access_log off;
        default_type text/plain;
        return 200 "ok";
    }
}
```

如果希望「后端全挂时也把 VIP 让出去」，就不能只返回静态 `ok`，而要探测一个真实依赖：

```nginx
location = /healthz {
    proxy_pass http://backend;
    proxy_connect_timeout 1s;
    proxy_read_timeout 1s;
}
```

这两种语义要提前和业务确认——前者切换更保守，后者更激进，容易因为后端抖动引发入口来回漂移。

### 3.4 通知脚本：切换时做点事

```nginx
vrrp_instance VI_1 {
    notify_master "/etc/keepalived/notify.sh master"
    notify_backup "/etc/keepalived/notify.sh backup"
    notify_fault  "/etc/keepalived/notify.sh fault"
    notify_stop   "/etc/keepalived/notify.sh stop"
}
```

```bash
#!/bin/bash
# notify.sh
case "$1" in
  master)
      systemctl reload nginx          # 确保 VIP 已绑上后再 reload
      curl -fsS -X POST "$WEBHOOK" -d "NGINX 升主: $(hostname)"
      ;;
  backup) logger "NGINX 降为备: $(hostname)" ;;
  *)      logger "keepalived 状态异常: $1" ;;
esac
```

`notify_master` 里做 `reload` 是常见做法，但要注意：reload 期间如果 VIP 还没绑定完成，会短暂 502。稳妥的顺序是绑定 VIP → reload。

## 4. 关键细节

### 4.1 双主（脑裂）的判定与处理

现象：VIP 同时出现在两台机器上，`arping -I eth0 10.0.0.100` 得到两个 MAC。

```bash
ip -4 addr show | grep 10.0.0.100     # 两台都有 → 脑裂
tail -f /var/log/messages | grep -i vrrp
```

原因基本是这三类：

1. VRRP 报文被拦：安全组/iptables 没放行协议号 112（不是 TCP/UDP 端口，`iptables -p vrrp`）；
2. `virtual_router_id` 与同网段另一套 Keepalived 冲突；
3. 交换机开了端口隔离或 IGMP Snooping 丢了组播。

处理办法：优先用单播（`unicast_peer`），并在脚本里加仲裁——检测不到对端但能访问网关时，说明是自己断了，主动降优先级：

```bash
# 加入 check_nginx.sh：本机能上网但收不到对端心跳 → 主动放弃 VIP
ping -c1 -W1 10.0.0.1 > /dev/null || exit 1
```

### 4.2 抢占与延迟

默认 MASTER 恢复后会立刻抢回 VIP，造成第二次抖动。生产环境建议：

```nginx
vrrp_instance VI_1 {
    preempt_delay 60     # 恢复后等 60 秒再抢回，给 Nginx warm 时间
    # 或者干脆两边都 state BACKUP + 不配 nopreempt，靠优先级自然回切
}
```

`nopreempt` 只能在 `state BACKUP` 的配置下生效，这是 Keepalived 的一个反直觉点。

### 4.3 upstream 健康检查

```nginx
upstream backend {
    least_conn;
    server 10.0.1.11:8080 max_fails=3 fail_timeout=10s;
    server 10.0.1.12:8080 max_fails=3 fail_timeout=10s weight=5;
    server 10.0.1.13:8080 backup;        # 只在其他节点全挂时启用
    keepalive 32;
}

proxy_next_upstream error timeout http_502 http_503 http_504;
proxy_next_upstream_tries 2;
proxy_connect_timeout 1s;
```

`max_fails` 是被动式的：先有请求失败才标记节点不可用，第一个吃失败的请求会拿到 504。对可用性敏感的服务，用 Tengine 的 `check` 指令做主动探测，或者把摘除逻辑交给注册中心。

`keepalive 32` 要配合 `proxy_http_version 1.1` 和 `proxy_set_header Connection ""`，否则长连接不生效，每次都重新握手。

### 4.4 上线前必做的三个验证

```bash
# 1. 看 VIP 在哪台
ip addr | grep 10.0.0.100

# 2. 停掉 MASTER 的 nginx，观察切换耗时
time (while ! curl -fsS -m1 http://10.0.0.100/healthz >/dev/null; do sleep 0.2; done)

# 3. 恢复 MASTER，确认回切符合预期（preempt_delay 是否生效）
systemctl start keepalived
```

第 2 步要连续做三次：杀 Nginx、杀 Keepalived、直接断网（`ip link set eth0 down`）。三种情况对应的行为不一样，只测第一种往往上线才发现问题。

## 5. 常见问题

### 5.1 Keepalived 起了但 VIP 没绑上

看日志 `journalctl -u keepalived`。高频原因：`interface` 名写错、`virtual_router_id` 冲突、`auth_pass` 两边不一致（VRRP 报文校验失败会直接丢弃）。

### 5.2 切换后连接全断

VRRP 只解决 IP 归属，已建立的 TCP 连接不会迁移。客户端要有重连；长连接场景（WebSocket）要额外做会话外置。

### 5.3 云上能用 Keepalived 吗

普通云主机 + 弹性 IP 场景不能直接照搬：VIP 漂移需要云厂商的辅助网卡/高可用虚拟 IP（HaVip）支持，否则 ARP 改了也没用。要么用云的 LB，要么用云 API 在切换时重新绑定 EIP——那就是另一套自动化逻辑了。

### 5.4 需要三台以上吗

VRRP 支持多节点，但主备模型下多出来的机器只待机，性价比低。入口层一般两台足够；要真正的多活，考虑 BGP + Anycast 或者把入口下沉到服务网格的南北向网关。

## 6. 总结与延伸

Keepalived 的核心是「用一个能真实反映服务能力的探测脚本，去决定 VIP 归属」。三条经验：

1. 探活要探 HTTP 200，不要探进程；
2. `fall`/`rise`/`preempt_delay` 三个参数决定会不会来回抖；
3. 脑裂的根因九成是网络（协议 112 被拦或组播丢失），优先改单播。

延伸方向：用 `ipvsadm` 让 Keepalived 直接做四层负载（性能高于 Nginx）、Nginx 配置热更新与灰度发布、以及把入口层指标（5xx 比例、上游响应时间）接到告警，做到「切换前就知道要切」。
