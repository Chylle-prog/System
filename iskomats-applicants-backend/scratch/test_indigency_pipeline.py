import os
import sys

# Ensure backend root is in path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services.ocr_utils import extract_semantic_anchors_from_indigency, verify_indigency_fields

def test_english_indigency_certificate():
    print("Testing English Barangay Indigency Certificate:")
    text = """
    REPUBLIC OF THE PHILIPPINES
    PROVINCE OF BATANGAS
    CITY OF LIPA
    BARANGAY INOSLOBAN
    OFFICE OF THE BARANGAY CHAIRMAN
    
    BARANGAY CERTIFICATE OF INDIGENCY
    
    TO WHOM IT MAY CONCERN:
    
    This is to certify that MIKAELA YSABEL LINATOC LANTAFE, of legal age, is a bonafide resident of
    Barangay Inosloban, Lipa City, Batangas.
    
    It is further certified that the above-named individual belongs to an indigent family in this barangay
    with no stable source of income.
    
    Issued this 24th day of July 2026.
    """
    anchors = extract_semantic_anchors_from_indigency(text)
    print("  Extracted Anchors:", anchors)
    assert anchors['candidate_name'] is not None and "MIKAELA" in anchors['candidate_name']
    
    success, msg, meta = verify_indigency_fields(
        text,
        first_name="MIKAELA YSABEL", middle_name="LINATOC", last_name="LANTAFE",
        expected_address="Inosloban, Lipa City, Batangas"
    )
    print(f"  Result: Success={success}, Msg='{msg}'")
    assert success, f"English Indigency Verification Failed: {msg}"
    print("  [OK] English Barangay Indigency Test Passed!")

def test_tagalog_indigency_certificate():
    print("\nTesting Tagalog Barangay Indigency Certificate:")
    text = """
    REPUBLIKA NG PILIPINAS
    LUNGSOD NG LIPA
    BARANGAY INOSLUBAN
    
    KATIBAYAN NG KAWALANG HANAPBUHAY AT KAPUS-PALAD
    
    SA KINAUUKULAN:
    
    Ito ay patunay na si MIKAELA YSABEL LINATOC LANTAFE ay isang tunay na mamamayan ng
    Barangay Inosluban, Lungsod ng Lipa, Batangas.
    
    Ang kanyang pamilya ay kabilang sa mga residenteng may kawalang sapat na hanapbuhay sa aming barangay.
    """
    anchors = extract_semantic_anchors_from_indigency(text)
    print("  Extracted Anchors:", anchors)
    assert anchors['candidate_name'] is not None and "MIKAELA" in anchors['candidate_name']

    success, msg, meta = verify_indigency_fields(
        text,
        first_name="MIKAELA YSABEL", middle_name="LINATOC", last_name="LANTAFE",
        expected_address="Inosloban, Lipa City"
    )
    print(f"  Result: Success={success}, Msg='{msg}'")
    assert success, f"Tagalog Indigency Verification Failed: {msg}"
    print("  [OK] Tagalog Barangay Indigency Test Passed!")

def test_barangay_residency_certificate():
    print("\nTesting Barangay Residency Certificate:")
    text = """
    REPUBLIC OF THE PHILIPPINES
    CITY OF LIPA
    BARANGAY INOSLOBAN
    
    CERTIFICATE OF BARANGAY RESIDENCY
    
    TO WHOM IT MAY CONCERN:
    
    This is to certify that MIKAELA YSABEL LINATOC LANTAFE is a bonafide resident of
    Barangay Inosloban, Lipa City, Batangas, and has been residing in this barangay.
    """
    success, msg, meta = verify_indigency_fields(
        text,
        first_name="MIKAELA YSABEL", middle_name="LINATOC", last_name="LANTAFE",
        expected_address="Inosloban, Lipa City", is_residency_doc=True
    )
    print(f"  Result: Success={success}, Msg='{msg}'")
    assert success, f"Residency Verification Failed: {msg}"
    print("  [OK] Barangay Residency Test Passed!")

if __name__ == '__main__':
    test_english_indigency_certificate()
    test_tagalog_indigency_certificate()
    test_barangay_residency_certificate()
    print("\nALL INDIGENCY & RESIDENCY OCR PIPELINE TESTS PASSED SUCCESSFULLY!")
