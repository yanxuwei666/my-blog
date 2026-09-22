# Issue Blog

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/yanxuwei666/my-blog)

English README: [README.en.md](./README.en.md)

一个参考 `zone/blog` 做的轻量博客模板：用 GitHub Issues 写文章，自动同步成仓库里的 Markdown，再一键部署到 Cloudflare。

Issue Blog 适合想写博客、沉淀技术笔记、发布项目日志，但不想维护后台、数据库、CMS 和复杂部署流程的人。你只需要打开 GitHub Issue 写内容，剩下的同步、生成静态页面、RSS 和部署交给仓库自动完成。

## 它解决什么问题

传统博客系统经常会把“写文章”变成“维护系统”：要搭 CMS、管数据库、配置服务器、处理备份，还要考虑编辑器、权限和部署。Issue Blog 把这些都压缩到 GitHub 的现成能力里。

- 不想维护后台：GitHub Issues 就是编辑器和内容管理界面。
- 不想维护数据库：文章同步为 Markdown 文件，天然可版本化。
- 不想重复发布：Issue 创建、编辑、打标签后自动同步。
- 不想折腾部署：Cloudflare 一键部署，静态站点访问快、成本低。
- 不想内容被平台锁住：最终内容保存在仓库里，可迁移、可审计、可备份。

## 产品优势

- **写作入口轻**：直接用 GitHub Issue 写文章，支持 Markdown、图片、代码块、评论讨论。
- **内容归档清晰**：同步后的文章保存在 `src/content/blog/`，每次变更都有 Git 历史。
- **发布链路短**：给 Issue 加 `blog` 标签即可进入博客，不需要额外后台操作。
- **部署成本低**：Astro 生成静态站点，Cloudflare 托管，适合长期运行。
- **适合个人和小团队**：个人博客、项目更新、知识库、开发日志都能用。
- **不绑定平台**：文章是 Markdown，站点是普通 Astro 项目，后续可以自由改主题、加搜索、加评论。

## 特色

- GitHub Issues 同步文章
- `blog` 标签筛选发布内容
- Issue 其他标签自动转为文章标签
- 支持固定 `pubDate` 和 `updatedDate`
- 自动生成文章详情页和 RSS
- GitHub Actions 自动同步并提交 Markdown
- 支持 Cloudflare 一键部署
- 支持本地开发、构建和 Wrangler 部署

## 一键部署

点上面的 **Deploy to Cloudflare** 按钮即可，**不需要手动 fork** —— Cloudflare 会自动把模板复制到你的账号、建好 Worker 项目并完成首次部署。

| 步骤 | 操作 | 说明 |
| --- | --- | --- |
| **1** | 点 **Deploy to Cloudflare** | 授权 GitHub，Cloudflare 自动创建你的仓库副本 |
| **2** | 设置环境变量 `SITE_URL` | 填你的域名，如 `https://blog.example.com`。**还没域名可以跳过这一步**，其它什么都不用填 |
| **3** | 点 **Deploy** 并等待 1~2 分钟 | 出现 `https://<项目名>.<你的子域>.workers.dev` 就是成功了 |
| **4** | 启用文章自动同步（只做一次） | 你的新仓库 → **Actions** → **Enable workflow** → **Sync Issues** → **Run workflow** |

四步做完就能用了：在仓库里新建 Issue 并打上 `blog` 标签，文章会自动同步成 Markdown，并触发 Cloudflare 重新部署。

- `blog` 标签不用手动创建，工作流会自动补上。
- `SITE_URL` 决定 canonical、RSS 和 `sitemap-index.xml` 里的绝对地址。不填也能部署成功，只是链接会指向占位的 `https://example.com`（构建日志里会有提醒）。没有域名时：先部署，拿到 `*.workers.dev` 地址后回控制台填 `SITE_URL`，再点一次 Redeploy。

<details>
<summary>向导里的构建配置对照表</summary>

| 配置项 | 值 |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Output directory | `dist`（由 `wrangler.jsonc` 的 `assets.directory` 指定） |
| Node.js | `22`（仓库已通过 `.node-version` 固定） |

</details>

<details>
<summary>我已经 fork 了，怎么部署我自己的仓库？</summary>

