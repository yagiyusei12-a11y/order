-- PostgreSQL で Daiko 用 DB を作る例（スーパーユーザで実行）。
-- アプリ用ロールが別にある場合は OWNER / GRANT を環境に合わせて調整してください。

CREATE DATABASE daiko
  WITH TEMPLATE = template0
  ENCODING = 'UTF8'
  LC_COLLATE = 'C.UTF-8'
  LC_CTYPE = 'C.UTF-8';

-- 例: アプリユーザーに権限付与（ユーザー名は .env の DATABASE_URL に合わせる）
-- GRANT ALL PRIVILEGES ON DATABASE daiko TO order_app;
-- \c daiko
-- GRANT ALL ON SCHEMA public TO order_app;
