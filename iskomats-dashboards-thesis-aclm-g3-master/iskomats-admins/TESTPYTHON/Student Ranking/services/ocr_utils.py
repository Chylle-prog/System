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

# On Windows, point pytesseract to the Tesseract binary.
# Override via TESSERACT_CMD env var; falls back to the standard install location.
import platform
if platform.system() == 'Windows':
    try:
        import pytesseract
        _tess_cmd = os.environ.get(
            'TESSERACT_CMD',
            r'C:\Program Files\Tesseract-OCR\tesseract.exe'
        )
        pytesseract.pytesseract.tesseract_cmd = _tess_cmd
    except ImportError:
        pass

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

def _preprocess_strategy_a(img):
    """Standard grayscale + CLAHE + adaptive threshold. Works well for plain docs."""
    import cv2
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)
    return cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 21, 10
    )


def _preprocess_strategy_b(img):
    """Background subtraction — best for patterned/colorful IDs (Philippine National ID)."""
    import cv2
    import numpy as np
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
    # Estimate background using large morphological closing
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (51, 51))
    background = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, kernel)
    # Subtract background to isolate text
    diff = cv2.absdiff(gray, background)
    diff = cv2.normalize(diff, None, 0, 255, cv2.NORM_MINMAX)
    _, binary = cv2.threshold(diff, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return binary


def _preprocess_strategy_c(img):
    """Simple OTSU on grayscale — reliable baseline for high-contrast docs."""
    import cv2
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
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

        h, w = img.shape[:2]
        if w > _MAX_OCR_WIDTH:
            scale = _MAX_OCR_WIDTH / w
            img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

        custom_config = r'--psm 3 --oem 3'
        best_text = ''

        # Try each preprocessing strategy; keep whichever extracts the most text
        for strategy in (_preprocess_strategy_a, _preprocess_strategy_b, _preprocess_strategy_c):
            try:
                processed = strategy(img)
                text = pytesseract.image_to_string(processed, config=custom_config).strip()
                if len(text) > len(best_text):
                    best_text = text
            except Exception:
                continue

        del img
        gc.collect()
        return best_text, None

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


def extract_school_year(text: str):
    """
    Scan OCR text for academic year / semester patterns and check if the
    current year is represented.

    Three strategies (in order):
      1. SY/Sem context with loose regex — tolerates OCR noise like
         "12025 - 2028" (extra leading char + 6→8 misread of "2025-2026")
      2. Strict year-pair regex for clean documents
      3. Standalone year fallback (±1 tolerance)

    Returns:
      (is_current: bool, found_labels: list[str], message: str)
    """
    import re
    from datetime import datetime

    current_year = datetime.now().year

    # Normalise dashes / whitespace
    clean = re.sub(r'[\u2013\u2014\u2015\u2212]', '-', text)
    clean = re.sub(r'\s+', ' ', clean)

    found_labels = []
    is_current = False

    # ── Strategy 1: SY / Sem header with OCR-noise tolerance ─────────────────
    # Allows up to 2 stray leading digits before each 4-digit year, so
    # "12025 - 2028" → extracts y1=2025, y2=2028 (6→8 misread but range ok)
    sy_pattern = re.compile(
        r'(?:S\.?Y\.?|SY|Sem[a-z]*|School\s*Year)'  # keyword
        r'[^\d]{0,20}'                                # gap (label text)
        r'\d{0,2}(20\d{2})'                           # y1 (allows 1-2 noise digits before)
        r'\s*[-\s/]+\s*'                               # separator
        r'\d{0,2}(20\d{2})',                           # y2
        re.IGNORECASE
    )
    for m in sy_pattern.finditer(clean):
        y1, y2 = int(m.group(1)), int(m.group(2))
        # Academic years are ALWAYS consecutive (e.g. 2025-2026).
        # If y2 - y1 ≠ 1 it's an OCR digit misread — correct y2 to y1 + 1.
        if y2 - y1 != 1:
            y2 = y1 + 1
        label = f"S.Y. {y1}–{y2}"
        if y1 <= current_year <= y2:
            is_current = True
            found_labels.append(label)
        elif found_labels == []:
            found_labels.append(label)   # record even if outdated (for error msg)

    if is_current:
        return True, found_labels, f"School year verified ({', '.join(found_labels)})"

    # ── Strategy 2: Strict year-pair regex (clean documents) ─────────────────
    pair_pattern = re.compile(r'\b(20\d{2})\s*-\s*(20\d{2})\b')
    for m in pair_pattern.finditer(clean):
        y1, y2 = int(m.group(1)), int(m.group(2))
        # Same normalization — correct non-consecutive pairs
        if y2 - y1 != 1:
            y2 = y1 + 1
        label = f"S.Y. {y1}–{y2}"
        if y1 <= current_year <= y2:
            is_current = True
            found_labels.append(label)
        elif label not in found_labels:
            found_labels.append(label)

    if is_current:
        return True, found_labels, f"School year verified ({', '.join(found_labels)})"

    # ── Strategy 3: Standalone year (±1 tolerance to absorb OCR digit errors) ─
    single_pattern = re.compile(r'\b(20\d{2})\b')
    for m in single_pattern.finditer(clean):
        y = int(m.group(1))
        if abs(y - current_year) <= 1:           # e.g. 2025, 2026, 2027
            is_current = True
            found_labels.append(str(y))

    if is_current:
        return True, found_labels, f"School year verified ({', '.join(dict.fromkeys(found_labels))})"

    # ── No current year found ─────────────────────────────────────────────────
    if found_labels:
        return False, found_labels, (
            f"Grades appear outdated — found {', '.join(found_labels[:3])}, "
            f"expected S.Y. {current_year - 1}–{current_year}"
        )
    return False, [], (
        f"No school year / semester found — expected S.Y. {current_year - 1}–{current_year}"
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


# ─── Signature Verification (OpenCV Feature Matching) ────────────────────────

def _extract_signature_regions(id_image_data, max_signatures=2):
    """
    Extract possible signature regions from ID back image using contour detection.
    Signatures are typically near the bottom of ID backs and have specific dimensions.
    Returns list of cropped signature images.
    """
    import cv2
    import numpy as np
    
    try:
        # Decode image
        nparr = np.frombuffer(id_image_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return []
        
        # Preprocess: grayscale + threshold
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        
        # Invert to find dark regions (signatures are typically dark)
        binary = cv2.bitwise_not(binary)
        
        # Find contours
        contours, _ = cv2.findContours(binary, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
        
        # Filter contours for signature-like regions
        # Signatures typically have specific aspect ratios and sizes
        signature_regions = []
        height, width = img.shape[:2]
        
        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            area = cv2.contourArea(contour)
            
            # Signature heuristics (adjusted for smaller signatures):
            # - Not too small (min area ~200 px instead of 500)
            # - Not too large (max area ~40% of image instead of 50%)
            # - Reasonable aspect ratio (0.2 to 4.0 instead of 0.3-3.0)
            # - Usually in lower portion of ID back (y > 40% instead of 50%)
            if area > 200 and area < (width * height * 0.4):
                aspect_ratio = w / (h + 1e-6)
                if 0.2 < aspect_ratio < 4.0 and y > height * 0.4:
                    signature_regions.append((x, y, w, h, area))
        
        # Sort by area (descending) and take top N
        signature_regions.sort(key=lambda r: r[4], reverse=True)
        signature_regions = signature_regions[:max_signatures]
        
        print(f"[SIGNATURE] Extracted {len(signature_regions)} signature region(s)", flush=True)
        
        # Extract and return cropped images
        cropped_signatures = []
        for idx, (x, y, w, h, area) in enumerate(signature_regions):
            # Add padding
            pad = 5
            x1, y1 = max(0, x - pad), max(0, y - pad)
            x2, y2 = min(width, x + w + pad), min(height, y + h + pad)
            sig_crop = img[y1:y2, x1:x2]
            if sig_crop.size > 0:
                cropped_signatures.append(sig_crop)
                print(f"[SIGNATURE] Region {idx+1}: area={area:.0f}, pos=({x},{y}), size=({w}x{h})", flush=True)
        
        return cropped_signatures
    
    except Exception as e:
        print(f"[SIGNATURE] Extraction failed: {str(e)}", flush=True)
        return []


# ─── Signature Helper ─────────────────────────────────────────────────────────

def _crop_and_pad_signature(binary_img, target_size=(256, 256), padding=10):
    """
    Crops a binary signature image to its ink bounds and pads it to a fixed square 
    size while preserving aspect ratio.
    """
    import cv2
    import numpy as np
    
    # 1. Find bounding box of ink
    coords = cv2.findNonZero(binary_img)
    if coords is None:
        return np.zeros(target_size, dtype=np.uint8)
        
    x, y, w, h = cv2.boundingRect(coords)
    cropped = binary_img[y:y+h, x:x+w]
    
    # 2. Calculate scaling factor
    target_w, target_h = target_size[0] - padding*2, target_size[1] - padding*2
    scale = min(target_w / float(w), target_h / float(h))
    
    new_w, new_h = max(1, int(w * scale)), max(1, int(h * scale))
        
    # 3. Resize and paste into center
    resized = cv2.resize(cropped, (new_w, new_h), interpolation=cv2.INTER_AREA)
    canvas = np.zeros(target_size, dtype=np.uint8)
    x_off = (target_size[0] - new_w) // 2
    y_off = (target_size[1] - new_h) // 2
    canvas[y_off:y_off+new_h, x_off:x_off+new_w] = resized
    
    return canvas

def _compare_signatures_orb(submitted_sig_data, extracted_signatures):
    """
    Compare submitted signature against extracted signatures using advanced OpenCV algorithms.
    Uses scipy and scikit-image for structural similarity and shape matching.
    Returns highest match confidence (0.0 to 1.0).
    """
    import cv2
    import numpy as np
    
    if not extracted_signatures:
        return float(0.0), "No signatures found on ID back", None
    
    try:
        from scipy.spatial.distance import cosine
        from scipy.stats import entropy
        from skimage.metrics import structural_similarity as ssim
        from skimage.morphology import skeletonize
    except ImportError as e:
        print(f"[SIGNATURE] Required library missing: {e}, using fallback", flush=True)
        return _compare_signatures_template_fallback(submitted_sig_data, extracted_signatures)
    
    try:
        # Decode submitted signature
        nparr = np.frombuffer(submitted_sig_data, np.uint8)
        submitted = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if submitted is None:
            return float(0.0), "Invalid submitted signature format", None
        
        # Convert to grayscale
        submitted_gray = cv2.cvtColor(submitted, cv2.COLOR_BGR2GRAY) if len(submitted.shape) == 3 else submitted
        submitted_gray = cv2.normalize(submitted_gray, None, alpha=0, beta=255, norm_type=cv2.NORM_MINMAX)
        
        print(f"[SIGNATURE] Using advanced OpenCV algorithms (scipy + scikit-image)", flush=True)
        
        best_match_ratio = 0.0
        best_sig_index = None
        
        # Binary threshold for ink detection
        _, submitted_bin_raw = cv2.threshold(submitted_gray, 128, 255, cv2.THRESH_BINARY_INV)
        
        # Apply strict crop and pad to standardize sizes and remove blank canvas
        submitted_bin = _crop_and_pad_signature(submitted_bin_raw)
        
        # Get skeleton representation for structural analysis
        submitted_bin_norm = submitted_bin.astype(np.uint8) // 255
        submitted_skeleton = skeletonize(submitted_bin_norm).astype(np.uint8) * 255
        
        # Compare against each extracted signature
        for idx, extracted_sig in enumerate(extracted_signatures):
            try:
                extracted_gray = cv2.cvtColor(extracted_sig, cv2.COLOR_BGR2GRAY) if len(extracted_sig.shape) == 3 else extracted_sig
                extracted_gray = cv2.normalize(extracted_gray, None, alpha=0, beta=255, norm_type=cv2.NORM_MINMAX)
                
                _, extracted_bin_raw = cv2.threshold(extracted_gray, 128, 255, cv2.THRESH_BINARY_INV)
                extracted_resized = _crop_and_pad_signature(extracted_bin_raw)
                
                # --- Phase 2: Feature Matching (ORB) ---
                # Detect and compute keypoints/descriptors
                orb = cv2.ORB_create(nfeatures=500)
                kp_sub, des_sub = orb.detectAndCompute(submitted_bin, None)
                kp_ext, des_ext = orb.detectAndCompute(extracted_resized, None)
                
                orb_score = 0.0
                good_matches_count = 0
                if des_sub is not None and des_ext is not None:
                    # Use BFMatcher with Hamming distance for binary descriptors
                    bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
                    matches = bf.match(des_sub, des_ext)
                    matches = sorted(matches, key=lambda x: x.distance)
                    
                    # Define "good" matches based on distance
                    good_matches = [m for m in matches if m.distance < 50]
                    good_matches_count = len(good_matches)
                    
                    # Normalize score: keypoint survival rate
                    # We expect at least some core points to match
                    denom = min(len(kp_sub), len(kp_ext), 120)
                    if denom > 0:
                        orb_score = min(1.0, (good_matches_count * 1.5) / denom)
                
                print(f"[SIGNATURE] Sig {idx+1} - ORB Matches: {good_matches_count} (Score: {orb_score:.2%})", flush=True)
                
                # --- Phase 2: Complexity Analysis ---
                # Prevents simple lines/circles from getting high scores.
                # A real signature usually has 40-200 keypoints.
                kp_count = len(kp_sub) if kp_sub else 0
                complexity_base = min(1.0, kp_count / 45.0) 
                
                # Relative complexity: is it much simpler than the ID?
                kp_ext_count = len(kp_ext) if kp_ext else 1
                rel_comp = min(1.0, (kp_count + 5) / (kp_ext_count * 0.4 + 5))
                
                complexity_factor = (complexity_base * 0.7) + (rel_comp * 0.3)
                print(f"[SIGNATURE] Sig {idx+1} - Complexity: {complexity_factor:.2%} (KPs: {kp_count})", flush=True)

                # --- Visual / Shape Similarity (Previous methods) ---
                ssim_score = ssim(submitted_bin, extracted_resized, data_range=255)
                ssim_norm = (ssim_score + 1) / 2
                
                # Combined scoring (Phase 2 Weights)
                # ORB (40%): Hard to fake unique stroke junctions
                # Complexity (25%): Hard to fake detail level
                # Skeleton (20%): Path similarity
                # Visual (15%): General shape blend
                visual_blend = (ssim_norm * 0.4) + (hist_score * 0.3) + (contour_score * 0.3)
                
                combined_score = (orb_score * 0.40) + \
                                 (complexity_factor * 0.25) + \
                                 (skeleton_sim * 0.20) + \
                                 (visual_blend * 0.15)
                
                if combined_score > best_match_ratio:
                    best_match_ratio = combined_score
                    best_sig_index = idx + 1
                
                print(f"[SIGNATURE] Sig {idx+1} - FINAL Combined score: {combined_score:.2%}", flush=True)
            
            except Exception as e:
                print(f"[SIGNATURE] Matching against signature {idx+1} failed: {str(e)}", flush=True)
                import traceback
                traceback.print_exc()
                continue
        
        # Verification threshold for specialized algorithm
        VERIFICATION_THRESHOLD = 0.35  # Strict threshold now that background noise is removed
        if best_match_ratio < VERIFICATION_THRESHOLD:
            print(f"[SIGNATURE] No significant match found (best: {best_match_ratio:.2%}, need ≥{VERIFICATION_THRESHOLD:.0%})", flush=True)
            return float(0.0), f"Signature does not match any on ID back ({best_match_ratio:.1%})", best_sig_index
        
        # Confidence: normalize to 0-100%
        confidence = float(min(best_match_ratio * 100, 100.0))
        
        message = f"Match found (Signature {best_sig_index})" if best_sig_index else "No strong match"
        print(f"[SIGNATURE] Final result: {message}, confidence={confidence:.1f}%", flush=True)
        return confidence, message, best_sig_index
    
    except Exception as e:
        print(f"[SIGNATURE] Advanced comparison failed: {str(e)}", flush=True)
        import traceback
        traceback.print_exc()
        return _compare_signatures_template_fallback(submitted_sig_data, extracted_signatures)


def _compare_signatures_template_fallback(submitted_sig_data, extracted_signatures):
    """
    Fallback to template matching if Signature-Verification-OpenCV is not available.
    """
    import cv2
    import numpy as np
    
    if not extracted_signatures:
        return float(0.0), "No signatures found on ID back", None
    
    try:
        nparr = np.frombuffer(submitted_sig_data, np.uint8)
        submitted = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if submitted is None:
            return float(0.0), "Invalid submitted signature format", None
        
        submitted_gray = cv2.cvtColor(submitted, cv2.COLOR_BGR2GRAY) if len(submitted.shape) == 3 else submitted
        submitted_gray = cv2.normalize(submitted_gray, None, alpha=0, beta=255, norm_type=cv2.NORM_MINMAX)
        
        best_match_ratio = 0.0
        best_sig_index = None
        
        _, submitted_bin_raw = cv2.threshold(submitted_gray, 128, 255, cv2.THRESH_BINARY_INV)
        submitted_bin = _crop_and_pad_signature(submitted_bin_raw)
        
        for idx, extracted_sig in enumerate(extracted_signatures):
            try:
                extracted_gray = cv2.cvtColor(extracted_sig, cv2.COLOR_BGR2GRAY) if len(extracted_sig.shape) == 3 else extracted_sig
                extracted_gray = cv2.normalize(extracted_gray, None, alpha=0, beta=255, norm_type=cv2.NORM_MINMAX)
                
                _, extracted_bin_raw = cv2.threshold(extracted_gray, 128, 255, cv2.THRESH_BINARY_INV)
                extracted_resized = _crop_and_pad_signature(extracted_bin_raw)
                
                submitted_f32 = submitted_bin.astype(np.float32)
                extracted_f32 = extracted_resized.astype(np.float32)
                
                submitted_mean = submitted_f32 - submitted_f32.mean()
                extracted_mean = extracted_f32 - extracted_f32.mean()
                
                numerator = np.sum(submitted_mean * extracted_mean)
                denominator = np.sqrt(np.sum(submitted_mean**2) * np.sum(extracted_mean**2)) + 1e-6
                correlation_score = max(0, numerator / denominator)
                
                if correlation_score > best_match_ratio:
                    best_match_ratio = correlation_score
                    best_sig_index = idx + 1
            
            except Exception as e:
                print(f"[SIGNATURE] Fallback matching failed: {e}", flush=True)
                continue
        
        if best_match_ratio < 0.25:
            return float(0.0), f"Signature does not match any on ID back ({best_match_ratio:.1%})", best_sig_index
        
        confidence = float(min(best_match_ratio * 100, 100.0))
        return confidence, f"Match found (Signature {best_sig_index})", best_sig_index
    
    except Exception as e:
        return float(0.0), f"Fallback error: {str(e)}", None


def verify_signature_against_id(submitted_sig_data, id_back_data):
    """
    Main signature verification function.
    Extracts signatures from ID back and compares with submitted signature.
    Returns (verified: bool, message: str, confidence: float)
    """
    try:
        print("[SIGNATURE] Starting verification process...", flush=True)
        
        # Extract signature regions from ID back
        extracted_sigs = _extract_signature_regions(id_back_data, max_signatures=2)
        
        if not extracted_sigs:
            print("[SIGNATURE] No signatures extracted from ID back", flush=True)
            return False, "No signature regions detected on ID back", 0.0
        
        # Compare against extracted signatures
        confidence, message, sig_index = _compare_signatures_orb(submitted_sig_data, extracted_sigs)
        
        # Verification threshold: 25% match confidence (template matching method is stricter)
        VERIFICATION_THRESHOLD = 25.0
        verified = bool(confidence >= VERIFICATION_THRESHOLD)
        
        # Add threshold info to message
        if verified:
            final_message = f"{message} - Verified ({confidence:.1f}% match)"
        else:
            final_message = f"{message} ({confidence:.1f}% match, need ≥{VERIFICATION_THRESHOLD}%)"
        
        print(f"[SIGNATURE] Verification complete: {final_message}", flush=True)
        
        # Ensure all return types are native Python types
        return bool(verified), str(final_message), float(confidence)
    
    except Exception as e:
        print(f"[SIGNATURE] Verification failed: {str(e)}", flush=True)
        import traceback
        traceback.print_exc()
        return False, f"Verification error: {str(e)}", 0.0