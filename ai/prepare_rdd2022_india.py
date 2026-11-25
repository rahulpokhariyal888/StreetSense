#!/usr/bin/env python3
"""Convert RDD2022 India Pascal-VOC annotations to StreetSense YOLO format.

RDD2022 classes used here: D00/D10/D20 -> road_crack (class 1), D40 -> pothole (class 0).
Other StreetSense classes require separately collected and labelled examples.
"""
from __future__ import annotations
import argparse, random, shutil, xml.etree.ElementTree as ET
from pathlib import Path

IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.bmp', '.webp'}
RDD_TO_STREETSENSE = {'D00': 1, 'D10': 1, 'D20': 1, 'D40': 0}


def get_text(node, tag, default=''):
    child = node.find(tag)
    return child.text.strip() if child is not None and child.text else default


def convert_one(xml_path: Path, image_path: Path):
    root = ET.parse(xml_path).getroot()
    size = root.find('size')
    if size is None:
        raise ValueError('missing <size>')
    width, height = int(get_text(size, 'width', '0')), int(get_text(size, 'height', '0'))
    if width <= 0 or height <= 0:
        raise ValueError('invalid image dimensions')
    rows, ignored = [], 0
    for obj in root.findall('object'):
        name = get_text(obj, 'name').upper()
        if name not in RDD_TO_STREETSENSE:
            ignored += 1
            continue
        box = obj.find('bndbox')
        if box is None:
            continue
        try:
            xmin = float(get_text(box, 'xmin')); ymin = float(get_text(box, 'ymin'))
            xmax = float(get_text(box, 'xmax')); ymax = float(get_text(box, 'ymax'))
        except ValueError:
            continue
        xmin, xmax = max(0.0, min(width, xmin)), max(0.0, min(width, xmax))
        ymin, ymax = max(0.0, min(height, ymin)), max(0.0, min(height, ymax))
        if xmax <= xmin or ymax <= ymin:
            continue
        xc, yc = ((xmin+xmax)/2)/width, ((ymin+ymax)/2)/height
        bw, bh = (xmax-xmin)/width, (ymax-ymin)/height
        rows.append(f'{RDD_TO_STREETSENSE[name]} {xc:.6f} {yc:.6f} {bw:.6f} {bh:.6f}')
    return rows, ignored


def main():
    ap = argparse.ArgumentParser(description='Convert RDD2022 India XML annotations into StreetSense YOLO labels')
    ap.add_argument('--source', required=True, help='Extracted RDD2022 India folder (searched recursively for XML/JPG pairs)')
    ap.add_argument('--output', default=str(Path(__file__).resolve().parents[1] / 'dataset'))
    ap.add_argument('--val-ratio', type=float, default=0.2)
    ap.add_argument('--seed', type=int, default=42)
    args = ap.parse_args()
    if not 0.05 <= args.val_ratio <= 0.4:
        raise SystemExit('--val-ratio must be between 0.05 and 0.4')
    source, out = Path(args.source).resolve(), Path(args.output).resolve()
    if not source.is_dir():
        raise SystemExit(f'Source folder not found: {source}')
    pairs, missing = [], 0
    # RDD archives may keep JPEGImages and Annotations in separate trees.
    image_index = {}
    for candidate in source.rglob('*'):
        if candidate.is_file() and candidate.suffix.lower() in IMAGE_EXTS:
            image_index.setdefault(candidate.stem.casefold(), []).append(candidate)
    for xml in source.rglob('*.xml'):
        stem = xml.stem
        same_dir = next((p for p in xml.parent.iterdir() if p.is_file() and p.stem.casefold() == stem.casefold() and p.suffix.lower() in IMAGE_EXTS), None)
        candidates = image_index.get(stem.casefold(), [])
        image = same_dir or (candidates[0] if len(candidates) == 1 else None)
        if image is None:
            missing += 1
        else:
            pairs.append((xml, image))
    if not pairs:
        raise SystemExit('No Pascal-VOC XML/image pairs found. Check the extracted India training folder.')
    # Clear only the generated split folders so reruns cannot silently mix old labels/images.
    for split in ('train', 'val'):
        for kind in ('images', 'labels'):
            target = out / kind / split
            if target.exists():
                shutil.rmtree(target)
            target.mkdir(parents=True, exist_ok=True)
    random.Random(args.seed).shuffle(pairs)
    n_val = max(1, round(len(pairs) * args.val_ratio))
    splits = {'val': pairs[:n_val], 'train': pairs[n_val:]}
    for split, items in splits.items():
        for idx, (xml, image) in enumerate(items):
            # Prefix names to avoid collisions across nested RDD directories.
            safe_name = f'{xml.parent.name}_{image.stem}_{idx:06d}'
            try:
                rows, _ = convert_one(xml, image)
            except Exception as exc:
                print(f'SKIP {xml}: {exc}')
                continue
            shutil.copy2(image, out / 'images' / split / f'{safe_name}{image.suffix.lower()}')
            (out / 'labels' / split / f'{safe_name}.txt').write_text('\n'.join(rows) + ('\n' if rows else ''), encoding='utf-8')
    train_n = len([p for p in (out/'images/train').iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTS])
    val_n = len([p for p in (out/'images/val').iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTS])
    print(f'Converted dataset to: {out}')
    print(f'Train images: {train_n}; validation images: {val_n}; XML files without image: {missing}')
    if train_n == 0 or val_n == 0:
        raise SystemExit('Conversion produced an empty train or validation split; inspect the source archive and annotations.')
    print('Mapped: D00/D10/D20 -> road_crack (1); D40 -> pothole (0)')
    print('Not supplied by this dataset conversion: damaged_sign, broken_streetlight, blocked_drain.')
    print('Review labels and split quality before training; do not treat this conversion as proof of model accuracy.')

if __name__ == '__main__':
    main()
