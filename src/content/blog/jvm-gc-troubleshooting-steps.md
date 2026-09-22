---
title: "Java 服务 GC 排查入门：先看日志再调参数，四步定位 Full GC 元凶"
description: "接口偶发超时、CPU 周期性打满、监控里 Old 区锯齿状爬升——多数人会直接去抄一堆 JVM 参数。正确的顺序是先开 GC 日志确认现象，再用 jstat/MAT/Arthas 找到根因，最后才动参数。"
pubDate: 2025-12-19
category: "工程实践"
tags: ["jvm", "java", "performance", "troubleshooting"]
draft: false
---

## 1. 现状与痛点

线上服务每隔 40 分钟出现一次 3 秒超时，监控面板：

```text
Old 区使用率:  45% → 88% → 45%   （锯齿，周期约 40min）
GC 时间:       Young GC 20ms，每 40min 一次 Full GC 3.1s
CPU:           Full GC 期间 8 核全部打满
```

第一反应通常是搜「JVM 调优参数」，抄一段：

```bash
-XX:+UseG1GC -Xms4g -Xmx4g -XX:MaxGCPauseMillis=200 -XX:InitiatingHeapOccupancyPercent=35
```

重启后可能好一点，也可能变成 Full GC 每 10 分钟一次。**参数不会解决内存泄漏**，只会把泄漏速度换成另一个数字。

GC 排查的正确顺序是：确认现象 → 判断是「分配太快」还是「回收不掉」→ 找到具体对象 → 再决定是改代码还是调参数。

## 2. 方案概述

### 2.1 先搞清楚收集器怎么选

| 收集器 | 适用堆大小 | 特点 |
| --- | --- | --- |
| Parallel Scavenge + Serial Old | < 2G | JDK 8 默认，吞吐优先，STW 长 |
| CMS | — | JDK 9 起废弃，JDK 14 移除，新项目不要再用 |
| G1 | 4G – 16G | JDK 9+ 默认，分区化、可预测停顿，通用首选 |
| ZGC / Shenandoah | 8G – 数 TB | 亚毫秒级停顿，吞吐有 5–15% 损失 |

经验判断：

1. 堆 ≤ 4G、QPS 不高的后台任务，JDK 17 的默认 G1 不用调任何参数就够；
2. 在线服务要求 P99 稳定，堆 8G 以上，考虑 G1 调 `MaxGCPauseMillis`，或者上分代 ZGC（JDK 21+）；
3. JDK 8 的项目，升级 JDK 往往比调参收益大得多——这一点后面还会提到。

### 2.2 两类问题，两种现象

```text
类型 A：分配过快（Allocation Heavy）
  Young GC 频繁，Old 区增长慢，Full GC 少
  → 优化对象分配、缓存、批量处理

类型 B：回收不掉（Leak / Promotion Failure）
  Old 区每次 Full GC 后仍然很高
  → 找引用链，这是内存泄漏
```

区分它们只需要一条数据：**Full GC 之后的 Old 区占用**。降不下去就是 B 类，调参数无效。

## 3. 实现步骤

### 3.1 第一步：把 GC 日志打开

JDK 9+：

```bash
-Xlog:gc*,gc+heap=debug,safepoint:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=10,filesize=50M
```

JDK 8：

```bash
-XX:+PrintGCDetails -XX:+PrintGCDateStamps -XX:+PrintGCTimeStamps
-XX:+UseGCLogFileRotation -XX:NumberOfGCLogFiles=10 -XX:GCLogFileSize=50M
-Xloggc:/var/log/app/gc.log
```

日志必须开。没有 GC 日志排查内存问题，等于没有日志排查业务异常。

### 3.2 第二步：用 jstat 看实时趋势

```bash
jstat -gcutil <pid> 1000 30
```

```text
  S0     S1     E      O      M     CCS    YGC     YGCT    FGC    FGCT     GCT
  0.00  98.12  87.34  72.55  95.12  91.33   1204   18.221     3    9.812   28.033
  0.00  96.88  91.02  74.10  95.12  91.33   1209   18.310     3    9.812   28.122
```

读表要点：

