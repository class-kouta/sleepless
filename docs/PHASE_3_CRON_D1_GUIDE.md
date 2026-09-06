# Phase 3: CronとD1で固定文を自動投稿するまで

最終更新: 2026-09-06

## このドキュメントの目的

Phase 3で行った作業を、「何を」「なぜ」行ったか分かる形で残す。

このフェーズのゴールは、ローカルPCを閉じていても、Cloudflare上のBotがJST 22:00〜翌06:00に毎時1回、自動で固定文を投稿する状態を作ることだった。

自動投稿では、障害・デプロイ・Cronの重複起動などによって同じ時間帯に複数投稿してしまうリスクがある。そのため、投稿前にD1データベースへ実行記録を残し、同じ投稿枠からは最大1件だけ投稿できるようにした。X上の「眠れない」投稿数を取得する処理は、次のPhase 4で追加する。

## 完了した状態

* 本番Worker名: `sleepless-bot`
* 本番Workerには公開HTTP URL・Routeを設定していない。Cronだけが投稿処理を起動する。
* Cron: `0 * * * *`（UTCの毎時0分）
* 投稿対象: Worker内部でJSTを判定し、22:00〜翌06:00だけ投稿する。
* 本番D1: `sleepless-bot`
* ステージングD1: `sleepless-bot-staging`
* ステージングWorkerにはCronを設定していない。`POST /test-post` はPhase 2の手動テスト専用のままである。
* 2026-09-06 JST 22:00に、本番Cronから初回の自動投稿へ成功した。
  * 集計・投稿枠: UTC 12:00〜13:00（JST 21:00〜22:00）
  * X Post ID: `2096584386380759277`
  * D1の状態: `posted`

## 全体像

```text
Cloudflare Cron（UTC毎時0分）
    |
    v
Cloudflare Worker: sleepless-bot
    |
    | 予定されたUTC正時をJSTへ変換
    v
投稿対象の時間か？（JST 22:00〜06:00）
    |                     |
    | No                  | Yes
    v                     v
何もしない          D1: bot_runs に対象枠を原子的に確保
                          |
                          | 確保できなかった
                          v
                      何もしない
                          |
                          | 確保できた（この実行だけ）
                          v
                  X API: POST /2/tweets
                          |
             +------------+------------+
             |                         |
             v                         v
  D1を posted + Post IDへ更新     D1を failed へ更新
```

本番WorkerはHTTPリクエストから投稿できない。`workers.dev` も無効で、Routeも設定していないため、外部の誰かがURLを何度も叩いて投稿処理を増やす経路を作っていない。

## Cronと日本時間

CloudflareのCron式はUTCで評価される。設定したCron式は以下である。

```jsonc
"triggers": {
  "crons": ["0 * * * *"]
}
```

これは「UTCの毎時0分に起動する」という意味で、投稿時間そのものをCron式へ埋め込んではいない。毎時起動したWorkerが `Asia/Tokyo` へ変換し、次の条件で投稿対象かを判断する。

```ts
hour >= 22 || hour <= 6
```

| JSTの時刻 | UTCの時刻 | 投稿 |
| --- | --- | --- |
| 21:00 | 12:00 | しない |
| 22:00 | 13:00 | する |
| 23:00 | 14:00 | する |
| 00:00〜06:00 | 前日15:00〜当日21:00 | する |
| 07:00 | 22:00 | しない |

UTC毎時で起動する形にしておくと、夏時間のある地域を基準にする場合などと比べて設定が単純で、コードにあるJST判定を一箇所だけ確認すればよい。

## 「投稿枠」とは何か

投稿の重複を防ぐため、Workerが実際に動き始めた時刻ではなく、「投稿予定だった1時間」を識別子にする。

たとえばJST 02:00のCronが少し遅れて02:03に動いたとしても、対象枠は次で固定される。

```text
JSTで見た枠: 01:00:00 以上 02:00:00 未満
DBで保存する枠: UTC 16:00:00 以上 17:00:00 未満
キー: window_end_at = UTC 17:00:00
```

