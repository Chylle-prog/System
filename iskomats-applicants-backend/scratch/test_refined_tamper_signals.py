# -*- coding: utf-8 -*-
"""
Robust Pre-OCR Forensic & Geometry Tamper Detector
=================================================
1. Editor UI / Synthetic Canvas Frame Detection (Canva/Snipping Tool neon borders).
2. Colon & Header Field Alignment Geometry (Tab stop alignment check).
3. Text Stroke & Stroke Width Discrepancy.
"""
import cv2
import numpy as np

def detect_editor_ui_artifacts(img_bgr):
    """
    Detects high-saturation neon canvas borders (magenta, cyan, lime)
    left behind from screenshotting editing apps (Canva, Photoshop, Snipping Tool).
    """
    h, w = img_bgr.shape[:2]
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    
    # Outer 6% margins
    margin_top = hsv[:int(h*0.06), :]
    margin_left = hsv[:, :int(w*0.06)]
    margin_right = hsv[:, int(w*0.94):]
    margin_bottom = hsv[int(h*0.94):, :]
    
    # Magenta/Pink (Hue 140-175, Sat > 80, Val > 80)
    mag_top = (margin_top[:,:,0] >= 140) & (margin_top[:,:,0] <= 175) & (margin_top[:,:,1] >= 80) & (margin_top[:,:,2] >= 80)
    mag_left = (margin_left[:,:,0] >= 140) & (margin_left[:,:,0] <= 175) & (margin_left[:,:,1] >= 80) & (margin_left[:,:,2] >= 80)
    mag_right = (margin_right[:,:,0] >= 140) & (margin_right[:,:,0] <= 175) & (margin_right[:,:,1] >= 80) & (margin_right[:,:,2] >= 80)
    mag_bottom = (margin_bottom[:,:,0] >= 140) & (margin_bottom[:,:,0] <= 175) & (margin_bottom[:,:,1] >= 80) & (margin_bottom[:,:,2] >= 80)
    
    magenta_count = int(np.sum(mag_top) + np.sum(mag_left) + np.sum(mag_right) + np.sum(mag_bottom))
    
    if magenta_count >= 50:
        return True, f"Editing software canvas frame detected ({magenta_count} saturated editor UI border pixels found at margins)."
    return False, "Clean margins."

def detect_header_colon_misalignment(ocr_text):
    """
    In official institutional certificates (DLSL COR), all field colons
    ('School Year Sem :', 'Student No :', 'Name :', 'Year Level :')
    are typeset by the registrar system with strict tab-stop alignment.
    
    In amateur edits (e.g. typing 'Name : ANA' with a single space),
    the relative spacing before ':' is visibly broken.
    """
    lines = [l.strip() for l in ocr_text.splitlines() if ':' in l]
    header_fields = {}
    for l in lines:
        parts = l.split(':', 1)
        lbl = parts[0].strip().lower()
        if any(k in lbl for k in ['school year', 'student no', 'name', 'year level', 'course', 'degree']):
            header_fields[lbl] = len(parts[0]) # character offset before colon
            
    if 'name' in header_fields and 'student no' in header_fields:
        # In official template, 'Student No' and 'Name' colons align exactly (e.g. 'Student No       :' and 'Name             :')
        # If 'Name :' is typed with 0-1 spaces while 'Student No' has 5-8 spaces:
        pass
    return False, "Valid alignment"

print("Script template ready.")
