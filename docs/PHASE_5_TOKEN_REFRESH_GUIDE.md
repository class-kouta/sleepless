# Phase 5：OAuthトークン自動更新の運用

Phase 5のコードは、Cronと保護された `/test-post` の両方でD1のトークン状態を利用する。旧 `X_USER_ACCESS_TOKEN` Secretへのフォールバックはない。以下の導入操作と実際の夜間運用の確認を終えてからPhase 5を完了とする。

## 設定と保存内容

| 名前 | 管理場所・用途 |
| --- | --- |
| `X_CLIENT_ID` | Worker Secret。認可したX AppのClient ID |
| `X_CLIENT_SECRET` | Worker Secret。confidential clientの場合だけ登録する |
| `TOKEN_ENCRYPTION_KEYS` | Worker Secret。鍵IDとbase64形式の32バイト鍵を対応付けたJSON |
| `TOKEN_ACTIVE_KEY_ID` | `wrangler.jsonc` の環境別vars。新しい暗号文に使う鍵ID。初期値 `v1` |
| `TOKEN_CONTEXT` | 同vars。本番 `sleepless-bot-production`、ステージング `sleepless-bot-staging` |
| `OAUTH_ALERT_WEBHOOK_URL` | Worker Secret。運用者への通知を受けるHTTPS JSON Webhook |
| `X_BEARER_TOKEN` | 既存のWorker Secret。Counts API専用 |
| `TEST_POST_SECRET` | 既存のステージング用Worker Secret。HTTPテスト投稿の認証 |

鍵は暗号学的にランダムな32バイトをbase64化して生成し、パスワードマネージャーへ保管する。JSONの形は `{"v1":"<32バイト鍵のbase64>"}`。例のプレースホルダーをそのまま登録しない。本番・ステージングは別の鍵と、それぞれのBotアカウントで認可したトークンを使う。

`oauth_token_state` は各環境のD1に1行だけ保持する。暗号文、有効期限（Unixミリ秒）、世代番号、状態、lease所有者・期限、安全なエラーコードを保存する。AES-GCMの認証データには環境・トークン種別・鍵IDを含めるため、別環境やAccess/Refresh間で暗号文を入れ替えても復号できない。

暗号化鍵・トークンをコマンド引数、Git、ログ、チャットへ出さない。`tokens` コマンドは `.env` を自動読込せず、鍵とRefresh Tokenを非表示プロンプトで受け取る。パスワードマネージャーのプロセス環境注入を利用する場合は `TOKEN_ENCRYPTION_KEYS`、`TOKEN_ACTIVE_KEY_ID`、`X_REFRESH_TOKEN` でも渡せる。実値をシェル履歴へ書かない。

## 初回導入

以下は `apps/bot` で実行する。Node.jsは依存パッケージの要件である20.18.1以上を使う。まずステージングで確認してから本番へ進める。

1. `npx wrangler login` でCloudflareを認証する。対象Botアカウント・X Appを確認し、既存のローカル `.env` を設定して `npm run authorize` を実行する。認可スコープには `offline.access` を含む。取得したRefresh Tokenはこの環境のWorker専用に引き渡す。
2. 必要なSecretsを非表示の入力プロンプトで登録する。confidential clientではClient Secretも登録する。public clientへ切り替えた場合は古いClient Secretを残さない。

   ```sh
   npx wrangler secret put X_CLIENT_ID --env staging
   npx wrangler secret put X_CLIENT_SECRET --env staging
   npx wrangler secret put TOKEN_ENCRYPTION_KEYS --env staging
   npx wrangler secret put OAUTH_ALERT_WEBHOOK_URL --env staging
   npx wrangler secret put X_BEARER_TOKEN --env staging
   npx wrangler secret put TEST_POST_SECRET --env staging
   ```

3. migrationを適用し、暗号化済みRefresh Tokenを投入する。`init` は既存行がある場合に停止し、上書きしない。Access Tokenは初期投入せず、最初の投稿時に更新する。

   ```sh
   npm run migrate:staging
   npm run tokens -- init --target staging --remote
   npm run tokens -- status --target staging --remote
   ```

4. 状態が `ready`、世代が `1`、鍵IDが `v1` であることを確認してデプロイする。

   ```sh
   npm run deploy:staging
   ```

