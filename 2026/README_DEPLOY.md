# AGEWEC 2026 — デプロイ手順（Cloudflare Workers + D1）

## 構成

```
agewec-site/
├─ public/            静的サイト（Worker が /api/* 以外をここから配信）
│  ├─ index.html      トップ（参加登録ボタン → /submit/）
│  ├─ submit/         応募フォーム（POST /api/submit）
│  ├─ entries/        公開作品一覧（GET /api/entries）
│  ├─ judge/          審査員ページ（要 Access・/api/judge/*）
│  ├─ admin/          管理ページ（要 Access admin・/api/admin/*）
│  ├─ rules/ privacy/ ai-guidelines/   同意リンク先
│  ├─ styles.css script.js assets/
├─ worker/index.js    API + 認証 + 静的フォールバック
├─ migrations/0001_init.sql   D1 スキーマ
└─ wrangler.jsonc
```

## 1. 準備

```bash
npm i -g wrangler
wrangler login
```

## 2. D1 を作成して接続

```bash
wrangler d1 create agewec
```

出力された `database_id` を `wrangler.jsonc` の `REPLACE_WITH_D1_DATABASE_ID` に貼る。

## 3. スキーマ適用（マイグレーション）

```bash
# ローカル
wrangler d1 migrations apply agewec
# 本番
wrangler d1 migrations apply agewec --remote
```

## 4. 審査員・管理者を登録

`/judge` `/admin` の API は `judges` テーブルの role で制御します。メールは Cloudflare Access が検証したものを使います。

```bash
wrangler d1 execute agewec --remote --command \
"INSERT INTO judges (email,name,role) VALUES \
('admin@example.com','運営','admin'), \
('judge1@example.com','審査員1','judge');"
```

## 5. Access で /judge と /admin を保護（重要）

Cloudflare ダッシュボード → Zero Trust → Access → Applications で、self-hosted アプリを2つ作成。

- パス `/admin*` … ポリシー: 管理者メールのみ許可
- パス `/judge*` … ポリシー: 審査員＋管理者メールを許可

Access が通った後、リクエストに `Cf-Access-Authenticated-User-Email` が付与され、Worker がそのメールを `judges` テーブルで照合して role を確認します。**Access を設定しないと /judge /admin の API は 401 になります。**

## 6. （任意）Turnstile でボット対策

```bash
wrangler secret put TURNSTILE_SECRET
```

設定すると `/api/submit` でトークン検証が有効化されます。フォーム側に Turnstile ウィジェットを追加し、`cf-turnstile-response` を一緒に送ってください（未設定なら検証はスキップされます）。

## 7. （任意）確認メール

`worker/index.js` の `sendConfirmationEmail()` に任意のメール送信プロバイダ（Resend / SendGrid / Postmark 等）をAPIキーで接続。未接続でも応募は失敗しません。

## 8. ローカル確認 / デプロイ

```bash
wrangler dev          # ローカル（D1 はローカルレプリカ）
wrangler deploy       # 本番へ
```

## API 一覧

| メソッド | パス | 認証 | 用途 |
|---|---|---|---|
| POST | /api/submit | 公開 | 応募受付（受付ロック中は403） |
| GET | /api/entries | 公開 | 公開フィールドのみ返す |
| GET | /api/judge/me | Access | ログイン審査員情報 |
| GET | /api/judge/assignments | Access | 担当作品＋自分の採点 |
| POST | /api/judge/score | Access | 採点の保存（upsert） |
| GET | /api/admin/submissions | Access(admin) | 全応募＋スコア＋平均 |
| POST | /api/admin/update | Access(admin) | 状態/公開/finalist/賞/不備/失格 |
| POST | /api/admin/lock | Access(admin) | 受付ロックON/OFF |
| GET | /api/admin/export.csv | Access(admin) | CSV出力 |

## データを後から変えるときの注意

- 静的ページ（HTML/CSS/JS）の変更は D1 のデータに影響しません。いつでも安全。
- スキーマ変更は**追加（列の追加）中心**にし、削除・改名は避ける。新しいマイグレーションファイル（`0002_...sql`）を足して `migrations apply` する。
- 各行に版が記録されます（submissions: form/rules/privacy バージョン、scores: rubric_version）。後から規約・ルーブリックを変えても、どの版で記録されたか追跡できます。
- 重要な運用ルール：**フォーム項目は応募開始前に、採点ルーブリックは審査開始前に凍結**する。途中変更は比較可能性を壊します。
- 変更前に `wrangler d1 export agewec --remote --output backup.sql` でバックアップを取得。

## CI / CD（GitHub Actions）

- `.github/workflows/ci.yml` … push / PR ごとに `node test_local.mjs`（本物のWorkerを node:sqlite 上で実行する24項目テスト）を自動実行。シークレット不要。
- `.github/workflows/deploy.yml` … main への push または手動実行で、テスト通過後に Cloudflare へデプロイ（D1マイグレーション→`wrangler deploy`）。以下のリポジトリシークレットが必要:
  - `CLOUDFLARE_API_TOKEN`（Workers + D1 編集権限）
  - `CLOUDFLARE_ACCOUNT_ID`
  - かつ `wrangler.jsonc` に実際の D1 `database_id` が入っていること。

ローカル開発は任意（`npm run dev`）。ロジックは CI が、実環境（Access・ルーティング）はデプロイ後の Cloudflare が確認する役割分担。

## ローカルでテストを走らせる場合

```bash
npm test        # = node test_local.mjs（24項目）
npm run check   # worker の構文チェック
```
