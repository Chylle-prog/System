import os
import sys

# Ensure backend root is in path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services.ocr_utils import verify_name_sequence, extract_semantic_anchors_from_indigency, verify_indigency_fields

def test_multi_word_strict_all_words():
    print("Testing 1. Strict All-Word Enforcement (Multi-Word First Name):")
    # Document has "JUAN DELA CRUZ" (missing "PEDRO")
    doc_text = "THIS IS TO CERTIFY THAT DELA CRUZ, JUAN IS A RESIDENT OF LIPA CITY."
    first_ok, middle_ok, last_ok, seq_ok = verify_name_sequence(
        first_name="JUAN PEDRO", last_name="DELA CRUZ",
        target_text="DELA CRUZ, JUAN", full_raw_text=doc_text
    )
    print(f"  Multi-word JUAN PEDRO on 'DELA CRUZ, JUAN': first_ok={first_ok}, last_ok={last_ok}, seq_ok={seq_ok}")
    assert not first_ok, "Should REJECT when one word of multi-word first name (PEDRO) is missing!"
    print("  [OK] Multi-Word Strict All-Word Enforcement Passed (Missing word 'PEDRO' correctly rejected)!")

def test_signature_block_exclusion():
    print("\nTesting 2. Applicant Line Isolation + Signature Block Exclusion:")
    doc_text = """
    REPUBLIKA NG PILIPINAS
    BARANGAY INOSLOBAN
    OFFICE OF THE BARANGAY CAPTAIN
    
    THIS IS TO CERTIFY THAT DELA CRUZ, JUAN IS A BONAFIDE RESIDENT OF LIPA CITY.
    
    BARANGAY CAPTAIN: HON. JUAN SANTOS
    """
    anchors = extract_semantic_anchors_from_indigency(doc_text)
    candidate_name = anchors.get('candidate_name')
    print(f"  Extracted candidate applicant name line: '{candidate_name}'")
    assert candidate_name == "DELA CRUZ, JUAN"
    
    # Try verifying applicant JUAN SANTOS against the document
    success, msg, meta = verify_indigency_fields(
        doc_text,
        first_name="JUAN", middle_name="", last_name="SANTOS",
        expected_address="Lipa City"
    )
    print(f"  Verification result for JUAN SANTOS against document with Captain HON. JUAN SANTOS: Success={success}, Msg='{msg}'")
    assert not success, "Signature block exclusion MUST REJECT matching Captain's name!"
    print("  [OK] Signature Block Exclusion Passed!")

if __name__ == '__main__':
    test_multi_word_strict_all_words()
    test_signature_block_exclusion()
    print("\nALL NAME VERIFICATION RECOMMENDATION FIXES PASSED SUCCESSFULLY!")
