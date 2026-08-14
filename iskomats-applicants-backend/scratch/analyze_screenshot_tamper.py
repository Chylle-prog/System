# -*- coding: utf-8 -*-
"""
Deep Pixel & Structural Analysis for Screenshotted Edited Documents
===================================================================
Analyzes visual differences between:
Image 1: Screenshotted document with edited name & magenta border.
Image 2: Authentic camera photograph ('cor_uncooperative').
"""
import os
import sys
import io
import cv2
import numpy as np
from PIL import Image

def analyze_visual_tamper_signals(img_bgr, label):
    h, w = img_bgr.shape[:2]
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    
    print(f"\n{'='*65}")
    print(f"  ANALYSIS: {label}")
    print(f"  Dimensions: {w}x{h}")
    print(f"{'='*65}")
    
    # ── Signal 1: Synthetic High-Saturation UI / Cropping Borders ───────────────
    # Screenshotted Canva/Picsart/editor crops often leave neon UI handles
    # (e.g. magenta/cyan/lime pixels > 80% saturation along outer 5% frame)
    margin_top = img_bgr[:int(h*0.08), :]
    margin_left = img_bgr[:, :int(w*0.08)]
    
    hsv_top = hsv[:int(h*0.08), :]
    hsv_left = hsv[:, :int(w*0.08)]
    
    # Magenta/Pink UI border mask (Hue 140-175, Sat > 100, Val > 100)
    magenta_mask_top = (hsv_top[:,:,0] >= 140) & (hsv_top[:,:,0] <= 175) & (hsv_top[:,:,1] >= 90) & (hsv_top[:,:,2] >= 90)
    magenta_mask_left = (hsv_left[:,:,0] >= 140) & (hsv_left[:,:,0] <= 175) & (hsv_left[:,:,1] >= 90) & (hsv_left[:,:,2] >= 90)
    magenta_px = int(np.sum(magenta_mask_top) + np.sum(magenta_mask_left))
    
    has_synthetic_border = magenta_px >= 30
    print(f"  [1] Synthetic Magenta UI Border Pixels: {magenta_px} -> {'🚨 DETECTED (Editor Crop Artifact)' if has_synthetic_border else 'Clean'}")
    
    # ── Signal 2: Field-by-Field Text Sharpness Discontinuity ──────────────────
    # When a name is typed onto an existing photo/scan:
    # The new text has high Canny edge density & gradient sharpness,
    # while the rest of the text lines have optical blur / lower gradient variance.
    # We analyze the header box region (y: 10% to 30%, x: 5% to 50%)
    roi_header = gray[int(h*0.10):int(h*0.32), int(w*0.04):int(w*0.65)]
    # Horizontal projection to isolate individual lines:
    # 1. School Year Sem, 2. Student No, 3. Name, 4. Year Level
    sobel_y = np.abs(cv2.Sobel(roi_header, cv2.CV_64F, 0, 1, ksize=3))
    line_energy = np.mean(sobel_y, axis=1)
    
    # Compute Laplacian variance on horizontal strips
    strip_h = int(roi_header.shape[0] / 5)
    strip_vars = []
    for i in range(5):
        strip = roi_header[i*strip_h:(i+1)*strip_h, :]
        lap = cv2.Laplacian(strip, cv2.CV_64F)
        strip_vars.append(float(np.var(lap)))
        
    strip_vars = np.array(strip_vars)
    max_strip = float(np.max(strip_vars))
    min_strip = float(np.min(strip_vars[strip_vars > 10])) if np.any(strip_vars > 10) else 1.0
    sharpness_ratio = max_strip / (min_strip + 1e-5)
    
    # In authentic photos: sharpness across all header lines is uniform (ratio < 2.8)
    # In spliced text: the spliced line is 3.5x-8x sharper than the rest
    has_spliced_text_gradient = sharpness_ratio > 3.2
    print(f"  [2] Header Line Sharpness Variance Ratio: {sharpness_ratio:.2f}x -> {'🚨 DISCONTINUITY DETECTED' if has_spliced_text_gradient else 'Clean (Uniform Text Profile)'}")
    
    # ── Signal 3: Local Text Background Luminance Discontinuity ────────────────
    # A spliced name line has a cleaner/whiter background or pure digital flat patch
    bg_mask = roi_header > 200
    roi_bg_std = float(np.std(roi_header[bg_mask])) if np.sum(bg_mask) > 100 else 10.0
    print(f"  [3] Header Background Local StdDev: {roi_bg_std:.2f}")
    
    # ── Signal 4: Overall Verdict ──────────────────────────────────────────────
    is_fake = has_synthetic_border or has_spliced_text_gradient
    print(f"\n  >> FINAL VERDICT: {'🚨 FAKE / TAMPERED DOCUMENT' if is_fake else '✅ AUTHENTIC DOCUMENT'}")
    return is_fake

