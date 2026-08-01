@echo off
chcp 65001 >nul
title 印刷エージェント（この窓を閉じないでください）
cd /d "%~dp0"

set "EXE1=%~dp0..\exports\morder-print-agent\morder-print-agent.exe"
set "EXE2=%~dp0morder-print-agent.exe"
if exist "%EXE1%" (
  start "" "%EXE1%"
  exit /b 0
)
if exist "%EXE2%" (
  start "" "%EXE2%"
  exit /b 0
)

echo Node不要の PowerShell エージェントを起動します。
echo この黒い窓を閉じると印刷が止まります。
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0print-agent.ps1"
echo.
echo エージェントが終了しました。
pause
