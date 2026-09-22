---
title: "用 GitHub Issues 驱动个人博客：从写文章到自动部署"
description: "这个博客没有后台、没有数据库，文章的唯一来源是打了 blog 标签的 GitHub Issue。同步任务把 Issue 转成 Markdown 提交进仓库，再由 Astro 构建成静态站点部署到 Cloudflare。"
pubDate: 2026-08-05
tags: ["github", "workflow", "blog"]
draft: false
---

## 1. 现状与痛点

写博客最贵的成本往往不是写字，而是「开始写」这个动作本身：要打开编辑器、找到仓库、确认目录结构、本地起服务预览、再 commit push。手机上有想法的时候，这套流程基本等于劝退。

另一个常见问题是后台。自建博客系统要维护数据库、登录态、上传接口和备份，这些东西和技术写作本身没关系，却占据了大部分维护时间。

所以这个博客把发布入口压到了最低：**在 GitHub 上建一个 Issue 就等于发一篇文章**。手机上用 GitHub App 发 Issue 的体验和发朋友圈差不多，剩下的交给流水线。

## 2. 方案概述

整体链路只有一句话：Issue 是内容源，仓库里的 Markdown 是构建产物，站点是只读消费端。

```text
GitHub Issue (label: blog)
   └─ GitHub Actions 定时触发
        └─ scripts/sync-issues.js 转成 src/content/blog/*.md
             └─ git commit + push [skip ci]
                  └─ Astro 构建静态站点
                       └─ Cloudflare Workers 部署
```

### 2.1 关键角色

| 环节 | 负责什么 | 落在哪里 |
| --- | --- | --- |
| Issue 正文 | 文章 Markdown 内容 | GitHub |
| Issue 标签 | 文章标签（`blog` 本身会被剔除） | GitHub |
| 同步脚本 | 拉取 Issue、生成文件名与 frontmatter | `scripts/sync-issues.js` |
| 增量记录 | 记住每个 Issue 对应的文件，避免重复同步 | `src/content/blog/.sync-meta.json` |
| 内容集合 | 校验 frontmatter 字段 | `src/content.config.ts` |
| 页面渲染 | 列表、归档、标签、详情页 | `src/pages/` |

### 2.2 为什么要把 Markdown 提交进仓库

也可以只在构建时把 Issue 拉下来丢进内存，但落盘有三个好处：本地不联网也能跑 `npm run dev`；文章有真实的 git 历史可以 diff 和回滚；构建失败时能直接看到是哪篇内容的格式有问题。

代价是仓库里会多出一类「机器提交的 commit」，所以同步 commit 统一带 `[skip ci]`，避免自己触发自己。

## 3. 实现步骤

### 3.1 发一篇文章

在仓库里新建 Issue，标题就是文章标题，正文直接写 Markdown，打上 `blog` 标签，其余标签按需加。剩下的不用管，下一次定时任务会同步。

想立刻看到效果就手动跑一次：

```bash
npm run sync:issues
```

脚本需要仓库信息，本地跑要显式指定：

```bash
ISSUE_REPO=your-name/your-blog-repo npm run sync:issues
```

### 3.2 控制发布时间

默认用 Issue 的创建时间当发布时间。如果想改日期，或者想让文章晚一点才出现，在 Issue 正文里塞一段元信息注释：

```markdown
<!-- issue-blog-meta
pubDate: 2026-09-01
updatedDate: 2026-09-05
-->
```

这段注释只给同步脚本读，生成 Markdown 时会被剥掉，不会出现在页面上。

### 3.3 本地预览和构建

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # astro check + 静态构建，产物在 dist/
```

`SITE_URL` 会影响 canonical 链接、RSS 和 sitemap，构建时记得带上：

```bash
SITE_URL=https://example.com npm run build
```

不设的话会回退到 `https://example.com` 并在构建日志里告警——RSS 链接写错域名是很难靠肉眼发现的 bug，所以宁可吵一点。

## 4. 关键细节

**Issue 和 PR 会被混在一起。** GitHub 的 issues 列表默认包含 PR，同步脚本按 `pull_request` 字段过滤掉了 PR，但如果你用 API 自己拉数据，这一步很容易漏。

**文件名带日期，改日期会换文件。** 文件名规则是 `日期-Issue编号-标题slug.md`。给已发布的 Issue 补一个 `pubDate` 会让它换成新文件名，脚本会先删旧文件再写新文件，所以 URL 会变。已经被人转发过的文章尽量不要改发布时间。

**标签名会进 URL。** 中文标签会被 slugify 成空串，最后回退成 `encodeURIComponent` 的结果，链接能打开但很难看。建议标签统一用小写英文加连字符，比如 `springboot`、`devops`。

**删除 Issue 等于删除文章。** 同步时不在这个 Issue 列表里的文件会被连带删掉。想临时下线一篇文章，关掉 Issue 就行；想保留内容就别删 Issue。

**手动写的 Markdown 不会被同步删掉。** 只有记录在 `.sync-meta.json` 里的文件才归同步管，本地手写的文章会一直留着。

## 5. 常见问题

**为什么我发了 Issue 但站点没更新？**
先看 Actions 里同步任务有没有跑，再看 Issue 是否带着 `blog` 标签、状态是否为 open。已关闭的 Issue 默认不会被同步（`ISSUE_STATE` 可以改）。

**为什么我的文章日期是 1970 年？**
`pubDate` 写成了无法解析的格式。只支持 `YYYY-MM-DD` 或带时区的 ISO 字符串，别写 `2026/9/1`。

**能不能不用 GitHub Actions 部署？**
可以。产物是纯静态目录，`dist/` 扔到任意静态托管都能跑。仓库里的 `wrangler.jsonc` 只是 Cloudflare Workers 的配置，换平台就换掉这一步。

## 6. 总结与延伸

核心要点：

- 内容源是 Issue，Markdown 是产物，站点只读
- 发布时间可以用 `issue-blog-meta` 注释覆盖
- 同步是增量的，靠 `.sync-meta.json` 记录状态
- 标签用英文小写，URL 才干净

可以接着往下做的方向：给详情页接 Giscus 评论、把 RSS 推到 Newsletter、用 Issue 的评论做文章更新记录。
