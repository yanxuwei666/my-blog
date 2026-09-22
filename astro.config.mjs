// @ts-check
import { defineConfig, svgoOptimizer } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import pagefind from "astro-pagefind";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// SITE_URL drives canonical URLs, RSS links and sitemap entries.
// Cloudflare cannot guess the deployed domain at build time, so fall back to a
// placeholder and shout about it instead of silently shipping wrong URLs.
const site = process.env.SITE_URL || "https://example.com";

if (!process.env.SITE_URL) {
  console.warn(
    "\n[issue-blog] SITE_URL is not set. Falling back to https://example.com.\n" +
      "             Set SITE_URL (e.g. https://blog.example.com) so canonical URLs,\n" +
      "             RSS and sitemap-index.xml point at your real domain.\n"
  );
}

export default defineConfig({
  site,
  output: "static",
  markdown: {
    shikiConfig: {
      themes: {
        light: "one-dark-pro",
        dark: "one-dark-pro",
      },
      defaultColor: false,
    },
  },
  devToolbar: {
    enabled: false,
  },
  integrations: [
    mdx(),
    sitemap(),
    pagefind({
      indexConfig: {
        forceLanguage: "zh",
        includeCharacters: "-_+#.?:",
      },
    }),
  ],
  i18n: {
    locales: ["zh-CN"],
    defaultLocale: "zh-CN",
    routing: {
      prefixDefaultLocale: false,
    },
  },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      rollupOptions: {
        external: [/^\/pagefind\//],
      },
    },
  },
  experimental: {
    svgOptimizer: svgoOptimizer(),
  },
});
