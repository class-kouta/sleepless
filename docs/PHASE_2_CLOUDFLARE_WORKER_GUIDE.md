# Phase 2: Cloudflare Workerから固定文字列を投稿するまで

最終更新: 2026-09-06

## このドキュメントの目的

Phase 2で行った作業を、「何を」「なぜ」行ったか分かる形で残す。

このフェーズのゴールは、ローカルPC上のスクリプトではなく、Cloudflare上で動くWorkerからX Botアカウントへ固定文を投稿することだった。自動投稿はまだ行わない。自動化・重複投稿防止・D1はPhase 3で扱う。

## 完了した状態

* ステージングWorker名: `sleepless-bot-staging`
* ステージングURL: `https://sleepless-bot-staging.sleepless-bot.workers.dev`
* テスト用URL: `POST /test-post`
* テスト用URLは `Authorization: Bearer <TEST_POST_SECRET>` がないと実行できない。
* 2026-09-06にWorker経由のX投稿へ成功した。Post ID: `2096568085834776675`
* 本番環境にはデプロイしていない。

## 全体像

```text
手動テストする人
    |
    | POST /test-post
    | Authorization: Bearer <TEST_POST_SECRET>
    v
Cloudflare Worker（staging）
    |
    | X_USER_ACCESS_TOKEN をCloudflare Secretから取得
    v
X API: POST /2/tweets
    |
    v
X Botアカウントから「Sleepless Bot テスト投稿」を投稿
```

`TEST_POST_SECRET` は、誰でも投稿エンドポイントを呼べないようにするための合言葉である。`X_USER_ACCESS_TOKEN` は、WorkerがBotアカウントとしてX APIへ投稿するためのOAuth 2.0アクセストークンである。用途が異なるため、別々に管理する。

## 追加・変更したファイル

| ファイル | 役割 |
| --- | --- |
| `apps/bot/src/index.ts` | WorkerのHTTPリクエストを受け、認証とルーティングを行う入口。 |
| `apps/bot/src/x/post.ts` | X APIへ固定文を投稿する処理。 |
| `apps/bot/wrangler.jsonc` | Worker名、エントリーポイント、ステージング環境の設定。 |
| `apps/bot/tsconfig.worker.json` | Worker用のTypeScript型チェック設定。 |
| `apps/bot/package.json` | Wrangler、型定義、`deploy:staging` コマンドを追加。 |
| `README.md` | Cloudflareへの登録・デプロイ手順。 |

ローカルからX投稿を検証する既存コード（`src/post.ts` など）は残している。Worker側とローカル側は用途と実行環境が異なるため、無理に同じエントリーポイントにはしていない。

## Workerの動作

### リクエストの振り分け

`src/index.ts` は以下だけを許可する。

| リクエスト | 結果 |
| --- | --- |
| `POST /test-post` + 正しいBearer Secret | Xへの投稿を実行する。成功時はHTTP 201とPost IDを返す。 |
| `POST /test-post` + Secretなし／誤り | HTTP 401を返す。 |
| `GET /test-post` | HTTP 405を返す。 |
| それ以外のパス | HTTP 404を返す。 |

認証値の比較はハッシュ化して固定長で比較している。認証の成否を外部から推測しにくくするためである。

### X API呼び出し

`src/x/post.ts` はX APIの `POST https://api.x.com/2/tweets` を呼ぶ。HTTPヘッダーへ次を付与する。

```text
Authorization: Bearer <X_USER_ACCESS_TOKEN>
Content-Type: application/json
```

Workerが投稿する本文は、Phase 2では固定の `Sleepless Bot テスト投稿` である。トークン値やX APIの詳細なエラー本文は、HTTPレスポンスやログに出さない。

## Cloudflareで行った操作

### 1. Cloudflareアカウントを作成

WorkerをCloudflareの実行環境へ配置するために必要。独自ドメインの購入は不要で、ステージングはCloudflare提供の `workers.dev` URLを使う。

### 2. Wranglerへログイン

`apps/bot` で実行した。

```sh
npx wrangler login
```

Wranglerは、ローカルのコードをCloudflareへデプロイするCLIである。ブラウザが開き、Cloudflareアカウントで認可すると、ローカルのWranglerがそのアカウントへデプロイできるようになる。

重要: リポジトリ直下で `npx wrangler login` を実行すると、プロジェクトに固定したWranglerではなく最新版を一時取得しようとする場合がある。今回のNode.js 20.10.0では最新版（4.129.0）がNode.js 22以上を必要とし失敗した。必ず `apps/bot` で実行し、プロジェクトに入っているWrangler 4.70.0を使う。

### 3. XのアクセストークンをCloudflare Secretへ登録

