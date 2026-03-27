import os
import sys


_reader = None


def _get_reader():
    global _reader
    if _reader is None:
        if os.environ.get('SKIP_HEAVY_IMPORTS') == 'True':
            print("[OCR] Skipping easyocr due to SKIP_HEAVY_IMPORTS=True", flush=True)
            _reader = False
            return None
            
        try:
            import easyocr
            # Note: Reader(['en'], gpu=False) downloads ~300MB of models on first run
            # which might trigger OOM on low-memory instances.
            _reader = easyocr.Reader(['en'], gpu=False)
        except (ImportError, Exception) as e:
            print(f"[OCR] Warning: Could not initialize easyocr: {str(e)}")
            _reader = False # Sentinel for "failed to load"
    return _reader if _reader is not False else None



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


def verify_id_with_ocr(id_image_data, first_name: str = '', last_name: str = '', town_city_municipality: str = '', address_image_data=None):
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
    import cv2
    import numpy as np
    import pandas as pd
    from rapidfuzz import fuzz

    if id_image_data is None or (isinstance(id_image_data, float) and pd.isna(id_image_data)):
        return False, 'No ID image provided', ''

    try:
        reader = _get_reader()
        if not reader:
            return False, 'OCR service temporarily unavailable (Low memory mode)', ''

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

        # ── First Name + Last Name fuzzy matching ──────────────────────────────
        first_name_norm = normalize_text(first_name)
        last_name_norm = normalize_text(last_name)
        
        # Match first name against ID
        first_name_similarity = 0
        if first_name_norm:
            ratio = fuzz.ratio(first_name_norm, extracted_text_norm)
            partial = fuzz.partial_ratio(first_name_norm, extracted_text_norm)
            token = fuzz.token_sort_ratio(first_name_norm, extracted_text_norm)
            try:
                weighted = fuzz.WRatio(first_name_norm, extracted_text_norm)
            except Exception:
                weighted = 0
            first_name_similarity = max(ratio, partial, token, weighted)
        
        # Match last name against ID
        last_name_similarity = 0
        if last_name_norm:
            ratio = fuzz.ratio(last_name_norm, extracted_text_norm)
            partial = fuzz.partial_ratio(last_name_norm, extracted_text_norm)
            token = fuzz.token_sort_ratio(last_name_norm, extracted_text_norm)
            try:
                weighted = fuzz.WRatio(last_name_norm, extracted_text_norm)
            except Exception:
                weighted = 0
            last_name_similarity = max(ratio, partial, token, weighted)
        
        # Per-word best-match fallback for names
        first_name_words = [word for word in first_name_norm.split() if len(word) >= 2]
        last_name_words = [word for word in last_name_norm.split() if len(word) >= 2]
        ocr_words = [word for word in extracted_text_norm.split() if word]
        
        if first_name_words and ocr_words:
            per_word_scores = []
            for name_word in first_name_words:
                best_score = max((fuzz.partial_ratio(name_word, ocr_word) for ocr_word in ocr_words), default=0)
                per_word_scores.append(best_score)
            if per_word_scores:
                first_name_similarity = max(first_name_similarity, sum(per_word_scores) / len(per_word_scores))
        
        if last_name_words and ocr_words:
            per_word_scores = []
            for name_word in last_name_words:
                best_score = max((fuzz.partial_ratio(name_word, ocr_word) for ocr_word in ocr_words), default=0)
                per_word_scores.append(best_score)
            if per_word_scores:
                last_name_similarity = max(last_name_similarity, sum(per_word_scores) / len(per_word_scores))

        name_threshold = 85
        name_verified = (first_name_similarity >= name_threshold or not first_name_norm) and \
                       (last_name_similarity >= name_threshold or not last_name_norm)

        # ── Town/City/Municipality fuzzy matching (optional) ───────────────────────────
        if town_city_municipality:
            address_ocr, address_error = extract_normalized_text(
                address_image_data if address_image_data is not None else id_image_data,
                'No address document image provided'
            )
            if address_error:
                return False, address_error, extracted_text

            town_norm = normalize_text(town_city_municipality)
            address_text_norm = address_ocr['normalized']
            town_similarity = fuzz.partial_ratio(town_norm, address_text_norm)
            town_threshold = 50
            
            # Check if key words from town are present
            town_words = [word for word in town_norm.split() if len(word) >= 3]
            if town_words:
                found_count = sum(1 for word in town_words if word in address_text_norm)
                town_found = found_count >= max(1, len(town_words) - 1)
            else:
                town_found = True
        else:
            town_similarity = 100  # skip check
            town_threshold = 0
            town_found = True

        # Final verification logic
        fuzzy_pass = name_verified and town_similarity >= town_threshold and town_found
        is_verified = fuzzy_pass

        if is_verified:
            status = f'ID verified (First: {first_name_similarity:.0f}%, Last: {last_name_similarity:.0f}%, Town: {town_similarity:.0f}%)'
        else:
            status = f'ID mismatch (First: {first_name_similarity:.0f}%, Last: {last_name_similarity:.0f}%, Town: {town_similarity:.0f}%)'

        return is_verified, status, extracted_text
    except Exception as exc:
        return False, f'OCR Error: {str(exc)}', ''


