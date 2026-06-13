#!/usr/bin/env python3
"""
Auto-reframe helper for auto-clipper.

Samples frames from a time window of a video, detects faces with OpenCV's
Haar cascade, and decides how to crop the clip to vertical:

  - "single": one subject  -> returns one horizontal center (fraction 0..1)
  - "split" : two subjects -> returns two centers (top, bottom)
  - "center": no/unclear faces -> caller should center-crop

Output: a single JSON line on stdout, e.g.
  {"width":1280,"height":720,"layout":"split","centers":[0.31,0.72]}

Designed to fail soft: if OpenCV is missing or anything goes wrong, it prints
{"layout":"center"} so the Node side falls back to a plain center crop.
"""
import sys
import json


def emit(obj):
    sys.stdout.write(json.dumps(obj))
    sys.stdout.flush()


def main():
    if len(sys.argv) < 4:
        emit({"layout": "center", "error": "usage: reframe.py <video> <start> <duration> [samples] [mode]"})
        return

    video = sys.argv[1]
    start = float(sys.argv[2])
    duration = float(sys.argv[3])
    samples = int(sys.argv[4]) if len(sys.argv) > 4 else 12
    mode = sys.argv[5] if len(sys.argv) > 5 else "auto"

    try:
        import cv2
        import numpy as np
    except Exception as e:  # OpenCV/numpy not installed
        emit({"layout": "center", "error": f"import failed: {e}"})
        return

    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        emit({"layout": "center", "error": "cannot open video"})
        return

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 0
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 0
    cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )

    centers = []  # (x_center_px, area)
    min_face = max(24, int(height * 0.06))
    for i in range(samples):
        t = start + duration * (i + 0.5) / max(1, samples)
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
        ok, frame = cap.read()
        if not ok:
            continue
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = cascade.detectMultiScale(
            gray, scaleFactor=1.1, minNeighbors=5, minSize=(min_face, min_face)
        )
        for (x, y, w, h) in faces:
            centers.append((x + w / 2.0, float(w * h)))

    cap.release()

    if not centers or width == 0:
        emit({"width": width, "height": height, "layout": "center"})
        return

    xs = np.array([c[0] for c in centers], dtype=float)
    areas = np.array([c[1] for c in centers], dtype=float)

    def single():
        c = float(np.average(xs, weights=areas))
        return {"width": width, "height": height, "layout": "single", "center": c / width}

    def try_split():
        order = np.argsort(xs)
        xs_sorted = xs[order]
        if len(xs_sorted) < 4:
            return None
        gaps = np.diff(xs_sorted)
        gi = int(np.argmax(gaps))
        if gaps[gi] < width * 0.18:
            return None
        left = xs_sorted[: gi + 1]
        right = xs_sorted[gi + 1 :]
        if len(left) < 2 or len(right) < 2:
            return None
        c1 = float(np.median(left)) / width
        c2 = float(np.median(right)) / width
        lo, hi = sorted((c1, c2))
        return {"width": width, "height": height, "layout": "split", "centers": [lo, hi]}

    if mode == "single":
        emit(single())
        return
    if mode == "split":
        emit(try_split() or single())
        return

    # auto
    emit(try_split() or single())


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        emit({"layout": "center", "error": str(e)})
