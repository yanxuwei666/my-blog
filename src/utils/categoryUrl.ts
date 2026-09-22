import { slugifyStr } from "./slugify";

const categorySlugs: Record<string, string> = {
  后端框架: "backend-framework",
  前端应用: "frontend-applications",
  数据库技术: "database",
  中间件: "middleware",
  工程基础设施: "infrastructure",
  工程实践: "engineering-practice",
  未分类: "uncategorized",
};

export function getCategorySlug(category: string): string {
  return categorySlugs[category] ?? (slugifyStr(category) || encodeURIComponent(category));
}

export function getCategoryUrl(category: string): string {
  return `/categories/${getCategorySlug(category)}/`;
}
