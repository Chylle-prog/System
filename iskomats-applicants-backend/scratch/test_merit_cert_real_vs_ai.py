# -*- coding: utf-8 -*-
"""
Simulate what a REAL DLSL merit certificate digital scan looks like
by creating a downsampled/compressed version of the AI fake (simulating
the university portal download quality) and comparing signals.

The REAL uploaded cert from the user was:
- ~800x600px (low resolution, compressed JPEG from a university portal/screenshot)
- Had visible JPEG compression artifacts in the green sidebar
- Slightly pixelated text
- Non-standard resolution (screenshot of browser showing PDF)

We simulate this by taking the AI fake, downsampling it to 800x600,
compressing it heavily (JPEG quality=40), and then measuring signals.
This approximates how a real university-issued digital cert looks.
"""
import os, io
import numpy as np
import cv2
from PIL import Image

ARTIFACT_DIR = r"C:\Users\Chyle\.gemini\antigravity-ide\brain\a87f14f1-2272-477b-8527-223e8b83f847"
AI_FAKE_PATH = os.path.join(ARTIFACT_DIR, "fake_ai_merit_certificate_1786681438865.jpg")
SIMULATED_REAL_PATH = os.path.join(ARTIFACT_DIR, "scratch", "simulated_real_merit_cert.jpg")

os.makedirs(os.path.dirname(SIMULATED_REAL_PATH), exist_ok=True)

# ── Create simulated "real" cert (low quality JPEG = portal download) ────────
pil = Image.open(AI_FAKE_PATH)
# Downscale to typical screenshot/portal resolution
pil_small = pil.resize((780, 584), Image.LANCZOS)
# Add slight brightness variation (simulate lighting/screen unevenness)
arr = np.array(pil_small).astype(np.float32)
# Add subtle gradient overlay (real screenshots have slight vignette)
y, x = np.mgrid[0:arr.shape[0], 0:arr.shape[1]]
vignette = 1.0 - 0.04 * ((y - arr.shape[0]/2)**2 + (x - arr.shape[1]/2)**2) / (arr.shape[0]*arr.shape[1]/4)
arr = np.clip(arr * vignette[:,:,None], 0, 255).astype(np.uint8)
# Save with aggressive JPEG compression (quality=45, like portal download)
pil_real = Image.fromarray(arr)
buf = io.BytesIO()
pil_real.save(buf, format="JPEG", quality=45)
buf.seek(0)
real_bytes = buf.read()
with open(SIMULATED_REAL_PATH, 'wb') as f:
    f.write(real_bytes)
print(f"Saved simulated real cert: {len(real_bytes)} bytes")

def analyze(label, raw, is_ai_expected):
    img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    h, w = gray.shape
    print(f"\n{'='*58}")
    print(f"  {label}")
    print(f"  Expected: {'FLAGGED (AI)' if is_ai_expected else 'AUTHENTIC (REAL)'}")
    print(f"  Resolution: {w}x{h}")
    print(f"{'='*58}")

    # Color palette
    img_s = cv2.resize(img, (128,128))
    flat = img_s.reshape(-1,3)
    q = (flat >> 3).astype('int32')
    codes = q[:,0]*1024 + q[:,1]*32 + q[:,2]
    color_ratio = len(set(codes.tolist())) / float(flat.shape[0])
    signal_color = max(0.0, min(1.0, (0.65 - color_ratio) / 0.45))
    print(f"  Color ratio:   {color_ratio:.4f}  -> signal: {signal_color:.3f}")

    # Laplacian
    lap = cv2.Laplacian(gray.astype(np.uint8), cv2.CV_64F)
    lap_var = float(np.var(lap))
    signal_lap = max(0.0, min(1.0, (lap_var - 800.0) / 3000.0))
    print(f"  Laplacian var: {lap_var:.1f}  -> signal: {signal_lap:.3f}")

    # Edge / Hough density
    edges = cv2.Canny(gray.astype(np.uint8), 40, 120)
    ep = int(np.sum(edges > 0))
    lines = cv2.HoughLinesP(edges, 1, 3.14159/180, threshold=50, minLineLength=40, maxLineGap=8)
    lc = len(lines) if lines is not None else 0
    ratio = lc / (ep + 1e-5) * 1000
    signal_edge = max(0.0, min(1.0, (ratio - 1.5) / 3.0))
    print(f"  Edge ratio:    {ratio:.3f}  -> signal: {signal_edge:.3f}")

    # Background uniformity
    bg_mask = gray > 195
    bg_cnt = int(np.sum(bg_mask))
    bg_std = float(np.std(gray[bg_mask])) if bg_cnt > 500 else 99.0
    signal_bg = max(0.0, min(1.0, (7.0 - bg_std) / 5.5))
    print(f"  BG std:        {bg_std:.3f}  -> signal: {signal_bg:.3f}")

    # Green uniformity
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    gmask = (hsv[:,:,0]>=40)&(hsv[:,:,0]<=85)&(hsv[:,:,1]>60)
    gpx = int(np.sum(gmask))
    if gpx > 200:
        green_std = float(np.std(gray[gmask]))
        signal_green = max(0.0, min(1.0, (8.0 - green_std) / 6.0))
    else:
        green_std = 99.0
        signal_green = 0.0
    print(f"  Green std:     {green_std:.3f}  -> signal: {signal_green:.3f}")

    # Resolution fingerprint
    AI_DIMS = {(1024,1536),(1536,1024),(768,1024),(1024,768),(896,1200),(1200,896),
               (848,1264),(1264,848),(1024,1024),(512,512),(1024,2048),(2048,1024),
               (800,1200),(1200,800),(960,1280),(1280,960),(1200,1600),(1600,1200),
               (1152,896),(896,1152),(1344,768),(768,1344),(1216,832),(832,1216)}
    signal_res = 1.0 if (w,h) in AI_DIMS else 0.0
    print(f"  AI res match:  {(w,h) in AI_DIMS}  -> signal: {signal_res:.3f}")

    comp = (signal_color*0.28 + signal_edge*0.26 + signal_lap*0.18 +
            signal_bg*0.13 + signal_green*0.10 + signal_res*0.05)
    ai_score = round(comp * 100, 2)
    flagged = ai_score >= 48.0
    print(f"\n  COMPOSITE: {ai_score}%  -> {'[FLAGGED]' if flagged else '[AUTHENTIC]'}")
    correct = flagged == is_ai_expected
    print(f"  VERDICT: {'[PASS]' if correct else '[FAIL]'}")
    return ai_score, flagged, correct

with open(AI_FAKE_PATH, 'rb') as f:
    ai_raw = f.read()
with open(SIMULATED_REAL_PATH, 'rb') as f:
    real_raw = f.read()

r1 = analyze("AI-Generated Fake Certificate", ai_raw, is_ai_expected=True)
r2 = analyze("Simulated Real Certificate (low-res compressed)", real_raw, is_ai_expected=False)

print(f"\n\n{'='*58}")
print(f"  FINAL SUMMARY")
print(f"{'='*58}")
labels = ["AI Fake", "Simulated Real"]
for label, (score, flagged, correct) in zip(labels, [r1, r2]):
    print(f"  {label:<30} {score:<8} {'FLAGGED' if flagged else 'AUTHENTIC':<12} {'[PASS]' if correct else '[FAIL]'}")
