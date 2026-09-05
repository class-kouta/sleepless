# Sleepless 実装計画

## 進捗・再開メモ

最終更新: 2026-09-05

### フェーズ進捗

- [x] Phase 0: リポジトリ初期設定
- [x] Phase 1: ローカルから固定文字列を投稿
  - OAuth 2.0 Authorization Code + PKCEでBotアカウントを認可済み
  - Recent Post Countsを取得済み（`眠れない lang:ja -is:retweet`）
  - Botアカウントから固定文字列のテスト投稿を確認済み
- [ ] Phase 2: Cloudflare Workerから固定文字列を投稿 **← 次に着手するフェーズ**
- [ ] Phase 3: Cronによる固定文字列の自動投稿
- [ ] Phase 4: 「眠れない」投稿数を取得して動的投稿
- [ ] Phase 5: Webアプリ最小版

### 次回の作業開始地点（Phase 2）

- [ ] `apps/bot` をCloudflare Workerの構成へ移行する
- [ ] X APIの認証情報をCloudflare Secretsへ登録する
- [ ] ステージング環境だけで使える、保護された手動テスト投稿を用意する
- [ ] Cloudflare Workerから固定文字列を投稿できることを確認する

### 現在のローカル作業状態

* READMEのPhase 1完了記録と、`apps/bot` のローカル検証用コードはコミット前である。
* 実トークンを含む `apps/bot/.env` はGit管理しない。再開時も値をログやコミットへ出さない。
* 再開時は `git status --short` で未コミット差分を確認してから作業する。

## 1. 概要

### 1.1 プロダクトの目的

眠れない夜に、

> 「今この瞬間も、眠れなくて起きているのは自分だけではない」

と感じられる場所を作る。

睡眠を直接改善することよりも、眠れない時間に感じる孤独感や不安を和らげることを主目的とする。

最終的には、Xを開かなくてもWebアプリ / PWAから「眠れない仲間の存在」を確認し、そのままスマートフォンを閉じられる体験を目指す。

---

## 2. 基本方針

以下の順序で段階的に実装する。

1. X Botを最小構成で動かす
2. Botを自動化する
3. X上の「眠れない」投稿数をBotに表示する
4. HTML・Tailwind CSS・素のJavaScriptでWebアプリを作る
5. Webアプリ独自の「今ここにいる人」機能を追加する
6. PWA化する
7. 利用状況を見ながら機能・収益化を検討する

最初から完成形を作らず、各フェーズで実際に利用できる状態を作る。

## 2.1 MVPで先に確定する運用上の決定

公開投稿と外部データを扱うため、以下は実装着手前に固定する。

* X APIの利用可能な契約・利用上限・Developer Termsを確認し、投稿APIとCounts APIの両方を実行できることを検証する。
* Counts APIはBearer Token、投稿はBotアカウントとして投稿できるユーザー文脈の認証情報を使用する。採用するOAuth方式、トークンの更新・失効時の手順をREADMEの運用手順に記載する。
* 投稿対象はJSTの毎正時に終わる、直前の1時間の固定枠とする。実行開始時刻を基準にした相対的な1時間では集計しない。
* Counts APIの取得に失敗した時間帯は投稿しない。前回の件数を「この1時間」の値として再利用しない。
* 公開投稿は冪等に実行する。同じ集計枠については成功・失敗を問わず実行状態を記録し、投稿成功済みなら再投稿しない。
* Web上の「今いる人」は「直近10分以内に『私も眠れない』を押した匿名ブラウザ数」と定義する。リアルタイム接続人数とは表現しない。

---

# 3. 技術スタック

## 3.1 リポジトリ

GitHub上に1つのリポジトリを作成し、BotとWebアプリを同一リポジトリで管理する。

```text
sleepless/
├── apps/
│   ├── bot/
│   ├── api/
│   ├── web-vanilla-js/
│   └── web-react/
│
├── docs/
│   └── BOT_IMPLEMENTATION_PLAN.md
│
├── .gitignore
└── README.md
```

この計画書の正しい配置先は `docs/BOT_IMPLEMENTATION_PLAN.md` とする。

モノレポ管理ツールはMVPでは導入しない。

必要になった時点でnpm workspaces等を検討する。

---

## 3.2 Bot

* TypeScript
* Cloudflare Workers
* Cloudflare Cron Triggers
* X API

### 主な責務

* Xへの投稿
* X上の「眠れない」関連投稿数の取得
* 投稿文生成
* 定期実行
* 日本時間による投稿時間帯判定

---

## 3.3 Webアプリ

* HTML
* Tailwind CSS
* JavaScript（フレームワークなし）
* Cloudflare
* Cloudflare Workers
* Cloudflare D1（Phase 3で、投稿の冪等性のため先行導入する）

必要になった場合のみ以下を追加する。

* React
* TypeScript
* React Router
* TanStack Query
* Zod

MVPでは画面が少なく、API呼び出しとDOM更新だけで要件を満たすため、Reactは導入しない。`web-vanilla-js` を本番版、`web-react` をReactの練習・検証版として別々に管理し、同じAPI契約を利用する。React版を十分に検証できた時点で、本番URLの配信先を切り替える。

