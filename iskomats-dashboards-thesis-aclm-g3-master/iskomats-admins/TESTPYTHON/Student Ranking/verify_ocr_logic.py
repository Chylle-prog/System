import re

def normalize_for_ocr(s):
    if not s: return ""
    return re.sub(r'[^a-z0-9\s]', ' ', s.lower()).strip()

def check_match(ocr_text, target_name, target_addr):
    norm_txt = normalize_for_ocr(ocr_text)
    
    # 1. Fuzzy Name Matching
    n_words = [w.strip() for w in normalize_for_ocr(target_name).split() if len(w.strip()) >= 2]
    if not n_words:
        n_words = [w.strip() for w in normalize_for_ocr(target_name).split() if w.strip()]
        
    f_count = sum(1 for word in n_words if word in norm_txt)
    m_ratio = f_count / len(n_words) if n_words else 0
    n_verified = m_ratio >= 0.8
    
    # 2. Address Matching
    a_verified = True
    if target_addr:
        norm_target_addr = normalize_for_ocr(target_addr)
        if norm_target_addr in norm_txt:
            a_verified = True
        else:
            a_words = [w.strip() for w in norm_target_addr.split() if len(w.strip()) >= 2]
            if not a_words:
                a_words = [w.strip() for w in norm_target_addr.split() if w.strip()]
            f_a_count = sum(1 for word in a_words if word in norm_txt)
            a_match_ratio = f_a_count / len(a_words) if a_words else 0
            a_verified = a_match_ratio >= 0.5
    
    return n_verified, a_verified, m_ratio

# Test Cases
test_cases = [
    {
        "name": "Ma. Theresa Doe",
        "ocr": "CERTIFICATE OF INDIGENCY\nThis is to certify that MA THERESA DOE...",
        "addr": "Lipa City",
        "expected": (True, True)
    },
    {
        "name": "John Doe Jr.",
        "ocr": "Name: JOHN DOE JR",
        "addr": "Lipa",
        "expected": (True, True)
    },
    {
        "name": "Bo Yu",
        "ocr": "Name: BO YU",
        "addr": None,
        "expected": (True, True)
    }
]

for i, tc in enumerate(test_cases):
    nv, av, ratio = check_match(tc["ocr"], tc["name"], tc["addr"])
    passed = (nv, av) == tc["expected"]
    print(f"Test {i+1}: {'PASSED' if passed else 'FAILED'}")
    print(f"  Expected Name: {tc['name']}")
    print(f"  Ratio: {ratio:.2f}")
    if not passed:
        print(f"  Actual: {(nv, av)} vs Expected: {tc['expected']}")
