# 直近24時間の訪問人数表示 設計書

最終更新: 2026-10-24

## 1. 目的

Web版に、直近24時間に訪れた人数を表示する。

```text
この24時間に
42人が訪れました
```

単純なHTTPリクエスト数やページビュー数ではなく、同じ利用者による再読み込みを重複加算しない指標にする。Cloudflare Analytics APIは使用せず、既存のAPI WorkerとD1を利用して集計する。

## 2. 指標の定義

表示する値を、次のように定義する。

> 現在時刻から過去24時間以内に、本サイトがブラウザへ生成した匿名IDを使って訪問を通知した、異なるIDの数

同じ匿名IDはD1で1行だけ保持する。ページを再読み込みしても行数は増えず、直近24時間の人数も増えない。

ただし、この値は厳密な実人数ではない。

* 同じ人が複数の端末やブラウザを使うと、複数人として数える。
* ブラウザの保存データを削除した場合やプライベートブラウズでは、新しい匿名IDになることがある。
* 端末やブラウザを複数人で共有している場合は、1人として数えることがある。
* JavaScriptまたはブラウザ内の保存領域を無効にしている訪問は数えない。

画面上はUXを優先して単位を「人」とする。個人を識別できると誤認させる説明や、「正確な利用者数」などの表現は使用しない。集計方法と限界はプライバシーポリシーに記載する。

## 3. 要件

### 3.1 機能要件

* 直近24時間の匿名ID数を表示する。
* 同じ匿名IDによる再読み込みでは人数を増やさない。
* 24時間以内に再訪した場合は同じ1人として扱い、最終訪問時刻を更新する。
* 最終訪問から24時間を超えたIDは表示対象外にする。
* X投稿件数の表示に失敗を波及させない。
* 訪問登録に失敗しても、ページ本体とX投稿件数は表示する。
* 集計値が取得できない場合は、古い値を人数として断定せず、訪問人数の領域だけを非表示または取得失敗表示にする。

### 3.2 非機能要件

* 氏名、メールアドレス、Xアカウント、IPアドレス、User-AgentをD1へ保存しない。
* ブラウザで生成した匿名IDの生値をD1へ保存しない。
* 匿名IDをログへ出力しない。
* 不要なCORS公開を行わず、同一オリジンからだけ利用する。
* D1への重複書き込みと読み取り行数を抑える。
* APIの濫用による人数の水増しとWorker/D1負荷を抑える。
* 本番とPreviewでD1を分離する。

## 4. 対象外

初期実装では、次を行わない。

* ログインによる人単位の識別
* 端末をまたいだ重複排除
* IPアドレス、User-Agent、Canvasなどを組み合わせるブラウザフィンガープリント
* Cloudflare Analytics APIとの数値照合
* 国、参照元、端末などの属性別集計
* 過去の人数推移グラフ
* 厳密なリアルタイム表示

## 5. システム構成

```text
ブラウザ
  ├─ localStorageから匿名IDを取得
  │    └─ 未作成ならcrypto.randomUUID()で生成
  ├─ POST /api/visits
  │    ↓
  │  sleepless-web Worker
  │    ↓ Service Binding
  │  sleepless-api Worker
  │    ↓ SHA-256
  │  D1へupsert
  │
  └─ GET /api/counts/latest
       ↓
     sleepless-web Worker
       ↓ Service Binding
     sleepless-api Worker
       ├─ X投稿件数をD1から取得
       └─ 直近24時間の匿名ID数をD1から取得
```

既存の `GET /api/counts/latest` に訪問人数を追加し、人数取得専用のGETリクエストは増やさない。訪問登録用のPOSTだけが新しいリクエストになる。

## 6. ブラウザ側の匿名ID

### 6.1 保存

既存の実装計画でPresenceにも使用する予定のキーを使う。

```text
localStorage key: sleepless-anonymous-id
value: crypto.randomUUID()で生成したUUID
```

匿名IDはこのサービス内だけで使用し、外部の識別子や分析データと結合しない。将来「私も眠れない」機能を追加するときも同じIDを再利用し、ブラウザへ複数の識別子を作らない。