1. `E`（Eden）快速涨满 → Young GC 正常回收；
2. `O`（Old）单调上涨且 `FGC` 后不降 → 泄漏；
3. `O` 锯齿但每次峰值越来越高 → 晋升过快，可能是大对象或缓存；
4. `M`（Metaspace）持续涨 → 类加载泄漏（动态代理、Groovy 脚本、反复 reload 的 ClassLoader）；
5. `YGC` 次数增长极快但 `YGCT` 很小 → 分配速率高，不是 GC 的问题。

### 3.3 第三步：确认分配热点

```bash
# 采样 30 秒，看谁在疯狂创建对象（JDK 11+ 内置 JFR）
jfr record --repository --path-to-file=/tmp/app.jfr --settings=profile --duration=60

# 或者用 async-profiler，开销更低
asprof -d 60 -e alloc -f /tmp/alloc.html <pid>
asprof -d 60 -e lock  -f /tmp/lock.html  <pid>
```

火焰图里最常见的三类分配源：

1. JSON 序列化/反序列化产生的临时对象和 `char[]`；
2. 每次请求新建 `SimpleDateFormat`、`Pattern.compile`、`Thread`；
3. 集合未指定初始容量导致的反复扩容。

```java
// 反例：循环里频繁扩容
List<OrderVO> list = new ArrayList<>();
for (OrderDO d : dos) { list.add(convert(d)); }

// 正例
List<OrderVO> list = new ArrayList<>(dos.size());
```

### 3.4 第四步：抓堆找引用链

```bash
# 先看直方图（轻量，会 STW，但比 dump 快得多）
jmap -histo:live <pid> | head -30

# 生产环境推荐：带 live 的 dump 会先触发一次 Full GC，谨慎使用
jmap -dump:live,format=b,file=/tmp/heap.hprof <pid>

# 更稳妥的做法：JFR 的 HeapDumpAfter 或者用 Arthas 在线看
heapdump --live /tmp/heap.hprof      # arthas
```

MAT 里两步就够：

1. **Leak Suspects Report** —— 直接看 Dominator Tree 里最大的那一棵；
2. 对可疑对象右键 → *Path to GC Roots* → exclude weak/soft references，看是谁在引用它。

典型结论长这样：

```text
java.util.HashMap @ 0x7c3d (retained 1.2 GB, 68%)
  ↳ com.xxx.cache.LocalOrderCache @ 0x8120
    ↳ static field OrderServiceImpl.LOCAL_CACHE
```

### 3.5 用 Arthas 做在线定位

```bash
# 看某个方法实际耗时分布（判断是不是 GC 之外的原因）
trace com.xxx.OrderService queryOrder '#cost > 500' -n 5

# 反编译线上实际生效的类，确认改的代码真的发上去了
jad --source-only com.xxx.cache.LocalOrderCache

# 观测对象数量变化
vmtool --action getInstances --className java.util.HashMap --limit 5
```

## 4. 关键细节

### 4.1 G1 的几个真正有用的参数

```bash
-Xms8g -Xmx8g                      # 堆固定，避免运行时扩容抖动
-XX:+UseG1GC
-XX:MaxGCPauseMillis=200           # 目标停顿，G1 会反推 Young 区大小
-XX:InitiatingHeapOccupancyPercent=45   # 老年代占比阈值，触发并发标记
-XX:G1HeapRegionSize=16m           # 大对象阈值 = region 的 50%，避免 Humongous 碎片
-XX:+ParallelRefProcEnabled        # 并行处理引用，弱引用多时收益明显
-XX:MaxDirectMemorySize=1g         # 堆外内存上限，NIO/Netty 场景必须显式设
```

三条经验：

1. `MaxGCPauseMillis` 设得过小（比如 20ms）会让 G1 把 Young 区压得极小，反而导致 Young GC 频率暴涨、对象过早晋升；
2. Humongous 对象（≥ region 50%）直接进 Old 区，大量 `byte[]`/`List` 大数组会引发碎片和提前并发标记——调 `G1HeapRegionSize` 比调其他参数有效；
3. `-XX:+AlwaysPreTouch` 在容器里能避免启动后一段时间的性能爬坡，代价是启动变慢。

### 4.2 容器环境的两个必查项

```bash
# JDK 8u191+ / JDK 11+ 默认识别 cgroup，但要确认
java -XX:+PrintFlagsFinal -version | grep -E "MaxHeapSize|ActiveProcessorCount"
```