遅延やデプロイのやり直しによって「02:03から過去1時間」のように範囲がずれることはない。Phase 4でCounts APIを呼ぶ際も、この同じ固定枠を使う。

## D1と `bot_runs`

### D1を使う理由

メモリ上のフラグでは、Workerが再起動したり別の実行が並行したりすると、以前の実行状態を覚えていられない。Cloudflare D1に記録すると、どのWorker実行からも同じ履歴を参照できる。

本番とステージングは別D1にしている。ステージングで試した投稿記録が、本番の投稿判定へ影響しないためである。

### テーブル定義

`apps/bot/migrations/0001_create_bot_runs.sql` がD1へ適用されている。

```sql
CREATE TABLE bot_runs (
  window_end_at TEXT PRIMARY KEY,
  window_start_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'posted', 'skipped', 'failed')),
  x_post_id TEXT,
  error_code TEXT,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

| 列 | 用途 |
| --- | --- |
| `window_end_at` | 投稿枠を一意に決める主キー。これが同じなら同じ枠。 |
| `window_start_at` | 枠の開始時刻。Phase 4のCounts APIにも使う。 |
| `status` | 処理中・成功・失敗などの現在状態。 |
| `x_post_id` | 投稿成功時にXから返るPost ID。監査と確認用。 |
| `error_code` | 失敗理由を値を漏らさない短いコードで保存する。 |
| `lease_expires_at` | `processing` をいつまで有効とみなすか。 |

### 状態遷移

```text
新しい投稿枠
    |
    | INSERT OR IGNORE が成功
    v
processing（10分のlease）
    |                    |
    | X投稿成功           | X投稿失敗
    v                    v
posted                 failed
```

* `posted`: 投稿済み。後続のCron・再デプロイ・手動確認は何もしない。
* `processing`: すでに別の実行が作業中。leaseが有効な10分間は何もしない。
* `failed`: 自動再投稿しない。送信済みか不明な状態で再送すると、二重投稿になる可能性があるため。
* `skipped`: 将来、運用者が意図的に見送る場合だけに使う予約状態。通常の対象外時刻には行を作らない。

`processing` のleaseが切れた状態を次のCronが見つけた場合、行は `failed / PROCESSING_LEASE_EXPIRED` に更新される。この場合も自動再投稿はしない。Xの投稿履歴とCloudflareログを見て、未投稿だと確認できた場合にだけ、将来用意する明示的な運用手順で再実行する。

### なぜ「失敗したら自動再試行」しないのか

X APIへの通信では、Worker側がタイムアウトしても、X側では投稿を受け付けていることがある。この状態で「失敗したからもう一度送る」と二重投稿になる。

特に投稿成功後のD1更新に失敗した場合は、Xへの送信結果をD1へ記録できない。コードはこの場合も送信済みかもしれないものとして扱い、自動再送しない。安全性を優先した設計である。

## 追加・変更したファイル

| ファイル | 役割 |
| --- | --- |
| `apps/bot/src/index.ts` | HTTPのPhase 2テスト処理に加え、Cron処理全体を制御する `scheduled` handlerを追加。 |
| `apps/bot/src/time.ts` | UTCの予定時刻から投稿枠とJST時刻を作り、投稿対象かを判定する。固定文もここで組み立てる。 |
| `apps/bot/src/runs.ts` | D1の実行枠を確保し、`posted` / `failed` へ更新する。 |
| `apps/bot/src/x/post.ts` | 任意の本文をXへ投稿する `createPost` を追加。Phase 2のテスト投稿関数も残す。 |
| `apps/bot/migrations/0001_create_bot_runs.sql` | `bot_runs` テーブルを作るD1 migration。 |
| `apps/bot/wrangler.jsonc` | 本番Cron、本番・ステージングそれぞれのD1 bindingを設定。 |
| `apps/bot/package.json` | 本番デプロイ・本番/ステージングmigrationのコマンドを追加。 |
| `README.md` | 日常運用、二重投稿防止、OAuthトークン更新を記載。 |

## Cloudflareで行った操作

### 1. D1を作成

本番とステージングを分離するため、D1を2つ作成した。

```sh
cd apps/bot
npx wrangler d1 create sleepless-bot
npx wrangler d1 create sleepless-bot-staging
```

作成コマンドが出力する `database_id` を `wrangler.jsonc` に設定した。D1を作るだけでは投稿は発生しない。Workers FreeではD1に無料枠があり、今回の1時間に1行程度の記録量は十分に収まる。

### 2. migrationを適用

```sh
npm run migrate:staging
npm run migrate:production
```

この操作は `bot_runs` テーブルを作るだけであり、Xへの投稿やWorkerのデプロイは行わない。migrationは一度適用されると、次回以降は同じファイルを二重に実行しない。

### 3. ステージングをデプロイ

```sh
npm run deploy:staging
```

ステージングはD1 bindingを持つが、`triggers.crons` が空配列なので自動投稿しない。Phase 2の手動テスト用 `POST /test-post` を残している。

### 4. 本番Secretを登録

本番Workerはステージングとは別のSecret領域を使う。本番用の `X_USER_ACCESS_TOKEN` を対話入力で登録した。

```sh
npx wrangler secret put X_USER_ACCESS_TOKEN
```

このコマンドは入力値を表示しない。`.env` をコードが読み取ったり、トークン値をGit・ログ・チャットへ出力したりしないよう、値は利用者自身がプロンプトへ貼り付ける。

### 5. 本番をデプロイ

```sh
npm run deploy:production
```

これでWorker・D1 binding・Cronが本番へ反映される。Cron設定の反映には時間差がありうるため、設定直後は次のログ確認を行う。

## 動作確認

### 型検査

```sh
cd apps/bot
npm run check
npm run check:worker
```

前者はローカル実行用コード、後者はCloudflare Worker用の型を含めて検査する。

### Cloudflareログを見る

```sh
cd apps/bot
npx wrangler tail sleepless-bot --format json
```

正常な投稿時は、トークン・投稿本文を含めず、以下のようなイベントを出す。

```json
{"event":"cron_post_succeeded","windowEndAt":"...","postId":"..."}
```

対象外時刻は `cron_outside_posting_hours`、既に処理済み・処理中などで開始しなかった場合は `cron_run_not_started` が出る。`PROCESSING_LEASE_EXPIRED` は運用確認が必要なエラーである。

### D1の記録を見る

```sh
cd apps/bot
npx wrangler d1 execute sleepless-bot --remote --command \
  "SELECT window_end_at, window_start_at, status, x_post_id, error_code FROM bot_runs ORDER BY window_end_at DESC LIMIT 10;"
