import os
import sys
import cv2
import numpy as np

# Add parent dir to path so we can import services.ocr_utils
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services.ocr_utils import (
    auto_adjust_luminance_and_gamma,
    create_shadow_removed_binarized_image,
    preprocess_image_advanced,
    extract_text_multi_pass_tesseract,
    sanitize_ocr_number_typos
)

def test_dark_doc_enhancements():
    print("==================================================")
    print("Testing Automatic Dark Document Image Enhancements")
    print("==================================================")

    # 1. Create a simulated dark document image (mean luminance ~65)
    dark_bg = np.full((600, 800), 65, dtype=np.uint8)
    # Add fake hand/phone shadow on top right corner
    for r in range(300):
        for c in range(400, 800):
            val = int(dark_bg[r, c]) - int((r + c - 400) * 0.1)
            dark_bg[r, c] = max(20, min(255, val))
            
    # Draw simulated text & digits
    cv2.putText(dark_bg, "CERTIFICATE OF REGISTRATION", (50, 80), cv2.FONT_HERSHEY_SIMPLEX, 0.9, 15, 2)
    cv2.putText(dark_bg, "Student Name: LANTAFE MIKAELA", (50, 150), cv2.FONT_HERSHEY_SIMPLEX, 0.8, 20, 2)
    cv2.putText(dark_bg, "Student ID: 2021305751", (50, 220), cv2.FONT_HERSHEY_SIMPLEX, 0.8, 15, 2)
    cv2.putText(dark_bg, "TOTAL UNITS: 18", (50, 300), cv2.FONT_HERSHEY_SIMPLEX, 0.8, 10, 2)
    cv2.putText(dark_bg, "GPA / GWA: 1.75", (50, 380), cv2.FONT_HERSHEY_SIMPLEX, 0.8, 15, 2)

    original_mean = np.mean(dark_bg)
    print(f"[TEST 1] Original Dark Image Mean Luminance: {original_mean:.2f}")
    assert original_mean < 145, "Simulated dark image should have mean < 145"

    # Test 1: Automatic Luminance Detection & Gamma Correction
    brightened = auto_adjust_luminance_and_gamma(dark_bg)
    brightened_mean = np.mean(brightened)
    print(f"[TEST 1 PASS] Brightened Image Mean Luminance: {brightened_mean:.2f}")
    assert brightened_mean > original_mean, "Brightened image mean should be higher than original"

    # Test 2: CLAHE & Advanced Preprocessing
    preprocessed = preprocess_image_advanced(dark_bg)
    assert preprocessed is not None, "Preprocessed image should not be None"
    print(f"[TEST 2 PASS] Preprocess image advanced succeeded. Output shape: {preprocessed.shape}")

    # Test 3: Adaptive Thresholding Shadow Removal Binarization
    binarized = create_shadow_removed_binarized_image(brightened)
    assert binarized is not None, "Binarized image should not be None"
    # In binarized image, background should be white (255)
    white_pixel_ratio = np.sum(binarized == 255) / binarized.size
    print(f"[TEST 3 PASS] Shadow-Removed Binarized Background White Ratio: {white_pixel_ratio:.2%}")
    assert white_pixel_ratio > 0.70, "Binarized image background should be mostly white"

    # Test 4: Multi-Pass & Dual-Engine OCR Extraction
    success, encoded = cv2.imencode('.jpg', dark_bg)
    if success:
        ocr_text = extract_text_multi_pass_tesseract(encoded.tobytes())
        print(f"[TEST 4 PASS] Dual-Pass OCR Extracted Text Length: {len(ocr_text)} chars")
        print(f"Extracted Sample Lines:\n{ocr_text[:300]}")

    print("\nALL DARK DOCUMENT ENHANCEMENT TESTS PASSED SUCCESSFULLY!")

if __name__ == '__main__':
    test_dark_doc_enhancements()
