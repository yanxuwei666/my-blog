---
title: "DeepSeek Harness"
description: "DeepSeek Harness（DSH）是 DeepSeek 开源的 Agent 运行框架。它把模型、工具、会话和界面组织在一起，可以用来处理代码、文档等任务，也可以通过插件调整工作方式。"
pubDate: 2026-10-30
category: "AI工程与智能体"
tags: ["大模型", "deepseek", "harness"]
draft: false
source: "siyuan"
siyuanId: "20261029160357-5ldzdrp"
slug: "deepseek-harness"
sourceHash: "sha256:ac606c42e091baf86978407b647a34cdecb1d5b084e7e83af792d82892e549b7"
---
## 1 前言

DeepSeek Harness（DSH）是 DeepSeek 开源的 Agent 运行框架。它把模型、工具、会话和界面组织在一起，可以用来处理代码、文档等任务，也可以通过插件调整工作方式。

## 2 DeepSeek Harness 概览

### 2.1 什么是 Harness？

模型负责生成和推理；Harness 负责组织上下文、工具调用、执行过程和权限等。二者组合后，Agent 才能在授权范围内处理实际任务。DeepSeek Harness 是运行与扩展 Agent 的框架，DeepSeek 模型只是可接入的模型之一。

例如，让 Agent 修改一个项目时，它需要先接收任务和工作区信息，再请求模型；模型可能要求读取文件或运行测试，工具执行后的结果会进入后续请求，直到本轮工作结束。查看轨迹时，可以沿着模型回复、工具参数和工具结果排查问题，而不是只看最终答案。

会话日志记录了用户消息、模型回复和工具调用等事件。一次轮次可以包含多个步骤；每个步骤围绕一次模型请求及其工具调用展开。长任务因此可能多次请求模型，费用不只取决于最终回复的字数。

### 2.2 一切皆插件

DSH 基于 Cordis 组织可组合的插件：模型接入、工具、Agent 运行逻辑和界面等能力可以通过插件组合、扩展或替换。插件的具体接口和兼容性随版本演进，开发时应以对应版本文档为准。

Cordis 的上下文用于注册服务、事件和其他能力。通过上下文注册的内容，在插件卸载时会随之清理；插件自行创建的连接等资源，则需要开发者提供清理逻辑。这个机制方便组合与替换组件，但不意味着插件造成的文件修改或外部操作都能撤销。

运行配置由 **profile**、组合包（bundle）和覆盖配置组成。profile 是一套具名的插件组合；组合包提供一组配置和代码；用户还可以用 patch 调整或新增条目。以 Web 为例，​`dsh-base`​ 提供模型、工具和持久化等基础能力，​`dsh-web-app` 在其上加入 Web 界面。

配置按顺序叠加：profile 列出的组合包、profile 自身的 ​`cordis.patch.yml`​、Harness home 下的 patch，最后是启动时通过 ​`--patch`​ 指定的覆盖层。后面的层可以覆盖前面的配置。手工修改前先备份，尤其注意对某个条目的 ​`config`​ 覆盖会替换整个配置，而不是只合并改动字段。详见[架构文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.zh.md)。

### 2.3 主要能力

- **工作区与工具**：在选定目录中读取和修改文件、执行命令、维护计划；具体工具与权限由当前配置决定。
- **模型接入**：可配置 DeepSeek，也可依文档配置其他提供方或 OpenAI 兼容端点；可用模型、认证方式和费用由提供方决定。
- **插件与技能**：通过插件扩展工具、界面与运行能力；官方页面也展示了通过创造模式开发插件。
- **任务与轨迹**：可查看执行过程、工具调用等信息；官方页面展示了自动化任务和智能体团队等实验性功能，是否可用取决于版本和配置。
- **协议与集成**：项目提供 MCP 相关能力、ACP profile 和 SDK；它们的配置与适用场景请查阅对应文档。

### 2.4 适用范围与限制

