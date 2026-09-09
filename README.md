# Sleepless

眠れない夜に、「今この瞬間も、眠れなくて起きているのは自分だけではない」と感じられる場所を作るプロジェクトです。

最初はX Botとして、眠れない夜に関連投稿数と短いメッセージを届けます。検証後、Xを開かずに確認できるWebアプリとPWAへ段階的に拡張します。

## 現在の段階

Phase 4の動的投稿は本番反映済みです。Phase 5（投稿用OAuthトークンの自動更新）はコード実装済みで、Secrets登録・migration・初期トークン投入・デプロイ・夜間の運用確認が残っています。本番Worker `sleepless-bot` はJST 22:00〜翌06:00に毎時起動し、予定済みの1時間枠の「眠れない」投稿数を取得して投稿します。

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

## Cloudflare Worker / D1 運用手順（Phase 5）

本番Worker `sleepless-bot` はHTTPルートを公開せず、UTC毎時のCronだけで起動する。Worker内部でJSTを判定し、22:00〜翌06:00だけ投稿する。`0 * * * *` はUTC基準であり、投稿対象となるJST 22:00〜06:00はUTC 13:00〜21:00に対応する。

ステージングWorker `sleepless-bot-staging` はCronを設定せず、保護された `POST /test-post` だけを公開する。

### 初回セットアップ

[Phase 5運用ガイド](docs/PHASE_5_TOKEN_REFRESH_GUIDE.md)に従い、ステージングから導入します。Phase 5のWorkerはD1のトークン状態を利用するため、デプロイ前にSecrets・migration・暗号化済みRefresh Tokenの初期投入が必要です。

旧Phase 2・3ガイドの `X_USER_ACCESS_TOKEN` をSecretへ登録する手順は旧実装向けです。Phase 5ではこのSecretへのフォールバックはありません。

### 二重投稿防止

`bot_runs` は投稿予定の1時間枠をUTCで記録する。最初にその枠を `processing` として原子的に確保できた実行だけが、Xへ1回だけ送信する。成功時はPost IDとともに `posted` に更新する。処理中のWorkerが10分以内に記録を完了できなかった場合、その枠は `failed / PROCESSING_LEASE_EXPIRED` として扱い、自動再投稿しない。Xへの送信後にD1の記録に失敗した場合も同様に、送信結果不明として自動再送しない。

`bot_runs` の本番用D1は `sleepless-bot`、ステージング用D1は `sleepless-bot-staging` に分離している。

### 件数の取得と保存

Phase 4では、各投稿枠の `start_time` / `end_time` を明示してX Recent Post Counts APIへ渡し、`"眠れない" OR "寝れない" lang:ja` の投稿数を取得する。成功した件数は投稿前に `sleepless_counts` へ保存され、投稿成功後に同じ行へPost IDを記録する。Counts APIが429・5xx・タイムアウトになった場合は短い指数バックオフで最大3回試行する。取得または妥当性確認に失敗した枠は投稿せず、`bot_runs` を `failed` にする。

### OAuthトークン更新

投稿前にAccess Tokenの残り時間を確認し、5分未満なら更新します。Refresh TokenとAccess TokenはAES-GCMで暗号化してD1へ保存し、鍵はWorker Secretに保持します。更新結果が不明な場合は自動再試行せず、トークン全体を復旧待ちにします。

状態の確認と、再認可後の復旧は次のコマンドで行います。トークンや暗号化鍵は非表示プロンプトへ入力します。復旧の前提条件と鍵交換は[運用ガイド](docs/PHASE_5_TOKEN_REFRESH_GUIDE.md)を参照してください。

```sh
npm run tokens -- status --target production --remote
npm run tokens -- recover --target production --remote --confirm-recovery
```

Workerへ引き渡したRefresh Tokenをローカルの `npm run refresh-token` で更新しないでください。Workerとローカルが同じトークンを使うとローテーション競合になります。

### ローカル検証

```sh
cd apps/bot
npm run check
npm run check:worker
npm run check:test
npm test
```

テストでは一時的なローカルD1と偽トークンを使い、Xへの実投稿やリモートD1への書き込みは行いません。
