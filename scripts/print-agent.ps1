#Requires -Version 5.1
<#
.SYNOPSIS
  店舗LANサーマル印刷エージェント（Windows・Node不要）

.DESCRIPTION
  初回のみ店舗ID / メール / パスワードを入力。トークンは %APPDATA%\morder-print-agent\config.json に保存。
  exe 化: scripts\build-print-agent-exe.ps1
#>
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try { chcp 65001 | Out-Null } catch {}
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {}

$DefaultBase = "https://morder.harunoyukoto.jp"
$DefaultStore = "pitsusaro"
$ConfigDir = Join-Path $env:APPDATA "morder-print-agent"
$ConfigPath = Join-Path $ConfigDir "config.json"
$PollMs = 1500
if ($env:PRINT_AGENT_POLL_MS -match '^\d+$') {
  $n = [int]$env:PRINT_AGENT_POLL_MS
  if ($n -ge 800) { $PollMs = $n }
}

$script:Config = [ordered]@{
  baseUrl = $DefaultBase
  storeId = ""
  email   = ""
  token   = ""
}

function Get-SelfPath {
  try {
    $p = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
    if ($p -and ($p -like '*.exe')) { return $p }
  } catch {}
  if ($PSCommandPath) { return $PSCommandPath }
  if ($MyInvocation.MyCommand.Path) { return $MyInvocation.MyCommand.Path }
  return $null
}

function Load-Config {
  if (-not (Test-Path -LiteralPath $ConfigPath)) { return $null }
  try {
    $j = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    return [ordered]@{
      baseUrl = ([string]$j.baseUrl).TrimEnd('/')
      storeId = ([string]$j.storeId).Trim().ToLowerInvariant()
      email   = ([string]$j.email).Trim()
      token   = ([string]$j.token).Trim()
    }
  } catch {
    return $null
  }
}

function Save-Config {
  New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
  $obj = [pscustomobject]@{
    baseUrl = $script:Config.baseUrl
    storeId = $script:Config.storeId
    email   = $script:Config.email
    token   = $script:Config.token
  }
  $obj | ConvertTo-Json | Set-Content -LiteralPath $ConfigPath -Encoding UTF8
  Write-Host "設定を保存しました: $ConfigPath"
}

function Get-BaseUrl {
  if ($env:PRINT_AGENT_BASE) { return $env:PRINT_AGENT_BASE.TrimEnd('/') }
  return ([string]$script:Config.baseUrl).TrimEnd('/')
}

function Get-StoreId {
  if ($env:PRINT_AGENT_STORE) { return $env:PRINT_AGENT_STORE.Trim().ToLowerInvariant() }
  return ([string]$script:Config.storeId).Trim().ToLowerInvariant()
}

function Get-AuthToken {
  if ($env:PRINT_AGENT_COOKIE) {
    $c = $env:PRINT_AGENT_COOKIE.Trim()
    if ($c -match '(?i)^access=(.+)$') { return $Matches[1].Trim() }
    if ($c -match '=') {
      # access=... or other cookie pair → use value after first =
      $idx = $c.IndexOf('=')
      return $c.Substring($idx + 1).Trim()
    }
    return $c
  }
  return ([string]$script:Config.token).Trim()
}

function Get-AuthHeaders {
  $token = Get-AuthToken
  $h = @{
    Accept = "application/json"
  }
  if ($token) {
    # Cookie ヘッダは PowerShell/HttpWebRequest で送れないことがあるため Bearer を使う
    $h["Authorization"] = "Bearer $token"
  }
  return $h
}

function Read-Prompt([string]$Label, [string]$Fallback = "") {
  $hint = if ($Fallback) { " [$Fallback]" } else { "" }
  $v = Read-Host "$Label$hint"
  if ([string]::IsNullOrWhiteSpace($v)) { return $Fallback }
  return $v.Trim()
}

