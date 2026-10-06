@echo off
cd /d "%~dp0"
.venv\Scripts\python.exe model\analysis\train_relative_lab.py
if errorlevel 1 goto end
call npm --prefix frontend run lab:pack
:end
pause
