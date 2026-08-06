import os
import sys

# Ensure backend root is in path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services.ocr_utils import extract_total_units_from_text, parse_cor_document

def test_azure_kvp_units():
    print("Testing 1. Azure Key-Value Priority Unit Extraction:")
    azure_kvp = {"total units": "12", "course": "BSIT"}
    val = extract_total_units_from_text("some text without units", azure_kvp=azure_kvp)
    print(f"  Extracted units: {val}")
    assert val == 12, f"Expected 12, got {val}"
    print("  [OK] Azure KVP Unit Extraction Passed!")

def test_dash_sanitizer_multi_line():
    print("\nTesting 2 & 3. Dash Sanitizer and Multi-Line Lookahead:")
    raw_text = """
    OFFICIAL CERTIFICATE OF REGISTRATION
    STUDENT NAME : LANTAFE, MIKAELA YSABEL
    TOTAL UNITS :
    --- 12 ---
    ASSESSED FEES :
    TUITION : 15000
    """
    val = extract_total_units_from_text(raw_text)
    print(f"  Extracted units from multi-line dashed line '--- 12 ---': {val}")
    assert val == 12, f"Expected 12, got {val}"

    raw_text_underscore = """
    TOTAL UNITS :
    ___ 21 ___
    """
    val2 = extract_total_units_from_text(raw_text_underscore)
    print(f"  Extracted units from multi-line underscored line '___ 21 ___': {val2}")
    assert val2 == 21, f"Expected 21, got {val2}"
    print("  [OK] Dash/Underscore Sanitizer and Multi-Line Lookahead Passed!")

if __name__ == '__main__':
    test_azure_kvp_units()
    test_dash_sanitizer_multi_line()
    print("\nALL UNIT EXTRACTION FIXES PASSED SUCCESSFULLY!")
