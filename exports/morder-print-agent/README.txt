morder print agent (store PC)
=============================

1. Copy morder-print-agent.exe to the store PC (USB / chat / etc.)
2. Double-click to start (no order folder, no Node.js)
3. First run: storeId (e.g. pitsusaro) / staff email / password
4. Keep the window open
5. Optional: answer Y to register Windows Startup

Printer IPs are configured in store settings on the server.
Rebuild: powershell -File scripts\build-print-agent-exe.ps1