1. **堆大小**：`-Xmx` 应该 ≤ 容器内存的 75%，剩下的留给元空间、线程栈、DirectBuffer 和 GC 自身开销。设成 90% 大概率被 OOMKilled；
2. **CPU 核数**：JVM 按容器 limit 计算 GC 线程数。如果 limit 是 0.5 核，GC 并行度会极低，停顿时间成倍增加——这时要么提高 limit，要么显式 `-XX:ActiveProcessorCount`。

被 OOMKilled 和 OOM 异常是两回事：

```bash
dmesg -T | grep -i "killed process"        # 容器/系统层杀掉，JVM 日志里什么都没有
```

`java.lang.OutOfMemoryError: Java heap space` 是堆内；`GC overhead limit exceeded` 是 98% 时间在 GC；`Direct buffer memory` 是堆外；`Metaspace` 是类加载；`unable to create new native thread` 是线程数或栈大小。

### 4.3 别忽略「不是 GC」的情况

监控里 GC 时间变长，实际原因经常是：

1. **safepoint 等待**：某处有长循环没到 safepoint 轮询点，`-Xlog:safepoint` 看 `Time spent outside safe region`；
2. **CPU 被别的容器抢走**（steal time），GC 线程拿不到核；
3. **透明大页（THP）**：`/sys/kernel/mm/transparent_hugepage/enabled` 是 `always` 时，Redis/Java 都会出现延迟毛刺，改成 `madvise`。

### 4.4 升级 JDK 的收益

如果现在还在 JDK 8，这几个升级带来的 GC 改进比手工调参明显：

- JDK 11：G1 成为默认，Dynamic String Deduplication；
- JDK 15：移除 CMS，ZGC/Shenandoah 转正；
- JDK 17：G1 改进显著，容器感知更完善；
- JDK 21：分代 ZGC，停顿进入亚毫秒且吞吐接近 G1。

## 5. 常见问题

### 5.1 Young GC 很频繁但耗时短，要处理吗

不用。`YGC` 每分钟几十次、每次 10ms 以内，是正常的。要看的指标是 GC 时间占比（`YGC 总耗时 / 运行时间`，超过 5% 才值得优化）和 P99 延迟。

### 5.2 Full GC 后 Old 区降不下来，但服务没报错

说明堆里有长期存活的对象，可能是合理的（本地缓存、连接池）。判断依据是**是否继续增长**：稳定在 60% 是缓存，缓慢爬到 95% 是泄漏。

### 5.3 要不要开 `-XX:+HeapDumpOnOutOfMemoryError`

要，且要配合 `-XX:HeapDumpPath` 指到容量足够的目录：

```bash
-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/data/dump/
```

注意 dump 文件大小约等于堆大小，8G 堆会产生 8G 文件；容器里如果没挂持久卷，OOM 时 Pod 直接被杀，dump 根本来不及写。这是很多团队「OOM 了但什么线索都没有」的原因。

### 5.4 Metaspace 一直涨

典型是动态类加载：CGLIB 代理、Groovy 脚本、反复 new `ClassLoader`、Fastjson 的 ASM 类。用 `jcmd <pid> GC.class_stats`（需要 `-XX:+UnlockDiagnosticVMOptions`）或 MAT 按 ClassLoader 分组看谁持有的类最多。修复方式是复用 ClassLoader 或者关掉脚本缓存。

## 6. 总结与延伸

四步排查法，顺序不能换：

1. 开 GC 日志（`-Xlog:gc*`），保证事后可查；
2. `jstat -gcutil` 判断是 A 类（分配快）还是 B 类（回收不掉）；
3. A 类用 async-profiler 的 `alloc` 事件找分配热点；B 类用 `jmap -histo` → dump → MAT 找引用链；
4. 只有确认代码没问题、且现象是停顿不达标时，才动 G1 参数；容器环境额外检查堆占比和 CPU limit。

延伸方向：JFR 持续采集与 `jdk.GCHeapSummary` 事件分析、`-XX:+UseStringDeduplication` 的实际收益测量、ZGC 的着色指针原理、以及把 GC 指标（分配速率、晋升速率、GC 时间占比）纳入常规监控大盘。
