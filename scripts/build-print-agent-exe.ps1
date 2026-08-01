#Requires -Version 5.1
# Build print-agent.ps1 into a standalone exe under exports\morder-print-agent\
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Src = Join-Path $PSScriptRoot "print-agent.ps1"
$OutDir = Join-Path $Root "exports\morder-print-agent"
$OutExe = Join-Path $OutDir "morder-print-agent.exe"

if (-not (Test-Path -LiteralPath $Src)) {
  throw "missing: $Src"
}

Write-Host "Installing/importing ps2exe module (CurrentUser) ..."
if (-not (Get-Module -ListAvailable -Name ps2exe)) {
  Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser | Out-Null
  Set-PSRepository -Name PSGallery -InstallationPolicy Trusted -ErrorAction SilentlyContinue
  Install-Module -Name ps2exe -Scope CurrentUser -Force -AllowClobber
}
Import-Module ps2exe -Force

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
if (Test-Path -LiteralPath $OutExe) { Remove-Item -LiteralPath $OutExe -Force }

Write-Host "Building $OutExe ..."
Invoke-ps2exe `
  -inputFile $Src `
  -outputFile $OutExe `
  -title "Print Agent" `
  -description "morder LAN thermal print agent" `
  -company "harunoyukoto" `
  -product "morder-print-agent" `
  -version "1.0.0.0" `
  -noConsole:$false `
  -requireAdmin:$false

if (-not (Test-Path -LiteralPath $OutExe)) {
  throw "exe was not created"
}

@(
  "morder print agent (store PC)",
  "=============================",
  "",
  "1. Copy morder-print-agent.exe to the store PC (USB / chat / etc.)",
  "2. Double-click to start (no order folder, no Node.js)",
  "3. First run: storeId (e.g. pitsusaro) / staff email / password",
  "4. Keep the window open",
  "5. Optional: answer Y to register Windows Startup",
  "",
  "Printer IPs are configured in store settings on the server.",
  "Rebuild: powershell -File scripts\build-print-agent-exe.ps1"
) | Set-Content -LiteralPath (Join-Path $OutDir "README.txt") -Encoding UTF8

Write-Host "OK: $OutExe"
Get-Item -LiteralPath $OutExe | Format-List FullName, Length, LastWriteTime