项目仍处于开发者预览阶段，插件接口和配置可能变化。评估效果时，可以选几项自己熟悉的任务，分别记录结果质量、耗时和 token 消耗；不同任务和模型的结果不宜直接比较。

## 3 DeepSeek Harness 安装与配置

### 3.1 方式一：官方桌面端

进入 [DeepSeek Harness 官网](https://www.deepseek.com/harness/) 下载并安装。目前官网提供 macOS（Apple 芯片）和 Windows（64 位）版本。桌面端使用 Electron 承载 DSH Web 应用；社区也有第三方桌面封装，下载时注意区分。

首次启动后，按界面提示登录或配置可用模型，选择工作区，再新建会话。先从只读任务开始，例如“概览这个项目并列出主要目录”，核对结果与权限后再执行修改。桌面端可通过应用菜单“管理 dsh 命令”选择性安装或移除 CLI，具体操作见[桌面端说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.zh.md)。

工作区最好指向任务实际涉及的目录。比如修复某个仓库的问题，就选择该仓库，而不是整个用户目录。可以先要求它说明修改计划和准备运行的命令，确认范围后再让它动手；完成后检查文件差异和测试结果。

关闭主窗口通常会隐藏应用并让任务继续运行；真正退出会中断运行中的任务，应用关闭期间定时任务不会运行。定时任务默认为关闭，提醒还受会话加载状态等条件影响，实际行为以安装版本的说明为准。

### 3.2 方式二：Node.js 启动 Web UI

安装满足当前发行版要求的 Node.js 后，在要作为默认文件系统位置的目录中运行官方命令。源码仓库当前声明 Node.js ≥ 24.9.0；具体 npm 发行版要求以对应版本为准。

```sh
npx @deepseek-ai/dsh web
```

默认地址为 ​`http://127.0.0.1:3080`；本机通常会自动打开浏览器。需要更换端口或不自动打开时，可运行：

```sh
npx @deepseek-ai/dsh web --port 3000 --no-open
```

首次使用 Web UI 时，在“设置 → 模型”中配置 API 密钥或其他提供方，然后添加并选择工作区。不要把密钥写入文章或提交到代码仓库。详见[用户指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/index.zh.md)。

使用公司网关或自建服务时，在模型设置中添加自定义模型 API，填写 Provider ID、基础 URL、协议、凭据和模型 ID。协议要与网关实际提供的接口一致；模型探测失败或列表为空时，可以手动填写模型 ID。Provider ID 会被会话、默认模型和凭据引用，创建后不宜随意更换。

排查模型不可用时，先检查选择的提供商、模型 ID、API 地址和协议，再检查密钥、网络及账户额度。界面显示已检测到环境变量，只说明找到了变量，并不代表密钥有效或连接成功。[模型配置指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/providers.zh.md)列出了各项设置。

### 3.3 方式三：从源码运行

源码方式适合调试或开发，先按仓库要求准备 Node.js 与 pnpm：

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm dsh web`​ 使用已构建产物；源码更新后按项目文档重新构建。更多入口及参数见 [CLI 说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/README.zh.md)。

## 4 DeepSeek Harness 插件配置

### 4.1 在界面中管理插件

当前官方桌面端提供插件管理界面。先查看官方插件列表和版本说明，再按需安装、启用或移除；界面、实验性标记和支持范围以实际版本为准。社区插件可从 [GitHub 的 dsh-plugin 主题](https://github.com/topics/dsh-plugin)查找，安装前检查来源、维护状态、权限、依赖以及与当前 DSH 版本的兼容性，不要默认将第三方插件视为必装。

### 4.2 Web profile 的命令行管理

对于 npm 启动的 Web profile，​`dsh plugin` 将包管理参数转交给 pnpm。下面的包名仅作示意，安装前应替换为已核验的插件包：

```sh
# 需要先安装或通过相应方式调用 dsh 命令
dsh plugin --profile web add <插件包名>
dsh plugin --profile web remove <插件包名>
```

Web 和 Desktop 使用不同的 profile，不能假定两者插件列表相同。npm CLI 不支持管理保留的 desktop profile；桌面端优先使用界面，或参考官方文档使用桌面端安装的命令。是否自动重载取决于配置；未启用热重载时需重启，安装后应检查插件状态。

插件管理器区分“停用”和“移除”：停用组合包会取消其配置选择，但保留已安装的依赖；移除才会删除外部组合包。profile 的变更会影响使用该 profile 的其他会话。安装成功也不等于加载成功，遇到问题应在插件页查看错误与兼容性提示。

如果插件不见了，先确认当前使用的是 Web 还是 Desktop，再检查对应 profile 的插件列表、启用状态和错误信息。配置热重载未开启时，重启后再检查；仍有问题时查看[插件管理器文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/plugin-manager/README.zh.md)。插件的 Host 代码在宿主进程内运行，不受工作区沙箱限制，因此安装前需要审查来源。

### 4.3 离线环境

不建议直接覆盖整个 ​`~/.dsh`，也不要盲目删除其目录：其中可能包含配置、凭据、会话和本机专用链接。先备份目标环境，确认 DSH、操作系统架构、插件及原生依赖版本兼容，再按插件和当前版本文档准备离线包及依赖，在隔离环境中验证。不同 profile 和包管理器布局可能变化，旧版本目录复制步骤不能保证适用。

## 5 DeepSeek Harness 插件开发

扩展前先区分已有插件、组合包和自定义插件的用途。建议从[官方插件开发指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.zh.md)开始，阅读当前版本的接口与示例；在独立工作区开发，限定权限并测试安装、启停、卸载和版本兼容性。

一个函数形式的插件可以导出 ​`apply`，由框架在加载时传入 Cordis 上下文。下面的例子只在加载时输出一行日志，用来理解入口结构：

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'hello-plugin'

export function apply(ctx: Context) {
  console.log('[hello-plugin] plugin loaded!')
}
```

要在源码环境实际加载它，还需要按教程创建 patch，并用 ​`pnpm dsh web --patch <patch 文件>` 启动。需要其他服务的插件应声明依赖；自行创建的资源要注册清理函数。插件从日志示例发展为工具时，还要考虑参数校验、失败处理和权限边界。

## 6 常见问题

### 6.1 Web 服务无法监听端口

`EACCES`​ 可能与权限、系统保留端口或安全软件有关；端口占用通常会出现 ​`EADDRINUSE`。先检查具体报错，在 Windows 可用下列命令检查 TCP 保留端口范围：

```powershell
netsh int ipv4 show excludedportrange protocol=tcp
```

优先选择可用端口启动，例如 ​`npx @deepseek-ai/dsh web --port 3000`。不要仅为释放端口而禁用 Hyper-V；这可能影响 WSL 和虚拟机。桌面端启动问题请查看其恢复与诊断说明。

### 6.2 插件安装提示构建脚本被忽略

包管理器可能要求确认依赖的安装脚本。先检查具体包、版本、来源和脚本内容，再按当前 pnpm 提示及官方文档逐项批准；不要照搬旧版白名单，也不要为未知依赖批量放行。

### 6.3 安全与数据

Agent 和插件可能执行命令、访问文件、网络或凭据。按最小权限选择工作区，先备份重要数据，审阅拟执行的高影响操作；对不可信任务优先使用隔离环境。官方明确指出沙箱与审批不能保证完全隔离，项目尚未经过安全审计。

### 6.4 参考资料

- [DeepSeek Harness 官网与桌面下载](https://www.deepseek.com/harness/)
- [项目 README 与启动说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/README.zh.md)
- [桌面端说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.zh.md)
- [CLI 与 profile 说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/README.zh.md)
- [安全说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/SAFETY.zh.md)
- [开发者文档](https://deepseek-harness.github.io/deepseek-harness/)
