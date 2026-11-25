# StreetSense 4.7 — Roboflow RDD2022-India-Aug training + evidence prototype

StreetSense keeps its existing premium HTML/CSS/JavaScript interface and now includes a Node.js backend with persistent SQLite storage.

## Requirements

- Node.js **22 or newer** (uses the built-in `node:sqlite` module; Node may print an experimental-feature warning).
- Internet connection for Google Fonts and OpenStreetMap/Leaflet map tiles.
- No npm packages are required.

## Run on Windows

1. Install Node.js 22+ from https://nodejs.org/.
2. Extract the ZIP.
3. Double-click `start.bat`.
4. Open http://localhost:8000 if the browser does not open automatically.
5. Keep the terminal window running while using StreetSense. Press `Ctrl+C` to stop the server.

Alternatively, open a terminal in this folder and run:

```bash
node server.js
```

The database is created automatically at `data/streetsense.sqlite`. It persists incident and work-order changes across browser refreshes and server restarts. Back up this file to preserve saved workspace records.

## Backend capabilities

- SQLite database for incidents, work orders, app metadata, and audit events.
- Workspace bootstrap: frontend loads the server snapshot before rendering.
- Automatic snapshot synchronization when incidents are created, work orders are created, or work-order statuses change.
- REST endpoints for incident and work-order listing, creation, and updates.
- Evidence upload API stores JPG/PNG/WebP files (up to 8 MB) under `data/evidence/`, with metadata in SQLite.
- Optional browser GPS capture is requested only when the user runs the upload workflow; permission denial is handled gracefully.
- Evidence records remain `pending_human_review`. If a trained YOLO model is installed, the server runs local image inference and attaches detections; otherwise it explicitly reports that the model is not configured.
- Optional YOLO inference is provided through `ai/infer.py` using Ultralytics. Add your trained `models/road_defects.pt` weights and install `ai/requirements.txt` to enable it. No model weights are bundled.
- Analytics endpoint computed from saved incident records.
- Audit endpoint for recent backend write events.
- Server-side field validation, bounded JSON request size, same-origin API, and basic security response headers.
- The server binds to `127.0.0.1` only; it is intended for local development and evaluation.

## Accounts and complaint portal

- The first administrator is created once from `/admin.html`; later administrator access requires sign-in.
- Citizens can register, sign in, submit complaints with optional photos and GPS coordinates, and view their own submissions.
- Administrators can review all complaints, update statuses and notes, create accounts, reset passwords, and disable accounts.
- Passwords are stored as salted scrypt hashes. Session cookies are HTTP-only and same-site; sessions are held in memory and expire after 12 hours.
- The administrator portal is available at `/admin.html`.

## API reference

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Backend/database health |
| GET | `/api/snapshot` | Load incidents and work orders |
| PUT | `/api/snapshot` | Persist current workspace |
| GET | `/api/incidents` | List incidents |
| POST | `/api/incidents` | Create an incident |
| PATCH | `/api/incidents/:id` | Update an incident |
| GET | `/api/work-orders` | List work orders |
| POST | `/api/work-orders` | Create a work order |
| PATCH | `/api/work-orders/:id` | Update a work order |
| GET | `/api/analytics` | Calculate incident KPIs and category counts |
| GET | `/api/audit` | Read latest backend audit events |
| POST | `/api/evidence` | Store an image, optional GPS coordinates, and run YOLO inference when weights are configured |
| GET/POST | `/api/auth/*` | Check setup state, register, sign in, sign out, and inspect the current account |
| GET/POST/PATCH | `/api/users` | Administrator-only account listing, creation, and updates |
| GET/POST | `/api/complaints` | Submit a complaint and list the current account's complaints (administrators can list all) |
| GET/PATCH | `/api/admin/complaints` | Administrator-only complaint review and status updates |
| GET | `/api/evidence` | List evidence metadata and review status |

Example health check: http://localhost:8000/api/health

## Enable real YOLO inference

1. Install Python 3.10 or newer.
2. Open a terminal in this project folder and run `python -m pip install -r ai/requirements.txt` (on Windows, use `py -m pip install -r ai/requirements.txt`).
3. Place a **trained road-defect YOLO model** at `models/road_defects.pt`. The model class labels should identify road defects such as potholes, cracks, damaged signs, or blocked drains.
4. Restart `start.bat`. Upload a JPG/PNG/WebP image; the backend will run inference locally and return the model's detections and confidence values. All suggestions remain pending human review.

If you use a different model path, set `STREETSENSE_MODEL` before starting the server. Set `PYTHON` to the Python executable if the default `python3`/Windows `py -3` command is not available. First-time inference can take longer while the model initializes.

