import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services.ocr_utils import verify_name_sequence_detailed, extract_semantic_anchors_from_indigency

def test_user_exact_indigency_ocr():
    raw_ocr = """Republic of the Philippines
Province of Batangas
City of Lipa
BARANGAY INOSLUBAN
OFFICE OF THE PUNONG BARANGAY
CERTIFICATE OF INDIGENCY
OF
TO WHOM IT MAY CONCERN:
23 years of age,
This is to certify that MIKAELA YSABEL L. LANTAFE
single/married/widow/separated, Filipino citizen is a resident of this barangay with postal
PUROK 2, BRGY. INOSLUBAN, LIPA CITY
address at
whose specimen signature below, is an INDIGENT and that he/she has visibly no money,
property or means of livelihood sufficient and available for daily food, shelter and basic
necessities for himself and his family.
This certification is being issued upon the request of ABOVE-NAMED PERSON
in
the fulfillment of
a
certain
requirement for the request of/for
SCHOOL REQUIREMENT
Isssued this 7TH day of
City, Batangas, Philippines.
Specimen Signature:
APRIL
2026 at Barangay Inosluban, Lipa
J
LIPA
CITY
HON. MIGUELL OLGADO
Punong Barangay
Purok 3, Brgy. mastuban, Lipa City, Batangas 4217 (043) 404-3035 / (043) 233 2459 induban2014@gmail.com"""

    print("==================================================")
    print("Testing Exact User Indigency Document OCR Text")
    print("==================================================")

    anchors = extract_semantic_anchors_from_indigency(raw_ocr)
    print("Extracted Candidate Name Anchor:", anchors.get('candidate_name'))
    assert anchors.get('candidate_name') == "MIKAELA YSABEL L. LANTAFE", f"Expected 'MIKAELA YSABEL L. LANTAFE', got '{anchors.get('candidate_name')}'"

    # Test Case 1: First Name = "Mikaela" -> MUST FAIL first_ok because "Ysabel" is missing
    f1, m1, l1, s1, e1 = verify_name_sequence_detailed("Mikaela", "Lantafe", raw_ocr, middle_name="L")
    print(f"[TEST 1] First Name='Mikaela': first_ok={f1}, last_ok={l1}, seq_ok={s1}, errors={e1}")
    assert not f1, "First Name 'Mikaela' MUST fail when document has 'MIKAELA YSABEL'"

    # Test Case 2: First Name = "Mikaela Ysabel" -> MUST PASS
    f2, m2, l2, s2, e2 = verify_name_sequence_detailed("Mikaela Ysabel", "Lantafe", raw_ocr, middle_name="L")
    print(f"[TEST 2] First Name='Mikaela Ysabel': first_ok={f2}, last_ok={l2}, seq_ok={s2}, errors={e2}")
    assert f2 and l2 and s2, "First Name 'Mikaela Ysabel' MUST pass"

    print("\nALL USER INDIGENCY OCR CASE TESTS PASSED PERFECTLY!")

if __name__ == '__main__':
    test_user_exact_indigency_ocr()
