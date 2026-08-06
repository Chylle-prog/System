import os
import sys

# Ensure backend root is in path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services.ocr_utils import parse_cor_document, verify_cor_fields

def test_fuzzy_and_order_independent_name():
    print("Testing 1 & 2. Fuzzy Levenshtein (MAR1A) and Order-Independent Name Matching (LASTNAME, FIRSTNAME):")
    raw_cor_text = """
    OFFICIAL CERTIFICATE OF REGISTRATION
    STUDENT NAME : LANTAFE, M1KAELA YSABEL
    STUDENT NO : 2021305751
    COURSE : BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY
    AY 2026-2027 1ST SEMESTER
    TOTAL UNITS : 18
    """
    parsed = parse_cor_document(raw_cor_text)
    success, msg, meta = verify_cor_fields(
        parsed, raw_cor_text,
        first_name="MIKAELA YSABEL", middle_name="LINATOC", last_name="LANTAFE",
        expected_id_no="2021305751", course="BSIT"
    )
    print(f"  Result: Success={success}, Msg='{msg}'")
    assert success, f"COR verification failed on fuzzy name: {msg}"
    print("  [OK] Fuzzy Name + Order-Independent Matching Passed!")

def test_non_cor_document_guard():
    print("\nTesting 4. Mandatory COR Header Keyword Guard (Rejecting Non-COR files):")
    indigency_text = """
    REPUBLIKA NG PILIPINAS
    BARANGAY INOSLOBAN
    KATIBAYAN NG KAWALANG HANAPBUHAY
    PINATUTUNAYAN NA SI MIKAELA YSABEL LANTAFE AY ISANG RESIDENTE.
    STUDENT NO : 2021305751
    """
    parsed = parse_cor_document(indigency_text)
    success, msg, meta = verify_cor_fields(
        parsed, indigency_text,
        first_name="MIKAELA YSABEL", middle_name="LINATOC", last_name="LANTAFE",
        expected_id_no="2021305751"
    )
    print(f"  Result: Success={success}, Msg='{msg}'")
    assert not success, "COR Header Guard should REJECT non-COR document!"
    assert "Document Type Mismatch" in msg
    print("  [OK] Mandatory COR Header Keyword Guard Passed!")

if __name__ == '__main__':
    test_fuzzy_and_order_independent_name()
    test_non_cor_document_guard()
    print("\nALL COR/COE VERIFICATION PROBLEM & SOLUTION FIXES PASSED SUCCESSFULLY!")