---

## 3.4 データベース

固定文字列のローカル投稿だけを行うPhase 1〜2ではDBを使用しない。Phase 3から、公開投稿の冪等性を担保するためにD1を使用する。

---

# 4. Git / リポジトリ初期設定

## Phase 0：リポジトリ作成

### 目的

開発を開始できる最低限のGit環境を作る。

### やること

* GitHubリポジトリを作成
* ローカルにclone
* `.gitignore` を作成
* `README.md` を作成
* `docs/BOT_IMPLEMENTATION_PLAN.md` を配置
* `apps/bot` ディレクトリを作成

### `.gitignore`

最低限以下を除外する。

```gitignore
# Dependencies
node_modules/

# Environment variables
.env
.env.*
!.env.example

# Cloudflare
.wrangler/
.dev.vars
.dev.vars.*

# Build
dist/

# Logs
*.log

# macOS
.DS_Store
```

X APIの認証情報は絶対にGit管理しない。

### 完了条件

以下のような構成がGitHub上に存在する。

```text
sleepless/
├── apps/
│   └── bot/
├── docs/
│   └── BOT_IMPLEMENTATION_PLAN.md
├── .gitignore
└── README.md
```

---

# 5. X Bot実装

# Phase 1：ローカルから固定文字列を投稿

## 目的

X APIを利用してBotアカウントから投稿できることを確認する。

この段階ではCloudflareを使用しない。

---

## 5.1 X Botアカウント準備

### やること

* Bot用Xアカウントを作成
* プロフィールを最低限設定
* X Developer環境を準備
* Project / Appを作成
* 投稿に必要な権限を設定
* API認証情報を取得

取得した認証情報はローカル環境変数として保存する。

例：

```env
X_API_KEY=
X_API_SECRET=
X_ACCESS_TOKEN=
X_ACCESS_TOKEN_SECRET=
X_BEARER_TOKEN=
```

実際の値はGitにコミットしない。

`.env.example` にはキー名のみ保存する。

`X_BEARER_TOKEN` はCounts API専用とし、投稿に流用しない。投稿側はBotアカウントのユーザー文脈で認証する。OAuth 1.0aを採用する場合は上記4値を使い、OAuth 2.0を採用する場合はアクセストークンの更新方法と更新用のSecretをCloudflare Secretsで管理する。認証情報をログへ出力しない。

### API利用確認ゲート

コード作成前に、Botアカウント・承認済みDeveloper App・必要なX APIプランが次の双方を許可していることを、ステージング用の認証情報で確認する。

* 1件のテスト投稿
* 指定クエリのRecent Post Counts取得

利用上限、課金上限、Developer Termsの確認結果と確認日をREADMEへ記録する。このゲートを満たさない場合はPhase 1を完了としない。

---

## 5.2 TypeScriptプロジェクト作成

`apps/bot` にNode.js + TypeScript環境を作る。

初期構成例：

```text
apps/bot/
├── src/
│   └── post.ts
├── .env.example
├── package.json
└── tsconfig.json
```

---

## 5.3 固定文字列投稿処理

最初は以下のような固定文を投稿する。

```text
Sleepless Bot テスト投稿
```

必要なのは、

```text
ローカルPC
    ↓
X API
    ↓
Botアカウント
```

だけ。

---

## 完了条件

ローカルでコマンドを実行すると、Botアカウントに固定文字列が1件投稿される。

加えて、認証失敗・429・タイムアウト時に認証情報を出さず、失敗理由とHTTPステータスを記録できる。

例：

```bash
npm run post
```

---

# Phase 2：Cloudflare Workerから固定文字列を投稿

## 目的

ローカルPCを介さず、Cloudflare上からXへ投稿できる状態にする。

---

## 6.1 Cloudflare Workers導入

`apps/bot` をCloudflare Workerとして構成する。

構成イメージ：

```text
apps/bot/
├── src/
│   ├── index.ts
│   └── x/
│       └── post.ts
│
├── wrangler.jsonc
├── package.json
└── tsconfig.json
```

---

## 6.2 X API認証情報をSecretsへ移行

本番環境ではX APIキーをCloudflare Secretsとして管理する。

コードに直接記述しない。

Workerからは環境変数として参照する。

---

## 6.3 手動実行用エンドポイント

開発中だけ、Workerから投稿処理を手動で起動できるようにする。

例：

```text
POST /test-post
```

実行すると、

```text
Cloudflare Worker
        ↓
      X API
        ↓
    Bot投稿
```

となる。

本番環境にはこのテスト用エンドポイントをデプロイしない。必要な検証はステージング環境・ステージング用Botアカウントだけで行う。例外的に残す場合は、ランダムなSecretによる認証、Cloudflare Access等のネットワーク制限、レート制限、監査ログをすべて必須とする。

---

## 完了条件

ローカルPC上の投稿処理ではなく、Cloudflare Workerから固定文字列を投稿できる。

ステージング環境でのみ手動投稿を実行でき、本番URLから未認証で投稿できない。

---

# Phase 3：Cronによる固定文字列の自動投稿

## 目的

