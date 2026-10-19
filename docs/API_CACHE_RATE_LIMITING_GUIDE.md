# Counts API キャッシュ・レート制限ガイド

最終更新: 2026-10-18

## 1. 目的と現在の状態

公開エンドポイント `GET /api/counts/latest` に対する大量アクセスから、Worker、D1、利用枠を保護する。

このガイドの内容は設計・導入手順であり、現時点では未実装である。導入時はエッジキャッシュとWAFレート制限を別々の防御として設定し、両方を有効にする。

## 2. エッジキャッシュとレート制限の違い

| 機能 | 目的 | 実行位置 | 防げるもの |
| --- | --- | --- | --- |
| Workers Cache | 同じ成功レスポンスを再利用する | API Workerの実行前 | Worker CPUとD1への重複アクセス |
| WAF Rate Limiting | 短時間に大量送信するクライアントを拒否する | Web Workerの実行前 | リクエスト数、Worker呼び出し、キャッシュ回避を含む濫用 |

キャッシュはレート制限の代わりにはならない。Workers Cacheのヒットでも標準のWorkerリクエストとして計上される。また、クエリ文字列はキャッシュキーに含まれるため、攻撃者が値を変え続けると別々のキャッシュエントリを作れる。不要なクエリはWeb Workerで拒否し、その手前にWAFレート制限を置く。

```text
ブラウザ
  ↓
Cloudflare WAF Rate Limiting
  ↓
sleepless-web Worker
  ↓ Service Binding
sleepless-api Workers Cache
  ↓ キャッシュミス時だけ
sleepless-api Worker
  ↓
D1
```

## 3. 採用する初期設定

* キャッシュ対象は `GET /api/counts/latest` のHTTP 200だけとする。
* TTLは60秒とする。元データは1時間単位なので、最大60秒の表示遅延を許容する。
* 404、405、500、503は `Cache-Control: no-store` とし、障害応答を残さない。
* クエリ文字列は仕様上不要なので、Service Bindingを呼ぶ前に拒否する。
* WAFは `/api/counts/latest` だけを対象とし、キャッシュヒットもカウントする。
* Freeプランで開始する場合は、送信元IPごとに30リクエスト/10秒、超過後10秒Blockを初期値とする。
* Security Analyticsで通常時のリクエスト数を確認し、誤検知または過剰な余裕があれば閾値を調整する。

送信元IP単位では、携帯回線や組織ネットワークのNAT配下にいる複数利用者が同じカウンターを共有する可能性がある。そのため、通常利用の1リクエストに対して十分余裕のある値から開始する。

## 4. Workers Cacheの実装

CloudflareのWorkers Cacheを使う。手動の `caches.default` は採用しない。Workers Cacheはキャッシュヒット時にWorkerを実行せず、Service Binding呼び出しにも対応し、同一キーへの同時キャッシュミスをまとめられるため、このAPIに適している。

### 4.1 API Workerでキャッシュを有効化

`apps/api/wrangler.jsonc` の互換日付をWorkers Cache対応日に更新し、次を追加する。

```jsonc
{
  "compatibility_date": "2026-10-18",
  "cache": {
    "enabled": true
  }
}
```

キャッシュはAPI Workerだけで有効化する。Web Worker全体をキャッシュ対象にしない。

### 4.2 成功レスポンスだけキャッシュする

`apps/api/src/index.js` の共通 `no-store` ヘッダーを、成功用と非成功用に分ける。

```js
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

const SUCCESS_HEADERS = {
  ...NO_STORE_HEADERS,
  "Cache-Control": "public, max-age=60",
};
```

`loadDisplayCount()` が成功したHTTP 200だけ `SUCCESS_HEADERS` を使う。404、405、`CountsUnavailableError`、予期しないエラーには引き続き `NO_STORE_HEADERS` を使う。

### 4.3 不要なクエリをWeb Workerで拒否する

Workers Cacheのキーにはパスとクエリ文字列が含まれる。`apps/web/src/index.js` で、Service Bindingを呼ぶ前にクエリ付きCounts APIを拒否する。

```js
export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/counts/latest" && url.search) {
      return Response.json({ error: "NOT_FOUND" }, {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (url.pathname.startsWith("/api/")) return env.API.fetch(request);
    return env.ASSETS.fetch(request);
  },
};
```

API Worker側でもクエリを拒否して多層防御にする。ただし、D1保護のためにWeb Worker側で先に止めることが重要である。

### 4.4 ブラウザのキャッシュ無効化を外す

`apps/web/public/scripts/api/counts.js` の次の指定を削除する。

```js
cache: "no-store",
```

ブラウザの通常のキャッシュ動作と、APIが返す60秒の `Cache-Control` に従わせる。

### 4.5 テスト

最低限、次を自動テストへ追加する。

* HTTP 200が `Cache-Control: public, max-age=60` を返す。
* 404、405、500、503が `Cache-Control: no-store` を返す。
* `/api/counts/latest?x=1` がWeb Workerで拒否され、API Service Bindingを呼ばない。
* クエリなしの `/api/counts/latest` は従来どおりAPIへ転送される。

本番反映後は、GETを2回実行して `Cf-Cache-Status` を確認する。`curl -I` はHEADになり、このAPIはGETだけを許可しているため使用しない。

```sh
curl -sS -D - -o /dev/null https://sleepless-bot.com/api/counts/latest
curl -sS -D - -o /dev/null https://sleepless-bot.com/api/counts/latest
```

