# Daiko（代行業向け SaaS 基盤）

`order` リポジトリ内の **独立サブプロジェクト**（別 `package.json` / 別 Prisma スキーマ / 別ポート）。本番では **PostgreSQL の別データベース**（例: `daiko`）を推奨。

## 機能スコープ（実装済み骨格）

- マルチテナント: テナント登録、設定、サブスクプラン（FREE 開始）、RBAC（`owner` ロール）
- 認証: 登録・ログイン（slug+email+password）、JWT アクセストークン + リフレッシュトークン
- マスタ: 従業員、随伴車、料金プラン＋版
- 業務: 日報（事業日自動）、運行明細＋料金計算、タイムカード、酒気確認
- 給与: 月次プレビュー（ドラフト保存）・確定ロック
- 帳票: テンプレート CRUD（シード）と HTML プレビュー（PDF は後段で Chromium 等を追加可能）

## ブラウザ UI（SPA）

- `daiko/web` を Vite でビルドし、成果物は `daiko/public/app/` に出力されます。
- 本番・開発サーバとも `http://<host>:3001/app/` がエントリ（`/` と `/web` は `/app/` へリダイレクト）。
- `npm run build` は **先に web をビルド**してから `tsc` で API サーバをコンパイルします。

## ローカル開発

```bash
cd daiko
cp .env.example .env
# DATABASE_URL を PostgreSQL の daiko DB に向ける
npx prisma migrate deploy
npm run db:seed
npm run dev
# API: http://localhost:3001/health
# UI 開発: 別ターミナルで cd daiko/web && npm run dev（Vite が /api を 3001 にプロキシ）
```

## API プレフィックス

`POST /api/v1/auth/register` … 初回テナント＋オーナー  
`POST /api/v1/auth/login` … `{ slug, email, password }`  
`Authorization: Bearer <accessToken>` で以降の API。

## 本番（同一 VPS）

- DNS: `daiko.harunoyukoto.jp` → VPS
- Caddy: [deploy/vps/Caddyfile](../deploy/vps/Caddyfile) にホスト追加済み（`127.0.0.1:3001` 想定）
- systemd: `daiko/deploy/daiko-app.service` を `/etc/systemd/system/` に配置
- デプロイ: `daiko/scripts/deploy-vps.ps1`（`.env.deploy` に `DAIKO_VPS_*`）

## 事業日

テナントの `TenantSettings.businessDayRollHour` と `Tenant.timezone` に基づき、`src/lib/business-date.ts`（Luxon）で **YYYY-MM-DD** を算出し、日報・打刻・酒気に保存する。
