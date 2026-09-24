HDDT Windows tray patch - v1.3.0-rc.1

Copy these files over the project root, preserving paths:

  Start-HDDT.vbs
  Start-HDDT.cmd
  HDDT-Tray.ps1
  BUILD-PORTABLE-WINDOWS.cmd
  scripts/package-portable.mjs
  src/server/index.ts
  src/server/app.ts

Behavior:
- Start-HDDT.vbs launches the tray controller with no visible console window.
- HDDT-Tray.ps1 owns the Windows system tray icon and starts hddt-server.exe hidden.
- Double-click tray icon / Open menu opens the WebUI.
- Exit menu calls /api/app/exit and stops the local server.
- Start-HDDT.cmd hands off to Start-HDDT.vbs and closes its black console immediately.
- Version checks follow VERSION/package.json instead of stale 1.2.1 literals.
- Portable artifact name and BUILD_INFO use package.json version dynamically.

Build on Windows x64:
  BUILD-PORTABLE-WINDOWS.cmd

Expected output for current source:
  release\HDDT_v1.3.0-rc.1_windows_x64.zip

End-user launch:
  Double-click Start-HDDT.vbs
or
  Double-click Start-HDDT.cmd (console may flash briefly, then closes; app remains in tray)

Do not tell end users to double-click hddt-server.exe directly if tray behavior is desired.
