import os
import sys
import gc
import tempfile
import base64
import time
import cv2
import numpy as np
import pytesseract
import platform
import multiprocessing as mp
import re
import difflib
import hashlib
import eventlet.tpool
import eventlet.semaphore
from collections import OrderedDict

# Global OCR Concurrency Control: Increased to 2 for better parallel throughput on Render
OCR_SEMAPHORE = eventlet.semaphore.Semaphore(2)


# ─── Environment hints for threading & memory ──────────────────────────────────
os.environ.setdefault('OMP_NUM_THREADS', '1')
os.environ.setdefault('ONEDNN_PRIMITIVE_CACHE_CAPACITY', '1')
os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL', '3')

# Force spawn start method for Clean RAM isolation (Crucial for 512MB RAM)
try:
    if mp.get_start_method(allow_none=True) is None:
        mp.set_start_method('spawn', force=True)
except Exception:
    pass

# ─── OCR Result Caching System (Optimization #2) ─────────────────────────────
_OCR_CACHE = OrderedDict()
_OCR_CACHE_SIZE_LIMIT = 100
_CACHE_METRICS = {'hits': 0, 'misses': 0}
_FACE_MODEL_LOCK = eventlet.semaphore.Semaphore(1)
_FACE_DETECTOR = None
_FACE_RECOGNIZER = None
_FACE_MODEL_INIT_ERROR = None
_FACE_MATCH_THRESHOLD = 0.60
_FACE_DETECTION_THRESHOLD = 0.50

def _hash_image(image_bytes, suffix=b"_v2"):
    """Generate MD5 hash of image bytes for caching."""
    return hashlib.md5(image_bytes + suffix).hexdigest()

def _cache_get(image_hash):
    """Retrieve cached OCR result if available."""
    global _CACHE_METRICS
    if image_hash in _OCR_CACHE:
        _CACHE_METRICS['hits'] += 1
        _OCR_CACHE.move_to_end(image_hash)  # Mark as recently used
        return _OCR_CACHE[image_hash]
    _CACHE_METRICS['misses'] += 1
    return None

def _cache_set(image_hash, ocr_result):
    """Store OCR result in cache with LRU eviction."""
    if len(_OCR_CACHE) >= _OCR_CACHE_SIZE_LIMIT:
        _OCR_CACHE.popitem(last=False)  # Remove oldest (FIFO in LRU)
    _OCR_CACHE[image_hash] = ocr_result

def get_ocr_cache_stats():
    """Return cache performance metrics."""
    total = _CACHE_METRICS['hits'] + _CACHE_METRICS['misses']
    hit_rate = (_CACHE_METRICS['hits'] / total * 100) if total > 0 else 0
    return {
        'cache_size': len(_OCR_CACHE),
        'hits': _CACHE_METRICS['hits'],
        'misses': _CACHE_METRICS['misses'],
        'hit_rate_percent': hit_rate
    }

# ─── Tesseract availability check & lazy loading (Optimization #5) ──────────
_tesseract_available = None
_tesseract_initialized = False

def _init_tesseract():
    """Initialize Tesseract on first use (lazy loading)."""
    global _tesseract_initialized
    if _tesseract_initialized:
        return
    
    if platform.system() == 'Windows':
        try:
            _tess_cmd = os.environ.get('TESSERACT_CMD', r'C:\Program Files\Tesseract-OCR\tesseract.exe')
            pytesseract.pytesseract.tesseract_cmd = _tess_cmd
        except Exception:
            pass
    
    _tesseract_initialized = True

def _check_tesseract():
    global _tesseract_available
    if _tesseract_available is not None: 
        return _tesseract_available
    try:
        _init_tesseract()  # Ensure Tesseract config is set
        ver = pytesseract.get_tesseract_version()
        print(f"[OCR] Tesseract available — version {ver}", flush=True)
        _tesseract_available = True
    except Exception as e:
        print(f"[OCR] Tesseract not available: {e}", flush=True)
        _tesseract_available = False
    return _tesseract_available

# ─── Helper Utilities ─────────────────────────────────────────────────────────

def decode_base64(data):
    """Safely decode base64 data URI or pure base64 string."""
    if isinstance(data, str):
        if ',' in data:  # Data URI format: data:image/png;base64,...
            data = data.split(',')[1]
        return base64.b64decode(data)
    return data

