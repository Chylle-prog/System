import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services.ocr_utils import parse_grades_document, verify_grades_fields

def test_strict_gpa_matching():
    print("==================================================")
    print("Testing Strict GPA Matching (3.15 vs 3.17)")
    print("==================================================")

    doc_text = """
    DE LA SALLE LIPA
    OFFICIAL TRANSCRIPT OF RECORDS
    Name: DELA CRUZ, JUAN
    Student No: 2021305751
    GPA: 3.17
    
    ITCAPROJ2   3.00   3.0
    ITSOPRI     3.25   3.0
    """

    parsed = parse_grades_document(doc_text)
    print(f"Extracted GPA from Document: '{parsed.get('gpa')}'")
    assert parsed.get('gpa') == '3.17', f"Expected extracted GPA '3.17', got '{parsed.get('gpa')}'"

    # Test 1: User inputs 3.15 against Document GPA 3.17 -> MUST REJECT
    s1, m1, meta1 = verify_grades_fields(
        parsed, doc_text,
        first_name="JUAN", middle_name="", last_name="DELA CRUZ",
        expected_id_no="2021305751",
        expected_gpa="3.15"
    )
    print(f"[TEST 1] User input '3.15' vs Document '3.17': Success={s1}, Msg='{m1}'")
    assert not s1, "User input 3.15 MUST be rejected against document GPA 3.17!"
    print("  [OK] Input 3.15 vs Document 3.17 correctly REJECTED!")

    # Test 2: User inputs 3.17 against Document GPA 3.17 -> MUST PASS
    s2, m2, meta2 = verify_grades_fields(
        parsed, doc_text,
        first_name="JUAN", middle_name="", last_name="DELA CRUZ",
        expected_id_no="2021305751",
        expected_gpa="3.17"
    )
    print(f"[TEST 2] User input '3.17' vs Document '3.17': Success={s2}, Msg='{m2}'")
    assert s2, "User input 3.17 MUST pass against document GPA 3.17!"
    print("  [OK] Input 3.17 vs Document 3.17 correctly PASSED!")

    print("\nSTRICT GPA MATCHING TEST COMPLETED PERFECTLY!")

if __name__ == '__main__':
    test_strict_gpa_matching()
