param()

$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class HddtConsoleWindow {
    [DllImport("kernel32.dll")]
    public static extern IntPtr GetConsoleWindow();

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@

$SW_HIDE = 0
$SW_RESTORE = 9
$consoleHandle = [HddtConsoleWindow]::GetConsoleWindow()

$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Portable Windows is a loopback-only HTTP application. The browser must keep
# the same local session cookie between GET /api/app/status and protected POSTs.
# Respect an explicit caller override, otherwise select the local HTTP cookie.
if (-not $env:HDDT_INSECURE_HTTP) { $env:HDDT_INSECURE_HTTP = '1' }
if (-not $env:HDDT_BIND_HOST) { $env:HDDT_BIND_HOST = '127.0.0.1' }
$serverRuntime = Join-Path $baseDir 'runtime\node.exe'
$serverEntry = Join-Path $baseDir 'app\dist\server\index.js'
$serverWorkingDir = Join-Path $baseDir 'app'
$env:NODE_ENV = 'production'
$appDataDir = Join-Path $env:APPDATA 'HDDT'
$runtimePath = Join-Path $appDataDir 'runtime.json'
$versionPath = Join-Path $baseDir 'VERSION'
$expectedVersion = ''
if (Test-Path -LiteralPath $versionPath) {
  try { $expectedVersion = (Get-Content -LiteralPath $versionPath -Raw).Trim() } catch {}
}

$ownedProcess = $null
$script:exitRequested = $false
$script:unexpectedStop = $false
$script:healthMisses = 0

function Show-HddtConsole {
  if ($consoleHandle -ne [IntPtr]::Zero) {
    [void][HddtConsoleWindow]::ShowWindow($consoleHandle, $SW_RESTORE)
    [void][HddtConsoleWindow]::SetForegroundWindow($consoleHandle)
  }
}

function Hide-HddtConsole {
  if ($consoleHandle -ne [IntPtr]::Zero) {
    [void][HddtConsoleWindow]::ShowWindow($consoleHandle, $SW_HIDE)
  }
}

function Get-HddtRuntime {
  if (-not (Test-Path -LiteralPath $runtimePath)) { return $null }
  try {
    $runtime = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json
    $port = [int]$runtime.port
    $pidValue = [int]$runtime.pid
    if ($port -gt 0 -and $pidValue -gt 0) { return $runtime }
  } catch {}
  return $null
}

function Test-HddtUrl([string]$url) {
  try {
    $status = Invoke-RestMethod -Uri "$url/api/app/status" -Method Get -TimeoutSec 2
    if (-not $status.version) { return $false }
    if ($expectedVersion) { return ([string]$status.version) -eq $expectedVersion }
    return $true
  } catch {
    return $false
  }
}

function Get-HddtUrl {
  $runtime = Get-HddtRuntime
  if ($null -eq $runtime) { return $null }
  $url = "http://127.0.0.1:$($runtime.port)"
  if (Test-HddtUrl $url) { return $url }
  return $null
}

function Wait-HddtUrl([int]$attempts = 100) {
  for ($i = 0; $i -lt $attempts; $i++) {
    $url = Get-HddtUrl
    if ($url) { return $url }
    if ($ownedProcess -and $ownedProcess.HasExited) { return $null }
    Start-Sleep -Milliseconds 200
  }
  return $null
}

function Open-Hddt {
  $url = Get-HddtUrl
  if ($url) {
    Start-Process $url | Out-Null
    return
  }

  [System.Windows.Forms.MessageBox]::Show(
    'HDDT is not ready. Please try again in a few seconds.',
    'HDDT',
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information
  ) | Out-Null
}

function Stop-Hddt {
  $runtime = Get-HddtRuntime
  $url = Get-HddtUrl
  $stoppedGracefully = $false

  if ($url) {
    try {
      # Keep the same cookie/session between status and exit so the CSRF token is valid.
      $webSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
      $status = Invoke-RestMethod -Uri "$url/api/app/status" -Method Get -TimeoutSec 2 -WebSession $webSession
      if ($status.csrfToken) {
        $headers = @{ 'X-HDDT-CSRF' = [string]$status.csrfToken }
        $exitRequest = @{
          Uri = "$url/api/app/exit"
          Method = 'Post'
          Headers = $headers
          ContentType = 'application/json'
          Body = '{"force":true}'
          TimeoutSec = 3
          WebSession = $webSession
        }
        Invoke-RestMethod @exitRequest | Out-Null
        $stoppedGracefully = $true
      }
    } catch {}
  }

  if ($stoppedGracefully -and $runtime -and $runtime.pid) {
    for ($i = 0; $i -lt 30; $i++) {
      $stillRunning = Get-Process -Id ([int]$runtime.pid) -ErrorAction SilentlyContinue
      if (-not $stillRunning) { return }
      Start-Sleep -Milliseconds 100
    }
  }

  if ($runtime -and $runtime.pid) {
    try { Stop-Process -Id ([int]$runtime.pid) -Force -ErrorAction SilentlyContinue } catch {}
  }
}

if (-not (Test-Path -LiteralPath $serverRuntime) -or -not (Test-Path -LiteralPath $serverEntry)) {
  Show-HddtConsole
  Write-Host ''
  Write-Host 'ERROR: Portable Node runtime or server entrypoint was not found.' -ForegroundColor Red
  [System.Windows.Forms.MessageBox]::Show(
    'Portable Node runtime or server entrypoint was not found in the release folder.',
    'HDDT',
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error
  ) | Out-Null
  exit 1
}

# Only one tray controller per Windows user. A second launch only opens the WebUI.
$createdNew = $false
$trayMutex = [System.Threading.Mutex]::new($true, 'Local\HDDT_Conn_Tray', [ref]$createdNew)
if (-not $createdNew) {
  $url = Get-HddtUrl
  if ($url) { Start-Process $url | Out-Null }
  $trayMutex.Dispose()
  exit 0
}

Clear-Host
Write-Host '=============================================='
Write-Host ' HDDT - starting'
if ($expectedVersion) { Write-Host " Version: $expectedVersion" }
Write-Host '=============================================='
Write-Host ''
Write-Host 'Starting local server...'

$existingUrl = Get-HddtUrl
$launchedServer = $false
if (-not $existingUrl) {
  try {
    # NoNewWindow is intentional: server output stays in this startup console.
    # After startup succeeds this console is hidden, not terminated.
    $startRequest = @{
      FilePath = $serverRuntime
      ArgumentList = 'dist/server/index.js'
      WorkingDirectory = $serverWorkingDir
      NoNewWindow = $true
      PassThru = $true
    }
    $ownedProcess = Start-Process @startRequest
    $launchedServer = $true
  } catch {
    $ownedProcess = $null
  }
  $existingUrl = Wait-HddtUrl
}

if (-not $existingUrl) {
  Show-HddtConsole
  Write-Host ''
  Write-Host 'ERROR: HDDT server did not become ready.' -ForegroundColor Red
  if ($ownedProcess -and $ownedProcess.HasExited) {
    Write-Host "Server exit code: $($ownedProcess.ExitCode)" -ForegroundColor Yellow
  }
  Write-Host "Runtime/log folder: $appDataDir"
  Write-Host ''
  [System.Windows.Forms.MessageBox]::Show(
    'HDDT could not start. The startup window will stay open for diagnostics.',
    'HDDT',
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error
  ) | Out-Null
  $trayMutex.ReleaseMutex() | Out-Null
  $trayMutex.Dispose()
  exit 1
}

Write-Host "Ready: $existingUrl" -ForegroundColor Green
Write-Host 'Moving the startup window to the Windows system tray...'

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Text = 'HDDT'
$iconPath = Join-Path $baseDir 'hddt_conn.ico'
if (Test-Path -LiteralPath $iconPath) {
  try { $tray.Icon = New-Object System.Drawing.Icon($iconPath) } catch { $tray.Icon = [System.Drawing.SystemIcons]::Application }
} else {
  $tray.Icon = [System.Drawing.SystemIcons]::Application
}
$tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$openItem = $menu.Items.Add('Mo HDDT')
$showConsoleItem = $menu.Items.Add('Hien cua so trang thai')
$hideConsoleItem = $menu.Items.Add('An cua so trang thai')
$separator = New-Object System.Windows.Forms.ToolStripSeparator
[void]$menu.Items.Add($separator)
$exitItem = $menu.Items.Add('Thoat HDDT')
$tray.ContextMenuStrip = $menu

$openItem.add_Click({ Open-Hddt })
$tray.add_DoubleClick({ Open-Hddt })
$showConsoleItem.add_Click({ Show-HddtConsole })
$hideConsoleItem.add_Click({ Hide-HddtConsole })

$healthTimer = New-Object System.Windows.Forms.Timer
$healthTimer.Interval = 2000
$healthTimer.add_Tick({
  if (Get-HddtUrl) {
    $script:healthMisses = 0
    return
  }

  $script:healthMisses += 1
  if ($script:healthMisses -lt 3) { return }

  $healthTimer.Stop()
  $tray.Visible = $false
  $tray.Dispose()

  # A non-zero child exit is treated as a startup/runtime failure: restore the
  # black console so the user can read the diagnostics. Normal WebUI exit stays hidden.
  if (-not $script:exitRequested -and $ownedProcess -and $ownedProcess.HasExited -and $ownedProcess.ExitCode -ne 0) {
    $script:unexpectedStop = $true
    Show-HddtConsole
    Write-Host ''
    Write-Host "HDDT server stopped unexpectedly. Exit code: $($ownedProcess.ExitCode)" -ForegroundColor Red
    [System.Windows.Forms.MessageBox]::Show(
      'HDDT stopped unexpectedly. The startup window has been restored for diagnostics.',
      'HDDT',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
  }

  [System.Windows.Forms.Application]::ExitThread()
})

$exitItem.add_Click({
  $script:exitRequested = $true
  $healthTimer.Stop()
  Stop-Hddt
  $tray.Visible = $false
  $tray.Dispose()
  [System.Windows.Forms.Application]::ExitThread()
})

$tray.BalloonTipTitle = 'HDDT'
$tray.BalloonTipText = 'HDDT dang chay nen. Double-click icon de mo WebUI.'
$tray.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
$tray.ShowBalloonTip(2500)

# If this launcher attached to an already-running server, bring the WebUI up once.
if (-not $launchedServer) { Open-Hddt }

$healthTimer.Start()
Start-Sleep -Milliseconds 700
Hide-HddtConsole

[System.Windows.Forms.Application]::Run()

try { $trayMutex.ReleaseMutex() | Out-Null } catch {}
$trayMutex.Dispose()

if ($script:unexpectedStop) { exit 1 }
exit 0