### 6.2 訪問通知の抑制

再読み込みのたびにPOSTしないよう、最後に訪問通知が成功した時刻も `localStorage` に保存する。

```text
localStorage key: sleepless-visit-reported-at
value: ISO 8601形式の日時
```

最後の成功から10分未満なら `POST /api/visits` を送信しない。10分以上経過した場合だけ通知する。これにより、短時間の再読み込みによるWorker呼び出しとD1クエリを減らす。

ローカルの時刻は送信抑制にだけ使用する。D1へ保存する訪問時刻はWorker側で生成し、クライアントから受け取らない。端末時刻が不正確な場合でも、24時間集計そのものを改変できないようにする。

`localStorage` が利用できない場合は訪問登録を行わない。リロードごとに一時IDを生成すると人数を水増しするため、メモリ上だけのIDへフォールバックしない。

## 7. データモデル

既存の本番D1 `sleepless-bot` に次のテーブルを追加する。現在のmigration管理場所に合わせ、`apps/bot/migrations/0005_create_anonymous_visitors.sql` として管理する。

```sql
CREATE TABLE anonymous_visitors (
  visitor_key TEXT PRIMARY KEY,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_anonymous_visitors_last_seen_at
ON anonymous_visitors(last_seen_at);
```

### 7.1 各列

| 列 | 用途 |
| --- | --- |
| `visitor_key` | UUID文字列をSHA-256でハッシュ化した16進文字列 |
| `first_seen_at` | 最初に登録した時刻 |
| `last_seen_at` | 最後に登録した時刻。直近24時間の判定に使用 |
| `created_at` | 行の作成時刻 |
| `updated_at` | 行の最終更新時刻 |

生のUUIDは保存しない。UUIDは十分なランダム性を持つため、サーバー側でSHA-256へ変換した値を主キーにする。暗号学的ハッシュであっても継続的に同じ利用者を区別する仮名識別子であるため、公開情報として扱わず、ログやAPIレスポンスへ出さない。

## 8. API設計

### 8.1 訪問登録

```http
POST /api/visits
Content-Type: application/json
Origin: https://sleepless-bot.com

{
  "anonymousId": "550e8400-e29b-41d4-a716-446655440000"
}
```

成功:

```http
HTTP/1.1 204 No Content
Cache-Control: no-store
```

エラー:

| 状態 | コード | 条件 |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | JSON不正、UUID不正、余分なフィールド |
| 403 | `ORIGIN_NOT_ALLOWED` | 許可していないOrigin |
| 405 | `METHOD_NOT_ALLOWED` | POST以外 |
| 413 | `PAYLOAD_TOO_LARGE` | 本文が上限を超える |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | JSON以外 |
| 429 | `RATE_LIMITED` | WAF等の制限超過 |
| 500 | `UNEXPECTED_ERROR` | 予期しない失敗 |
| 503 | `VISIT_STORAGE_UNAVAILABLE` | D1へ保存できない |

レスポンスには匿名ID、ハッシュ、D1の内部情報を含めない。失敗レスポンスはキャッシュしない。

### 8.2 UUID検証

* JSON本文の上限を1 KiBとする。
* オブジェクト直下に `anonymousId` だけを許可する。
* UUIDの標準的な文字列表現だけを受け付ける。
* 大文字・小文字を正規化してからハッシュ化する。
* クエリ文字列は受け付けない。

### 8.3 upsert

Workerが現在時刻をUTCのISO 8601形式で生成し、次の意味になるupsertを実行する。

```sql
INSERT INTO anonymous_visitors (
  visitor_key,
  first_seen_at,
  last_seen_at,
  created_at,
  updated_at
) VALUES (?1, ?2, ?2, ?2, ?2)
ON CONFLICT(visitor_key) DO UPDATE SET
  last_seen_at = excluded.last_seen_at,
  updated_at = excluded.updated_at
WHERE anonymous_visitors.last_seen_at <= ?3;
```

