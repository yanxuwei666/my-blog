/**
 * 解析站点配置并补全默认值。
 * 请优先修改项目根目录的 astro-paper.config.ts。
 */
import userConfig from "@/astro-paper.config";
import type { ResolvedAstroPaperConfig } from "./types/config";

const DEFAULT_OG_IMAGE = "favicon.svg";

const DEFAULT_PAGE_WIDTH = "100%";

const DEFAULT_NAV = [
  { title: "首页", href: "/" },
  { title: "归档", href: "/archives" },
  { title: "标签", href: "/tags" },
];

const commentsConfig = userConfig.comments?.enabled
  ? {
      ...userConfig.comments,
      provider: userConfig.comments.provider ?? ("giscus" as const),
      category: userConfig.comments.category ?? "General",
      mapping: userConfig.comments.mapping ?? ("url" as const),
      strict: userConfig.comments.strict ?? ("0" as const),
      reactionsEnabled: userConfig.comments.reactionsEnabled ?? true,
      emitMetadata: userConfig.comments.emitMetadata ?? false,
      inputPosition: userConfig.comments.inputPosition ?? ("top" as const),
      theme: userConfig.comments.theme ?? "light",
      lang: userConfig.comments.lang ?? "zh-CN",
    }
  : { enabled: false as const };

const config: ResolvedAstroPaperConfig = {
  site: {
    ...userConfig.site,
    authorBio: userConfig.site.authorBio,
    authorAvatar: userConfig.site.authorAvatar,
    nav: userConfig.site.nav ?? DEFAULT_NAV,
    pageWidth: userConfig.site.pageWidth ?? DEFAULT_PAGE_WIDTH,
    ogImage: userConfig.site.ogImage ?? DEFAULT_OG_IMAGE,
    lang: userConfig.site.lang ?? "zh-CN",
    timezone: userConfig.site.timezone ?? "Asia/Shanghai",
    dir: userConfig.site.dir ?? "ltr",
    googleVerification: userConfig.site.googleVerification,
  },
  posts: {
    perPage: userConfig.posts?.perPage ?? 8,
    perIndex: userConfig.posts?.perIndex ?? 8,
    scheduledPostMargin:
      userConfig.posts?.scheduledPostMargin ?? 15 * 60 * 1000,
  },
  features: {
    lightAndDarkMode: userConfig.features?.lightAndDarkMode ?? true,
    dynamicOgImage: userConfig.features?.dynamicOgImage ?? false,
    showArchives: userConfig.features?.showArchives ?? true,
    showBackButton: userConfig.features?.showBackButton ?? true,
    editPost: userConfig.features?.editPost ?? { enabled: false },
    search: userConfig.features?.search ?? "pagefind",
  },
  socials: userConfig.socials ?? [],
  shareLinks: userConfig.shareLinks ?? [],
  comments: commentsConfig,
};

export default config;