5. ステージングの `POST /test-post` に `Authorization: Bearer <TEST_POST_SECRET>` を付けて1回送信する。成功時はHTTP 201とPost IDだけが返る。これは実際にXへ投稿する操作。状態確認で世代が `2` へ進み、有効期限とAccess Tokenの鍵IDが保存されたことを確認する。無認証は401、GETは405、別パスは404となる。
6. 本番用の認可・鍵で同じ準備を行う。Secret登録時は `--env staging` を外し、`migrate:production`、`tokens --target production --remote`、`deploy:production` を使う。本番への導入は投稿時間外に行う。本番にHTTPテスト投稿ルートは公開しない。
7. JST 22:00〜翌06:00の実行について、更新成功・投稿成功・D1記録・通知経路を確認する。新実装への移行が確認できたら、旧 `X_USER_ACCESS_TOKEN` Secretは削除してよい。旧コードへ戻す場合は古いSecretに頼らず、新しいAccess Tokenを用意する必要がある。

初期投入後はローカル `.env` に残った同じRefresh Tokenで `npm run refresh-token` を実行しない。本番とステージングに同じRefresh Tokenを配布しない。どちらもWorkerのlease管理外でトークンを消費してしまう。

## 更新・停止の挙動

| 状態 | Workerの処理 |
| --- | --- |
| `ready` | Access Tokenの残りが5分以上なら利用し、それ以外は更新を確保する |
| `refreshing` | 他の実行は最大5秒待ち、新しい状態を読む。leaseは60秒で失効する |
| `recovery_required` | 後続の投稿枠も更新・投稿を停止し、運用者へ通知する |

更新要求のタイムアウトは15秒。1回の確保で送信する更新要求は1回だけで、429・5xx・ネットワーク障害でも自動再試行しない。成功応答の検証失敗も結果不明として停止する。投稿APIの401はその世代を復旧待ちにし、投稿を再送しない。

更新成功時は両トークンの暗号文・有効期限・新しい世代・`ready` を1つの条件付きUPDATEで保存する。保存失敗時は復旧待ちにし、D1障害で停止状態も書けなければ `refreshing` を残す。lease失効は更新の引継ぎを許可する条件にはならない。保存自体は成功して応答だけを失った場合は、実際に保存された新しい世代を維持し、現在の投稿枠は失敗として終える。

待機上限到達はその投稿枠だけを失敗にし、他の実行の有効なleaseを奪わない。D1の状態が確認できない場合はトークンを使用しない。投稿直前にも状態・世代を読み直す。外部API呼び出しとD1は同一トランザクションにはできないため、運用中の強制再初期化は避け、復旧時は以下の手順で実行を止める。

## 状態確認と復旧

```sh
npm run tokens -- status --target production --remote
```

このコマンドは状態・世代・期限・鍵ID・エラーコードのみ表示し、暗号文・トークン・鍵は表示しない。`--target` と `--local` / `--remote` は省略できない。

| 主なコード | 対応 |
| --- | --- |
| `OAUTH_RESULT_UNKNOWN` / `OAUTH_RESPONSE_INVALID` | 更新が成功している可能性がある。古いRefresh Tokenで再試行せず再認可する |
| `OAUTH_HTTP_400` / `OAUTH_HTTP_401` / `TOKEN_POST_401` | X App設定・認可を確認して再認可する。APIの応答本文は保存しない |
| `TOKEN_SAVE_UNKNOWN` | まず状態を再確認する。新しい `ready` 世代が保存されていれば維持する |
| `TOKEN_LEASE_EXPIRED` / `TOKEN_RECOVERY_REQUIRED` | 古いRefresh Tokenを再利用せず、明示的に復旧する |
| `TOKEN_STATE_UNAVAILABLE` | D1の接続・migrationを確認する。復旧後に状態を再確認する |
| `TOKEN_CRYPTO_FAILED` | 環境・鍵ID・鍵の保持状況を確認する。`ready` なら鍵設定の修正で復号を回復できる場合がある |
| `TOKEN_WAIT_TIMEOUT` / `TOKEN_STATE_CHANGED` | 他の実行・運用操作と競合した投稿枠だけを停止する。状態を確認する |

復旧手順：