# ─── Image preprocessing & quality assessment (Optimization #3) ──────────────
_MAX_OCR_WIDTH = 800       # Higher resolution for A4 document legibility (Indigency/COE)
_MAX_VIDEO_OCR_WIDTH = 800 # Restored to 800 for better OCR on small text
_MAX_FACE_WIDTH = 224

# Module-level CLAHE instance (reused across all OCR calls instead of recreating each time)
_CLAHE = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))

def assess_image_quality(img):
    """
    Quick image quality assessment before full OCR processing.
    Returns: (is_good_quality: bool, reason: str)
    
    Optimization #3: Reject obviously bad images early to save OCR time.
    """
    if img is None or img.size == 0:
        return False, "Empty image"
    
    # Check dimensions
    height, width = img.shape[:2]
    if width < 200 or height < 100:
        return False, f"Image too small: {width}x{height}"
    
    # Check contrast (Laplacian variance test - detects blur)
    try:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
        laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
        
        # Blurry threshold: Real-world ID photos often have variance 15-80
        # Only reject very severely blurred images (< 10)
        if laplacian_var < 10:
            return False, f"Image too blurry (sharpness: {laplacian_var:.1f})"
        
        # Check brightness: even more lenient (10-245)
        brightness_mean = cv2.mean(gray)[0]
        if brightness_mean < 10 or brightness_mean > 245:
            return False, f"Image too dark or bright (brightness: {brightness_mean:.0f}/255)"
        
        return True, "Good quality"
    except Exception as e:
        print(f"[QUALITY] Assessment error: {e}", flush=True)
        return True, "Unable to assess (proceeding anyway)"  # Don't fail if quality check errors

def _preprocess_strategy_a(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
    gray = _CLAHE.apply(gray)
    return cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 21, 10)