人間が何も操作しなくてもBotが自動投稿する状態を作る。

ここまで完成した時点で、一旦Botとして利用開始できる。

---

## 7.1 Cron Trigger追加

Cloudflare Cron Triggersを利用して毎時Workerを起動する。CronはUTCで評価されるため、設定値とJST上の投稿時刻の対応表を `wrangler.jsonc` のコメントとREADMEに残す。

基本フロー：

```text
毎時Cron
   ↓
Worker起動
   ↓
現在時刻確認
   ↓
投稿対象時間？
   ↓
YES
   ↓
Xへ投稿
```

---

## 7.2 投稿時間

初期仕様：

```text
22:00
23:00
00:00
01:00
02:00
03:00
04:00
05:00
06:00
```

日本時間22時〜翌6時までを対象とする。

Cron自体は毎時起動し、Worker内部で `Asia/Tokyo` の時刻を判定する。Cron設定の反映には時間差があるため、設定変更日は本番投稿を監視する。

### 対象条件

```text
hour >= 22 || hour <= 6
```

---

## 7.3 初期投稿文

Phase 3では件数取得をまだ実装しない。

例えば以下のような固定文にする。

```text
午前2時。

まだ眠れない夜を過ごしている人へ。

今夜も、起きているのはあなただけではありません。
```

時刻部分だけ動的にしてもよい。

---

## 7.4 ログ確認

最低限以下を確認できるようにする。

* Workerが実行されたか
* 投稿対象時刻だったか
* X APIへの投稿が成功したか
* エラーが発生したか

専用監視サービスはまだ導入しない。

Cloudflare側のログで確認する。

---

## 7.5 集計枠と二重投稿防止

Cronの実際の起動時刻ではなく、対象となる予定済みの正時枠をキーにする。例えばJST 02:00の投稿は、JST 01:00:00以上02:00:00未満を対象とする。内部保存はUTCの `window_start_at` / `window_end_at` とする。

Phase 3からD1を導入し、次のテーブルをmigrationとして管理する。

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

開始時に対象枠を `processing` として原子的に確保し、`lease_expires_at` を実行開始から10分後に設定する。すでに `posted` の枠は何もせず終了する。有効なリースを持つ `processing` の枠も、別の実行は処理せず終了する。投稿成功時はXのPost IDとともに `posted` に更新する。

Workerの停止などでリース期限を過ぎても `processing` の枠が残った場合、次のCron実行はその行を `failed`（`error_code = 'PROCESSING_LEASE_EXPIRED'`）へ原子的に更新して運用者へ通知する。この状態では自動再投稿しない。運用者はXの投稿履歴と実行ログを確認し、未投稿であることを確認できた場合にだけ同一枠を明示的に再実行できる。再実行時もXへの送信前後を記録し、送信結果が不明な場合は投稿履歴を確認してから処理する。

`skipped` は、障害ではなく運用者が対象枠の投稿を意図的に見送る場合（緊急メンテナンスや一時停止など）だけに使用する。この場合は理由を `error_code`（例: `OPERATOR_SKIP`）に記録し、XへのCounts取得・投稿は行わない。投稿対象外の時刻に起動したCronでは `bot_runs` の行を作らず、`skipped` も記録しない。すでに `skipped` の枠は自動では処理せず、運用者が明示的に再開した場合だけ再実行できる。

---

## 完了条件

PCを閉じた状態でも、22:00〜6:00の間に毎時Botが自動投稿する。

同じ対象枠について再デプロイ・再実行しても、投稿は最大1件である。

---

# Phase 4：「眠れない」投稿数を取得して動的投稿

## 目的

Bot本来の価値である、

「この1時間にも眠れないと投稿している人が多数いる」

という情報を提供する。

---

## 8.1 X Counts API接続

X APIを利用して、直近1時間に条件へ一致した投稿件数を取得する。

初期検索条件：

```text
"眠れない" OR "寝れない" lang:ja
```

検索ワードは実際の結果を見ながら調整する。

将来的な候補：

```text
眠れん
眠れません
寝付けない
寝られない
```

ただし初期段階では検索条件を広げすぎない。

---

## 8.2 集計時間

対象となる予定済みの1時間枠を `start_time` と `end_time` に明示して取得する。Cronの遅延や手動再実行によって集計範囲をずらさない。

例：

```text
02:00に実行

対象：
01:00〜02:00
```

---

## 8.3 投稿文生成

取得した件数を投稿文に埋め込む。

例：

```text
午前2時。

この1時間で
「眠れない」「寝れない」という投稿が
1,284件ありました。

今夜も、眠れないのはあなただけではありません。
```

重要：

「1,284人」とは表現しない。

X APIから取得しているのはユニークユーザー数ではなく投稿件数のため、

```text
1,284件
```

と表示する。

---

## 8.4 エラー時の挙動

Counts APIの取得に失敗した場合、誤った件数を投稿しない。

選択肢：

```text
Counts API成功
    ↓
件数入り投稿

Counts API失敗
    ↓
固定文を投稿
```

または、

```text
Counts API失敗
    ↓
その時間は投稿しない
```

