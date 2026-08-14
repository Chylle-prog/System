import os
import cv2
import numpy as np

SAMPLE_DIR = r"c:\Users\Chyle\OneDrive\Desktop\System\iskomats-dashboards-thesis-aclm-g3-master\iskomats-admins\TESTPYTHON\Samples\Her Samples"

def js_rgb_check(rgb):
    h, w = rgb.shape[:2]
    topH = int(h * 0.06)
    leftW = int(w * 0.06)
    rightX = int(w * 0.94)
    botY = int(h * 0.94)
    
    magentaBorderPx = 0
    def checkMarginPx(x, y):
        nonlocal magentaBorderPx
        r, g, b = int(rgb[y, x, 0]), int(rgb[y, x, 1]), int(rgb[y, x, 2])
        # Strict vivid magenta / editor crop handle (high red + blue, low green)
        if r >= 120 and b >= 80 and g <= 80 and (r - g) >= 55 and (b - g) >= 35:
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
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    mag_px = js_rgb_check(rgb)
    print(f"{fname:25} | JS Magenta Px: {mag_px:5} -> {'🚨 FAKE' if mag_px >= 50 else '✅ AUTHENTIC'}")