`?3` には現在時刻の10分前を渡す。クライアント側の抑制が回避されても、同じIDについて10分以内の更新をD1へ書き込まない。競合時も主キー制約によって行は増えない。

条件不成立で更新されなかった場合も、すでに訪問済みなのでHTTP 204を返す。

### 8.4 最新件数APIの拡張

既存の `GET /api/counts/latest` に次を追加する。

```json
{
  "windowStartAt": "2026-10-24T01:00:00Z",
  "windowEndAt": "2026-10-24T02:00:00Z",
  "fetchedAt": "2026-10-24T02:00:08Z",
  "postCount": 1284,
  "queryVersion": "v3",
  "visitors": {
    "count": 42,
    "windowHours": 24,
    "asOf": "2026-10-24T02:14:00Z"
  }
}
```

集計SQL:

```sql
SELECT COUNT(*) AS visitor_count
FROM anonymous_visitors
WHERE last_seen_at >= ?1;
```

`?1` はAPI Workerが生成した現在時刻の24時間前とする。`last_seen_at` のインデックスを使い、対象期間外の行を走査しない。

訪問人数だけの取得に失敗した場合、X投稿件数まで503にしない。次のように `visitors` を `null` にしてHTTP 200を返し、フロントエンドは人数領域だけをエラー状態にする。

```json
{
  "windowStartAt": "2026-10-24T01:00:00Z",
  "windowEndAt": "2026-10-24T02:00:00Z",
  "fetchedAt": "2026-10-24T02:00:08Z",
  "postCount": 1284,
  "queryVersion": "v3",
  "visitors": null
}
```

既存クライアントは追加フィールドを無視できるため、後方互換性を維持できる。

## 9. キャッシュ

`GET /api/counts/latest` のHTTP 200を60秒キャッシュする。[Counts API キャッシュ・レート制限ガイド](API_CACHE_RATE_LIMITING_GUIDE.md)の設計を適用し、X投稿件数と訪問人数を同じレスポンスとしてキャッシュする。

これにより、アクセスが集中してもD1の人数集計はキャッシュミス時だけ実行される。最大60秒の表示遅延を許容する。

`POST /api/visits` はキャッシュしない。登録直後のGETがキャッシュ済みの場合、本人を含む人数が最大60秒遅れて表示されることがある。訪問人数はリアルタイム性を保証しないため、この遅延を許容する。

## 10. 画面設計

X投稿件数のメッセージより下に、補助情報として表示する。

```text
この24時間に
42人が訪れました
```

表示上のルール:

* 0件の場合は「この24時間の訪問は、まだありません」と表示する。
* 1件でも単位は「人」とする。
* 3桁区切りを使用する。
* `visitors: null` の場合は「訪問人数を取得できませんでした」と表示するか、領域を非表示にする。
* 数字を競争や焦りにつなげる演出、通知バッジ、ランキング、急増表示は行わない。
* 人数取得中もX投稿件数の表示を妨げない。
* スクリーンリーダーには文章として読み上げられる構造にする。

## 11. 濫用対策

匿名IDはクライアントで生成できるため、攻撃者が異なるUUIDを大量送信すると人数を水増しできる。D1の主キーだけではこの攻撃を防げない。

初期実装では次を必須とする。

* `/api/visits` に送信元IP単位のWAF Rate Limitingを設定する。
* 通常利用は10分に1回であることを前提に、共有回線を誤遮断しない余裕を持たせた閾値から開始する。
* Web WorkerとAPI Workerの両方で、メソッド、クエリ文字列、Content-Type、本文サイズ、Originを検証する。
* D1や構造化ログにIPアドレスと匿名IDを保存しない。
* 1時間当たりの新規ID数と、WAFのBlock数を監視する。
* 異常増加時は訪問登録を一時停止できるよう、Worker環境変数によるkill switchを用意する。

初期閾値の候補は、1 IP当たり `20 requests / 10 minutes` とする。携帯回線や組織ネットワークのNATでは複数人が同じIPを共有するため、本番導入前に利用可能なCloudflareプランのカウント期間と通常トラフィックを確認して確定する。

