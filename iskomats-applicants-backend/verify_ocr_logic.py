import re
import difflib

def normalize_for_ocr(s):
    if not s: return ""
    return re.sub(r'[^a-z0-9\s]', ' ', s.lower()).strip()

def check_match(ocr_text, target_name, target_addr):
    norm_txt = normalize_for_ocr(ocr_text)
    all_ocr_words = norm_txt.split()
    
    # 1. Fuzzy Name Matching
    n_words = [w.strip() for w in normalize_for_ocr(target_name).split() if len(w.strip()) >= 2]
    if not n_words:
        n_words = [w.strip() for w in normalize_for_ocr(target_name).split() if w.strip()]
        
    f_count = 0
    for word in n_words:
        if word in norm_txt:
            f_count += 1
            continue
        
        is_fuzzy = False
        for ocr_w in all_ocr_words:
            if len(ocr_w) < len(word) - 1: continue 
            if difflib.SequenceMatcher(None, word, ocr_w).ratio() >= 0.8:
                is_fuzzy = True
                break
        if is_fuzzy: f_count += 1
        
    m_ratio = f_count / len(n_words) if n_words else 0
    n_verified = m_ratio >= 0.8
    return n_verified, m_ratio

# Test Cases
test_cases = [
    {
        "name": "Alexie Chyle Magbuhat",
        "ocr": "This is to certify that Mr. Alexie Chyle Magbuhat...",
        "expected": True
    },
    {
        "name": "Alexie Chyle Magbuhat",
        "ocr": "This is to certify that Mr. Alexle Chyle Mabbuhat...", # 2 typos: Alexle (i->l), Mabbuhat (g->b)
        "expected": True
    }
]

print("--- Testing Fuzzy Name Matching ---")
for i, tc in enumerate(test_cases):
    nv, ratio = check_match(tc["ocr"], tc["name"], None)
    passed = nv == tc["expected"]
    print(f"Test {i+1}: {'PASSED' if passed else 'FAILED'} (Ratio: {ratio:.2f})")
    print(f"  Expected: {tc['name']}")
    print(f"  OCR:      {tc['ocr']}")
