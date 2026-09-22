---
title: "Vue 3 列表页的三个老问题：竞态、重复请求和翻页时的一片空白"
description: "搜索框快速输入时后到的旧响应覆盖新结果，路由来回切换时同一份数据请求三遍，翻页时整块表格闪一下空白。这三个问题不需要新库，用 AbortController、一个请求缓存层和 Pinia 就能收掉。"
pubDate: 2026-06-26
category: "前端应用"
tags: ["vue", "javascript", "frontend", "state-management"]
draft: false
---

## 1. 现状与痛点

一个典型的后台列表页：

```vue
<script setup lang="ts">
const list = ref<Order[]>([]);
const loading = ref(false);

async function fetchData() {
  loading.value = true;
  const { data } = await api.getOrderList(query);
  list.value = data.records;   // 谁最后回来，谁就是真相
  loading.value = false;
}

watch(query, fetchData, { deep: true });
</script>
```

上线后收到的反馈通常是这三条：

1. **数据错乱**：输入「abc」触发三次请求，「ab」的响应比「abc」晚到，表格显示的是「ab」的结果；
2. **重复请求**：用户来回点菜单，同一个接口在 Network 面板里出现四五次，每次都完整走一遍后端；
3. **闪白屏**：翻页时 `loading` 把整块表格换成骨架屏，视觉上一直跳。

这三个问题的根因分别是：没有请求标识、没有缓存层、没有区分「首次加载」和「刷新」。

## 2. 方案概述

分三层处理，不要把它们揉在组件里：

```text
组件层     只管声明「我要什么数据」，不关心怎么拿
状态层     Pinia store：缓存 + 请求去重 + 竞态判定
传输层     axios 实例：AbortController、取消标记、错误归一
```

判断标准很简单：组件里不应该出现 `loading.value = true` 这种手工状态同步。

## 3. 实现步骤

### 3.1 传输层：让请求可以被取消

```ts
// src/utils/http.ts
import axios, { CanceledError } from "axios";

const pending = new Map<string, AbortController>();

export function requestKey(config: AxiosRequestConfig) {
  return [config.method, config.url, JSON.stringify(config.params ?? {})].join("|");
}

http.interceptors.request.use(config => {
  if (config.cancelDuplicate !== false) {
    const key = requestKey(config);
    pending.get(key)?.abort();               // 同键新请求，取消旧请求
    const controller = new AbortController();
    config.signal = controller.signal;
    pending.set(key, controller);
    (config as any).__key = key;
  }
  return config;
});

http.interceptors.response.use(
  res => {
    pending.delete((res.config as any).__key);
    return res;
  },
  err => {
    if (err.config) pending.delete((err.config as any).__key);
    if (err instanceof CanceledError) {
      // 给调用方一个可识别的标记，而不是抛一个「错误」
      err.__canceled = true;
    }
    return Promise.reject(err);
  }
);
```

这里有个取舍：**取消旧请求**还是**丢弃旧响应**。取消省流量，但如果接口有副作用就不能取消；纯查询接口用取消，翻页/搜索场景两者都可以。

### 3.2 状态层：一份请求登记表解决竞态和重复

```ts
// src/stores/order.ts
import { defineStore } from "pinia";

interface ListState {
  records: Order[];
  total: number;
  queryKey: string;
  loaded: boolean;
}

export const useOrderStore = defineStore("order", () => {
  const cache = ref(new Map<string, ListState>());
  const inflight = new Map<string, Promise<ListState>>();

  async function load(query: OrderQuery, force = false) {
    const key = JSON.stringify(query);

    if (!force && cache.value.has(key)) return cache.value.get(key)!;

    // 同一个 key 正在请求中，复用同一个 Promise：这就是去重
    const running = inflight.get(key);
    if (running) return running;

    const task = (async () => {
      // 竞态判定：只有当前最新的那次请求才允许写缓存
      const seq = ++loadSeq;
      const { data } = await api.getOrderList(query);
      if (seq !== loadSeq) throw Object.assign(new Error("stale"), { __canceled: true });
      const state = { records: data.records, total: data.total, queryKey: key, loaded: true };
      cache.value.set(key, state);
      return state;
    })().finally(() => inflight.delete(key));

    inflight.set(key, task);
    return task;
  }

  let loadSeq = 0;

  return { cache, load, invalidate: (q: OrderQuery) => cache.value.delete(JSON.stringify(q)) };
});
```

`inflight` 这张表同时解决了「重复请求」和「多处组件同时想要同一份数据」。它比在组件里写 `if (loading) return` 可靠，因为作用域是全局的。

