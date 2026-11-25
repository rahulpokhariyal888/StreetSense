@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv-ai\Scripts\python.exe" (
  echo Setting up the AI environment first...
  call setup-ai-windows.bat
  if errorlevel 1 exit /b 1
)
echo.
echo StreetSense Roboflow YOLO dataset training
set "DATA_YAML=%~1"
if "%DATA_YAML%"=="" set /p "DATA_YAML=Enter the full path to your extracted data.yaml: "
if not exist "%DATA_YAML%" (
  echo ERROR: data.yaml not found: "%DATA_YAML%"
  echo Extract the Roboflow ZIP first, then provide the path to data.yaml.
  pause
  exit /b 1
)
echo.
echo Step 1 - checking dataset paths and YOLO labels...
.venv-ai\Scripts\python.exe ai\train_roboflow.py --data "%DATA_YAML%" --check-only
if errorlevel 1 (
  echo Dataset check failed. Read the error above and check extraction paths.
  pause
  exit /b 1
)
echo.
echo Step 2 - training a CPU baseline. This may take a long time.
.venv-ai\Scripts\python.exe ai\train_roboflow.py --data "%DATA_YAML%" --epochs 30 --imgsz 640 --batch 2 --workers 2 --device cpu
if errorlevel 1 (
  echo Training failed. Check the error and ai\TRAINING.md.
) else (
  echo Training and evaluation completed.
  echo Model: models\road_defects.pt
  echo Metrics: runs\streetsense-rdd2022-india-aug\validation-summary.json
  echo Restart StreetSense to use the newly trained model.
)
pause
