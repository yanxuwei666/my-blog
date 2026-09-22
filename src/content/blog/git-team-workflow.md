---
title: "团队协作的 Git 工作流：分支模型、rebase 时机与冲突处理"
description: "Git 冲突本身不可怕，可怕的是团队没有统一约定。分支怎么切、什么时候允许 rebase、PR 要多小、合并用哪种方式——这四件事定下来，大部分协作摩擦就消失了。"
pubDate: 2026-08-19
tags: ["git", "workflow", "code-review"]
draft: false
---

## 1. 现状与痛点

协作出问题的团队，Git 使用上通常有这几个特征：

- 有人直接在 `main` 上开发，推之前才 `pull`，结果一次提交带上别人的半成品；
- 分支活了三周，合并时冲突两百多个文件，谁都不敢动；
- 历史里全是「fix」「改一下」「回滚上一条」，`git bisect` 定位不到问题；
- 有人对已经推出去的分支做了 `rebase`，然后要求大家「重置一下本地分支」。

这些都不是 Git 的能力问题，是约定问题。下面这套约定在小团队里可以直接抄。

## 2. 方案概述

### 2.1 分支模型

| 分支 | 用途 | 谁能推 | 生命周期 |
| --- | --- | --- | --- |
| `main` | 随时可发布的状态 | 只接受 PR | 永久 |
| `feat/xxx` | 一个功能或一个修复 | 作者 | 合并即删 |
| `release/x.y` | 发版前的稳定与修 bug | 两人以上 | 发版后合回 main |
| `hotfix/xxx` | 线上紧急修复 | 作者 + reviewer | 合并即删 |

关键约束只有一条：**一个分支只做一件事**。分支名带上 issue 号，比如 `feat/128-order-export`。

### 2.2 日常循环

```text
main ──▶ 切分支 ──▶ 小步提交 ──▶ rebase 同步 main ──▶ 发 PR ──▶ review ──▶ squash 合并 ──▶ 删分支
```

### 2.3 合并方式怎么选

| 方式 | 结果 | 适用 |
| --- | --- | --- |
| Merge commit | 保留真实分支拓扑 | 长期特性分支合入 release |
| Squash merge | 一个 PR 压成一条提交 | 日常功能 PR（推荐默认） |
| Rebase merge | 线性历史，保留每条提交 | 提交本身粒度就很干净时 |

对个人项目和小团队，**默认 squash** 最省心：`main` 的历史等于「做了哪几件事」，而不是「保存了几次」。

## 3. 实现步骤

### 3.1 开分支

```bash
git switch main
git pull --ff-only
git switch -c feat/128-order-export
```

`--ff-only` 很重要：如果这里失败，说明本地 `main` 被你自己动过，先处理干净再开发。

### 3.2 提交拆小

一次提交只做一件事，并且能一句话说清。写不出描述，通常说明改多了。

```bash
git add -p            # 逐块暂存，避免把调试代码一起提交
git commit -m "feat(order): 导出接口支持按时间范围筛选"
```

提交信息用约定式格式（`feat:` / `fix:` / `refactor:` / `chore:`），后面可以自动生成 changelog。

### 3.3 同步主干用 rebase

```bash
git fetch origin
git rebase origin/main
```

rebase 期间冲突要一个个解，解完：

```bash
git add <file>
git rebase --continue     # 不是 git commit
```

想中途放弃：

```bash
git rebase --abort
```

### 3.4 发 PR 前整理提交

```bash
git log --oneline origin/main..HEAD     # 先看看自己提交成了什么
git rebase -i origin/main               # 合并琐碎提交、改描述
git push --force-with-lease             # 而不是 --force
```

`--force-with-lease` 会在远端被别人动过时拒绝推送，是个人分支强推的安全阀。

### 3.5 处理冲突的实用命令

```bash
git checkout --ours <file>      # 冲突时取当前分支版本
git checkout --theirs <file>    # 取对方版本
git mergetool                   # 图形化对比

# 完全不知道这行是谁改的
git blame <file>
git log -p -S "关键词" -- <file>   # 搜哪个提交引入/删除了这段代码
```

### 3.6 找回丢掉的提交

误 rebase、误 reset 之后先别慌，reflog 还在：

```bash
git reflog
git checkout -b rescue <commit-sha>
```

只要没执行过 `git gc --prune=now`，本地提交基本都能捞回来。

## 4. 关键细节

**黄金法则：不要 rebase 已经共享的分支。** 别人基于你的提交工作后，改写历史会让他们的本地状态和远端分叉。`main` 永远不 rebase，只 merge。

**`git pull` 默认行为要统一。** 团队里建议直接配成 rebase，避免自动产生一堆「Merge branch 'main' into feat」的噪音提交：

```bash
git config --global pull.rebase true
git config --global rebase.autoStash true
```

**`.gitignore` 的改动要单独一个提交。** 它影响所有人，混在功能提交里容易被忽略。

**大文件先想清楚。** 图片、模型、数据集进了 Git 历史就再也删不掉（除非重写历史）。这类资源用 Git LFS 或对象存储。

**PR 控制在 400 行以内。** 超过这个量，review 质量断崖式下降。拆分方式：先合重构、再合功能；或者按数据层 / 接口层 / 前端分层合。

## 5. 常见问题

**rebase 和 merge 到底选哪个？**
个人分支同步主干用 rebase（历史干净），公共分支接收改动用 merge（不改写别人依赖的历史）。

**为什么我的 PR 显示「This branch is out of date」？**
`main` 前进了。本地 `git rebase origin/main` 后 `push --force-with-lease` 即可。

**提交里混进了不该有的文件怎么办？**
还没推：`git reset --soft HEAD~1` 回到暂存态重新选。已经推了：`git rm --cached <file>` 再提交，并注意如果文件里有密钥，必须轮换——删提交不等于删泄露。

**要不要用 Git Flow？**
除非你要同时维护多个发布版本，否则 `main` + 特性分支 + squash 就够了。Git Flow 的 `develop` 分支在持续部署场景里是纯开销。

## 6. 总结与延伸

核心要点：

- 分支只做一件事，命名带 issue 号
- 同步主干用 rebase，合并 PR 默认 squash
- 已共享的历史不改写，强推只用 `--force-with-lease`
- 丢了提交先查 `git reflog`

可以继续拆的问题：

- 约定式提交与自动版本号、changelog 生成
- 主干开发（Trunk Based）与特性开关的配合
- 多仓库共用代码时 submodule 与包管理的取舍
