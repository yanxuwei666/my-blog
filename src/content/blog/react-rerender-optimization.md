---
title: "React 重渲染排查：什么时候该用 memo、useMemo、useCallback"
description: "React 的性能问题多数不是算得慢，而是白算了。先定位是谁触发了渲染，再决定要不要 memo，顺序反了就会得到一堆没有收益的缓存代码。"
pubDate: 2026-09-03
category: "前端应用"
tags: ["react", "javascript", "frontend", "performance"]
draft: false
---

## 1. 现状与痛点

页面里有一个搜索框，每敲一个字符整个列表就闪一下。打开 React DevTools 的 Profiler，发现几十个列表项全部标黄重渲染了——而它们的数据一个字都没变。

于是开始给每个组件套 `React.memo`，每个函数套 `useCallback`，每个数组套 `useMemo`。代码长了两倍，性能没动，还引入了新问题：缓存本身要占内存，依赖数组写错还会读到旧值。

正确的顺序是：**先确认渲染是从哪一层发起的，再判断这次渲染是否可避免，最后才选工具**。

## 2. 方案概述

### 2.1 React 什么时候会渲染

只有三种情况：

1. 组件自身的 state 变了；
2. 父组件渲染了，子组件默认跟着渲染（不管 props 有没有变）；
3. 消费的 context 值变了。

第 2 条是绝大多数多余渲染的来源。`React.memo` 拦的就是它。

### 2.2 三个工具分别解决什么

| 工具 | 缓存什么 | 解决的问题 |
| --- | --- | --- |
| `React.memo` | 组件渲染结果 | 父组件更新时，props 未变的子组件不再渲染 |
| `useMemo` | 一次计算的返回值 | 避免每次渲染都重复做昂贵计算 |
| `useCallback` | 函数引用 | 让传给 `memo` 子组件的 props 保持引用稳定 |

关键认知：`useCallback` 单独用几乎没有收益，它只有在配合 `React.memo` 或作为其他 Hook 的依赖时才有意义。

### 2.3 相关链接

- React 官方文档：[memo](https://react.dev/reference/react/memo)、[useMemo](https://react.dev/reference/react/useMemo)
- 调试工具：React DevTools Profiler

## 3. 实现步骤

### 3.1 用 Profiler 定位渲染源

1. React DevTools 切到 Profiler，点录制；
2. 在页面上敲一次搜索框；
3. 看提交柱状图里哪些组件被渲染，点开看「为什么渲染」。

React 18+ 会直接给出原因，比如 `props changed` 或 `hooks`。这一步不做，后面全是猜。

### 3.2 先看是不是状态放太高了

最常见的错误是把只给一个子组件用的状态下到了父组件：

```jsx
// 问题：keyword 变化会连带渲染整个 Table
function Page() {
  const [keyword, setKeyword] = useState("");
  return (
    <>
      <SearchBox value={keyword} onChange={setKeyword} />
      <DataTable rows={rows} />
    </>
  );
}
```

把状态推到真正需要它的层级，或者让 `DataTable` 不依赖它：

```jsx
function Page() {
  return (
    <>
      <SearchSection rows={rows} />
      <DataTable rows={rows} />
    </>
  );
}

function SearchSection({ rows }) {
  const [keyword, setKeyword] = useState("");
  return <SearchBox value={keyword} onChange={setKeyword} />;
}
```

结构调整能解决的问题，不要用 memo 解决。

### 3.3 给列表项套 memo

```jsx
const Row = React.memo(function Row({ item, onSelect }) {
  return <tr onClick={() => onSelect(item.id)}>{item.name}</tr>;
});
```

`memo` 做的是浅比较，所以 props 里不能出现每次渲染都新建的对象、数组、函数。

### 3.4 稳定住引用类型 props

```jsx
function Table({ rows }) {
  // 不加 useCallback，这个函数每次渲染都是新引用，Row 的 memo 直接失效
  const handleSelect = useCallback(id => {
    setSelected(id);
  }, []);

  return rows.map(item => (
    <Row key={item.id} item={item} onSelect={handleSelect} />
  ));
}
```

### 3.5 昂贵计算才用 useMemo

```jsx
// 值得：对五千行做排序过滤
const visibleRows = useMemo(
  () => rows.filter(r => r.name.includes(keyword)).sort(byUpdatedDesc),
  [rows, keyword]
);

// 不值得：一次字符串拼接
const label = useMemo(() => `${a}-${b}`, [a, b]);
```

判断标准很简单：把 `useMemo` 删掉，页面会不会明显变卡。不会就删。

### 3.6 用长列表验证

```jsx
// 父组件里放一个和列表无关的状态
const [tick, setTick] = useState(0);

<button onClick={() => setTick(t => t + 1)}>触发父组件更新</button>
```

点一次按钮，Profiler 里如果所有 `Row` 仍然被标记为渲染，说明某个 props 引用没稳住；回到 3.4 排查。

## 4. 关键细节

**`key` 用 index 会造成假性重渲染。** 列表插入或删除时，index 型 key 会让 React 认为所有后续项都变了，`memo` 救不了。用稳定业务 ID。

**`memo` 不阻止 context 和自身 state 引发的渲染。** 子组件内部 `useState` 变了照样渲染，`memo` 只管父组件传下来的那次。

**依赖数组漏写会读到旧值。** 这是 `useMemo` 最常见的 bug：闭包捕获了旧 state，界面看起来「点了没反应」。ESLint 的 `react-hooks/exhaustive-deps` 规则要开着。

**React Compiler 会改变这套权衡。** 官方编译器可以自动插入 memo 化逻辑，手写 `useMemo`/`useCallback` 的必要性会明显下降。新项目可以直接评估它，老项目按现状处理。

**大列表的瓶颈常在 DOM 数量而不是渲染次数。** 上千条数据时，虚拟化（`content-visibility: auto` 或 react-window）的收益远大于 memo。

## 5. 常见问题

**为什么加了 memo 反而更慢？**
浅比较本身有成本。组件很轻、props 很多时，比较开销可能超过重新渲染。`memo` 只给「渲染成本高 + props 稳定」的组件加。

**父组件传 `children` 时 memo 为什么失效？**
每次父组件渲染都会生成新的 `children` 元素对象，浅比较必然不等。这类容器组件用 `props.children` 透传，或者把变化部分下沉。

**Context 一变全树重渲染怎么办？**
拆 Provider：把高频变化的值和低频变化的值分开。或者把订阅下沉到组件里，用 `useSyncExternalStore` 管理外部状态。

## 6. 总结与延伸

核心要点：

- 先定位渲染源，再决定优化工具
- 状态放低层级 > 结构优化 > memo
- `useCallback` 只为引用稳定服务，单独用没收益
- 依赖数组写错比不用 memo 更危险

值得继续拆的问题：

- `useTransition` 和 `useDeferredValue` 怎么把输入卡顿让给后台渲染
- 列表虚拟化的滚动高度抖动怎么处理
- 状态管理库（Pinia / Redux / Zustand）的订阅粒度差异
