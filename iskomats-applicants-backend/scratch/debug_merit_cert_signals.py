# -*- coding: utf-8 -*-
"""
Merit Certificate: Real vs AI Fake - Signal Diagnostic
=======================================================
Since merit certificates are digital (not camera photos), EXIF is excluded.
We need to calibrate purely on visual/structural signals.
"""
import os
import sys
import io
import base64
import numpy as np
import cv2
from PIL import Image, ExifTags

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

ARTIFACT_DIR = r"C:\Users\Chyle\.gemini\antigravity-ide\brain\a87f14f1-2272-477b-8527-223e8b83f847"

# The AI fake we just generated
AI_FAKE_PATH = os.path.join(ARTIFACT_DIR, "fake_ai_merit_certificate_1786681438865.jpg")

# The real certificate was uploaded as a chat image - we need to encode it
# It was the green/white DLSL Certificate of Recognition shown in conversation
# We'll save it first using PIL from the chat context — placeholder path:
REAL_CERT_PATH = os.path.join(ARTIFACT_DIR, "scratch", "real_merit_cert.jpg")

def analyze_no_exif(label, raw, is_ai_expected):
    """Run all visual signals on an image, WITHOUT EXIF (for digital documents)."""
    img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        print(f"  [ERR] Cannot decode {label}")
        return
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    h, w = gray.shape

    print(f"\n{'='*62}")
    print(f"  {label} | {'>>> EXPECTED: FLAGGED (AI)' if is_ai_expected else '>>> EXPECTED: AUTHENTIC (REAL)'}")
    print(f"  Resolution: {w}x{h}")
    print(f"{'='*62}")

    # ── Signal 1: Edge Straightness (Hough Line Density) ─────────────────────
    edges = cv2.Canny(gray.astype(np.uint8), 40, 120)
    edge_px = int(np.sum(edges > 0))
    lines = cv2.HoughLinesP(edges, 1, np.pi/180, threshold=50, minLineLength=40, maxLineGap=8)
    lc = len(lines) if lines is not None else 0
    edge_ratio = lc / (edge_px + 1e-5) * 1000
    signal_edge = max(0.0, min(1.0, (edge_ratio - 1.5) / 3.0))
    print(f"  Edge ratio:    {edge_ratio:.3f}  -> signal_edge: {signal_edge:.3f}")

    # ── Signal 2: Background Uniformity ───────────────────────────────────────
    bg_mask = gray > 195
    bg_cnt = np.sum(bg_mask)
    if bg_cnt > 500:
        bg_std = float(np.std(gray[bg_mask]))
        signal_bg = max(0.0, min(1.0, (7.0 - bg_std) / 5.5))
    else:
        bg_std = 99.0
        signal_bg = 0.0
    print(f"  BG std:        {bg_std:.3f}  -> signal_bg:   {signal_bg:.3f}")

    # ── Signal 3: Color Palette Depth ────────────────────────────────────────
    img_s = cv2.resize(img, (128, 128))
    flat = img_s.reshape(-1, 3)
    q = (flat >> 3).astype(np.int32)
    codes = q[:,0]*1024 + q[:,1]*32 + q[:,2]
    unique = len(np.unique(codes))
    total = img_s.shape[0] * img_s.shape[1]
    color_ratio = unique / total
    signal_color = max(0.0, min(1.0, (0.65 - color_ratio) / 0.45))
    print(f"  Color ratio:   {color_ratio:.4f}  -> signal_color:{signal_color:.3f}")

    # ── Signal 4: Resolution Fingerprint ─────────────────────────────────────
    AI_DIMS = [
        (1024,1536),(1536,1024),(768,1024),(1024,768),(896,1200),(1200,896),
        (848,1264),(1264,848),(1024,1024),(512,512),(1024,2048),(2048,1024),
        (800,1200),(1200,800),(960,1280),(1280,960),(1280,960),(1200,1600),
        (1600,1200),(1152,896),(896,1152),(1344,768),(768,1344),(1216,832),
        (832,1216),(1408,704),(704,1408),(1472,704),(1024,576),(576,1024),
    ]
    is_ai_res = (w, h) in AI_DIMS
    signal_res = 1.0 if is_ai_res else 0.0
    print(f"  AI resolution: {is_ai_res} ({w}x{h})  -> signal_res:  {signal_res:.3f}")

    # ── Signal 5: Gradient Smoothness (NEW for digital docs) ─────────────────
    # Real certificates from university systems are typically scanned/rendered from
    # PDFs with rich gradient rendering artifacts.
    # AI generators produce very smooth luminance gradients in large color blocks.
    laplacian = cv2.Laplacian(gray.astype(np.uint8), cv2.CV_64F)
    lap_var = float(np.var(laplacian))
    # AI docs: lap_var < 200 (smooth, low variance)
    # Real scanned digital docs: lap_var > 400 (has JPEG rendering artifacts)
    signal_smooth = max(0.0, min(1.0, (400.0 - lap_var) / 350.0))
    print(f"  Laplacian var: {lap_var:.2f}  -> signal_smooth:{signal_smooth:.3f}")

    # ── Signal 6: Green Pixel Uniformity (DLSL Certificate-Specific) ──────────
    # Real DLSL certificates have their green sidebar rendered with slight JPEG
    # banding artifacts. AI fakes have perfectly uniform flat green colors.
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    green_mask = (hsv[:,:,0] >= 40) & (hsv[:,:,0] <= 85) & (hsv[:,:,1] > 60)
    green_px = np.sum(green_mask)
    if green_px > 200:
        green_region = gray[green_mask]
        green_std = float(np.std(green_region))
        # AI: green_std < 4 (perfectly flat) | Real: green_std > 8 (JPEG banding)
        signal_green = max(0.0, min(1.0, (8.0 - green_std) / 6.0))
        print(f"  Green std:     {green_std:.3f}  -> signal_green:{signal_green:.3f}")
    else:
        green_std = 99.0
        signal_green = 0.0
        print(f"  Green px:      {green_px}   -> signal_green: 0.0 (not enough green)")

    # ── Composite Score (NO EXIF) ─────────────────────────────────────────────
    # Without EXIF, redistribute weights across remaining signals
    weights = {'edge': 0.28, 'color': 0.25, 'bg': 0.15, 'res': 0.15, 'smooth': 0.10, 'green': 0.07}
    composite = (
        signal_edge  * weights['edge'] +
        signal_color * weights['color'] +
        signal_bg    * weights['bg'] +
        signal_res   * weights['res'] +
        signal_smooth * weights['smooth'] +
        signal_green * weights['green']
    )
    ai_score = round(composite * 100, 2)
    is_ai = ai_score >= 48.0

    print(f"\n  COMPOSITE AI SCORE: {ai_score}%  (threshold=48%)")
    print(f"  RESULT: {'[FLAGGED - AI]' if is_ai else '[AUTHENTIC - REAL]'}")
    correct = (is_ai == is_ai_expected)
    print(f"  CORRECT: {'[PASS]' if correct else '[FAIL]'}")
    return ai_score, is_ai, correct

