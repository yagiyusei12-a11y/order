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
- PostgreSQL: order と同じ Docker 内 Postgres のことが多い。その場合は OS の postgres ユーザーは無いので、例:
    cd ~/order && docker compose exec -T postgres psql -U order -d order -c "CREATE DATABASE daiko;"
  （別サーバに素の PostgreSQL がある場合は create-daiko-db.sql をスーパーユーザで流す）
  daiko/.env に DATABASE_URL（daiko DB を指す）、JWT_SECRET、PORT=3001 を設定
- systemd: ビルド後に（リポジトリルートを引数に）
    sudo bash deploy/vps/install-daiko-systemd.sh ~/order
  手編集する場合は daiko/deploy/daiko-app.service の WorkingDirectory / EnvironmentFile をサーバパスに合わせる
- 初回は daiko でビルドが必須（dist が無いと systemd が即落ちする）:
    cd ~/order/daiko && npm ci && npx prisma migrate deploy && npx prisma generate && npm run build && sudo systemctl restart daiko-app
  （`npm run build` で `daiko/web` がビルドされ `public/app/` に SPA が出力されること）
- ヘルス: curl -sS http://127.0.0.1:3001/health
- PC からデプロイ: daiko/.env.deploy を用意し、リポジトリルートで
    powershell -NoProfile -ExecutionPolicy Bypass -File ./daiko/scripts/deploy-vps.ps1
  または order と同じ VPS へまとめて反映する場合、ルートの .env.deploy に
    ORDER_VPS_DAIKO_DEPLOY=1
  を置き npm run deploy:vps（order の pull/build のあと daiko も migrate/build/restart）
- PDF: 本番で Playwright を使う場合、初回のみ VPS で
    cd ~/order/daiko && npx playwright install chromium

Caddy（プロキシ）でホスト名を増やしたとき
--------------------------------------
- Caddyfile に新しい `*.harunoyukoto.jp { ... }` を追加したあと、`reload` だけでは TLS 対象に載らないことがある。
  その場合はプロキシを再起動する:
    cd ~/order/deploy/vps && docker compose -f docker-compose.proxy.yml restart caddy
- ログで `certificate obtained successfully` と対象ホスト名が出るか確認:
    docker compose -f docker-compose.proxy.yml logs caddy --tail 80
- 外向き HTTPS 確認: curl -sS https://daiko.harunoyukoto.jp/health
