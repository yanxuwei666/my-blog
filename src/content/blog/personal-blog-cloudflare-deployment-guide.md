---
title: "从零搭建个人博客并部署到 Cloudflare：完整流程说明"
description: "用 Astro 搭建静态博客，交给 GitHub 管理内容，再通过 Cloudflare Workers 自动构建和发布。"
pubDate: 2026-09-22
category: "工程实践"
tags: ["astro", "github", "cloudflare", "部署"]
draft: false
---

第一次搭建个人博客时，最容易混淆的是“写文章”和“发布网站”其实不是一件事：Astro 负责把内容生成网页，GitHub 负责保存代码并记录变化，Cloudflare 负责把构建结果发布到公网。

这篇文章只围绕一条主线展开：**本地写作 → 推送到 GitHub → Cloudflare 自动构建 → 浏览器访问**。看懂这条链路之后，第一次部署、后续更新、GitHub Issue 写作和常见报错就都能对应起来。

## 一、先看懂博客的整体链路

当前项目使用 **Astro + GitHub + Cloudflare Workers Static Assets**。它不是传统的“买服务器、安装数据库、运行 Node.js 后台”，而是先把 Markdown 和页面代码构建成静态文件，再交给 Cloudflare 托管。

![个人博客从本地写作到 Cloudflare 发布的总体流程图](/images/blog/cloudflare-deployment-flow.png)

这张图里的每个节点职责都很单一：

| 节点 | 负责什么 | 你需要做什么 |
| --- | --- | --- |
| 本地开发 | 编写页面、样式和 Markdown 文章 | 修改代码，运行本地预览 |
| GitHub 仓库 | 保存源码、文章和版本历史 | `commit`、`push` 到 `main` |
| Cloudflare 构建 | 执行依赖安装和 `npm run build` | 配置一次构建命令 |
| Workers 发布 | 托管构建后的 `dist` 文件 | 配置 Worker 和域名 |
| 浏览器访问 | 访问最终网站 | 使用 `workers.dev` 或自定义域名 |

项目中还有一条可选分支：如果通过 GitHub Issue 写文章，GitHub Actions 会把 Issue 转成 `src/content/blog/*.md`，再提交到 `main`。这个提交同样会触发 Cloudflare 构建，所以它只是换了一个写作入口，后面的发布链路没有变化。

## 二、搭建项目并完成本地验证

### 1. 准备环境

开始前准备以下内容即可：

- GitHub 账号和仓库，本项目仓库是 `https://github.com/yanxuwei666/my-blog`。
- Node.js 20 或更高版本，建议使用 Node.js 22。
- Git、VS Code 等本地开发工具。
- Cloudflare 账号。第一次部署时还需要授权 Cloudflare 访问 GitHub 仓库。

仓库可以先保持公开，这样 Cloudflare 读取仓库内容最简单。私有仓库也可以部署，但必须保证 Cloudflare 的 GitHub App 已经获得该仓库的访问权限。

### 2. 认识项目目录

不需要一开始就读懂所有源码，日常写作主要关注这几个位置：

```text
my-blog/
├─ src/
│  ├─ content/blog/       # Markdown/MDX 文章
│  ├─ pages/              # 首页、文章页、分类页、标签页
│  ├─ layouts/            # 页面布局
│  └─ components/         # 可复用组件
├─ public/                # 原样复制到网站根目录的图片等资源
├─ scripts/               # Issue 同步脚本
├─ .github/workflows/     # GitHub Actions 工作流
├─ astro.config.mjs       # Astro 构建配置
├─ wrangler.jsonc         # Cloudflare Worker 配置
└─ package.json           # 依赖和 npm 命令
```

当前项目使用静态输出：

```js
output: "static"
```

因此 Astro 会在构建阶段生成完整的 HTML、CSS、JavaScript 和图片引用，产物放在 `dist` 目录。Cloudflare 只需要发布这些构建产物，不需要为博客运行数据库或常驻 Node.js 服务。

### 3. 写文章、预览和构建

在 `src/content/blog/` 下新建 Markdown 文件，文件开头的 frontmatter 用来描述标题、日期、分类和标签：

