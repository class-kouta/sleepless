# Sleepless

眠れない夜に、「今この瞬間も、眠れなくて起きているのは自分だけではない」と感じられる場所を作るプロジェクトです。

最初はX Botとして、眠れない夜に関連投稿数と短いメッセージを届けます。検証後、Xを開かずに確認できるWebアプリとPWAへ段階的に拡張します。

## 現在の段階

Phase 1（ローカルからのX投稿検証）は完了しました。Cloudflare設定はまだ含まれていません。

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