MVPでは後者を採用する。Counts APIの取得・妥当性確認に失敗した枠は `bot_runs.status = 'failed'` として保存し、Xへは投稿しない。429・5xx・タイムアウトは短い指数バックオフで最大3回まで再試行し、それでも失敗したら運用者へ通知する。

## 8.5 件数スナップショットの保存

Web表示と監査のため、取得成功時には投稿前に同じD1へ件数を保存する。

```sql
CREATE TABLE sleepless_counts (
  window_end_at TEXT PRIMARY KEY,
  window_start_at TEXT NOT NULL,
  query_version TEXT NOT NULL,
  query_text TEXT NOT NULL,
  post_count INTEGER NOT NULL CHECK (post_count >= 0),
  fetched_at TEXT NOT NULL,
  x_post_id TEXT
);
```

検索語を変えた場合は `query_version` を上げ、過去値と単純比較しない。件数は投稿数であり、ユニークユーザー数・実際に眠れない人の人数・医学的な指標ではない。

---

## 8.6 Botコード整理

最終的には以下程度に分割する。

```text
apps/bot/
├── src/
│   ├── index.ts
│   │
│   ├── x/
│   │   ├── post.ts
│   │   └── counts.ts
│   │
│   ├── message/
│   │   └── build-message.ts
│   │
│   └── utils/
│       └── time.ts
│
├── wrangler.jsonc
├── package.json
└── tsconfig.json
```

### 責務

#### `index.ts`

Cron処理全体を制御する。

#### `x/post.ts`

Xへの投稿のみ担当。

#### `x/counts.ts`

「眠れない」投稿数の取得のみ担当。

#### `message/build-message.ts`

投稿文生成。

#### `utils/time.ts`

日本時間判定。

---

## 完了条件

毎時、

```text
Counts API
    ↓
件数取得
    ↓
投稿文生成
    ↓
X投稿
```

が自動実行される。

各実行について、対象時間枠・検索クエリ版・X APIの結果・Post IDまたは失敗理由を追跡できる。

---

# 6. Bot検証期間

Phase 4完成後、すぐにWebアプリへ機能追加するのではなく、実際にBotを利用する。

## 確認事項

* 夜中にBotを見ることで孤独感が多少軽くなるか
* 件数表示に意味を感じるか
* 1時間ごとの更新頻度は適切か
* 投稿文が長すぎないか
* 毎時同じ文章でも問題ないか
* Xを開くこと自体が負担にならないか
* 「Xを開かずに確認したい」と感じるか

特に、

> Xを開くことでタイムラインを見てしまう

という問題が実際に発生するか確認する。

Webアプリは、この問題を解決するための次のフェーズとして位置付ける。

---

# 7. Webアプリ実装

# Phase 5：Webアプリ最小版

## 目的

Xを開かなくても「眠れない仲間がいる」ことを確認できるようにする。

この段階ではユーザー登録を実装しない。

---

## 10.1 Webアプリ全体の構成

フロントエンドを二重に実装しても、API・データベース・Botは共通化する。公開中の本番実装は常に1つだけとする。

```text
sleepless/
├── apps/
│   ├── bot/                         # CronとX API連携
│   ├── api/                         # Counts / Presence API、D1 binding
│   │   └── src/
│   │       ├── counts.js
│   │       └── presence.js
│   ├── web-vanilla-js/              # MVPとして先に公開する版
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── tailwind.config.js
│   │   └── src/
│   │       ├── main.js
│   │       ├── api/
│   │       ├── views/
│   │       ├── lib/
│   │       └── styles/input.css
│   └── web-react/                   # React学習・検証用。後で追加
│       ├── index.html
│       ├── package.json
│       └── src/
│           ├── main.jsx
│           ├── App.jsx
│           ├── api/
│           ├── components/
│           ├── hooks/
│           ├── lib/
│           └── styles/input.css
│
└── docs/
```

`apps/api` はCloudflare Workerとして配信し、D1へ接続する。2つのフロントエンドは同じAPI URL・リクエスト形式・レスポンス形式を使う。API仕様を変えるときは、両方を同時に確認するか、後方互換性を保つ。

## 10.2 Vanilla JavaScript版の実装方針

技術はHTML、Tailwind CSS、素のJavaScriptとする。Tailwind CSSはCLIでビルドし、生成したCSSを静的アセットとして配信する。React、Vite、TypeScript、ルーティングライブラリはこのフェーズでは導入しない。

React移行を容易にするため、以下を守る。

* `main.js` は起動と画面初期化だけを担い、API通信・状態・表示を分ける。
* `api/` にはfetch処理だけ、`views/` には対応する画面領域の描画だけ、`lib/` には日時整形や匿名IDなど再利用処理だけを置く。
* `onclick` 属性、グローバル関数、画面の各所からの無秩序なDOM操作を避ける。
* DOMを状態の正本にせず、取得した値はJavaScriptの状態として保持してから描画する。
* APIから受け取った文字列を `innerHTML` へ直接入れず、原則として `textContent` を使う。
* 匿名IDのlocalStorageキーは `sleepless-anonymous-id` とし、React版でも同じキーを使う。

## 10.3 React版の位置付けと移行先

