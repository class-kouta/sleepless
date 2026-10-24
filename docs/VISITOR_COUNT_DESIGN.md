# Cloudflare訪問数表示 設計書

最終更新: 2026-10-24

## 1. 目的

Cloudflareが集計する直近24時間の訪問数を定期的に取得し、Web版に表示する。

```text
この24時間に
42人が訪れました
```

ブラウザからCloudflare Analytics APIを直接呼ばず、Cronで取得した結果をD1へ保存する。既存の `GET /api/counts/latest` に訪問数を追加し、ページ表示時のAPIリクエスト数を増やさない。

## 2. 採用する構成

```text
Cloudflare Cron（10分間隔）
  ↓
sleepless-api Worker
  ↓
Cloudflare GraphQL Analytics API
  ↓ 直近24時間のvisits
D1へ最新値をUPSERT

ブラウザ
  ↓ 既存の1リクエスト
GET /api/counts/latest
  ↓
sleepless-api Worker
  ├─ X投稿件数をD1から取得
  └─ 訪問数の最新値をD1から取得
  ↓
X投稿件数と訪問数をまとめて返す
```

初期設定では10分間隔とする。5分間隔へ変更できるが、プロダクト上必要な鮮度とCloudflare APIの呼び出し回数を考慮し、まず10分で運用する。

## 3. 指標の定義

Cloudflare GraphQL Analytics APIの `httpRequestsAdaptiveGroups.sum.visits` を使用する。

CloudflareはVisitを、外部サイトからの遷移または直接アクセスによって始まったページ閲覧として定義している。1回のVisitには複数のページビューを含められるため、静的ファイルやAPIを含むHTTPリクエスト数とは異なり、通常の再読み込みや同一訪問中のページ遷移をそのまま加算する指標ではない。

取得条件:

* 対象ゾーン: `sleepless-bot.com` を含むCloudflare Zone
* 対象ホスト: `sleepless-bot.com`
* 対象期間: Analytics API呼び出し時刻から遡った24時間
* リクエスト種別: `requestSource = "eyeball"`
* 指標: `sum.visits`

### 3.1 「人」表示について

画面上はUXを優先して「人」と表示するが、`visits` は厳密な実人数やユニークユーザー数ではない。同じ人が時間を空けて再訪すると複数Visitになることがあり、Cloudflareの判定や分析データの反映遅延にも影響される。

したがって、内部仕様・運用資料では「訪問数」と呼ぶ。「正確な利用者数」「ユニークユーザー数」などとは表現しない。

## 4. 要件

### 4.1 機能要件

* 直近24時間のCloudflare Visitsを10分ごとに取得する。
* 取得成功時だけD1の最新値を更新する。
* Web版では既存のX投稿件数と訪問数を1回のAPIリクエストで取得する。
* 訪問数の取得失敗をX投稿件数の取得失敗へ波及させない。
* 古い訪問数を現在値として表示しない。
* CronやWorkerの再実行でD1に重複行を作らない。

### 4.2 非機能要件

* Cloudflare API TokenをWorker Secretとして管理する。
* API Tokenをブラウザ、ログ、D1、HTTPレスポンスへ出さない。
* Cloudflare Analytics APIを利用者のアクセスごとに呼ばない。
* 新しい公開APIエンドポイントを追加しない。
* 本番とステージングでD1、Zone ID、API Tokenを分離する。
* Cloudflare Analytics APIとD1の障害時も、Webページ本体を表示できるようにする。

## 5. 対象外

初期実装では次を行わない。

* ブラウザへ匿名ID、Cookie、`localStorage` の識別子を保存すること
* D1へ訪問者単位のレコードを保存すること
* IPアドレスやUser-Agentによる独自の重複排除
* 端末をまたいだ実人数の特定
* 国、参照元、端末などの属性別表示
* 過去推移のグラフ表示
* 秒単位のリアルタイム更新
* Cloudflare Analyticsの値を課金・請求の正本として使用すること

## 6. 実装先

### 6.1 API Worker

`apps/api` に次の責務を追加する。

* Scheduled handlerからCloudflare Analytics APIを呼ぶ。
* 成功結果をD1へ保存する。
* `GET /api/counts/latest` で最新の訪問数を読み取る。
* 鮮度を検証し、古い場合は表示対象外にする。

Bot WorkerはX API連携と投稿の責務を維持する。訪問数はWeb表示用なので、Analytics APIのCronをBot Workerへ追加しない。

### 6.2 フロントエンド

