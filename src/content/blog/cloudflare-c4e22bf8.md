---
title: "【折腾记】用 Cloudflare 部署博客并绑定个人域名"
description: "上大学那会儿，就一直想有个自己的博客网站。最开始在 CSDN 上写，后来搬到博客园，再后来又开始折腾 Hexo、Hugo 这些工具配合 GitHub 搭来搭去。结果呢，文档没写出几篇有用的，博客倒是搭了一版又一版，每次都是推到一半就搁下了。"
pubDate: 2026-10-08
category: ""
tags: ["Cloudflare", "个人博客", "网站部署", "域名解析"]
draft: false
source: "siyuan"
siyuanId: "20261008093807-5p5eywf"
slug: "cloudflare-c4e22bf8"
sourceHash: "sha256:8bf11a43d6ecc0f3a9449fb1a984b8a680ee40a7d1021f4681b6038cc23abfd1"
---
## **前言**

上大学那会儿，就一直想有个自己的博客网站。最开始在 CSDN 上写，后来搬到博客园，再后来又开始折腾 Hexo、Hugo 这些工具配合 GitHub 搭来搭去。结果呢，文档没写出几篇有用的，博客倒是搭了一版又一版，每次都是推到一半就搁下了。

直到最近才偶然发现，其实可以直接拿一份现成的博客项目，用 AI 稍微改改，部署到 Cloudflare 上，再挂一个自己的域名，整个过程比我以前折腾的每一次都轻松，反而就这么搭起来了。

后续我打算继续用思源笔记写文档，再开发一个插件，把指定文件夹里的内容自动同步到 GitHub 仓库，让它自动部署。这样一来，写和发就彻底分开了，剩下的交给自动化。

这篇主要记录整个过程——从本地把博客搭起来，到部署上 Cloudflare Pages，再到绑定自己的域名。中间踩的坑也一并写上，希望能帮到同样想折腾的人。

先看成品：

![image](/images/blog/cloudflare-c4e22bf8/image-20261008112832-k5jdumg.png)

## 方案概述

这次用的是一份 Astro 静态博客项目：先在本地改好，再推到 GitHub。Cloudflare Workers 从仓库构建并发布静态文件，最后通过自己的域名访问。站点不需要后台或数据库，也不用单独租服务器。

结构大概是这样的：

```text
博客项目（本地）
      ↓
GitHub（存代码和文章）
      ↓
Cloudflare Workers（构建并托管静态站点）
      ↓
个人域名（访问入口）
```

博客代码和文章都在 GitHub。仓库有新提交时，Cloudflare Workers 会自动构建并部署，成功后可以用 workers.dev 地址或自己的域名访问。

选 Cloudflare 主要是因为部署流程短：代码推到 GitHub 后会自动构建，HTTPS 和代理也由 Cloudflare 处理。这次先用免费方案；如果流量或资源用量增加，再按当前额度和价格评估。

## **准备工作**

动手前先准备域名、GitHub 账号和本地开发环境。这次没有单独租服务器，确定的开销是域名续费；Cloudflare 免费计划有额度限制，使用时以当前说明为准。

- 一个域名：在哪家注册都可以。我在腾讯云买了 yanxuwei.com；后面只把 DNS nameserver 改到 Cloudflare，不需要转移注册商。
- 一个 GitHub 账号：用来存博客代码和文章。
- 一个 Cloudflare 账号：用来构建、部署站点和管理接入后的 DNS。
- 本地环境：Node.js 22（仓库通过 .node-version 指定）和 Git。
- 一个博客项目：本文以基于 Astro 的 my-blog 仓库为例。

## **第一步：搭建本地博客**