`apps/web-react` はPhase 5のリリースを止めずにReactを学び、同じ機能を再実装・検証する場所とする。Vanilla版の責務は、React版では次のように対応させる。

| Vanilla JavaScript版 | React版 |
| --- | --- |
| `views/counts.js` | `components/CountsPanel.jsx` |
| `views/presence.js` | `components/PresencePanel.jsx` |
| `api/counts.js` | `api/counts.js`（原則そのまま） |
| `api/presence.js` | `api/presence.js`（原則そのまま） |
| 状態管理用のJSモジュール | `hooks/useCounts.js`、`hooks/usePresence.js` |
| `main.js` | `main.jsx` と `App.jsx` |

React版でもTailwind CSS、API URL、匿名IDキー、表示する文言と鮮度判定をVanilla版と揃える。これにより、移行時にバックエンドとデータを変更しない。

## 10.4 配信先と移行手順

ドメイン名は説明用の例であり、実際には取得・設定したドメインまたはCloudflareの `workers.dev` URLへ置き換える。

```text
通常時
  sleepless.example.com
  → web-vanilla-js を本番デプロイ

React版の確認時
  react-preview.sleepless.example.com
  → web-react をプレビューデプロイ

移行時
  sleepless.example.com
  → web-react のビルド成果物を本番デプロイ
```

本番URLにはVanilla版とReact版を同時に配信しない。React版をプレビューURLで実機確認し、Counts・Presence・匿名ID引継ぎ・鮮度表示・PWA導線を確認してから本番デプロイを切り替える。切替後に問題があれば、直前のVanilla版のデプロイを同じ本番URLへ再デプロイしてロールバックする。

Cloudflareでは、本番・プレビューともに `/api/*` をAPI Worker、その他のパスを各フロントエンドの静的アセットへルーティングする。ReactプレビューはAPI Workerのステージング環境とステージングD1へ接続し、本番のPresenceや集計データをテストで書き換えない。

同じ本番URLでPWAを提供する場合、Service WorkerとWeb App Manifestは本番中の片方だけが登録・配信する。React版のService WorkerをまずプレビューURLで確認し、切替時はキャッシュ名を変えて古いアセットが残らないことを確認する。

---

## 10.5 最初の画面

MVPでは原則1画面だけ作る。

表示内容：

```text
午前2:14

この1時間で
「眠れない」という投稿が

1,284件

ありました。

今夜も、
眠れないのはあなただけではありません。
```

ページ遷移は不要。

画面遷移やフレームワークはこの時点では不要。

---

## 10.6 件数取得API

Botが取得している件数をWebでも利用できるようにする。

件数保存用のD1はPhase 3で導入済みとする。`apps/bot` はCron専用Worker、`apps/api` はAPI専用Workerとし、両者に同一の本番D1を明示的にbindする。フロントエンドは本番URLと同一オリジンの `/api/` を利用する構成を優先し、不要なCORS公開はしない。

BotのCron実行時、

```text
X Counts API
    ↓
件数取得
    ↓
D1へ保存
    ↓
X Botへ投稿
```

とする。

Web側は、

```text
ブラウザ（HTML + JavaScript）
 ↓
GET /api/counts/latest
 ↓
Worker
 ↓
D1
```

で最新件数を取得する。

---

## 10.7 データの鮮度

APIは最新の成功したスナップショットだけを返す。ただし、現在時刻と `window_end_at` の差が2時間を超える場合は「最新データを取得できていません」と扱い、通常の「この1時間」表示をしない。レスポンスには検索対象の開始・終了時刻と取得時刻を含め、画面には「対象: 01:00–02:00 JST」「更新: 02:01 JST」のように表示する。

---

## 10.8 API例

```text
GET /api/counts/latest
```

レスポンス例：

```json
{
  "windowStartAt": "2026-08-09T16:00:00Z",
  "windowEndAt": "2026-08-09T17:00:00Z",
  "fetchedAt": "2026-08-09T17:00:08Z",
  "postCount": 1284,
  "queryVersion": "v1"
}
```

---

## 完了条件

Xを開かずにWebページへアクセスするだけで、最新の「眠れない」投稿件数を確認できる。

データが古い・未取得の場合は、古い件数を最新値として表示せず、状態を明示できる。

---

# Phase 6：「私も眠れない」機能

## 目的

X上の投稿数だけではなく、

> 今このサービスにも誰かがいる

という感覚を作る。

Webアプリ独自の価値になる。

---

## 11.1 UI

画面に以下を追加する。

```text
この10分に、この場所で

23人

います。

[ 私も眠れない ]
```

---

## 11.2 ユーザー識別

会員登録は行わない。

ブラウザごとに匿名IDを生成してlocalStorage等へ保存する。

例：

```text
anonymousId = UUID
```

個人を特定できる情報は保存しない。

匿名IDはサービス内でのみ使用し、分析用途へ目的外利用しない。保持目的・保存期間・ブラウザデータを削除する方法をPrivacy Policyに明記する。

---

## 11.3 Presence登録

「私も眠れない」を押したら、

```text
POST /api/presence
```

を実行する。

