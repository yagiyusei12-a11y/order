@echo off
chcp 65001 >nul
title 印刷エージェント（この窓を閉じないでください）
cd /d "%~dp0.."

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js が見つかりません。
  echo https://nodejs.org から LTS をインストールしてから、もう一度このファイルを開いてください。
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\iconv-lite" (
  echo 初回準備: npm install を実行します...
  call npm install --omit=dev
  if errorlevel 1 (
    echo npm install に失敗しました。
    pause
    exit /b 1
  )
)

echo 印刷エージェントを起動します。この黒い窓を閉じると印刷が止まります。
echo.
node "./scripts/print-agent.mjs"
echo.
echo エージェントが終了しました。
pause
