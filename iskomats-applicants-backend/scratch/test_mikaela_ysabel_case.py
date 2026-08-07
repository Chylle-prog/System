import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services.ocr_utils import verify_name_sequence_detailed

def test_mikaela_ysabel_case():
    print("==================================================")
    print("Testing 'MIKAELA YSABEL L. LANTAFE' Reverse First Name Match")
    print("==================================================")

    doc_text = "This is to certify that MIKAELA YSABEL L. LANTAFE 23 years of age is a resident of PUROK 2, BRGY. INOSLUBAN, LIPA CITY."

    # Case 1: User enters only "Mikaela" as First Name (MUST FAIL first_ok because "YSABEL" is missing)
    f1, m1, l1, seq1, err1 = verify_name_sequence_detailed("Mikaela", "Lantafe", doc_text)
    print(f"[CASE 1] Input 'Mikaela' vs Doc 'MIKAELA YSABEL L. LANTAFE': first_ok={f1}, last_ok={l1}, seq_ok={seq1}, err={err1}")
    assert not f1, "first_ok MUST be False when document contains 'MIKAELA YSABEL' but user entered only 'Mikaela'"
    assert not seq1, "seq_ok MUST be False when user entered incomplete first name"
    print("[CASE 1 PASS] Single first name 'Mikaela' against multi-word 'MIKAELA YSABEL' was correctly marked as first_ok=False!")

    # Case 2: User enters full "Mikaela Ysabel" as First Name (MUST PASS first_ok, last_ok, seq_ok)
    f2, m2, l2, seq2, err2 = verify_name_sequence_detailed("Mikaela Ysabel", "Lantafe", doc_text)
    print(f"[CASE 2] Input 'Mikaela Ysabel' vs Doc 'MIKAELA YSABEL L. LANTAFE': first_ok={f2}, last_ok={l2}, seq_ok={seq2}")
    assert f2 and l2 and seq2, "Full first name 'Mikaela Ysabel' MUST pass"
    print("[CASE 2 PASS] Full first name 'Mikaela Ysabel' passed successfully!")

    # Case 4: Document OCR with leading noise symbol ("This is to certify that _ MIKAELA YSABEL L. LANTAFE 23 years...")
    doc_text_noise = "This is to certify that _ MIKAELA YSABEL L. LANTAFE 23 years of age is a resident of PUROK 2, BRGY. INOSLUBAN, LIPA CITY."
    f4, m4, l4, seq4, err4 = verify_name_sequence_detailed("Mikaela Ysabel", "Lantafe", doc_text_noise)
    print(f"[CASE 4] Input 'Mikaela Ysabel' vs Noise Doc 'that _ MIKAELA YSABEL...': first_ok={f4}, last_ok={l4}, seq_ok={seq4}, err={err4}")
    assert f4 and l4 and seq4, f"Case 4 failed with err={err4}"
    # Case 5: Input 'Mikaela Ysabel' + 'Magbuhat' vs Doc 'MIKAELA YSABEL L. LANTAFE' -> first_ok MUST be True!
    f5, m5, l5, seq5, err5 = verify_name_sequence_detailed("Mikaela Ysabel", "Magbuhat", doc_text_noise)
    print(f"[CASE 5] Input 'Mikaela Ysabel' + 'Magbuhat' vs Doc 'MIKAELA YSABEL L. LANTAFE': first_ok={f5}, last_ok={l5}, seq_ok={seq5}, err={err5}")
    assert f5, f"Case 5 failed: First Name MUST be True when 'Mikaela Ysabel' is present on document, err={err5}"
    assert not l5, "Last Name MUST be False when Magbuhat != Lantafe"
    print("[CASE 5 PASS] First name 'Mikaela Ysabel' matched successfully even when surname differed!")

    print("\nALL MIKAELA YSABEL TEST CASES COMPLETED PERFECTLY!")

if __name__ == '__main__':
    test_mikaela_ysabel_case()
