# -*- coding: utf-8 -*-
"""
Diagnostic: Print raw signal values for AI fakes vs Real docs
to calibrate thresholds accurately.
"""
import os
import sys
import io
import numpy as np
import cv2
from PIL import Image, ExifTags

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from services.tamper_ai_detector import resolve_image_bytes

ARTIFACT_DIR = r"C:\Users\Chyle\.gemini\antigravity-ide\brain\a87f14f1-2272-477b-8527-223e8b83f847"

IMAGES = {
    "AI Fake COR":      os.path.join(ARTIFACT_DIR, "fake_ai_cor_1786669576591.jpg"),
    "AI Fake ID Front": os.path.join(ARTIFACT_DIR, "fake_ai_id_front_1786669594633.jpg"),
    "AI Fake Grades":   os.path.join(ARTIFACT_DIR, "fake_ai_grades_1786670080556.jpg"),
    "AI Fake ID Back":  os.path.join(ARTIFACT_DIR, "fake_ai_id_back_1786670288223.jpg"),
}

def analyze(label, raw):
    img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        print(f"  [ERR] Cannot decode image")
        return
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    h, w = gray.shape

    # DCT block analysis
    block_size = 8
    dct_ac = []
    for y in range(0, h - block_size, block_size * 4):
        for x in range(0, w - block_size, block_size * 4):
            block = gray[y:y+block_size, x:x+block_size]
            if block.shape == (block_size, block_size):
                d = cv2.dct(block)
                dct_ac.append(np.sum(np.abs(d)) - abs(d[0,0]))
    arr = np.array(dct_ac) if dct_ac else np.array([0.0])
    dct_mean = float(np.mean(arr))
    dct_std  = float(np.std(arr))
    dct_cv   = dct_std / (dct_mean + 1e-5)
    sig_dct  = max(0.0, min(1.0, (0.9 - dct_cv) / 0.5))

    # Background homogeneity
    bg_mask = gray > 200
    bg_std = float(np.std(gray[bg_mask])) if np.sum(bg_mask) > 100 else 99.0
    sig_bg = max(0.0, min(1.0, (8.0 - bg_std) / 7.0))

    # Edge straightness
    edges = cv2.Canny(gray.astype(np.uint8), 50, 150)
    edge_px = np.sum(edges > 0)
    lines = cv2.HoughLinesP(edges, 1, np.pi/180, threshold=60, minLineLength=50, maxLineGap=5)
    lc = len(lines) if lines is not None else 0
    edge_ratio = lc / (edge_px + 1e-5) * 1000
    sig_edge = max(0.0, min(1.0, edge_ratio / 2.5))

    # EXIF camera check
    try:
        pil = Image.open(io.BytesIO(raw))
        exif = pil._getexif()
        has_cam = False
        if exif:
            for tid, val in exif.items():
                if ExifTags.TAGS.get(tid) in ('Make', 'Model') and val:
                    has_cam = True; break
        sig_exif = 0.0 if has_cam else 0.6
    except:
        sig_exif = 0.3

    composite = sig_dct*0.40 + sig_bg*0.25 + sig_edge*0.15 + sig_exif*0.20
    ai_score = round(composite * 100, 2)

    print(f"\n  {label}")
    print(f"    Resolution: {w}x{h}")
    print(f"    DCT CV:          {dct_cv:.4f}  -> signal_dct:  {sig_dct:.4f}")
    print(f"    BG std:          {bg_std:.4f}  -> signal_bg:   {sig_bg:.4f}")
    print(f"    Edge ratio:      {edge_ratio:.4f}  -> signal_edge: {sig_edge:.4f}")
    print(f"    EXIF cam:        {not bool(sig_exif)}  -> signal_exif: {sig_exif:.4f}")
    print(f"    COMPOSITE SCORE: {ai_score}%  (threshold=50%)")
    print(f"    FLAGGED:         {ai_score >= 50.0}")

print("=" * 62)
print("  RAW SIGNAL DIAGNOSTIC - AI Generated Documents")
print("=" * 62)
for label, path in IMAGES.items():
    with open(path, 'rb') as f:
        raw = f.read()
    analyze(label, raw)
