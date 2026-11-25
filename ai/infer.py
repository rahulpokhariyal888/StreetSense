#!/usr/bin/env python3
"""Run local Ultralytics YOLO inference for StreetSense. Prints one JSON object."""
import argparse, json, os, sys

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

ROAD_OK = {'car', 'truck', 'bus', 'motorcycle', 'bicycle', 'train', 'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench'}


def scene_check(image_path, models_dir):
    """Reject photos that are clearly not of a road (for example a person filling the picture).
    Uses the small general-purpose YOLO11n model (models/yolo11n.pt). If it is missing or cannot be downloaded the check is skipped."""
    if os.environ.get('STREETSENSE_ROAD_GATE') == '0':
        return {'checked': False, 'isRoad': None, 'reason': 'Photo check is switched off.'}
    marker = os.path.join(models_dir, '.photo_check_offline')
    try:
        gate_path = os.environ.get('STREETSENSE_GATE_MODEL') or os.path.join(models_dir, 'yolo11n.pt')
        if not os.path.isfile(gate_path) and os.path.isfile(marker) and (__import__('time').time() - os.path.getmtime(marker)) < 3600:
            return {'checked': False, 'isRoad': None, 'reason': 'Photo check unavailable (model not downloaded).'}
        from ultralytics import YOLO
        gm = YOLO(gate_path)
        r = gm.predict(source=image_path, conf=0.5, verbose=False)[0]
        h, w = r.orig_shape
        objs = []
        for b in r.boxes:
            x1, y1, x2, y2 = [float(v) for v in b.xyxy[0].tolist()]
            objs.append({'name': str(r.names[int(b.cls.item())]), 'confidence': round(float(b.conf.item()), 3), 'area': round((x2 - x1) * (y2 - y1) / float(w * h), 3)})
        blockers = [o for o in objs if o['name'] not in ROAD_OK and o['area'] >= 0.2]
        if blockers:
            top = max(blockers, key=lambda o: o['area'])
            return {'checked': True, 'isRoad': False, 'reason': 'This photo is mostly a %s (%d%% of the picture), not a road.' % (top['name'], round(top['area'] * 100)), 'objects': objs[:6]}
        return {'checked': True, 'isRoad': True, 'reason': '', 'objects': objs[:6]}
    except Exception as exc:
        try: open(marker, 'w').write(str(exc)[:200])
        except Exception: pass
        return {'checked': False, 'isRoad': None, 'reason': 'Photo check unavailable: ' + str(exc)[:100]}


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
    p.add_argument('--image', required=True)
    p.add_argument('--confidence', type=float, default=0.35)
    args = p.parse_args()
    if not os.path.isfile(args.weights):
        print(json.dumps({'ok': False, 'status': 'model_not_found', 'message': 'YOLO weights file is missing.'}))
        return 2
    try:
        from ultralytics import YOLO
        model = YOLO(args.weights)
        imgsz = model_imgsz(model)
        results = model.predict(source=args.image, conf=args.confidence, iou=0.5, imgsz=imgsz, verbose=False)
        detections = []
        for result in results:
            names = result.names
            for box in result.boxes:
                cls_id = int(box.cls.item())
                detections.append({'className': str(names.get(cls_id, cls_id)), 'label': LABELS.get(str(names.get(cls_id, cls_id)), str(names.get(cls_id, cls_id))), 'confidence': round(float(box.conf.item()), 4), 'bbox': [round(float(v), 2) for v in box.xyxy[0].tolist()]})
        detections = merge_duplicates(detections)
        detections.sort(key=lambda x: x['confidence'], reverse=True)
        scene = scene_check(args.image, os.path.dirname(os.path.abspath(args.weights)))
        out = {'ok': True, 'status': 'inference_complete', 'model': os.path.basename(args.weights), 'imgsz': imgsz, 'scene': scene, 'detections': detections}
        if scene.get('isRoad') is False:
            out['ignoredDetections'] = detections; out['detections'] = []      # a person's photo is not a road: do not report road defects
        print(json.dumps(out))
        return 0
    except Exception as exc:
        print(json.dumps({'ok': False, 'status': 'inference_error', 'message': str(exc)[:500]}))
        return 1

if __name__ == '__main__':
    sys.exit(main())
