#!/usr/bin/env python3
"""Train a StreetSense YOLO detector from reviewed YOLO-format labels."""
from __future__ import annotations
import argparse, json, shutil
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ALL_CLASSES = ["pothole", "road_crack", "damaged_sign", "broken_streetlight", "blocked_drain"]
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def parse_args():
    p = argparse.ArgumentParser(description="Train StreetSense road-defect YOLO model")
    p.add_argument("--data", default=str(ROOT / "dataset"))
    p.add_argument("--base", default="yolo11n.pt")
    p.add_argument("--epochs", type=int, default=50)
    p.add_argument("--imgsz", type=int, default=640)
    p.add_argument("--batch", type=int, default=4)
    p.add_argument("--device", default="", help="0 for supported CUDA GPU, cpu for CPU")
    p.add_argument("--workers", type=int, default=2)
    p.add_argument("--name", default="streetsense-india-road-defects")
    p.add_argument("--no-promote", action="store_true")
    return p.parse_args()


def validate_dataset(root: Path):
    required = [root / "images/train", root / "images/val", root / "labels/train", root / "labels/val"]
    missing = [str(x) for x in required if not x.is_dir()]
    if missing:
        raise SystemExit("Dataset folders missing:\n  " + "\n  ".join(missing))
    counts = Counter()
    split_counts = {"train": Counter(), "val": Counter()}
    totals = {}
    for split in ("train", "val"):
        images = [x for x in (root / "images" / split).rglob("*") if x.suffix.lower() in IMAGE_EXTS]
        if not images:
            raise SystemExit(f"No images found in images/{split}")
        totals[split] = len(images)
        for image in images:
            label = root / "labels" / split / (image.stem + ".txt")
            if not label.is_file():
                raise SystemExit(f"Missing label file: {label}")
            for line_no, line in enumerate(label.read_text(encoding="utf-8").splitlines(), 1):
                if not line.strip():
                    continue
                parts = line.split()
                if len(parts) != 5:
                    raise SystemExit(f"Invalid label {label}:{line_no}; expected 5 columns")
                try:
                    vals = [float(v) for v in parts]
                except ValueError:
                    raise SystemExit(f"Non-numeric label {label}:{line_no}")
                cls, x, y, w, h = vals
                if not cls.is_integer() or not 0 <= int(cls) < len(ALL_CLASSES):
                    raise SystemExit(f"Class ID must be 0-{len(ALL_CLASSES)-1}: {label}:{line_no}")
                if any(v < 0 or v > 1 for v in (x, y, w, h)) or w <= 0 or h <= 0 or x-w/2 < -1e-6 or y-h/2 < -1e-6 or x+w/2 > 1.000001 or y+h/2 > 1.000001:
                    raise SystemExit(f"Invalid normalized bounding box: {label}:{line_no}")
                counts[int(cls)] += 1
                split_counts[split][int(cls)] += 1
    active = [i for i, name in enumerate(ALL_CLASSES) if counts[i] > 0]
    if not active:
        raise SystemExit("No labelled defect boxes found. Empty-label images alone cannot train a detector.")
    absent = [ALL_CLASSES[i] for i in range(len(ALL_CLASSES)) if i not in active]
    missing_train = [ALL_CLASSES[i] for i in active if split_counts['train'][i] == 0]
    missing_val = [ALL_CLASSES[i] for i in active if split_counts['val'][i] == 0]
    if missing_train or missing_val:
        raise SystemExit("Every active class must appear in both train and validation. Missing in train: " + ", ".join(missing_train) + "; missing in validation: " + ", ".join(missing_val))
    print("Labelled object counts:", {ALL_CLASSES[i]: counts[i] for i in active})
    print("Train/validation class counts:", {ALL_CLASSES[i]: {"train": split_counts['train'][i], "val": split_counts['val'][i]} for i in active})
    if absent:
        print("NOTE: These classes have no training examples and will NOT be included in this model:", ", ".join(absent))
    return totals, active, counts


def main():
    args = parse_args()
    if args.epochs < 1 or args.imgsz < 32 or args.batch < 1:
        raise SystemExit("epochs/batch must be positive and imgsz must be >=32")
    dataset = Path(args.data).expanduser().resolve()
    totals, active, counts = validate_dataset(dataset)
    try:
        from ultralytics import YOLO
    except ImportError:
        raise SystemExit("Ultralytics is not installed. Run setup-ai-windows.bat")
    if active != list(range(len(active))):
        raise SystemExit("Active class IDs must be contiguous from 0. Re-export/relabel the dataset with contiguous IDs; training will not rewrite your annotations.")
    names = {idx: ALL_CLASSES[idx] for idx in active}
    yaml_path = ROOT / "ai" / "streetsense-data.yaml"
    yaml_path.write_text("path: " + json.dumps(str(dataset)) + "\ntrain: images/train\nval: images/val\nnames:\n" + "".join(f"  {i}: {name}\n" for i, name in names.items()), encoding="utf-8")
    print(f"Dataset: {totals['train']} train images, {totals['val']} validation images")
    print("Model classes:", ", ".join(names.values()))
    model = YOLO(args.base)
    opts = dict(data=str(yaml_path), epochs=args.epochs, imgsz=args.imgsz, batch=args.batch,
                workers=args.workers, project=str(ROOT / "runs"), name=args.name,
                exist_ok=True, patience=15, plots=True, seed=42)
    if args.device.strip(): opts["device"] = args.device.strip()
    model.train(**opts)
    best = ROOT / "runs" / args.name / "weights" / "best.pt"
    if not best.is_file(): raise SystemExit(f"Training ended without checkpoint: {best}")
    trained = YOLO(str(best)); metrics = trained.val(data=str(yaml_path), imgsz=args.imgsz)
    per_class = {}
    maps = list(getattr(metrics.box, "maps", []))
    for idx, name in names.items():
        per_class[name] = {"map50_95": float(maps[idx]) if idx < len(maps) else None}
    report = {"checkpoint": str(best), "classes": list(names.values()), "image_counts": totals,
              "label_counts": {ALL_CLASSES[i]: counts[i] for i in active},
              "metrics": {"map50": float(metrics.box.map50), "map50_95": float(metrics.box.map),
                          "precision": float(metrics.box.mp), "recall": float(metrics.box.mr),
                          "per_class": per_class},
              "limitations": "RDD2022 India labels only road damage classes represented in this dataset. Test on a separate local dataset before operational use."}
    report_path = ROOT / "runs" / args.name / "validation-summary.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("Validation report:", report_path)
    if not args.no_promote:
        target = ROOT / "models" / "road_defects.pt"; target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(best, target); print("Model installed:", target)
    print("Finished. Review plots, per-class metrics and separate test images before use.")

if __name__ == "__main__": main()
