# -*- coding: utf-8 -*-
"""
Verification & Tamper Test:
1. Tampered COR (Name altered to 'ANA FRANCZESCA M. ARRIOLA')
2. Real COR ('cor_uncooperative' - authentic camera photo of MIKAELA YSABEL LANTAFE)
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
from services.ocr_utils import parse_cor_document, verify_cor_fields

# 1. OCR text from Image 1: Tampered COR
TAMPERED_COR_TEXT = """
OFFICIAL CERTIFICATE OF REGISTRATION
De La Salle Lipa
School Year Sem : AY 2026-2027 - 1st Semester
Student No : 2021305751
Name : ANA FRANCZESCA M. ARRIOLA
Year Level : 4th Year
Course : BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY
TOTAL UNITS : 12
"""

# 2. OCR text from Image 2: Authentic COR (cor_uncooperative)
REAL_COR_TEXT = """
OFFICIAL CERTIFICATE OF REGISTRATION
De La Salle Lipa
School Year Sem : AY 2026-2027 - 1st Semester
Student No : 2021305751
Name : LANTAFE, MIKAELA YSABEL LINATOC
Year Level : 4th Year
Course : BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY
TOTAL UNITS : 12
"""

# Synthesize the tampered image bytes (spliced name box)
def create_tampered_cor_bytes():
    w, h = 800, 1100
    img = np.ones((h, w, 3), dtype=np.uint8) * 245
    cv2.putText(img, "OFFICIAL CERTIFICATE OF REGISTRATION", (120, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (20, 100, 30), 2)
    cv2.putText(img, "De La Salle Lipa", (280, 80), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (40, 40, 40), 1)
    cv2.putText(img, "School Year Sem  : AY 2026-2027 - 1st Semester", (50, 140), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (30, 30, 30), 1)
    cv2.putText(img, "Student No       : 2021305751", (50, 170), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (30, 30, 30), 1)
    
    # Spliced white rectangle over original name
    cv2.rectangle(img, (160, 185), (600, 215), (255, 255, 255), -1)
    cv2.putText(img, "Name             : ANA FRANCZESCA M. ARRIOLA", (50, 205), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 2)
    
    cv2.putText(img, "Year Level       : 4th Year", (50, 240), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (30, 30, 30), 1)
    cv2.putText(img, "Course           : BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY", (50, 270), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (30, 30, 30), 1)
    cv2.putText(img, "TOTAL UNITS      : 12", (50, 350), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (30, 30, 30), 1)
    
    _, enc = cv2.imencode('.jpg', img, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
    return enc.tobytes()

# Synthesize real camera photo bytes (cor_uncooperative)
def create_authentic_cor_uncooperative_bytes():
    w, h = 800, 1100
    y, x = np.mgrid[0:h, 0:w]
    lighting = 240 - 25 * (x / w) - 15 * (y / h)
    img = np.repeat(lighting[:, :, np.newaxis], 3, axis=2).astype(np.uint8)
    noise = np.random.normal(0, 3, (h, w, 3)).astype(np.int16)
    img = np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    
    cv2.putText(img, "OFFICIAL CERTIFICATE OF REGISTRATION", (120, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (20, 100, 30), 2)
    cv2.putText(img, "De La Salle Lipa", (280, 80), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (40, 40, 40), 1)
    cv2.putText(img, "School Year Sem  : AY 2026-2027 - 1st Semester", (50, 140), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (30, 30, 30), 1)
    cv2.putText(img, "Student No       : 2021305751", (50, 170), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (30, 30, 30), 1)
    cv2.putText(img, "Name             : LANTAFE, MIKAELA YSABEL LINATOC", (50, 200), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (30, 30, 30), 1)
    cv2.putText(img, "Year Level       : 4th Year", (50, 240), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (30, 30, 30), 1)
    cv2.putText(img, "Course           : BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY", (50, 270), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (30, 30, 30), 1)
    cv2.putText(img, "TOTAL UNITS      : 12", (50, 350), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (30, 30, 30), 1)
    
    _, enc = cv2.imencode('.jpg', img, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
    return enc.tobytes()

def test_scenario(title, ocr_text, image_bytes, first_name, middle_name, last_name, id_no, expected_success):
    print(f"\n{'='*70}")
    print(f"  {title}")
    print(f"  Expected OCR Result: {'✅ VERIFIED (PASS)' if expected_success else '❌ REJECTED / MISMATCH (FAIL)'}")
    print(f"{'='*70}")
    
    # 1. OCR Field Verification
    parsed = parse_cor_document(ocr_text)
    success, msg, meta = verify_cor_fields(
        parsed, ocr_text,
        first_name=first_name, middle_name=middle_name, last_name=last_name,
        expected_id_no=id_no, expected_course="BSIT",
        expected_academic_year="AY 2026-2027", expected_semester="1st Sem"
    )
    
    print(f"  [OCR Field Extraction]")
    print(f"    Extracted Name:       {parsed.get('name')}")
    print(f"    Extracted Student No: {parsed.get('student_id')}")
    print(f"    Extracted AY / Sem:   {parsed.get('school_year_sem')}")
    print(f"    Verification Status:  {'✅ PASSED' if success else '❌ FAILED'}")
    print(f"    Message:              {msg}")
    
    # 2. Security & Forensic Audit
    audit = run_full_security_audit(
        image_bytes, doc_type="Certificate of Registration",
        success=success, message=msg, meta=meta or {}
    )
    
    ela = audit['audit']['ela']
    recapture = audit['audit']['recapture']
    ai_gen = audit['audit']['ai_generated']
    flagged = audit['security_flagged']
    rec = audit['recommendation']
    
    print(f"\n  [Forensic & Security Audit]")
    print(f"    ELA Digital Splicing:  {'🚨 SPLICING DETECTED' if ela.get('suspicious') else 'Clean (Uniform Compression)'} (Score: {ela.get('ela_score')}%)")
    print(f"    Screen Recapture Moiré: {'🚨 RECAPTURED' if recapture.get('recaptured') else 'Clean (Direct Photo/Scan)'}")
    print(f"    AI Generated Risk:      {'🚨 HIGH' if ai_gen.get('is_ai_generated') else 'Low'} ({ai_gen.get('details')})")
    print(f"    Security Flagged:       {'🚨 YES' if flagged else '✅ NO'}")
    
    print(f"\n  [AI Reviewer Recommendation]")
    for line in rec.split('\n'):
        print(f"    {line}")
        
    correct = (success == expected_success)
    print(f"\n  >> OVERALL VERDICT: {'[PASS] SYSTEM BEHAVED CORRECTLY' if correct else '[FAIL] UNEXPECTED RESULT'}")
    return correct

def main():
    print("="*70)
    print("  VERIFICATION AUDIT: TAMPERED COR VS REAL COR (cor_uncooperative)")
    print("="*70)
    
    # Test 1: Real COR (cor_uncooperative) submitted by rightful student (Mikaela Lantefe)
    real_bytes = create_authentic_cor_uncooperative_bytes()
    test_scenario(
        title="TEST 1: Real COR ('cor_uncooperative') - Mikaela Lantefe (ID: 2021305751)",
        ocr_text=REAL_COR_TEXT,
        image_bytes=real_bytes,
        first_name="MIKAELA YSABEL", middle_name="LINATOC", last_name="LANTAFE",
        id_no="2021305751",
        expected_success=True
    )
    
    # Test 2: Tampered COR (Altered to Ana Arriola) submitted by rightful student (Mikaela Lantefe)
    tampered_bytes = create_tampered_cor_bytes()
    test_scenario(
        title="TEST 2: Tampered COR submitted under Mikaela Lantefe Profile",
        ocr_text=TAMPERED_COR_TEXT,
        image_bytes=tampered_bytes,
        first_name="MIKAELA YSABEL", middle_name="LINATOC", last_name="LANTAFE",
        id_no="2021305751",
        expected_success=False
    )
    
    # Test 3: Tampered COR submitted under Ana Arriola Profile
    test_scenario(
        title="TEST 3: Tampered COR submitted under Ana Arriola Profile (ID 2021305751 mismatch)",
        ocr_text=TAMPERED_COR_TEXT,
        image_bytes=tampered_bytes,
        first_name="ANA FRANCZESCA", middle_name="M.", last_name="ARRIOLA",
        id_no="2022409999", # Ana's actual ID in database
        expected_success=False
    )
    
    print("\n" + "="*70)
    print("  ALL COR TAMPER & AUTHENTICITY TESTS FINISHED")
    print("="*70)

if __name__ == '__main__':
    main()
