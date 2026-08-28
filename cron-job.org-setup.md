# cron-job.org 設定手順

cron-job.orgからGitHub Actionsのworkflowを約10分ごとに起動します。`OWNER`、`REPOSITORY`、`BRANCH` は自分のGitHub環境に置き換えてください。

## 1. GitHubのFine-grained tokenを作る

GitHubの **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token** を開き、次のように設定します。

- Token name: `cron-job.org Famitsu feed`
- Resource owner: 対象リポジトリの所有者
- Repository access: **Only select repositories** で対象リポジトリだけを選択
- Repository permissions → Actions: **Read and write**
- Expiration: 運用方針に合わせて設定。期限を設定した場合は、期限前に交換する

生成されたtokenは再表示できないため、その場で安全に控えます。リポジトリのContents権限をtokenへ付ける必要はありません。

## 2. cron-job.orgでジョブを作る

[cron-job.org Console](https://console.cron-job.org/jobs/create) の **Create cronjob** で次を設定します。

### 基本設定

- Title: `Famitsu news to Slack`
- URL:

```text
https://api.github.com/repos/OWNER/REPOSITORY/actions/workflows/famitsu-news-to-slack.yml/dispatches
```

- Execution schedule: **Every 10 minutes**
- Timezone: `Asia/Tokyo`
- Enabled: ON

### Advanced設定

- Request method: `POST`
- Request timeout: `30 seconds` 以上
- Save responses: ON（初期確認中のみでも可）

Request headersに次の4項目を追加します。

| Header | Value |
|---|---|
| `Accept` | `application/vnd.github+json` |
| `Authorization` | `Bearer GITHUB_FINE_GRAINED_TOKEN` |
| `X-GitHub-Api-Version` | `2026-03-10` |
| `Content-Type` | `application/json` |

Request bodyには次を設定します。通常、ブランチ名は `main` です。

```json
{"ref":"BRANCH","inputs":{"notify_existing":false}}
```

Notificationsでは、少なくとも次をONにします。

- On failure
- When disabled
- Failure count: `1`

## 3. 接続テスト

1. cron-job.orgで **Test run** または **Run now** を実行します。
2. cron-job.org側がHTTP `200`になったことを確認します。
3. GitHubの **Actions → Famitsu news to Slack (cron-job.org)** に新しい実行履歴が追加されたことを確認します。
4. GitHub Actionsが緑色で完了することを確認します。

初回は既存記事を既読登録するだけでSlackへ記事通知を送りません。以後に公開された記事から通知します。

## トラブルシューティング

- `401`: tokenが間違っている、失効している、または期限切れ
- `403`: tokenに対象リポジトリのActions書き込み権限がない
- `404`: OWNER、REPOSITORY、workflowファイル名のいずれかが違う
- `422`: `ref` のブランチ名が違う、またはworkflowがデフォルトブランチに存在しない
- cron-job.orgは成功だがActionsが失敗: GitHub Actions側の実行ログを確認する。3回失敗時はSlackにもログURLが届く

tokenをGitHubリポジトリ、README、Request body、URLのクエリ文字列へ書かないでください。cron-job.orgのRequest headerだけに保存します。
