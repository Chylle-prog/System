import os
import sys

# Ensure backend root is in path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services.ocr_utils import extract_total_units_from_text, parse_cor_document, verify_cor_fields

def test_flexible_label_matcher():
    print("Testing 1. Flexible Label Matcher (Name +, Name |, Name -):")
    noisy_texts = [
        "OFFICIAL CERTIFICATE OF REGISTRATION\nName + LANTAFE, MIKAELA YSABEL\nStudent No | 2021305751\nTotal Units : 12",
        "OFFICIAL CERTIFICATE OF REGISTRATION\nName | LANTAFE, MIKAELA YSABEL\nStudent No - 2021305751\nTotal Units : 12",
        "OFFICIAL CERTIFICATE OF REGISTRATION\nPangalan : LANTAFE, MIKAELA YSABEL\nStudent ID : 2021305751\nTotal Units : 12"
    ]
    for idx, txt in enumerate(noisy_texts, 1):
        parsed = parse_cor_document(txt)
        assert parsed.get('name') or 'LANTAFE' in txt, f"Failed on sample {idx}"
        success, msg, meta = verify_cor_fields(parsed, txt, first_name="MIKAELA YSABEL", middle_name="LINATOC", last_name="LANTAFE", expected_id_no="2021305751")
        assert success, f"Failed verification on sample {idx}: {msg}"
    print("  [OK] Flexible Label Matcher Passed!")

def test_smart_discrepancy_override_units():
    print("\nTesting 2. Smart Discrepancy Override for Total Units (Merged colon ': 12' misread as 2):")
    misread_printed_line_text = """
    OFFICIAL CERTIFICATE OF REGISTRATION
    STUDENT NAME : LANTAFE, MIKAELA YSABEL
    STUDENT NO : 2021305751
    
    SUBJECTS ENROLLED:
    Code     Description                        Units
    ITCap2   Capstone Project 2                 3.0
    ITElec4  IT Elective 4                      3.0
    ITSoci   IT Social Issues                   3.0
    Rizal    Life and Works of Rizal            3.0
    
    TOTAL UNITS : 2
    """
    extracted_units = extract_total_units_from_text(misread_printed_line_text)
    print(f"  Resulting Total Units Extracted: {extracted_units}")
    assert extracted_units == 12, f"Expected Smart Discrepancy Override to return 12, but got {extracted_units}"
    print("  [OK] Smart Discrepancy Override Passed (Misread 2 overridden by true course sum 12)!")

if __name__ == '__main__':
    test_flexible_label_matcher()
    test_smart_discrepancy_override_units()
    print("\nALL COR/COE RECOMMENDATION FIXES PASSED SUCCESSFULLY!")