DBには例えば以下を保存する。

```text
anonymous_id
last_seen_at
```

実テーブルは以下とし、匿名ID単位でupsertする。

```sql
CREATE TABLE presence (
  anonymous_id TEXT PRIMARY KEY,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX presence_last_seen_at_idx ON presence(last_seen_at);
```

Presence APIにはIPと匿名IDを組み合わせたレート制限を設定し、WAFまたはTurnstile等のBot対策を導入する。入力値はUUID形式・本文サイズ・Content-Typeを検証し、許可したオリジンからのリクエストだけを受ける。人数は異常増加を検知できるよう上限・監視を設ける。

---

## 11.4 「今いる人」の定義

厳密なリアルタイム接続人数にはしない。

例えば、

```text
直近10分以内に
「私も眠れない」を押したユーザー
```

を「この10分に反応した人」とする。画面でも「今、この場所にも23人います」ではなく「この10分に、ここで『私も眠れない』を押した人は23人です」と表示する。

WebSocketは導入しない。

MVPではポーリングで十分。

---

## 11.5 Presence API

```text
POST /api/presence
GET  /api/presence/count
```

### POST

自分がここにいることを登録・更新。

### GET

直近10分にPresence登録した匿名ブラウザ数を返す。

---

## 11.6 同じユーザーの重複

匿名ID単位で最新の `last_seen_at` を保持する。

同じ人が何度押しても人数が増えないようにする。

古いPresenceレコードは定期的に削除する。削除は表示対象の10分より十分長い保持期間（例: 30日）を過ぎたものに限定し、運用上の保持期間はPrivacy Policyと同期する。

---

## 完了条件

複数ブラウザから「私も眠れない」を押すと、直近10分の反応人数へ反映される。

同一IDの連打では増えず、無効な入力・過剰なアクセス・自動化リクエストは拒否または制限される。

---

# Phase 7：UI・体験改善

## 目的

「確認したら、そのままスマートフォンを閉じられる」体験にする。

---

## 12.1 UI原則

睡眠前・深夜利用を想定する。

### 避けるもの

* 白く明るい背景
* 激しいアニメーション
* 大量の情報
* SNSフィード
* 無限スクロール
* 通知バッジによる煽り
* 強い赤色
* 過度なゲーミフィケーション

### 重視するもの

* ダークテーマ
* 大きな数字
* 少ない文章
* ゆっくりした動き
* 操作数を極力減らす
* 「閉じてよい」と感じられるUI

---

## 12.2 人の存在の可視化

例えば人数を、

```text
○ ○ ○ ○ ○
 ○ ○ ○ ○
○ ○ ○ ○ ○
```

のような小さな光・点として表現する。

最初から複雑なCanvas実装等は行わない。

CSSで十分ならCSSを利用する。

---

# Phase 8：PWA対応

## 目的

Xやブラウザを意識せず、ホーム画面から直接アクセスできるようにする。

---

## 13.1 PWA基本対応

実装するもの：

* Web App Manifest
* アプリアイコン
* `display: standalone`
* HTTPS
* 必要最低限のService Worker

オフライン対応はMVP要件に含めない。

Service Workerはアプリシェルと静的アセットだけを更新管理し、`/api/counts/latest` とPresence APIを長期キャッシュしない。新バージョン検知時は次回起動時に更新される方針とし、古い件数をオフライン表示して最新値に見せない。

---

## 13.2 インストール導線

アプリ内に、

```text
次の眠れない夜のために
ホーム画面に追加
```

という導線を設置する。

### Android

対応ブラウザではインストールプロンプトを利用する。

### iPhone

Web側から完全なワンタップインストールはできないため、

```text
共有
↓
ホーム画面に追加
```

を案内する。

---

## 完了条件

ホーム画面からStandaloneアプリとして起動できる。

---

# Phase 9：最低限のアクセス分析

## 目的

本当に継続利用されているか確認する。

収益化より先に検証する。

---

## 14.1 確認したい指標

優先順位順：

1. Webアプリの利用者数
2. 再訪率
3. 深夜時間帯別の利用数
4. 「私も眠れない」押下率
5. PWA追加につながる行動
6. X BotからWebへの流入

---

## 14.2 最重要指標

単純なPVより、

```text
一度利用した人が
別の眠れない夜にも戻ってきたか
```

を重視する。

このサービスでは再訪がプロダクト価値の強いシグナルになる。

## 14.3 分析・プライバシー

計測イベント、送信先、保持期間、利用目的、オプトアウト方法をPrivacy Policyに明記する。匿名IDを広告識別子や個人プロファイルへ結合しない。IPアドレス等をセキュリティ目的で一時的に扱う場合は、別途その目的と保持期間を記載する。

---

# Phase 10：Webアプリへの集客

## 目的

X BotをWebアプリの認知経路として利用する。

---

## 15.1 Botプロフィール

BotプロフィールからWebアプリへ誘導する。

コンセプト：

```text
眠れない夜、
Xを眺め続けなくても
誰かが起きていることを確認できる場所。
```

---

## 15.2 Bot投稿

Bot投稿のすべてにURLを付ける必要はない。

