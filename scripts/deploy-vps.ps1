#Requires -Version 5.1
<#
  Push origin/main, then on VPS: git pull, npm run build, restart systemd service.
  Configure via .env.deploy (copy from .env.deploy.example) or env vars:
  ORDER_VPS_HOST, ORDER_VPS_USER, ORDER_VPS_KEY, ORDER_VPS_PATH, ORDER_VPS_SERVICE
#>
param(
  [switch]$AllowDirty
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Set-Location $root

$envFile = Join-Path $root ".env.deploy"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
      $k = $matches[1].Trim()
      $v = $matches[2].Trim().Trim('"')
      [Environment]::SetEnvironmentVariable($k, $v, "Process")
    }
  }
}

$hostName = $env:ORDER_VPS_HOST
$user = if ($env:ORDER_VPS_USER) { $env:ORDER_VPS_USER } else { "ubuntu" }
$key = $env:ORDER_VPS_KEY
$remotePath = if ($env:ORDER_VPS_PATH) { $env:ORDER_VPS_PATH } else { "~/order" }
$service = if ($env:ORDER_VPS_SERVICE) { $env:ORDER_VPS_SERVICE } else { "order-app" }

if (-not $hostName -or -not $key) {
  Write-Host "Missing ORDER_VPS_HOST or ORDER_VPS_KEY. Copy .env.deploy.example to .env.deploy and edit." -ForegroundColor Red
  exit 1
}

if (-not (Test-Path $key)) {
  Write-Host "SSH key not found: $key" -ForegroundColor Red
  exit 1
}

$dirty = git status --porcelain 2>$null
if ($dirty -and -not $AllowDirty) {
  Write-Host "Working tree has uncommitted changes. Commit first, or pass -AllowDirty." -ForegroundColor Red
  git status -s
  exit 1
}

Write-Host "git push origin main ..." -ForegroundColor Cyan
git push origin main
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$remote = @"
set -e
cd $remotePath
git pull
npm run build
sudo systemctl restart $service
curl -sS http://127.0.0.1:3000/health || true
"@

Write-Host "SSH $user@${hostName}: pull, build, restart $service ..." -ForegroundColor Cyan
ssh -i $key -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$user@$hostName" $remote
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Deploy finished." -ForegroundColor Green
