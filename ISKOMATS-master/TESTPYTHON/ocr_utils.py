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


def verify_id_with_ocr(id_image_data, first_name: str = "", last_name: str = "", town_city_municipality: str = "", address_image_data=None):
    """AI-assisted ID verification using OCR + fuzzy similarity.

    Parameters
    ----------
    id_image_data : bytes | None
        Raw image bytes for ID front (e.g. JPEG/PNG).
    first_name : str, optional
        First name to look for in the ID text.
    last_name : str, optional
        Last name to look for in the ID text.
    town_city_municipality : str, optional
        Town/city/municipality to look for in address document (empty → skip address check).
    address_image_data : bytes | None, optional
        Separate raw image bytes used specifically for address/indigency OCR.

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

        # ── First Name + Last Name fuzzy matching ──────────────────────────────
        first_name_norm = normalize_text(first_name)
        last_name_norm = normalize_text(last_name)
        
        # Match first name against ID
        first_name_similarity = 0
        if first_name_norm:
            r_ratio = fuzz.ratio(first_name_norm, extracted_text_norm)
            r_partial = fuzz.partial_ratio(first_name_norm, extracted_text_norm)
            r_token = fuzz.token_sort_ratio(first_name_norm, extracted_text_norm)
            try:
                r_w = fuzz.WRatio(first_name_norm, extracted_text_norm)
            except Exception:
                r_w = 0
            first_name_similarity = max(r_ratio, r_partial, r_token, r_w)
        
        # Match last name against ID
        last_name_similarity = 0
        if last_name_norm:
            r_ratio = fuzz.ratio(last_name_norm, extracted_text_norm)
            r_partial = fuzz.partial_ratio(last_name_norm, extracted_text_norm)
            r_token = fuzz.token_sort_ratio(last_name_norm, extracted_text_norm)
            try:
                r_w = fuzz.WRatio(last_name_norm, extracted_text_norm)
            except Exception:
                r_w = 0
            last_name_similarity = max(r_ratio, r_partial, r_token, r_w)
        
        # Per-word best-match fallback for names
        first_name_words = [w for w in first_name_norm.split() if len(w) >= 2]
        last_name_words = [w for w in last_name_norm.split() if len(w) >= 2]
        ocr_words = [w for w in extracted_text_norm.split() if w]
        
        if first_name_words and ocr_words:
            per_word_scores = []
            for nw in first_name_words:
                best = max((fuzz.partial_ratio(nw, ow) for ow in ocr_words), default=0)
                per_word_scores.append(best)
            if per_word_scores:
                first_name_similarity = max(first_name_similarity, sum(per_word_scores) / len(per_word_scores))
        
        if last_name_words and ocr_words:
            per_word_scores = []
            for nw in last_name_words:
                best = max((fuzz.partial_ratio(nw, ow) for ow in ocr_words), default=0)
                per_word_scores.append(best)
            if per_word_scores:
                last_name_similarity = max(last_name_similarity, sum(per_word_scores) / len(per_word_scores))

        NAME_THRESHOLD = 85
        name_verified = (first_name_similarity >= NAME_THRESHOLD or not first_name_norm) and \
                       (last_name_similarity >= NAME_THRESHOLD or not last_name_norm)

        # ── Town/City/Municipality fuzzy matching (optional) ───────────────────────────
        if town_city_municipality:
            address_ocr, address_error = extract_normalized_text(
                address_image_data if address_image_data is not None else id_image_data,
                "No address document image provided"
            )
            if address_error:
                return False, address_error, extracted_text

            town_norm = normalize_text(town_city_municipality)
            address_text_norm = address_ocr['normalized']
            town_similarity = fuzz.partial_ratio(town_norm, address_text_norm)
            TOWN_THRESHOLD = 50
            
            # Check if key words from town are present
            town_words = [w for w in town_norm.split() if len(w) >= 3]
            if town_words:
                found_count = sum(1 for w in town_words if w in address_text_norm)
                town_found = found_count >= max(1, len(town_words) - 1)
            else:
                town_found = True
        else:
            town_similarity = 100  # skip check
            TOWN_THRESHOLD = 0
            town_found = True

        # Final verification logic
        fuzzy_pass = name_verified and town_similarity >= TOWN_THRESHOLD and town_found
        is_verified = fuzzy_pass

        if is_verified:
            status = f"ID verified (First: {first_name_similarity:.0f}%, Last: {last_name_similarity:.0f}%, Town: {town_similarity:.0f}%)"
        else:
            status = f"ID mismatch (First: {first_name_similarity:.0f}%, Last: {last_name_similarity:.0f}%, Town: {town_similarity:.0f}%)"

        return is_verified, status, extracted_text

    except Exception as e:
        return False, f"OCR Error: {str(e)}", ""


def verify_face_with_id(face_image_data, id_image_data):
    """AI-assisted face verification by comparing face photo with ID photo.
    
    Uses facial recognition to determine if the face in the uploaded photo
    matches the face in the ID document.

    Parameters
    ----------
    face_image_data : bytes | None
        Raw image bytes of the submitted face photo (e.g. JPEG/PNG).
    id_image_data : bytes | None
        Raw image bytes of the ID document photo (e.g. JPEG/PNG).

    Returns
    -------
    (is_verified: bool, status: str, confidence: float)
    """
    import numpy as np
    import cv2
    import pandas as pd
    
    if face_image_data is None or (isinstance(face_image_data, float) and pd.isna(face_image_data)):
        return False, "No face photo provided", 0.0
    
    if id_image_data is None or (isinstance(id_image_data, float) and pd.isna(id_image_data)):
        return False, "No ID image provided", 0.0
    
    try:
        # Lazy import face_recognition for optional dependency
        try:
            import face_recognition
        except ImportError:
            return False, "Face recognition library not installed", 0.0
        
        def load_image_for_face_recognition(image_data):
            """Load and decode image for face_recognition library."""
            nparr = np.frombuffer(bytes(image_data), np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                return None
            # Convert BGR to RGB for face_recognition
            return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        
        face_img = load_image_for_face_recognition(face_image_data)
        id_img = load_image_for_face_recognition(id_image_data)
        
        if face_img is None:
            return False, "Could not load face photo", 0.0
        if id_img is None:
            return False, "Could not load ID image", 0.0
        
        # Extract face encodings
        face_encodings = face_recognition.face_encodings(face_img)
        id_encodings = face_recognition.face_encodings(id_img)
        
        if not face_encodings:
            return False, "No face detected in submitted photo", 0.0
        if not id_encodings:
            return False, "No face detected in ID document", 0.0
        
        # Get the first face encoding from each image
        face_encoding = face_encodings[0]
        id_encoding = id_encodings[0]
        
        # Compare faces using Euclidean distance
        # face_recognition uses distance threshold of 0.6 for face_distance
        distance = face_recognition.face_distance([id_encoding], face_encoding)[0]
        
        # Convert distance to confidence (0-100%)
        # Distance of 0 = perfect match, distance of 1.0 = no match
        # We'll use: confidence = (1 - distance) * 100
        confidence = max(0.0, min(100.0, (1.0 - distance) * 100))
        
        FACE_THRESHOLD = 60  # 60% confidence threshold
        is_verified = confidence >= FACE_THRESHOLD
        
        if is_verified:
            status = f"Face verified (Confidence: {confidence:.1f}%)"
        else:
            status = f"Face verification failed - faces do not match (Confidence: {confidence:.1f}%)"
        
        return is_verified, status, confidence
        
    except ImportError:
        return False, "Face recognition not available", 0.0
    except Exception as e:
        return False, f"Face verification error: {str(e)}", 0.0