分散した送信元からの意図的な水増しを完全には防げない。異常が継続する場合に限り、Turnstileの導入、異常値の表示停止、集計方式の見直しを行う。ブラウザフィンガープリントは採用しない。

## 12. データ保持と削除

表示対象は24時間だが、不具合調査と再訪時の重複抑制のため、匿名訪問レコードを30日間保持する。保持期間はプライバシーポリシーと一致させる。

API Workerに1日1回のCron Triggerを追加し、次を実行する。

```sql
DELETE FROM anonymous_visitors
WHERE last_seen_at < ?1;
```

`?1` は実行時刻の30日前とする。`last_seen_at` のインデックスを利用する。削除件数だけを構造化ログへ記録し、visitor keyは記録しない。

削除失敗はWeb表示を停止させないが、次回Cronで再試行する。連続失敗は通知対象とする。

利用者がブラウザ側の識別子を削除する方法として、サイトデータまたは `localStorage` の削除手順をプライバシーポリシーに記載する。サーバー側の個別削除要求へ対応する機能は初期実装に含めない。生の匿名IDを保存しないため、問い合わせから対象行を特定できないことも明記する。

## 13. プライバシーポリシーの変更

現在の「Cookieも使用していません」という説明だけでは不十分になる。リリース前に少なくとも次を追記する。

* Cookieは使わないが、匿名IDと最終通知時刻を `localStorage` に保存すること
* 利用目的は直近24時間の訪問人数集計と、将来のPresence重複防止に限定すること
* D1には匿名IDのハッシュ、初回・最終訪問時刻を保存すること
* IPアドレスや氏名等と結合しないこと
* サーバー側の保持期間は30日であること
* ブラウザのサイトデータを削除する方法
* 端末やブラウザをまたぐため、表示値は厳密な実人数ではないこと

プライバシーポリシーの改定日も更新する。

## 14. D1・Worker利用量

通常の1訪問通知は、主キー検索を伴うupsertを1回実行する。新しい匿名IDでは1行を追加し、同じIDの10分以内の再通知では書き込みを行わない。

人数取得は60秒キャッシュのミス時だけ行う。`last_seen_at` のインデックスにより、主に直近24時間の対象行を読み取る。

想定例:

* 1日1,000人
* 1人当たり平均2回の有効な訪問通知
* 訪問登録: 約2,000クエリ/日
* 新規行: 最大約1,000行/日
* 人数集計: 最大1,440回/日。ただしキャッシュ拠点数等により変動

Workers Paidの月間枠に対して十分小さい。実際の課金はD1の返却メタデータとCloudflare Dashboardで、読み取り行数・書き込み行数・Workerリクエスト数を確認する。

## 15. エラー処理

| 障害 | 動作 |
| --- | --- |
| `localStorage` 利用不可 | 訪問登録を行わず、人数表示だけ試みる |
| 訪問POST失敗 | ページとX投稿件数を表示し、次回訪問時に再試行 |
| 人数集計失敗 | `visitors: null` とし、X投稿件数は表示 |
| D1全体の障害 | 既存仕様どおりX投稿件数をエラー表示。古い人数を最新として表示しない |
| WAFによる429 | 訪問登録を諦め、画面全体は表示 |
| cleanup失敗 | 既存データを残し、翌日に再試行・連続失敗を通知 |
| 異常な人数増加 | kill switchでPOSTを停止し、人数表示を一時非表示にする |

## 16. テスト

### 16.1 API単体・結合テスト

* 新しいUUIDをPOSTすると1行作成される。
* 同じUUIDを連続POSTしても行数が増えない。
* 同じUUIDの10分以内のPOSTで `last_seen_at` が更新されない。
* 10分経過後のPOSTで `last_seen_at` が更新される。
* UUIDの生値がD1に保存されない。
* 24時間以内の行だけが集計される。
* 境界時刻の包含・除外が仕様どおりになる。
* 不正なUUID、JSON、Content-Type、Origin、本文サイズ、クエリ文字列を拒否する。
* 訪問人数の取得失敗時もX投稿件数をHTTP 200で返す。
* cleanupが30日より古い行だけを削除する。
* ログに匿名ID、ハッシュ、IPアドレスを出さない。

