#!/usr/bin/env python3
"""Read the facts recorded inside a YOLO weights file (classes, training size, validation scores)
WITHOUT running the model or importing torch, and save them to models/model_info.json.
Usage:  python ai/model_info.py [path/to/weights.pt]"""
import collections, io, json, os, pickle, sys, zipfile

SAFE = {('collections', 'OrderedDict'): collections.OrderedDict, ('builtins', 'set'): set, ('builtins', 'frozenset'): frozenset,
        ('builtins', 'dict'): dict, ('builtins', 'list'): list, ('builtins', 'tuple'): tuple}

class Stub:                      # stands in for every non-basic class, so nothing from the file is ever executed
    def __init__(self, *a, **k): self.args = a; self.state = None
    def __setstate__(self, s): self.state = s
    def __call__(self, *a, **k): return Stub()

class SafeUnpickler(pickle.Unpickler):
    def find_class(self, module, name): return SAFE.get((module, name), Stub)
    def persistent_load(self, pid): return None

def read(weights):
    z = zipfile.ZipFile(weights)
    pkl = next(n for n in z.namelist() if n.endswith('data.pkl'))
    ck = SafeUnpickler(io.BytesIO(z.read(pkl))).load()
    args, tm, tr = ck.get('train_args') or {}, ck.get('train_metrics') or {}, ck.get('train_results') or {}
    names = None
    for key in ('ema', 'model'):
        st = getattr(ck.get(key), 'state', None)
        if isinstance(st, dict) and 'names' in st: names = st['names']; break
    if names is None:                                    # fall back: the class list is stored as plain strings
        raise SystemExit('Could not find the class names in this file.')
    names = [names[k] for k in sorted(names)] if isinstance(names, dict) else list(names)
    pct = lambda v: None if v is None else round(float(v) * 100, 1)
    prec = tr.get('metrics/precision(B)') or []
    return {
        'weights': os.path.basename(weights), 'readAt': __import__('datetime').datetime.now().isoformat(timespec='seconds'),
        'model': 'YOLO11n' if 'yolo11n' in json.dumps(str(ck.get('model') and getattr(ck['model'], 'state', ''))).lower() else 'YOLO',
        'classes': names, 'trainedAt': ck.get('date'), 'ultralyticsVersion': ck.get('version'),
        'trainingImageSize': args.get('imgsz'), 'epochs': args.get('epochs'), 'epochsRecorded': len(prec), 'batch': args.get('batch'), 'device': args.get('device'),
        'trainingConfig': str(args.get('data', '')).replace('\\', '/').split('/')[-1],
        'validation': {'precisionPct': pct(tm.get('metrics/precision(B)')), 'recallPct': pct(tm.get('metrics/recall(B)')), 'map50Pct': pct(tm.get('metrics/mAP50(B)')), 'map5095Pct': pct(tm.get('metrics/mAP50-95(B)'))},
        'peakPrecisionAnyEpochPct': pct(max(prec)) if prec else None,
    }

if __name__ == '__main__':
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    weights = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, 'models', 'road_defects.pt')
    info = read(weights)
    out = os.path.join(os.path.dirname(weights), 'model_info.json')
    json.dump(info, open(out, 'w'), indent=2); print(json.dumps(info, indent=2)); print('\nSaved to', out)