1. ステージングはテスト投稿を止める。本番は投稿時間外に作業するか、Cronを停止して反映を確認する。実行中の更新が終わるまで待ち、`refreshing` の有効なleaseがないことを確認する。
2. 対象のX App・Botアカウントで `npm run authorize` をやり直す。復旧待ちの古いRefresh Tokenを手動更新しない。
3. 次のコマンドへ鍵と新しいRefresh Tokenを非表示で入力する。

   ```sh
   npm run tokens -- recover --target production --remote --confirm-recovery
   npm run tokens -- status --target production --remote
   ```

4. `ready`、世代番号の増加、Access Token未保存を確認する。次の投稿で新しくAccess Tokenを取得する。Cronを止めた場合は再開し、投稿と通知を確認する。

`recover` は世代番号をリセットしない。有効な更新leaseがあれば停止し、読み取り後に世代・状態が変わった場合も上書きしない。`ADMIN_D1_RESULT_UNKNOWN_CHECK_STATUS_BEFORE_RETRY` が出た場合は、必ず先に `status` を確認する。世代が進んでいるなら同じRefresh Tokenを再投入しない。適用結果を確定できない場合は実行を止めた状態で新しく再認可する。

## 暗号化鍵のローテーション

鍵交換はXのトークン更新を呼ばず、既存トークンをローカルで復号・再暗号化する。対象環境の投稿時間外に行うか実行を停止してから進める。

1. 新しい32バイト鍵を `v2` として生成・保管し、Workerの `TOKEN_ENCRYPTION_KEYS` を `v1` と `v2` の両方を含むJSONに更新する。旧鍵はまだ削除しない。
2. 対象環境の `wrangler.jsonc` の `TOKEN_ACTIVE_KEY_ID` を `v2` に変更し、デプロイする。旧Workerの実行が終了したことを確認する。
3. ローカルにも同じ鍵リングを非表示プロンプトで入力し、再暗号化する。鍵IDは秘密ではないため次のように指定できる。

   ```sh
   TOKEN_ACTIVE_KEY_ID=v2 npm run tokens -- rekey --target production --remote
   npm run tokens -- status --target production --remote
   ```

4. Refresh Tokenと、保存されていればAccess Tokenの鍵IDが両方とも `v2` であることを確認する。`rekey` は `ready` のみ実行可能で、並行更新が始まった場合は適用されない。状態を確認してから再実行する。
5. 旧鍵を使う実行・暗号文がないことを確認してから、Workerの鍵リングから `v1` を削除する。D1バックアップの復元に備え、旧鍵はパスワードマネージャーへ保持する。古いDBバックアップのRefresh Tokenをそのまま本番で再利用せず、再認可で復旧する。

## 記録と通知

`oauth_token_events` と構造化ログで更新開始・成功・lease競合・復旧待ちを追跡する。停止したCron枠の理由は `bot_runs.error_code` に保存する。運用コマンドの成功時は、操作名・対象環境・新しい世代のみ標準出力へ表示する。

Webhookへは次のJSONをPOSTする。受け口はこの形式を受信して運用者へ通知するものを用意する。Slackなどの専用ペイロードを要求するURLへ直接登録せず、必要なら変換する受け口を用意する。

```json
{"event":"oauth_operator_action_required","code":"TOKEN_RECOVERY_REQUIRED","environment":"sleepless-bot-production"}
```

通知タイムアウトは5秒で、リダイレクトは追わない。送信失敗は `oauth_alert_delivery_failed`、未設定は `oauth_alert_not_configured` としてログに残す。Webhookを使わない場合は、Cloudflare Logsの `oauth_operator_action_required` を監視する外部通知を別途設定する。ログへの記録だけでは運用者への通知完了とはならない。停止中は投稿枠ごとに通知されるため、受け口で環境・コード単位の重複をまとめてよい。

## ローカル検証

```sh
npm run check
npm run check:worker
npm run check:test
npm test
```

Miniflareの一時D1でSQLを実行し、Xへの通信はモックする。運用コマンドのテストは専用の一時ディレクトリを `--local --persist-to` で指定し、終了時に削除する。実際のOAuth認可、Webhook配送、本番Cronの一晩の継続動作は導入後に別途確認する。

API仕様の参照：[X OAuth 2.0の更新手順](https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token)、[D1のprepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/)。
