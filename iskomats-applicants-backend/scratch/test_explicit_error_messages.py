import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from services.ocr_utils import verify_indigency_fields

DOC_TEXT = """
BARANGAY CERTIFICATE OF INDIGENCY

This is to certify that MIKAELA YSABEL DELA CRUZ, residing in Barangay Inosloban,
Lipa City, Batangas, is certified as indigent.

Hon. MARIO REYES
Barangay Captain
"""

def test_missing_first_name_word_error():
    print("Testing First Name Missing Word Error:")

    # Input First Name = "MIKAELA YSABEL ANNE", Doc has "MIKAELA YSABEL DELA CRUZ" -> Missing "ANNE"
    ok, msg, _ = verify_indigency_fields(DOC_TEXT, first_name="MIKAELA YSABEL ANNE", middle_name="", last_name="DELA CRUZ")
    print(f"  Result: Success={ok}, Msg='{msg}'")
    assert not ok, "Must fail!"
    assert "Missing: 'anne'" in msg or "Missing" in msg or "found only" in msg, f"Unexpected message: {msg}"
    print("  [OK] First Name missing word error message formatted correctly!")

def test_misspelled_last_name_error():
    print("\nTesting Misspelled Last Name Error Message:")

    # Input Last Name = "DELA CRUS" on Doc with "DELA CRUZ"
    ok, msg, _ = verify_indigency_fields(DOC_TEXT, first_name="MIKAELA YSABEL", middle_name="", last_name="DELA CRUS")
    print(f"  Result: Success={ok}, Msg='{msg}'")
    assert not ok, "Must fail!"
    assert "Last Name Mismatch" in msg or "similarity" in msg, f"Unexpected message: {msg}"
    print("  [OK] Last Name misspelled error message formatted correctly!")

def test_missing_last_name_error():
    print("\nTesting Missing Last Name Error Message:")

    # Input Last Name = "SANTOS" on Doc with "DELA CRUZ"
    ok, msg, _ = verify_indigency_fields(DOC_TEXT, first_name="MIKAELA YSABEL", middle_name="", last_name="SANTOS")
    print(f"  Result: Success={ok}, Msg='{msg}'")
    assert not ok, "Must fail!"
    assert "Last Name" in msg, f"Unexpected message: {msg}"
    print("  [OK] Missing Last Name error message formatted correctly!")

def test_valid_match_passes():
    print("\nTesting Valid Match Passes:")

    # Input First="MIKAELA YSABEL", Last="DELA CRUZ"
    ok, msg, _ = verify_indigency_fields(DOC_TEXT, first_name="MIKAELA YSABEL", middle_name="", last_name="DELA CRUZ")
    print(f"  Result: Success={ok}, Msg='{msg}'")
    assert ok, f"Must pass! Msg: {msg}"
    print("  [OK] Valid match passed!")

if __name__ == '__main__':
    test_missing_first_name_word_error()
    test_misspelled_last_name_error()
    test_missing_last_name_error()
    test_valid_match_passes()
    print("\nALL EXPLICIT ERROR MESSAGE TESTS PASSED SUCCESSFULLY!")