def verify_face_with_id(face_image_data, id_image_data):
    """Face verification using DeepFace to compare face photo with ID photo.
    
    Uses DeepFace's face recognition to determine if the face in the uploaded photo
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
        return False, 'No face photo provided', 0.0
    
    if id_image_data is None or (isinstance(id_image_data, float) and pd.isna(id_image_data)):
        return False, 'No ID image provided', 0.0
    
    try:
        if os.environ.get('SKIP_HEAVY_IMPORTS') == 'True':
            print("[FACE] Skipping deepface due to SKIP_HEAVY_IMPORTS=True", flush=True)
            return False, 'Face verification service skipped (Debug mode)', 0.0

        try:
            from deepface import DeepFace
        except (ImportError, Exception):
            return False, 'Face verification service unavailable (Low memory mode)', 0.0
        
        def load_image_from_bytes(image_data):
            """Load image from bytes data."""
            nparr = np.frombuffer(bytes(image_data), np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            return img
        
        face_img = load_image_from_bytes(face_image_data)
        id_img = load_image_from_bytes(id_image_data)
        
        if face_img is None:
            return False, 'Could not load face photo', 0.0
        if id_img is None:
            return False, 'Could not load ID image', 0.0
        
        # Save temporary image files for DeepFace processing
        import tempfile
        import os as os_module
        
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                face_path = os_module.path.join(temp_dir, 'face.jpg')
                id_path = os_module.path.join(temp_dir, 'id.jpg')
                
                cv2.imwrite(face_path, face_img)
                cv2.imwrite(id_path, id_img)
                
                # Use DeepFace to verify faces
                result = DeepFace.verify(face_path, id_path, model_name='VGG-Face', enforce_detection=False)
                
                is_verified = result['verified']
                distance = result['distance']
                
                # Convert distance to confidence (0-100%)
                # Smaller distance = more similar, larger distance = different
                confidence = max(0.0, min(100.0, (1.0 - distance) * 100)) if distance < 1.0 else 0.0
                
                if is_verified:
                    status = f'Face verified (Distance: {distance:.4f}, Confidence: {confidence:.1f}%)'
                else:
                    status = f'Face verification failed - faces do not match (Distance: {distance:.4f}, Confidence: {confidence:.1f}%)'
                
                return is_verified, status, confidence
                
        except ImportError:
            return False, 'DeepFace not available', 0.0
        except Exception as e:
            return False, f'Face verification error: {str(e)}', 0.0
            
    except Exception as e:
        return False, f'Face verification error: {str(e)}', 0.0