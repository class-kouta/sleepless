# Sleepless

眠れない夜に、「今この瞬間も、眠れなくて起きているのは自分だけではない」と感じられる場所を作るプロジェクトです。

最初はX Botとして、眠れない夜に関連投稿数と短いメッセージを届けます。検証後、Xを開かずに確認できるWebアプリとPWAへ段階的に拡張します。

## 現在の段階

Phase 3（CronとD1による固定文字列の自動投稿）は完了しました。本番Worker `sleepless-bot` はJST 22:00〜翌06:00に毎時自動投稿します。次はPhase 4（「眠れない」投稿数を取得して動的投稿）です。

## X API 利用確認（Phase 1）

2026-08-17 にX APIのPay Per Useプロジェクトで、$5.00のクレジットと請求サイクル上限$5.00を設定した。Recent Post CountsにはApp-only Bearer Token、投稿にはOAuth 2.0 Authorization Code + PKCEによるBotアカウントのユーザー文脈を使用する。

* Recent Post Counts: `眠れない lang:ja -is:retweet` を実行し、成功（2026-09-05時点で34,111件）。これは実行時点から過去7日間の投稿数である。
* テスト投稿: OAuth 1.0aでの投稿はHTTP 401 Unauthorizedとなったため、OAuth 2.0 Authorization Code + PKCEへ移行した。新しいDeveloper Appで認可し、`npm run authorize` によりローカルのAccess TokenとRefresh Tokenを取得した後、固定文字列のテスト投稿に成功した。
* 利用上限とDeveloper Terms: Console上で確認済み。実際のレート制限値はアプリのRate limits画面を参照する。

## 計画

実装方針と各フェーズの完了条件は[実装計画](docs/BOT_IMPLEMENTATION_PLAN.md)を参照してください。

## ディレクトリ構成

```text
.
├── apps/
│   └── bot/       # ローカル検証済みのX Bot
├── docs/
│   └── BOT_IMPLEMENTATION_PLAN.md
├── .gitignore
└── README.md
```

## セキュリティ

X APIのキー、トークン、Cloudflare SecretsをGitへコミットしないでください。ローカルの認証情報は `.env` または `.dev.vars` に保存し、共有するキー名だけを `.env.example` に記載します。

## Cloudflare Worker / D1 運用手順（Phase 3）

本番Worker `sleepless-bot` はHTTPルートを公開せず、UTC毎時のCronだけで起動する。Worker内部でJSTを判定し、22:00〜翌06:00だけ投稿する。`0 * * * *` はUTC基準であり、投稿対象となるJST 22:00〜06:00はUTC 13:00〜21:00に対応する。

ステージングWorker `sleepless-bot-staging` はCronを設定せず、保護された `POST /test-post` だけを公開する。

### 初回セットアップ

1. `cd apps/bot` を実行し、`npx wrangler login` でCloudflareアカウントを認証する。
2. XのOAuth 2.0ユーザーアクセストークンを、入力プロンプトを通じて登録する。

   ```sh
   npx wrangler secret put X_USER_ACCESS_TOKEN --env staging
   ```

3. 手動実行を保護するランダムなSecretを生成する。生成値はパスワードマネージャーなどに控え、Git・ログ・チャットには貼り付けない。

   ```sh
   openssl rand -base64 32
   ```

   続けて、表示された値を入力プロンプトへ貼り付ける。

   ```sh
   npx wrangler secret put TEST_POST_SECRET --env staging
   ```

4. D1 migrationを、本番とステージングそれぞれに一度だけ適用する。

   ```sh
   npm run migrate:staging
   npm run migrate:production
   ```

5. ステージングだけをデプロイする。

   ```sh
   npm run deploy:staging
   ```

6. 表示された `workers.dev` URLへ、`Authorization: Bearer <TEST_POST_SECRET>` ヘッダー付きで `POST /test-post` を一度だけ送信する。成功時はHTTP 201とXのPost IDが返る。無認証アクセスはHTTP 401、GETは405、別パスは404になる。

7. 本番用の `X_USER_ACCESS_TOKEN` を登録してから、本番Workerをデプロイする。デプロイ後、Cron設定の反映時間中はCloudflareのCron EventsとWorker Logsを監視する。

   ```sh
   npx wrangler secret put X_USER_ACCESS_TOKEN
   npm run deploy:production
   ```

### 二重投稿防止

`bot_runs` は投稿予定の1時間枠をUTCで記録する。最初にその枠を `processing` として原子的に確保できた実行だけが、Xへ1回だけ送信する。成功時はPost IDとともに `posted` に更新する。処理中のWorkerが10分以内に記録を完了できなかった場合、その枠は `failed / PROCESSING_LEASE_EXPIRED` として扱い、自動再投稿しない。Xへの送信後にD1の記録に失敗した場合も同様に、送信結果不明として自動再送しない。

`bot_runs` の本番用D1は `sleepless-bot`、ステージング用D1は `sleepless-bot-staging` に分離している。

### OAuthトークン更新

Refresh TokenをWorkerやD1へ保存して自動更新はしない。`X_USER_ACCESS_TOKEN` の期限切れ時は、ローカルで `npm run refresh-token` を実行し、新しいAccess Tokenを次の対話コマンドで本番・ステージングそれぞれに登録する。トークン値をログ、Git、チャットへ出力しない。

```sh
npx wrangler secret put X_USER_ACCESS_TOKEN
npx wrangler secret put X_USER_ACCESS_TOKEN --env staging
```

`X_USER_ACCESS_TOKEN` は期限切れ時にX APIが失敗する。Phase 2ではローカルの認可・更新フローで新しいトークンを得てから、同じSecretを再登録する。トークン更新の永続化はPhase 3で扱う。
