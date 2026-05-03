VPS デプロイ（概要）
====================

前提: Ubuntu、Docker、Node 20、~/.ssh でログインできること。.env を作成済み。

1) 最新コード
   cd ~/order && git pull

2) ビルドまで一発
   bash deploy/vps/bootstrap.sh

3) 常時起動（systemd）
   sudo bash deploy/vps/install-systemd.sh

4) HTTPS（DNS がサーバ IP を向いたあと）
   bash deploy/vps/up-proxy.sh

止めたい:
  sudo systemctl stop order-app
  cd ~/order/deploy/vps && sudo docker compose -f docker-compose.proxy.yml down
