export interface Work {
  id: string;
  name: string;
  icon?: string;
  category: string;
  headline: string;
  description: string;
  compatibility?: string;
  links: { label: string; href: string; icon: "download" | "external" }[];
  note: { title: string; description: string };
  facts: { label: string; value: string }[];
  screenshots: {
    src: string;
    alt: string;
    caption: string;
    description: string;
    width: number;
    height: number;
  }[];
}

/** 每件作品独立配置介绍、链接、展示图和补充信息，支持不同类型的项目。 */
export const works: Work[] = [
  {
    id: "menugit",
    name: "MenuGit",
    icon: "/images/works/menugit/icon.png",
    category: "macOS 应用 / 开源",
    headline: "右键，就能用 Git。",
    description: "把提交、分支和冲突处理带到 Finder。沿用系统 Git，让日常版本管理少一步切换。",
    compatibility: "macOS 13+ · Apple Silicon / Intel",
    links: [
      { label: "下载 macOS 版", href: "https://github.com/yanxuwei666/MenuGit/releases", icon: "download" },
      { label: "GitHub", href: "https://github.com/yanxuwei666/MenuGit", icon: "external" },
    ],
    note: {
      title: "让 Git 回到文件旁边。",
      description: "从文件出发完成常用操作，查看改动、管理分支，也能逐块处理合并冲突。",
    },
    facts: [
      { label: "技术栈", value: "SwiftUI · Finder Sync · Git" },
      { label: "项目形态", value: "macOS 原生应用 · 开源" },
    ],
    screenshots: [
      { src: "/images/works/menugit/commit.png", alt: "MenuGit 提交界面，左侧选择文件，右侧查看代码差异，下方填写提交说明", caption: "提交与差异", description: "看清每个文件的改动，再决定提交什么。", width: 1640, height: 1280 },
      { src: "/images/works/menugit/branches.png", alt: "MenuGit 分支管理界面，列出本地与远程分支，并支持创建和切换分支", caption: "分支管理", description: "本地和远程分支，一处查看与切换。", width: 1440, height: 1080 },
      { src: "/images/works/menugit/conflicts.png", alt: "MenuGit 冲突处理界面，左侧列出冲突文件，右侧逐块选择本地或传入的内容", caption: "冲突处理", description: "逐块比较和选择，把合并冲突看清楚。", width: 2440, height: 1520 },
      { src: "/images/works/menugit/welcome.png", alt: "MenuGit 欢迎界面，提供打开、新建、克隆和最近使用的仓库入口", caption: "仓库入口", description: "打开最近的仓库，或从创建、克隆开始。", width: 980, height: 1240 },
    ],
  },
];
