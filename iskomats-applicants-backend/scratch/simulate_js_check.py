# -*- coding: utf-8 -*-
"""
Simulate client-side canvas JS check on all samples
"""
import os
import cv2
import numpy as np

SAMPLE_DIR = r"c:\Users\Chyle\OneDrive\Desktop\System\iskomats-dashboards-thesis-aclm-g3-master\iskomats-admins\TESTPYTHON\Samples\Her Samples"

def simulate_js_canvas_check(img):
    h, w = img.shape[:2]
    # In cv2, img is BGR. Convert to RGB for JS data simulation:
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    
    topH = int(h * 0.08)
    leftW = int(w * 0.08)
    rightX = int(w * 0.92)
    botY = int(h * 0.92)
    
    magentaBorderPx = 0
    def checkMarginPx(x, y):
        nonlocal magentaBorderPx
        r, g, b = int(rgb[y, x, 0]), int(rgb[y, x, 1]), int(rgb[y, x, 2])
        if r > g * 1.35 and b > g * 1.15 and (r + b) >= 65 and r >= 35 and b >= 25 and g <= 120:
            magentaBorderPx += 1

    for y in range(0, topH, 2):
        for x in range(0, w, 2):
            checkMarginPx(x, y)
    for y in range(botY, h, 2):
        for x in range(0, w, 2):
            checkMarginPx(x, y)
    for y in range(0, h, 2):
        for x in range(0, leftW, 2):
            checkMarginPx(x, y)
        for x in range(rightX, w, 2):
            checkMarginPx(x, y)
            
    return magentaBorderPx

for fname in sorted(os.listdir(SAMPLE_DIR)):
    if not fname.lower().endswith(('.png', '.jpg', '.jpeg')):
        continue
    fpath = os.path.join(SAMPLE_DIR, fname)
    img = cv2.imread(fpath)
    if img is None: continue
    mag_px = simulate_js_canvas_check(img)
    is_fake = mag_px >= 50
    print(f"{'🚨 FAKE' if is_fake else '✅ REAL':10} | mag_px={mag_px:5} | {fname}")
