# 試作Webページ Cloudflare配信ガイド

最終更新: 2026-10-15

`prototypes/night-sky/` の試作ページ（HTML・CSS・画像だけの静的サイト）を、独自ドメインでCloudflareから配信するまでの流れをまとめる。

価格・仕様は2026-10-15時点の公式ページ等で確認した値であり、作業前に必ず最新の表示を確認すること。

---

## 1. 結論

| 項目 | 方針 |
| --- | --- |
| 配信方式 | **Cloudflare Workers の Static Assets**（Pagesではなく）。Cloudflareが新規プロジェクトにはWorkersを推奨しており、Phase 6の `/api/*` を同じWorkerに追加しやすい。詳細は[付録A](#付録a-workers-の静的配信と-pages-の違い) |
| ドメイン取得先 | **`.com` などの汎用ドメインなら Cloudflare Registrar**。`.jp` が欲しい場合だけ XServerドメイン |
| 公開の順序 | `workers.dev` で限定確認 → ドメイン取得 → カスタムドメイン接続 → 公開前チェック → 公開 |
| 月額費用 | 配信は無料枠で0円。かかるのはドメイン代（年約1,700円前後）だけ |

試作ページの件数（1,284件）と時刻はダミー値である。実データと誤認される状態で一般公開しないよう、[5. 公開範囲の注意](#5-試作段階の公開範囲の注意)に従う。

---

## 2. 全体の流れ

```text
1. 事前準備（Cloudflareアカウントの2段階認証、wranglerの確認）
        ↓
2. 配信用ディレクトリ apps/web-vanilla-js を作成し、試作ページを public/ にコピー
        ↓
3. ローカルで表示確認（wrangler dev）
        ↓
4. workers.dev へデプロイして実機確認（noindex付き）
        ↓
5. ドメインを取得（Cloudflare Registrar 推奨）
        ↓
6. Worker にカスタムドメインを接続（HTTPS証明書は自動発行）
        ↓
7. HTTPS強制・www転送などのゾーン設定
        ↓
8. 公開前チェック → noindex を外して公開
```

---

## 3. ドメインの取得先

### 3.1 料金比較（`.com`、1年あたり）

| | Cloudflare Registrar | XServerドメイン |
| --- | --- | --- |
| 新規取得（1年目） | $10.46（約1,570円） | **0円**（同社サービスの利用履歴がない新規会員の1ドメインだけ）。条件外は1,721円 |
| 更新（2年目以降） | **$10.46**（約1,570円）→ 2026-11-01から **$11.17**（約1,680円） | 1,721円 → 2026-11-09請求分から **1,750円** |
| 移管 | 更新と同額（期限が1年延長） | 更新と同額 |
| WHOIS情報の非公開 | 無料 | 無料（Whois代理公開） |
| 価格の決まり方 | レジストリ原価＋ICANN手数料。上乗せなし。原価が上がった分だけ上がる | 独自価格。キャンペーンで変動 |
| 支払い | 米ドル（クレジットカード / PayPal）。カード会社の海外事務手数料が別途かかる場合あり | 日本円 |
| `.jp` | **取得・移管とも不可** | 可（更新3,102円） |

円換算は1ドル=150円で計算した目安。Cloudflare側は為替次第で上下するため、更新料の差は年100円前後で、ほぼ同等と考えてよい。

参考:

* [Cloudflare Registrar（料金）](https://domains.cloudflare.com/)
* [Cloudflare TLDポリシー（対応TLD一覧）](https://www.cloudflare.com/ja-jp/tld-policies/)
* [.com 卸値改定（2026-11-01、ICANN）](https://itp.cdn.icann.org/en/files/registry-agreements/com/com-fees-01-11-2026-en.pdf)
* [XServerドメイン 価格一覧](https://www.xdomain.ne.jp/domain/price.php)
* [XServerドメイン 更新・移管料金の改定（2026-11-09）](https://www.xdomain.ne.jp/news_detail.php?view_id=19639)

### 3.2 運用面の違い

| | Cloudflare Registrar | XServerドメイン |
| --- | --- | --- |
| ネームサーバー変更 | 不要。取得した時点でCloudflareのDNSで有効になる | 必要。Cloudflareのネームサーバーへ変更し、反映（最大24〜48時間）を待つ |
| 管理画面 | Botと同じCloudflareアカウントで完結 | XServerアカウントとCloudflareの2か所 |
| ネームサーバーの自由度 | Cloudflare以外へ変更できない（変えたい場合は他社へ移管） | 自由 |
| Workersのカスタムドメイン | そのまま使える | ネームサーバーをCloudflareへ向けた後なら使える |

Workersのカスタムドメインは、**ネームサーバーがCloudflareで管理されているドメインでしか使えない**。どちらで取得しても最終的にDNSはCloudflareに置くことになるため、Cloudflare Registrarならその手間が丸ごと省ける。

### 3.3 推奨

1. **`.com` / `.net` / `.app` / `.dev` などで良い → Cloudflare Registrar で取得する。** 更新料が原価で、将来も値上げは原価分だけ。DNS設定の手間と待ち時間もない。
2. **1年目を0円にしたい → XServerドメインで取得し、ネームサーバーだけCloudflareへ向ける。** 2年目以降も安く維持したければ、取得から60日経過後（ICANNの移管制限）にCloudflare Registrarへ移管できる。移管料は1年分の更新料と同額で、期限も1年延びるので損はない。
3. **`.jp` にしたい → XServerドメイン一択**（Cloudflare Registrarは非対応）。DNSだけCloudflareへ向ける。

差額は初年度の約1,600円だけで、2年目以降はほぼ同じ。手順が少なく、Botと同じアカウントで管理できる **1. を推奨** する。

---

## 4. 配信の準備

### 4.1 事前準備

* Botで使っているCloudflareアカウントをそのまま使う（`sleepless-bot.workers.dev` のサブドメインを持つアカウント）。
* ドメインと課金情報を扱うため、Cloudflareアカウントの2段階認証を有効にしておく。
* `wrangler` は `apps/bot` と同じバージョン（`4.70.0`）を使う。ログイン済みか確認する。

```sh
cd apps/bot
npx wrangler whoami
```

### 4.2 ディレクトリ構成

実装計画（Phase 6）の配置に合わせ、配信用に `apps/web-vanilla-js` を作り、試作ページを `public/` にコピーする。`prototypes/night-sky/` は試作の記録として残す。

```text
apps/web-vanilla-js/
├── public/                 # このディレクトリの中身だけが公開される
│   ├── index.html
│   ├── privacy.html
│   ├── _headers            # レスポンスヘッダー設定（ファイル自体は公開されない）
│   ├── images/
│   │   └── night-sky.webp
│   └── styles/
│       ├── common.css
│       └── photo.css
├── package.json
└── wrangler.jsonc
```

```sh
mkdir -p apps/web-vanilla-js/public
cp -R prototypes/night-sky/. apps/web-vanilla-js/public/
```

`wrangler.jsonc` や `package.json` を `public/` に入れないこと。`assets.directory` 配下はすべて公開される。

### 4.3 `wrangler.jsonc`

静的ファイルだけなので `main`（Workerスクリプト）は不要。

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "sleepless-web",
  "compatibility_date": "2026-10-15",
  "assets": {
    "directory": "./public",
    "not_found_handling": "404-page"
  },
  // カスタムドメインを接続するまでは workers.dev で確認する。
  "workers_dev": true
}
```

* `not_found_handling: "404-page"` は `public/404.html` があればそれを返す。なければ省略してよい。
* 既定の `html_handling`（`auto-trailing-slash`）により、`/privacy.html` へのアクセスは `/privacy` へ転送される。既存のリンクはそのまま動く。

### 4.4 `package.json`

```json
{
  "name": "@sleepless/web-vanilla-js",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "wrangler": "4.70.0"
  }
}
```

```sh
cd apps/web-vanilla-js
npm install
```

### 4.5 `public/_headers`

外部スクリプト・インラインスタイル・外部フォントを使っていないため、厳しめのContent Security Policyをそのまま適用できる。試作段階は `X-Robots-Tag: noindex` を付けて検索エンジンに載せない。

```text
/*
  X-Robots-Tag: noindex
  Content-Security-Policy: default-src 'none'; img-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()

/images/*
  Cache-Control: public, max-age=604800
```

JavaScriptやAPI呼び出しを追加するとき（Phase 6）は、`script-src 'self'` と `connect-src 'self'` をCSPに追加する。

### 4.6 ローカル確認

```sh
cd apps/web-vanilla-js
npm run dev
```

`http://localhost:8787` で、トップページ・プライバシーポリシー・背景画像・スマートフォン幅の表示を確認する。

---

## 5. 試作段階の公開範囲の注意

試作ページは件数・時刻がダミーで、「この1時間で…1,284件ありました」と実データのように表示される。実装計画の本番リリース基準（Counts取得失敗時に誤った件数を公開しない）に照らし、次のいずれかを満たすまでは一般公開しない。

* `apps/api` と接続して実データを表示する（Phase 6）。
* もしくは画面上に「表示はサンプルです」と明記する。

それまでの確認は次のように限定する。

* `_headers` の `X-Robots-Tag: noindex` を外さない。
* URLをXのプロフィールやBot投稿に載せない。
* 第三者にも見せずに確認したい場合は、Workerの設定で `workers.dev` とプレビューURLに **Cloudflare Access** を有効にし、自分のメールアドレスだけを許可する（Zero Trustの無料枠で足りる）。

---

## 6. workers.dev へのデプロイ

```sh
cd apps/web-vanilla-js
npm run deploy
```

成功すると `https://sleepless-web.sleepless-bot.workers.dev` のようなURLが表示される。スマートフォン実機（iPhone Safari / Android Chrome）で次を確認する。

* 背景画像・カードの表示、文字の折り返し
* プライバシーポリシーへの遷移と戻り
* Xリンク・相談窓口リンクが新しいタブで開く
* レスポンスヘッダーが付いている（`curl -I https://<workers.devのURL>/`）

---

## 7. ドメインの取得

使うホスト名を先に決める。例: `sleepless-xxx.com`（ルートドメインで配信し、`www` はルートへ転送する）。

### 7.1 Cloudflare Registrar で取得する場合（推奨）

1. Cloudflareダッシュボード → **ドメインの登録（Domain Registration）** → **ドメインを登録（Register Domains）**。
2. 希望のドメイン名を検索し、TLDと年数を選ぶ。
3. 登録者情報（氏名・住所・メールアドレス）を入力する。WHOISでは自動的に非公開になる。
4. 支払い方法を登録して購入する。**自動更新が有効になっていることを確認する。**
5. ICANNの規定により、登録者メールアドレスの確認メールが届くので、期限内にリンクを開く（放置するとドメインが停止される）。
6. 購入したドメインがCloudflareのゾーン（Webサイト一覧）に自動で追加され、すぐにDNSが有効になる。

### 7.2 XServerドメインで取得する場合

1. XServerドメインで取得する（初回0円の条件を確認）。自動更新を有効にする。
2. Cloudflareダッシュボード → **ドメインを追加（Onboard a domain）** → 取得したドメインを入力 → **Freeプラン** を選ぶ。
3. Cloudflareに表示される2つのネームサーバー（`xxx.ns.cloudflare.com`）を控える。
4. XServerアカウント → **ドメイン** → 対象ドメインの **ネームサーバー設定** → 「その他のネームサーバーを使用」で、3.の2つを入力する。
5. DNSSECを有効にしている場合は、変更前にXServer側で無効にしておく（有効のまま変更すると名前解決できなくなる）。
6. Cloudflareでゾーンが **Active** になるまで待つ（通常数分〜数時間、最大48時間）。Activeになったらメールで通知される。
7. 安定したら、Cloudflareの **DNS → 設定** でDNSSECを有効にし、表示されたDSレコードをXServer側に登録する（任意）。

取得から60日経過後にCloudflare Registrarへ移管する場合は、XServer側でドメインロックを解除して認証コード（AuthCode）を取得し、Cloudflareダッシュボードの **ドメインの移管（Transfer Domains）** で申請する。

---

## 8. カスタムドメインの接続

ゾーンがActiveになったら、Workerにドメインを接続する。DNSレコードとHTTPS証明書はCloudflareが自動で作成する。

`wrangler.jsonc` に `routes` を追加して再デプロイする。

```jsonc
{
  // ...
  "routes": [
    { "pattern": "sleepless-xxx.com", "custom_domain": true }
  ],
  "workers_dev": false
}
```

```sh
npm run deploy
```

ダッシュボードで行う場合は **Workers & Pages → sleepless-web → 設定 → ドメインとルート → 追加 → カスタムドメイン**。

既存のDNSレコード（A / CNAME）が同じホスト名にあると接続に失敗するので、先に削除しておく。`workers_dev: false` にすると `workers.dev` のURLは無効になり、配信先が独自ドメインに一本化される。

---

## 9. ゾーンの設定

Cloudflareダッシュボードの対象ドメインで設定する。

| 設定 | 場所 | 値 |
| --- | --- | --- |
| HTTPSへ強制転送 | SSL/TLS → 証明書 → **常にHTTPSを使用** | オン |
| 最低TLSバージョン | SSL/TLS → 証明書 → 最小TLSバージョン | 1.2 |
| `www` → ルートへ転送 | ルール → **リダイレクトルール** → テンプレート「WWWからルートへリダイレクト」 | 301。`www` にプロキシ有効（オレンジ雲）のDNSレコードが必要なので、なければ `AAAA www 100::` を作成する |
| HSTS | SSL/TLS → 証明書 → HSTS | 公開後しばらく安定してから有効化（最初は `max-age` を短く） |

プライバシーポリシーには「Cookieや、閲覧状況を計測するツールも使用していません」と書いている。次の機能を有効にする場合は、先にポリシーを更新すること。

* **Web Analytics**（Cookieは使わないが計測ツールに当たる）
* **Bot Fight Mode / Turnstile** など（`__cf_bm` などのCookieを付与することがある）

---

## 10. 公開前チェック

* [ ] 件数がダミーではない、または「サンプル」と明記されている（[5.](#5-試作段階の公開範囲の注意)）
* [ ] `https://ドメイン/` と `https://ドメイン/privacy` が表示される
* [ ] `http://` と `www.` がそれぞれ `https://ルートドメイン` に転送される
* [ ] `curl -I` でCSPなどのヘッダーが付いている
* [ ] iPhone Safari / Android Chrome で表示崩れがない
* [ ] プライバシーポリシーの内容が実際の構成（Cloudflare配信・Cookieなし）と一致している
* [ ] フッターの写真クレジット（NPS / Jacob W. Frank）が残っている
* [ ] ドメインの自動更新が有効で、登録者メールアドレスの確認が済んでいる

すべて満たしたら、`_headers` から `X-Robots-Tag: noindex` を削除して再デプロイする。Xのプロフィールに載せるのはこの後にする。

---

## 11. 更新とロールバック

```sh
cd apps/web-vanilla-js
npm run deploy                 # 更新
npx wrangler deployments list  # デプロイ履歴
npx wrangler rollback          # 直前のバージョンへ戻す
```

ダッシュボードの **Workers & Pages → sleepless-web → デプロイ** からも、過去のバージョンへ戻せる。

GitHubへのpushで自動デプロイしたい場合は、**Workers Builds**（Workerの設定 → ビルド → リポジトリを接続）でこのリポジトリを接続し、ルートディレクトリを `apps/web-vanilla-js`、デプロイコマンドを `npx wrangler deploy` にする。mainブランチ以外のpushはプレビューURLとして配信できる。最初は手動デプロイで十分。

---

## 12. 費用のまとめ

| 項目 | 費用 |
| --- | --- |
| Workers Static Assets（静的ファイルの配信） | 0円（静的ファイルへのリクエストは無料・無制限） |
| HTTPS証明書（Universal SSL） | 0円 |
| DNS（Freeプラン） | 0円 |
| ドメイン（`.com`） | Cloudflare: 年$10.46（2026-11-01から$11.17）／ XServer: 初年0円、更新1,721円（2026-11-09から1,750円） |

Phase 6で `apps/api` などWorkerスクリプトを追加すると、スクリプトの実行回数がWorkersの無料枠（1日10万リクエスト）の対象になる。

---

## 13. Phase 6 への接続

実データ表示（Phase 6）では、同じオリジンの `/api/*` をAPIで処理する。方法は次の2通りで、どちらでもフロントエンドの配信設定は大きく変わらない。

* **APIを別Workerにする（実装計画どおり）**: `apps/api` のWorkerに `{ "pattern": "sleepless-xxx.com/api/*", "zone_name": "sleepless-xxx.com" }` のルートを割り当てる。同じホスト名ではルートがカスタムドメインより優先されるため、`/api/*` だけが `apps/api` に届き、それ以外は `sleepless-web` が返す。
* **同じWorkerにまとめる**: `sleepless-web` に `main` を追加し、`assets.run_worker_first: ["/api/*"]` で `/api/*` だけWorkerスクリプトを先に実行する。

`_headers` はWorkerスクリプトが返すレスポンスには適用されないため、APIのレスポンスヘッダーはWorkerのコード側で付ける。

---

## 付録A. Workers の静的配信と Pages の違い

静的ページを置くだけなら、どちらも機能・料金はほぼ同じである。差が出るのは、Phase 6以降にAPIやD1を足すとき、既存Botとの運用の揃えやすさ、Cloudflareの今後の方針の3点である。

### A.1 それぞれの位置付け

* **Pages**: 静的サイト向けの製品。GitHubと接続するとビルド・デプロイを自動で行う。サーバー側の処理が必要な場合は、Pages Functions（`functions/` 配下のファイル名がそのままURLになる仕組み）を追加する。
* **Workers の静的配信（Static Assets）**: プログラムを動かすWorkersに、静的ファイルを同梱して配信する方式。コードなしでファイルだけを配信でき、必要になったら同じWorkerにコードを足せる。

Cloudflareは[Pagesのドキュメント](https://developers.cloudflare.com/pages/get-started/)の冒頭で「新しいプロジェクトはWorkersで始める」よう案内しており、[PagesからWorkersへの移行ガイド](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)も公開している。Pagesは廃止予定ではないが、新機能はWorkers側に入っていく。

### A.2 機能比較

| | Workers の静的配信 | Pages |
| --- | --- | --- |
| 静的ファイル配信の料金 | 無料・無制限 | 無料・無制限 |
| `_headers` / `_redirects` | 対応 | 対応 |
| プレビューURL・ロールバック | あり | あり |
| 設定方法 | `wrangler.jsonc`（Botと同じ） | Pages独自の設定（ダッシュボード中心） |
| D1などのbinding | Botと同じ書き方 | Pages側で別途設定 |
| Cron Triggers | 使える | 使えない |
| `/api/*` など一部パスだけ処理を分ける | `run_worker_first`・ルートで可能 | Functionsのファイルベースのルーティングに限られる |
| Workers Logs / Tail | あり | なし |
| 段階的デプロイ（一部の利用者だけに新版を出す） | あり | なし |
| Cloudflare以外でDNSを管理するドメインの接続 | **不可** | 可 |
| GitHub連携の自動デプロイ | Workers Builds（後から設定） | 標準で組み込み |

### A.3 Workersを選ぶ理由

1. **Phase 6の `/api/*` を同一オリジンで素直に作れる。** 実装計画では、フロントエンドと同じドメインの `/api/counts/latest` でD1の最新件数を返す。Workersなら、同じWorkerに `run_worker_first: ["/api/*"]` でAPIを足す方法と、`apps/api` を別Workerにして `/api/*` のルートを割り当てる方法のどちらも使える（[13.](#13-phase-6-への接続)）。Pagesでも実現できるが、Pages Functionsという別の仕組みを覚える必要がある。
2. **既存Botと同じ道具・手順で運用できる。** `apps/bot` はWorkersで動いている。Webも `wrangler.jsonc` で設定し、`wrangler deploy` でデプロイし、D1は `d1_databases` で接続し、障害時はWorkers Logsを見る、という手順に揃えられる。Pagesにすると、Webだけ設定画面・デプロイ方法・ログの見方が異なる。一人で運用する前提では、仕組みが少ないほど事故が減る。
3. **Pagesの最大の利点が今回は効かない。** Pagesの明確な利点は、Cloudflare以外でDNSを管理するドメインも接続できることである。今回はCloudflare Registrarで取得する（XServerで取得する場合もネームサーバーはCloudflareへ向ける）ため、この差は関係しない。
4. **後からの移行作業が不要になる。** Pagesで始めると、いずれWorkersへの移行を検討する可能性が高い。最初からWorkersにしておけばその手戻りがない。

### A.4 Workersの弱点

* GitHubへのpushで自動公開する仕組みは、Pagesの方が最初から手軽である。Workersでも Workers Builds で同じことができ、現状の規模なら手動の `npm run deploy` で十分である（[11.](#11-更新とロールバック)）。
* 独自ドメインはCloudflareで管理するものに限られる（今回は問題にならない）。
* Workerにコードを足すと、その実行回数がWorkersの無料枠（1日10万リクエスト）に数えられる。ただしPages Functionsも同じ枠を使うため差はない。静的ファイルの配信はどちらでも無料・無制限のままである。
