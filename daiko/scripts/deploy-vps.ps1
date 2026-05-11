#Requires -Version 5.1
<#
  Push origin/main from repo root, then on VPS: git pull in DAIKO_VPS_PATH, prisma migrate, build, restart daiko-app.
  Run from repository ROOT (order/), or set DAIKO_ROOT to daiko folder parent.
  Configure via daiko/.env.deploy (copy from daiko/.env.deploy.example)
#>
param(
  [switch]$AllowDirty
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$daikoRoot = Join-Path $root ""

$envFile = Join-Path $daikoRoot ".env.deploy"
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

$hostName = $env:DAIKO_VPS_HOST
$user = if ($env:DAIKO_VPS_USER) { $env:DAIKO_VPS_USER } else { "ubuntu" }
$key = $env:DAIKO_VPS_KEY
$remotePath = if ($env:DAIKO_VPS_PATH) { $env:DAIKO_VPS_PATH } else { "~/order" }
$service = if ($env:DAIKO_VPS_SERVICE) { $env:DAIKO_VPS_SERVICE } else { "daiko-app" }

if (-not $hostName -or -not $key) {
  Write-Host "Missing DAIKO_VPS_HOST or DAIKO_VPS_KEY. Copy daiko/.env.deploy.example to daiko/.env.deploy" -ForegroundColor Red
  exit 1
}

if (-not (Test-Path $key)) {
  Write-Host "SSH key not found: $key" -ForegroundColor Red
  exit 1
}

$repoRoot = Split-Path -Parent $daikoRoot
Set-Location $repoRoot

$dirty = git status --porcelain 2>$null
if ($dirty -and -not $AllowDirty) {
  Write-Host "Working tree has uncommitted changes. Commit first, or pass -AllowDirty." -ForegroundColor Red
  git status -s
  exit 1
}

Write-Host "git push origin main ..." -ForegroundColor Cyan
git push origin main
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$daikoRel = "daiko"
$remote = "set -e; cd $remotePath; git pull; cd $daikoRel; npm ci; npx prisma migrate deploy; npx prisma generate; npm run build; sudo systemctl restart $service; sleep 2; curl -sS http://127.0.0.1:3001/health"

Write-Host "SSH $user@${hostName}: daiko pull, migrate, build, restart $service ..." -ForegroundColor Cyan
& ssh -i $key -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$user@$hostName" $remote
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Daiko deploy finished." -ForegroundColor Green
