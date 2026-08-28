import test from "node:test";
import assert from "node:assert/strict";
import { buildRss, extractArticles, slackPayload } from "../scripts/famitsu-slack-feed.mjs";

const rows = [{ id: "12345", title: "新作 & テスト", description: "説明 <本文>", publishedAt: "2026-08-28T12:30:00+09:00", thumbnailUrl: "https://img.example/x.jpg", redirectUrl: null, mainCategory: { code: "news" } }];
const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { categoryArticleDataForPc: rows } } })}</script>`;

test("Next.jsデータからニュース記事だけを抽出する", () => {
  assert.deepEqual(extractArticles(html), [{ id: "12345", title: "新作 & テスト", description: "説明 <本文>", publishedAt: "2026-08-28T12:30:00+09:00", thumbnailUrl: "https://img.example/x.jpg", url: "https://www.famitsu.com/article/202608/12345" }]);
});

test("RSSをXMLエスケープして生成する", () => {
  const rss = buildRss(extractArticles(html), new Date("2026-08-28T00:00:00Z"));
  assert.match(rss, /新作 &amp; テスト/);
  assert.match(rss, /説明 &lt;本文&gt;/);
});

test("Slack Block Kit payloadを生成する", () => {
  const payload = slackPayload(extractArticles(html));
  assert.equal(payload.blocks[0].type, "header");
  assert.match(payload.blocks[1].text.text, /12345/);
});
