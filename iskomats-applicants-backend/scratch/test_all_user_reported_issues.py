import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services.ocr_utils import verify_cor_fields, extract_total_units_from_text, extract_semester_from_ocr_text

def test_user_reported_issues():
    print("==================================================")
    print("Testing All 5 User Reported Validation & Logic Issues")
    print("==================================================")

    # Issue 1 & 2: Name Verification (First & Last Name with OCR substitutions)
    doc_text_name = "DE LA SALLE LIPA\nOFFICIAL ENROLMENT FORM\nName: LANTAFE, MIKAEIA YSABEI\nStudent No: 2021305751\nYear Level: 4th Year"
    parsed_name = {'name': 'LANTAFE, MIKAEIA YSABEI', 'student_id': '2021305751', 'year_level': '4th Year'}
    
    # 1. Correct First/Last Name test (Mikaela Ysabel Lantafe)
    ok_1, msg_1, _ = verify_cor_fields(parsed_name, doc_text_name, "Mikaela Ysabel", "", "Lantafe")
    print(f"[TEST 1 & 2] Name Verification ('Mikaela Ysabel Lantafe' vs OCR 'MIKAEIA YSABEI LANTAFE'): success={ok_1}")
    assert ok_1, f"Name verification failed: {msg_1}"

    # Issue 3: Year Level mismatch (Doc indicates 4th Year, User inputs 3rd Year -> MUST FAIL)
    ok_3, msg_3, _ = verify_cor_fields(
        parsed_name, doc_text_name, "Mikaela Ysabel", "", "Lantafe",
        expected_year_level="3rd Year"
    )
    print(f"[TEST 3] Year Level Mismatch (Doc 4th Year vs User Input 3rd Year): success={ok_3}")
    assert not ok_3, "Year level mismatch should have FAILED when doc indicates 4th Year and user entered 3rd Year"

    # Issue 4: Units extraction (Subject table sum 12 vs printed line misread 9)
    doc_text_units = """
    DE LA SALLE LIPA
    OFFICIAL ENROLMENT FORM
    Course: BSIT Year Level: 4th Year
    Subject Code Description Units
    IT4B Capstone Project 2 3
    IT4B Social & Professional Issues 3
    IT4B Elective 4 3
    IT4B Life & Works of Rizal 3
    TOTAL UNITS ENROLLED: 9
    """
    units_extracted = extract_total_units_from_text(doc_text_units)
    print(f"[TEST 4] Units Extraction (Subject sum 12 vs printed total 9): extracted={units_extracted}")
    assert units_extracted == 12, f"Expected 12 units calculated from subject rows, got {units_extracted}"

    # Issue 5: Document Type Detection (COE with 'ENROLMENT', 'MATRICULATION', 'ASSESSMENT')
    doc_text_coe = "CERTIFICATE OF ENROLMENT\nThis certifies that LANTAFE MIKAELA is enrolled."
    parsed_coe = {'name': 'LANTAFE MIKAELA'}
    ok_5, msg_5, _ = verify_cor_fields(parsed_coe, doc_text_coe, "Mikaela", "", "Lantafe")
    print(f"[TEST 5] COE Document Type Detection ('CERTIFICATE OF ENROLMENT'): success={ok_5}")
    assert ok_5, f"COE detection failed: {msg_5}"

    print("\nALL 5 USER-REPORTED ISSUES SUCCESSFULLY RESOLVED & VERIFIED!")

if __name__ == '__main__':
    test_user_reported_issues()
