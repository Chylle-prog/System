# -*- coding: utf-8 -*-
"""
Test all files in Her Samples directory to ensure authentic files pass and fake files fail.
"""
import os
import cv2
import numpy as np

SAMPLE_DIR = r"c:\Users\Chyle\OneDrive\Desktop\System\iskomats-dashboards-thesis-aclm-g3-master\iskomats-admins\TESTPYTHON\Samples\Her Samples"

def detect_editor_border_artifacts(img):
    h, w = img.shape[:2]
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    
    m_top = hsv[:int(h * 0.08), :]
    m_left = hsv[:, :int(w * 0.08)]
    m_right = hsv[:, int(w * 0.92):]
    m_bot = hsv[int(h * 0.92):, :]
    
    mag_count = (
        np.sum((m_top[:,:,0] >= 130) & (m_top[:,:,0] <= 175) & (m_top[:,:,1] >= 50) & (m_top[:,:,2] >= 30)) +
        np.sum((m_left[:,:,0] >= 130) & (m_left[:,:,0] <= 175) & (m_left[:,:,1] >= 50) & (m_left[:,:,2] >= 30)) +
        np.sum((m_right[:,:,0] >= 130) & (m_right[:,:,0] <= 175) & (m_right[:,:,1] >= 50) & (m_right[:,:,2] >= 30)) +
        np.sum((m_bot[:,:,0] >= 130) & (m_bot[:,:,0] <= 175) & (m_bot[:,:,1] >= 50) & (m_bot[:,:,2] >= 30))
    )
    return int(mag_count)

def detect_tamper_complete(img_bytes):
    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        return False, "Could not decode"
    
    # 1. Editor border check
    mag_px = detect_editor_border_artifacts(img)
    if mag_px >= 300:
        return True, f"Editing canvas border artifact detected ({mag_px} editor UI border pixels found at margins)."
    
    # 2. Whiteout check
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape[:2]
    paper_median = float(np.median(gray))
    pure_white_mask = (gray >= 238).astype(np.uint8) * 255
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (20, 10))
    closed = cv2.morphologyEx(pure_white_mask, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    for cnt in contours:
        x, y, bw, bh = cv2.boundingRect(cnt)
        area = bw * bh
        roi = gray[y:y+bh, x:x+bw]
        box_bg_pixels = roi[roi > 180]
        if len(box_bg_pixels) > 40:
            box_bg_mean = float(np.mean(box_bg_pixels))
            box_bg_std = float(np.std(box_bg_pixels))
        else:
            box_bg_mean = float(np.mean(roi))
            box_bg_std = float(np.std(roi))
        if area >= 200 and 30 <= bw <= (w * 0.95) and 8 <= bh <= (h * 0.25):
            contrast = box_bg_mean - paper_median
            if (box_bg_mean >= 236 and contrast >= 10.0) or (box_bg_mean >= 250 and box_bg_std < 3.0):
                return True, "Digital whiteout / patch detected."
                
    return False, "Authentic document"

for fname in sorted(os.listdir(SAMPLE_DIR)):
    if not fname.lower().endswith(('.png', '.jpg', '.jpeg')):
        continue
    fpath = os.path.join(SAMPLE_DIR, fname)
    with open(fpath, 'rb') as f:
        b = f.read()
    is_tampered, msg = detect_tamper_complete(b)
    status = "🚨 TAMPERED" if is_tampered else "✅ AUTHENTIC"
    print(f"{status:15} | {fname:25} | {msg}")
