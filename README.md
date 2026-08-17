# Sleepless

眠れない夜に、「今この瞬間も、眠れなくて起きているのは自分だけではない」と感じられる場所を作るプロジェクトです。

最初はX Botとして、眠れない夜に関連投稿数と短いメッセージを届けます。検証後、Xを開かずに確認できるWebアプリとPWAへ段階的に拡張します。

## 現在の段階

Phase 0（リポジトリ初期設定）です。Bot実装、Cloudflare設定、X API認証情報はまだ含まれていません。

## 計画

実装方針と各フェーズの完了条件は[実装計画](docs/BOT_IMPLEMENTATION_PLAN.md)を参照してください。

## ディレクトリ構成

```text
.
├── apps/
│   └── bot/       # X Bot（今後実装）
├── docs/
│   └── BOT_IMPLEMENTATION_PLAN.md
├── .gitignore
└── README.md
```

## セキュリティ

X APIのキー、トークン、Cloudflare SecretsをGitへコミットしないでください。ローカルの認証情報は `.env` または `.dev.vars` に保存し、共有するキー名だけを `.env.example` に記載します。