定期的にWebアプリを案内する。

X上で、

```text
認知
 ↓
Webへアクセス
 ↓
「私も眠れない」
 ↓
再訪
 ↓
PWA
```

という流れを作る。

---

# 16. ユーザー登録について

MVPでは実装しない。

理由：

* 午前2時に会員登録させるのは体験が悪い
* メールアドレスが不要
* パスワード管理が不要
* セキュリティ実装を減らせる
* 個人情報を極力持たなくて済む

以下のような機能が必要になった場合のみ認証を検討する。

* 睡眠記録
* 複数端末同期
* お気に入り
* 有料プラン
* 購入済みコンテンツ管理

---

# 17. MVPで実装しない機能

以下は初期段階では実装しない。

* チャット
* DM
* コメント
* フォロー
* SNSタイムライン
* 会員登録
* プロフィール
* 投稿機能
* 睡眠時間管理
* 睡眠スコア
* AIチャット
* WebSocket
* プッシュ通知
* 複雑なアニメーション
* 有料プラン
* 広告

特にチャットは、

```text
孤独
 ↓
会話を始める
 ↓
スマホ利用時間が伸びる
```

可能性があるため、本サービスの目的と相反する。

基本思想は、

```text
孤独を感じる
 ↓
誰かがいることだけ確認する
 ↓
安心する
 ↓
閉じる
```

とする。

---

# 18. 将来的に検討する機能

MVP検証後に必要性が確認できた場合のみ検討する。

### セルフケア

* 自然音
* 呼吸法
* ボディスキャン
* 短い睡眠瞑想
* 夜中に読む短文

### パーソナライズ

* 最近眠れなかった時間帯
* 利用履歴
* お気に入り

### 収益化

* 有料音声コンテンツ
* 買い切り
* 低価格サブスクリプション
* サービス支援・寄付

「孤独を和らげるための基本機能」自体は無料のまま維持する方向を優先する。

---

# 19. 実装マイルストーン

## Milestone 0

### リポジトリ準備

* [ ] GitHubリポジトリ作成
* [ ] `.gitignore`
* [ ] README
* [ ] `docs/BOT_IMPLEMENTATION_PLAN.md` 配置
* [ ] `apps/bot` 作成

---

## Milestone 1

### ローカルX投稿

* [ ] Botアカウント作成
* [ ] X Developer設定
* [ ] API認証情報取得
* [ ] TypeScript環境作成
* [ ] 固定文字列投稿
* [ ] `.env.example` 作成
* [ ] 投稿・Counts APIの利用可否、上限、Terms確認
* [ ] 認証失敗・429・タイムアウトの確認

### ゴール

ローカルからXへ投稿できる。

---

## Milestone 2

### Cloudflare Worker投稿

* [ ] Worker作成
* [ ] X認証情報をSecrets化
* [ ] Workerから固定投稿
* [ ] エラー確認

### ゴール

CloudflareからXへ投稿できる。

---

## Milestone 3

### Cron Bot

* [ ] Cron Trigger
* [ ] JST判定
* [ ] 22:00〜6:00制御
* [ ] 固定文自動投稿
* [ ] D1 migrationと対象枠単位の冪等性
* [ ] ログ確認
* [ ] 同一枠の再実行テスト

### ゴール

PCを閉じていても毎晩Botが動く。

---

## Milestone 4

### 動的件数Bot

* [ ] Counts API接続
* [ ] 検索クエリ作成
* [ ] 直近1時間集計
* [ ] 件数を投稿文へ反映
* [ ] API失敗時処理
* [ ] 固定時間枠の `start_time` / `end_time` 指定
* [ ] 429・5xx・タイムアウトの再試行と通知
* [ ] クエリ版・取得時刻・Post IDの保存
* [ ] 数日実運用

### ゴール

「この1時間で眠れない投稿が○○件」を毎時自動投稿する。

---

## Milestone 5

### HTML / Tailwind CSS / JavaScript Web MVP

* [ ] `apps/web-vanilla-js` を作成
* [ ] HTML + Tailwind CSS + 素のJavaScriptで画面を作成
* [ ] Tailwind CSSの本番ビルドを追加
* [ ] Cloudflareへデプロイ
* [ ] `apps/api` Workerを作成し、D1 bindingを追加
* [ ] Botから件数保存
* [ ] 最新件数API
* [ ] Web画面表示
* [ ] 鮮度切れ・未取得状態の表示

### ゴール

Xを開かなくても最新件数を確認できる。

---

## Milestone 6

### 「私も眠れない」

* [ ] 匿名ID
* [ ] Presence API
* [ ] Presence保存
* [ ] 現在人数取得
* [ ] 「私も眠れない」ボタン
* [ ] 人数表示
* [ ] 匿名IDのupsert・期限削除
* [ ] レート制限・Bot対策・入力検証

### ゴール

同じWebアプリを利用している人の存在を感じられる。

---

## Milestone 7

### 体験改善

* [ ] ダークUI
* [ ] 情報量削減
* [ ] 人数の視覚表現
* [ ] モバイル最適化
* [ ] アクセシビリティ確認
* [ ] `prefers-reduced-motion`、コントラスト、画面読み上げ確認

