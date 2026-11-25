#!/usr/bin/env python3
"""Train StreetSense from a Roboflow YOLO detection export (data.yaml)."""
from __future__ import annotations

import argparse
import json
import math
import shutil
from collections import Counter
from pathlib import Path
from typing import Any

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Train StreetSense using a Roboflow YOLO data.yaml")
    p.add_argument("--data", required=True, help="Path to the Roboflow-exported data.yaml")
    p.add_argument("--base", default="yolo11n.pt", help="Ultralytics starting checkpoint")
    p.add_argument("--epochs", type=int, default=30)
    p.add_argument("--imgsz", type=int, default=640)
    p.add_argument("--batch", type=int, default=2)
    p.add_argument("--device", default="cpu", help="cpu (safe default), 0 for supported NVIDIA CUDA GPU")
    p.add_argument("--workers", type=int, default=2)
    p.add_argument("--name", default="streetsense-rdd2022-india-aug")
    p.add_argument("--no-promote", action="store_true", help="Do not copy best.pt to models/road_defects.pt")
    p.add_argument("--check-only", action="store_true", help="Validate dataset structure and labels without training")
    return p.parse_args()


def load_data_yaml(yaml_path: Path) -> dict[str, Any]:
    try:
        import yaml
    except ImportError as exc:
        raise SystemExit("PyYAML is missing. Run setup-ai-windows.bat first.") from exc
    try:
        data = yaml.safe_load(yaml_path.read_text(encoding="utf-8-sig"))
    except Exception as exc:
        raise SystemExit(f"Could not read YAML {yaml_path}: {exc}") from exc
    if not isinstance(data, dict):
        raise SystemExit("data.yaml must contain a YAML mapping at its top level.")
    raw_names = data.get("names")
    nc = data.get("nc")
    if isinstance(raw_names, list):
        names = [str(v) for v in raw_names]
    elif isinstance(raw_names, dict):
        try:
            keys = sorted(int(k) for k in raw_names)
            if keys != list(range(len(keys))):
                raise ValueError("class IDs are not contiguous from zero")
            names = [str(raw_names.get(i, raw_names.get(str(i)))) for i in keys]
        except Exception as exc:
            raise SystemExit(f"Invalid 'names' mapping in data.yaml: {exc}") from exc
    else:
        raise SystemExit("data.yaml must define 'names' as a list or class-ID mapping.")
    if not names or any(not n or n.lower() == "none" for n in names):
        raise SystemExit("data.yaml contains an empty class name.")
    if nc is not None and int(nc) != len(names):
        raise SystemExit(f"Class count mismatch: nc={nc}, but names contains {len(names)} classes.")
    data["nc"] = len(names)
    data["names"] = names
    return data


def resolve_split_path(raw: Any, yaml_path: Path, dataset_root: Path, split: str) -> Path | None:
    if raw is None or raw == "":
        return None
    raw_path = Path(str(raw).strip().strip('"').strip("'"))
    if raw_path.is_absolute():
        candidates = [raw_path]
    else:
        candidates = [yaml_path.parent / raw_path]
        # Roboflow exports often use ../train/images even though train/ is
        # actually next to data.yaml. Try the normalized path as a fallback.
        parts = list(raw_path.parts)
        while parts and parts[0] in ("..", "."):
            parts.pop(0)
        if parts:
            candidates.append(dataset_root.joinpath(*parts))
            candidates.append(yaml_path.parent.parent.joinpath(*parts))
    for candidate in candidates:
        candidate = candidate.resolve()
        if candidate.is_dir():
            return candidate
    tried = "\n  ".join(str(c.resolve()) for c in candidates)
    raise SystemExit(f"Could not resolve '{split}' image folder from data.yaml value {raw!r}. Tried:\n  {tried}\nCheck that the ZIP was fully extracted and that train/valid/test folders are present.")


def label_folder_for(images_dir: Path) -> Path:
    # Standard YOLO export pairs .../images with .../labels.
    parts = list(images_dir.parts)
    for idx in range(len(parts) - 1, -1, -1):
        if parts[idx].lower() == "images":
            parts[idx] = "labels"
            return Path(*parts)
    raise SystemExit(f"Expected an 'images' directory in split path: {images_dir}")