function Read-PasswordPrompt {
  $sec = Read-Host "パスワード" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Invoke-AgentApi {
  param(
    [string]$PathSuffix,
    [string]$Method = "GET",
    [object]$Body = $null
  )
  $uri = (Get-BaseUrl) + $PathSuffix
  $headers = Get-AuthHeaders
  $params = @{
    Uri             = $uri
    Method          = $Method
    Headers         = $headers
    UseBasicParsing = $true
  }
  if ($null -ne $Body) {
    $params.ContentType = "application/json; charset=utf-8"
    $params.Body = ($Body | ConvertTo-Json -Compress -Depth 6)
  }
  try {
    $resp = Invoke-WebRequest @params
    $json = $null
    if ($resp.Content) {
      $json = $resp.Content | ConvertFrom-Json
    }
    return @{ Status = [int]$resp.StatusCode; Json = $json }
  } catch {
    $ex = $_.Exception
    $status = 0
    $json = $null
    $respObj = $null
    if ($_.Exception.Response) { $respObj = $_.Exception.Response }
    elseif ($ex.InnerException -and $ex.InnerException.Response) { $respObj = $ex.InnerException.Response }
    if ($respObj) {
      try { $status = [int]$respObj.StatusCode } catch {}
      try {
        $stream = $respObj.GetResponseStream()
        if ($stream) {
          $reader = New-Object System.IO.StreamReader($stream)
          $text = $reader.ReadToEnd()
          $reader.Close()
          if ($text) { $json = $text | ConvertFrom-Json }
        }
      } catch {}
    }
    if ($status -eq 401) {
      $err = New-Object System.Exception ("unauthorized")
      $err | Add-Member -NotePropertyName StatusCode -NotePropertyValue 401
      throw $err
    }
    $msg = if ($json -and $json.error) { [string]$json.error } else { $ex.Message }
    throw (New-Object System.Exception($msg))
  }
}

function Login-Interactive([string]$Reason) {
  if ($Reason) { Write-Host $Reason }
  Write-Host "スタッフログイン（パスワードは保存しません）"
  $sid = Read-Prompt "店舗ID" (Get-StoreId)
  if (-not $sid) { $sid = $DefaultStore }
  $email = Read-Prompt "メール" $script:Config.email
  $password = Read-PasswordPrompt
  if (-not $sid -or -not $email -or -not $password) {
    throw "店舗ID・メール・パスワードは必須です"
  }
  $base = Get-BaseUrl
  if (-not $base) { $base = $DefaultBase }
  $uri = "$base/auth/login"
  $body = @{ storeId = $sid; email = $email; password = $password } | ConvertTo-Json -Compress
  $resp = Invoke-WebRequest -Uri $uri -Method POST -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType "application/json; charset=utf-8" -UseBasicParsing
  $j = $resp.Content | ConvertFrom-Json
  if (-not $j.token) { throw "ログイン応答に token がありません（サーバー更新が必要です）" }
  $script:Config.baseUrl = $base
  $script:Config.storeId = if ($j.storeId) { [string]$j.storeId } else { $sid }
  $script:Config.storeId = $script:Config.storeId.Trim().ToLowerInvariant()
  $script:Config.email = if ($j.email) { [string]$j.email } else { $email }
  $script:Config.token = [string]$j.token
  Save-Config
}

function Register-StartupIfAsked {
  if ($env:PRINT_AGENT_SKIP_STARTUP_PROMPT -eq "1") { return }
  $startupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
  $startupBat = Join-Path $startupDir "morder-print-agent.bat"
  if (Test-Path -LiteralPath $startupBat) {
    Write-Host "スタートアップ登録済みです。"
    return
  }
  $ans = Read-Host "PC起動時に自動で始めますか？ (Y/N) [N]"
  if ($ans -notmatch '^(y|yes)$') { return }
  $self = Get-SelfPath
  if (-not $self) {
    Write-Host "起動パスが取得できないためスタートアップ登録をスキップします。"
    return
  }
  New-Item -ItemType Directory -Force -Path $startupDir | Out-Null
  if ($self -like '*.exe') {
    $body = "@echo off`r`nstart `"`" `"$self`"`r`n"
  } elseif ($self -like '*.ps1') {
    $body = "@echo off`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"$self`"`r`n"
  } else {
    $body = "@echo off`r`nstart `"`" `"$self`"`r`n"
  }
  Set-Content -LiteralPath $startupBat -Value $body -Encoding ASCII
  Write-Host "スタートアップに登録しました: $startupBat"
}

function New-EscPosBytes([string[]]$Lines) {
  $enc = [System.Text.Encoding]::GetEncoding(932)
  $ms = New-Object System.IO.MemoryStream
  $ms.WriteByte(0x1b); $ms.WriteByte(0x40)
  $ms.WriteByte(0x1c); $ms.WriteByte(0x26)
  $ms.WriteByte(0x1b); $ms.WriteByte(0x61); $ms.WriteByte(0x00)
  foreach ($line in $Lines) {
    $t = [string]$line
    $t = $t -replace "[\r\n]+", " "
    $bytes = $enc.GetBytes($t + "`n")
    $ms.Write($bytes, 0, $bytes.Length)
  }
  $ms.WriteByte(0x0a); $ms.WriteByte(0x0a)
  $ms.WriteByte(0x1d); $ms.WriteByte(0x56); $ms.WriteByte(0x00)
  return $ms.ToArray()
}

function New-EscPosDrawerKick {
  # Epson 互換 ESC p — キャッシュドロア開放（プリンタ経由配線）
  return [byte[]]@(0x1b, 0x70, 0x00, 0x19, 0xfa)
}

function Send-TcpBytes([string]$HostName, [int]$Port, [byte[]]$Bytes) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $client.BeginConnect($HostName, $Port, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne(4000, $false)) {
      throw "connect timeout"
    }
    $client.EndConnect($iar)
    $stream = $client.GetStream()
    $stream.Write($Bytes, 0, $Bytes.Length)
    $stream.Flush()
  } finally {
    $client.Close()
  }
}

