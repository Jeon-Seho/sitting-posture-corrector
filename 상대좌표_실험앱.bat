@echo off
cd /d "%~dp0"
if exist "frontend\release-lab\PoseGood-Relative-Lab.exe" (
  start "" "frontend\release-lab\PoseGood-Relative-Lab.exe"
  exit /b
)
call npm --prefix frontend run lab:desktop
pause