def inspect_split(split: str, images_dir: Path, nc: int, names: list[str]) -> tuple[int, Counter[int], int]:
    label_dir = label_folder_for(images_dir)
    if not label_dir.is_dir():
        raise SystemExit(f"Missing YOLO labels directory for {split}: {label_dir}")
    images = sorted(p for p in images_dir.rglob("*") if p.is_file() and p.suffix.lower() in IMAGE_EXTS)
    if not images:
        raise SystemExit(f"No image files found in {split}: {images_dir}")
    counts: Counter[int] = Counter()
    empty_labels = 0
    missing_labels: list[str] = []
    invalid_examples: list[str] = []
    for image_path in images:
        relative = image_path.relative_to(images_dir)
        label_path = (label_dir / relative).with_suffix(".txt")
        if not label_path.is_file():
            missing_labels.append(str(label_path))
            if len(missing_labels) >= 5:
                break
            continue
        lines = [line.strip() for line in label_path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]
        if not lines:
            empty_labels += 1
        for line_no, line in enumerate(lines, 1):
            parts = line.split()
            if len(parts) != 5:
                invalid_examples.append(f"{label_path}:{line_no} (expected 5 columns)")
                break
            try:
                vals = [float(v) for v in parts]
            except ValueError:
                invalid_examples.append(f"{label_path}:{line_no} (non-numeric value)")
                break
            cls, x, y, w, h = vals
            if (not math.isfinite(cls) or not cls.is_integer() or not 0 <= int(cls) < nc
                    or any(not math.isfinite(v) for v in (x, y, w, h))
                    or any(v < 0 or v > 1 for v in (x, y, w, h))
                    or w <= 0 or h <= 0
                    or x - w / 2 < -1e-6 or y - h / 2 < -1e-6
                    or x + w / 2 > 1.000001 or y + h / 2 > 1.000001):
                invalid_examples.append(f"{label_path}:{line_no} (invalid class ID or normalized box)")
                break
            counts[int(cls)] += 1
    if missing_labels:
        raise SystemExit(f"Missing label files for {split} images (showing up to 5):\n  " + "\n  ".join(missing_labels))
    if invalid_examples:
        raise SystemExit("Invalid YOLO annotations (showing up to 5):\n  " + "\n  ".join(invalid_examples[:5]))
    print(f"{split}: {len(images):,} images, {sum(counts.values()):,} boxes, {empty_labels:,} empty-label images")
    return len(images), counts, empty_labels


def build_normalized_yaml(source_yaml: Path, data: dict[str, Any], split_dirs: dict[str, Path | None], destination: Path) -> None:
    import yaml
    normalized: dict[str, Any] = {
        "path": str(source_yaml.parent.resolve()),
        "train": str(split_dirs["train"].resolve()),
        "val": str(split_dirs["val"].resolve()),
        "nc": int(data["nc"]),
        "names": {i: name for i, name in enumerate(data["names"])},
    }
    if split_dirs.get("test"):
        normalized["test"] = str(split_dirs["test"].resolve())
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(yaml.safe_dump(normalized, sort_keys=False, allow_unicode=True), encoding="utf-8")


def _finite_number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def extract_metrics(metrics: Any, names: list[str]) -> dict[str, Any]:
    box = getattr(metrics, "box", None)
    if box is None:
        return {"error": "Ultralytics returned no box metrics."}
    maps = list(getattr(box, "maps", []))
    return {
        "map50": _finite_number(box.map50),
        "map50_95": _finite_number(box.map),
        "precision": _finite_number(box.mp),
        "recall": _finite_number(box.mr),
        "per_class_map50_95": {name: (_finite_number(maps[i]) if i < len(maps) else None) for i, name in enumerate(names)},
    }


