import os
import sys
import gc
import multiprocessing as mp

# ─── Environment hints for threading & memory ──────────────────────────────────
os.environ.setdefault('OMP_NUM_THREADS', '1')
os.environ.setdefault('ONEDNN_PRIMITIVE_CACHE_CAPACITY', '1')
# ONNX / TF logging
os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL', '3')

# Force spawn start method for Clean RAM isolation (Crucial for 512MB RAM)
try:
    if mp.get_start_method(allow_none=True) is None:
        mp.set_start_method('spawn', force=True)
except Exception:
    pass

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
_MAX_FACE_WIDTH = 224   # px — optimal for ArcFace/ONNX

def _preprocess_for_ocr(img):
    import cv2
    h, w = img.shape[:2]
    if w > _MAX_OCR_WIDTH:
        scale = _MAX_OCR_WIDTH / w
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    
    if len(img.shape) == 3:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    else:
        gray = img

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
    import cv2
    import numpy as np
    import pytesseract

    if not image_bytes:
        return '', 'No image data provided'

    try:
        nparr = np.frombuffer(bytes(image_bytes), np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return '', 'Could not decode image'

        processed = _preprocess_for_ocr(img)
        custom_config = r'--psm 3 --oem 3'
        text = pytesseract.image_to_string(processed, config=custom_config)
        del processed
        gc.collect()

        return text.strip(), None
    except Exception as e:
        return '', f'OCR extraction error: {str(e)}'


# ─── Text helpers ─────────────────────────────────────────────────────────────

def normalize_text(text: str) -> str:
    if not text: return ''
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
    """AI-assisted ID verification using Tesseract OCR + fuzzy similarity."""
    import pandas as pd
    from rapidfuzz import fuzz

    if not id_image_data or (isinstance(id_image_data, float) and pd.isna(id_image_data)):
        return False, 'No ID image provided', ''

    if not _check_tesseract():
        return False, 'OCR service temporarily unavailable', ''

    try:
        # 1. Extract text from ID
        extracted_text_raw, id_error = _run_tesseract(id_image_data)
        if id_error and not extracted_text_raw:
            return False, id_error, ''

        extracted_text_norm = normalize_text(extracted_text_raw)
        first_name_norm = normalize_text(first_name)
        last_name_norm  = normalize_text(last_name)

        def name_similarity(name_norm, text_norm):
            if not name_norm: return 0
            # Multi-strategy fuzzy match
            ratio = fuzz.ratio(name_norm, text_norm)
            partial = fuzz.partial_ratio(name_norm, text_norm)
            token = fuzz.token_sort_ratio(name_norm, text_norm)
            return max(ratio, partial, token)

        first_name_similarity = name_similarity(first_name_norm, extracted_text_norm)
        last_name_similarity  = name_similarity(last_name_norm,  extracted_text_norm)

        name_threshold = 75
        name_verified = (
            (first_name_similarity >= name_threshold or not first_name_norm) and
            (last_name_similarity  >= name_threshold or not last_name_norm)
        )

        # 2. Town/City matching
        if town_city_municipality:
            addr_src = address_image_data if address_image_data else id_image_data
            address_text_raw, addr_error = _run_tesseract(addr_src)
            town_norm = normalize_text(town_city_municipality)
            address_text_norm = normalize_text(address_text_raw)
            
            partial = fuzz.partial_ratio(town_norm, address_text_norm)
            token = fuzz.token_set_ratio(town_norm, address_text_norm)
            town_similarity = max(partial, token)
            town_threshold = 60
            town_found = town_similarity >= town_threshold
        else:
            town_similarity = 100
            town_threshold = 0
            town_found = True

        # 3. Final Decision
        is_verified = name_verified and town_similarity >= town_threshold and town_found
        if is_verified:
            status = f'ID verified (F:{first_name_similarity:.0f}%, L:{last_name_similarity:.0f}%, T:{town_similarity:.0f}%)'
        else:
            status = f'ID mismatch (F:{first_name_similarity:.0f}%, L:{last_name_similarity:.0f}%, T:{town_similarity:.0f}%)'

        return is_verified, status, extracted_text_raw

    except Exception as exc:
        return False, f'OCR Error: {str(exc)}', ''


# ─── Face verification (Ultra-Lightweight ONNX Implementation) ────────────────

def _internal_uniface_verify(face_image_data, id_image_data, result_queue):
    """Internal function to run in a subprocess to isolate ONNX memory usage."""
    try:
        import numpy as np
        import cv2
        import gc
        import os
        from uniface import RetinaFace, ArcFace # Lightweight ONNX models
        import onnxruntime as ort
        
        # Explicitly tune ONNX session for 512MB RAM tier (CPU only, 1 thread)
        sess_options = ort.SessionOptions()
        sess_options.intra_op_num_threads = 1
        sess_options.inter_op_num_threads = 1
        
        detector = RetinaFace(session_options=sess_options)
        recognizer = ArcFace(session_options=sess_options)

        def load_and_resize(image_data):
            if image_data is None: return None
            nparr = np.frombuffer(bytes(image_data), np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None: return None
            h, w = img.shape[:2]
            if w > _MAX_FACE_WIDTH:
                scale = _MAX_FACE_WIDTH / w
                img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
            return img

        face_img = load_and_resize(face_image_data)
        id_img = load_and_resize(id_image_data)

        if face_img is None or id_img is None:
            result_queue.put((False, 'Could not load images', 0.0))
            return

        # 1. Detect faces in both images
        faces_face = detector.detect(face_img)
        faces_id = detector.detect(id_img)

        if not faces_face or not faces_id:
            msg = "Face not detected in selfie" if not faces_face else "Face not detected in ID photo"
            result_queue.put((False, f"{msg}: Ensure photos are clear and well-lit.", 0.0))
            return

        # 2. Extract embeddings using ArcFace
        # In UniFace, the ArcFace object is callable.
        emb_face = recognizer(faces_face[0].aligned_face)
        emb_id = recognizer(faces_id[0].aligned_face)

        # 3. Calculate Cosine Similarity
        # ArcFace embeddings from UniFace are pre-normalized.
        similarity = np.dot(emb_face, emb_id)
        confidence = max(0.0, min(100.0, float(similarity) * 100))
        
        # ArcFace thresholds usually around 0.35-0.45 for cosine
        is_verified = similarity > 0.38
        status = f"Face verified (Conf: {confidence:.1f}%)" if is_verified else "Faces do not match"
        
        result_queue.put((is_verified, status, confidence))

    except Exception as e:
        result_queue.put((False, f"Verification error: {str(e)}", 0.0))

def verify_face_with_id(face_image_data, id_image_data):
    """Verify face with memory isolation (UniFace + ONNX for 512MB RAM)."""
    if not face_image_data or not id_image_data:
        return False, "Missing image data", 0.0

    try:
        # Skip heavy imports in main process entirely
        result_queue = mp.Queue()
        p = mp.Process(target=_internal_uniface_verify, args=(face_image_data, id_image_data, result_queue))
        p.start()
        p.join(timeout=45) # Lower timeout for ONNX (it's faster)
        
        if p.is_alive():
            p.terminate()
            return False, "Verification timed out due to high load.", 0.0
            
        if result_queue.empty():
            return False, "Verification process failed (Likely out of memory).", 0.0
            
        return result_queue.get()
    except Exception as e:
        return False, f"Processor failure: {str(e)}", 0.0