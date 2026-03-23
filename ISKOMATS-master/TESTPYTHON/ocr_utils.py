"""
ocr_utils.py — Shared OCR helpers for ISKOMATS.

Imported by both Scholarship_ranking&applying_site.py and api_routes.py
so the easyocr model is only initialised once per process via a
module-level lazy singleton.
"""


# ── Lazy-load easyocr so import doesn't fail if the library is absent
# in environments where it isn't installed (e.g. CI).
_reader = None

def _get_reader():
    global _reader
    if _reader is None:
        import easyocr  # deferred import
        _reader = easyocr.Reader(['en'], gpu=False)
    return _reader


def normalize_text(text: str) -> str:
    """Lowercase and strip common punctuation for OCR comparison."""
    if not text:
        return ""
    return (
        text.lower()
        .replace(".", "")
        .replace(",", "")
        .replace("-", " ")
        .strip()
    )


def verify_id_with_ocr(id_image_data, name: str, address: str = "", address_image_data=None):
    """AI-assisted ID verification using OCR + fuzzy similarity.

    Parameters
    ----------
    id_image_data : bytes | None
        Raw image bytes (e.g. JPEG/PNG).
    name : str
        Full name to look for in the ID text.
    address : str, optional
        Address to look for in the ID text (empty → skip address check).
    address_image_data : bytes | None, optional
        Separate raw image bytes used specifically for address OCR. When omitted,
        the address is checked against the ID image OCR text.

    Returns
    -------
    (is_verified: bool, status: str, extracted_text: str)
    """
    # Defer import of heavy libraries for faster startup
    import numpy as np
    import cv2
    import pandas as pd
    from rapidfuzz import fuzz

    if id_image_data is None or (isinstance(id_image_data, float) and pd.isna(id_image_data)):
        return False, "No ID image provided", ""

    try:
        reader = _get_reader()

        def extract_normalized_text(image_data, missing_message):
            if image_data is None or (isinstance(image_data, float) and pd.isna(image_data)):
                return None, missing_message

            nparr = np.frombuffer(bytes(image_data), np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                return None, "Could not load image"

            img = cv2.resize(img, None, fx=1.2, fy=1.2, interpolation=cv2.INTER_CUBIC)
            ocr_results = reader.readtext(img, detail=0, paragraph=False)
            extracted_text = " ".join(ocr_results)
            return {
                'raw': extracted_text,
                'normalized': normalize_text(extracted_text)
            }, None

        id_ocr, id_error = extract_normalized_text(id_image_data, "No ID image provided")
        if id_error:
            return False, id_error, ""

        extracted_text = id_ocr['raw']
        extracted_text_norm = id_ocr['normalized']

        name_norm = normalize_text(name)

        # ── Name fuzzy matching ──────────────────────────────────────────
        r_ratio   = fuzz.ratio(name_norm, extracted_text_norm)
        r_partial  = fuzz.partial_ratio(name_norm, extracted_text_norm)
        r_token   = fuzz.token_sort_ratio(name_norm, extracted_text_norm)
        try:
            r_w = fuzz.WRatio(name_norm, extracted_text_norm)
        except Exception:
            r_w = 0

        name_similarity = max(r_ratio, r_partial, r_token, r_w)

        # Per-word best-match fallback
        name_words = [w for w in name_norm.split() if len(w) >= 2]
        ocr_words  = [w for w in extracted_text_norm.split() if w]
        per_word_scores = []
        if name_words and ocr_words:
            for nw in name_words:
                best = max((fuzz.partial_ratio(nw, ow) for ow in ocr_words), default=0)
                per_word_scores.append(best)
        if per_word_scores:
            per_word_avg = sum(per_word_scores) / len(per_word_scores)
            name_similarity = max(name_similarity, per_word_avg)

        NAME_THRESHOLD = 88

        # ── Address fuzzy matching (optional) ───────────────────────────
        if address:
            address_ocr, address_error = extract_normalized_text(
                address_image_data if address_image_data is not None else id_image_data,
                "No address document image provided"
            )
            if address_error:
                return False, address_error, extracted_text

            address_norm = normalize_text(address)
            address_text_norm = address_ocr['normalized']
            address_similarity = fuzz.partial_ratio(address_norm, address_text_norm)
            ADDRESS_THRESHOLD = 50
            important_addr_words = [w for w in address_norm.split() if len(w) >= 4]
            if important_addr_words:
                found_count = sum(1 for w in important_addr_words if w in address_text_norm)
                addr_found = found_count >= max(1, len(important_addr_words) - 1)
            else:
                addr_found = True
        else:
            address_similarity = 100  # skip check
            ADDRESS_THRESHOLD  = 0
            addr_found         = True

        # Fallback word containment
        name_found  = all(w in extracted_text_norm for w in name_words) and bool(name_words)
        fuzzy_pass  = name_similarity >= NAME_THRESHOLD and address_similarity >= ADDRESS_THRESHOLD
        fallback_pass = name_found and addr_found

        is_verified = fuzzy_pass or fallback_pass

        if is_verified:
            if fuzzy_pass:
                status = f"ID verified (Name: {name_similarity:.0f}%, Addr: {address_similarity:.0f}%)"
            else:
                status = f"ID verified via word-match (Name: {name_similarity:.0f}%, Addr: {address_similarity:.0f}%)"
        else:
            status = f"ID mismatch — name not found on ID (Name: {name_similarity:.0f}%, Addr: {address_similarity:.0f}%)"

        return is_verified, status, extracted_text

    except Exception as e:
        return False, f"OCR Error: {str(e)}", ""