fork 出来的 README 里按钮仍然指向上游模板，点它会让 Cloudflare 再复制一份上游仓库，而不是部署你的 fork。二选一：

- **控制台方式**：**Workers & Pages → Create → Connect to Git** → 选你的 fork → 按上面的对照表填构建配置。
- **改按钮**：把本文件顶部按钮里的仓库地址换成你自己的：

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/OWNER/REPO)
```

</details>

<details>
<summary>部署失败排查</summary>

| 现象 | 处理 |
| --- | --- |
| `Cannot find module 'wrangler'`、`pagefind` 或 Vite 相关报错 | 构建环境开启了 `NODE_ENV=production`，导致 `npm ci` 跳过 devDependencies。仓库已内置 `.npmrc`（`include=dev`）规避；若你用了自定义构建镜像，请确保安装 devDependencies |
| `Invalid or missing options: ... (description)` | `astro-paper.config.ts` 的 `site.title` / `site.description` 不能为空 |
| 链接都指向 `example.com` | 没有设置 `SITE_URL`，补齐后重新部署 |

部署到自己的账号之外，也可以本地直接部署：`npm run deploy`（等价于 `npm run build && wrangler deploy`）。

</details>

## 工作流

```text
GitHub Issue
  ↓ 添加 blog 标签
GitHub Actions
  ↓ 调用 scripts/sync-issues.js
Markdown 文件
  ↓ Astro build
Cloudflare 静态站点
```

## 写文章

1. 在当前仓库新建 Issue。
2. 给 Issue 加上 `blog` 标签。
3. GitHub Actions 会在 Issue 创建、编辑、打标签、取消标签、重新打开、关闭、删除时同步，也会每天北京时间 08:00 和 20:00 定时同步。
4. 同步结果会提交到 `src/content/blog/`。

Issue 的其他标签会变成文章标签，`blog` 标签只用于筛选文章。

## 适合用来做什么

- 个人技术博客
- 项目 changelog 或开发周报
- 轻量知识库
- 团队内部技术笔记
- 开源项目公告页
- 把历史 Issue 整理成可浏览文章

如果这个模板对你有帮助，欢迎点个 Star。你的支持会直接推动我继续补强主题、同步能力和部署体验。

[![Star History Chart](https://api.star-history.com/svg?repos=yanxuwei666/my-blog&type=Date)](https://star-history.com/#yanxuwei666/my-blog&Date)

## 本地开发

```bash
npm install          # 安装依赖
npm run dev          # 本地开发（默认 http://localhost:4321）
npm run build        # 构建到 dist/
npm run deploy       # 构建并部署到 Cloudflare

# 手动同步指定仓库的 Issues
ISSUE_REPO=OWNER/REPO GITHUB_TOKEN=YOUR_TOKEN npm run sync:issues
```

## Issue 元数据

如果想固定发布日期，可以在 Issue 正文里加入：

```md
<!-- issue-blog-meta
pubDate: 2026-06-27
updatedDate: 2026-06-27
-->
```

不写时默认使用 Issue 创建时间作为 `pubDate`，Issue 更新时间作为 `updatedDate`。

## 配置项

同步脚本支持这些环境变量：

- `ISSUE_REPO`：要同步的仓库，例如 `OWNER/REPO`。GitHub Actions 中默认使用当前仓库。
- `ISSUE_LABEL`：文章标签，默认是 `blog`。
- `ISSUE_STATE`：Issue 状态，默认是 `open`。
- `GITHUB_TOKEN`：GitHub API Token，本地同步私有仓库或提高限额时使用。
- `SITE_URL`：Astro 构建时的网站地址，影响 RSS 链接。

## 目录

```text
issue-blog/
├── .github/
│   ├── ISSUE_TEMPLATE/blog.md
│   └── workflows/sync-issues.yml
├── scripts/sync-issues.js
├── src/
│   ├── content/blog/
│   ├── layouts/
│   ├── lib/
│   └── pages/
├── .npmrc
├── .node-version
├── astro.config.mjs
├── astro-paper.config.ts
├── wrangler.jsonc
└── README.md
```

## 许可

MIT
