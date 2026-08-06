import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from services.ocr_utils import parse_grades_document, verify_grades_fields

def test_gpa_no_candidate_override():
    print("Testing 1. Candidate Override Bug Fixed (1.75 in Capstone grade does NOT match overall GPA):")
    # Document has GPA: 2.50 in header, but also has 1.75 as a Capstone course grade
    doc_text = """
    DE LA SALLE LIPA
    STUDENT'S FINAL GRADES
    
    Name: DELA CRUZ, JUAN
    Student No: 2200001234
    GPA: 2.50
    
    SUBJECTS:
    CAPSTONE    1.75   3.0
    MATHANA     3.00   3.0
    ELEC101     2.25   3.0
    NSTP        2.50   3.0
    """
    parsed = parse_grades_document(doc_text)
    print(f"  Extracted GPA: {parsed.get('gpa')}  (source: {parsed.get('gpa_source', 'none')})")
    assert parsed.get('gpa') == '2.50', f"Expected GPA 2.50 from header, got {parsed.get('gpa')}"
    assert parsed.get('gpa_source') == 'header', f"Expected gpa_source='header', got {parsed.get('gpa_source')}"
    print("  [OK] GPA extracted from header correctly (not from Capstone course grade)!")

    # User inputs 1.75 (matching Capstone course grade) — must REJECT
    success, msg, meta = verify_grades_fields(
        parsed, doc_text,
        first_name="JUAN", middle_name="", last_name="DELA CRUZ",
        gpa="1.75"
    )
    print(f"  User input 1.75 vs Document GPA 2.50: Success={success}, Msg='{msg}'")
    assert not success, "MUST REJECT: 1.75 user input must NOT pass against document GPA of 2.50!"
    print("  [OK] Candidate Override Bug Fixed! (1.75 input correctly rejected against 2.50 document GPA)")

def test_gpa_correct_match():
    print("\nTesting 2. Correct GPA Match (2.50 matches 2.50 header):")
    doc_text = """
    DE LA SALLE LIPA
    STUDENT'S FINAL GRADES
    Name: DELA CRUZ, JUAN
    GPA: 2.50
    SUBJ1   2.50   3.0
    SUBJ2   2.50   3.0
    SUBJ3   2.50   3.0
    """
    parsed = parse_grades_document(doc_text)
    success, msg, meta = verify_grades_fields(
        parsed, doc_text,
        first_name="JUAN", middle_name="", last_name="DELA CRUZ",
        gpa="2.50"
    )
    print(f"  User input 2.50 vs Document GPA 2.50: Success={success}, Msg='{msg}'")
    assert success, "MUST PASS: 2.50 input must match 2.50 document GPA!"
    print("  [OK] Correct GPA Match Passed!")

if __name__ == '__main__':
    test_gpa_no_candidate_override()
    test_gpa_correct_match()
    print("\nALL GPA VALIDATION RECOMMENDATION FIXES PASSED SUCCESSFULLY!")