```markdown
---
title: "我的第一篇文章"
description: "这是一篇文章简介。"
pubDate: 2026-09-22
category: "随笔"
tags: ["记录", "生活"]
draft: false
---

## 正文标题

这里开始写 Markdown 正文。
```

图片可以放在 `public/images/`，然后使用站点绝对路径引用：

```markdown
![图片说明](/images/example.png)
```

第一次拿到项目或依赖发生变化时，先执行：

```bash
npm install
npm run dev
```

浏览器打开终端提示的地址，通常是 `http://localhost:4321`。修改文章后页面会自动刷新；准备发布前再执行一次：

```bash
npm run build
```

当前命令会依次完成 `astro check`、静态构建和 Pagefind 搜索索引。**本地构建通过，是推送前最重要的一次检查。** 它能提前发现 frontmatter 缺字段、日期格式错误、组件类型错误等问题。

## 三、第一次部署：连接 GitHub 和 Cloudflare

第一次部署的重点不是“点一下按钮”，而是完成一次授权和构建配置。之后的自动部署依赖这次配置。

### 1. 授权并选择仓库

可以点击 GitHub README 中的 **Deploy to Cloudflare**，也可以在 Cloudflare 控制台进入：

```text
Workers & Pages → Create → Connect to Git
```

如果出现“无法获取存储库内容”或“Cloudflare Pages 无法安装在您的 GitHub/GitLab 帐户上”，通常不是代码问题，而是 GitHub App 授权状态异常。处理顺序如下：

1. 打开 GitHub：`Settings → Applications → Installed GitHub Apps`。
2. 找到 **Cloudflare Workers and Pages**，确认它能访问 `yanxuwei666/my-blog`。
3. 如果存在旧的、失效的安装记录，先完全卸载，再从 Cloudflare 重新连接 GitHub。
4. 回到 Cloudflare，选择仓库 `yanxuwei666/my-blog` 和生产分支 `main`。

这里要区分两个权限：GitHub 账号授权成功，不代表 Cloudflare 一定能读取目标仓库；还需要检查 GitHub App 的仓库范围是否包含当前项目。

### 2. 填写构建配置

当前项目的推荐配置如下：

| 配置项 | 值 |
| --- | --- |
| 项目名称 | `yxw-blog` |
| 生产分支 | `main` |
| 构建命令 | `npm run build` |
| 部署命令 | `npx wrangler deploy` |
| 预览命令 | `npx wrangler preview` |
| Node.js | 22，最低 20 |

项目根目录保持仓库根目录即可，不要把它改成 `src` 或 `dist`。Cloudflare 需要先读取根目录的 `package.json`，执行构建后再由 Wrangler 发布 `dist`。

仓库里的 `wrangler.jsonc` 是 Cloudflare 的项目说明文件，核心内容类似这样：

```json
{
  "name": "yxw-blog",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "404-page"
  }
}
```

其中：

- `name` 是 Worker 名称，建议与 Cloudflare 控制台的项目名称保持一致。
- `assets.directory` 指向 Astro 的构建产物 `dist`。
- `not_found_handling` 让不存在的页面落到项目自己的 404 页面。

### 3. 设置站点地址并完成第一次发布

项目会使用 `SITE_URL` 生成 canonical URL、RSS 和 sitemap。建议在 Cloudflare 项目的环境变量中设置：

```text
SITE_URL=https://你的最终域名
```

如果暂时没有自定义域名，可以先部署，拿到 `workers.dev` 地址后再补上。例如：

```text
SITE_URL=https://yxw-blog.你的账号子域名.workers.dev
```

不设置也能构建成功，但项目会回退到 `https://example.com`，这会让 RSS、站点地图和搜索引擎收录链接不准确。设置变量后需要重新部署一次。

点击部署后，Cloudflare 会完成这几步：

```text
读取 GitHub 源码
    → 安装 npm 依赖
    → 执行 npm run build
    → 执行 npx wrangler deploy
    → 发布 dist 到 Worker
```

