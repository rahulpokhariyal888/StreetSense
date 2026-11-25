# StreetSense YOLO training guide

This folder contains a training pipeline. It does **not** contain a trained model or fabricated dataset. You need images with accurate bounding-box annotations before training can produce a useful detector.

## 1. Dataset layout

Create this structure in the project root:

```text
dataset/
  images/
    train/   # training images
    val/     # validation images (different scenes/roads from train)
  labels/
    train/   # one .txt per training image
    val/     # one .txt per validation image
```

Each image must have a matching text file with the same filename stem. Each non-empty label row is:

```text
class_id x_center y_center width height
```

Coordinates are normalized from 0 to 1, measured against image width/height. Example format only (not a real annotation): `0 0.52 0.61 0.20 0.14`.

## 2. Fixed class IDs

| ID | Class name | Label only when |
|---:|---|---|
| 0 | `pothole` | A visible pothole/road-surface cavity is present |
| 1 | `road_crack` | A visible crack is present; box the crack region |
| 2 | `damaged_sign` | A road/traffic sign is visibly damaged or missing |
| 3 | `broken_streetlight` | A streetlight fixture/pole is visibly damaged |
| 4 | `blocked_drain` | A drain inlet is visibly obstructed |

Do not label from assumptions. Avoid ambiguous, tiny, occluded, or unrelated objects. Images with no target defect should have an empty label file. Use the same class IDs in every annotation tool export.

## 3. Dataset quality

- Use images you own or have permission to use; check the dataset licence and attribution requirements.
- Include different lighting, weather, camera angles, road materials, and defect sizes that reflect the intended deployment area.
- Split by capture session/road/location where possible. Near-duplicate frames must not appear in both train and validation sets.
- Keep a separate final test set that is not used during training or tuning.
- Have a second person review labels; incorrect boxes and inconsistent classes can seriously reduce performance.
- Collect enough examples per class. A few images are only a smoke test, not evidence of reliable performance.

## 4. Install and train (Windows)

From the project folder, run `setup-ai-windows.bat`, then run `train-ai-windows.bat`. Defaults are 100 epochs, 640-pixel images and batch size 8. You can edit the batch size in the script for limited memory, or run from a terminal:

```powershell
.venv-ai\Scripts\activate
python ai\train.py --epochs 100 --imgsz 640 --batch 4
```

For a machine without a supported GPU, try `--device cpu` (training will be much slower). For a supported GPU, try `--device 0`. The script validates folder structure and labels, trains from the Ultralytics `yolo11n.pt` checkpoint, evaluates the best checkpoint, writes a metrics summary, and copies `best.pt` to `models/road_defects.pt`.

The first run may download the base checkpoint. Confirm the model/checkpoint licence and Ultralytics licensing terms suit your use.

## 5. Evaluate before use

Review `runs/streetsense-road-defects/validation-summary.json`, per-class metrics, confusion matrix and validation plots. Then test on a separate, representative test set and on real images from the target environment. Check false positives and false negatives by class. Do not interpret one aggregate mAP score as proof of safety or city-wide accuracy. Keep detections as suggestions for human review; do not automatically dispatch crews or make safety decisions from model output.

## 6. Connect to StreetSense

When training completes successfully, the script copies the checkpoint to `models/road_defects.pt`. Restart StreetSense. The existing server inference integration will then use the trained checkpoint for uploaded images. The trained model's class names must remain exactly as listed above for the app's category mapping.

## Notes

- No weights, dataset, accuracy claims, or sample predictions are bundled.
- Training can fail or produce a poor model if the dataset is too small, biased, mislabeled, or mismatched to real operating conditions.
- Store dataset images and trained weights securely; uploaded evidence is retained locally by the current prototype.

## 7. Prepare the Indian road subset (RDD2022)

A practical starting point is the **India subset of RDD2022**. The project dataset includes vehicle-mounted Indian road images and Pascal-VOC XML annotations. The official dataset repository links the India archive (about 502 MB) and explains its contents. Download and extract it yourself; this project does not bundle third-party images.

