@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Run python tools/dev.py setup first.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" -m pip install -r model\analysis\requirements-relative-lab.txt --index-url https://download.pytorch.org/whl/cpu
if errorlevel 1 exit /b 1
".venv\Scripts\python.exe" -m pip install numpy==2.5.3
if errorlevel 1 exit /b 1
".venv\Scripts\python.exe" model\analysis\train_face_motion.py %*
if errorlevel 1 exit /b 1
call npm --prefix frontend version patch --no-git-tag-version
if errorlevel 1 exit /b 1
call npm --prefix frontend run test:pack
pause
