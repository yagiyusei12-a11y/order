#Requires -Version 5.1
<#
  ローカルの取引詳細 CSV を SCP で VPS のアプリ直下へ送り、SSH で import:harunoyukoto-sales を実行する。
  .env.deploy（deploy:vps と同じ）が必要。

  例:
    .\scripts\import-harunoyukoto-sales-vps.ps1 -CsvPath "C:\Users\...\取引詳細....csv"
    .\scripts\import-harunoyukoto-sales-vps.ps1 -CsvPath "...\xxx.csv" -DryRun
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$CsvPath,
  [switch]$DryRun
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

$resolved = Resolve-Path -LiteralPath $CsvPath -ErrorAction SilentlyContinue
if (-not $resolved) {
  Write-Host "CSV not found: $CsvPath" -ForegroundColor Red
  exit 1
}

$remoteFileName = "harunoyukoto-sales-import.csv"
$scpDest = "${user}@${hostName}:${remotePath}/${remoteFileName}"

Write-Host "SCP -> ${scpDest}" -ForegroundColor Cyan
& scp -i $key -o BatchMode=yes -o StrictHostKeyChecking=accept-new $resolved.Path $scpDest
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$dryFlag = if ($DryRun) { " --dry-run" } else { "" }
# VPS 上の DB（~/order/.env）へ書き込む。tsx は devDependency のため npx で実行。
$remoteCmd = "set -e; cd $remotePath; npx --yes tsx prisma/import-harunoyukoto-transactions-csv.ts --file ./${remoteFileName}${dryFlag}"

Write-Host "SSH ${user}@${hostName}: import (DATABASE_URL on VPS)..." -ForegroundColor Cyan
& ssh -i $key -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$user@$hostName" $remoteCmd
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Done." -ForegroundColor Green
