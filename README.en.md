# Issue Blog

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/yanxuwei666/my-blog)

Chinese README: [README.md](./README.md)

Issue Blog is a lightweight blog template inspired by `zone/blog`. You write posts in GitHub Issues, sync them into Markdown files, and deploy the generated site to Cloudflare with one click.

## What It Solves

Many blogging setups turn writing into infrastructure work. You end up managing a CMS, database, server, backups, permissions, and deployment just to publish a post.

Issue Blog keeps the entire publishing flow inside GitHub and static hosting.

- No CMS to maintain: GitHub Issues act as the editor and content manager.
- No database to run: posts are stored as Markdown in the repository.
- No manual publishing flow: labeling an issue can sync it automatically.
- No deployment hassle: Cloudflare serves the static site fast and cheaply.
- No lock-in: your content stays in git, so it is portable, auditable, and easy to back up.

## Product Benefits

- Low-friction writing: write directly in GitHub Issues with Markdown, images, code blocks, and comments.
- Clean history: synced posts live in `src/content/blog/`, so every change is tracked in git.
- Short publishing path: add the `blog` label and the post is ready for sync.
- Low operating cost: Astro builds a static site and Cloudflare hosts it.
- Good for individuals and small teams: personal blogs, changelogs, dev logs, and internal knowledge bases all fit well.
- Not platform-bound: the site is a normal Astro project, so you can swap themes, add search, or extend comments later.

## Highlights

- Syncs GitHub Issues into blog posts
- Uses the `blog` label to filter publishable content
- Converts other issue labels into post tags
- Supports fixed `pubDate` and `updatedDate`
- Generates post pages and RSS automatically
- Uses GitHub Actions for scheduled and event-driven sync
- Includes a Cloudflare one-click deploy button
- Supports local development, builds, and Wrangler deployment

## Deploy

Click the **Deploy to Cloudflare** button above. **No manual fork needed** — Cloudflare copies the template into your own account, creates the Worker project, and ships the first deployment for you.

| Step | What you do | Notes |
| --- | --- | --- |
| **1** | Click **Deploy to Cloudflare** | Authorize GitHub; Cloudflare creates your repository copy automatically |
| **2** | Set the `SITE_URL` environment variable | Your domain, e.g. `https://blog.example.com`. **No domain yet? Skip this step** — nothing else needs to be filled in |
| **3** | Click **Deploy** and wait 1–2 minutes | You are done when you get `https://<project>.<your-subdomain>.workers.dev` |
| **4** | Turn on post syncing (once only) | Your new repo → **Actions** → **Enable workflow** → **Sync Issues** → **Run workflow** |

That is the whole setup: open an issue in your repo, add the `blog` label, and the post is synced to Markdown and Cloudflare redeploys automatically.

- You do **not** need to create the `blog` label by hand — the workflow creates it.
- `SITE_URL` drives canonical URLs, RSS links, and the absolute entries in `sitemap-index.xml`. Deploying without it still works, but every link points at the placeholder `https://example.com` (the build log warns you). No domain yet? Deploy first, copy the `*.workers.dev` URL, set `SITE_URL` in the dashboard, then hit Redeploy once.

<details>
<summary>Build settings to check in the wizard</summary>

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Output directory | `dist` (declared by `wrangler.jsonc` → `assets.directory`) |
| Node.js | `22` (pinned in the repo via `.node-version`) |

</details>

<details>
<summary>I already forked — how do I deploy my own fork?</summary>

The button in a forked README still points at the upstream template, so clicking it makes Cloudflare copy upstream again instead of deploying your fork. Pick one:

- **Dashboard**: **Workers & Pages → Create → Connect to Git** → pick your fork → fill in the settings table above.
- **Change the button**: point the button at your own repository:

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/OWNER/REPO)
```

</details>

<details>
<summary>Build failure checklist</summary>

| Symptom | Fix |
| --- | --- |
| `Cannot find module 'wrangler'`, `pagefind`, or Vite errors | The build ran with `NODE_ENV=production`, so `npm ci` skipped devDependencies. The repo ships `.npmrc` (`include=dev`) to prevent this; with a custom build image, make sure devDependencies are installed |
| `Invalid or missing options: ... (description)` | `site.title` / `site.description` in `astro-paper.config.ts` must not be empty |
| Every link points at `example.com` | `SITE_URL` is not set — set it and redeploy |

You can also deploy from your own machine instead of the dashboard: `npm run deploy` (same as `npm run build && wrangler deploy`).

</details>

## Workflow

```text
GitHub Issue
  ↓ add the blog label
GitHub Actions
  ↓ run scripts/sync-issues.js
Markdown files
  ↓ Astro build
Cloudflare static site
```

## Writing Posts

1. Create a new issue in this repository.
2. Add the `blog` label.
3. GitHub Actions syncs on create, edit, label change, reopen, close, and delete events, and also runs on a daily schedule.
4. The sync job commits the generated Markdown to `src/content/blog/`.

Other issue labels become post tags. The `blog` label is only used as the publishing filter.

## Good Fits

- Personal tech blog
- Project changelog or weekly update
- Lightweight knowledge base
- Internal team notes
- Open source project announcements
- Converting old GitHub Issues into browsable posts

If this project helps you, please star the repo. Your support helps me keep improving the theme, sync flow, and deployment experience.

[![Star History Chart](https://api.star-history.com/svg?repos=yanxuwei666/my-blog&type=Date)](https://star-history.com/#yanxuwei666/my-blog&Date)

## Local Development

```bash
npm install          # install dependencies
npm run dev          # local dev server (http://localhost:4321)
npm run build        # build to dist/
npm run deploy       # build and deploy to Cloudflare

# sync issues from a specific repository
ISSUE_REPO=OWNER/REPO GITHUB_TOKEN=YOUR_TOKEN npm run sync:issues
```

## Issue Metadata

To pin publish dates, add this block to the issue body:

```md
<!-- issue-blog-meta
pubDate: 2026-06-27
updatedDate: 2026-06-27
category: backend-framework
-->
```

`category` is the single topic area for an article, while issue labels become multi-value `tags`. If no category is provided, the post is placed in `未分类`. If you do not add date metadata, `pubDate` defaults to the issue creation time and `updatedDate` defaults to the issue update time.

## Config

Supported environment variables:

- `ISSUE_REPO`: repository to sync, for example `OWNER/REPO`. GitHub Actions defaults to the current repository.
- `ISSUE_LABEL`: label used to select blog posts, default `blog`.
- `ISSUE_STATE`: issue state to fetch, default `open`.
- `GITHUB_TOKEN`: GitHub API token, useful for private repositories or higher rate limits.
- `SITE_URL`: site URL used during Astro builds and RSS generation.

## Project Layout

```text
issue-blog/
├── .github/
│   ├── ISSUE_TEMPLATE/blog.md
│   └── workflows/sync-issues.yml
├── scripts/sync-issues.js
├── src/
│   ├── content/blog/
│   ├── layouts/
│   ├── lib/
│   └── pages/
├── .npmrc
├── .node-version
├── astro.config.mjs
├── astro-paper.config.ts
├── wrangler.jsonc
└── README.md
```

## License

MIT