def main() -> None:
    args = parse_args()
    if args.epochs < 1 or args.imgsz < 32 or args.batch < 1 or args.workers < 0:
        raise SystemExit("epochs and batch must be positive, imgsz >= 32, and workers >= 0")
    source_yaml = Path(args.data).expanduser().resolve()
    if not source_yaml.is_file():
        raise SystemExit(f"Dataset YAML not found: {source_yaml}")
    data = load_data_yaml(source_yaml)
    dataset_root = source_yaml.parent
    splits: dict[str, Path | None] = {}
    for split, key in (("train", "train"), ("val", "val"), ("test", "test")):
        splits[split] = resolve_split_path(data.get(key), source_yaml, dataset_root, split) if data.get(key) else None
    if splits["train"] is None or splits["val"] is None:
        raise SystemExit("data.yaml must define both 'train' and 'val' image folders.")

    print(f"Dataset YAML: {source_yaml}")
    print(f"Classes ({data['nc']}): {', '.join(data['names'])}")
    split_summaries: dict[str, Any] = {}
    class_counts: dict[str, dict[str, int]] = {}
    for split in ("train", "val", "test"):
        folder = splits[split]
        if folder is None:
            continue
        n_images, counts, empty = inspect_split(split, folder, data["nc"], data["names"])
        split_summaries[split] = {"images": n_images, "labelled_boxes": sum(counts.values()), "empty_label_images": empty}
        for idx, name in enumerate(data["names"]):
            class_counts.setdefault(name, {})[split] = int(counts[idx])
    if split_summaries["train"]["labelled_boxes"] == 0:
        raise SystemExit("The training split contains no labelled boxes; check the YOLO label export.")
    if split_summaries["val"]["labelled_boxes"] == 0:
        raise SystemExit("The validation split contains no labelled boxes; check the YOLO label export.")
    missing_train = [name for name in data["names"] if class_counts.get(name, {}).get("train", 0) == 0]
    missing_val = [name for name in data["names"] if class_counts.get(name, {}).get("val", 0) == 0]
    if missing_train:
        print("WARNING: no training boxes for: " + ", ".join(missing_train))
    if missing_val:
        print("WARNING: no validation boxes for: " + ", ".join(missing_val) + ". Metrics for these classes may be undefined.")

    normalized_yaml = Path(__file__).resolve().parent / "streetsense-roboflow-data.yaml"
    build_normalized_yaml(source_yaml, data, splits, normalized_yaml)
    report_base = {
        "dataset_yaml": str(source_yaml),
        "dataset_license_declared_in_source": (data.get("roboflow") or {}).get("license") if isinstance(data.get("roboflow"), dict) else None,
        "dataset_url_declared_in_source": (data.get("roboflow") or {}).get("url") if isinstance(data.get("roboflow"), dict) else None,
        "classes": data["names"],
        "image_counts": split_summaries,
        "label_counts_by_class_and_split": class_counts,
        "notes": [
            "RDD2022 class codes are preserved as the model class names.",
            "D00, D01, D10, D11 and D20 are treated as road-crack classes in the StreetSense dashboard.",
            "D40 is treated as pothole. D43, D44 and D50 remain Other in the current dashboard taxonomy.",
            "Validation metrics are not a guarantee of field accuracy; review false positives and false negatives on separate local road images.",
        ],
    }
    summary_path = Path(__file__).resolve().parents[1] / "runs" / args.name / "dataset-summary.json"
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps(report_base, indent=2), encoding="utf-8")
    print(f"Dataset summary: {summary_path}")
    if args.check_only:
        print("Dataset check completed. No model training was started.")
        return

    try:
        from ultralytics import YOLO
    except ImportError as exc:
        raise SystemExit("Ultralytics is not installed. Run setup-ai-windows.bat first.") from exc

    print(f"Starting training: epochs={args.epochs}, imgsz={args.imgsz}, batch={args.batch}, device={args.device}")
    model = YOLO(args.base)
    opts = {
        "data": str(normalized_yaml), "epochs": args.epochs, "imgsz": args.imgsz,
        "batch": args.batch, "workers": args.workers, "project": str(Path(__file__).resolve().parents[1] / "runs"),
        "name": args.name, "exist_ok": True, "patience": 12, "plots": True, "seed": 42,
        "device": args.device,
    }
    model.train(**opts)
    project_root = Path(__file__).resolve().parents[1]
    best = project_root / "runs" / args.name / "weights" / "best.pt"
    if not best.is_file():
        raise SystemExit(f"Training finished without a best checkpoint: {best}")

    trained = YOLO(str(best))
    print("Evaluating on validation split...")
    val_metrics = trained.val(data=str(normalized_yaml), split="val", imgsz=args.imgsz, plots=True)
    final_report: dict[str, Any] = {
        **report_base,
        "checkpoint": str(best),
        "training": {"base_checkpoint": args.base, "epochs_requested": args.epochs, "imgsz": args.imgsz, "batch": args.batch, "device": args.device},
        "validation_metrics": extract_metrics(val_metrics, data["names"]),
    }
    if splits.get("test"):
        print("Evaluating once on the held-out test split...")
        test_metrics = trained.val(data=str(normalized_yaml), split="test", imgsz=args.imgsz, plots=True)
        final_report["test_metrics"] = extract_metrics(test_metrics, data["names"])
    else:
        final_report["test_metrics"] = None
        final_report["test_note"] = "No test split was declared in data.yaml; only validation metrics were calculated."

    report_path = project_root / "runs" / args.name / "validation-summary.json"
    report_path.write_text(json.dumps(final_report, indent=2), encoding="utf-8")
    print(f"Metrics report: {report_path}")
    if not args.no_promote:
        target = project_root / "models" / "road_defects.pt"
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(best, target)
        print(f"Model installed for StreetSense: {target}")
    print("Training and evaluation finished. Review the report, confusion matrix, and predictions before relying on detections.")


if __name__ == "__main__":
    main()