def _preprocess_strategy_b(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (51, 51))
    background = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, kernel)
    diff = cv2.absdiff(gray, background)
    diff = cv2.normalize(diff, None, 0, 255, cv2.NORM_MINMAX)
    _, binary = cv2.threshold(diff, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return binary

def _preprocess_strategy_c(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return binary

def _run_tesseract_on_image(img, psm=3, strategies=None, skip_pass2=False):
    """Internal helper to run OCR on an already decoded/resized image with specified strategies."""
    if img is None: return ""
    results = []
    
    # Pass 1: Raw Grayscale (Best for modern LSTM Tesseract, handles white-on-black perfectly)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
    text1 = pytesseract.image_to_string(gray, config=f'--psm {psm} --oem 3')
    if text1.strip():
        results.append(text1.strip())
        # If Pass 1 is very successful, skip Pass 2 to save significant time
        if len(text1.strip()) > 50:
            return text1.strip()
        
    # Pass 2: Adaptive Thresholding (Fails on white-on-dark, but great for shadows on paper)
    if not skip_pass2:
        try:
            gray_clahe = _CLAHE.apply(gray)
            binary = cv2.adaptiveThreshold(gray_clahe, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 21, 10)
            text2 = pytesseract.image_to_string(binary, config=f'--psm {psm}')
            if text2.strip() and text2.strip() not in results:
                results.append(text2.strip())
        except:
            pass
    
    # If primary failed or multiple strategies requested, try fallbacks
    if strategies:
        for strat_fn in strategies:
            try:
                processed = strat_fn(img)
                txt = pytesseract.image_to_string(processed, config=f'--psm {psm}')
                if txt.strip(): results.append(txt.strip())
            except Exception as e:
                print(f"[OCR] Strategy error: {e}", flush=True)
                
    return "\n".join(results)

def _run_tesseract(image_bytes, fast_mode=True):
    """Legacy wrapper for backward compatibility, now optimized."""
    if not image_bytes: return ""
    try:
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None: return ""
        
        # Consistent resizing
        h, w = img.shape[:2]
        if w > _MAX_OCR_WIDTH:
            scale = _MAX_OCR_WIDTH / w
            img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        
        if fast_mode:
            return _run_tesseract_on_image(img, psm=3)
        else:
            return _run_tesseract_on_image(img, psm=3, strategies=[_preprocess_strategy_b, _preprocess_strategy_c])
    except Exception as e:
        print(f"[OCR] Error: {e}", flush=True)
        return ""

def normalize_for_ocr(s):
    """Normalize text for fuzzy matching."""
    if not s: return ""
    return re.sub(r'[^a-z0-9\s]', ' ', s.lower()).strip()


def _perform_text_matching(ocr_text, target_first_name=None, target_middle_name=None, target_last_name=None, target_address=None, keywords=None, is_indigency=False):
    """
    Unified fuzzy matching logic for names, addresses, and keywords.
    Checks first name, middle name (full or initial), and last name individually if provided.
    Middle name can match either the full name or just the first letter (initial).
    Returns: (name_ok, addr_ok, keywords_found, match_ratio)
    """
    if not ocr_text.strip(): 
        return False, False, [], 0.0
        
    norm_txt = normalize_for_ocr(ocr_text)
    all_ocr_words = norm_txt.split()
    
    # 1. Name Matching (Individual First, Middle, and Last Name Parts)
    n_verified = True
    m_ratio = 1.0
    
    if target_first_name or target_middle_name or target_last_name:
        def check_name_part(name_part, is_middle=False):
            if not name_part: return True, 1.0
            n_words = [w.strip() for w in normalize_for_ocr(name_part).split() if len(w.strip()) >= 2]
            if not n_words: n_words = [w.strip() for w in normalize_for_ocr(name_part).split() if w.strip()]
            f_count = 0
            for word in n_words:
                # For middle names, also accept just the first letter (initial)
                words_to_check = [word]
                if is_middle and len(word) > 1:
                    words_to_check.append(word[0])  # Add initial
                
                found = False
                for check_word in words_to_check:
                    if check_word in norm_txt: f_count += 1; found = True; break
                    found_approx = False
                    for ocr_w in all_ocr_words:
                        if len(ocr_w) < 2: continue
                        if difflib.SequenceMatcher(None, check_word, ocr_w).ratio() >= (0.7 if is_indigency else 0.8):
                            f_count += 1; found_approx = True; break
                    if found_approx: found = True; break
            
            p_ratio = f_count / len(n_words) if n_words else 0
            # Require at least one word to match or a high ratio
            return p_ratio >= (0.4 if is_indigency else 0.5), p_ratio

        first_ok, first_ratio = check_name_part(target_first_name, is_middle=False)
        middle_ok, middle_ratio = check_name_part(target_middle_name, is_middle=True)
        last_ok, last_ratio = check_name_part(target_last_name, is_middle=False)
        
        # All present names must pass for full verification
        n_verified = first_ok and middle_ok and last_ok
        num_names = sum([bool(target_first_name), bool(target_middle_name), bool(target_last_name)])
        if num_names > 0:
            m_ratio = sum([first_ratio if target_first_name else 0, 
                          middle_ratio if target_middle_name else 0, 
                          last_ratio if target_last_name else 0]) / num_names
        else:
            m_ratio = 1.0

    # 2. Address Matching
    a_verified = True
    if target_address:
        norm_target_addr = normalize_for_ocr(target_address)
        if norm_target_addr in norm_txt: 
            a_verified = True
        else:
            # For indigency, get last meaningful word (usually city/municipality) - less strict
            # For others, check all address words
            if is_indigency:
                # For indigency: check all words but ignore generic terms like 'city' or 'municipality'
                # This ensures we match the actual place name (e.g., "Lipa" instead of just "City")
                ignore_words = ['city', 'municipality', 'town', 'province']
                a_words = [w.strip() for w in norm_target_addr.split() if len(w.strip()) >= 2 and w.strip() not in ignore_words]
                
                # If everything was filtered out, fallback to original words
                if not a_words:
                    a_words = [w.strip() for w in norm_target_addr.split() if len(w.strip()) >= 2]
            else:
                a_words = [w.strip() for w in norm_target_addr.split() if len(w.strip()) >= 2]
            
            f_a_count = 0
            for word in a_words:
                if word in norm_txt: f_a_count += 1; continue
                found_approx = False
                for ocr_w in all_ocr_words:
                    if len(ocr_w) < 2: continue
                    if difflib.SequenceMatcher(None, word, ocr_w).ratio() >= 0.7:
                        f_a_count += 1; found_approx = True; break
                if found_approx: continue
            
            # Option A: For indigency, we only need at least one word to match (lenient)
            if is_indigency:
                a_verified = f_a_count >= 1
            else:
                a_verified = (f_a_count / len(a_words) if a_words else 0) >= 0.5

    # 3. Keyword Matching
    found_keywords = []
    if keywords:
        for kw in keywords:
            norm_kw = normalize_for_ocr(kw)
            # Try exact substring match first
            if norm_kw in norm_txt:
                found_keywords.append(kw)
            else:
                # Fuzzy match: allow partial/close matches for document keywords
                # This handles OCR errors and variations in document text
                kw_words = norm_kw.split()
                if kw_words:
                    # Check if any word from the keyword appears in the OCR text with fuzzy matching
                    for kw_word in kw_words:
                        if len(kw_word) < 2: continue
                        for ocr_word in all_ocr_words:
                            if len(ocr_word) < 2: continue
                            # Use 0.7 threshold for fuzzy keyword matching (handles 'enrollment' vs 'enrolment', etc.)
                            if difflib.SequenceMatcher(None, kw_word, ocr_word).ratio() >= 0.7:
                                found_keywords.append(kw)
                                break
                        if kw in found_keywords:
                            break
    
    return n_verified, a_verified, found_keywords, m_ratio


def verify_id_with_ocr(image_bytes, expected_first_name, expected_middle_name, expected_last_name, expected_address=None):
    """
    Optimized version with multiple improvements:
    1. Image quality pre-check (Optimization #3)
    2. OCR result caching by image hash (Optimization #2)
    3. Parallel PSM execution (Optimization #1)
    4. Early exit on successful match
    5. Single decode/resize pass
    6. Middle name validation: accepts full middle name or initial
    """
    if not _check_tesseract(): 
        return False, "OCR Engine (Tesseract) not found.", "", 0.0
    if not image_bytes:
        return False, "No image data provided.", "", 0.0
    
    is_indigency = (expected_address is not None)
    
    # --- OPTIMIZATION #2: Check OCR cache first ---
    image_hash = _hash_image(image_bytes)
    cached_result = _cache_get(image_hash)
    if cached_result is not None:
        cached_text, cached_ratio, cached_message = cached_result
        name_v, addr_v, found_kw, score = _perform_text_matching(cached_text, expected_first_name, expected_middle_name, expected_last_name, expected_address, None, is_indigency)
        if name_v and addr_v:
            print(f"[OCR CACHE HIT] Reusing previous results for {image_hash[:8]}...", flush=True)
            return True, f"Verified (cached)", cached_text, 1.0
    
    # --- OPTIMIZATION #3: Image quality assessment ---
    try:
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None: 
            return False, "Invalid image format", "", 0.0
        
        is_good, quality_reason = assess_image_quality(img)
        if not is_good:
            print(f"[QUALITY REJECT] {quality_reason}", flush=True)
            return False, f"Image quality issue: {quality_reason}", "", 0.0
        
        # Resize image once
        h, w = img.shape[:2]
        if w > _MAX_OCR_WIDTH:
            scale = _MAX_OCR_WIDTH / w
            img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    except Exception as e:
        return False, f"Preprocessing error: {str(e)}", "", 0.0

    best_text = ""
    best_ratio = 0.0
    print(f"[OCR] Running PSM3 verification...", flush=True)
    
    with OCR_SEMAPHORE:
        # PSM3 is typically best for mixed text layouts (IDs, documents)
        # Removed parallel PSM11 - saves 15+ seconds, PSM3 alone is sufficient
        try:
            best_text = _run_tesseract_on_image(img, 3)
            print(f"[OCR] PSM3 completed", flush=True)
        except Exception as e:
            print(f"[OCR] PSM3 error: {e}", flush=True)
            best_text = ""
    
    
    name_v, addr_v, found_kw, best_ratio = _perform_text_matching(best_text, expected_first_name, expected_middle_name, expected_last_name, expected_address, None, is_indigency)
    if name_v and addr_v:
        _cache_set(image_hash, (best_text, best_ratio, "verified_psm3"))
        return True, "Verified", best_text, 1.0
    
    # Return result - no additional fallback passes.
    # Do not auto-verify on partial ratios alone because the OCR payload is
    # compared against the student's current inputs and false positives are worse
    # than surfacing a mismatch for retry.
    if best_ratio >= 0.3:
        prefix = "Indigency: " if is_indigency else ""
        _cache_set(image_hash, (best_text, best_ratio, "partial_match"))
        return False, f"{prefix}Identity mismatch ({best_ratio:.0%})", best_text, best_ratio

    _cache_set(image_hash, (best_text, best_ratio, "failed"))
    return False, "Identity verification mismatch", best_text, 0.0


def extract_document_text(image_bytes, max_width=_MAX_OCR_WIDTH):
    """Fast OCR text extraction for non-identity documents like COE and grades."""
    if not _check_tesseract():
        return "", "OCR Engine (Tesseract) not found."
    if not image_bytes:
        return "", "No image data provided."

    cache_key = _hash_image(image_bytes, suffix=b"_doc_text_v2")
    cached_result = _cache_get(cache_key)
    if cached_result is not None:
        return cached_result

    try:
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return "", "Invalid image format"

        is_good, quality_reason = assess_image_quality(img)
        if not is_good:
            return "", f"Image quality issue: {quality_reason}"

        h, w = img.shape[:2]
        if w > max_width:
            scale = max_width / w
            img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    except Exception as e:
        return "", f"Preprocessing error: {str(e)}"

    with OCR_SEMAPHORE:
        try:
            text = _run_tesseract_on_image(img, psm=6, skip_pass2=True)
            if len(text.strip()) < 20:
                text = _run_tesseract_on_image(img, psm=3, skip_pass2=False)

            # OCR the top header band separately because school names/logos are often
            # above the grade table and can be missed by the fast full-page pass.
            header_height = max(int(img.shape[0] * 0.28), 1)
            header_img = img[:header_height, :]
            header_text = _run_tesseract_on_image(header_img, psm=6, skip_pass2=False)

            if header_text.strip():
                normalized_text = normalize_for_ocr(text)
                normalized_header = normalize_for_ocr(header_text)
                if normalized_header and normalized_header not in normalized_text:
                    text = f"{header_text.strip()}\n{text}".strip()
        except Exception as e:
            return "", f"OCR extraction error: {str(e)}"

    result = (text, None)
    _cache_set(cache_key, result)
    return result


def _preprocess_frame_for_ocr(frame):
    """Enhance a video frame for better OCR accuracy (handles compression artifacts)."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    return _CLAHE.apply(gray)


def verify_video_content(video_bytes, keywords, expected_address=None, sample_positions=None, max_width=None, allow_alt_pass=True, fallback_text_length=0):
    """
    Captures frames from video bytes and scans for keywords and address using OCR.
    Optimized to sample 2 key frames for balanced speed/accuracy.
    
    For videos without address requirements (like COE, Grades), keyword matching is more lenient
    and accepts partial/fuzzy matches to handle OCR errors.
    """
    if not video_bytes: return False, "No video data"
    if not _check_tesseract(): return False, "OCR Engine not found"
    
    # --- SPEED OPTIMIZATION: Check Video Cache ---
    # Instantly returns result if this specific video byte signature was already scanned
    hash_suffix = f"_video_{sample_positions}_{max_width}_{allow_alt_pass}_{fallback_text_length}".encode()
    vid_hash = _hash_image(video_bytes, suffix=hash_suffix)
    cached_res = _cache_get(vid_hash)
    if cached_res is not None:
        print(f"[VIDEO CACHE] Reusing extremely fast cached result for {vid_hash[:8]}...", flush=True)
        return cached_res

    # Determine if this is an address-based verification (indigency only)
    is_address_verification = expected_address is not None
    
    # Save to temp file because VideoCapture needs a path
    with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as tmp:
        tmp.write(video_bytes)
        tmp_path = tmp.name
        
    with OCR_SEMAPHORE:
        try:
            cap = cv2.VideoCapture(tmp_path)
            if not cap.isOpened():
                return False, "Could not open video file"
            
            # Ensure frame count is perfectly accessible
            frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            if frame_count <= 0:
                _cache_set(vid_hash, (False, "Invalid video frame count"))
                return False, "Invalid video frame count"
            
            # Frame positions to sample: Increased for more comprehensive coverage (0.1 to 0.9)
            sample_positions = sample_positions or [0.1, 0.3, 0.5, 0.7, 0.9]
            sample_indices = []
            for pos in sample_positions:
                idx = int(frame_count * pos)
                if idx not in sample_indices:
                    sample_indices.append(idx)

            # Insert cooperative yield for eventlet to prevent blocking other requests
            try:
                import eventlet
                eventlet.sleep(0)
            except ImportError:
                pass

            all_ocr_text = ""
            found_keywords = []
            addr_ok = False

            def process_frame(idx, text_accumulator, keywords_found, address_ok_val):
                # Faster Video OCR Strategy with Enhanced Preprocessing
                cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
                ret, frame = cap.read()
                if not ret or frame is None: return text_accumulator, keywords_found, address_ok_val
                
                # Preprocessing for Video Frames (Optimization: Handles compression artifacts/blur)
                processed_frame = _preprocess_frame_for_ocr(frame)
                
                h, w = processed_frame.shape[:2]
                width_limit = max_width or _MAX_VIDEO_OCR_WIDTH
                if w > width_limit:
                    scale = width_limit / w
                    processed_frame = cv2.resize(processed_frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

                # Try Primary Pass (PSM 3 - Sparse Text)
                text = pytesseract.image_to_string(processed_frame, config='--psm 3 --oem 1')
                
                # If sparse pass is weak, try block-mode pass (PSM 6 - Uniform block)
                if allow_alt_pass and len(text.strip()) < 10:
                    text_alt = pytesseract.image_to_string(processed_frame, config='--psm 6 --oem 1')
                    if len(text_alt.strip()) > len(text.strip()):
                        text = text_alt

                text_accumulator += " " + text
                print(f"[VIDEO OCR] Frame {idx} scanned ({len(text.strip())} chars)...", flush=True)

                _, new_addr, new_kws, _ = _perform_text_matching(text_accumulator, None, None, None, None, keywords=keywords, is_indigency=is_address_verification)
                return text_accumulator, new_kws, new_addr

            is_success = False
            for sample_idx in sample_indices:
                all_ocr_text, found_keywords, addr_ok = process_frame(sample_idx, all_ocr_text, found_keywords, addr_ok)
                missing_kw = [kw for kw in (keywords or []) if kw not in found_keywords]
                if not missing_kw and (not expected_address or addr_ok):
                    is_success = True
                    break
                elif not is_address_verification and found_keywords:
                    is_success = True
                    break
                    
            if expected_address and not addr_ok:
                fail_msg = f"Address mismatch: Region '{expected_address}' not clearly visible in video."
                _cache_set(vid_hash, (False, fail_msg))
                return False, fail_msg

            normalized_text = re.sub(r'\s+', ' ', all_ocr_text).strip()

            if not is_success and fallback_text_length and not is_address_verification and len(normalized_text) >= fallback_text_length:
                msg = f"Validated: readable document text detected ({len(normalized_text)} chars)"
                _cache_set(vid_hash, (True, msg))
                return True, msg

            if not is_success:
                fail_msg = "Required document content not detected in video."
                _cache_set(vid_hash, (False, fail_msg))
                return False, fail_msg
            
            msg = f"Validated: Found {', '.join(found_keywords)}"
            if expected_address: msg += f" and address matched."
            _cache_set(vid_hash, (True, msg))
            return True, msg
        except Exception as e:
            print(f"[VIDEO OCR ERROR] {e}")
            return False, f"Processing error: {str(e)}"
        finally:
            if 'cap' in locals() and cap is not None:
                try: cap.release()
                except: pass
            if os.path.exists(tmp_path):
                try: os.remove(tmp_path)
                except: pass

def extract_school_year_from_text(text):
    if not text: return None
    # Priority 1: Year range or single year preceded by a school-year keyword
    # e.g. "School Year Sem : 2025 - 2026", "S.Y. 2025-2026", "A.Y. 2025-2026"
    keyword_match = re.search(
        r'(?:school\s*year|s\.?y\.?|a\.?y\.?)\s*[:\-]?\s*(20\d{2}(?:\s*[-–]\s*20\d{2})?)',
        text, re.IGNORECASE
    )
    if keyword_match:
        return keyword_match.group(1).strip()
    # Priority 2: Any year RANGE (e.g. "2025 - 2026") anywhere in the text
    range_match = re.search(r'20\d{2}\s*[-–]\s*20\d{2}', text)
    if range_match:
        return range_match.group(0)
    # Priority 3: First standalone 20XX year (original fallback)
    match = re.search(r'20\d{2}', text)
    return match.group(0) if match else None

def extract_school_year(image_bytes):
    text = _run_tesseract(image_bytes, fast_mode=True)
    return extract_school_year_from_text(text)

def extract_semester_from_text(text):
    if not text: return None
    semester_patterns = [
        r'(1st|2nd|first|second|1|2)\s*(?:sem|semester)\b',
        r'\b(?:sem|semester)\s*[:\-]?\s*(1st|2nd|first|second|1|2)\b',
    ]
    for pattern in semester_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return normalize_semester_label(match.group(1))
    return None

def normalize_semester_label(value):
    if value is None:
        return None

    semester_value = str(value).strip().lower()
    if not semester_value:
        return None

    if '1' in semester_value or 'first' in semester_value:
        return "1st"
    if '2' in semester_value or 'second' in semester_value:
        return "2nd"
    return None

def _extract_year_values(value):
    if not value:
        return []
    return [int(year) for year in re.findall(r'20\d{2}', str(value))]

def is_current_school_year(year_str, semester_str=None, expected_year="2026", expected_semester=None):
    if not year_str or not expected_year:
        return False

    extracted_years = _extract_year_values(year_str)
    if not extracted_years:
        return False

    expected_years = _extract_year_values(expected_year)
    if not expected_years:
        expected_years = [2025, 2026]

    min_exp, max_exp = min(expected_years), max(expected_years)
    year_ok = any(min_exp <= y <= max_exp for y in extracted_years)

    if not year_ok:
        return False

    norm_expected = normalize_semester_label(expected_semester)
    norm_extracted = normalize_semester_label(semester_str)

    if norm_expected and norm_extracted and norm_expected != norm_extracted:
        return False
    
    return True

# ─── Face & Neural Signature Verification Wrappers ───────────────────────────

def _init_face_models():
    """Lazily initialize UniFace models once per process."""
    global _FACE_DETECTOR, _FACE_RECOGNIZER, _FACE_MODEL_INIT_ERROR

    if _FACE_DETECTOR is not None and _FACE_RECOGNIZER is not None:
        return _FACE_DETECTOR, _FACE_RECOGNIZER

    if _FACE_MODEL_INIT_ERROR:
        raise RuntimeError(_FACE_MODEL_INIT_ERROR)

    with _FACE_MODEL_LOCK:
        if _FACE_DETECTOR is not None and _FACE_RECOGNIZER is not None:
            return _FACE_DETECTOR, _FACE_RECOGNIZER

        try:
            from uniface.detection import RetinaFace
            from uniface.recognition import ArcFace

            providers = ['CPUExecutionProvider']
            _FACE_DETECTOR = RetinaFace(providers=providers)
            _FACE_RECOGNIZER = ArcFace(providers=providers)
            print("[FACE] UniFace RetinaFace and ArcFace initialized on CPU.", flush=True)
        except Exception as exc:
            _FACE_MODEL_INIT_ERROR = f"Failed to initialize UniFace models: {str(exc)}"
            print(f"[FACE] {_FACE_MODEL_INIT_ERROR}", flush=True)
            raise RuntimeError(_FACE_MODEL_INIT_ERROR) from exc

    return _FACE_DETECTOR, _FACE_RECOGNIZER

def _decode_face_image(image_bytes):
    """Decode raw image bytes into an OpenCV BGR image."""
    if not image_bytes:
        raise ValueError("Missing image data.")

    nparr = np.frombuffer(image_bytes, np.uint8)
    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Failed to decode image.")

    height, width = image.shape[:2]
    max_dim = max(height, width)
    if max_dim > _MAX_FACE_WIDTH:
        scale = _MAX_FACE_WIDTH / float(max_dim)
        image = cv2.resize(
            image,
            (max(1, int(width * scale)), max(1, int(height * scale))),
            interpolation=cv2.INTER_AREA,
        )

    return image

def _pick_primary_face(faces, image_label):
    """Select the highest-confidence face above threshold."""
    if not faces:
        raise ValueError(f"No face detected in {image_label}.")

    valid_faces = [face for face in faces if getattr(face, 'confidence', 0.0) >= _FACE_DETECTION_THRESHOLD]
    if not valid_faces:
        raise ValueError(f"No reliable face detected in {image_label}.")

    return max(valid_faces, key=lambda face: getattr(face, 'confidence', 0.0))

def verify_face_with_id(user_photo_bytes, id_photo_bytes):
    """
    Verify a live/selfie photo against the face in the uploaded ID image.

    Uses UniFace RetinaFace for detection and ArcFace for embedding extraction,
    then compares normalized embeddings with cosine similarity.
    """
    try:
        detector, recognizer = _init_face_models()

        user_image = _decode_face_image(user_photo_bytes)
        id_image = _decode_face_image(id_photo_bytes)

        user_faces = detector.detect(user_image)
        id_faces = detector.detect(id_image)

        user_face = _pick_primary_face(user_faces, 'the live photo')
        id_face = _pick_primary_face(id_faces, 'the ID image')

        user_embedding = recognizer.get_normalized_embedding(user_image, user_face.landmarks)
        id_embedding = recognizer.get_normalized_embedding(id_image, id_face.landmarks)

        if user_embedding is None or id_embedding is None:
            return False, "Face embeddings could not be generated.", 0.0

        try:
            from uniface import compute_similarity
            similarity = float(compute_similarity(user_embedding, id_embedding, normalized=True))
        except Exception:
            similarity = float(np.dot(user_embedding, id_embedding.T)[0][0])

        similarity = max(0.0, min(1.0, similarity))

        if similarity >= _FACE_MATCH_THRESHOLD:
            return True, f"Face verified (similarity: {similarity:.3f})", similarity

        if similarity >= 0.40:
            return False, f"Face match uncertain (similarity: {similarity:.3f}).", similarity

        return False, f"Face does not match the ID (similarity: {similarity:.3f}).", similarity
    except ValueError as exc:
        return False, str(exc), 0.0
    except Exception as exc:
        print(f"[FACE] Verification error: {exc}", flush=True)
        return False, f"Face verification error: {str(exc)}", 0.0

def verify_signature_against_id(signature_bytes, id_back_bytes, student_id=None):
    """
    Neural signature matching against ID back image.
    FIXED (Priority 6): Corrected function signature to match call site in student_api.py
    
    Args:
        signature_bytes: Signature drawing as bytes or base64 data URI
        id_back_bytes: ID back image as bytes or base64 data URI
        student_id: Optional student ID for profile-based matching
    
    Returns:
        (verified: bool, message: str, confidence: float, 
         processed_signature_img: ndarray, extracted_id_img: ndarray)
    """
    try:
        from .signature_brain import calculate_neural_match
        
        if not signature_bytes or not id_back_bytes:
            return False, "Missing signature or ID image", 0.0, None, None
        
        # Safely decode signature
        try:
            sig_data = decode_base64(signature_bytes)
            sig_arr = np.frombuffer(sig_data, np.uint8)
            sig_img = cv2.imdecode(sig_arr, cv2.IMREAD_COLOR)
        except Exception as e:
            print(f"[SIGNATURE] Error decoding signature: {e}", flush=True)
            return False, "Invalid signature format", 0.0, None, None
        
        # Safely decode ID back image
        try:
            id_data = decode_base64(id_back_bytes)
            id_arr = np.frombuffer(id_data, np.uint8)
            id_img = cv2.imdecode(id_arr, cv2.IMREAD_COLOR)
        except Exception as e:
            print(f"[SIGNATURE] Error decoding ID image: {e}", flush=True)
            return False, "Invalid ID image format", 0.0, None, None
        
        if sig_img is None or id_img is None:
            return False, "Could not decode images", 0.0, None, None
        
        # Neural matching
        try:
            score = calculate_neural_match(sig_img, student_id) if student_id else calculate_neural_match(sig_img, None)
        except Exception as e:
            print(f"[SIGNATURE] Error in neural matching: {e}", flush=True)
            return False, f"Matching error: {str(e)}", 0.0, sig_img, id_img
        
        # Threshold 0.65 as established in previous neural training sessions
        threshold = 0.65
        is_verified = score >= threshold
        status = "Neural signature match successful" if is_verified else f"Neural signature mismatch (score: {score:.2f}, threshold: {threshold})"
        
        return is_verified, status, float(score), sig_img, id_img
    except Exception as e:
        print(f"[SIGNATURE] Wrapper error: {e}", flush=True)
        return False, str(e), 0.0, None, None

def save_signature_profile(student_id, drawing_data):
    """
    Saves a drawing sample to the student's Neural History for adaptive learning.
    """
    try:
        if not drawing_data: return False
        
        # Safe decode base64
        if isinstance(drawing_data, str):
            if ',' in drawing_data: drawing_data = drawing_data.split(',')[1]
            drawing_data = base64.b64decode(drawing_data)
            
        history_dir = os.path.join(os.getcwd(), 'knowledge', 'signature_profiles', 'history', str(student_id))
        os.makedirs(history_dir, exist_ok=True)
        
        # Save with high-res timestamp
        file_path = os.path.join(history_dir, f"{int(time.time() * 1000)}.png")
        with open(file_path, 'wb') as f:
            f.write(drawing_data)
            
        print(f"[SIGNATURE] Saved training sample for student {student_id}", flush=True)
        return True
    except Exception as e:
        print(f"[SIGNATURE] Save error: {e}", flush=True)
        return False