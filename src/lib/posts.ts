import { getCollection, type CollectionEntry } from "astro:content";
import { getRelativeLocaleUrl } from "astro:i18n";

export async function getPosts() {
  const posts = await getCollection("blog", ({ data }) => !data.draft);

  return posts.sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf()
  );
}

export function formatDate(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** 侧边栏「时间归档」和「标签云」需要的统计，所有列表页用的是同一份 */
export function getSidebarStats(posts: CollectionEntry<"blog">[]) {
  const categoryCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  const yearCounts = new Map<string, number>();

  for (const post of posts) {
    const category = post.data.category || "未分类";
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);

    for (const tag of post.data.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
    const year = post.data.pubDate.getFullYear().toString();
    yearCounts.set(year, (yearCounts.get(year) ?? 0) + 1);
  }

  const byCountThenName = <T extends { count: number }>(
    a: T,
    b: T,
    getName: (item: T) => string
  ) => b.count - a.count || getName(a).localeCompare(getName(b), "zh-CN");

  return {
    categories: Array.from(categoryCounts, ([category, count]) => ({
      category,
      count,
    })).sort((a, b) => byCountThenName(a, b, item => item.category)),
    tags: Array.from(tagCounts, ([tag, count]) => ({ tag, count })).sort((a, b) =>
      byCountThenName(a, b, item => item.tag)
    ),
    years: Array.from(yearCounts, ([year, count]) => ({ year, count })).sort(
      (a, b) => Number(b.year) - Number(a.year)
    ),
  };
}

export interface PostPager {
  data: CollectionEntry<"blog">[];
  currentPage: number;
  lastPage: number;
  total: number;
  url: { prev?: string; next?: string };
}

/**
 * 首页文章列表的分页。第 1 页在 `/`，之后是 `/page/2/`。
 * 没有用 Astro 的 paginate()，因为它只能在 getStaticPaths 里生成整条链路，
 * 而首页 `/` 需要留在 index.astro 里渲染。
 */
export function buildPostPager(
  posts: CollectionEntry<"blog">[],
  {
    pageSize,
    currentPage,
    locale,
  }: { pageSize: number; currentPage: number; locale: string }
): PostPager {
  const lastPage = Math.max(1, Math.ceil(posts.length / pageSize));
  const href = (page: number) =>
    page <= 1
      ? getRelativeLocaleUrl(locale, "")
      : getRelativeLocaleUrl(locale, `page/${page}`);

  const start = (currentPage - 1) * pageSize;

  return {
    data: posts.slice(start, start + pageSize),
    currentPage,
    lastPage,
    total: posts.length,
    url: {
      prev: currentPage > 1 ? href(currentPage - 1) : undefined,
      next: currentPage < lastPage ? href(currentPage + 1) : undefined,
    },
  };
}
