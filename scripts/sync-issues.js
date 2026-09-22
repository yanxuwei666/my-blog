import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.join(__dirname, "..");
const blogDir = path.join(rootDir, "src/content/blog");
const metaFile = path.join(blogDir, ".sync-meta.json");

const issueLabel = process.env.ISSUE_LABEL || "blog";
const issueState = process.env.ISSUE_STATE || "open";

function getIssueRepo() {
  const issueRepo = process.env.ISSUE_REPO || process.env.GITHUB_REPOSITORY;

  if (!issueRepo || !issueRepo.includes("/")) {
    throw new Error(
      "Missing issue repository. Set ISSUE_REPO=owner/repo or run inside GitHub Actions."
    );
  }

  const [owner, repo] = issueRepo.split("/");
  return { owner, repo };
}

function slugify(input) {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Script=Han}a-z0-9\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 72);

  return slug || "post";
}

function yamlString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function stripSyncMeta(body) {
  return (body || "").replace(
    /\n?<!--\s*issue-blog-meta\s*[\s\S]*?\s*-->\s*\n?/i,
    "\n"
  );
}

function extractMeta(body) {
  const match = (body || "").match(
    /<!--\s*issue-blog-meta\s*([\s\S]*?)\s*-->/i
  );

  if (!match) return {};

  return match[1].split("\n").reduce((meta, line) => {
    const item = line.match(/^\s*([A-Za-z][\w-]*)\s*:\s*(.+?)\s*$/);
    if (item) meta[item[1]] = item[2];
    return meta;
  }, {});
}

function getPublishedDate(issue) {
  const meta = extractMeta(issue.body);
  return meta.pubDate || issue.created_at;
}

function getUpdatedDate(issue) {
  const meta = extractMeta(issue.body);
  if (meta.updatedDate) return meta.updatedDate;
  if (meta.pubDate) return null;
  return issue.updated_at;
}

function filenameForIssue(issue) {
  const date = new Date(getPublishedDate(issue)).toISOString().slice(0, 10);
  const number = String(issue.number).padStart(4, "0");
  return `${date}-${number}-${slugify(issue.title)}.md`;
}

function excerpt(markdown) {
  const clean = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[[^\]]+]\([^)]+\)/g, " ")
    .replace(/[#>*_\-[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return clean.slice(0, 180);
}

function markdownForIssue(issue) {
  const body = stripSyncMeta(issue.body || "").trim();
  const meta = extractMeta(issue.body);
  const tags = issue.labels
    .map(label => label.name)
    .filter(label => label !== issueLabel);
  const category = meta.category?.trim() || "未分类";
  const updatedDate = getUpdatedDate(issue);
  const frontmatter = [
    "---",
    `title: "${yamlString(issue.title)}"`,
    excerpt(body) ? `description: "${yamlString(excerpt(body))}"` : "",
    `pubDate: ${getPublishedDate(issue)}`,
    updatedDate ? `updatedDate: ${updatedDate}` : "",
    `issueNumber: ${issue.number}`,
    `issueUrl: ${issue.html_url}`,
    `category: "${yamlString(category)}"`,
    `tags: [${tags.map(tag => `"${yamlString(tag)}"`).join(", ")}]`,
    "draft: false",
    "---",
  ].filter(Boolean);

  return `${frontmatter.join("\n")}\n\n${body}\n`;
}

async function readMeta() {
  try {
    return JSON.parse(await fs.readFile(metaFile, "utf8"));
  } catch {
    return { lastSyncTime: null, issues: {} };
  }
}

async function writeMeta(meta) {
  await fs.writeFile(metaFile, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}

async function fetchIssues() {
  const { owner, repo } = getIssueRepo();
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "issue-blog-sync",
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const issues = [];
  let page = 1;

  while (true) {
    const url = new URL(
      `https://api.github.com/repos/${owner}/${repo}/issues`
    );
    url.searchParams.set("state", issueState);
    url.searchParams.set("labels", issueLabel);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));

    console.log(`Fetching ${url.toString()}`);
    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(
        `GitHub API ${response.status}: ${await response.text()}`
      );
    }

    const pageIssues = await response.json();
    issues.push(...pageIssues.filter(issue => !issue.pull_request));

    if (pageIssues.length < 100) break;
    page += 1;
  }

  return issues;
}

export async function syncIssues() {
  await fs.mkdir(blogDir, { recursive: true });

  const meta = await readMeta();
  const issues = await fetchIssues();
  const currentIssueNumbers = new Set(issues.map(issue => String(issue.number)));
  let changed = 0;
  let removed = 0;

  for (const issue of issues) {
    const cached = meta.issues[issue.number];
    const nextFilename = filenameForIssue(issue);

    if (
      cached?.updatedAt === issue.updated_at &&
      cached.filename === nextFilename
    ) {
      continue;
    }

    if (cached?.filename && cached.filename !== nextFilename) {
      await fs.rm(path.join(blogDir, cached.filename), { force: true });
    }

    await fs.writeFile(
      path.join(blogDir, nextFilename),
      markdownForIssue(issue),
      "utf8"
    );

    meta.issues[issue.number] = {
      updatedAt: issue.updated_at,
      filename: nextFilename,
    };
    changed += 1;
    console.log(`Synced #${issue.number}: ${nextFilename}`);
  }

  for (const [issueNumber, cached] of Object.entries(meta.issues)) {
    if (!currentIssueNumbers.has(issueNumber)) {
      await fs.rm(path.join(blogDir, cached.filename), { force: true });
      delete meta.issues[issueNumber];
      removed += 1;
      console.log(`Removed #${issueNumber}: ${cached.filename}`);
    }
  }

  meta.lastSyncTime = new Date().toISOString();
  await writeMeta(meta);

  console.log(`Done. Synced ${changed}, removed ${removed}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  syncIssues().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
