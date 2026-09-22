/**
 * 计算 Markdown / MDX 文章的字数和估算阅读时间（分钟）
 * 支持中文和英文混合计数
 */
export interface ReadingStats {
  words: number;
  minutes: number;
  text: string;
}

export function getReadingTime(rawContent: string = ""): ReadingStats {
  // 过滤掉 Markdown 常见标记、Frontmatter、代码块标记、HTML 标签等
  const clean = rawContent
    .replace(/^---[\s\S]*?---/, "") // Frontmatter
    .replace(/```[\s\S]*?```/g, "") // 代码块
    .replace(/<\/?[a-zA-Z!][^>]*>/g, "") // HTML 标签（只匹配合法标签，避免吃掉「< 2G」这类写法）
    .replace(/[#*`~>\[\]\(\)\-_=+]/g, " ") // Markdown 标记
    .trim();

  // 匹配汉字/日韩字符
  const cjkMatches = clean.match(/[\u4e00-\u9fa5\u0800-\u4e00]/g) || [];
  const cjkCount = cjkMatches.length;

  // 匹配非 CJK 词汇（英文、数字组合）
  const nonCjk = clean.replace(/[\u4e00-\u9fa5\u0800-\u4e00]/g, " ");
  const wordMatches = nonCjk.match(/[a-zA-Z0-9_\u00C0-\u024F]+/g) || [];
  const wordCount = wordMatches.length;

  const totalWords = cjkCount + wordCount;

  // 中文阅读速度通常为 300~400 字/分，英文约 200 词/分
  const minutes = Math.max(1, Math.ceil(cjkCount / 300 + wordCount / 200));

  return {
    words: totalWords,
    minutes,
    text: `${minutes} 分钟`,
  };
}
