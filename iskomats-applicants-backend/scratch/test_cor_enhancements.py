import os
import sys
import cv2
import numpy as np

# Ensure backend root is in path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services.ocr_utils import (
    sanitize_ocr_number_typos,
    enhance_cor_document_super_resolution,
    extract_cor_roi_crops,
    extract_total_units_from_text,
    parse_cor_document,
    verify_cor_fields
)

def test_ocr_typo_sanitizer():
    print("Testing 1. OCR Typo Sanitizer for Small Numbers/Letters:")
    assert sanitize_ocr_number_typos("TOTAL UNITS : 1B") == "TOTAL UNITS : 18"
    assert sanitize_ocr_number_typos("TOTAL UNITS : 2O") == "TOTAL UNITS : 20"
    assert sanitize_ocr_number_typos("TOTAL UNITS : 1S") == "TOTAL UNITS : 15"
    assert sanitize_ocr_number_typos("Student No : 20213O5751") == "Student No : 2021305751"
    assert sanitize_ocr_number_typos("Reg No : 20213I5751") == "Reg No : 2021315751"
    assert sanitize_ocr_number_typos("TOTAL UNITS : 0B") == "TOTAL UNITS : 08"
    print("  [OK] Typo Sanitizer Tests Passed Successfully!")

def test_dynamic_subject_units_summing():
    print("\nTesting 2. Dynamic Subject Table Units Summing:")
    # Case A: Printed Total Units missed/unclear, but subject table is present
    cor_table_text = """
    OFFICIAL CERTIFICATE OF REGISTRATION
    De La Salle Lipa
    Name : LANTAFE, MIKAELA YSABEL
    Student No : 2021305751
    
    SUBJECTS ENROLLED:
    IT101   Introduction to Computing     3.0
    IT102   Computer Programming 1       3.0
    IT103   Data Structures & Algo        3.0
    IT104   Database Management System    3.0
    IT105   Web Development              3.0
    
    TOTAL ASSESSMENT : 25,000.00
    """
    total_units = extract_total_units_from_text(cor_table_text)
    print(f"  Extracted Dynamic Subject Table Sum Units: {total_units}")
    assert total_units == 15, f"Expected 15 units, got {total_units}"

    # Case B: Printed Total Units misread as "2" (e.g. colon merged with 1 in ': 12')
    cor_misread_text = """
    OFFICIAL CERTIFICATE OF REGISTRATION
    Student No : 2021305751
    Name : LANTAFE, MIKAELA YSABEL
    TOTAL UNITS : 2
    
    SUBJECTS ENROLLED:
    IT101   Intro to Computing    3
    IT102   Programming 1        3
    IT103   Data Structures       3
    IT104   Web Development       3
    """
    total_units_override = extract_total_units_from_text(cor_misread_text)
    print(f"  Extracted Units after Discrepancy Override (<6): {total_units_override}")
    assert total_units_override == 12, f"Expected 12 units after override, got {total_units_override}"
    print("  [OK] Dynamic Subject Table Units Summing Passed Successfully!")

def test_super_resolution_and_roi_crops():
    print("\nTesting 3. Super-Resolution & ROI Header/Footer Crops:")
    # Create a synthetic low-res document image
    img = np.ones((600, 800, 3), dtype=np.uint8) * 245
    cv2.putText(img, "OFFICIAL CERTIFICATE OF REGISTRATION", (50, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
    cv2.putText(img, "Name : LANTAFE, MIKAELA YSABEL", (50, 120), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)
    cv2.putText(img, "TOTAL UNITS : 18", (50, 480), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)
    
    success, encoded = cv2.imencode('.jpg', img)
    assert success
    img_bytes = encoded.tobytes()

    enhanced_bytes, enhanced_cv = enhance_cor_document_super_resolution(img_bytes, scale_factor=3.5)
    assert enhanced_cv is not None
    print(f"  Original size: 800x600 -> Enhanced Super-Resolution size: {enhanced_cv.shape[1]}x{enhanced_cv.shape[0]}")
    assert enhanced_cv.shape[1] >= 2800

    header_crop, footer_crop = extract_cor_roi_crops(enhanced_cv)
    assert header_crop is not None
    assert footer_crop is not None
    print("  [OK] Super-Resolution & ROI Header/Footer Crops Passed Successfully!")

def test_end_to_end_cor_verification():
    print("\nTesting 4. End-to-End COR Verification Pipeline:")
    sample_raw = """
    OFFICIAL CERTIFICATE OF REGISTRATION
    De La Salle Lipa
    School Year Sem : AY 2026-2027 - 1st Semester
    Student No : 20213O5751
    Name : LANTAFE, MIKAELA YSABEL LINATOC
    Year Level : 4th Year
    Course : BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY
    TOTAL UNITS : 1B
    """
    parsed = parse_cor_document(sample_raw)
    print("  Parsed Fields from noisy COR text:", parsed)
    assert parsed.get('student_id') == "2021305751"
    assert parsed.get('units') == 18

    success, msg, meta = verify_cor_fields(
        parsed, sample_raw,
        first_name="MIKAELA YSABEL", middle_name="LINATOC", last_name="LANTAFE",
        expected_id_no="2021305751", expected_course="BSIT",
        expected_academic_year="AY 2026-2027", expected_semester="1st Sem"
    )
    print(f"  Verification Result: Success={success}, Message='{msg}'")
    assert success, f"Verification failed: {msg}"
    print("  [OK] End-to-End COR Verification Passed Successfully!")

if __name__ == '__main__':
    test_ocr_typo_sanitizer()
    test_dynamic_subject_units_summing()
    test_super_resolution_and_roi_crops()
    test_end_to_end_cor_verification()
    print("\nALL STEP 3 COR VERIFICATION ENHANCEMENT TESTS PASSED PERFECTLY!")
