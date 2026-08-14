# -*- coding: utf-8 -*-
import os
import cv2
import numpy as np

SAMPLE_DIR = r"c:\Users\Chyle\OneDrive\Desktop\System\iskomats-dashboards-thesis-aclm-g3-master\iskomats-admins\TESTPYTHON\Samples\Her Samples"

def detect_document_tampering_final(img):
    if img is None: return False, "No image"
    h, w = img.shape[:2]
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV) if len(img.shape) == 3 else None
    
    # ── Strict Editor Canvas & Cropping Border Detector ─────────────────────────
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
            return True, f"Editing canvas border artifact detected ({mag_px} editor UI border pixels found at margins). Please upload an authentic, unedited document."

    return False, "Authentic document (No digital tampering detected)"

for fname in sorted(os.listdir(SAMPLE_DIR)):
    if not fname.lower().endswith(('.png', '.jpg', '.jpeg')): continue
    fpath = os.path.join(SAMPLE_DIR, fname)
    img = cv2.imread(fpath)
    is_tampered, msg = detect_document_tampering_final(img)
    print(f"{'🚨 TAMPERED' if is_tampered else '✅ AUTHENTIC':15} | {fname:25} | {msg}")
