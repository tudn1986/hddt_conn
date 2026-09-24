HDDT Windows tray - visible startup console -> system tray
Version: 1.3.0-rc.1

EXPECTED BEHAVIOR
1. Double-click Start-HDDT.cmd (or Start-HDDT.vbs).
2. A black startup console is visible while hddt-server.exe starts.
3. When /api/app/status becomes healthy, the tray icon is created.
4. About 0.7 seconds later the same black console is hidden.
5. HDDT keeps running in Windows system tray.
6. Double-click tray icon: open WebUI.
7. Right-click tray icon:
   - Mo HDDT
   - Hien cua so trang thai
   - An cua so trang thai
   - Thoat HDDT
8. If the server exits abnormally, the black console is restored for diagnostics.

IMPORTANT
- Do not launch hddt-server.exe directly for normal use.
- Start-HDDT.vbs no longer hides the window immediately. It launches Start-HDDT.cmd visibly.
- The tray script uses one Windows-user mutex so a second launch does not create duplicate tray icons.
- Graceful shutdown now preserves the session cookie between /api/app/status and /api/app/exit, so the CSRF token is valid.

COPY TO PROJECT ROOT
HDDT-Tray.ps1
Start-HDDT.cmd
Start-HDDT.vbs

The existing scripts/package-portable.mjs already copies these three launcher files into the Windows portable release.
