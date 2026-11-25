# YOLO model weights

Place your **trained road-defect YOLO weights** here as `road_defects.pt`.

The model's class names should describe the defects it was trained to detect, for example `pothole`, `road_crack`, `damaged_sign`, `blocked_drain`. A generic COCO YOLO model is not a road-defect model and should not be treated as one.

StreetSense does not bundle third-party weights. Use a dataset you are licensed to use, split it into train/validation sets, train and evaluate your detector, then copy the resulting `best.pt` to this folder as `road_defects.pt`.