### ゴール

深夜に短時間だけ使うサービスとして成立する。

---

## Milestone 8

### PWA

* [ ] Manifest
* [ ] アイコン
* [ ] Standalone
* [ ] Android追加導線
* [ ] iOS追加案内
* [ ] APIを長期キャッシュしない更新確認

### ゴール

Xを開かず、ホーム画面から直接アクセスできる。

---

## Milestone 9

### 検証

* [ ] Bot → Web流入確認
* [ ] 再訪確認
* [ ] Presence利用率確認
* [ ] 時間帯分析
* [ ] PWA利用状況確認
* [ ] Privacy Policyと保持期間の確認

### ゴール

実際に「眠れない夜に繰り返し使われるか」を判断する。

---

## Milestone R（任意）

### React版への移行

* [ ] `apps/web-react` にVanilla版と同じ機能を実装
* [ ] API URL・レスポンス形式・匿名IDキーの互換性を確認
* [ ] プレビューURLでCounts・Presence・鮮度表示・PWA導線を実機確認
* [ ] 本番URLをReact版へ切替
* [ ] Vanilla版へのロールバックを確認

### ゴール

本番ユーザーのデータや利用体験を壊さず、React版を本番URLで提供できる。

---

# 20. テスト・監視・リリース基準

## 20.1 テスト

各Phaseで以下を自動または手動で確認する。

* JST/UTC変換、投稿対象時間、固定集計枠、投稿文、鮮度判定の単体テスト
* X APIの成功、401/403、429、5xx、タイムアウトをモックした結合テスト
* D1 migrationの空DB適用と、既存データを含む環境への適用テスト
* ステージング用Xアカウントでの投稿・Counts取得・Cron手動実行
* 複数ブラウザでのPresence upsert、レート制限、Bot対策の確認
* 実機のiOS/Androidでの画面、PWA導線、更新、アクセシビリティ確認

## 20.2 監視と障害対応

Cloudflare LogsとCron Eventsで、対象枠、実行結果、X APIステータス、Post ID、再試行回数を確認できるようにする。`failed` の実行、2時間以上の件数未更新、異常なPresence増加は通知対象とする。Secrets・投稿本文・匿名ID・IPアドレスはログに出力しない。

## 20.3 本番リリース基準

以下をすべて満たすまで本番公開しない。

* X API利用確認ゲートを通過している
* 本番の手動投稿エンドポイントが存在しない、または厳格に保護されている
* 同一集計枠の再実行で二重投稿しない
* Counts取得失敗時に誤った件数を公開しない
* Privacy Policy、問い合わせ先、データ保持方針を公開している
* ステージングで上記テストを完了している

---

# 21. 最終的なシステム構成

```text
                         X
                    ┌─────────┐
                    │ X API   │
                    └────┬────┘
                   Counts│  │Post
                         │  ▼
Cloudflare Cron ──▶┌────────────┐──────▶ X Bot
                   │ Bot Worker │
                   └─────┬──────┘
                         │ 保存・冪等性
                         ▼
                    ┌─────────┐
                    │   D1    │
                    └────┬────┘
                         ▲
                         │ Counts / Presence API
                 ┌───────┴───────┐
                 │  API Worker   │
                 └───────┬───────┘
                         │
                 ┌───────┴───────────────┐
                 │ Web frontend (one only)│
                 │ Vanilla JS or React    │
                 └───────┬───────────────┘
                         │
                         ▼
                        PWA
```

---

# 22. 開発上の原則

このプロジェクトでは以下を優先する。

## 1. 早く自分で使える状態にする

最初の価値提供はWebアプリではなくBotでよい。

---

## 2. 必要になるまで機能を追加しない

「いつか必要かもしれない」を理由に実装しない。

---

## 3. インフラ費用を極力固定費化しない

Cloudflareの無料枠・従量課金型サービスを中心に構成する。

X APIなど外部API費用は別途管理する。

---

## 4. 個人情報を極力持たない

MVPではログインを要求しない。

---

## 5. SNS化しない

ユーザー同士の交流そのものではなく、

「他にも誰かがいる」

という存在感を提供する。

---

## 6. 滞在時間を伸ばすことを目的にしない

一般的なWebサービスとは異なり、

```text
開く
↓
安心する
↓
閉じる
```

という短時間利用を成功体験として扱う。

---

# 23. 最初に着手する作業

現時点ではMilestone 0〜1だけに集中する。

具体的には以下の順序で進める。

```text
1. GitHubリポジトリ作成

2. リポジトリをclone

3. .gitignore作成

4. docs/BOT_IMPLEMENTATION_PLAN.mdを配置

5. apps/botを作成

6. X Botアカウントを準備

7. X Developer設定

8. ステージング用のX API認証情報を取得・ローカルへ設定

9. コード作成前のAPI利用確認ゲートを実施（テスト投稿とCounts API取得、利用上限・Terms確認）

10. TypeScript環境をセットアップ

11. ローカルから固定文字列を1件投稿
```

この11まで完了するまでは、Cron、Counts APIの本実装、Webアプリ、D1、PWAには着手しない。