## Important prototype and security boundaries

- This is a **local development and evaluation backend**, not a production municipal deployment. It includes local account authentication, administrator/citizen roles, and administrator-only management routes, but does not include HTTPS termination, cloud backups, rate limiting, or production-grade operational controls. Do not expose it to the public internet or use it for sensitive citizen data.
- **YOLO integration is present, but trained weights are not bundled.** Until `models/road_defects.pt` is supplied, uploads are stored without a model prediction and the incident is labelled `Other` for manual review. Do not describe the system as detecting road defects until you install a suitable road-defect model and validate it on representative images. Generic COCO weights are not suitable for this task.
- Evidence upload stores original image files locally. It does not extract GPS EXIF metadata; coordinates are collected from browser geolocation only after user permission. GPS accuracy is device/network dependent.
- Map coordinates in the initial records are illustrative New Delhi coordinates. Manually supplied coordinates are stored, but must be checked before operational use.
- Work orders are records in the local database; they are not dispatched to a real municipal authority.
- The backend audit log records workspace snapshots and API resource mutations; it is not a tamper-proof compliance log.

## Next steps for a production-ready system

For a production deployment, harden the existing authentication (or integrate an established identity provider), add HTTPS, rate limiting, secure evidence storage, database backups, structured monitoring, retention controls, and integration with an authorized municipal work-order system. Keep illustrative and verified data visibly separate.

## Train the India road-defect baseline

A training pipeline is included in `ai/train.py`. It expects a properly labelled YOLO-format dataset under `dataset/` (see `ai/TRAINING.md` for exact folder layout, class IDs, annotation rules, licensing, and evaluation guidance). On Windows, run `setup-ai-windows.bat`, prepare the dataset, then run `train-ai-windows.bat`. Successful training evaluates the best checkpoint and copies it to `models/road_defects.pt` for the existing inference endpoint.

The model trainer detects which of the five fixed classes actually have labelled examples and only includes active classes with contiguous IDs. The RDD2022 India converter supplies pothole and road-crack labels only; it cannot train the other three classes. Training is not performed by extracting the ZIP: run the training script on your own computer after downloading the dataset. All app detections remain suggestions for human verification.

### Indian road dataset preparation

See `ai/TRAINING.md` for the RDD2022 India subset source, attribution notes, and the converter. After extracting the dataset, run `prepare-rdd2022-india.bat "C:\\path\\to\\RDD2022_India"`. The converter maps potholes and crack categories only; signs, streetlights, and blocked drains need separately labelled data.


## One-command India baseline workflow (Windows)

1. Install Python 3.10 or 3.11 and Node.js 22+.
2. Run `train-india-model.bat` from the project folder. It creates `.venv-ai`, downloads and extracts the official RDD2022 India archive, converts the annotations, trains a small YOLO baseline on CPU, validates it, and promotes the checkpoint to `models/road_defects.pt`.
3. When training completes, restart `start.bat` and upload a test image. The backend prefers the project's `.venv-ai` Python environment for inference.
4. Review `runs/streetsense-india-road-defects/validation-summary.json` and the Ultralytics plots. Also test on a separate set of local road images before relying on predictions in real-world workflows.

The India archive is approximately 502 MB and needs additional disk space when extracted. Training can take a long time on CPU. The provided workflow uses a conservative 30-epoch, batch-2 CPU baseline for compatibility; it is not a promise of accuracy. The RDD2022 India training portion has about 9,000 images and the published challenge describes 1,000 test images, but the converter makes its own train/validation split from annotated training data.

The app's backend inference code is already wired to `models/road_defects.pt`; this release fixes Python environment selection so the server can use the same virtual environment that installed Ultralytics. No trained weights or third-party dataset images are bundled.


## 4.6 workflow checks

This release improves repeatability: dataset conversion removes stale generated split files before writing, and training stops if any active class is missing from either the training or validation split. This is a dataset-quality guard, not a guarantee of model accuracy.


## Train with RDD2022-India-Aug (Roboflow YOLO export)

This project includes `ai/train_roboflow.py` and `train-roboflow-windows.bat` for a Roboflow YOLO-format export. It reads your exported `data.yaml` directly; it does **not** run the older Pascal-VOC XML converter. It validates image/label pairs and class IDs, writes a normalized dataset YAML with resolved absolute paths, trains YOLO11n, evaluates validation and (when defined) the held-out test split, writes metrics, and optionally installs `models/road_defects.pt`.

Your supplied RDD2022-India-Aug YAML declares these 10 classes:

`D00`, `D01`, `D0w0`, `D10`, `D11`, `D20`, `D40`, `D43`, `D44`, `D50`.

The StreetSense dashboard currently maps `D00`, `D01`, `D10`, `D11`, and `D20` to **Road crack**, and `D40` to **Pothole**. `D0w0` (an uncertain/error label in published RDD references), `D43` (crosswalk corruption), `D44` (white-line corruption), and `D50` (manhole-cover damage) are kept as **Other** because the current incident taxonomy has no separate categories for them. The original class codes remain in the model output and audit metadata.

### Windows steps

1. Extract your Roboflow ZIP completely, preserving its `train`, `valid`, `test`, and `data.yaml` files/folders.
2. Keep the extracted dataset anywhere on your PC; it does not need to be copied into the StreetSense folder.
3. In the StreetSense project folder, run `setup-ai-windows.bat` once if `.venv-ai` has not been created yet.
4. Run `train-roboflow-windows.bat` and paste the full path to the extracted `data.yaml` when asked. Or pass the path directly as the batch file's first argument.
5. The batch file runs a dataset check first. If that passes, it starts a 30-epoch CPU baseline with batch size 2. Training can take many hours on a CPU; keep the PC powered and leave sufficient free disk space.
6. After successful training, check `runs/streetsense-rdd2022-india-aug/validation-summary.json`. It contains actual validation metrics and held-out test metrics when a test split exists. The trained checkpoint is copied to `models/road_defects.pt`.
7. Restart StreetSense and test with images not used during training. Treat every prediction as a review suggestion, not an automatic municipal decision.

### Optional commands

Check only (no training):

```powershell
.venv-ai\Scripts\python.exe ai\train_roboflow.py --data "D:\path\to\RDD2022-India-Aug\data.yaml" --check-only
```

Start a shorter smoke-test run:

```powershell
.venv-ai\Scripts\python.exe ai\train_roboflow.py --data "D:\path\to\RDD2022-India-Aug\data.yaml" --epochs 3 --imgsz 640 --batch 2 --device cpu
```

Do not use the 3-epoch smoke-test metrics as a final accuracy claim. The supplied Roboflow `data.yaml` uses `../train/images`, `../valid/images`, and `../test/images`; the new trainer checks the common Roboflow export layouts and normalizes them to absolute paths before training. If it cannot resolve a directory, it stops with the candidate paths it tried rather than guessing.

Dataset reference supplied in the export: https://universe.roboflow.com/prakhar-kpb1v/rdd2022-india-il8ju/dataset/6 . Preserve the dataset creator attribution and the CC BY 4.0 licence terms shown in that export when redistributing or publishing results.


## StreetSense citizen and administration portals

The refreshed experience is served by the existing Node.js application:
- Public portal: `http://localhost:8000/`
- Administrator portal: `http://localhost:8000/admin.html`
- Existing operations dashboard: `http://localhost:8000/operations.html`

Requirements: Node.js 22 or newer (the backend uses `node:sqlite`).

Run `start.bat` on Windows, or `node server.js` from this folder. On first launch, open the administrator portal and create the first administrator account. After that, administrator creation is restricted to signed-in administrators. Citizens can register from the public portal or receive an account created by an administrator.

Account passwords are stored using Node.js scrypt password hashing. Sessions are held in memory and expire after 12 hours; signing out or restarting the server ends active sessions. For a public internet deployment, put the service behind HTTPS and add persistent session storage, rate limiting, email verification and password-reset delivery before accepting real public traffic.

The citizen portal stores reports in the local SQLite database. Photo evidence is saved under `data/evidence`. The model training scripts, datasets, model checkpoints and Python environment are kept separate and are not changed by the portal.

## 4.8 — "Survey Sheet" redesign

New design system shared by all three surfaces: `ss-base.css` (tokens, buttons, forms, badges, modals), `icons.svg` (icon sprite), plus `dashboard.css` (operations desk), `admin.css` and `portal.css`.

- `operations.html` + `app.js` — rebuilt operations desk: daily brief, dispatch queue, map with side list, drag-and-drop work-order board, computed analytics, citizen inbox (promote complaints to incidents), command palette (Ctrl+K), dark theme, mobile bottom navigation, admin sign-in.
- `index.html`, `admin.html` — restyled; admin and ops link to each other; citizens get a "My reports" panel.
- Old dashboard files are kept in `legacy/` and are no longer loaded. `styles.css`, `enhancements.*` and `premium.*` in the root can be deleted.
- Figures are computed from the incident register. Seed records are tagged "Sample"; use Ctrl+K → "Remove sample records" before real use. The weekly trend chart is labelled sample data.
