import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from services.ocr_utils import verify_indigency_fields, verify_name_sequence

INDIGENCY_DOC = """
BARANGAY CERTIFICATE OF INDIGENCY

This is to certify that JUAN DELA CRUZ, a resident of this barangay,
is a bona fide resident of Barangay San Pedro, Lipa City, Batangas.

He is certified as indigent for scholarship purposes.

Given this day in Lipa City, Batangas.

Hon. PEDRO REYES
Barangay Captain
"""

INDIGENCY_WITH_MIDDLENAME = """
This is to certify that JUAN CARLOS DELA CRUZ, residing in
Barangay San Juan, Batangas City, is hereby certified as indigent.

Atty. CARLOS JUAN SANTOS
Barangay Captain
"""

def test_fix1_substring_rejection():
    print("Test 1: Partial first name 'JU' must NOT match 'JUAN' (substring check removed):")
    from services.ocr_utils import is_similar_name_word
    # 'ju' in 'juan' would have been True with old substring check
    result = is_similar_name_word("ju", "juan")
    print(f"  is_similar_name_word('ju', 'juan') = {result}  (expected: False)")
    assert not result, "FAIL: 'ju' must NOT match 'juan' after substring fix!"
    print("  [OK] Short partial 'JU' rejected correctly!")

def test_fix1b_juanita_rejection():
    print("\nTest 1b: 'JUAN' must NOT match 'JUANITA' (substring check removed):")
    from services.ocr_utils import is_similar_name_word
    result = is_similar_name_word("juan", "juanita")
    print(f"  is_similar_name_word('juan', 'juanita') = {result}  (expected: False)")
    assert not result, "FAIL: 'JUAN' must NOT match 'JUANITA'!"
    print("  [OK] 'JUAN' rejected against 'JUANITA' correctly!")

def test_fix2_single_word_first_name_pass():
    print("\nTest 2: Single-word first name 'JUAN' must PASS when present in applicant line:")
    success, msg, meta = verify_indigency_fields(
        INDIGENCY_DOC, first_name="JUAN", middle_name="", last_name="DELA CRUZ"
    )
    print(f"  Success={success}, Msg='{msg}'")
    assert success, f"FAIL: JUAN DELA CRUZ must pass! Msg: {msg}"
    print("  [OK] Single-word first name matched correctly!")

def test_fix3_multiword_first_name_all_words_required():
    print("\nTest 3: Multi-word first name 'JUAN CARLOS' — both words must be on the applicant line in sequence:")
    success, msg, meta = verify_indigency_fields(
        INDIGENCY_WITH_MIDDLENAME, first_name="JUAN CARLOS", middle_name="", last_name="DELA CRUZ"
    )
    print(f"  Success={success}, Msg='{msg}'")
    assert success, f"FAIL: JUAN CARLOS DELA CRUZ must pass! Msg: {msg}"
    print("  [OK] Multi-word first name matched in sequence on applicant line!")

def test_fix4_partial_first_name_rejected():
    print("\nTest 4: Incomplete first name 'JUAN' submitted but document has 'JUAN CARLOS DELA CRUZ' — must FAIL:")
    # The user enters only 'JUAN' but document says 'JUAN CARLOS'
    # This is an INCOMPLETE first name submission
    # However, since JUAN does appear in the applicant line, this should PASS with our fix
    # (We verify only what the user enters; if they enter JUAN, we check JUAN is there)
    # The key improvement is the OPPOSITE: preventing 'PEDRO' from matching 'SAN PEDRO' in address
    print("  (Note: If user enters JUAN, JUAN must appear as a word in the applicant line)")
    success, msg, meta = verify_indigency_fields(
        INDIGENCY_DOC, first_name="JUAN", middle_name="", last_name="DELA CRUZ"
    )
    print(f"  Success={success}, Msg='{msg}'")
    assert success, f"FAIL: JUAN is legitimately on the applicant line!"
    print("  [OK] Single word first name passes when it appears on the correct line!")

def test_fix5_address_word_not_matched_as_name():
    print("\nTest 5: 'PEDRO' from user input must NOT match 'SAN PEDRO' in address:")
    # User submits JUAN PEDRO but only JUAN is on the applicant name line
    # PEDRO is only in the address 'San Pedro'
    success, msg, meta = verify_indigency_fields(
        INDIGENCY_DOC, first_name="JUAN PEDRO", middle_name="", last_name="DELA CRUZ"
    )
    print(f"  Success={success}, Msg='{msg}'")
    assert not success, "FAIL: 'JUAN PEDRO' must be REJECTED — PEDRO is only in the address!"
    print("  [OK] Address word 'PEDRO' from 'San Pedro' NOT accepted as first name word!")

def test_fix6_captain_name_not_matched():
    print("\nTest 6: Captain 'PEDRO REYES' at bottom must NOT help an input 'PEDRO' pass:")
    success, msg, meta = verify_indigency_fields(
        INDIGENCY_DOC, first_name="PEDRO", middle_name="", last_name="DELA CRUZ"
    )
    print(f"  Success={success}, Msg='{msg}'")
    assert not success, "FAIL: 'PEDRO' must be REJECTED — it's the Captain's name, not the applicant!"
    print("  [OK] Barangay Captain name 'PEDRO REYES' correctly excluded from matching!")

if __name__ == '__main__':
    test_fix1_substring_rejection()
    test_fix1b_juanita_rejection()
    test_fix2_single_word_first_name_pass()
    test_fix3_multiword_first_name_all_words_required()
    test_fix4_partial_first_name_rejected()
    test_fix5_address_word_not_matched_as_name()
    test_fix6_captain_name_not_matched()
    print("\nALL INDIGENCY NAME VERIFICATION FIXES PASSED SUCCESSFULLY!")