ローカルの `.env` にある `X_USER_ACCESS_TOKEN` を、Cloudflareのステージング環境へ登録した。

```sh
npx wrangler secret put X_USER_ACCESS_TOKEN --env staging
```

実行後の入力プロンプトに、ローカルの値を貼り付ける。値をソースコード、Git、チャット、スクリーンショットに載せない。

`--env staging` は、`wrangler.jsonc` の `env.staging` を対象にする指定である。つまりこの値は本番用ではなく、`sleepless-bot-staging` 用だけに保存される。

### 4. 手動テスト用Secretを登録

`/test-post` を保護するために、ランダム値を生成して登録した。

```sh
openssl rand -base64 32
npx wrangler secret put TEST_POST_SECRET --env staging
```

1つ目のコマンドが表示した値を安全な場所に保存し、2つ目の入力プロンプトに貼り付ける。この値を知る人だけが手動投稿を実行できる。

今回の検証中にこのSecretはランダムな一時値へ更新されている。今後自分で手動実行する必要がある場合は、上記手順で新しい値に更新して自分で保管する。

### 5. `workers.dev` サブドメインを登録

最初のデプロイでは、Cloudflareアカウントに `workers.dev` サブドメインが未設定だったため公開できなかった。次を対話的に実行し、表示された質問に `y` と答えて `sleepless-bot.workers.dev` を登録した。

```sh
npm run deploy:staging
```

このサブドメインはステージングWorkerのURLの一部になる。Worker名と組み合わせて、次のURLになる。

```text
https://sleepless-bot-staging.sleepless-bot.workers.dev
```

古いCloudflareダッシュボードURLへ直接アクセスする案内は404になった。サブドメイン未設定時は、上のWranglerの対話プロンプトを使うのが確実である。

### 6. ステージングへデプロイ

```sh
npm run deploy:staging
```

これは実体として以下を実行する。

```sh
wrangler deploy --env staging
```

`wrangler.jsonc` は、通常のデプロイに `workers_dev: false` を設定している。誤って本番相当のURLへテスト用エンドポイントを出さないためである。`--env staging` を付けた時だけ、`sleepless-bot-staging` を `workers.dev` に公開する。

## テストと発生した問題

### 最初の投稿テスト: HTTP 502

Workerの `POST /test-post` はHTTP 502を返した。これはWorkerがX APIへの失敗詳細をそのまま公開しない設計だからである。

Cloudflareログを次で追跡した。

```sh
npx wrangler tail sleepless-bot-staging --format pretty
```

ログでは `xStatus: 401` と確認できた。WorkerのURLや手動認証は正常で、Cloudflareに保存した `X_USER_ACCESS_TOKEN` が期限切れだったことが原因だった。

### Xのアクセストークンを更新

ローカルに保存されている `X_REFRESH_TOKEN` を使い、新しいアクセストークンを取得した。

```sh
npm run refresh-token
```

このコマンドはローカルの `.env` の `X_USER_ACCESS_TOKEN`（およびXから返された場合は`X_REFRESH_TOKEN`）を更新する。その後、新しいアクセストークンをCloudflareへ再登録した。

```sh
npx wrangler secret put X_USER_ACCESS_TOKEN --env staging
```

### 最終テスト: HTTP 201

保護された `POST /test-post` を呼び出したところ、HTTP 201とPost ID `2096568085834776675` が返った。つまり、Cloudflare WorkerからX Botとして投稿できることを確認できた。

## 日常的に必要になりうる操作

### コードを変更してステージングへ反映する

```sh
cd apps/bot
npm run check
npm run check:worker
npm run deploy:staging
```

### X APIが401を返したとき

アクセストークンが期限切れの可能性が高い。以下の順番で更新する。

```sh
cd apps/bot
npm run refresh-token
npx wrangler secret put X_USER_ACCESS_TOKEN --env staging
```

Cloudflare Secret登録時は、更新後の `.env` にある `X_USER_ACCESS_TOKEN` を貼り付ける。

Refresh Token自体が失効していた場合は、Phase 1のOAuth認可フロー（`npm run authorize`）からやり直す。認可で発行されたトークンを再度Cloudflareへ登録する。

### Workerのログを見る

```sh
cd apps/bot
npx wrangler tail sleepless-bot-staging --format pretty
```

終了するには `Ctrl+C` を押す。ログにトークンや`TEST_POST_SECRET`を出さない。

## Phase 2で意図的にまだしていないこと

* Cronによる定期実行
* JSTの投稿時間帯判定
* D1への実行状態保存
* 二重投稿防止
* 投稿文への「眠れない」件数の反映
* 本番環境へのデプロイ

これらはPhase 3以降の責務である。特にCronを追加する前に、D1を使った冪等性を実装して、同じ時間枠に複数回投稿しないようにする。
