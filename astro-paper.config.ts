import { defineAstroPaperConfig } from "./src/types/config";

export default defineAstroPaperConfig({
  site: {
    url: process.env.SITE_URL || "https://example.com",
    title: "Issue Blog",
    description: "A Cloudflare-deployable blog powered by GitHub Issues.",
    author: "raclen",
    authorBio: "用 GitHub Issues 记录思考与技术沉淀",
    profile: "https://github.com/raclen",
    lang: "zh-CN",
    timezone: "Asia/Shanghai",
    dir: "ltr",
    // href 留空的标签只占位、不跳转，等内容补上再填地址
    nav: [
      { title: "作品", href: "" },
      { title: "博客", href: "/" },
      { title: "归档", href: "/archives" },
      { title: "友链", href: "" },
      { title: "关于", href: "" },
    ],
    // 页面主容器最大宽度，页头/正文/页脚共用。归档与博客列表保持居中窄版布局。
    pageWidth: "75rem",
  },
  posts: {
    perPage: 8,
    perIndex: 8,
    scheduledPostMargin: 15 * 60 * 1000,
  },
  features: {
    lightAndDarkMode: true,
    dynamicOgImage: false,
    showArchives: true,
    showBackButton: true,
    editPost: {
      enabled: false,
    },
    search: "pagefind",
  },
  socials: [
    { name: "github", url: "https://github.com/raclen/issue-blog" },
  ],
  shareLinks: [],
  comments: {
    enabled: false,
  },
});
