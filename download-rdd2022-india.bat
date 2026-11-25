@echo off
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  echo Python launcher not found. Install Python 3.10 or 3.11 first.
  pause
  exit /b 1
)
py -3.11 ai\download_rdd2022_india.py
if errorlevel 1 py -3.10 ai\download_rdd2022_india.py
if errorlevel 1 echo Download/extraction failed. See the message above.
pause
