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
    required_keywords: list = None,
):
    """AI-assisted ID verification using Tesseract OCR + fuzzy similarity."""
    import pandas as pd
    from rapidfuzz import fuzz

    if not id_image_data or (isinstance(id_image_data, float) and pd.isna(id_image_data)):
        return False, 'No image data provided', ''

    if not _check_tesseract():
        return False, 'OCR service temporarily unavailable', ''

    try:
        # 1. Extract text from primary image (or address image)
        extracted_text_raw, id_error = _run_tesseract(id_image_data)
        if id_error and not extracted_text_raw:
            return False, id_error, ''

        extracted_text_norm = normalize_text(extracted_text_raw)
        
        # ── Keyword Verification ──────────────────────────────────────────────
        keywords_matched = True
        keyword_status = ""
        
        if required_keywords:
            keywords_matched = False
            best_match_score = 0
            best_keyword = ""
            
            for kw in required_keywords:
                kw_norm = normalize_text(kw)
                if not kw_norm: continue
                # Search for keyword anywhere in the extracted text
                score = fuzz.partial_ratio(kw_norm, extracted_text_norm)
                if score > best_match_score:
                    best_match_score = score
                    best_keyword = kw
            
            # Threshold for keyword matching (80% similarity)
            if best_match_score >= 80:
                keywords_matched = True
                keyword_status = f"Keyword match: {best_keyword} ({best_match_score:.0f}%)"
            else:
                keywords_matched = False
                keyword_status = f"Keyword mismatch (Best: {best_keyword} {best_match_score:.0f}%)"

        # ── Name Matching (Optional) ───────────────────────────────────────────
        first_name_norm = normalize_text(first_name)
        last_name_norm  = normalize_text(last_name)

        def name_similarity(name_norm, text_norm):
            if not name_norm: return 0
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

        # ── Town/City matching (Optional) ────────────────────────────────────────
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

        # ── Final Decision ─────────────────────────────────────────────────────
        is_verified = name_verified and town_found and keywords_matched
        
        details = []
        if first_name_norm or last_name_norm:
            details.append(f"Name Match: {max(first_name_similarity, last_name_similarity):.0f}%")
        if town_city_municipality:
            details.append(f"Address Match: {town_similarity:.0f}%")
        if required_keywords:
            details.append(keyword_status)
            
        status = (f"Verified: " if is_verified else "Mismatch: ") + ", ".join(details)

        return is_verified, status, extracted_text_raw

    except Exception as exc:
        return False, f'OCR Error: {str(exc)}', ''


# ─── Face verification (Persistent Worker for Speed) ───────────────────────────

class _FaceWorker:
    """Manager for a persistent background process to keep AI models resident."""
    def __init__(self):
        self.process = None
        self.request_queue = mp.Queue(maxsize=1)
        self.response_queue = mp.Queue(maxsize=1)

    def start(self):
        if self.process and self.process.is_alive():
            return
        # Use spawn to ensure memory isolation for the AI models
        self.process = mp.Process(target=self._worker_loop, daemon=True)
        self.process.start()
        print("[FACE] Persistent background worker started.", flush=True)

    def _worker_loop(self):
        """Internal loop running in a dedicated process."""
        try:
            import numpy as np
            import cv2
            import gc
            from uniface import RetinaFace, ArcFace
            import onnxruntime as ort
            
            # 1. Warm-up: Load models into RAM once
            print("[FACE] Loading AI models into background RAM...", flush=True)
            detector = RetinaFace()
            recognizer = ArcFace()
            print("[FACE] AI models resident and ready.", flush=True)

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

            def get_landmarks(face_obj):
                for attr in ['landmarks', 'kps', 'keypoints']:
                    if hasattr(face_obj, attr):
                        return getattr(face_obj, attr)
                if isinstance(face_obj, dict):
                    for key in ['landmarks', 'kps', 'keypoints']:
                        if key in face_obj:
                            return face_obj[key]
                return None

            # 2. Main Processing Loop
            while True:
                # Wait for dispatch from main process
                face_data, id_data = self.request_queue.get()
                
                try:
                    face_img = load_and_resize(face_data)
                    id_img = load_and_resize(id_data)

                    if face_img is None or id_img is None:
                        self.response_queue.put((False, 'Could not decode image buffers', 0.0))
                        continue

                    # Detection
                    faces_face = detector.detect(face_img)
                    faces_id = detector.detect(id_img)

                    if not faces_face or not faces_id:
                        msg = "Face not detected in selfie" if not faces_face else "Face not detected in ID photo"
                        self.response_queue.put((False, f"{msg}: Ensure photos are clear.", 0.0))
                        continue

                    # Extraction
                    lnmarks_face = get_landmarks(faces_face[0])
                    lnmarks_id = get_landmarks(faces_id[0])

                    if lnmarks_face is None or lnmarks_id is None:
                        # Attempt landmark-free embedding as fallback
                        emb_face = recognizer(face_img)
                        emb_id = recognizer(id_img)
                    else:
                        emb_face = recognizer(face_img, lnmarks_face)
                        emb_id = recognizer(id_img, lnmarks_id)

                    # Similary calculation (Cosine)
                    similarity = np.dot(emb_face, emb_id)
                    confidence = max(0.0, min(100.0, float(similarity) * 100))
                    
                    is_verified = similarity > 0.38
                    status = f"Face verified (Conf: {confidence:.1f}%)" if is_verified else "Faces do not match"
                    
                    self.response_queue.put((bool(is_verified), status, float(confidence)))

                    # Small cleanup after each match
                    del face_img, id_img, emb_face, emb_id
                    gc.collect()

                except Exception as inner_e:
                    self.response_queue.put((False, f"Internal Matcher Error: {str(inner_e)}", 0.0))

        except Exception as e:
            print(f"[FACE] Worker crash: {str(e)}", flush=True)

# Shared global instance
_face_manager = _FaceWorker()

def verify_face_with_id(face_image_data, id_image_data):
    """
    Verify face using a persistent background worker for near-instant response.
    Eliminates the 10-15s reload overhead per request.
    """
    if not face_image_data or not id_image_data:
        return False, "Missing image data", 0.0

    try:
        # 1. Ensure worker is alive
        _face_manager.start()
        
        # 2. Dispatch images to worker
        # Max wait for dispatch in case queue is full
        try:
            _face_manager.request_queue.put((face_image_data, id_image_data), timeout=5)
        except Exception:
            return False, "Processing engine busy. Please retry in a moment.", 0.0
            
        # 3. Wait for result
        # Initial request might take 10s to load models, subsequent ones are fast.
        try:
            result = _face_manager.response_queue.get(timeout=30)
            return result
        except Exception:
            # If it timed out, the worker might have crashed
            print("[FACE] Worker response timeout. Restarting...", flush=True)
            if _face_manager.process:
                _face_manager.process.terminate()
            return False, "Verification timed out. Re-initializing engine...", 0.0

    except Exception as e:
        return False, f"Processor failure: {str(e)}", 0.0