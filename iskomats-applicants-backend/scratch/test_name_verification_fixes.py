import os
import sys

# Add parent dir to path so we can import services.ocr_utils
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services.ocr_utils import verify_name_sequence_detailed, verify_indigency_fields

def test_name_verification_rules():
    print("==================================================")
    print("Testing Strict Name Verification Rules (Last & First)")
    print("==================================================")

    # 1. Last Name Misspelling Test: "RIZAL, JOSE" vs "Riza" (must FAIL)
    doc_text_1 = "This is to certify that RIZAL, JOSE is a bonafide resident of Barangay Inosloban, Lipa City."
    first_ok_1, mid_ok_1, last_ok_1, seq_ok_1, errs_1 = verify_name_sequence_detailed(
        first_name="Jose", last_name="Riza", target_text=doc_text_1
    )
    print(f"[TEST 1] 'RIZAL, JOSE' vs Last Name 'Riza' -> last_ok={last_ok_1}, seq_ok={seq_ok_1}")
    assert not (first_ok_1 and last_ok_1 and seq_ok_1), "Misspelled last name 'Riza' should NOT validate against 'RIZAL, JOSE'"
    print("[TEST 1 PASS] Misspelled last name 'Riza' was correctly rejected!")

    # 2. Correct Last Name Test: "RIZAL, JOSE" vs "Rizal" (must PASS)
    first_ok_2, mid_ok_2, last_ok_2, seq_ok_2, errs_2 = verify_name_sequence_detailed(
        first_name="Jose", last_name="Rizal", target_text=doc_text_1
    )
    print(f"[TEST 2] 'RIZAL, JOSE' vs Last Name 'Rizal' -> first_ok={first_ok_2}, last_ok={last_ok_2}, seq_ok={seq_ok_2}")
    assert first_ok_2 and last_ok_2 and seq_ok_2, "Correct last name 'Rizal' MUST validate against 'RIZAL, JOSE'"
    print("[TEST 2 PASS] Correct last name 'Rizal' passed successfully!")

    # 3. Multi-word First Name Incomplete Test: Doc text has "JUAN SANTOS", input is "Juan Miguel" (must FAIL)
    doc_text_3 = "Certificate of Indigency: Pinatutunayan na si JUAN SANTOS ay residente ng Barangay Marawoy."
    first_ok_3, mid_ok_3, last_ok_3, seq_ok_3, errs_3 = verify_name_sequence_detailed(
        first_name="Juan Miguel", last_name="Santos", target_text=doc_text_3
    )
    print(f"[TEST 3] 'JUAN SANTOS' vs First Name 'Juan Miguel' -> first_ok={first_ok_3}, seq_ok={seq_ok_3}")
    assert not (first_ok_3 and seq_ok_3), "Incomplete first name 'Juan Miguel' should NOT validate when 'Miguel' is missing from document"
    print("[TEST 3 PASS] Missing first name token 'Miguel' was correctly rejected!")

    # 4. Multi-word First Name Complete Test: Doc text has "JUAN MIGUEL SANTOS", input is "Juan Miguel" (must PASS)
    doc_text_4 = "Certificate of Indigency: Pinatutunayan na si JUAN MIGUEL SANTOS ay residente ng Barangay Marawoy."
    first_ok_4, mid_ok_4, last_ok_4, seq_ok_4, errs_4 = verify_name_sequence_detailed(
        first_name="Juan Miguel", last_name="Santos", target_text=doc_text_4
    )
    print(f"[TEST 4] 'JUAN MIGUEL SANTOS' vs First Name 'Juan Miguel' -> first_ok={first_ok_4}, last_ok={last_ok_4}, seq_ok={seq_ok_4}")
    assert first_ok_4 and last_ok_4 and seq_ok_4, "Full first name 'Juan Miguel' MUST validate when all first name tokens exist"
    print("[TEST 4 PASS] Full multi-word first name 'Juan Miguel' passed successfully!")

    print("\nALL NAME VERIFICATION FIX TESTS PASSED SUCCESSFULLY!")

if __name__ == '__main__':
    test_name_verification_rules()
