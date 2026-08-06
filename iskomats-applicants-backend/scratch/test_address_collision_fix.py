import os
import sys

# Ensure backend root is in path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services.ocr_utils import verify_name_sequence, verify_indigency_fields

def test_address_word_collision_fix():
    print("Testing 1 & 2. Address Word Collision Fix & Mandatory All-Word Strictness:")
    
    # Document has "JUAN DELA CRUZ" living in "SAN PEDRO, LIPA CITY"
    # Input has multi-word first name "JUAN PEDRO"
    doc_text_address_pedro = """
    REPUBLIKA NG PILIPINAS
    BARANGAY INOSLOBAN
    
    THIS IS TO CERTIFY THAT DELA CRUZ, JUAN IS A BONAFIDE RESIDENT OF SAN PEDRO, LIPA CITY.
    """
    
    # Verify JUAN PEDRO against document with address "San Pedro"
    success, msg, meta = verify_indigency_fields(
        doc_text_address_pedro,
        first_name="JUAN PEDRO", middle_name="", last_name="DELA CRUZ",
        expected_address="Inosloban"
    )
    print(f"  JUAN PEDRO on 'DELA CRUZ, JUAN' in address 'SAN PEDRO': Success={success}, Msg='{msg}'")
    assert not success, "Address word 'San Pedro' MUST NOT collide with missing first name word 'PEDRO'!"
    print("  [OK] Address Word Collision Fix Passed (Missing 'PEDRO' correctly rejected)!")

    # Verify when document ACTUALLY has JUAN PEDRO
    doc_text_full_pedro = """
    REPUBLIKA NG PILIPINAS
    BARANGAY INOSLOBAN
    
    THIS IS TO CERTIFY THAT DELA CRUZ, JUAN PEDRO IS A BONAFIDE RESIDENT OF SAN PEDRO, LIPA CITY.
    """
    success_full, msg_full, meta_full = verify_indigency_fields(
        doc_text_full_pedro,
        first_name="JUAN PEDRO", middle_name="", last_name="DELA CRUZ",
        expected_address="Inosloban"
    )
    print(f"  JUAN PEDRO on 'DELA CRUZ, JUAN PEDRO': Success={success_full}, Msg='{msg_full}'")
    assert success_full, "Full name JUAN PEDRO DELA CRUZ MUST PASS when present!"
    print("  [OK] Full Name Match Passed!")

if __name__ == '__main__':
    test_address_word_collision_fix()
    print("\nALL ADDRESS WORD COLLISION & MANDATORY ALL-WORD FIXES PASSED SUCCESSFULLY!")
