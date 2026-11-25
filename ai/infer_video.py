#!/usr/bin/env python3
"""StreetSense: sample frames from dashcam / mobile footage, run YOLO, merge repeat sightings.
Prints one JSON object on the last stdout line. Uses the same weights as infer.py."""
import argparse, json, math, os, sys

LABELS = {'D00': 'Longitudinal crack', 'D01': 'Longitudinal crack (joint)', 'D10': 'Lateral crack', 'D11': 'Lateral crack (joint)', 'D20': 'Alligator crack', 'D40': 'Pothole',
          'D43': 'Faded crosswalk', 'D44': 'Faded white line', 'D50': 'Manhole / utility cover', 'D0w0': 'Unrecognised class (D0w0)', 'waterlogging': 'Waterlogging',
          'road_edge_breakage': 'Road edge breakage', 'failed_repair_patch': 'Failed repair patch', 'asphalt_ravelling': 'Asphalt ravelling', 'surface_bleeding': 'Surface bleeding'}


def model_imgsz(model):
    """Run the model at the size it was trained at (set STREETSENSE_IMGSZ to override)."""
    env = os.environ.get('STREETSENSE_IMGSZ')
    if env and env.isdigit(): return int(env)
    try:
        v = (getattr(model, 'overrides', None) or {}).get('imgsz')
        return int(v[0] if isinstance(v, (list, tuple)) else v)
    except Exception:
        return 640

def merge_duplicates(dets, iou_limit=0.5, contain_limit=0.8):
    """Keep the strongest box when two boxes of the same class cover (nearly) the same spot."""
    kept = []
    for d in sorted(dets, key=lambda x: x['confidence'], reverse=True):
        dup = False
        for k in kept:
            if k['className'] != d['className']:
                continue
            ax1, ay1, ax2, ay2 = k['bbox']; bx1, by1, bx2, by2 = d['bbox']
            iw, ih = max(0.0, min(ax2, bx2) - max(ax1, bx1)), max(0.0, min(ay2, by2) - max(ay1, by1))
            inter = iw * ih; a, b = (ax2 - ax1) * (ay2 - ay1), (bx2 - bx1) * (by2 - by1); union = a + b - inter
            if union > 0 and (inter / union >= iou_limit or inter / max(1e-9, min(a, b)) >= contain_limit):
                dup = True; break
        if not dup:
            kept.append(d)
    return kept


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--weights', required=True)
    p.add_argument('--video', required=True)
    p.add_argument('--out-dir', required=True, help='Where to save the flagged frame of each defect (JPEG)')
    p.add_argument('--prefix', default='job')
    p.add_argument('--every', type=float, default=1.0, help='Analyse one frame every N seconds')
    p.add_argument('--confidence', type=float, default=0.35)
    p.add_argument('--max-frames', type=int, default=900)
    a = p.parse_args()
    if not os.path.isfile(a.weights):
        print(json.dumps({'ok': False, 'status': 'model_not_found', 'message': 'YOLO weights file is missing.'})); return 2
    try:
        import cv2
        cap = cv2.VideoCapture(a.video)
        if not cap.isOpened():
            print(json.dumps({'ok': False, 'status': 'bad_video', 'message': 'The video could not be opened.'})); return 1
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        step = max(1, int(round(fps * max(a.every, 0.1))))
        from ultralytics import YOLO
        model = YOLO(a.weights); imgsz = model_imgsz(model)
        os.makedirs(a.out_dir, exist_ok=True)
        tracks, idx, sampled, last_t = [], 0, 0, 0.0
        while sampled < a.max_frames and cap.grab():
            if idx % step == 0:
                ok, frame = cap.retrieve()
                if ok:
                    sampled += 1; t = idx / fps; last_t = t
                    h, w = frame.shape[:2]
                    raw = []
                    for r in model.predict(source=frame, conf=a.confidence, iou=0.5, imgsz=imgsz, verbose=False):
                        for box in r.boxes:
                            raw.append({'className': str(r.names.get(int(box.cls.item()), int(box.cls.item()))), 'confidence': float(box.conf.item()), 'bbox': [float(v) for v in box.xyxy[0].tolist()]})
                    for dd in merge_duplicates(raw):
                        if True:
                            x1, y1, x2, y2 = dd['bbox']; conf = dd['confidence']; cls = dd['className']
                            cx, cy, area = (x1 + x2) / 2 / w, (y1 + y2) / 2 / h, max(0.0, (x2 - x1) * (y2 - y1)) / (w * h)
                            tr = next((k for k in tracks if k['cls'] == cls and t - k['last'] <= a.every * 2.5 + 0.5 and math.hypot(cx - k['cx'], cy - k['cy']) < 0.25), None)
                            if tr is None:
                                tr = {'cls': cls, 'start': t, 'conf': -1, 'frames': 0}; tracks.append(tr)
                            tr.update(last=t, cx=cx, cy=cy); tr['frames'] += 1
                            if conf > tr['conf']:
                                snap = frame.copy(); cv2.rectangle(snap, (int(x1), int(y1)), (int(x2), int(y2)), (0, 180, 255), 3)
                                tr.update(conf=conf, t=t, area=area, snap=snap)
            idx += 1
        dets = []
        for n, k in enumerate(sorted(tracks, key=lambda k: k['t'])):
            name = f"{a.prefix}-{n}.jpg"; cv2.imwrite(os.path.join(a.out_dir, name), k['snap'], [cv2.IMWRITE_JPEG_QUALITY, 80])
            dets.append({'className': k['cls'], 'confidence': round(k['conf'], 4), 'timeSec': round(k['t'], 2), 'firstSeenSec': round(k['start'], 2), 'framesSeen': k['frames'], 'areaRatio': round(k['area'], 5), 'frame': name})
        cap.release()
        duration = total / fps if total else last_t
        print(json.dumps({'ok': True, 'status': 'inference_complete', 'model': os.path.basename(a.weights), 'durationSec': round(duration, 2), 'framesAnalysed': sampled, 'detections': dets}))
        return 0
    except Exception as exc:
        print(json.dumps({'ok': False, 'status': 'inference_error', 'message': str(exc)[:500]})); return 1

if __name__ == '__main__':
    sys.exit(main())