我用的是 [Issue Blog](https://github.com/raclen/issue-blog) 的一个 fork：[yanxuwei666/my-blog](https://github.com/yanxuwei666/my-blog)。它基于 Astro，平时在 GitHub Issue 里写文章；给 Issue 加上 ​`blog` 标签后，GitHub Actions 会把文章同步成仓库里的 Markdown，再由 Cloudflare Workers 构建和部署。文章会保存在 Git 仓库中，不只留在 Issues 里。刚 fork 时，记得到仓库的 Actions 页面启用一次 Sync Issues 工作流。

和我以前用 Hexo、Hugo 的方式相比，这个项目的写作入口是 GitHub Issue，文章会自动同步到仓库，再触发部署。本文只记录这个 Astro 项目的实际流程。

先把项目在本地跑起来，确认页面正常后再部署：

1、克隆仓库：​`git clone https://github.com/yanxuwei666/my-blog.git`。这是我基于上游模板改的版本，增加了分类和时间轴。

2、安装依赖：​`npm install`。

3、启动本地开发服务：​`npm run dev`。

4、浏览器打开 ​`http://localhost:4321`，确认首页能正常显示。

![image](/images/blog/cloudflare-c4e22bf8/image-20261008142444-fgt4o0t.png)

我没有花太多时间研究项目结构，主要改了几处样式；这些调整先让 AI 帮我试，再按自己的需要挑着改。

## 第二步：部署到 Cloudflare Workers

下面按这次使用的控制台流程整理。菜单名称可能会调整，构建和部署命令以仓库 README 为准。

1、登录 Cloudflare，进入“Workers 和 Pages”，选择“创建应用程序”。

![image](/images/blog/cloudflare-c4e22bf8/image-20261008144138-eqz5zq9.png)

2、选择“导入仓库”或“连接 GitHub”，按提示授权 Cloudflare 访问 GitHub。

![image](/images/blog/cloudflare-c4e22bf8/image-20261008144311-1s2485g.png)

3、选择博客仓库 ​`yanxuwei666/my-blog`。

![image](/images/blog/cloudflare-c4e22bf8/image-20261008144400-5xphdtj.png)

4、项目名设为 ​`yxw-blog`​。构建命令填 ​`npm run build`​，部署命令填 ​`npx wrangler deploy`​；仓库使用 Node.js 22，静态文件目录已在 ​`wrangler.jsonc`​ 中设为 ​`./dist`​。在构建环境变量中设置 ​`SITE_URL=https://blog.yanxuwei.com`，让 canonical、RSS 和 sitemap 使用正式域名，然后保存并部署。

![image](/images/blog/cloudflare-c4e22bf8/image-20261008144518-l2t5p4a.png)

5、部署成功后，Worker 会提供一个 ​`workers.dev`​ 地址。本次地址是 ​`https://yxw-blog.1076372957.workers.dev/`。

![image](/images/blog/cloudflare-c4e22bf8/image-20261008144715-63vee8l.png)

6、打开 ​`https://yxw-blog.1076372957.workers.dev/`，确认博客首页可以访问。

![image](/images/blog/cloudflare-c4e22bf8/image-20261008144859-jqccvy1.png)

之后把代码推送到 GitHub，Cloudflare 会自动构建并部署新版本。用 GitHub Issue 发文章时，Sync Issues 工作流会先把内容写回仓库，再触发部署。

## **第三步：绑定个人域名**

### 在云平台上购买域名

我在腾讯云购买了 yanxuwei.com，注册商和续费仍留在腾讯云。接下来先把域名接入 Cloudflare，再将 Cloudflare 分配的 nameserver 填回腾讯云。

![image](/images/blog/cloudflare-c4e22bf8/image-20261008145751-i54f77u.png)

### 在 Cloudflare 添加根域名区域

1、登录 Cloudflare，在域名管理中选择“添加/接入域名”。

![image](/images/blog/cloudflare-c4e22bf8/image-20261008151601-avweboy.png)

2、选择连接现有域名。

![image](/images/blog/cloudflare-c4e22bf8/image-20261008151908-u7uj4n0.png)

3、输入 ​`yanxuwei.com`，按提示继续。

![image](/images/blog/cloudflare-c4e22bf8/image-20261008151934-wcqvmpi.png)

4、选择 Free 计划并扫描现有 DNS 记录。完成接入向导后，记下 Cloudflare 分配的两条 nameserver；下一节会在腾讯云填入它们。等区域激活后，再添加博客子域名记录。

![image](/images/blog/cloudflare-c4e22bf8/image-20261008152022-o9364uu.png)

5、核对扫描结果。新购域名可能显示 0 条记录；如果接入向导要求先有解析记录，这次临时添加了开启代理的 A 记录 ​`@ → 192.0.2.0`。

![image](/images/blog/cloudflare-c4e22bf8/image-20261008152343-w2btqdd.png)

`192.0.2.0`​ 是文档和示例保留地址，不是网站源站。本次把它当占位记录；根域名要提供网站时换成服务商给出的真实地址，不用根域名时可在 ​`blog`​ 记录建立后移除它。Route 没有真实源站时，Cloudflare 当前最佳实践建议使用开启代理的 ​`AAAA`​ 记录指向 ​`100::`​，见 [Workers 最佳实践](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)。

首次接入时出现的 AI 搜索/爬虫选项与 Worker 部署无关，按自己的偏好选择即可。

### 在腾讯云把 nameserver 改为 Cloudflare

这一步把 yanxuwei.com 的权威 DNS 解析从腾讯云切到 Cloudflare，不会转移域名注册商。

- 域名的 NS 指向哪个服务商，权威 DNS 解析就由哪个服务商管理。
- 修改前，yanxuwei.com 使用腾讯云 DNSPod 的 nameserver：​`boyd.dnspod.net`​、​`thick.dnspod.net`。
- Cloudflare 为这个域名分配的 nameserver 是 ​`cody.ns.cloudflare.com`​ 和 ​`susan.ns.cloudflare.com`；其他域名应填写 Cloudflare 实际分配的地址。

等 Cloudflare 分配好 nameserver 后，再回腾讯云修改 DNS 服务器。注册商仍是腾讯云，这一步只切换 DNS 管理权，不是转移域名。

1、在腾讯云域名详情中，点击“更多”下的“修改 DNS 服务器”。

![image](/images/blog/cloudflare-c4e22bf8/image-20261008150721-tfdkv4y.png)

2、选择“使用非腾讯云 DNS”，填入 Cloudflare 分配给 yanxuwei.com 的两条 nameserver（本次为 ​`cody.ns.cloudflare.com`​ 和 ​`susan.ns.cloudflare.com`）。

![image](/images/blog/cloudflare-c4e22bf8/image-20261008150752-sexw5bs.png)

保存后等待 Cloudflare 将域名状态更新为 Active；DNS 变更生效可能需要一些时间。

### 在 Cloudflare 为博客子域名添加 DNS 记录

等 Cloudflare 区域激活后，进入 ​`yanxuwei.com` 的 DNS 记录页面，添加博客子域名记录：

![image](/images/blog/cloudflare-c4e22bf8/image-20261008152641-s5d5175.png)

名称填 ​`blog`​，Cloudflare 会显示为 ​`blog.yanxuwei.com`​。本次实际用的是开启代理的 A 记录 ​`blog → 192.0.2.0`​，仅作占位，不是网站源站。若按 Worker Route 配置且没有真实源站，Cloudflare 当前建议使用代理 AAAA 记录 ​`blog → 100::`；Worker 自己就是源站时，直接用 Worker Custom Domain 更合适，通常不需要手动添加占位记录。

如果 ​`blog` 已有冲突的 CNAME 或 A/AAAA 记录，先检查并删除冲突项；同一主机名只保留当前方案需要的记录。

添加 Worker Route（本次使用方式）

1、在 Cloudflare 的 ​`yanxuwei.com`​ 域名区域左侧进入 Workers 路由。本次通过 Route 绑定并验证成功。Worker 自己提供网站内容时，Cloudflare 建议配置 Custom Domain；Route 通常用于让 Worker 在已有源站前处理请求，说明见 [Cloudflare 文档](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)。

![image](/images/blog/cloudflare-c4e22bf8/image-20261008152750-l3gbafu.png)

2、点击“添加路由”，路由填写 ​`blog.yanxuwei.com/*`​，Worker 选择 ​`yxw-blog`。

![image](/images/blog/cloudflare-c4e22bf8/image-20261008152832-58wertt.png)

3、保存后确认路由列表出现 ​`blog.yanxuwei.com/* → yxw-blog`。

- `/*` 使博客子域名下的首页、文章路径和静态资源路径都匹配同一个 Worker。
- 不要把模式写成 ​`yanxuwei.com/*`​，否则会匹配根域名；也不要漏掉 ​`/*`，否则可能不能覆盖所有路径。

![image](/images/blog/cloudflare-c4e22bf8/image-20261008152918-9yc4fk1.png)

### 访问验证

浏览器打开 ​`https://blog.yanxuwei.com`，确认博客首页能加载且 HTTPS 没有证书错误。本次访问成功，说明 DNS、代理、Route 和 Worker 的链路已跑通。

![image](/images/blog/cloudflare-c4e22bf8/image-20261008153021-repqli9.png)

也可以在终端查看解析和 HTTP 响应：

```bash
dig +short blog.yanxuwei.com
curl -I https://blog.yanxuwei.com/
```

开启代理后，​`dig`​ 通常返回 Cloudflare 的代理 IP，不一定显示 DNS 记录里配置的占位地址。​`curl -I` 应返回 HTTP 响应；再用浏览器确认页面内容和样式正常。

## 第四步：用思源编写文档并同步

为了方便个人编写文档及同步，我在自己常用的思源笔记上开发了一个同步插件，可以将思源指定的笔记本下面的一些博客批量上传到本地的 Github 仓库中，并且可以指定分类。

1、我的插件配置页面如下：

![image](/images/blog/cloudflare-c4e22bf8/image-20261008155643-ljrus03.png)

2、配置好之后，点击插件选择要发布的文档，直接同步。

![image](/images/blog/cloudflare-c4e22bf8/image-20261008155805-yx6vrza.png)

## **踩坑记录**

### 我需要把域名从腾讯云转移到 Cloudflare 吗？

不需要。腾讯云仍是域名注册商，负责续费；更换的是 DNS nameserver。只有要把注册商也换掉时，才需要办理域名转移。

### 为什么 Cloudflare 扫描到 0 条 DNS 记录？

新购域名可能还没有网站或邮箱的 DNS 记录，因此扫描结果会是 0 条。若 Cloudflare 接入向导要求先添加记录，可按上文添加临时占位记录；不要把占位地址当成真实源站。

## **总结与后续**

- 完整流程：准备博客仓库 → Cloudflare Workers 连接 GitHub → 部署验证 → 接入域名并配置 DNS。
- 这次没有单独租服务器，实际支出是域名费用；Cloudflare 的额度和价格以部署时的官方说明为准。
- 后续想把思源里的文章同步到 GitHub，再自动部署；也可以补上访问统计和搜索引擎收录配置。
- 个人博客可以先把写作和发布流程跑通，再按实际需要补功能，不必一开始就把所有东西配齐。

‍
