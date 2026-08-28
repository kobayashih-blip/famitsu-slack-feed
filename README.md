# ファミ通ニュース → Slack 自動通知

`https://www.famitsu.com/category/news/page/1` からニュース記事を10分ごとに確認し、Slack Incoming Webhookへ新着だけを通知します。同時に `feed.xml` も生成します。

## 漏れ・重複を抑える仕組み

- 先頭だけでなく10ページ（通常約500件）を毎回確認するため、一時停止やGitHub Actionsの遅延があっても追いつけます。
- 記事URLを `data/seen.json` に永続化し、同じ記事を二重通知しません。
- Slack送信に成功した記事だけを既読にします。通信失敗時は次回再送するため、重複の可能性より取りこぼし防止を優先しています。
- 429/5xxエラーは自動でリトライし、通知は10件ずつまとめてSlackの制限を避けます。
- 初回実行は既存記事を通知せず既読登録だけ行います。

## 導入手順（GitHub Actions）

1. このフォルダをGitHubリポジトリへpushします。
2. SlackでIncoming Webhookを作成し、通知先チャンネルを選びます。
3. GitHubリポジトリの **Settings → Secrets and variables → Actions → New repository secret** で、名前 `SLACK_WEBHOOK_URL`、値にWebhook URLを登録します。
4. **Actions → Famitsu news to Slack → Run workflow** を一度実行します。初回は既存記事を通知せず、基準点だけを作ります。
5. 以後は10分ごとに自動実行されます。

初回から現在の記事も通知したい場合のみ、手動実行時に「初回でも既存記事を通知する」をオンにしてください。大量通知になるため通常はオフを推奨します。

## ローカル確認

Node.js 20以降で実行します。

```sh
npm test
node scripts/famitsu-slack-feed.mjs
```

ローカルから実際に通知する場合は `SLACK_WEBHOOK_URL` を環境変数に設定してください。Webhook URLはファイルへ書かないでください。

## 運用上の注意

- `data/seen.json` と `feed.xml` の更新コミットが自動で作成されます。ブランチ保護を使う場合はGitHub Actionsの書き込みを許可してください。
- 10ページより長い停止に備えたい場合は、workflowの `MAX_PAGES` を増やしてください。
- GitHubの **Actions → General → Workflow permissions** は「Read and write permissions」にします。
- Famitsu側のHTML/Next.jsデータ形式が変わると処理は明示的に失敗します。静かに0件扱いにしないため、異常に気づけます。
