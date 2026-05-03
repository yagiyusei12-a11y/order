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
