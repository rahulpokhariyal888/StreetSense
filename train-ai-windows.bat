@echo off
cd /d "%~dp0"
if not exist ".venv-ai\Scripts\python.exe" (
  echo AI environment not found. Run setup-ai-windows.bat first.
  pause
  exit /b 1
)
".venv-ai\Scripts\python.exe" ai\train.py %*
if errorlevel 1 (
  echo Training did not complete. Read the error above and ai\TRAINING.md.
) else (
  echo Training and validation finished. Check runs\streetsense-road-defects\validation-summary.json.
)
pause
