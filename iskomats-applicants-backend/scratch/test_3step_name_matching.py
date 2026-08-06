import os
import sys

# Ensure backend root is in path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services.ocr_utils import verify_name_sequence, extract_semantic_anchors_from_indigency, verify_indigency_fields

def test_3step_name_matching():
    print("Testing 3-Step Order-Flexible + Strict Spelling Name Solution:")
    
    # 1. Test Step 1: Isolate Applicant Line
    doc_text = """
    REPUBLIKA NG PILIPINAS
    BARANGAY INOSLOBAN
    OFFICE OF THE BARANGAY CAPTAIN
    
    THIS IS TO CERTIFY THAT DELA CRUZ, JUAN IS A BONAFIDE RESIDENT OF LIPA CITY.
    
    BARANGAY CAPTAIN: HON. JUAN SANTOS
    """
    anchors = extract_semantic_anchors_from_indigency(doc_text)
    candidate_name = anchors.get('candidate_name')
    print(f"  Step 1 Isolated Candidate Name: '{candidate_name}'")
    assert candidate_name is not None and 'DELA CRUZ' in candidate_name.upper()
    print("  [OK] Step 1: Isolate Applicant Line Passed!")

    # 2. Test Step 2 & 3: Order-Flexible + Strict Spelling (DELA CRUZ, JUAN vs JUAN DELA CRUZ)
    first_ok, middle_ok, last_ok, seq_ok = verify_name_sequence(
        first_name="JUAN", last_name="DELA CRUZ",
        target_text=candidate_name, full_raw_text=doc_text
    )
    print(f"  Step 2 & 3 Match Result for JUAN DELA CRUZ on 'DELA CRUZ, JUAN': first_ok={first_ok}, last_ok={last_ok}, seq_ok={seq_ok}")
    assert first_ok and last_ok and seq_ok
    print("  [OK] Step 2 & 3: Order-Flexible Match (DELA CRUZ, JUAN) Passed!")

    # 3. Test Rejection when name mismatch (SANTOS vs DELA CRUZ, JUAN)
    success, msg, meta = verify_indigency_fields(
        doc_text,
        first_name="JUAN", middle_name="", last_name="SANTOS",
        expected_address="Lipa City"
    )
    print(f"  Mismatch Test Result for JUAN SANTOS on DELA CRUZ, JUAN doc: Success={success}, Msg='{msg}'")
    assert not success, "Should REJECT mismatched applicant name!"
    print("  [OK] Mismatch Rejection Passed!")

if __name__ == '__main__':
    test_3step_name_matching()
    print("\nALL 3-STEP NAME MATCHING SOLUTIONS PASSED SUCCESSFULLY!")
