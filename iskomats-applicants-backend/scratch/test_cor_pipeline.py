import os
import sys

# Ensure backend root is in path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services.ocr_utils import normalize_course_string, parse_cor_document, verify_cor_fields

def test_alias_normalizers():
    print("Testing Course Alias Normalizer:")
    assert normalize_course_string("BSIT") == "BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY"
    assert normalize_course_string("BS CS") == "BACHELOR OF SCIENCE IN COMPUTER SCIENCE"
    assert normalize_course_string("BSA") == "BACHELOR OF SCIENCE IN ACCOUNTANCY"
    print("  [OK] Course Alias Normalization Passed!")

def test_cor_field_verification():
    sample_text = """
    OFFICIAL CERTIFICATE OF REGISTRATION
    De La Salle Lipa
    School Year Sem : AY 2026-2027 - 1st Semester
    Student No : 2021305751
    Name : LANTAFE, MIKAELA YSABEL LINATOC
    Year Level : 4th Year
    Course : BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY
    TOTAL UNITS : 12
    """
    parsed = parse_cor_document(sample_text)
    print("Parsed Fields:", parsed)
    
    # Test strict matching with abbreviated student input ("BSIT")
    success, msg, meta = verify_cor_fields(
        parsed, sample_text,
        first_name="MIKAELA YSABEL", middle_name="LINATOC", last_name="LANTAFE",
        expected_id_no="2021305751", expected_course="BSIT",
        expected_academic_year="AY 2026-2027", expected_semester="1st Sem"
    )
    print(f"Verification Result: Success={success}, Message='{msg}'")
    assert success, f"Verification failed: {msg}"
    print("  [OK] COR Field Verification with Alias Normalization Passed!")

if __name__ == '__main__':
    test_alias_normalizers()
    test_cor_field_verification()
    print("\nALL COR OCR PIPELINE TESTS PASSED SUCCESSFULLY!")
