@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 22.12+ is required.& exit /b 1)
for /f "tokens=*" %%v in ('node -p "process.platform+' '+process.arch+' '+process.versions.node"') do echo Runtime: %%v
node -e "const [a,b]=process.versions.node.split('.').map(Number);if(a<22||(a===22&&b<12))process.exit(1)" || (echo Node.js 22.12+ is required.& exit /b 1)
call corepack enable || exit /b 1
call corepack prepare pnpm@11.19.0 --activate || exit /b 1
call pnpm install --frozen-lockfile || exit /b 1
where magick >nul 2>nul || (echo ImageMagick magick is required to build the branded Windows icon.& exit /b 1)
call pnpm verify || exit /b 1
call pnpm package:win-x64 || exit /b 1
echo.
for /f "usebackq delims=" %%v in (`node -p "require('./package.json').version"`) do set HDDT_VERSION=%%v
echo Built: release\hddt_conn_v%HDDT_VERSION%_windows_x64.zip
endlocal
