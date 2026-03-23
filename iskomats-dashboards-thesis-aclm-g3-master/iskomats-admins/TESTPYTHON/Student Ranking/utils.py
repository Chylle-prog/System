
_reader = None

def _get_reader():
    global _reader
    if _reader is None:
        import easyocr
        _reader = easyocr.Reader(['en'], gpu=False)
    return _reader

def normalize_text(text):
    if not text:
        return ""
    return (
        text.lower()
        .replace(".", "")
        .replace(",", "")
        .replace("-", " ")
        .strip()
    )

def verify_id_with_ocr(id_image_data, name, address):
    # Defer import of heavy libraries for faster startup
    import numpy as np
    import cv2
    import pandas as pd
    from rapidfuzz import fuzz

    if id_image_data is None or (isinstance(id_image_data, float) and pd.isna(id_image_data)):
        return False, "No ID image provided", ""

    try:
        nparr = np.frombuffer(id_image_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return False, "Could not load image", ""

        img = cv2.resize(img, None, fx=1.2, fy=1.2, interpolation=cv2.INTER_CUBIC)

        reader = _get_reader()
        ocr_results = reader.readtext(img, detail=0, paragraph=False)
        extracted_text = " ".join(ocr_results)
        extracted_text_norm = normalize_text(extracted_text)

        name_norm = normalize_text(name)
        address_norm = normalize_text(address)

        r_ratio   = fuzz.ratio(name_norm, extracted_text_norm)
        r_partial = fuzz.partial_ratio(name_norm, extracted_text_norm)
        r_token   = fuzz.token_sort_ratio(name_norm, extracted_text_norm)
        r_w       = fuzz.WRatio(name_norm, extracted_text_norm) if 'WRatio' in dir(fuzz) else 0

        name_similarity = max(r_ratio, r_partial, r_token, r_w)

        # Per-word fallback
        name_words = [w for w in name_norm.split() if len(w) >= 2]
        ocr_words  = [w for w in extracted_text_norm.split() if w]
        per_word_scores = []
        if name_words and ocr_words:
            for nw in name_words:
                best = max((fuzz.partial_ratio(nw, ow) for ow in ocr_words), default=0)
                per_word_scores.append(best)
        if per_word_scores:
            name_similarity = max(name_similarity, sum(per_word_scores) / len(per_word_scores))

        address_similarity = fuzz.partial_ratio(address_norm, extracted_text_norm)

        NAME_THRESHOLD    = 92   # slightly lowered — tune as needed
        ADDRESS_THRESHOLD = 68

        fuzzy_pass   = name_similarity >= NAME_THRESHOLD and address_similarity >= ADDRESS_THRESHOLD
        name_found   = all(w in extracted_text_norm for w in name_words) and name_words
        important_addr = [w for w in address_norm.split() if len(w) >= 4]
        addr_found   = sum(1 for w in important_addr if w in extracted_text_norm) >= max(1, len(important_addr)-1)

        is_verified = fuzzy_pass or (name_found and addr_found)

        if is_verified:
            status = f"Verified (Name:{name_similarity:.0f}%, Addr:{address_similarity:.0f}%)"
            if not fuzzy_pass:
                status = f"Verified (fallback; {status})"
        else:
            status = f"Mismatch (Name:{name_similarity:.0f}%, Addr:{address_similarity:.0f}%)"

        return is_verified, status, extracted_text

    except Exception as e:
        return False, f"OCR error: {str(e)}", ""
