# -*- coding: utf-8 -*-
"""
Local Block ELA & Patch Splicing Detector Experiment
===================================================
Tests localized block-based ELA against whole-image global ELA
to detect single-field alterations (like changing only the student name).
"""
import io
import numpy as np
import cv2
from PIL import Image, ImageChops

def create_tampered_test_image():
    # Base: Natural shaded paper background with JPEG compression artifacts
    w, h = 800, 1000
    y, x = np.mgrid[0:h, 0:w]
    bg = 235 - 20 * (x / w) - 15 * (y / h)
    img = np.repeat(bg[:, :, np.newaxis], 3, axis=2).astype(np.uint8)
    
    # Original text
    cv2.putText(img, "OFFICIAL CERTIFICATE OF REGISTRATION", (120, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (20, 100, 30), 2)
    cv2.putText(img, "Student No       : 2021305751", (50, 170), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (30, 30, 30), 1)
    cv2.putText(img, "Name             : LANTAFE, MIKAELA YSABEL LINATOC", (50, 210), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (30, 30, 30), 1)
    cv2.putText(img, "Year Level       : 4th Year", (50, 250), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (30, 30, 30), 1)
    
    # Compress once to simulate original photo JPEG
    _, enc = cv2.imencode('.jpg', img, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
    orig_decompressed = cv2.imdecode(enc, cv2.IMREAD_COLOR)
    
    # SPLICING ATTACK:
    # A fraudster opens this JPEG in Paint/Photoshop, pastes a whiteout box over Name,
    # types 'ANA FRANCZESCA M. ARRIOLA', and saves as a new JPEG.
    spliced = orig_decompressed.copy()
    cv2.rectangle(spliced, (180, 195), (620, 225), (255, 255, 255), -1) # Flat white box
    cv2.putText(spliced, "ANA FRANCZESCA M. ARRIOLA", (185, 215), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 2)
    
    _, enc_spliced = cv2.imencode('.jpg', spliced, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
    return enc.tobytes(), enc_spliced.tobytes()

def analyze_block_ela(raw_bytes, label):
    orig = Image.open(io.BytesIO(raw_bytes)).convert('RGB')
    buffer = io.BytesIO()
    orig.save(buffer, 'JPEG', quality=95)
    buffer.seek(0)
    recompressed = Image.open(buffer).convert('RGB')
    
    ela_diff = ImageChops.difference(orig, recompressed)
    ela_arr = np.array(ela_diff, dtype=np.float32)
    ela_gray = np.mean(ela_arr, axis=2) # 2D error map
    
    h, w = ela_gray.shape
    block_size = 32
    block_means = []
    block_stds = []
    
    for by in range(0, h - block_size, block_size):
        for bx in range(0, w - block_size, block_size):
            blk = ela_gray[by:by+block_size, bx:bx+block_size]
            block_means.append(np.mean(blk))
            block_stds.append(np.std(blk))
            
    block_means = np.array(block_means)
    block_stds = np.array(block_stds)
    
    median_mean = float(np.median(block_means))
    max_mean = float(np.max(block_means))
    mean_discrepancy = max_mean / (median_mean + 1e-5)
    
    median_std = float(np.median(block_stds))
    max_std = float(np.max(block_stds))
    std_discrepancy = max_std / (median_std + 1e-5)
    
    # Splicing creates localized outlier blocks with > 3.0x higher error density
    suspicious = (mean_discrepancy > 3.2 or std_discrepancy > 3.5) and (max_mean > 8.0)
    score = round(min(100.0, max(0.0, (mean_discrepancy - 1.5) * 35.0)), 2)
    
    print(f"\n{label}:")
    print(f"  Global ELA Mean:        {np.mean(ela_gray):.2f}")
    print(f"  Median Block Error:     {median_mean:.2f}")
    print(f"  Max Spliced Block Error:{max_mean:.2f}")
    print(f"  Block Error Ratio:      {mean_discrepancy:.2f}x (Threshold: 3.2x)")
    print(f"  Localized Splicing Flag:{'🚨 DETECTED' if suspicious else '✅ CLEAN'}")
    print(f"  Tamper Risk Score:      {score}%")
    return suspicious

orig_b, spliced_b = create_tampered_test_image()
analyze_block_ela(orig_b, "1. Authentic Camera/Scan Document")
analyze_block_ela(spliced_b, "2. Spliced Name Field Document (Ana Arriola alteration)")
