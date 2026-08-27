morder print agent (store PC)
=============================

1. Copy morder-print-agent.exe to the store PC (USB / chat / etc.)
2. Double-click to start (no order folder, no Node.js)
3. First run: storeId (e.g. pitsusaro) / staff email / password
4. Keep the window open
5. Optional: answer Y to register Windows Startup

Printer IPs are configured in store settings on the server.
Also opens the cash drawer (ESC/POS kick) when staff requests it.
Rebuild: powershell -File scripts\build-print-agent-exe.ps1

Standby VPS (outage): if DNS for morder.harunoyukoto.jp is not switched,
edit %APPDATA%\morder-print-agent\config.json baseUrl to
https://standby.morder.harunoyukoto.jp  (or http://133.18.180.76)
then restart the agent. Details: deploy/vps/STANDBY.txt
