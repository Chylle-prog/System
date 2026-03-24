"""
Shared OCR helpers for ISKOMATS.

Imported by student web routes and student API routes so the easyocr model
is only initialised once per process via a module-level lazy singleton.
"""


_reader = None


def _get_reader():
    global _reader
    if _reader is None:
        import easyocr
        _reader = easyocr.Reader(['en'], gpu=False)
    return _reader


def normalize_text(text: str) -> str:
    if not text:
        return ''
    return (
        text.lower()
        .replace('.', '')
        .replace(',', '')
        .replace('-', ' ')
        .strip()
    )


def verify_id_with_ocr(id_image_data, name: str, address: str = '', address_image_data=None):
    import cv2
    import numpy as np
    import pandas as pd
    from rapidfuzz import fuzz

    if id_image_data is None or (isinstance(id_image_data, float) and pd.isna(id_image_data)):
        return False, 'No ID image provided', ''

    try:
        reader = _get_reader()

        def extract_normalized_text(image_data, missing_message):
            if image_data is None or (isinstance(image_data, float) and pd.isna(image_data)):
                return None, missing_message

            nparr = np.frombuffer(bytes(image_data), np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                return None, 'Could not load image'

            img = cv2.resize(img, None, fx=1.2, fy=1.2, interpolation=cv2.INTER_CUBIC)
            ocr_results = reader.readtext(img, detail=0, paragraph=False)
            extracted_text = ' '.join(ocr_results)
            return {
                'raw': extracted_text,
                'normalized': normalize_text(extracted_text),
            }, None

        id_ocr, id_error = extract_normalized_text(id_image_data, 'No ID image provided')
        if id_error:
            return False, id_error, ''

        extracted_text = id_ocr['raw']
        extracted_text_norm = id_ocr['normalized']
        name_norm = normalize_text(name)

        ratio = fuzz.ratio(name_norm, extracted_text_norm)
        partial = fuzz.partial_ratio(name_norm, extracted_text_norm)
        token = fuzz.token_sort_ratio(name_norm, extracted_text_norm)
        try:
            weighted = fuzz.WRatio(name_norm, extracted_text_norm)
        except Exception:
            weighted = 0

        name_similarity = max(ratio, partial, token, weighted)
        name_words = [word for word in name_norm.split() if len(word) >= 2]
        ocr_words = [word for word in extracted_text_norm.split() if word]
        per_word_scores = []
        if name_words and ocr_words:
            for name_word in name_words:
                best_score = max((fuzz.partial_ratio(name_word, ocr_word) for ocr_word in ocr_words), default=0)
                per_word_scores.append(best_score)
        if per_word_scores:
            name_similarity = max(name_similarity, sum(per_word_scores) / len(per_word_scores))

        name_threshold = 88

        if address:
            address_ocr, address_error = extract_normalized_text(
                address_image_data if address_image_data is not None else id_image_data,
                'No address document image provided',
            )
            if address_error:
                return False, address_error, extracted_text

            address_norm = normalize_text(address)
            address_text_norm = address_ocr['normalized']
            address_similarity = fuzz.partial_ratio(address_norm, address_text_norm)
            address_threshold = 50
            important_addr_words = [word for word in address_norm.split() if len(word) >= 4]
            if important_addr_words:
                found_count = sum(1 for word in important_addr_words if word in address_text_norm)
                addr_found = found_count >= max(1, len(important_addr_words) - 1)
            else:
                addr_found = True
        else:
            address_similarity = 100
            address_threshold = 0
            addr_found = True

        name_found = all(word in extracted_text_norm for word in name_words) and bool(name_words)
        fuzzy_pass = name_similarity >= name_threshold and address_similarity >= address_threshold
        fallback_pass = name_found and addr_found
        is_verified = fuzzy_pass or fallback_pass

        if is_verified:
            if fuzzy_pass:
                status = f'ID verified (Name: {name_similarity:.0f}%, Addr: {address_similarity:.0f}%)'
            else:
                status = f'ID verified via word-match (Name: {name_similarity:.0f}%, Addr: {address_similarity:.0f}%)'
        else:
            status = f'ID mismatch — name not found on ID (Name: {name_similarity:.0f}%, Addr: {address_similarity:.0f}%)'

        return is_verified, status, extracted_text
    except Exception as exc:
        return False, f'OCR Error: {str(exc)}', ''