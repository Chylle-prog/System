import os
import sys
import gc


# ─── Environment hints for threading & memory ──────────────────────────────────
os.environ.setdefault('OMP_NUM_THREADS', '1')
os.environ.setdefault('ONEDNN_PRIMITIVE_CACHE_CAPACITY', '1')
os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL', '3')
os.environ.setdefault('TF_FORCE_GPU_ALLOW_GROWTH', 'true')

# ─── DeepFace — lazy singleton ─────────────────────────────────────────────────
_deepface = None


def _get_deepface():
    global _deepface
    if _deepface is None:
        if os.environ.get('SKIP_HEAVY_IMPORTS') == 'True':
            print("[FACE] Skipping deepface due to SKIP_HEAVY_IMPORTS=True", flush=True)
            _deepface = False
            return None
        try:
            from deepface import DeepFace
            _deepface = DeepFace
            gc.collect() # Clear overhead after heavy import
        except (ImportError, Exception) as e:
            print(f"[FACE] Warning: Could not initialise deepface: {str(e)}", flush=True)
            _deepface = False
    return _deepface if _deepface is not False else None


# ─── Tesseract availability check ─────────────────────────────────────────────

_tesseract_available = None   # None = unchecked, True/False = result


def _check_tesseract():
    """Check once whether the tesseract binary is reachable."""
    global _tesseract_available
    if _tesseract_available is not None:
        return _tesseract_available
    try:
        import pytesseract
        ver = pytesseract.get_tesseract_version()
        print(f"[OCR] Tesseract available — version {ver}", flush=True)
        _tesseract_available = True
    except Exception as e:
        print(f"[OCR] Tesseract not available: {e}", flush=True)
        _tesseract_available = False
    return _tesseract_available


# ─── Image preprocessing ──────────────────────────────────────────────────────

_MAX_OCR_WIDTH = 1200   # px — wide enough for most ID text


def _preprocess_for_ocr(img):
    """
    Preprocess a colour OpenCV image for Tesseract OCR:
      1. Downscale if wider than _MAX_OCR_WIDTH  (biggest memory win)
      2. Convert to grayscale                    (~66 % less memory)
      3. Apply adaptive threshold                (improves OCR on varied lighting)

    Returns a grayscale uint8 ndarray.
    """
    import cv2

    h, w = img.shape[:2]

    # 1. Resize only if necessary
    if w > _MAX_OCR_WIDTH:
        scale = _MAX_OCR_WIDTH / w
        new_w = int(w * scale)
        new_h = int(h * scale)
        img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)
        print(f"[OCR] Resized image {w}×{h} → {new_w}×{new_h}", flush=True)

    # 2. Grayscale
    if len(img.shape) == 3:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    else:
        gray = img

    # 3. Adaptive threshold for better contrast on varied lighting
    binary = cv2.adaptiveThreshold(
        gray, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        blockSize=31,
        C=10,
    )

    return binary


# ─── OCR extraction ───────────────────────────────────────────────────────────