```

`posted` が1枠につき1行だけであること、成功時に `x_post_id` が入ることを確認する。このSQLは読み取り専用である。

## 日常的に必要になりうる操作

### コード変更後にステージングへ反映する

```sh
cd apps/bot
npm run check
npm run check:worker
npm run deploy:staging
```

本番に反映する前に、D1 schemaを変える変更なら先にmigrationを追加して適用する。投稿処理の変更は、Xへの実投稿が起きるため、本番デプロイ時刻にも注意する。

### X APIが401を返したとき

Access Tokenの期限切れが考えられる。Refresh TokenをWorkerやD1に保存して自動更新する設計にはしていない。ローカルで更新してから、利用者自身が対話プロンプトへ新しい値を入力する。

```sh
cd apps/bot
npm run refresh-token
npx wrangler secret put X_USER_ACCESS_TOKEN
npx wrangler secret put X_USER_ACCESS_TOKEN --env staging
```

本番・ステージングは別Secretなので、必要な側へそれぞれ登録する。Refresh Tokenも失効していた場合は、`npm run authorize` でOAuth認可からやり直す。

## Phase 3で意図的にまだしていないこと

* XのRecent Post Counts APIの呼び出し
* 「眠れない」投稿数を含む動的な本文
* Counts取得失敗時のリトライと通知
* `sleepless_counts` テーブルへの件数スナップショット保存
* 運用者が明示的に失敗枠を再実行するための管理機能

これらはPhase 4以降で追加する。Phase 4でも、Phase 3で作った固定の投稿枠と `bot_runs` の二重投稿防止をそのまま利用する。
