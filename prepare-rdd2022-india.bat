@echo off
setlocal
cd /d "%~dp0"
if "%~1"=="" (
  echo Usage: prepare-rdd2022-india.bat "C:\path\to\extracted\RDD2022_India"
  echo First download and extract the India subset. See ai\TRAINING.md.
  pause
  exit /b 2
)
if not exist ".venv-ai\Scripts\python.exe" (
  echo AI environment not found. Run setup-ai-windows.bat first.
  pause
  exit /b 2
)
.venv-ai\Scripts\python.exe ai\prepare_rdd2022_india.py --source "%~1"
if errorlevel 1 pause
endlocal
