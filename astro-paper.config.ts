import { defineAstroPaperConfig } from "./src/types/config";

export default defineAstroPaperConfig({
  site: {
    url: process.env.SITE_URL || "https://example.com",
    title: "个人博客",
    description: "记录真实工程问题、排查路径与可落地的技术方案。",
    author: "奋斗的小猴子",
    authorBio: "记录代码实践，分享成长路上的每一步",
    authorAvatar: "/images/shiba-avatar.png",
    profile: "https://github.com/yanxuwei666",
    lang: "zh-CN",
    timezone: "Asia/Shanghai",
    dir: "ltr",
    nav: [
      { title: "作品", href: "/works" },
      { title: "博客", href: "/" },
      { title: "分类", href: "/categories" },
      { title: "归档", href: "/archives" },
      { title: "友链", href: "/links" },
      { title: "关于", href: "/about" },
    ],
    // 外层随视口伸缩，只通过 page-shell 的 gutter 保留安全边界。
    pageWidth: "100%",
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
    { name: "github", url: "https://github.com/yanxuwei666/my-blog" },
  ],
  shareLinks: [],
  comments: {
    enabled: false,
  },
});