最初が `MISS`、2回目が `HIT` になり、成功応答に `Cache-Control: public, max-age=60` があることを確認する。デプロイ直後はWorkerバージョンごとにキャッシュが空になるため、最初のリクエストが `MISS` になるのは正常である。

## 5. WAF Rate Limitingの設定

WAFルールはGit管理外のCloudflareゾーン設定なので、ダッシュボードで作成する。

1. Cloudflare Dashboardで `sleepless-bot.com` のゾーンを開く。
2. **Security → Security rules** を開く。
3. **Create rule → Rate limiting rules** を選ぶ。
4. ルール名を `limit-counts-api` とする。
5. 対象条件を `URI Path equals /api/counts/latest` とする。
6. カウント特性は送信元IPを使う。
7. Freeプランでは `30 requests / 10 seconds` を初期値にする。
8. アクションを `Block`、mitigation timeoutを10秒にする。
9. キャッシュ済みリクエストもレート制限のカウント対象にする。
10. ルールをDeployする。

Freeプランではゾーン当たり1ルール、条件に使える主なフィールドはPath、カウント期間は10秒、カウント特性はIPである。プランを変更した場合は、Security Analyticsの実測に基づいて `60 requests / 60 seconds` などへ調整してよい。

### 5.1 動作確認

* 通常アクセスでHTTP 200になる。
* 短時間の連続アクセスで、一部がHTTP 429または設定したBlock応答になる。
* CloudflareのSecurity Eventsに `limit-counts-api` のイベントが記録される。
* 制限解除後に通常アクセスへ戻る。
* 一般利用者の通常表示や再読み込みで誤検知しない。

本番で連続アクセス試験を行う場合は、自分のIPが一時的に遮断される前提で実施する。高負荷試験は行わず、設定閾値をわずかに超える回数に留める。

## 6. Workers Rate Limiting Bindingを採用しない理由

Worker内のRate Limiting Bindingでも制限できるが、今回はWAFを優先する。

* WAFはWeb Workerの実行前に拒否できる。
* 公開・匿名APIでは安定したユーザーIDやAPIキーがなく、Bindingへ渡す適切なキーがない。
* Workers Rate Limitingはロケーション単位かつ結果整合性が緩く、正確な課金カウンター用途ではない。
* ダッシュボードのSecurity EventsでWAFルールの動作を確認しやすい。

将来ログインや匿名セッションIDを導入し、利用者単位・機能単位の細かな制御が必要になった場合は、WAFに加えてBindingを検討する。

## 7. 定期生成した結果をKV等から配信する案

初期導入では行わない。現在のD1クエリは `window_start_at` のインデックスを使い、直近の対象行を効率的に取得できる。60秒キャッシュは同一レスポンスの重複読み取りをさらに減らせるが、主目的は突発的なアクセス増加時のD1負荷とレイテンシを抑えることである。この段階では、表示用データをKVへ二重保存する複雑さを追加しない。

次のいずれかが継続して発生した場合に検討する。

* キャッシュ導入後もD1読み取り量またはレイテンシが問題になる。
* D1障害時にも最後の成功値を表示したい。
* APIの種類が増え、表示用レスポンスを事前生成する必要がある。

採用する場合は、BotのCronがD1保存後に表示用JSONをKVへ書き、APIはKVを読む。ただし、D1成功・KV失敗時の扱い、KVの結果整合性、古い値の判定、復旧手順を追加で設計する。

## 8. 監視と調整

導入後は次を確認する。

* `Cf-Cache-Status` の `HIT` / `MISS` / `BYPASS`
* Worker呼び出し数とCPU時間
* D1の読み取り行数とエラー率
* WAFのBlock件数と送信元傾向
* APIの500・503件数
* 利用者からの誤遮断報告

最初の1週間は毎日確認し、その後は週次またはアラートベースへ移行する。閾値変更時は、変更日、旧値、新値、理由を運用記録へ残す。

## 9. ロールバック

キャッシュに問題がある場合は、API Workerの `cache.enabled` を外し、全レスポンスを `Cache-Control: no-store` に戻し、ブラウザ側の `cache: "no-store"` を戻す。Workerの新しいバージョンは既定で別キャッシュになるため、通常は旧バージョンのキャッシュを明示削除する必要はない。

WAFで誤遮断がある場合は、`limit-counts-api` を無効化するか閾値を引き上げる。キャッシュとWAFは独立しているため、片方だけをロールバックできる。

## 10. 完了チェックリスト

* [ ] 成功応答だけが60秒キャッシュされる。
* [ ] エラー応答はキャッシュされない。
* [ ] 不要なクエリがService Bindingの前で拒否される。
* [ ] 2回目のGETで `Cf-Cache-Status: HIT` を確認した。
* [ ] WAFの `limit-counts-api` をDeployした。
* [ ] 閾値超過時のBlockとSecurity Eventsを確認した。
* [ ] 通常の画面表示で誤遮断がない。
* [ ] D1読み取り量とWorker CPU時間が導入前より減っている。

## 11. 公式資料

* [Cloudflare Workers Cache](https://developers.cloudflare.com/workers/cache/)
* [Workers Cache keys](https://developers.cloudflare.com/workers/cache/cache-keys/)
* [WAF Rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)
* [ダッシュボードでRate Limiting Ruleを作成する](https://developers.cloudflare.com/waf/rate-limiting-rules/create-zone-dashboard/)
* [Workers Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
