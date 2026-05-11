VPS デプロイ（概要）
====================

前提: Ubuntu、Docker、Node 20、~/.ssh でログインできること。

【いちばん簡単】.env を中身を探さず全部置き換える
   cd ~/order
   cp .env .env.bak  （.env があるときだけ）
   cp deploy/vps/env-overwrite-ready.txt .env
   続けて: npx prisma migrate deploy && npm run build && sudo systemctl restart order-app
   ※ git にまだ無い場合は PC で commit/push してから git pull

.env が空でつらいとき（スクリプト版・要 git pull）:
   cd ~/order && bash deploy/vps/fill-env-secrets.sh --match-docker-default
   （一度も DB を消していない・compose 既定の Postgres のとき）

初めからランダムな DB パスワードでよいとき:
   bash deploy/vps/fill-env-secrets.sh

1) 最新コード
   cd ~/order && git pull

2) ビルドまで一発（.env が埋まっていること）
   bash deploy/vps/bootstrap.sh

3) 常時起動（systemd）※ bootstrap で dist ができたあと
   sudo bash deploy/vps/install-systemd.sh

4) HTTPS（DNS がサーバ IP を向いたあと）
   bash deploy/vps/up-proxy.sh

止めたい:
  sudo systemctl stop order-app
  cd ~/order/deploy/vps && sudo docker compose -f docker-compose.proxy.yml down

---
Daiko（代行 SaaS / daiko サブフォルダ）
--------------------------------------
- コード: リポジトリの daiko/（別 package.json・Prisma・ポート既定 3001）
- Caddy: daiko.harunoyukoto.jp → host.docker.internal:3001（DNS を向けたあと有効）
- PostgreSQL: 初回のみスーパーユーザで DB 作成（例）
    sudo -u postgres psql -f deploy/vps/create-daiko-db.sql
  daiko/.env に DATABASE_URL（daiko DB を指す）、JWT_SECRET、PORT=3001 を設定
- systemd: ビルド後に（リポジトリルートを引数に）
    sudo bash deploy/vps/install-daiko-systemd.sh ~/order
  手編集する場合は daiko/deploy/daiko-app.service の WorkingDirectory / EnvironmentFile をサーバパスに合わせる
- ヘルス: curl -sS http://127.0.0.1:3001/health
- PC からデプロイ: daiko/.env.deploy を用意し、リポジトリルートで
    powershell -NoProfile -ExecutionPolicy Bypass -File ./daiko/scripts/deploy-vps.ps1
  または order と同じ VPS へまとめて反映する場合、ルートの .env.deploy に
    ORDER_VPS_DAIKO_DEPLOY=1
  を置き npm run deploy:vps（order の pull/build のあと daiko も migrate/build/restart）
- PDF: 本番で Playwright を使う場合、初回のみ VPS で
    cd ~/order/daiko && npx playwright install chromium
