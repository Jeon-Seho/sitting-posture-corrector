@echo off
cd /d "%~dp0"
if exist "frontend\release-face\PoseGood-Face-Lab-0.2.0.exe" (
  start "" "frontend\release-face\PoseGood-Face-Lab-0.2.0.exe"
) else (
  call npm --prefix frontend run face:assets
  call npm --prefix frontend run assets
  call npm --prefix frontend run face:desktop
)
