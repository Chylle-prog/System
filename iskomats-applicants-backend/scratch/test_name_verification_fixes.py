import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services.ocr_utils import verify_name_sequence_detailed

def test_two_way_name_verification():
    print("==================================================")
    print("Testing Two-Way Strict Name Verification Algorithm")
    print("==================================================")

    # 1. Document has "JUAN MIGUEL SANTOS", User inputs First="Juan", Last="Santos" (MUST FAIL: omitted "Miguel")
    doc_1 = "Name: JUAN MIGUEL SANTOS Reg No: 12345"
    f1, m1, l1, seq1, err1 = verify_name_sequence_detailed("Juan", "Santos", doc_1)
    print(f"[TEST 1] Doc='JUAN MIGUEL SANTOS' vs Input='Juan Santos': seq_ok={seq1}, err={err1}")
    assert not seq1, "User entering only 'Juan' when doc has 'JUAN MIGUEL SANTOS' MUST fail"
    print("[TEST 1 PASS] Omitted constituent name 'Miguel' was correctly rejected!")

    # 2. Document has "JUAN SANTOS", User inputs First="Juan Miguel", Last="Santos" (MUST FAIL: missing "Miguel" in doc)
    doc_2 = "Name: JUAN SANTOS Reg No: 12345"
    f2, m2, l2, seq2, err2 = verify_name_sequence_detailed("Juan Miguel", "Santos", doc_2)
    print(f"[TEST 2] Doc='JUAN SANTOS' vs Input='Juan Miguel Santos': first_ok={f2}, seq_ok={seq2}")
    assert not f2, "User entering 'Juan Miguel' when doc has only 'JUAN SANTOS' MUST fail"
    print("[TEST 2 PASS] Missing first name token 'Miguel' in document was correctly rejected!")

    # 3. Document has "JUAN MIGUEL SANTOS", User inputs First="Juan Miguel", Last="Santos" (MUST PASS)
    f3, m3, l3, seq3, err3 = verify_name_sequence_detailed("Juan Miguel", "Santos", doc_1)
    print(f"[TEST 3] Doc='JUAN MIGUEL SANTOS' vs Input='Juan Miguel Santos': first_ok={f3}, last_ok={l3}, seq_ok={seq3}")
    assert f3 and l3 and seq3, "Full matching name MUST pass"
    print("[TEST 3 PASS] Full multi-word first name passed successfully!")

    print("\nALL TWO-WAY NAME VERIFICATION TESTS PASSED PERFECTLY!")

if __name__ == '__main__':
    test_two_way_name_verification()