既存の `fetchLatestCount()` が受け取るレスポンスへ訪問数を追加する。ブラウザから新しいAPIリクエストは送らない。

## 7. Cloudflare設定

### 7.1 Cron Trigger

`apps/api/wrangler.jsonc` に10分間隔のCronを追加する。

```jsonc
{
  "triggers": {
    "crons": ["*/10 * * * *"]
  }
}
```

CronはUTCで評価されるが、10分間隔のローリング集計なのでタイムゾーン変換は不要である。

### 7.2 環境変数とSecret

```text
CLOUDFLARE_ZONE_ID                  通常の環境変数
CLOUDFLARE_ANALYTICS_API_TOKEN      Worker Secret
ANALYTICS_HOSTNAME                  通常の環境変数
```

本番の `ANALYTICS_HOSTNAME` は `sleepless-bot.com` とする。Previewやステージングでは本番トラフィックを表示しないよう、対象ZoneとHostnameを明示的に分ける。適切なステージング用分析対象がない場合は、固定fixtureを返す開発モードではなく、Cronを無効化してD1へテストデータを投入する。

API Tokenには対象Zoneの分析読み取りに必要な最小権限だけを付与する。アカウント全体の編集権限やWorkersの編集権限は付与しない。

## 8. Analytics API

### 8.1 エンドポイント

```text
POST https://api.cloudflare.com/client/v4/graphql
```

ヘッダー:

```http
Authorization: Bearer <CLOUDFLARE_ANALYTICS_API_TOKEN>
Content-Type: application/json
X-Rate-Limit-Type: account-based
```

API TokenはAuthorizationヘッダーにだけ設定し、URLやログへ含めない。

### 8.2 GraphQLクエリ

実装時はCloudflare GraphQL Schemaで、対象Zoneにおけるフィールド名と利用可能範囲を確認する。論理的には次のクエリを使用する。

```graphql
query VisitsByHostname(
  $zoneTag: string
  $start: Time
  $end: Time
  $hostname: string
) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      httpRequestsAdaptiveGroups(
        limit: 1
        filter: {
          datetime_geq: $start
          datetime_lt: $end
          clientRequestHTTPHost: $hostname
          requestSource: "eyeball"
        }
      ) {
        sum {
          visits
        }
      }
    }
  }
}
```

変数例:

```json
{
  "zoneTag": "<CLOUDFLARE_ZONE_ID>",
  "start": "2026-10-23T12:00:00Z",
  "end": "2026-10-24T12:00:00Z",
  "hostname": "sleepless-bot.com"
}
```

開始・終了時刻はWorkerが同じ `now` から計算する。`end = now`、`start = now - 24時間` とし、ISO 8601のUTCで送る。

### 8.3 レスポンス検証

HTTP 200だけで成功と判定しない。次をすべて検証する。

* HTTPステータスが200である。
* JSONとして解析できる。
* トップレベルの `errors` が存在しない。
* `viewer.zones` が1件である。
* `httpRequestsAdaptiveGroups` が期待した1グループを返す。
* `sum.visits` が0以上の安全な整数である。
* 値がJavaScriptの `Number.MAX_SAFE_INTEGER` を超えない。

検証に失敗した場合はD1を更新しない。レスポンス本文全体はログへ出さず、安全なエラーコードだけを記録する。

### 8.4 レート制限

Cloudflare GraphQL Analytics APIの既定値は、1ユーザーまたはAPI Tokenにつき5分間に300クエリである。10分ごとに1回の設計では月約4,320回であり、通常運用で上限に近づかない。

閲覧リクエストからAnalytics APIを呼び出さないため、Webアクセスの増加はGraphQL APIの呼び出し回数へ影響しない。

## 9. D1データモデル

既存の本番D1 `sleepless-bot` に最新の成功値を1行だけ保存する。

現在のmigration管理場所に合わせ、`apps/bot/migrations/0005_create_web_visit_count.sql` として管理する。

```sql
CREATE TABLE web_visit_count (
  singleton_key INTEGER PRIMARY KEY CHECK (singleton_key = 1),
  window_start_at TEXT NOT NULL,
  window_end_at TEXT NOT NULL,
  visit_count INTEGER NOT NULL CHECK (visit_count >= 0),
  fetched_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

訪問者単位の情報やAnalytics APIの生レスポンスは保存しない。

### 9.1 UPSERT

```sql
INSERT INTO web_visit_count (
  singleton_key,
  window_start_at,
  window_end_at,
  visit_count,
  fetched_at,
  created_at,
  updated_at
) VALUES (1, ?1, ?2, ?3, ?4, ?4, ?4)
ON CONFLICT(singleton_key) DO UPDATE SET
  window_start_at = excluded.window_start_at,
  window_end_at = excluded.window_end_at,
  visit_count = excluded.visit_count,
  fetched_at = excluded.fetched_at,
  updated_at = excluded.updated_at
