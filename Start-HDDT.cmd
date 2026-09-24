@echo off
setlocal
cd /d "%~dp0"
title HDDT - Starting

rem This launcher is loopback-only HTTP. Keep the browser session cookie usable
rem at http://127.0.0.1 for both packaged and source/developer fallback modes.
if not defined HDDT_INSECURE_HTTP set "HDDT_INSECURE_HTTP=1"
if not defined HDDT_BIND_HOST set "HDDT_BIND_HOST=127.0.0.1"

rem Portable Windows design:
rem 1) show this black startup console;
rem 2) start hddt-server.exe in the same console;
rem 3) HDDT-Tray.ps1 hides this console only after the server is healthy;
rem 4) the PowerShell tray controller remains alive in Windows system tray.
if exist "hddt-server.exe" if exist "HDDT-Tray.ps1" (
  powershell.exe -NoLogo -NoProfile -Sta -ExecutionPolicy Bypass -File "%~dp0HDDT-Tray.ps1"
  set "HDDT_EXIT=%ERRORLEVEL%"
  if not "%HDDT_EXIT%"=="0" (
    echo.
    echo HDDT stopped with error code %HDDT_EXIT%.
    echo Press any key to close this diagnostic window.
    pause >nul
  )
  exit /b %HDDT_EXIT%
)

rem Developer/source fallback.
if exist "dist\server\index.js" (
  where node >nul 2>nul
  if %ERRORLEVEL%==0 (
    set NODE_ENV=production
    node dist\server\index.js
    goto :eof
  )
)

if exist "src\server\index.ts" (
  where pnpm >nul 2>nul
  if %ERRORLEVEL%==0 (
    pnpm dev
    goto :eof
  )
  where npx >nul 2>nul
  if %ERRORLEVEL%==0 (
    npx tsx src\server\index.ts
    goto :eof
  )
)

echo ERROR: Runtime not found.
echo Use the complete Windows portable release or install Node.js 22.12+.
pause
exit /b 1
