import { defineAstroPaperConfig } from "./src/types/config";

export default defineAstroPaperConfig({
  site: {
    url: process.env.SITE_URL || "https://example.com",
    title: "个人博客",
    description: "A Cloudflare-deployable blog powered by GitHub Issues.",
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
      { title: "归档", href: "/archives" },
      { title: "友链", href: "/links" },
      { title: "关于", href: "/about" },
    ],
    // 页面主容器宽度撑满视口，仅保留两侧留白（--page-gutter）。
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
