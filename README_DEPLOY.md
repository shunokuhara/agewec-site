# AGEWEC サイト デプロイ手順（マルチイヤー / パス方式）

## ⚠️ 最重要：リポジトリへの置き方

このプロジェクトの中身を **リポジトリのルートに置く**こと。`2026/` のようなサブフォルダに入れないこと。

Cloudflare はリポジトリのルートにある `wrangler.jsonc` を見てビルドします。サブフォルダに入れると、ルートの古い設定でデプロイされ、`/2026` が404になります（前回の原因）。

正しい配置（リポジトリ直下）:

```
/(repo root)
├─ wrangler.jsonc
├─ worker/index.js
├─ migrations/0001_init.sql
├─ public/            ← index.html, styles.css, script.js, assets/, submit/, judge/, admin/, entries/, rules/, privacy/, ai-guidelines/
├─ package.json, test_local.mjs
├─ .github/workflows/, docs/
```

**既存リポジトリの掃除**：古いルートの `index.html` / `styles.css` / `script.js` / `assets/` / 古い `wrangler.jsonc` と、`2026/` サブフォルダは削除し、このプロジェクトの中身でルートを置き換える。

## URL モデル（パス方式・マルチイヤー）

- `agewec.com/` → AGEWEC 全体の**概要ポータル**（`public/index.html`）。各年への入口＋シリーズの説明。
- `agewec.com/2026/` → 2026年版のトップ（`public/2026/index.html`）
- `agewec.com/2026/submit/`、`/judge/`、`/admin/`、`/entries/` … → 全年共通の機能ページ
- `agewec.com/2026/api/...` → その年の D1 を使う API
- `agewec.com/styles.css` 等の共有アセットはルート直下（全年共通）

「年」はURLのパスで表現し、リポジトリのフォルダでは表現しない。ポータルは年に依存せず、各年版トップ（public/{年}/index.html）だけが年ごとの中身を持つ。

## 1. 準備

```bash
npm i -g wrangler
wrangler login
```

## 2. その年の D1 を作成して接続

```bash
wrangler d1 create agewec_2026
```

出力された `database_id` を `wrangler.jsonc` の `REPLACE_WITH_2026_D1_ID` に貼る。バインド名は **`DB_2026`**（Worker が `env["DB_"+year]` で解決するため、必ず `DB_<年>`）。

## 3. スキーマ適用

```bash
wrangler d1 migrations apply agewec_2026 --remote
```

## 4. 審査員・管理者を登録（その年のD1に）

```bash
wrangler d1 execute agewec_2026 --remote --command \
"INSERT INTO judges (email,name,role) VALUES \
('admin@example.com','運営','admin'),('judge1@example.com','審査員1','judge');"
```

## 5. Access で保護（重要）

Cloudflare Zero Trust → Access → Applications で self-hosted アプリを作成。

- `/*/admin*` … 管理者メールのみ
- `/*/judge*` … 審査員＋管理者

Access が付与する `Cf-Access-Authenticated-User-Email` を Worker がその年の `judges` で照合する。未設定だと `/judge` `/admin` の API は 401。

## 6. デプロイ

```bash
wrangler deploy
```

GitHub→Cloudflare 自動ビルドの場合は、上記「リポジトリ直下配置」になっていれば push で自動デプロイされる。

## 新しい年を追加する手順（例：2027）

1. `wrangler d1 create agewec_2027`
2. `wrangler.jsonc` の `d1_databases` に `{ "binding": "DB_2027", "database_name": "agewec_2027", "database_id": "..." }` を追加
3. `wrangler d1 migrations apply agewec_2027 --remote`
4. `worker/index.js` の `SUPPORTED_YEARS` に `"2027"` を追加（必要なら `CURRENT_YEAR` も更新）
5. その年の judges 登録
6. `public/2027/index.html` を追加（`public/2026/index.html` を複製して年・開催日・会場・締切などを更新）。機能ページ（submit/judge など）は共通なので触らない。ポータル `public/index.html` の「開催年」に 2027 のカードを追加。
7. デプロイ

ページもコードも複製しない。バグ修正は1か所で全年に反映。

## ローカル/CI テスト

```bash
npm test     # node test_local.mjs（年ルーティング込み19項目）
npm run check
```

CI（`.github/workflows/ci.yml`）が push ごとに自動でテストを実行。`deploy.yml` は main で Cloudflare へデプロイ（要 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` と実 `database_id`）。

## データのエクスポート / アーカイブ

```bash
# 管理画面の「CSV出力」= 運営向けの結果一覧
# 年度まるごとの保全（スキーマ＋データ、審査員別スコア含む）:
wrangler d1 export agewec_2026 --remote --output agewec_2026.sql
```

## データを後から変えるときの注意

- 静的ページの変更は D1 データに影響なし。
- スキーマ変更は追加（列追加）中心。新しい `0002_*.sql` を足して `migrations apply`。
- 各行に版を記録済み（form/rules/privacy/rubric）。
- フォームは応募開始前、ルーブリックは審査開始前に凍結。
- 変更前に `wrangler d1 export` でバックアップ。