### 3.3 组件层：只处理三种视觉状态

```vue
<script setup lang="ts">
const store = useOrderStore();
const query = ref<OrderQuery>({ page: 1, size: 20, keyword: "" });

const state = ref<ListState | null>(null);
const refreshing = ref(false);   // 有数据但在拉新的
const error = ref<string>("");

async function fetchList(force = false) {
  refreshing.value = true;
  error.value = "";
  try {
    state.value = await store.load(query.value, force);
  } catch (e: any) {
    if (!e.__canceled) error.value = e.message ?? "加载失败";
  } finally {
    refreshing.value = false;
  }
}

// 输入防抖交给 watch 的 effect，而不是散落在每个组件里
const stop = watchEffect(onCleanup => {
  const t = setTimeout(() => fetchList(), 250);
  onCleanup(() => clearTimeout(t));
});
onUnmounted(stop);
</script>

<template>
  <el-table v-loading="refreshing && !state?.records.length" :data="state?.records ?? []">
    <!-- 翻页时表格保持旧数据，右上角一个细进度条表示「正在刷新」 -->
  </el-table>
</template>
```

关键点是 `v-loading="refreshing && !state?.records.length"`：**有数据时不再整块遮罩**，只在按钮或表头做局部 loading。闪白屏问题一大半出在这里。

## 4. 关键细节

### 4.1 缓存什么时候必须失效

按操作类型清，不要按时间猜：

```ts
async function deleteOrder(id: number) {
  await api.deleteOrder(id);
  store.invalidateAll();   // 列表条件组合多，宁可全清
  await fetchList(true);
}
```

`invalidateAll` 在条件组合很多时比逐个 key 删除更稳。缓存生命周期就是「一次页面访问」，路由离开时如果 store 是页面级的，会自动回收。

### 4.2 keep-alive 与二次进入

```vue
<keep-alive :include="['OrderList']" :max="8">
  <router-view />
</keep-alive>
```

配合 `onActivated` 判断要不要刷新：

```ts
onActivated(() => {
  if (Date.now() - lastLoadTime > 60_000) fetchList(true);
});
```

不做这层，用户从详情页返回列表会看到离开前的旧数据；做过头，等于没缓存。

### 4.3 表单提交按钮的防重

前端防重和后端幂等是两件事，两边都要做：

```ts
const submitting = ref(false);
async function submit() {
  if (submitting.value) return;
  submitting.value = true;
  try {
    await api.createOrder({ ...form, requestId: uuid() });
  } finally {
    submitting.value = false;
  }
}
```

`requestId` 由前端生成并透传，后端唯一索引兜底，才是完整的幂等链路。

## 5. 常见问题

### 5.1 为什么不在组件里用 useRequest / SWR

可以，且更省事。本文的做法解决的是「多个组件共享同一份列表数据 + 需要在别处触发失效」的场景。如果每个组件的数据互不相干，直接用 `@vueuse/core` 的 `useFetch`（自带 `cancelToken` 和去重）比手写 store 更合适。判断依据是：**这份数据需不需要被别的组件读到或改动**，需要就进 Pinia，不需要就留在组件里。

### 5.2 AbortController 取消后 catch 里要不要提示

不要。`CanceledError` 是预期行为，弹「请求失败」会让用户以为系统出问题。统一用 `__canceled` 标记过滤掉。

### 5.3 watch 的 deep 为什么会打爆请求

`watch(query, fn, { deep: true })` 在数组、日期对象上会被内部引用变化触发。改成显式监听序列化结果：

```ts
watch(() => JSON.stringify(query.value), () => fetchList());
```

这样只有真正影响请求参数的变化才会触发。

### 5.4 首屏白屏和骨架屏的关系

列表页首屏建议骨架屏（保留布局高度，避免跳动），但骨架屏数量要和实际数据量接近；表格类页面用「表头 + 5 行占位」比整块 spinner 体验好。

## 6. 总结与延伸

三个问题对应三个机制：

1. 竞态 → 请求序号或 AbortController，二者选一，关键是「旧结果不能写新状态」；
2. 重复请求 → 全局 `inflight` 登记表复用 Promise；
3. 闪白 → 区分首次加载和刷新，有数据时不做整块遮罩。

延伸方向：用 `Composable` 把上面三层封成一个 `useTable`；列表虚拟滚动（数据量大时 DOM 节点数比请求更值得优化）；以及把 `requestId` 打通到前端埋点，量化真实的重试率。