部署完成后，在 Worker 的“域和路由”区域启用 `workers.dev`，或者添加自己的域名。没有访问地址不代表构建失败，很多时候只是还没有启用 `workers.dev` 或绑定自定义域。

## 四、以后发布：只需要推送代码

### 本地写作的发布方式

第一次 Cloudflare 项目创建成功后，不需要每次再点击 README 中的 **Deploy to Cloudflare**。日常发布只需要：

```bash
npm run dev
npm run build
git add .
git commit -m "docs: update post"
git push origin main
```

Cloudflare Workers Builds 监听 `main` 分支，收到新提交后会自动执行构建和部署：

```text
git push origin main
    → GitHub 产生新提交
    → Cloudflare 检测到 main 分支变化
    → npm run build
    → npx wrangler deploy
    → 线上网站更新
```

所以“Deploy to Cloudflare”是第一次初始化入口，`git push` 才是后续日常发布入口。重复点击部署按钮可能重新走仓库选择和项目初始化流程，没有必要。

### GitHub Issue 写作的发布方式

如果不想在本地写 Markdown，也可以把 Issue 当作简易写作后台：

1. 在仓库中新建 Issue。
2. 用标题作为文章标题，正文使用 Markdown。
3. 添加 `blog` 标签。
4. 等待 `.github/workflows/sync-issues.yml` 执行。

工作流会把 Issue 转成 `src/content/blog/文章文件名.md`，自动提交到 `main`。这个提交进入 `main` 后，Cloudflare 仍然按照同一套流程重新构建和部署。如果想立即处理，可以在 GitHub 的 `Actions → Sync Issues → Run workflow` 手动运行。

两种发布入口可以这样理解：

| 写作入口 | 谁产生 Git 提交 | 后续部署 |
| --- | --- | --- |
| 本地 Markdown | 你执行 `git commit` 和 `git push` | Cloudflare 自动部署 |
| GitHub Issue | GitHub Actions 自动提交 | Cloudflare 自动部署 |

## 五、按链路排查常见问题

遇到问题时，先判断它发生在哪个节点，不要一上来反复点击部署按钮：

| 现象 | 所在环节 | 处理方式 |
| --- | --- | --- |
| 无法获取存储库内容 | GitHub 授权 | 卸载旧的 Cloudflare GitHub App，再重新安装，并确认仓库权限 |
| 构建找不到文件 | 仓库或分支 | 确认仓库是 `yanxuwei666/my-blog`，分支是 `main`，根目录没有填错 |
| 构建失败 | Astro 或文章内容 | 在本地运行 `npm run build`，先修复第一条错误 |
| 推送后没有新部署 | Cloudflare 触发器 | 检查 GitHub 集成是否仍连接、生产分支是否为 `main` |
| 部署成功但没有网址 | Worker 路由 | 开启 `workers.dev`，或在“域和路由”中添加自定义域 |
| 链接指向 `example.com` | 站点地址配置 | 设置 `SITE_URL`，然后重新部署 |
| Issue 没有变成文章 | GitHub Actions | 检查是否添加 `blog` 标签，并查看 Actions 日志 |

判断部署是否真的成功，可以按这个顺序检查：

```text
1. Cloudflare 是否产生了新的部署版本？
2. 部署日志中的 npm run build 是否通过？
3. Worker 是否启用了 workers.dev 或绑定域名？
4. 浏览器访问的是否是最新域名和最新路径？
```

## 六、日常只记住这一套操作

本地写文章时：

```bash
npm run dev       # 边写边预览
npm run build     # 发布前检查
git add .
git commit -m "docs: update post"
git push origin main
```

GitHub 写文章时：

```text
新建 Issue → 写 Markdown → 添加 blog 标签 → 等待 Actions 同步 → Cloudflare 自动部署
```

第一次部署时：

```text
授权 GitHub → 选择仓库和 main → 填写构建配置 → 设置 SITE_URL → 部署一次
```

最重要的结论只有一句：**第一次部署需要完成 Cloudflare 项目初始化，后续更新只要让新提交进入 GitHub 的 `main` 分支，Cloudflare 就会自动发布。**
