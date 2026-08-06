import os
import sys

# Ensure backend root is in path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services.ocr_utils import verify_school_id_fields, verify_national_id_fields, verify_id_fields

def test_school_id_verification():
    print("Testing Dedicated School ID Verification Handler:")
    ocr_text = """
    DE LA SALLE LIPA
    STUDENT IDENTIFICATION CARD
    Name : LANTAFE, MIKAELA YSABEL L.
    Student No : 2021305751
    College of Information Technology
    AY 2026-2027
    """
    success, msg, meta = verify_school_id_fields(
        ocr_text,
        first_name="MIKAELA YSABEL", middle_name="LINATOC", last_name="LANTAFE",
        expected_id_no="2021305751", expected_school_name="De La Salle Lipa"
    )
    print(f"  Result: Success={success}, Msg='{msg}'")
    assert success, f"School ID Verification Failed: {msg}"
    assert meta['id_type'] == 'School ID'
    print("  [OK] School ID Dedicated Handler Passed!")

def test_national_id_verification():
    print("\nTesting Dedicated National ID / PhilSys Handler:")
    ocr_text = """
    REPUBLIKA NG PILIPINAS
    PHILIPPINE IDENTIFICATION CARD (PhilSys)
    PhilSys Number : 1234-5678-9012-3456
    Last Name : LANTAFE
    Given Name : MIKAELA YSABEL
    Middle Name : LINATOC
    Date of Birth : OCTOBER 25, 2004
    Address : LIPA CITY, BATANGAS
    """
    success, msg, meta = verify_national_id_fields(
        ocr_text,
        first_name="MIKAELA YSABEL", middle_name="LINATOC", last_name="LANTAFE",
        expected_id_no="1234567890123456", expected_birth_date="OCTOBER 25 2004"
    )
    print(f"  Result: Success={success}, Msg='{msg}'")
    assert success, f"National ID Verification Failed: {msg}"
    assert meta['id_type'] == 'National ID / Government ID'
    print("  [OK] National ID Dedicated Handler Passed!")

def test_id_router():
    print("\nTesting ID Verification Router:")
    text_school = "DE LA SALLE LIPA STUDENT NO 2021305751 MIKAELA LANTAFE"
    s1, m1, _ = verify_id_fields(text_school, "MIKAELA", "", "LANTAFE", id_type="School ID", expected_id_no="2021305751", expected_school_name="De La Salle Lipa")
    assert s1, f"Router School ID failed: {m1}"

    text_nat = "PHILIPPINE IDENTIFICATION CARD PHILSYS 1234567890123456 MIKAELA LANTAFE 25 OCT 2004"
    s2, m2, _ = verify_id_fields(text_nat, "MIKAELA", "", "LANTAFE", id_type="National ID", expected_id_no="1234567890123456", expected_birth_date="25 OCT 2004")
    assert s2, f"Router National ID failed: {m2}"

    print("  [OK] ID Verification Router Passed!")

if __name__ == '__main__':
    test_school_id_verification()
    test_national_id_verification()
    test_id_router()
    print("\nALL DEDICATED ID VERIFICATION PIPELINE TESTS PASSED SUCCESSFULLY!")
