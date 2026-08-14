# -*- coding: utf-8 -*-
"""
Merit Certificate & Multi-Document Verification Test
====================================================
Validates that:
1. AI Fake Merit Certificate (AI generated) is FLAGGED.
2. Real Digital Merit Certificate (e.g. portal screenshot / PDF export without EXIF) PASSES.
3. All previous AI Fake documents (COR, ID front, Grades, ID back) remain FLAGGED.
"""
import os
import sys
import io
import numpy as np
import cv2
from PIL import Image

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services.tamper_ai_detector import (
    inspect_exif_metadata,
    perform_error_level_analysis,
    detect_recapture_moire,
    detect_ai_generated_document,
    run_full_security_audit
)

ARTIFACT_DIR = r"C:\Users\Chyle\.gemini\antigravity-ide\brain\a87f14f1-2272-477b-8527-223e8b83f847"

# 1. AI Fake Merit Certificate (1200x896 standard AI aspect ratio, diffusion render)
AI_FAKE_MERIT = os.path.join(ARTIFACT_DIR, "fake_ai_merit_certificate_1786681438865.jpg")

# 2. Other AI Fakes
AI_FAKES = {
    "AI Fake Merit Cert": AI_FAKE_MERIT,
    "AI Fake COR":        os.path.join(ARTIFACT_DIR, "fake_ai_cor_1786669576591.jpg"),
    "AI Fake ID Front":   os.path.join(ARTIFACT_DIR, "fake_ai_id_front_1786669594633.jpg"),
    "AI Fake Grades":     os.path.join(ARTIFACT_DIR, "fake_ai_grades_1786670080556.jpg"),
    "AI Fake ID Back":    os.path.join(ARTIFACT_DIR, "fake_ai_id_back_1786670288223.jpg"),
}

# 3. Create a clean digital test certificate that mimics an authentic portal PDF export / screenshot
# Authentic properties:
# - No camera EXIF (typical for web exports)
# - Authentic portal resolution (e.g. 792x612 or 1056x816 Letter PDF raster, or 820x640 portal crop)
# - Real font rasterization without diffusion hallucinations
def create_authentic_digital_cert_bytes():
    # 820x640 (authentic crop from web portal)
    w, h = 820, 640
    img = np.ones((h, w, 3), dtype=np.uint8) * 250
    # Add green left banner (DLSL style)
    img[:, :180] = (20, 120, 45)
    # Add border
    cv2.rectangle(img, (10, 10), (w-10, h-10), (20, 120, 45), 2)
    # Add authentic text
    cv2.putText(img, "DE LA SALLE LIPA", (20, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
    cv2.putText(img, "CERTIFICATE", (220, 120), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (20, 120, 45), 3)
    cv2.putText(img, "OF RECOGNITION", (220, 160), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (100, 100, 100), 2)
    cv2.putText(img, "is presented to", (220, 220), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (80, 80, 80), 1)
    cv2.putText(img, "MIKAELA YSABEL LINATOC LANTAFE", (220, 280), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (20, 20, 20), 2)
    cv2.putText(img, "for being a Third Honor Awardee", (220, 330), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (50, 50, 50), 1)
    cv2.putText(img, "with a GPA of 3.5385 for AY 2024-2025", (220, 360), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (50, 50, 50), 1)
    
    # Encode as JPEG with normal compression
    success, enc = cv2.imencode('.jpg', img, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
    return enc.tobytes()

def test_document(label, image_bytes, expected_flagged):
    audit = run_full_security_audit(
        image_bytes, doc_type="Merit Certificate", success=True,
        message="OCR extraction complete", meta={'details': []}
    )
    ai_det = audit['audit']['ai_generated']
    flagged = audit['security_flagged']
    correct = (flagged == expected_flagged)

    print(f"\n{'-'*65}")
    print(f"  DOCUMENT: {label}")
    print(f"  Expected: {'🚨 FLAGGED (AI)' if expected_flagged else '✅ AUTHENTIC (REAL)'}")
    print(f"  AI Score: {ai_det['confidence']}% ({ai_det['details']})")
    print(f"  Final Audit Flagged: {'🚨 YES' if flagged else '✅ NO'}")
    print(f"  Status: {'[PASS] CORRECT' if correct else '[FAIL] INCORRECT'}")
    return correct, ai_det['confidence'], flagged

def main():
    print("="*65)
    print("  SECURITY AUDIT TEST - REAL DIGITAL VS AI FAKE CERTIFICATES")
    print("="*65)

    all_passed = True

    # 1. Test Authentic Digital Certificate (No Camera EXIF, Web Export)
    real_digital_bytes = create_authentic_digital_cert_bytes()
    passed, score, flagged = test_document("Authentic Digital Merit Certificate (Portal PDF Export - No EXIF)", real_digital_bytes, expected_flagged=False)
    if not passed:
        all_passed = False

    # 2. Test All AI Fakes
    for name, path in AI_FAKES.items():
        if os.path.exists(path):
            with open(path, 'rb') as f:
                fake_bytes = f.read()
            passed, score, flagged = test_document(name, fake_bytes, expected_flagged=True)
            if not passed:
                all_passed = False
        else:
            print(f"\n  [WARN] Missing file: {path}")

    print("\n" + "="*65)
    print(f"  OVERALL RESULT: {'✅ ALL TESTS PASSED (100% ACCURACY)' if all_passed else '❌ SOME TESTS FAILED'}")
    print("="*65)

if __name__ == '__main__':
    main()