### 16.2 フロントエンドテスト

* 初回表示で匿名IDを作成し、訪問POSTを送る。
* 再読み込みしても10分以内はPOSTを送らない。
* 同じ匿名IDで人数が増えない。
* `localStorage` が使えなくてもページが表示される。
* 正常値、0件、`visitors: null` を正しく描画する。
* 数字を3桁区切りで表示する。
* X投稿件数と訪問人数の片方が失敗しても、もう片方を表示する。

### 16.3 ステージング確認

* PreviewがステージングD1だけへ書き込む。
* 複数ブラウザで人数が増える。
* 同一ブラウザの再読み込みでは増えない。
* 24時間経過相当のテストデータが対象外になる。
* WAF閾値をわずかに超え、429またはBlockとSecurity Eventsを確認する。
* キャッシュのMISS/HITと最大60秒の反映遅延を確認する。

## 17. 監視

導入後は次を確認する。

* `/api/visits` の成功、400、403、429、500、503件数
* 1時間ごとの新規匿名ID数
* 直近24時間の人数と前時間比
* D1の読み取り行数、書き込み行数、レイテンシ、overloadedエラー
* Workerリクエスト数とCPU時間
* Counts APIキャッシュのHIT率
* cleanupの削除件数と連続失敗
* WAFのBlock件数

通常値は公開後に実測し、急増率だけで自動的に利用者を遮断しない。異常判定はWAFイベント、参照元、Workerエラー等と合わせて行う。

## 18. 導入手順

1. ステージングD1へmigrationを適用する。
2. API Workerへ訪問登録、人数集計、cleanupを実装する。
3. Web Workerへ新しいAPIパスの転送と事前検証を追加する。
4. フロントエンドへ匿名ID、通知抑制、人数表示を実装する。
5. プライバシーポリシーを改定する。
6. 自動テストを追加する。
7. PreviewとステージングD1で動作確認する。
8. WAF Rate Limitingを設定して動作確認する。
9. 本番D1へmigrationを適用する。
10. API Worker、Web Workerの順に本番へ反映する。
11. D1・Worker・WAFの利用量とエラーを監視する。

WAFとプライバシーポリシーの準備が完了するまで、本番の訪問POSTを有効にしない。

## 19. ロールバック

問題が発生した場合は、次の順で影響を止める。

1. kill switchで `POST /api/visits` を503または204に固定し、D1書き込みを止める。
2. Web画面の訪問人数領域を非表示にする。
3. `GET /api/counts/latest` から `visitors` を外し、従来レスポンスへ戻す。
4. 必要に応じてAPI WorkerのCron Triggerを無効化する。

既存のX投稿件数機能とBot Workerは継続する。migrationで作成したテーブルは直ちに削除せず、原因調査と再リリース判断が完了するまで保持する。

## 20. 完了条件

* [ ] 初回訪問で人数へ反映される。
* [ ] 同一ブラウザの再読み込みで人数が増えない。
* [ ] 直近24時間を過ぎた訪問が人数から外れる。
* [ ] UUIDの生値、IPアドレス、User-AgentをD1とログへ保存しない。
* [ ] 訪問機能の障害がX投稿件数表示へ波及しない。
* [ ] GET成功レスポンスが60秒キャッシュされる。
* [ ] `/api/visits` のWAF Rate Limitingが有効である。
* [ ] cleanupが30日より古い行を削除する。
* [ ] プライバシーポリシーが実装内容と一致する。
* [ ] 本番とPreviewが別のD1を使用する。

## 21. 公式資料

* [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
* [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
* [Cloudflare Workers Cache](https://developers.cloudflare.com/workers/cache/)
* [Cloudflare WAF Rate Limiting](https://developers.cloudflare.com/waf/rate-limiting-rules/)
* [Web Crypto API: digest](https://developer.mozilla.org/docs/Web/API/SubtleCrypto/digest)
* [Web Storage API](https://developer.mozilla.org/docs/Web/API/Web_Storage_API)
