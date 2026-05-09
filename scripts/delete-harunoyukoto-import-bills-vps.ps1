#Requires -Version 5.1
<#
  VPS 上の DB で harunoyukoto の CSV 取込伝票（label が import:）を削除する。
  .env.deploy（deploy:vps と同じ）が必要。

  例（削除前に件数だけ見る）:
    .\scripts\delete-harunoyukoto-import-bills-vps.ps1

  削除実行:
    .\scripts\delete-harunoyukoto-import-bills-vps.ps1 -Execute
#>
param(
  [switch]$Execute
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$envFile = Join-Path $root ".env.deploy"
if (-not (Test-Path $envFile)) {
  Write-Host "Missing .env.deploy (copy from .env.deploy.example)." -ForegroundColor Red
  exit 1
}

Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
  if ($_ -match '^\s*([^#=]+)=(.*)$') {
    $k = $matches[1].Trim()
    $v = $matches[2].Trim().Trim('"')
    [Environment]::SetEnvironmentVariable($k, $v, "Process")
  }
}

$hostName = $env:ORDER_VPS_HOST
$user = if ($env:ORDER_VPS_USER) { $env:ORDER_VPS_USER } else { "ubuntu" }
$key = $env:ORDER_VPS_KEY
$remotePath = if ($env:ORDER_VPS_PATH) { $env:ORDER_VPS_PATH } else { "~/order" }

if (-not $hostName -or -not $key) {
  Write-Host "ORDER_VPS_HOST or ORDER_VPS_KEY missing in .env.deploy" -ForegroundColor Red
  exit 1
}

if (-not (Test-Path $key)) {
  Write-Host "SSH key not found: $key" -ForegroundColor Red
  exit 1
}

$execFlag = if ($Execute) { " --execute" } else { "" }
$remoteCmd = "set -e; cd $remotePath; npx --yes tsx prisma/delete-harunoyukoto-import-bills.ts${execFlag}"

Write-Host "SSH ${user}@${hostName}: delete-harunoyukoto-import-bills..." -ForegroundColor Cyan
& ssh -i $key -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$user@$hostName" $remoteCmd
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Done." -ForegroundColor Green