WHERE excluded.fetched_at > web_visit_count.fetched_at;
```

常に主キー `1` を使うため、Cronの再実行で行数は増えない。古い実行が遅れて完了しても、より新しいスナップショットを上書きしない。

### 9.2 保存失敗

Analytics API取得後にD1保存が失敗した場合は、その実行を失敗として記録する。D1保存だけを短いバックオフで再試行してよいが、Analytics APIを再度呼ばない。

次回Cronが新しい24時間枠を取得するため、無制限の再試行やQueueは導入しない。

## 10. Cron処理

```text
Scheduled event
  ↓
環境変数・Secretの存在確認
  ↓
windowEnd = 現在時刻
windowStart = windowEnd - 24時間
  ↓
Analytics APIを1回呼ぶ
  ↓
HTTP・GraphQL・値を検証
  ├─ 失敗 → 安全なログを記録し、D1は更新しない
  └─ 成功
       ↓
     D1へUPSERT
       ├─ 失敗 → 安全なログを記録
       └─ 成功 → 完了ログ
```

Analytics APIのタイムアウトは10秒を初期値とする。429、5xx、タイムアウト時に同じCron内でAnalytics APIを自動再試行しない。10分後の次回Cronで新しい集計枠を取得する。これによりAPI障害時の呼び出し増幅を避ける。

Workerの重複実行が発生してもD1は1行に収束する。10分間隔かつAnalytics APIの上限に十分余裕があるため、初期実装ではD1 leaseを追加しない。実測で重複呼び出しが問題になった場合にだけleaseを検討する。

## 11. APIレスポンス

既存の `GET /api/counts/latest` に `visits` を追加する。

```json
{
  "windowStartAt": "2026-10-24T01:00:00Z",
  "windowEndAt": "2026-10-24T02:00:00Z",
  "fetchedAt": "2026-10-24T02:00:08Z",
  "postCount": 1284,
  "queryVersion": "v3",
  "visits": {
    "count": 42,
    "windowStartAt": "2026-10-23T02:10:00Z",
    "windowEndAt": "2026-10-24T02:10:00Z",
    "fetchedAt": "2026-10-24T02:10:02Z"
  }
}
```

X投稿件数の時間枠と訪問数の時間枠は異なるため、それぞれの時刻を返す。

### 11.1 鮮度判定

Cronは10分間隔なので、現在時刻と `visits.fetchedAt` の差が30分を超えた場合は古いデータと判定する。古い値を現在の24時間値として返さず、`visits` を `null` にする。

```json
{
  "windowStartAt": "2026-10-24T01:00:00Z",
  "windowEndAt": "2026-10-24T02:00:00Z",
  "fetchedAt": "2026-10-24T02:00:08Z",
  "postCount": 1284,
  "queryVersion": "v3",
  "visits": null
}
```

D1に行がない場合も `visits: null` とする。

### 11.2 障害分離

X投稿件数と訪問数は独立してD1から読み取る。訪問数の読み取りまたは検証だけが失敗した場合、X投稿件数を含むHTTP 200を返し、`visits` は `null` にする。

X投稿件数自体が利用不可の場合は、既存仕様どおり503を返す。訪問数だけを返す代替レスポンスは初期実装では追加しない。

既存クライアントは未知の `visits` フィールドを無視できるため、レスポンス拡張は後方互換になる。

## 12. キャッシュ

`GET /api/counts/latest` の成功レスポンスを60秒キャッシュする。[Counts API キャッシュ・レート制限ガイド](API_CACHE_RATE_LIMITING_GUIDE.md)の設計を適用する。

訪問数は10分ごとに更新されるため、60秒キャッシュによる追加遅延を許容する。エラー応答はキャッシュしない。

キャッシュはD1読み取りとWorker CPUを減らすが、Workerの料金上の受信リクエスト数を必ずしも減らすものではない。不要なクエリ文字列の拒否とWAF Rate Limitingを併用する。

## 13. フロントエンド

### 13.1 データ取得

既存の `fetchLatestCount()` を1回だけ呼ぶ。訪問数用の追加fetchは実装しない。

### 13.2 表示

X投稿件数のメッセージより下に補助情報として表示する。

```text
この24時間に
42人が訪れました
```

表示ルール:

* `count > 0`: 「この24時間に N人が訪れました」
* `count = 0`: 「この24時間の訪問は、まだありません」
* `visits = null`: 訪問数領域を非表示にする
* 数字は3桁区切りにする
* 集計時刻を詳細表示する場合は、`visits.windowStartAt` と `visits.windowEndAt` を使用する
* ランキング、急増通知、煽る表現、強いアニメーションを追加しない
* 訪問数の取得状態がX投稿件数の描画を妨げないようにする

## 14. プライバシー

この方式では、訪問数表示のために新しいCookie、匿名ID、`localStorage`を導入しない。D1には集計済みの件数と時間だけを保存し、訪問者単位のデータを保存しない。

既存のプライバシーポリシーにはCloudflare Web Analyticsによるアクセス状況の計測を記載済みである。実装前に、実際にGraphQLで利用するデータセットと現在の説明が一致することを確認する。必要な場合は次を追記する。

* Cloudflareが集計した訪問数を本サイト上で表示すること
* D1には集計済み件数と対象時刻・取得時刻だけを保存すること
* 厳密な実人数を示すものではないこと

## 15. セキュリティ

* Analytics API Tokenは `wrangler secret put` で登録する。
* `.dev.vars`、`.env`、ログ、テストfixtureへ実Tokenを入れない。
* Tokenには対象Zoneの分析読み取りだけを許可する。
* GraphQLレスポンス全体をログへ出さない。
* ログには安全なイベント名、時間枠、HTTPステータス、エラーコードだけを残す。
* ブラウザからAnalytics APIへ到達できる経路を作らない。
* Cronを手動実行する公開HTTPエンドポイントを作らない。
* `GET /api/counts/latest` の既存WAF Rate Limiting方針を維持する。

## 16. 負荷と利用量

10分間隔では次の利用量になる。

| 項目 | 概算 |
| --- | ---: |
| Cron実行 | 144回/日 |
| Analytics API | 144回/日 |
| D1書き込み | 最大144行更新/日 |
| 月間Cron・API呼び出し | 約4,320回 |

D1には1行だけ保存する。Webアクセスが増えてもAnalytics APIとD1書き込みの回数は増えない。

WebアクセスごとのD1読み取りは、既存の `GET /api/counts/latest` 内で1行増える。60秒キャッシュが有効な場合、実際のD1読み取りはキャッシュミス時だけ発生する。

Workers PaidおよびD1 Paidの月間枠に対して小さい。実測値はCloudflare DashboardでWorkerリクエスト数、CPU時間、D1読み取り・書き込み行数を確認する。

## 17. エラー処理

| 障害 | 動作 |
| --- | --- |
| Analytics API 400・認証失敗 | D1を更新せず、設定エラーとして通知 |
| Analytics API 429 | D1を更新せず、次回Cronまで待つ |
| Analytics API 5xx・タイムアウト | D1を更新せず、次回Cronまで待つ |
| GraphQL `errors` または形式不正 | D1を更新せず、安全なエラーコードを記録 |
| D1保存失敗 | Analytics APIを再取得せず、保存だけ上限付きで再試行 |
| D1にデータなし | `visits: null` |
| 最終成功から30分超過 | `visits: null` |
| 訪問数のD1読み取り失敗 | X投稿件数はHTTP 200で返し、`visits: null` |

失敗時に0件を保存・表示しない。0件はAnalytics APIが正常に返した場合だけ有効な値として扱う。

## 18. 監視

最低限、次を確認する。

* Cronの実行回数、成功率、最終成功時刻
* Analytics APIのHTTPステータスと安全なエラーコード
* GraphQL APIの429件数
* D1の最新 `fetched_at`
* D1保存失敗と読み取り失敗
* `visits: null` のレスポンス比率
* Workerリクエスト数とCPU時間
* D1の読み取り・書き込み行数
* Counts APIキャッシュのHIT率

最終成功から30分を超えた場合は通知対象とする。

## 19. テスト

### 19.1 Analytics APIクライアント

* 正常レスポンスから0以上のVisit数を取得する。
* HTTP 200でもGraphQL `errors` があれば失敗にする。
* Zoneなし、複数Zone、グループなし、複数グループを拒否する。
* 負数、小数、文字列、null、安全整数超過を拒否する。
* 400、401、403、429、5xx、タイムアウトを安全なエラーへ変換する。
* Tokenやレスポンス本文をログへ出さない。
* 開始・終了時刻が正確に24時間差になる。
* Hostnameと `requestSource: eyeball` を必ず設定する。

### 19.2 D1

* 初回成功でsingleton行を作成する。
* 次回成功で同じ行を更新する。
* 古い実行が新しい `fetched_at` を上書きしない。
* API失敗時に既存行を変更しない。
* 0件を正常値として保存できる。
* 負数を保存できない。

### 19.3 Counts API

* 鮮度内の値を `visits` として返す。
* 行なしと30分超過で `visits: null` を返す。
* 訪問数取得失敗時もX投稿件数を返す。
* 既存レスポンス項目を変更しない。
* 不要なクエリ文字列を拒否する。
* HTTP 200だけを60秒キャッシュする。

### 19.4 フロントエンド

* 既存のfetch 1回だけで両方を描画する。
* 正常値、0件、`visits: null` を正しく扱う。
* 数字を3桁区切りで表示する。
* 訪問数の描画失敗がX投稿件数へ波及しない。
* アクセシビリティツリーで自然な文章として読み上げられる。

### 19.5 ステージング

* fixtureを使った自動テストの後、権限を限定したステージングTokenで実API疎通を確認する。
* GraphQL Schemaのフィールドと対象Zoneの利用可能範囲を確認する。
* Cron 1回につきAnalytics APIが1回だけ呼ばれる。
* D1のsingleton行だけが更新される。
* 30分超過データを画面へ表示しない。
* Webページ表示時のAPIリクエスト数が導入前と同じである。
* Cloudflare DashboardのVisitsと同じ時間範囲で概ね一致する。
* 再読み込みだけで不自然にVisit数が増えないことを、他トラフィックのない検証用ホストで確認する。

## 20. 導入手順

1. Cloudflare DashboardのVisitsとGraphQLクエリ結果を手動で比較する。
2. 最小権限の本番・ステージングAPI Tokenを作成する。
3. ステージングD1へmigrationを適用する。
4. API WorkerへAnalyticsクライアント、Scheduled handler、D1保存を実装する。
5. Counts APIへ訪問数と鮮度判定を追加する。
6. フロントエンドへ表示を追加する。
7. 必要に応じてプライバシーポリシーを更新する。
8. 自動テストを実行する。
9. ステージングでCron、D1、API、画面を確認する。
10. 本番D1へmigrationを適用する。
11. 本番API WorkerへSecretと環境変数を登録する。
12. API Worker、Web Workerの順にデプロイする。
13. 最終成功時刻、画面、利用量を監視する。

API Token、Cron、D1 migrationのすべてが揃うまで、画面の訪問数領域を有効にしない。

## 21. ロールバック

問題が発生した場合は次の順で戻す。

1. Web画面の訪問数領域を非表示にする。
2. `GET /api/counts/latest` から `visits` を外し、従来レスポンスへ戻す。
3. API WorkerのAnalytics Cronを無効化する。
4. 不要になったAPI Tokenを失効させる。

既存のX投稿件数、Bot Worker、D1の既存テーブルは継続する。`web_visit_count` は原因調査が完了するまで削除しない。

## 22. 完了条件

* [ ] Cronが10分ごとにAnalytics APIを1回だけ呼ぶ。
* [ ] 直近24時間のVisitsがD1の1行へ保存される。
* [ ] API失敗時に既存の成功値を上書きしない。
* [ ] 古い実行が新しいスナップショットを上書きしない。
* [ ] `GET /api/counts/latest` の1回でX投稿件数と訪問数を取得できる。
* [ ] Webページ表示時のAPIリクエスト数が増えていない。
* [ ] 30分を超えた古い訪問数を表示しない。
* [ ] 訪問数機能の障害がX投稿件数表示へ波及しない。
* [ ] API Tokenがブラウザ、ログ、D1、Gitに存在しない。
* [ ] 画面上の数値がCloudflare Dashboardと同じ時間範囲で概ね一致する。
* [ ] 表示とプライバシーポリシーが実際の集計方式と一致する。

## 23. 公式資料

* [Cloudflare GraphQL Analytics API](https://developers.cloudflare.com/analytics/graphql-api/)
* [Querying HTTP events by hostname](https://developers.cloudflare.com/analytics/graphql-api/tutorials/end-customer-analytics/)
* [GraphQL Analytics API limits](https://developers.cloudflare.com/analytics/graphql-api/limits/)
* [Account-based rate limiting](https://developers.cloudflare.com/analytics/graphql-api/account-based-rate-limiting/)
* [Cloudflare Zone Analytics](https://developers.cloudflare.com/analytics/account-and-zone-analytics/zone-analytics/)
* [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
* [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
* [Cloudflare Workers Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