def main():
    print("\n" + "="*62)
    print("  MERIT CERTIFICATE - Digital Doc AI Detection (No EXIF)")
    print("="*62)

    results = []

    # Test AI fake
    if os.path.exists(AI_FAKE_PATH):
        with open(AI_FAKE_PATH, 'rb') as f:
            raw = f.read()
        score, flagged, correct = analyze_no_exif("AI Fake Merit Certificate", raw, is_ai_expected=True)
        results.append(("AI Fake", score, flagged, correct))
    else:
        print(f"\n[ERR] AI fake not found: {AI_FAKE_PATH}")

    # Test real certificate
    if os.path.exists(REAL_CERT_PATH):
        with open(REAL_CERT_PATH, 'rb') as f:
            raw = f.read()
        score, flagged, correct = analyze_no_exif("REAL Merit Certificate (DLSL)", raw, is_ai_expected=False)
        results.append(("Real Cert", score, flagged, correct))
    else:
        print(f"\n[NOTE] Real certificate not found at {REAL_CERT_PATH}")
        print("       Save the uploaded real certificate to that path and re-run.")

    print("\n\n" + "="*62)
    print("  SUMMARY")
    print("="*62)
    for label, score, flagged, correct in results:
        verdict = "[OK]" if correct else "[MISS]"
        status = "FLAGGED" if flagged else "AUTHENTIC"
        print(f"  {label:<30} Score:{score:<8} {status:<12} {verdict}")

if __name__ == '__main__':
    main()