function Test-Ipv4([string]$HostName) {
  return $HostName -match '^\d{1,3}(\.\d{1,3}){3}$'
}

function Process-Once {
  $sid = Get-StoreId
  $data = (Invoke-AgentApi -PathSuffix "/stores/$([uri]::EscapeDataString($sid))/print-jobs?status=pending&take=10").Json
  $printers = $data.printers
  $port = 9100
  if ($printers -and $printers.port) {
    $p = [int]$printers.port
    if ($p -gt 0) { $port = $p }
  }
  $jobs = @()
  if ($data.jobs) { $jobs = @($data.jobs) }
  foreach ($job in $jobs) {
    $payload = $job.payload
    $isDrawer = ($job.kind -eq "drawer_open") -or ($payload -and $payload.action -eq "drawer_kick")
    $target = "receipt"
    if (-not $isDrawer -and $payload -and $payload.target -eq "kitchen") { $target = "kitchen" }
    $hostName = $null
    if ($printers) {
      if ($target -eq "kitchen") { $hostName = [string]$printers.kitchenIp }
      else { $hostName = [string]$printers.receiptIp }
    }
    $lines = @()
    if ($payload -and $payload.lines) { $lines = @($payload.lines | ForEach-Object { [string]$_ }) }
    try {
      if (-not (Test-Ipv4 $hostName)) { throw "$target printer IP missing" }
      if ($isDrawer) {
        $bytes = New-EscPosDrawerKick
      } else {
        if ($lines.Count -eq 0) { throw "empty lines" }
        $bytes = New-EscPosBytes -Lines $lines
      }
      Send-TcpBytes -HostName $hostName -Port $port -Bytes $bytes
      Invoke-AgentApi -PathSuffix "/stores/$([uri]::EscapeDataString($sid))/print-jobs/$([uri]::EscapeDataString($job.id))/complete" `
        -Method POST -Body @{ status = "done" } | Out-Null
      $label = if ($isDrawer) { "drawer" } else { $target }
      Write-Host "[ok] $($job.kind)/$label → $hostName ($($job.id))"
    } catch {
      $msg = $_.Exception.Message
      Write-Host "[fail] $($job.id): $msg"
      try {
        Invoke-AgentApi -PathSuffix "/stores/$([uri]::EscapeDataString($sid))/print-jobs/$([uri]::EscapeDataString($job.id))/complete" `
          -Method POST -Body @{ status = "failed"; error = $msg } | Out-Null
      } catch {}
    }
  }
}

function Ensure-Auth {
  $file = Load-Config
  if ($file) {
    $script:Config.baseUrl = $file.baseUrl
    $script:Config.storeId = $file.storeId
    $script:Config.email = $file.email
    $script:Config.token = $file.token
  }
  if ($env:PRINT_AGENT_BASE) {
    $script:Config.baseUrl = $env:PRINT_AGENT_BASE.TrimEnd('/')
  }
  if ($env:PRINT_AGENT_STORE) {
    $script:Config.storeId = $env:PRINT_AGENT_STORE.Trim().ToLowerInvariant()
  }
  if ($env:PRINT_AGENT_COOKIE -and (Get-StoreId)) { return }
  if (-not $script:Config.token -or -not $script:Config.storeId) {
    Login-Interactive "初回設定: ログインが必要です。"
  }
}

# --- main ---
try {
  $Host.UI.RawUI.WindowTitle = "印刷エージェント（この窓を閉じないでください）"
} catch {}

Ensure-Auth
if (-not (Get-StoreId)) { throw "店舗IDがありません" }
if (-not $env:PRINT_AGENT_COOKIE -and -not $script:Config.token) { throw "トークンがありません" }

Register-StartupIfAsked

Write-Host "print-agent store=$(Get-StoreId) base=$(Get-BaseUrl) poll=${PollMs}ms"
Write-Host "この窓を閉じると印刷が止まります。"

while ($true) {
  try {
    Process-Once
  } catch {
    $ex = $_.Exception
    if (($ex.StatusCode -eq 401) -or ($ex.Message -match 'unauthorized')) {
      Write-Host "[auth] ログインの期限切れまたは無効です。"
      try {
        Login-Interactive "再ログインしてください。"
      } catch {
        Write-Host "[auth] $($_.Exception.Message)"
        Start-Sleep -Seconds 5
      }
    } else {
      Write-Host "[poll] $($ex.Message)"
    }
  }
  Start-Sleep -Milliseconds $PollMs
}