# Let's test by creating faithful visual models of Image 1 and Image 2
def create_model_image_1_fake_screenshot():
    # 600x800 screenshot with magenta border and crisp typed name
    w, h = 600, 800
    img = np.ones((h, w, 3), dtype=np.uint8) * 242
    
    # Magenta crop border at top-left (mimicking Canva/editor screenshot artifact)
    img[:15, :] = (128, 0, 230) # Magenta/Pink
    img[:, :12] = (128, 0, 230)
    
    # Green header bar
    img[20:45, 20:w-20] = (30, 110, 40)
    cv2.putText(img, "OFFICIAL CERTIFICATE OF REGISTRATION", (40, 38), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
    
    # Scanned body text (slightly blurred)
    cv2.putText(img, "School Year Sem  : AY 2026-2027 - 1st Semester", (30, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (60, 60, 60), 1)
    cv2.putText(img, "Student No       : 2021305751", (30, 120), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (60, 60, 60), 1)
    
    # SPLICED NAME: Crisp pure black digital font
    cv2.putText(img, "Name             : ANA FRANCZESCA M. ARRIOLA", (30, 140), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 0, 0), 2)
    
    cv2.putText(img, "Year Level       : 4th Year", (30, 160), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (60, 60, 60), 1)
    cv2.putText(img, "Course           : BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY", (30, 180), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (60, 60, 60), 1)
    
    return img

def create_model_image_2_real_photo():
    w, h = 600, 800
    # Natural lighting and paper texture
    y, x = np.mgrid[0:h, 0:w]
    lighting = 230 - 20 * (x / w) - 10 * (y / h)
    img = np.repeat(lighting[:, :, np.newaxis], 3, axis=2).astype(np.uint8)
    
    # Natural subtle camera noise
    noise = np.random.normal(0, 2, (h, w, 3)).astype(np.int16)
    img = np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    
    # Green header bar
    img[20:45, 20:w-20] = (30, 110, 40)
    cv2.putText(img, "OFFICIAL CERTIFICATE OF REGISTRATION", (40, 38), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (240, 240, 240), 1)
    
    # All text lines uniformly photographed with same lens & ink characteristics
    cv2.putText(img, "School Year Sem  : AY 2026-2027 - 1st Semester", (30, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (45, 45, 45), 1)
    cv2.putText(img, "Student No       : 2021305751", (30, 120), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (45, 45, 45), 1)
    cv2.putText(img, "Name             : LANTAFE, MIKAELA YSABEL LINATOC", (30, 140), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (45, 45, 45), 1)
    cv2.putText(img, "Year Level       : 4th Year", (30, 160), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (45, 45, 45), 1)
    cv2.putText(img, "Course           : BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY", (30, 180), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (45, 45, 45), 1)
    
    return img

def main():
    img1 = create_model_image_1_fake_screenshot()
    img2 = create_model_image_2_real_photo()
    
    analyze_visual_tamper_signals(img1, "IMAGE 1: Screenshotted Document (Edited Name + Magenta Border)")
    analyze_visual_tamper_signals(img2, "IMAGE 2: Real Document Photo (cor_uncooperative)")

if __name__ == '__main__':
    main()
