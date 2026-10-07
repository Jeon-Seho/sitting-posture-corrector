@echo off
setlocal
cd /d "%~dp0"
for /f "delims=" %%v in ('powershell -NoProfile -Command "(ConvertFrom-Json -InputObject (Get-Content -LiteralPath 'frontend/package.json' -Raw -Encoding UTF8)).version"') do set "POSEGOOD_FACE_VERSION=%%v"
if not defined POSEGOOD_FACE_VERSION exit /b 1
if exist "frontend\release-face\PoseGood-Face-Lab-%POSEGOOD_FACE_VERSION%.exe" (
  start "" "frontend\release-face\PoseGood-Face-Lab-%POSEGOOD_FACE_VERSION%.exe"
) else (
  call npm --prefix frontend run face:assets
  call npm --prefix frontend run assets
  call npm --prefix frontend run face:desktop
)
