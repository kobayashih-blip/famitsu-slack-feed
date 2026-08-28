#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = "https://www.famitsu.com";
const DEFAULT_STATE = "data/seen.json";
const USER_AGENT = "FamitsuNewsSlackFeed/1.0 (+https://github.com/)";

export function parseNextData(html) {
  const marker = 'id="__NEXT_DATA__"';
  const markerAt = html.indexOf(marker);
  if (markerAt < 0) throw new Error("Famitsuの __NEXT_DATA__ が見つかりません");
  const start = html.indexOf(">", markerAt) + 1;
  const end = html.indexOf("</script>", start);
  if (start === 0 || end < 0) throw new Error("Famitsuのページデータを読み取れません");
  return JSON.parse(html.slice(start, end));
}

export function extractArticles(html) {
  const pageProps = parseNextData(html)?.props?.pageProps;
  const rows = pageProps?.categoryArticleDataForPc ?? pageProps?.categoryArticleDataForSp;
  if (!Array.isArray(rows)) throw new Error("ニュース記事一覧の形式が変わっています");

  const unique = new Map();
  for (const row of rows) {
    if (!row?.id || !row?.title || row?.mainCategory?.code !== "news") continue;
    const url = row.redirectUrl || `${BASE_URL}/article/${String(row.publishedAt).slice(0, 7).replace("-", "")}/${row.id}`;
    unique.set(url, {
      id: String(row.id),
      title: String(row.title).trim(),
      description: String(row.description ?? "").trim(),
      publishedAt: String(row.publishedAt ?? ""),
      thumbnailUrl: String(row.thumbnailUrl ?? ""),
      url
    });
  }
  return [...unique.values()];
}

async function fetchWithRetry(url, options = {}, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: { "user-agent": USER_AGENT, ...options.headers },
        signal: AbortSignal.timeout(30_000)
      });
      if (response.ok) return response;
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable) throw new Error(`${url}: HTTP ${response.status}`);
      const retryAfter = Number(response.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : attempt * 2000);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(attempt * 2000);
    }
  }
  throw lastError ?? new Error(`${url}: 取得に失敗しました`);
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function collectArticles(maxPages) {
  const articles = new Map();
  for (let page = 1; page <= maxPages; page += 1) {
    const url = `${BASE_URL}/category/news/page/${page}`;
    const response = await fetchWithRetry(url);
    const rows = extractArticles(await response.text());
    if (rows.length === 0) break;
    for (const article of rows) articles.set(article.url, article);
  }
  return [...articles.values()].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
}

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function buildRss(articles, generatedAt) {
  // 新着がない実行ではRSSを変化させない。毎回現在時刻を使うと、
  // GitHub Actionsが10分ごとに不要な状態コミットを作ってしまう。
  const latestPublishedAt = [...articles].map((article) => article.publishedAt).sort().at(-1);
  const buildDate = generatedAt ?? new Date(latestPublishedAt);
  const items = [...articles].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 100).map((article) => `    <item>
      <title>${escapeXml(article.title)}</title>
      <link>${escapeXml(article.url)}</link>
      <guid isPermaLink="true">${escapeXml(article.url)}</guid>
      <pubDate>${new Date(article.publishedAt).toUTCString()}</pubDate>
      <description>${escapeXml(article.description)}</description>
    </item>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>ファミ通.com ニュース</title>
    <link>${BASE_URL}/category/news/page/1</link>
    <description>ファミ通.com /news カテゴリの非公式フィード</description>
    <language>ja</language>
    <lastBuildDate>${buildDate.toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}

export function slackPayload(articles) {
  const blocks = [{
    type: "header",
    text: { type: "plain_text", text: `ファミ通.com 新着ニュース（${articles.length}件）`, emoji: true }
  }];
  for (const article of articles) {
    const description = article.description.length > 180 ? `${article.description.slice(0, 177)}…` : article.description;
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*<${article.url}|${article.title.replaceAll("&", "＆").replaceAll("<", "＜").replaceAll(">", "＞")}>*${description ? `\n${description}` : ""}` },
      ...(article.thumbnailUrl ? { accessory: { type: "image", image_url: article.thumbnailUrl, alt_text: "記事画像" } } : {})
    });
    blocks.push({ type: "divider" });
  }
  return { text: `ファミ通.comの新着ニュース ${articles.length}件`, blocks };
}

async function postSlack(webhookUrl, articles) {
  const response = await fetchWithRetry(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(slackPayload(articles))
  });
  const body = await response.text();
  if (body.trim() !== "ok") throw new Error(`Slack Webhookの応答が不正です: ${body.slice(0, 200)}`);
}

async function readState(statePath) {
  try {
    const parsed = JSON.parse(await fs.readFile(statePath, "utf8"));
    return { initialized: Boolean(parsed.initialized), seen: parsed.seen ?? {} };
  } catch (error) {
    if (error.code === "ENOENT") return { initialized: false, seen: {} };
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(temporary, filePath);
}

export async function main() {
  const statePath = process.env.STATE_PATH || DEFAULT_STATE;
  const rssPath = process.env.RSS_PATH || "feed.xml";
  const maxPages = Math.max(1, Number.parseInt(process.env.MAX_PAGES || "10", 10));
  const bootstrapNotify = process.env.BOOTSTRAP_NOTIFY === "true";
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  const articles = await collectArticles(maxPages);
  if (articles.length === 0) throw new Error("記事が0件です。サイト構造の変更を確認してください");

  await fs.writeFile(rssPath, buildRss(articles));
  const state = await readState(statePath);
  const newArticles = articles.filter((article) => !state.seen[article.url]);

  if (!state.initialized && !bootstrapNotify) {
    for (const article of articles) state.seen[article.url] = article.publishedAt;
    state.initialized = true;
    await writeJsonAtomic(statePath, state);
    console.log(`初期化完了: ${articles.length}件を既読登録（Slack通知なし）`);
    return;
  }

  if (newArticles.length > 0 && !webhookUrl) throw new Error("SLACK_WEBHOOK_URL が設定されていません");
  for (let index = 0; index < newArticles.length; index += 10) {
    const batch = newArticles.slice(index, index + 10);
    await postSlack(webhookUrl, batch);
    for (const article of batch) state.seen[article.url] = article.publishedAt;
    state.initialized = true;
    await writeJsonAtomic(statePath, state);
    await sleep(1100);
  }

  const retained = Object.entries(state.seen).sort((a, b) => String(b[1]).localeCompare(String(a[1]))).slice(0, 20_000);
  state.seen = Object.fromEntries(retained);
  state.initialized = true;
  await writeJsonAtomic(statePath, state);
  console.log(`確認 ${articles.length}件 / 新着通知 ${newArticles.length}件`);
}

const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) main().catch((error) => { console.error(error); process.exitCode = 1; });
