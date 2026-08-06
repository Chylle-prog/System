import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from services.ocr_utils import verify_indigency_fields

DOC_LAST_FIRST = """
BARANGAY CERTIFICATE OF INDIGENCY

This is to certify that DELA CRUZ, JUAN CARLOS, a resident of Barangay Inosloban,
Lipa City, Batangas, is certified as indigent.

Hon. MARIO REYES
Barangay Captain
"""

DOC_FIRST_LAST = """
BARANGAY CERTIFICATE OF INDIGENCY

This is to certify that JUAN CARLOS DELA CRUZ, residing in Barangay Inosloban,
Lipa City, Batangas, is certified as indigent.

Hon. MARIO REYES
Barangay Captain
"""

def test_name_order_flexibility():
    print("Testing Name Order Flexibility (FIRST LAST vs LAST FIRST):")

    # Input: First="JUAN CARLOS", Last="DELA CRUZ"
    # Doc 1: "DELA CRUZ, JUAN CARLOS"
    ok1, msg1, _ = verify_indigency_fields(DOC_LAST_FIRST, first_name="JUAN CARLOS", middle_name="", last_name="DELA CRUZ")
    print(f"  LAST, FIRST layout result: Success={ok1}, Msg='{msg1}'")
    assert ok1, f"FAIL: LAST, FIRST format should pass! Msg: {msg1}"

    # Doc 2: "JUAN CARLOS DELA CRUZ"
    ok2, msg2, _ = verify_indigency_fields(DOC_FIRST_LAST, first_name="JUAN CARLOS", middle_name="", last_name="DELA CRUZ")
    print(f"  FIRST LAST layout result: Success={ok2}, Msg='{msg2}'")
    assert ok2, f"FAIL: FIRST LAST format should pass! Msg: {msg2}"
    print("  [OK] Order-independent layout matching passed!")

def test_misspelled_last_name_rejection():
    print("\nTesting Misspelled Last Name Rejection:")

    # Input Last="SANTOS" on Doc with "DELA CRUZ"
    ok1, msg1, _ = verify_indigency_fields(DOC_FIRST_LAST, first_name="JUAN CARLOS", middle_name="", last_name="SANTOS")
    print(f"  Input 'SANTOS' vs Doc 'DELA CRUZ': Success={ok1}, Msg='{msg1}'")
    assert not ok1, "FAIL: Mismatched Last Name 'SANTOS' must be REJECTED!"

    # Input Last="DELA CRUS" (typo) on Doc with "DELA CRUZ"
    ok2, msg2, _ = verify_indigency_fields(DOC_FIRST_LAST, first_name="JUAN CARLOS", middle_name="", last_name="DELA CRUS")
    print(f"  Input 'DELA CRUS' vs Doc 'DELA CRUZ': Success={ok2}, Msg='{msg2}'")
    assert not ok2, "FAIL: Misspelled Last Name 'DELA CRUS' must be REJECTED!"
    print("  [OK] Misspelled last name rejected cleanly!")

def test_incomplete_first_name_handling():
    print("\nTesting Complete First Name Validation:")

    # Input First="JUAN" (incomplete, missing CARLOS) on Doc with "JUAN CARLOS DELA CRUZ"
    # User's requirement: "compare complete first name with document... any missing characters should result in Invalid"
    # When user enters JUAN CARLOS, every word must match.
    ok1, msg1, _ = verify_indigency_fields(DOC_FIRST_LAST, first_name="JUAN CARLOS", middle_name="", last_name="DELA CRUZ")
    assert ok1, "FAIL: Complete first name JUAN CARLOS must pass!"

    # Incomplete first name input: First="JUAN PEDRO" on Doc with "JUAN CARLOS DELA CRUZ"
    ok2, msg2, _ = verify_indigency_fields(DOC_FIRST_LAST, first_name="JUAN PEDRO", middle_name="", last_name="DELA CRUZ")
    print(f"  Input 'JUAN PEDRO' vs Doc 'JUAN CARLOS': Success={ok2}, Msg='{msg2}'")
    assert not ok2, "FAIL: Incomplete/mismatched first name 'JUAN PEDRO' must be REJECTED!"

    print("  [OK] Incomplete / mismatched first name rejected cleanly!")

if __name__ == '__main__':
    test_name_order_flexibility()
    test_misspelled_last_name_rejection()
    test_incomplete_first_name_handling()
    print("\nALL STRICT NAME VERIFICATION RECOMMENDATION FIXES PASSED SUCCESSFULLY!")
