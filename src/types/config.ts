interface NavItem {
  /** Menu label shown in the top navigation bar */
  title: string;
  /**
   * Target of the menu item. Leave it empty to keep the label as a placeholder
   * that does not navigate — use that for pages that have no content yet.
   * A leading "/" is resolved against the deploy base, so "/archives" becomes
   * "/blog/archives" when the blog is served under a "/blog" base. Any other
   * value (e.g. "https://example.com/about/") is used as-is.
   */
  href: string;
}

interface SiteConfig {
  /** Deployed URL of the site, e.g. "https://example.com" */
  url: string;
  /** Blog title shown in header and meta tags */
  title: string;
  /** Short description used in SEO meta and RSS feed */
  description: string;
  /** Default post author name */
  author: string;
  /** Author bio / motto displayed on profile card */
  authorBio?: string;
  /** Author avatar URL or local image path */
  authorAvatar?: string;
  /** Author profile URL (used in structured data and profile links) */
  profile?: string;
  /** Fallback OG image filename in /public, e.g. "og.jpg" */
  ogImage?: string;
  /** HTML lang attribute, defaults to "en" */
  lang?: string;
  /** IANA timezone for post dates, e.g. "Asia/Bangkok" */
  timezone?: string;
  /** Text direction */
  dir?: "ltr" | "rtl" | "auto";
  /** Top navigation entries. Defaults to 首页 / 归档 / 标签. */
  nav?: NavItem[];
  /**
   * Max width of the page shell (header, content and footer share it).
   * Defaults to "100%", which fills the browser window.
   * Use a fixed value such as "90rem" to keep the site centred on very wide screens.
   */
  pageWidth?: string;
  /** Google Search Console verification meta tag value */
  googleVerification?: string;
}

interface PostsConfig {
  /** Posts per page on paginated listing pages */
  perPage?: number;
  /** Posts shown on the index/home page */
  perIndex?: number;
  /**
   * Scheduled posts within this window (ms) of their pubDatetime
   * are shown as published. Defaults to 15 minutes.
   */
  scheduledPostMargin?: number;
}

interface FeaturesConfig {
  /** Enable light/dark mode toggle. Defaults to true. */
  lightAndDarkMode?: boolean;
  /**
   * Generate dynamic OG images per post and provide `/og.png` when the static
   * `public/{site.ogImage}` file is absent. When false, that file is required
   * for the default layout OG image (build fails if missing).
   */
  dynamicOgImage?: boolean;
  /** Show the /archives page and link it in nav. Defaults to true. */
  showArchives?: boolean;
  /** Show back button on post detail pages. Defaults to true. */
  showBackButton?: boolean;
  /** "Edit page" link shown on post detail pages. */
  editPost?:
    | {
        enabled: true;
        /** Base URL for the edit link, e.g. GitHub edit URL */
        url: string;
      }
    | { enabled: false };
  /**
   * Search provider. "pagefind" ships in the base template.
   * Set to false to disable search entirely.
   */
  search?: "pagefind" | false;
}

interface SocialLink {
  /**
   * Must match an SVG filename in src/assets/icons/socials/.
   * e.g. "github" → src/assets/icons/socials/github.svg
   */
  name: string;
  url: string;
  /**
   * Accessible label for the icon link (aria-label, title attribute).
   * Auto-generated if omitted: "{site.title} on GitHub", "Send an email to {site.title}", etc.
   * Override when the default wording doesn't fit.
   */
  linkTitle?: string;
}

interface ShareLink {
  /**
   * Must match an SVG filename in src/assets/icons/socials/.
   * e.g. "facebook" → src/assets/icons/socials/facebook.svg
   */
  name: string;
  /** Base share URL. The post URL will be appended as a query param. */
  url: string;
  /**
   * Accessible label for the icon link (aria-label, title attribute).
   * Auto-generated if omitted: "Share this post on Facebook", "Share this post via WhatsApp", etc.
   * Override when the default wording doesn't fit.
   */
  linkTitle?: string;
}

type GiscusMapping =
  | "pathname"
  | "url"
  | "title"
  | "og:title"
  | "specific"
  | "number";

type CommentsConfig =
  | { enabled: false }
  | {
      enabled: true;
      provider: "giscus";
      /** GitHub repository in owner/name form, e.g. "owner/repository" */
      repo: string;
      /** Repository GraphQL node id from giscus.app */
      repoId: string;
      /** GitHub Discussions category name */
      category: string;
      /** Discussion category GraphQL node id from giscus.app */
      categoryId: string;
      mapping?: GiscusMapping;
      strict?: "0" | "1";
      reactionsEnabled?: boolean;
      emitMetadata?: boolean;
      inputPosition?: "top" | "bottom";
      theme?: string;
      lang?: string;
    };

interface AstroPaperConfig {
  site: SiteConfig;
  posts?: PostsConfig;
  features?: FeaturesConfig;
  /** Social profile links shown in header/footer */
  socials?: SocialLink[];
  /** Share links shown on post detail pages */
  shareLinks?: ShareLink[];
  /** Optional post comments integration. */
  comments?: CommentsConfig;
}

type ResolvedSiteConfig = Required<
  Pick<
    SiteConfig,
    | "url"
    | "title"
    | "description"
    | "author"
    | "lang"
    | "timezone"
    | "dir"
    | "ogImage"
    | "nav"
    | "pageWidth"
  >
> &
  Pick<
    SiteConfig,
    "profile" | "authorBio" | "authorAvatar" | "googleVerification"
  >;

export interface ResolvedAstroPaperConfig {
  site: ResolvedSiteConfig;
  posts: Required<PostsConfig>;
  features: Required<FeaturesConfig>;
  socials: SocialLink[];
  shareLinks: ShareLink[];
  comments: CommentsConfig;
}

/**
 * Type helper for astro-paper.config.ts.
 * Provides full IntelliSense without any runtime overhead.
 */
export function defineAstroPaperConfig(
  config: AstroPaperConfig
): AstroPaperConfig {
  return config;
}
