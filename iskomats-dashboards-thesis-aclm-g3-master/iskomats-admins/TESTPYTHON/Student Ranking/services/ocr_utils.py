import os
import sys
import gc


# ─── Environment hints for ONNX / threading (set before first import) ─────────
os.environ.setdefault('ONEDNN_PRIMITIVE_CACHE_CAPACITY', '1')
os.environ.setdefault('OMP_NUM_THREADS', '1')

# ─── OCR Reader — with periodic refresh to prevent memory accumulation ────────
_reader = None
_reader_request_count = 0
_READER_REFRESH_INTERVAL = 100   # Recreate EasyOCR reader every N OCR calls

# ─── DeepFace — lazy singleton ─────────────────────────────────────────────────
_deepface = None


def _get_reader(force_refresh: bool = False):
    """Return the EasyOCR reader, recreating it periodically to release memory."""
    global _reader, _reader_request_count

    # Respect hard skip flag
    if os.environ.get('SKIP_HEAVY_IMPORTS') == 'True':
        print("[OCR] Skipping easyocr due to SKIP_HEAVY_IMPORTS=True", flush=True)
        return None

    # Periodic refresh: terminate old reader, force GC, then recreate
    if force_refresh or (_reader is not None and _reader is not False
                         and _reader_request_count >= _READER_REFRESH_INTERVAL):
        print(f"[OCR] Refreshing EasyOCR reader after {_reader_request_count} requests…", flush=True)
        _reader = None
        gc.collect()  # Encourage Python to release the old reader's memory
        _reader_request_count = 0

    if _reader is None:
        try:
            import easyocr
            # gpu=False — no GPU on Render; model download ~300 MB on first run
            _reader = easyocr.Reader(['en'], gpu=False)
            _reader_request_count = 0
            print("[OCR] EasyOCR reader initialised.", flush=True)
        except (ImportError, Exception) as e:
            print(f"[OCR] Warning: Could not initialise easyocr: {str(e)}", flush=True)
            _reader = False  # Sentinel — "failed to load"

    if _reader is not False:
        _reader_request_count += 1

    return _reader if _reader is not False else None


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
        except (ImportError, Exception) as e:
            print(f"[FACE] Warning: Could not initialise deepface: {str(e)}", flush=True)
            _deepface = False
    return _deepface if _deepface is not False else None


# ─── Image preprocessing ──────────────────────────────────────────────────────

_MAX_OCR_WIDTH = 1600   # px — wide enough for ID text; reduces RAM substantially


def _preprocess_for_ocr(img):
    """
    Preprocess a colour OpenCV image for OCR:
      1. Downscale if wider than _MAX_OCR_WIDTH  (biggest memory win)
      2. Convert to grayscale                    (~66 % less memory vs colour)
      3. Apply binary threshold                  (improves OCR accuracy on IDs)

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
        gray = img  # already grayscale

    # 3. Adaptive threshold for better contrast (works well on varied lighting)
    binary = cv2.adaptiveThreshold(
        gray, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        blockSize=31,
        C=10,
    )

    return binary


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
        Town/city/municipality to look for in address document (empty → skip).
    address_image_data : bytes | None, optional
        Separate raw image bytes used for address/indigency OCR.

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
            """Decode bytes → preprocess → run OCR → return normalised text dict."""
            if image_data is None or (isinstance(image_data, float) and pd.isna(image_data)):
                return None, missing_message

            nparr = np.frombuffer(bytes(image_data), np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                return None, 'Could not load image'

            # ── Memory optimisations ───────────────────────────────────────────
            img = _preprocess_for_ocr(img)
            # ──────────────────────────────────────────────────────────────────

            # Only request plain text — no hocr/tsv/blocks (saves 30-50 % RAM)
            ocr_results = reader.readtext(img, detail=0, paragraph=False)
            extracted = ' '.join(ocr_results)

            # Explicit cleanup
            del img
            del nparr

            return {
                'raw': extracted,
                'normalized': normalize_text(extracted),
            }, None

        id_ocr, id_error = extract_normalized_text(id_image_data, 'No ID image provided')
        if id_error:
            return False, id_error, ''

        extracted_text = id_ocr['raw']
        extracted_text_norm = id_ocr['normalized']

        # ── First Name + Last Name fuzzy matching ──────────────────────────────
        first_name_norm = normalize_text(first_name)
        last_name_norm = normalize_text(last_name)

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
            address_ocr, address_error = extract_normalized_text(
                address_image_data if address_image_data is not None else id_image_data,
                'No address document image provided',
            )
            if address_error:
                return False, address_error, extracted_text

            town_norm         = normalize_text(town_city_municipality)
            address_text_norm = address_ocr['normalized']
            town_similarity   = fuzz.partial_ratio(town_norm, address_text_norm)
            town_threshold    = 50

            town_words = [w for w in town_norm.split() if len(w) >= 3]
            if town_words:
                found_count = sum(1 for w in town_words if w in address_text_norm)
                town_found  = found_count >= max(1, len(town_words) - 1)
            else:
                town_found = True

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

        return is_verified, status, extracted_text

    except Exception as exc:
        return False, f'OCR Error: {str(exc)}', ''


# ─── Face verification ────────────────────────────────────────────────────────

_MAX_FACE_WIDTH = 800   # px — face photos don't need to be large for recognition


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

                result = deepface.verify(
                    face_path, id_path,
                    model_name='VGG-Face',
                    enforce_detection=False,
                )

            is_verified = result['verified']
            distance    = result['distance']
            confidence  = max(0.0, min(100.0, (1.0 - distance) * 100)) if distance < 1.0 else 0.0

            if is_verified:
                status = f'Face verified (Distance: {distance:.4f}, Confidence: {confidence:.1f}%)'
            else:
                status = f'Face verification failed — faces do not match (Distance: {distance:.4f}, Confidence: {confidence:.1f}%)'

            return is_verified, status, confidence

        except ImportError:
            return False, 'DeepFace not available', 0.0
        except Exception as e:
            return False, f'Face verification error: {str(e)}', 0.0

    except Exception as e:
        return False, f'Face verification error: {str(e)}', 0.0