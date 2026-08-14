# -*- coding: utf-8 -*-
import os
import cv2
import numpy as np

SAMPLE_DIR = r"c:\Users\Chyle\OneDrive\Desktop\System\iskomats-dashboards-thesis-aclm-g3-master\iskomats-admins\TESTPYTHON\Samples\Her Samples"

def analyze_lighting_invariant_tampering(img):
    if img is None:
        return False, "Could not load image"
    
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV) if len(img.shape) == 3 else None
    
    # ── 1. Editor Canvas Border Check (Strict Chroma Mask) ─────────────────────
    if hsv is not None:
        m_top = hsv[:int(h * 0.06), :]
        m_left = hsv[:, :int(w * 0.06)]
        m_right = hsv[:, int(w * 0.94):]
        m_bot = hsv[int(h * 0.94):, :]
        
        mag_px = int(
            np.sum((m_top[:,:,0] >= 140) & (m_top[:,:,0] <= 170) & (m_top[:,:,1] >= 110) & (m_top[:,:,2] >= 70)) +
            np.sum((m_left[:,:,0] >= 140) & (m_left[:,:,0] <= 170) & (m_left[:,:,1] >= 110) & (m_left[:,:,2] >= 70)) +
            np.sum((m_right[:,:,0] >= 140) & (m_right[:,:,0] <= 170) & (m_right[:,:,1] >= 110) & (m_right[:,:,2] >= 70)) +
            np.sum((m_bot[:,:,0] >= 140) & (m_bot[:,:,0] <= 170) & (m_bot[:,:,1] >= 110) & (m_bot[:,:,2] >= 70))
        )
        if mag_px >= 300:
            return True, f"Editing canvas border detected ({mag_px} editor UI pixels at margins)."

    # ── 2. Illumination-Normalized Whiteout Patch Detection ────────────────────
    # Measure page noise stddev in non-text areas
    high_freq_noise = cv2.Laplacian(gray, cv2.CV_32F)
    page_noise_std = float(np.std(high_freq_noise[np.abs(high_freq_noise) < 25]))
    
    # If the document is a digital PDF export (page_noise_std <= 2.5), flat white areas are authentic vector fills
    if page_noise_std < 3.5:
        return False, "Authentic digital document (Clean vector/PDF format)"
        
    # For physical camera photos (page_noise_std >= 3.5):
    # Normalize illumination gradient locally
    blurred_bg = cv2.GaussianBlur(gray, (51, 51), 0).astype(np.float32) + 1e-5
    norm_illum = (gray.astype(np.float32) / blurred_bg) * 128.0
    norm_illum = np.clip(norm_illum, 0, 255).astype(np.uint8)
    
    bright_norm_mask = (norm_illum >= 145).astype(np.uint8) * 255
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 8))
    closed = cv2.morphologyEx(bright_norm_mask, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    suspicious_patches = 0
    for cnt in contours:
        x, y, bw, bh = cv2.boundingRect(cnt)
        area = bw * bh
        if area >= 300 and 40 <= bw <= (w * 0.85) and 10 <= bh <= (h * 0.20):
            patch_noise = high_freq_noise[y:y+bh, x:x+bw]
            patch_noise_std = float(np.std(patch_noise[np.abs(patch_noise) < 25])) if patch_noise.size > 0 else 1.0
            
            # Spliced whiteout box on camera photo has zero sensor noise (< 0.25 * page_noise_std)
            if patch_noise_std < (0.25 * page_noise_std):
                suspicious_patches += 1
                
    if suspicious_patches >= 2:
        return True, f"Digital whiteout / patch detected ({suspicious_patches} artificial flat patches found)."
        
    return False, "Authentic document"

for fname in sorted(os.listdir(SAMPLE_DIR)):
    if not fname.lower().endswith(('.png', '.jpg', '.jpeg')): continue
    fpath = os.path.join(SAMPLE_DIR, fname)
    img = cv2.imread(fpath)
    is_tampered, msg = analyze_lighting_invariant_tampering(img)
    print(f"{'🚨 TAMPERED' if is_tampered else '✅ AUTHENTIC':15} | {fname:25} | {msg}")
