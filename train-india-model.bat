@echo off
cd /d "%~dp0"
if not exist ".venv-ai\Scripts\python.exe" (
  echo Setting up the AI environment first...
  call setup-ai-windows.bat
  if errorlevel 1 exit /b 1
)
if not exist "data\raw\RDD2022_India" (
  echo Downloading and extracting the official RDD2022 India archive...
  .venv-ai\Scripts\python.exe ai\download_rdd2022_india.py
  if errorlevel 1 exit /b 1
)
echo Preparing the annotated India dataset...
.venv-ai\Scripts\python.exe ai\prepare_rdd2022_india.py --source "data\raw\RDD2022_India"
if errorlevel 1 exit /b 1
echo Starting CPU-compatible baseline training (30 epochs, batch 2).
.venv-ai\Scripts\python.exe ai\train.py --epochs 30 --imgsz 640 --batch 2 --workers 2 --device cpu
if errorlevel 1 (
  echo Training failed. Check the error and ai\TRAINING.md.
) else (
  echo Training and validation completed. Check runs\streetsense-india-road-defects\validation-summary.json
  echo Restart StreetSense to load models\road_defects.pt.
)
pause