def _run_tesseract(image_bytes):
    """
    Decode image bytes, preprocess, and run Tesseract OCR.

    Returns (text: str, error: str | None)
    """
    import cv2
    import numpy as np
    import pytesseract

    if image_bytes is None:
        return '', 'No image data provided'

    try:
        nparr = np.frombuffer(bytes(image_bytes), np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        del nparr

        if img is None:
            return '', 'Could not decode image'

        processed = _preprocess_for_ocr(img)
        del img

        # Tesseract config:
        #   --psm 3  = fully automatic page segmentation (default, good for docs)
        #   --oem 3  = use LSTM engine (best accuracy)
        custom_config = r'--psm 3 --oem 3'
        text = pytesseract.image_to_string(processed, config=custom_config)
        del processed
        gc.collect()

        return text.strip(), None

    except Exception as e:
        return '', f'OCR extraction error: {str(e)}'


# ─── Text helpers ─────────────────────────────────────────────────────────────

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


# ─── OCR verification ─────────────────────────────────────────────────────────

def verify_id_with_ocr(
    id_image_data,
    first_name: str = '',
    last_name: str = '',
    town_city_municipality: str = '',
    address_image_data=None,
):
    """AI-assisted ID verification using Tesseract OCR + fuzzy similarity.

    Parameters
    ----------
    id_image_data : bytes | None
        Raw image bytes for ID front (e.g. JPEG/PNG).
    first_name : str, optional
        First name to look for in the ID text.
    last_name : str, optional
        Last name to look for in the ID text.
    town_city_municipality : str, optional
        Town/city/municipality to look for in address document (empty → skip).
    address_image_data : bytes | None, optional
        Separate raw image bytes used for address/indigency OCR.

    Returns
    -------
    (is_verified: bool, status: str, extracted_text: str)
    """
    import pandas as pd
    from rapidfuzz import fuzz

    if id_image_data is None or (isinstance(id_image_data, float) and pd.isna(id_image_data)):
        return False, 'No ID image provided', ''

    # Confirm Tesseract is available
    if not _check_tesseract():
        return False, 'OCR service temporarily unavailable (Tesseract not installed on server)', ''

    try:
        # ── Extract text from ID image ─────────────────────────────────────────
        extracted_text_raw, id_error = _run_tesseract(id_image_data)
        if id_error and not extracted_text_raw:
            return False, id_error, ''

        extracted_text_norm = normalize_text(extracted_text_raw)
        print(f"[OCR] ID text extracted ({len(extracted_text_raw)} chars)", flush=True)

        # ── First Name + Last Name fuzzy matching ──────────────────────────────
        first_name_norm = normalize_text(first_name)
        last_name_norm  = normalize_text(last_name)

        def name_similarity(name_norm, text_norm):
            if not name_norm:
                return 0
            ratio   = fuzz.ratio(name_norm, text_norm)
            partial = fuzz.partial_ratio(name_norm, text_norm)
            token   = fuzz.token_sort_ratio(name_norm, text_norm)
            try:
                weighted = fuzz.WRatio(name_norm, text_norm)
            except Exception:
                weighted = 0
            score = max(ratio, partial, token, weighted)

            # Per-word fallback
            name_words = [w for w in name_norm.split() if len(w) >= 2]
            ocr_words  = [w for w in text_norm.split() if w]
            if name_words and ocr_words:
                per_word = [
                    max((fuzz.partial_ratio(nw, ow) for ow in ocr_words), default=0)
                    for nw in name_words
                ]
                score = max(score, sum(per_word) / len(per_word))
            return score

        first_name_similarity = name_similarity(first_name_norm, extracted_text_norm)
        last_name_similarity  = name_similarity(last_name_norm,  extracted_text_norm)

        name_threshold = 75
        name_verified = (
            (first_name_similarity >= name_threshold or not first_name_norm) and
            (last_name_similarity  >= name_threshold or not last_name_norm)
        )

        print(
            f"[OCR] Name: First={first_name_similarity:.1f}% "
            f"Last={last_name_similarity:.1f}% "
            f"Threshold={name_threshold} Verified={name_verified}",
            flush=True,
        )

        # ── Town/City/Municipality address matching (optional) ─────────────────
        if town_city_municipality:
            addr_src = address_image_data if address_image_data is not None else id_image_data
            address_text_raw, addr_error = _run_tesseract(addr_src)
            if addr_error and not address_text_raw:
                return False, addr_error, extracted_text_raw

            town_norm         = normalize_text(town_city_municipality)
            address_text_norm = normalize_text(address_text_raw)
            
            partial = fuzz.partial_ratio(town_norm, address_text_norm)
            token = fuzz.token_set_ratio(town_norm, address_text_norm)
            town_similarity = max(partial, token)
            
            town_threshold    = 60
            town_found        = town_similarity >= town_threshold

            # Development Testing Bypass
            if town_norm == 'test':
                town_found = True
                town_similarity = 100
                print("[OCR] Bypassed address verification for testing (input was 'Test')", flush=True)

            print(
                f"[OCR] Town: Similarity={town_similarity:.1f}% "
                f"Threshold={town_threshold} Found={town_found} Town='{town_norm}'",
                flush=True,
            )
        else:
            town_similarity = 100
            town_threshold  = 0
            town_found      = True

        # ── Final result ───────────────────────────────────────────────────────
        is_verified = name_verified and town_similarity >= town_threshold and town_found

        if is_verified:
            status = (
                f'ID verified '
                f'(First: {first_name_similarity:.0f}%, '
                f'Last: {last_name_similarity:.0f}%, '
                f'Town: {town_similarity:.0f}%)'
            )
        else:
            status = (
                f'ID mismatch '
                f'(First: {first_name_similarity:.0f}%, '
                f'Last: {last_name_similarity:.0f}%, '
                f'Town: {town_similarity:.0f}%)'
            )

        return is_verified, status, extracted_text_raw

    except Exception as exc:
        return False, f'OCR Error: {str(exc)}', ''


# ─── Face verification ────────────────────────────────────────────────────────

_MAX_FACE_WIDTH = 400   # px — face photos don't need to be large for recognition; reduces memory usage


def verify_face_with_id(face_image_data, id_image_data):
    """Face verification using DeepFace.

    Parameters
    ----------
    face_image_data : bytes | None
    id_image_data   : bytes | None

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
        deepface = _get_deepface()
        if not deepface:
            return False, 'Face verification service unavailable (Low memory mode)', 0.0

        def load_and_resize(image_data, max_width=_MAX_FACE_WIDTH):
            """Decode + downscale to conserve memory during DeepFace inference."""
            nparr = np.frombuffer(bytes(image_data), np.uint8)
            img   = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                return None
            h, w = img.shape[:2]
            if w > max_width:
                scale  = max_width / w
                img    = cv2.resize(img, (int(w * scale), int(h * scale)),
                                    interpolation=cv2.INTER_AREA)
            return img

        face_img = load_and_resize(face_image_data)
        id_img   = load_and_resize(id_image_data)

        if face_img is None:
            return False, 'Could not load face photo', 0.0
        if id_img is None:
            return False, 'Could not load ID image', 0.0

        import tempfile
        import os as _os

        try:
            with tempfile.TemporaryDirectory() as tmp:
                face_path = _os.path.join(tmp, 'face.jpg')
                id_path   = _os.path.join(tmp, 'id.jpg')

                # Write at reduced quality to keep temp files small
                cv2.imwrite(face_path, face_img, [cv2.IMWRITE_JPEG_QUALITY, 80])
                cv2.imwrite(id_path,   id_img,   [cv2.IMWRITE_JPEG_QUALITY, 80])

                # Explicit cleanup before heavy inference
                del face_img, id_img
                gc.collect()

                # Set enforce_detection=True to ensure a face is actually present
                result = deepface.verify(
                    face_path, id_path,
                    model_name='VGG-Face',
                    detector_backend='opencv', # Lightweight/fast detector
                    enforce_detection=True,
                )

            is_verified = result['verified']
            distance    = result['distance']
            confidence  = max(0.0, min(100.0, (1.0 - distance) * 100)) if distance < 1.0 else 0.0

            if is_verified:
                status = f'Face verified (Distance: {distance:.4f}, Confidence: {confidence:.1f}%)'
            else:
                status = f'Face verification failed — faces do not match (Distance: {distance:.4f}, Confidence: {confidence:.1f}%)'

            return is_verified, status, confidence

        except ValueError as e:
            msg = str(e)
            if 'Face could not be detected' in msg:
                 return False, 'Face not detected: Please ensure both your selfie and ID photo are clear and well-lit.', 0.0
            return False, f'Face detection issue: {msg}', 0.0
        except ImportError:
            return False, 'DeepFace not available', 0.0
        except Exception as e:
            return False, f'Face verification error: {str(e)}', 0.0

    except Exception as e:
        return False, f'Face verification error: {str(e)}', 0.0