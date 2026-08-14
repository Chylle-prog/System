# -*- coding: utf-8 -*-
import os, sys, io
import numpy as np
import cv2

ARTIFACT_DIR = r"C:\Users\Chyle\.gemini\antigravity-ide\brain\a87f14f1-2272-477b-8527-223e8b83f847"
AI_FAKE = os.path.join(ARTIFACT_DIR, "fake_ai_merit_certificate_1786681438865.jpg")

with open(AI_FAKE, 'rb') as f:
    raw = f.read()

img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
h, w = gray.shape
print("=== AI FAKE MERIT CERT ===")
print(f"Resolution: {w}x{h}")

# Color palette
img_s = cv2.resize(img, (128,128))
flat = img_s.reshape(-1,3)
q = (flat >> 3).astype('int32')
codes = q[:,0]*1024 + q[:,1]*32 + q[:,2]
color_ratio = len(set(codes.tolist())) / float(flat.shape[0])
signal_color = max(0.0, min(1.0, (0.65 - color_ratio) / 0.45))
print(f"Color ratio: {color_ratio:.4f}  -> signal_color: {signal_color:.3f}")

# Laplacian (HIGH in AI digital renders = crisp edges, low in real JPEG scans)
lap = cv2.Laplacian(gray.astype(np.uint8), cv2.CV_64F)
lap_var = float(np.var(lap))
signal_lap = max(0.0, min(1.0, (lap_var - 800.0) / 3000.0))
print(f"Laplacian var: {lap_var:.1f}  -> signal_lap: {signal_lap:.3f}")

# Edge / Hough
edges = cv2.Canny(gray.astype(np.uint8), 40, 120)
ep = int(np.sum(edges > 0))
lines = cv2.HoughLinesP(edges, 1, 3.14159/180, threshold=50, minLineLength=40, maxLineGap=8)
lc = len(lines) if lines is not None else 0
ratio = lc / (ep + 1e-5) * 1000
signal_edge = max(0.0, min(1.0, (ratio - 1.5) / 3.0))
print(f"Edge px: {ep}, Lines: {lc}, ratio: {ratio:.3f}  -> signal_edge: {signal_edge:.3f}")

# Background uniformity
bg_mask = gray > 195
bg_cnt = int(np.sum(bg_mask))
bg_std = float(np.std(gray[bg_mask])) if bg_cnt > 500 else 99.0
signal_bg = max(0.0, min(1.0, (7.0 - bg_std) / 5.5))
print(f"BG std: {bg_std:.3f}  -> signal_bg: {signal_bg:.3f}")

# Green channel uniformity (DLSL green sidebar)
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
gmask = (hsv[:,:,0]>=40)&(hsv[:,:,0]<=85)&(hsv[:,:,1]>60)
gpx = int(np.sum(gmask))
if gpx > 200:
    green_std = float(np.std(gray[gmask]))
    signal_green = max(0.0, min(1.0, (8.0 - green_std) / 6.0))
else:
    green_std = 99.0
    signal_green = 0.0
print(f"Green px: {gpx}, Green std: {green_std:.3f}  -> signal_green: {signal_green:.3f}")

comp = signal_color*0.30 + signal_edge*0.28 + signal_bg*0.15 + signal_lap*0.15 + signal_green*0.12
ai_score = round(comp * 100, 2)
flagged = "FLAGGED" if ai_score >= 48.0 else "AUTHENTIC"
print(f"\nCOMPOSITE (no EXIF): {ai_score}%  -> {flagged}")
