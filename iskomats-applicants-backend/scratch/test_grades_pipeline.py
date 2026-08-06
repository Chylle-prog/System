import os
import sys

# Ensure backend root is in path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services.ocr_utils import parse_grades_document, verify_grades_fields

def test_grades_verification():
    print("Testing Student Grades / Report Card / TOR Verification Pipeline:")
    sample_text = """
    DE LA SALLE LIPA
    OFFICE OF THE COLLEGE REGISTRAR
    STUDENT'S FINAL GRADES
    
    Student Name : LANTAFE, MIKAELA YSABEL LINATOC
    Student No : 2021305751
    SY / Sem : AY 2026-2027 1st Semester
    Course : BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY
    
    Subject     Description                        Units   Grade   Posted
    ITCaproj2   Capstone Project 2                 3.0     1.25    Yes
    Itelect4    IT Elective 4                      3.0     1.50    Yes
    Itsopri     IT Social and Professional Issues  3.0     1.25    Yes
    Liferiz     The Life and Works of Jose Rizal   3.0     1.00    Yes
    
    Total Units Enrolled : 12.0
    GWA : 1.25
    Cumulative GPA : 1.25
    """
    parsed = parse_grades_document(sample_text)
    print("  Parsed Grades Fields:", parsed)
    assert parsed.get('gpa') == '1.25' or '1.25' in str(parsed)
    
    success, msg, meta = verify_grades_fields(
        parsed, sample_text,
        first_name="MIKAELA YSABEL", middle_name="LINATOC", last_name="LANTAFE",
        expected_id_no="2021305751", expected_gpa="1.25",
        expected_academic_year="AY 2026-2027", expected_semester="1st Sem"
    )
    print(f"  Result: Success={success}, Msg='{msg}'")
    assert success, f"Grades Verification Failed: {msg}"
    print("  [OK] Grades / Report Card / TOR Verification Test Passed!")

if __name__ == '__main__':
    test_grades_verification()
    print("\nALL GRADES OCR PIPELINE TESTS PASSED SUCCESSFULLY!")
