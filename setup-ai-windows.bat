@echo off
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  echo Python launcher not found. Install Python 3.10 or 3.11 and enable Add Python to PATH.
  pause
  exit /b 1
)
py -3.11 -m venv .venv-ai
if errorlevel 1 py -3.10 -m venv .venv-ai
if errorlevel 1 (
  echo Could not create Python environment. Install Python 3.10 or 3.11.
  pause
  exit /b 1
)
.venv-ai\Scripts\python.exe -m pip install --upgrade pip
.venv-ai\Scripts\python.exe -m pip install -r ai\requirements.txt
if errorlevel 1 (
  echo AI dependency installation failed. Check internet access and Python version.
  pause
  exit /b 1
)
echo AI environment ready. See ai\TRAINING.md, prepare dataset\, then run train-ai-windows.bat.
pause