- Dataset repository and official archive links: https://github.com/sekilab/RoadDamageDetector
- Figshare dataset record: https://doi.org/10.6084/m9.figshare.21431547.v1
- Dataset paper: https://doi.org/10.1002/gdj3.260

From the extracted project folder, run:

```bat
prepare-rdd2022-india.bat "C:\path\to\extracted\RDD2022_India"
```

Or run the converter directly:

```powershell
.venv-ai\Scripts\python.exe ai\prepare_rdd2022_india.py --source "C:\path\to\extracted\RDD2022_India"
```

The converter pairs XML annotations with images and maps RDD2022 labels `D00`, `D10`, and `D20` to StreetSense `road_crack` (class 1), and `D40` to `pothole` (class 0). It creates the `dataset/images` and `dataset/labels` train/validation folders expected by the training script. It does not download the archive, and it does not create labels for signs, streetlights, or drains. You must collect and annotate permitted examples for those classes separately before claiming a five-class model is ready.

The repository currently identifies the RDD images as CC BY-SA 4.0; verify the licence displayed alongside the files before use. Preserve attribution and ShareAlike obligations, especially before redistribution or commercial use. Cite the RDD2022 dataset paper when publishing results. The converter's random split is a convenience baseline; for rigorous evaluation, split by road/capture sequence to reduce near-duplicate leakage and maintain a separate untouched test set.


## Automated RDD2022 India download and baseline

On Windows, `train-india-model.bat` runs the whole preparation/training sequence. It downloads the official India ZIP (about 502 MB), safely extracts it under `data/raw/RDD2022_India`, converts Pascal-VOC XML labels, and trains a two-class baseline when both pothole and crack labels are present. If the network download is unavailable, use the official dataset links below to obtain the archive and run `ai/download_rdd2022_india.py --archive "path\to\RDD2022_India.zip"`.

The trainer now reports only classes that have actual labelled boxes. It rejects non-contiguous class IDs rather than silently rewriting original annotations. For the RDD2022 India subset, expected model labels are `pothole` and `road_crack`. It does not create a five-class detector.


## 8. Re-running dataset preparation safely

The converter clears only `dataset/images/train`, `dataset/images/val`, `dataset/labels/train`, and `dataset/labels/val` before writing a fresh conversion. Back up any manually added images/labels in those folders first. The trainer checks that every class included in the model has labelled examples in both train and validation; this prevents a class from appearing to be evaluated when validation has no examples for it.


## 9. Roboflow RDD2022-India-Aug (10 classes)

For the Roboflow export whose `data.yaml` declares `nc: 10` and names `D00`, `D01`, `D0w0`, `D10`, `D11`, `D20`, `D40`, `D43`, `D44`, `D50`, use `train-roboflow-windows.bat` and `ai/train_roboflow.py`. Do not run `prepare_rdd2022_india.py` on that export: it is already in YOLO format.

The trainer reads the YAML class list, resolves Roboflow relative split paths, validates each image's corresponding YOLO label, checks class IDs and normalized boxes, evaluates validation and the held-out test split, and stores a JSON report. The model preserves the RDD class codes. Current dashboard category mapping: `D00`, `D01`, `D10`, `D11`, `D20` -> Road crack; `D40` -> Pothole; `D0w0`, `D43`, `D44`, `D50` -> Other until the dashboard adds matching incident categories. `D0w0` is treated cautiously because published RDD references identify it as an uncertain/error label.

Example:

```powershell
.venv-ai\Scripts\python.exe ai\train_roboflow.py --data "D:\path\to\RDD2022-India-Aug\data.yaml" --check-only
.venv-ai\Scripts\python.exe ai\train_roboflow.py --data "D:\path\to\RDD2022-India-Aug\data.yaml" --epochs 30 --imgsz 640 --batch 2 --device cpu
```
