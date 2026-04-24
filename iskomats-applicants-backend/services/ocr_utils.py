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
import threading
from concurrent.futures import ThreadPoolExecutor
from collections import OrderedDict
from project_config import get_performance_config

# Get performance profile
_perf = get_performance_config()
_ocr_concurrency = _perf['ocr_concurrency']
_threads_per_proc = str(_perf['threads_per_process'])

# Environment-aware execution helper
def _run_ocr_command(func, *args, **kwargs):
    """Executes OCR in a thread-safe way, aware of both Flask (eventlet) and FastAPI (standard) envs."""
    try:
        import eventlet.patcher
        if eventlet.patcher.is_monkey_patched('os'):
            import eventlet.tpool
            return eventlet.tpool.execute(func, *args, **kwargs)
    except ImportError:
        pass
    return func(*args, **kwargs)

# Global concurrency control
OCR_SEMAPHORE = threading.Semaphore(_ocr_concurrency)

# ─── Environment hints for threading & memory ──────────────────────────────────
# Force limited execution for heavy ML (ONNX/UniFace) 
# Controlled by PERFORMANCE_CONFIG for stability.
os.environ["OMP_NUM_THREADS"] = _threads_per_proc
os.environ["MKL_NUM_THREADS"] = _threads_per_proc
os.environ["OPENBLAS_NUM_THREADS"] = _threads_per_proc
os.environ["VECLIB_MAXIMUM_THREADS"] = _threads_per_proc
os.environ["NUMEXPR_NUM_THREADS"] = _threads_per_proc
cv2.setNumThreads(int(_threads_per_proc)) 


def clear_heavy_memory():
    """Aggressive memory release for 512MB limits."""
    # Only garbage collect if explicitly requested or in LOW mode
    if _perf.get('gc_frequency') == 'always':
        gc.collect()
        try:
            # Clear OpenCV cache (internally keeps many mat frames)
            cv2.setNumThreads(1)
            cv2.setNumThreads(int(_threads_per_proc))
        except:
            pass


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
_OCR_CACHE_SIZE_LIMIT = 200
_CACHE_METRICS = {'hits': 0, 'misses': 0}
_FACE_MODEL_LOCK = threading.Semaphore(1)
_FACE_DETECTOR = None
_FACE_RECOGNIZER = None
_FACE_MODEL_INIT_ERROR = None
_FACE_MATCH_THRESHOLD = 0.42 # Increased for stricter verification (preventing occlusion acceptance)
_FACE_DETECTION_THRESHOLD = 0.40 # Increased to ensure high-quality face detection

# Preload Tesseract at startup for faster first OCR (after definition)
def _preload_tesseract():
    try:
        _init_tesseract()
    except Exception as e:
        print(f"[OCR] Tesseract preload failed: {e}", flush=True)


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
    
_preload_tesseract()

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
# Image dimensions for OCR (Lower = Faster)
_MAX_OCR_WIDTH = 800 
_MAX_VIDEO_OCR_WIDTH = 450
_MAX_FACE_WIDTH = 400

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

def _preprocess_strategy_white_on_dark(img):
    """
    Specialized strategy for white/light text on dark backgrounds.
    Estimated background via MORPH_OPEN (removes light text), then diffs and inverts.
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
    gray = _CLAHE.apply(gray)
    
    # 1. Background estimation (remove bright text from dark background)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (41, 41))
    bg = cv2.morphologyEx(gray, cv2.MORPH_OPEN, kernel)
    
    # 2. Highlight text and normalize
    diff = cv2.absdiff(gray, bg)
    diff = cv2.normalize(diff, None, 0, 255, cv2.NORM_MINMAX)
    
    # 3. Invert to get Black-on-White (Tesseract preference)
    inverted = cv2.bitwise_not(diff)
    _, binary = cv2.threshold(inverted, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return binary
def _run_tesseract_on_image(img, psm=3, strategies=None, skip_pass2=False, label=""):
    """Internal helper to run OCR on an already decoded/resized image with specified strategies."""
    if img is None: return ""
    results = []
    
    # Pass 1: Raw Grayscale (Best for modern LSTM Tesseract)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
    
    # OEM 1 (LSTM-only) is significantly faster than Legacy mode
    text1 = _run_ocr_command(pytesseract.image_to_string, gray, config=f'--psm {psm} --oem 1')
    results.append(text1.strip())
    
    # Pass in fast mode only if we already have sufficient text density
    if skip_pass2 and len(text1.strip()) > 15:
        return text1.strip()
        
    # Parallel Fallback Execution for Hard Documents
    # If the primary pass was poor, fire all specialized preprocessing strategies in parallel
    needs_fallbacks = len(text1.strip()) < 12 and not skip_pass2
    
    if needs_fallbacks:
        strategies_to_run = []
        # A: Adaptive Thresholding
        strategies_to_run.append(("Adaptive", lambda i: cv2.adaptiveThreshold(_CLAHE.apply(cv2.cvtColor(i, cv2.COLOR_BGR2GRAY) if len(i.shape) == 3 else i), 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 21, 10)))
        # B: Sharpening
        strategies_to_run.append(("Sharpen", lambda i: cv2.filter2D(cv2.cvtColor(i, cv2.COLOR_BGR2GRAY) if len(i.shape) == 3 else i, -1, np.array([[-1,-1,-1], [-1,9,-1], [-1,-1,-1]]))))
        # C: Background Removal (Strategy B)
        strategies_to_run.append(("BgRemoval", _preprocess_strategy_b))
        # D: White-on-Dark
        strategies_to_run.append(("WhiteOnDark", _preprocess_strategy_white_on_dark))
        
        # Add custom strategies if provided
        if strategies:
            for s_idx, s_fn in enumerate(strategies):
                if s_fn not in [_preprocess_strategy_b, _preprocess_strategy_white_on_dark]:
                    strategies_to_run.append((f"Custom{s_idx}", s_fn))

        with ThreadPoolExecutor(max_workers=min(len(strategies_to_run), 4)) as fallback_executor:
            def run_strategy(name, strat_fn):
                try:
                    processed = strat_fn(img)
                    with OCR_SEMAPHORE:
                        return _run_ocr_command(pytesseract.image_to_string, processed, config=f'--psm {psm} --oem 1')
                except:
                    return ""
            
            futures = [fallback_executor.submit(run_strategy, name, fn) for name, fn in strategies_to_run]
            for f in futures:
                res = f.result().strip()
                if res and res not in results:
                    results.append(res)
                
    # PSM 11 Fallback: Sparse text detection. Great for grabbing text that PSM 3 skips due to column layouts.
    if not skip_pass2 and len("\n".join(results).strip()) < 15:
        try:
            with OCR_SEMAPHORE:
                txt11 = _run_ocr_command(pytesseract.image_to_string, gray, config='--psm 11 --oem 1')
                if txt11.strip() and txt11.strip() not in results:
                    results.append(txt11.strip())
        except:
            pass
                 
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
            return _run_tesseract_on_image(img, psm=3, strategies=[_preprocess_strategy_b, _preprocess_strategy_white_on_dark, _preprocess_strategy_c])
    except Exception as e:
        print(f"[OCR] Error: {e}", flush=True)
        return ""

def normalize_for_ocr(s):
    """Deeply normalize string for better matching (removes symbols, lowercases)."""
    if not s: return ""
    return re.sub(r'[^a-z0-9\s]', ' ', s.lower()).strip()

def year_level_matches_text(target_year, text):
    """
    Checks if a target year level (e.g., '1st Year', 'Grade 11', 'Year Level: 1') is mentioned in the text.
    Handles various formats and common OCR misreads like 'I' or 'l' for '1'.
    """
    if not target_year: return True, None
    
    t_year = str(target_year).lower().strip()
    # Normalize expected to just the digit/number if it's something like "1st Year" or "Grade 11"
    match_number = re.search(r'\b(\d{1,2})(?:st|nd|rd|th)?\b', t_year)
    expected_level = match_number.group(1) if match_number else t_year
    
    norm_text = text.lower()
    
    # Roman numeral variations for common year levels
    roman_map = {'1': 'i', '2': 'ii', '3': 'iii', '4': 'iv', '5': 'v'}
    expected_roman = roman_map.get(expected_level)
    
    # Common OCR misreads for specific digits
    digit_misreads = {
        '0': r'[0OQoD]',
        '1': r'[1Il|!i/]',
        '2': r'[2ZzS]',
        '3': r'[3E]',
        '4': r'[4A]',
        '5': r'[5SsS\$]',
        '6': r'[6G]',
        '7': r'[7T]',
        '8': r'[8B]',
        '9': r'[9gq]'
    }
    
    # Suffixes
    suffix_pattern = r'(?:st|nd|rd|th|ist|lst|Is\b|si)?'
    # Build regex pattern for the number (handling two-digit numbers like 10, 11, 12)
    def get_char_pattern(digit):
        return digit_misreads.get(digit, re.escape(digit))
    
    number_pattern = "".join(get_char_pattern(d) for d in expected_level)
    
    # Prefix variations: Year, Level, Yr, Lvl, Y/L
    # Loosened boundary before 'level' to handle "YearLevel" concatenation from OCR
    prefix_pattern = r'(?:year\s*l?e?v?e?l?|yr\.?\s*l?e?v?e?l?|year/level|yr/lvl|lvl\.?|level|lev|yr\.?)'
    
    # Pattern A: Standard labels with expanded prefixes
    # Handles: "Year Level: 1", "Lvl: 1", "Year: 1", "YearLevel 1"
    # Note: [^\w] is used before the prefix to handle concatenation while still ensuring it's likely a label
    if re.search(rf'(?:^|[^\w]){prefix_pattern}\s*[:\-.;]?\s*{number_pattern}{suffix_pattern}\b', norm_text, re.IGNORECASE):
        return True, expected_level
    
    # Pattern B: Standalone with Year/Yr suffix
    if re.search(rf'\b{number_pattern}{suffix_pattern}?\s*(?:year|yr\.?)\b', norm_text, re.IGNORECASE):
        return True, expected_level

    # Pattern C: Word-based mapped variations
    variations = []
    if expected_level == '1': variations.extend(['1st', 'first', 'yr 1', 'year 1', 'yr1', 'year1', 'freshman', 'freshmen', 'freshie'])
    elif expected_level == '2': variations.extend(['2nd', 'second', 'yr 2', 'year 2', 'yr2', 'year2', 'sophomore'])
    elif expected_level == '3': variations.extend(['3rd', 'third', 'yr 3', 'year 3', 'yr3', 'year3', 'junior'])
    elif expected_level == '4': variations.extend(['4th', 'fourth', 'yr 4', 'year 4', 'yr4', 'year4', 'senior'])
    
    if expected_roman:
        variations.append(rf'\b{expected_roman}\b')
    
    for v in variations:
        if re.search(v if v.startswith('\\b') else rf'\b{re.escape(v)}\b', norm_text, re.IGNORECASE):
            return True, expected_level
    
    # Pattern D: Final fallback - Look for a prefix followed by the target number within a small window
    if re.search(rf'{prefix_pattern}.{{0,35}}?{number_pattern}\b', norm_text, re.IGNORECASE | re.DOTALL):
        return True, expected_level
        
    # Pattern E: Standalone match for ordinal numbers (e.g. "1st", "2nd")
    if re.search(rf'\b{number_pattern}{suffix_pattern}\b', norm_text, re.IGNORECASE):
        # But only if it's likely a year level (e.g. near "Year" or at start of line)
        if re.search(rf'\b{number_pattern}{suffix_pattern}\s*year\b', norm_text, re.IGNORECASE):
            return True, expected_level

    return False, None


def course_matches_text(target_course, text):
    """
    Checks if the student's course/degree is mentioned in the text.
    Handles abbreviations (e.g., 'BSCS' vs 'Computer Science').
    """
    if not target_course: return True, None
    
    # Normalize
    t_course = target_course.lower().strip()
    norm_text = text.lower()
    
    # 1. Exact string match
    if t_course in norm_text:
        return True, t_course
        
    # 2. Abbreviation detection
    # Example: "Bachelor of Science in Computer Science" -> "BSCS"
    words = [w.strip() for w in re.split(r'[^a-zA-Z0-9]', target_course) if w.strip()]
    meaningful_words = [w for w in words if w.lower() not in {'of', 'in', 'and', 'the', 'for', 'science', 'arts'}]
    
    if len(words) >= 2:
        # Create common acronyms
        # All words acronym: BSCS
        acronym1 = "".join(w[0].lower() for w in words)
        # Meaningful words acronym: CS
        acronym2 = "".join(w[0].lower() for w in meaningful_words) if meaningful_words else ""
        
        for acr in [acronym1, acronym2]:
            if len(acr) >= 2 and re.search(rf'\b{re.escape(acr)}\b', norm_text):
                return True, acr
                
    # 2.5 Explicit Acronyms in Target Course
    # If the user typed "BSIT" explicitly, we should trust that explicit uppercase acronym
    target_words = re.split(r'[^a-zA-Z0-9]', target_course)
    explicit_acronyms = [w.lower() for w in target_words if w.isupper() and len(w) >= 3]
    clean_text = "".join(filter(str.isalnum, str(text))).lower()
    for acr in explicit_acronyms:
        # Check against pure alphanumeric text to ignore arbitrary spaces added by OCR
        if acr in clean_text:
            return True, acr

    # 2.7 Specific Mappings (e.g., Information Technology -> IT)
    mappings = {
        "computer science": ["cs", "compsci"],
        "information technology": ["it", "infotech"],
        "business administration": ["ba", "busad"],
        "civil engineering": ["ce", "civil"],
        "mechanical engineering": ["me", "mech"],
        "electrical engineering": ["ee", "elec"],
        "nursing": ["bsn"],
        "accountancy": ["bsa"],
        "criminology": ["bscrim"]
    }
    for full, short_list in mappings.items():
        if full in t_course:
            for s in short_list:
                if re.search(rf'\b{re.escape(s)}\b', norm_text):
                    return True, s
        for s in short_list:
            if s in t_course and full in norm_text:
                return True, full

    # 3. Individual word matching (must match at least 60% of significant words)
    if meaningful_words:
        matches = 0
        for w in meaningful_words:
            if w.lower() in norm_text:
                matches += 1
            else:
                # Fuzzy match each word
                found_fuzzy = False
                for ocr_w in norm_text.split():
                    if len(ocr_w) >= 3 and len(w) >= 3:
                        if difflib.SequenceMatcher(None, w.lower(), ocr_w).ratio() >= 0.85:
                            matches += 1
                            found_fuzzy = True
                            break
                if found_fuzzy: continue
        
        if (matches / len(meaningful_words)) >= 0.6:
            return True, t_course
            
    return False, None

def gpa_matches_text(raw_text, expected_gpa):
    """
    Validates if the expected GPA (float or string) exists in the OCR text.
    Handles various labels (GPA, GWA, QPA) and precision variations.
    """
    # 1. Normalize expected GPA as a string to preserve precision
    expected_str = str(expected_gpa or '').strip()
    match_expected = re.search(r'\d+(?:\.\d+)?', expected_str)
    if not match_expected:
        return True, None, []
    
    expected_digits = match_expected.group(0).replace(',', '.') # e.g. "3.54"
    raw_text_str = str(raw_text or '')
    
    # Homoglyphs for number correction
    HOMOGLYPHS = {'s': '5', 'o': '0', 'z': '2', 'b': '8', 'i': '1', 'l': '1', 't': '7'}

    def clean_num(s):
        s = s.replace(' ', '').replace(',', '.').lower()
        for char, sub in HOMOGLYPHS.items():
            s = s.replace(char, sub)
        return s

    # 2. Extract all potential numbers from text
    num_pattern = r'\b(\d+\s*[\.\,]\s*[a-zA-Z0-9]{1,4}|[a-zA-Z0-9]{1,5})\b'
    
    candidates = []
    # a. Check labeled sections first (GPA, GWA, etc)
    gpa_patterns = [
        r'g\s*\.?\s*p\s*\.?\s*a\s*\.?\s*[:=]?\s*([a-zA-Z0-9]+\s*[\.\,]\s*[a-zA-Z0-9]+|[a-zA-Z0-9]+)',
        r'weighted\s*average\s*[:=]?\s*([a-zA-Z0-9]+\s*[\.\,]\s*[a-zA-Z0-9]+|[a-zA-Z0-9]+)',
        r'g\s*w\s*a\s*[:=]?\s*([a-zA-Z0-9]+\s*[\.\,]\s*[a-zA-Z0-9]+|[a-zA-Z0-9]+)',
        r'q\s*p\s*a\s*[:=]?\s*([a-zA-Z0-9]+\s*[\.\,]\s*[a-zA-Z0-9]+|[a-zA-Z0-9]+)',
        r'\b(?:avg|average|rating|weighted\s*avg|gwa|gpa)\s*[:=]?\s*([a-zA-Z0-9]+\s*[\.\,]\s*[a-zA-Z0-9]+|[a-zA-Z0-9]+)'
    ]
    
    for pattern in gpa_patterns:
        for m in re.finditer(pattern, raw_text_str, re.IGNORECASE):
            val = clean_num(m.group(1))
            if val and val not in candidates:
                candidates.append(val)
            
    # b. Absolute fallback: all words that look like numbers
    for m in re.finditer(num_pattern, raw_text_str):
        c = clean_num(m.group(1))
        # Filter for things that look like GPA (usually between 1 and 100)
        try:
            f_c = float(c)
            if 1.0 <= f_c <= 100.0 and c not in candidates:
                candidates.append(c)
        except: continue

    # 3. Apply the "Robust Match" rule
    target_clean = clean_num(expected_digits)
    
    for c in candidates:
        # Check both directions for prefix matching (handles user truncation AND OCR truncation)
        if c.startswith(target_clean) or target_clean.startswith(c):
            if len(c) >= 2 and len(target_clean) >= 2: # Avoid matching single digits
                return True, expected_digits, [c]
            
    # 4. Fallback for float matching with expanded tolerance (0.05)
    try:
        expected_val = float(target_clean)
        for c in candidates:
            try:
                c_val = float(c)
                # 0.05 tolerance handles common rounding/truncation (e.g. 3.43 vs 3.4375)
                if abs(c_val - expected_val) < 0.05:
                    return True, expected_digits, [c]
            except: continue
    except: pass

    return False, None, candidates

def normalize_to_percent(val):
    """Converts GPA-scale values (e.g. 1.0-5.0) to percentage-scale (e.g. 75-100) if needed."""
    try:
        v = float(val)
        if 1.0 <= v <= 5.0:
            # Simple inverse mapping for common PH university scales (1.0 = 100, 3.0 = 75)
            return 100 - (v - 1.0) * 12.5
        return v
    except:
        return 0

def academic_year_matches_expected(found_year, expected_year):
    """
    Validates if the detected year in document matches the expected academic year.
    Supports ranges (2024-2025) and single years.
    """
    if not expected_year: return True
    if not found_year: return False

    # Normalize found and expected to digit lists
    found_years = [int(y) for y in re.findall(r'20\d{2}', str(found_year))]
    # Handle both hyphen and Unicode dashes
    expected_str = str(expected_year).replace('–', '-').replace('—', '-')
    expected_years = [int(y) for y in re.findall(r'20\d{2}', expected_str)]

    if not found_years or not expected_years: return False

    # Check for direct year match
    for f in found_years:
        if f in expected_years:
            return True
            
    # Range check
    if len(expected_years) >= 2:
        min_exp, max_exp = min(expected_years), max(expected_years)
        return any(min_exp <= y <= max_exp for y in found_years)
    
    # Target check
    latest_found = max(found_years)
    target_year = expected_years[0]
    return latest_found >= target_year


def student_id_no_matches_text(target_id, text):
    """
    Checks if the student's ID number is present in the text.
    Cleans dashes and spaces for robust matching.
    """
    if not target_id: return True, None
    
    def normalize_id(s):
        # 1. Alphanumeric only
        s = "".join(filter(str.isalnum, str(s))).lower()
        # 2. Homoglyph substitution (handle common OCR jitters)
        s = s.replace('o', '0').replace('q', '0').replace('d', '0') # 0
        s = s.replace('i', '1').replace('l', '1').replace('|', '1').replace('!', '1') # 1
        s = s.replace('z', '2') # 2
        s = s.replace('s', '5') # 5
        s = s.replace('g', '6').replace('b', '6') # 6
        s = s.replace('q', '9') # 9
        return s
    
    t_id = normalize_id(target_id)
    if not t_id: return True, None
    
    # Search for "Student No" to isolate the actual number block if possible
    # This helps when the document has many numbers
    id_patterns = [
        r'(?:student\s*no|id\s*no|registration\s*no|lrn|learner|control\s*no|matriculation)[:\.\s-]+([a-z0-9\s-]{4,20})',
        r'id\s*(?:no|number|#)[:\.\s-]+([a-z0-9\s-]{4,20})',
        r'\b(?:no|#)[:\.\s-]*([a-z0-9\s-]{6,15})\b'
    ]
    
    for pat in id_patterns:
        match = re.search(pat, text, re.IGNORECASE)
        if match:
            captured = normalize_id(match.group(1))
            if t_id in captured:
                return True, target_id
    
    norm_text = normalize_id(text)
    
    if t_id in norm_text:
        return True, target_id
    
    # Check words individually if ID has non-digits (e.g., "ST2024-123")
    for word in text.split():
        norm_word = normalize_id(word)
        if t_id in norm_word:
            return True, target_id
            
    # User requested strictness: ID must not tolerate wrong DIGIT substitutions (e.g. 123456789 vs 123456788).
    # Instead of difflib which allows any char, we use a strict regex that ONLY tolerates common OCR homoglyphs.
    mapping = {
        '0': '[0oqhd]',
        '1': '[1ils5j7/!|]', # Very broad 1 mapping
        '2': '[2zsa7]',
        '3': '[3e8]',
        '4': '[4a]',
        '5': '[5s1]',
        '6': '[6gb5]',
        '7': '[71lty/]', # 7 often misread as y or /
        '8': '[8b3]',
        '9': '[9gq]'
    }

    def build_homoglyph_regex(s):
        s = "".join(filter(str.isalnum, str(s))).lower()
        return "".join([mapping.get(c, re.escape(c)) for c in s])

    clean_target_id = "".join(filter(str.isalnum, str(target_id))).lower()
    if len(clean_target_id) >= 6:
        pattern = build_homoglyph_regex(clean_target_id)
        full_clean_text = "".join(filter(str.isalnum, str(text))).lower()
        # Search the entire concatenated alphanumeric string to ignore rogue spaces added by OCR
        if re.search(pattern, full_clean_text):
            return True, target_id
            
    # Check for off-by-one errors for better user feedback (don't verify, just log/return hint)
    if len(clean_target_id) >= 8:
        for word in text.split():
            clean_word = "".join(filter(str.isalnum, str(word))).lower()
            if len(clean_word) == len(clean_target_id):
                diffs = sum(1 for a, b in zip(clean_target_id, clean_word) if a != b)
                if diffs == 1:
                    print(f"[ID HINT] ID is almost a match: Found '{clean_word}' vs target '{clean_target_id}'", flush=True)
            
    return False, None


def _perform_text_matching(ocr_text, target_first_name=None, target_middle_name=None, target_last_name=None, target_address=None, target_id_no=None, target_year_level=None, target_school_name=None, keywords=None, is_indigency=False):
    """
    Unified fuzzy matching logic for names, addresses, and keywords.
    Checks first name, middle name (full or initial), and last name individually if provided.
    Also handles ID number and year level validation.
    Returns: (name_ok, addr_ok, keywords_found, match_ratio, meta)
    """
    meta = {}
    if not ocr_text.strip(): 
        return False, False, [], 0.0, meta
        
    norm_txt = normalize_for_ocr(ocr_text)
    all_ocr_words = norm_txt.split()
    
    # 1. Name Matching (Individual First, Middle, and Last Name Parts)
    n_verified = True
    m_ratio = 1.0
    
    if target_first_name or target_middle_name or target_last_name:
        def check_name_part(name_part, is_middle=False, strictness=0.85):
            if not name_part: return True, 1.0
            # 1.a Title Filtering: Ignore common titles that might be in profile but not on documents
            titles_to_ignore = {'governor', 'honorable', 'hon', 'mayor', 'dr', 'doctor', 'mr', 'ms', 'mrs', 'atty', 'attorney'}
            n_words = [w.strip() for w in normalize_for_ocr(name_part).split() if len(w.strip()) >= 2 and w.strip() not in titles_to_ignore]
            if not n_words: 
                # Fallback to unfiltered if everything was a title (e.g. name is just "Mr. X")
                n_words = [w.strip() for w in normalize_for_ocr(name_part).split() if len(w.strip()) >= 2]
            
            if not n_words: n_words = [w.strip() for w in normalize_for_ocr(name_part).split() if w.strip()]
            f_count = 0
            
            # Lenient threshold for names to handle minor OCR misreads
            # REDUCED FURTHER: 0.60 for Indigency, 0.65 for SchoolID to maximize recovery of noisy IDs
            effective_threshold = 0.60 if is_indigency else 0.65
            
            for word in n_words:
                # For middle names, also accept just the first letter (initial)
                words_to_check = [word]
                if is_middle and len(word) > 1:
                    words_to_check.append(word[0])  # Add initial
                
                found = False
                for check_word in words_to_check:
                    # Check for whole word match first (stricter than 'in')
                    if re.search(rf'\b{re.escape(check_word)}\b', norm_txt):
                        f_count += 1; found = True; break
                    elif check_word in norm_txt:
                        for ocr_w in all_ocr_words:
                            if check_word in ocr_w or ocr_w in check_word:
                                len_diff = abs(len(ocr_w) - len(check_word))
                                # For Indigency, allow much larger length differences (merged words in OCR)
                                if is_indigency or (len_diff <= 2 and len_diff <= (max(len(ocr_w), len(check_word)) * 0.2)):
                                    f_count += 1; found = True; break
                        if found: break
                    
                    # Target: Middle Name Initial Misread Tolerance (Specific to Middle Names)
                    if is_middle and len(check_word) == 1:
                        # Common misreads for initials
                        misreads = []
                        if check_word == 'o': misreads = ['0', '8', '@']
                        elif check_word == 'i': misreads = ['1', 'l', '|', '/', '!']
                        elif check_word == 'b': misreads = ['8']
                        elif check_word == 's': misreads = ['5']
                        
                        for m in misreads:
                            if re.search(rf'\b{re.escape(m)}\b', norm_txt):
                                f_count += 1; found = True; break
                        if found: break

                    # Fuzzy match fallback
                    found_approx = False
                    for ocr_w in all_ocr_words:
                        if len(ocr_w) < 2: continue
                        # Stricter length delta check: must be very similar in length
                        len_delta = abs(len(ocr_w) - len(check_word))
                        if len_delta > (max(len(check_word), len(ocr_w)) * 0.2 + 1): continue
                        
                        if difflib.SequenceMatcher(None, check_word, ocr_w).ratio() >= effective_threshold:
                            f_count += 1; found_approx = True; break
                    if found_approx: found = True; break
            
            p_ratio = f_count / len(n_words) if n_words else 0
            
            # Ultimate Space-Stripped Fallback for Names
            # We do this for ALL documents now if the ratio is low, not just Indigency
            if p_ratio < (0.6 if is_indigency else 0.75):
                # Filter titles out of the clean name part too
                raw_name_words = normalize_for_ocr(name_part).split()
                filtered_name_words = [w for w in raw_name_words if w not in titles_to_ignore]
                if not filtered_name_words: filtered_name_words = raw_name_words
                
                clean_name_part = "".join(filter(str.isalnum, "".join(filtered_name_words)))
                clean_text = "".join(filter(str.isalnum, str(norm_txt)))
                
                if len(clean_name_part) >= 3 and clean_name_part in clean_text:
                    print(f"[OCR-MATCH-DEBUG] SUCCESS: Ultimate fallback matched '{clean_name_part}' in text", flush=True)
                    return True, 1.0
                
                # Check for reversed name parts (e.g. "Last, First" vs "First Last")
                if not is_middle and len(filtered_name_words) >= 2:
                    reversed_name = "".join(filter(str.isalnum, "".join(reversed(filtered_name_words))))
                    if reversed_name in clean_text:
                        print(f"[OCR-MATCH-DEBUG] SUCCESS: Reversed name fallback matched '{reversed_name}'", flush=True)
                        return True, 1.0

                # Final word-by-word substring check (very lenient)
                if n_words:
                    found_words = sum(1 for w in n_words if w in norm_txt or any(w in ocr_w for ocr_w in all_ocr_words))
                    if found_words >= max(1, len(n_words) - 1):
                        print(f"[OCR-MATCH-DEBUG] SUCCESS: Lenient word match ({found_words}/{len(n_words)})", flush=True)
                        return True, 0.8
                    
            # For middle names, allow initial-based fallback
            if is_middle and n_words and p_ratio < (0.7 if is_indigency else 0.80):
                initial = n_words[0][0]
                if initial in all_ocr_words:
                    return True, 1.0
                # Misread tolerance in fallback too
                for m in (['0', '8'] if initial == 'o' else (['1', 'l', '|'] if initial == 'i' else [])):
                    if m in all_ocr_words:
                        return True, 1.0

            # Higher bar for verification success: 0.6 for Indigency (lenient for certificates), 0.80 for others
            return p_ratio >= (0.6 if is_indigency else 0.80), p_ratio

        first_ok, first_ratio = check_name_part(target_first_name, is_middle=False)
        middle_ok, middle_ratio = check_name_part(target_middle_name, is_middle=True)
        last_ok, last_ratio = check_name_part(target_last_name, is_middle=False)
        
        # All present names must pass for full verification
        # For Indigency, we allow middle name to be optional as certificates often omit it.
        if is_indigency:
            n_verified = first_ok and last_ok
        else:
            # Relaxed: Middle name is optional for verification if not found, 
            # as many IDs only show initial or omit it entirely.
            n_verified = first_ok and last_ok
            if target_middle_name and not middle_ok:
                # If middle name was provided but not found, we still pass if first/last are strong
                # but we'll flag it in meta.
                pass 
            
        # Store detailed results in meta for UI transparency
        meta['name_details'] = {
            'first_ok': first_ok,
            'middle_ok': middle_ok or not target_middle_name, # Treat as OK if not found but first/last are good
            'last_ok': last_ok,
            'first_ratio': first_ratio,
            'middle_ratio': middle_ratio,
            'last_ratio': last_ratio
        }
        # Note: ID Number Matching is handled externally by student_id_no_matches_text
        
        # 1.c Year Level Matching (If provided)
        if target_year_level and str(target_year_level).strip():
            if not year_level_matches_text(target_year_level, norm_txt):
                n_verified = False

        num_names = sum([bool(target_first_name), bool(target_middle_name), bool(target_last_name)])
        if num_names > 0:
            m_ratio = sum([first_ratio if target_first_name else 0, 
                          middle_ratio if target_middle_name else 0, 
                          last_ratio if target_last_name else 0]) / num_names
        else:
            m_ratio = 1.0

    # 2. Address Matching
    a_verified = True if not target_address else False
    if target_address and norm_txt.strip():
        norm_target_addr = normalize_for_ocr(target_address)
        if norm_target_addr and norm_target_addr in norm_txt: 
            a_verified = True
        else:
            # For indigency: check all words but ignore generic terms like 'city' or 'municipality'
            # This ensures we match the actual place name (e.g., "Lipa" instead of just "City")
            ignore_words = ['city', 'municipality', 'town', 'province', 'brgy', 'barangay']
            a_words = [w.strip() for w in norm_target_addr.split() if len(w.strip()) >= 2 and w.strip() not in ignore_words]
            
            # If everything was filtered out, fallback to original words
            if not a_words:
                a_words = [w.strip() for w in norm_target_addr.split() if len(w.strip()) >= 2]
            
            if not a_words:
                a_verified = False # Nothing to match against
            else:
                f_a_count = 0
                for word in a_words:
                    if word in norm_txt: 
                        f_a_count += 1
                        continue
                    found_approx = False
                    for ocr_w in all_ocr_words:
                        if len(ocr_w) < 2: continue
                        if abs(len(ocr_w) - len(word)) > (len(word) // 2 + 1): continue
                        if difflib.SequenceMatcher(None, word, ocr_w).ratio() >= 0.75:
                            f_a_count += 1; found_approx = True; break
                    if found_approx:
                        continue
                
                # For Indigency, require at least 1 match if input is short, or 2 if multiple words provided
                # And MOST IMPORTANTLY: f_a_count must be > 0.
                if is_indigency:
                    required_matches = min(2, len(a_words))
                    a_verified = (f_a_count >= required_matches and f_a_count > 0)
                else:
                    a_verified = (f_a_count / len(a_words) if a_words else 0) >= 0.5 and f_a_count > 0

    # 2.7 Barangay/Location Detection (Feedback Only)
    detected_brgy = []
    if is_indigency:
        # Search for words following "Barangay" or "Brgy"
        brgy_matches = re.findall(r'(?:barangay|brgy)\.?\s+([A-Z0-9][A-Za-z0-9]+(?:\s+[A-Z0-9][A-Za-z0-9]+)?)', ocr_text, re.IGNORECASE)
        detected_brgy = list(set([m.strip() for m in brgy_matches if len(m.strip()) > 2]))
        
        # If explicitly looking for a target address and we found it (a_verified), 
        # add it to detected_brgy if not already there so the UI feedback shows it was found.
        if target_address and a_verified:
            norm_target = normalize_for_ocr(target_address)
            if not any(norm_target in normalize_for_ocr(b) for b in detected_brgy):
                detected_brgy.append(target_address)

    # 2.8 School Name Matching — delegated to school_utils for consistent logic
    school_ok = True
    if target_school_name:
        from services.school_utils import school_name_matches_text as _school_match
        school_ok, _, _ = _school_match(ocr_text, target_school_name)

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
                kw_words = norm_kw.split()
                if kw_words:
                    for kw_word in kw_words:
                        if len(kw_word) < 2: continue
                        for ocr_word in all_ocr_words:
                            if len(ocr_word) < 2: continue
                            if difflib.SequenceMatcher(None, kw_word, ocr_word).ratio() >= 0.7:
                                found_keywords.append(kw)
                                break
                        if kw in found_keywords:
                            break
    
    # 2.9 Student ID Matching
    id_ok = True
    if target_id_no:
        # Check both the raw text and the normalized clean text
        id_ok, _ = student_id_no_matches_text(target_id_no, ocr_text)

    meta['detected_brgy'] = detected_brgy
    meta['id_ok'] = id_ok
    
    return n_verified and school_ok and id_ok, a_verified, found_keywords, m_ratio, meta



def verify_id_with_ocr(image_bytes, expected_first_name, expected_middle_name, expected_last_name, expected_address=None, expected_id_no=None, expected_year_level=None, expected_school_name=None):
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
    if cached_result is not None and isinstance(cached_result, (list, tuple)) and len(cached_result) == 3:
        cached_text, cached_ratio, cached_message = cached_result
        name_v, addr_v, found_kw, score, meta = _perform_text_matching(cached_text, expected_first_name, expected_middle_name, expected_last_name, expected_address, expected_id_no, expected_year_level, expected_school_name, None, is_indigency)
        if name_v and addr_v:
            print(f"[OCR CACHE HIT] Reusing previous results for {image_hash[:8]}...", flush=True)
            return True, f"Verified (cached)", cached_text, {'name_ok': True, 'addr_ok': True, 'cached': True, 'detected_brgy': meta.get('detected_brgy', [])}
    
    # --- OPTIMIZATION #3: Image quality assessment ---
    try:
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_GRAYSCALE) # Grayscale immediately
        del nparr
        
        if img is None: 
            return False, "Invalid image format", "", 0.0
        
        # Log input image stats for diagnostics
        h, w = img.shape[:2]
        print(f"[OCR-DIAG] Input image dimensions: {w}x{h}, dtype={img.dtype}, bytes={len(image_bytes)}", flush=True)
        
        is_good, quality_reason = assess_image_quality(img)
        if not is_good:
            print(f"[QUALITY REJECT] {quality_reason}", flush=True)
            return False, f"Image quality issue: {quality_reason}", "", 0.0
        
        # Simple resize to ensure minimum resolution for OCR
        # SIMPLE RELIABLE PREPROCESSING (Matches stable pre-FastAPI path)
        if w > 1400: # Standardize but don't over-resize
            scale = 1400 / w
            img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
            print(f"[OCR-DIAG] Standardized to {img.shape[1]}x{img.shape[0]}", flush=True)
    except Exception as e:
        return False, f"Preprocessing error: {str(e)}", "", {'name_ok': False, 'addr_ok': False, 'error': str(e)}

    # Define document-specific keywords to increase confidence
    doc_keywords = []
    if is_indigency:
        doc_keywords = ['Indigency', 'Indigent', 'Resident', 'Residency', 'Certification', 'Certificate', 'Barangay', 'Office', 'Barangay Hall']

    best_text = ""
    print(f"[OCR] Processing ID Verification for {expected_first_name} {expected_last_name}...", flush=True)
    
    try:
        t_start = time.time()
        
        # ═══ STABLE SCANNING PATHS (Matches pre-FastAPI baseline) ═══
        if is_indigency:
            # Parallel Dual-Zone Scanning for Certificates
            h_total = img.shape[0]
            z1 = img[:int(h_total * 0.55), :]
            z2 = img[int(h_total * 0.40):, :]
            
            with ThreadPoolExecutor(max_workers=2) as fast_executor:
                def run_with_sem(func, *args, **kwargs):
                    with OCR_SEMAPHORE:
                        return func(*args, **kwargs)
                
                f1 = fast_executor.submit(run_with_sem, _run_tesseract_on_image, z1, psm=3, skip_pass2=True, label="IndigencyZ1")
                f2 = fast_executor.submit(run_with_sem, _run_tesseract_on_image, z2, psm=3, skip_pass2=True, label="IndigencyZ2")
                t1, t2 = f1.result(), f2.result()
            best_text = f"{t1}\n{t2}"
        else:
            # OPTIMIZED: Parallel Dual-Zone + Multi-PSM for IDs
            # Most ID names are in the top/middle. Splitting helps Tesseract focus on smaller regions.
            h_total = img.shape[0]
            z1 = img[:int(h_total * 0.60), :] # Header and Name/ID area
            z2 = img[int(h_total * 0.40):, :] # Name/ID and Footer/Address area
            
            # Run Zone 1 (PSM 3) and Zone 2 (PSM 3) + Full Image (PSM 11) in parallel
            with ThreadPoolExecutor(max_workers=3) as id_executor:
                # Use Semaphore within the threads to respect concurrency limits
                def run_with_sem(func, *args, **kwargs):
                    with OCR_SEMAPHORE:
                        return func(*args, **kwargs)
                
                f1 = id_executor.submit(run_with_sem, _run_tesseract_on_image, z1, psm=3, skip_pass2=True, label="Zone1")
                f2 = id_executor.submit(run_with_sem, _run_tesseract_on_image, z2, psm=3, skip_pass2=True, label="Zone2")
                f3 = id_executor.submit(run_with_sem, _run_tesseract_on_image, img, psm=11, skip_pass2=True, label="SparseFull")
                
                t1, t2, t3 = f1.result(), f2.result(), f3.result()
            
            best_text = f"{t1}\n{t2}\n{t3}"
        
        # ═══ FALLBACK: Match and retry if parallel pass was insufficient ═══
        name_v, addr_v, found_kw, score, meta = _perform_text_matching(best_text, expected_first_name, expected_middle_name, expected_last_name, expected_address, expected_id_no, expected_year_level, expected_school_name, doc_keywords, is_indigency)
        
        if not name_v:
            # If parallel zones failed, run a High-Resolution Full Scan with full fallbacks (Pass 2, 3, 4)
            with OCR_SEMAPHORE:
                deep_text = _run_tesseract_on_image(img, psm=3, label='DeepScan')
                if deep_text.strip():
                    best_text = f"{best_text}\n{deep_text}"
            
            # Re-match after deep scan
            name_v, addr_v, found_kw, score, meta = _perform_text_matching(best_text, expected_first_name, expected_middle_name, expected_last_name, expected_address, expected_id_no, expected_year_level, expected_school_name, doc_keywords, is_indigency)
            
        if not is_indigency and not name_v:
            # Final fallback for IDs only: PSM 6 (Uniform Block)
            with OCR_SEMAPHORE:
                block_text = _run_tesseract_on_image(img, psm=6, label='Block')
                if block_text.strip():
                    best_text = f"{best_text}\n{block_text}"
        
        # Match again for final result and early exit
        name_v, addr_v, found_kw, score, meta = _perform_text_matching(best_text, expected_first_name, expected_middle_name, expected_last_name, expected_address, expected_id_no, expected_year_level, expected_school_name, doc_keywords, is_indigency)
        
        if name_v:
            print(f"[OCR PERF] SUCCESS in {time.time() - t_start:.2f}s", flush=True)
            return True, "Verified", best_text, {
                'name_ok': True, 
                'addr_ok': addr_v, 
                'id_ok': meta.get('id_ok', True),
                'school_ok': meta.get('school_ok', True),
                'name_ratio': score, 
                'keywords': found_kw
            }
    except Exception as e:
        print(f"[OCR] Scanning error: {e}", flush=True)
    finally:
        clear_heavy_memory()
    
    # ═══ DEEP DIAGNOSTIC: What did OCR actually extract? ═══
    text_len = len(best_text) if best_text else 0
    text_preview = (best_text or '').replace('\n', ' | ')[:600]
    print(f"[OCR-DEEP-DIAG] ═══════════════════════════════════════════", flush=True)
    print(f"[OCR-DEEP-DIAG] OCR text length: {text_len} chars", flush=True)
    print(f"[OCR-DEEP-DIAG] OCR text preview: {text_preview}", flush=True)
    print(f"[OCR-DEEP-DIAG] Expected First: '{expected_first_name}'", flush=True)
    print(f"[OCR-DEEP-DIAG] Expected Middle: '{expected_middle_name}'", flush=True)
    print(f"[OCR-DEEP-DIAG] Expected Last: '{expected_last_name}'", flush=True)
    print(f"[OCR-DEEP-DIAG] Expected ID: '{expected_id_no}'", flush=True)
    print(f"[OCR-DEEP-DIAG] Expected School: '{expected_school_name}'", flush=True)
    print(f"[OCR-DEEP-DIAG] Expected Address: '{expected_address}'", flush=True)
    print(f"[OCR-DEEP-DIAG] is_indigency: {is_indigency}", flush=True)
    print(f"[OCR-DEEP-DIAG] ═══════════════════════════════════════════", flush=True)

    name_v, addr_v, found_kw, best_ratio, meta = _perform_text_matching(best_text, expected_first_name, expected_middle_name, expected_last_name, expected_address, expected_id_no, expected_year_level, expected_school_name, doc_keywords, is_indigency)
    
    # Log match results
    print(f"[OCR-DEEP-DIAG] Match results: name_v={name_v}, addr_v={addr_v}, ratio={best_ratio:.2f}", flush=True)
    nd = meta.get('name_details', {})
    print(f"[OCR-DEEP-DIAG] Name breakdown: first_ok={nd.get('first_ok')}, middle_ok={nd.get('middle_ok')}, last_ok={nd.get('last_ok')}", flush=True)
    print(f"[OCR-DEEP-DIAG] Name ratios: first={nd.get('first_ratio', 0):.2f}, middle={nd.get('middle_ratio', 0):.2f}, last={nd.get('last_ratio', 0):.2f}", flush=True)
    
    details = {
        'name_ok': name_v,
        'addr_ok': addr_v,
        'name_ratio': best_ratio,
        'keywords': found_kw,
        'detected_brgy': meta.get('detected_brgy', [])
    }
    
    if name_v and addr_v:
        _cache_set(image_hash, (best_text, best_ratio, "verified_psm3"))
        return True, "Verified", best_text, details
    
    # Return result - no additional fallback passes.
    # Do not auto-verify on partial ratios alone because the OCR payload is
    # compared against the student's current inputs and false positives are worse
    # than surfacing a mismatch for retry.
    if best_ratio >= 0.3:
        prefix = "Indigency: " if is_indigency else ""
        _cache_set(image_hash, (best_text, best_ratio, "partial_match"))
        return False, f"{prefix}Identity mismatch ({best_ratio:.0%})", best_text, details

    _cache_set(image_hash, (best_text, best_ratio, "failed"))
    return False, "Identity verification mismatch", best_text, details

def student_name_matches_text(ocr_text, first_name, middle_name, last_name, is_indigency=False):
    """
    Stand-alone helper to check if a specific name is in the OCR text.
    Returns: (bool, match_ratio, name_details)
    """
    name_ok, _, _, match_ratio, meta = _perform_text_matching(ocr_text, first_name, middle_name, last_name, is_indigency=is_indigency)
    return name_ok, match_ratio, meta.get('name_details', {})


def extract_document_text(image_bytes, max_width=1600, prefer_fast_layout=False, crop_percent=None, is_id_back=False):
    """
    Fast OCR text extraction for non-identity documents like COE and grades.
    Added is_id_back flag for ultra-fast extraction (skips header bands).
    """
    if not _check_tesseract():
        return "", "OCR Engine (Tesseract) not found."
    if not image_bytes:
        return "", "No image data provided."

    cache_suffix = f"_doc_text_v3_{max_width}_{is_id_back}_{prefer_fast_layout}".encode()
    cache_key = _hash_image(image_bytes, suffix=cache_suffix)
    cached_result = _cache_get(cache_key)
    if cached_result is not None and isinstance(cached_result, (list, tuple)) and len(cached_result) == 2:
        return cached_result

    try:
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_GRAYSCALE) # Convert to Grayscale immediately (saves 66% memory)
        del nparr # Free buffer immediately
        
        if img is None:
            return "", "Invalid image format"

        is_good, quality_reason = assess_image_quality(img)
        if not is_good:
            return "", f"Image quality issue: {quality_reason}"

        h, w = img.shape[:2]
        # Partial Scanning: Skip scanning the bottom of large documents (footers/notes) if requested
        if crop_percent and 0.1 < crop_percent < 1.0:
            h_crop = int(h * crop_percent)
            img = img[:h_crop, :]
            h, w = img.shape[:2]

        # Optimization: Standardize width to 850px for non-identity documents
        # This is a sweet spot for TORs/COEs to maintain readability while being fast.
        effective_max_width = 850 if is_id_back else max_width
        if is_id_back: effective_max_width = 950 # ID backs need more detail for small stickers
        
        if w > effective_max_width:
            scale = effective_max_width / w
            img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

        if is_id_back:
            # Subtle sharpening for ID backs
            img = cv2.filter2D(img, -1, np.array([[-1,-1,-1], [-1,9,-1], [-1,-1,-1]]))
    except Exception as e:
        return "", f"Preprocessing error: {str(e)}"

    with OCR_SEMAPHORE:
        try:
            if not prefer_fast_layout and h > 500:
                # MULTI-ZONE PARALLEL SCAN: Split large documents into 2 or 4 zones
                num_zones = 4 if h > 1000 else 2
                zones = []
                for i in range(num_zones):
                    start_y = int(h * (i / num_zones))
                    end_y = int(h * ((i + 1) / num_zones))
                    # Overlap zones by 40px to prevent cutting text in half
                    if i > 0: start_y = max(0, start_y - 40)
                    zones.append(img[start_y:end_y, :])
                
                with ThreadPoolExecutor(max_workers=num_zones) as zone_executor:
                    psm_to_use = 6 if is_id_back else 3
                    
                    def run_z(z_img, z_idx):
                        with OCR_SEMAPHORE:
                            return _run_tesseract_on_image(z_img, psm=psm_to_use, skip_pass2=True, label=f"ZoneDoc{z_idx}")
                            
                    futures = [zone_executor.submit(run_z, z, i) for i, z in enumerate(zones)]
                    results = [f.result() for f in futures]
                    text = "\n".join(results)
                    
                # If zone scan was very poor, fallback to full image scan with fallbacks
                if len(text.strip()) < 30:
                    with OCR_SEMAPHORE:
                        full_text = _run_tesseract_on_image(img, psm=3, skip_pass2=False, label="FullDocFallback")
                        if full_text.strip():
                            text = f"{text}\n{full_text}"
            else:
                psm = 6 if (prefer_fast_layout or is_id_back) else 3
                text = _run_tesseract_on_image(img, psm=psm, skip_pass2=prefer_fast_layout)
            
            # ID backs often have very sparse text (stickers).
            # If PSM3 didn't get much, try PSM11 (Sparse) and PSM6 (Uniform)
            if is_id_back and (not text or len(text.strip()) < 15):
                # Pass A: Sparse Text
                text_spare = _run_tesseract_on_image(img, psm=11, skip_pass2=True)
                # Pass B: Uniform Block (sometimes helps with sticker lines)
                text_block = _run_tesseract_on_image(img, psm=6, skip_pass2=True)
                
                best_pass = text
                if len(text_spare.strip()) > len(best_pass.strip()):
                    best_pass = text_spare
                if len(text_block.strip()) > len(best_pass.strip()):
                    best_pass = text_block
                text = best_pass
            
            _cache_set(cache_key, (text, None))
            return text, None
        except Exception as e:
            return "", f"OCR error: {str(e)}"
        finally:
            clear_heavy_memory()

    result = (text, None)
    _cache_set(cache_key, result)
    return result


def _preprocess_frame_for_ocr(frame):
    """Enhance a video frame for better OCR accuracy (handles compression artifacts)."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    enhanced = _CLAHE.apply(gray)
    # Removing blur to keep edges sharp for better OCR on small document text
    return cv2.normalize(enhanced, None, 0, 255, cv2.NORM_MINMAX)


def _ocr_video_frame(processed_frame, allow_alt_pass=True, keywords=None, is_address_verification=False):
    """Run OCR for a single video frame while holding the shared OCR gate only for Tesseract work."""
    with OCR_SEMAPHORE:
        # For address verification (Indigency), we need continuous lines. PSM 6 (Uniform Block) is fastest and most reliable.
        # For general keywords, PSM 11 (Sparse Text) is fast.
        psm = 6 if is_address_verification else (11 if keywords else 3)
        text = _run_ocr_command(pytesseract.image_to_string, processed_frame, config=f'--psm {psm} --oem 1')

        # Smart Exit: If keywords provided and found, and we don't strictly need a full address paragraph, exit early.
        if keywords and not is_address_verification and any(k.lower() in text.lower() for k in keywords):
            return text

        # Only run fallback pass if Pass 1 was relatively poor (< 12 chars)
        if allow_alt_pass and len(text.strip()) < 12:
            text_alt = _run_ocr_command(pytesseract.image_to_string, processed_frame, config='--psm 6 --oem 1')
            if len(text_alt.strip()) > len(text.strip()):
                text = text_alt

    return text


def verify_video_content(video_data, keywords, expected_address=None, sample_positions=None, max_width=None, allow_alt_pass=True, fallback_text_length=0):
    """
    Captures frames from video data (bytes OR URL) and scans for keywords and address using OCR.
    Optimized to stream directly from URLs to avoid massive downloads.
    Optimized to sample 2 key frames for balanced speed/accuracy.
    
    For videos without address requirements (like COE, Grades), keyword matching is more lenient
    and accepts partial/fuzzy matches to handle OCR errors.
    """
    # Speed Optimization: Stream from URL directly if possible
    is_url = isinstance(video_data, str) and video_data.startswith('http')
    
    # --- SPEED OPTIMIZATION: Check Video Cache ---
    hash_suffix = f"_video_{sample_positions}_{max_width}_{allow_alt_pass}_{fallback_text_length}".encode()
    if is_url:
        vid_hash = hashlib.md5(video_data.encode() + hash_suffix).hexdigest()
    else:
        vid_hash = _hash_image(video_data, suffix=hash_suffix)
        
    cached_res = _cache_get(vid_hash)
    if cached_res is not None and isinstance(cached_res, (list, tuple)) and len(cached_res) == 2:
        print(f"[VIDEO CACHE] Reusing extremely fast cached result for {vid_hash[:8]}...", flush=True)
        return cached_res

    # Determine if this is an address-based verification (indigency only)
    is_address_verification = expected_address is not None
    
    tmp_path = None
    if is_url:
        import requests
        print(f"[VIDEO DL] Fetching video locally for much faster cv2 seeking...", flush=True)
        try:
            r = requests.get(video_data, timeout=20)
            if r.status_code == 200:
                with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as tmp:
                    tmp.write(r.content)
                    tmp_path = tmp.name
            elif isinstance(video_data, str) and video_data.startswith('data:'):
                import base64
                header, encoded = video_data.split(',', 1)
                with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as tmp:
                    tmp.write(base64.b64decode(encoded))
                    tmp_path = tmp.name
            else:
                tmp_path = video_data # Fallback
        except Exception as e:
            print(f"[VIDEO DL] Failed to download {e}, falling back to stream.", flush=True)
            tmp_path = video_data
    else:
        # Save to temp file because VideoCapture needs a path
        with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as tmp:
            tmp.write(video_data)
            tmp_path = tmp.name
        
    try:
        cap = cv2.VideoCapture(tmp_path)
        if not cap.isOpened():
            return False, "Could not open video source"
        
        # Ensure frame count is perfectly accessible
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if frame_count <= 0:
            _cache_set(vid_hash, (False, "Invalid video frame count"))
            return False, "Invalid video frame count"
        
        # --- SPEED OPTIMIZATION: Sample 2 frames (Start/End) instead of 5 ---
        # This reduces Video OCR time by ~60%
        sample_positions = sample_positions or [0.3, 0.75]
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

        # Use even lower resolution for video frames (400px) for non-indigency fast scanning
        frames_to_ocr = []
        for sample_idx in sample_indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, sample_idx)
            ret, frame = cap.read()
            if ret and frame is not None:
                # Preprocess and resize immediately to keep memory usage low
                processed_frame = _preprocess_frame_for_ocr(frame)
                h, w = processed_frame.shape[:2]
                default_width = 400 if not is_address_verification else 520
                width_limit = max_width or default_width
                if w > width_limit:
                    scale = width_limit / w
                    processed_frame = cv2.resize(processed_frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
                frames_to_ocr.append(processed_frame)
        
        cap.release()
        cap = None # Explicitly release to free memory

        if not frames_to_ocr:
            return False, "Could not capture readable frames from video"

        # Now run OCR on captured frames in parallel
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=min(len(frames_to_ocr), 3)) as executor:
            # pass is_address_verification so it forces PSM 6 for better continuous text line reading
            ocr_results = list(executor.map(lambda f: _ocr_video_frame(f, allow_alt_pass=allow_alt_pass, keywords=keywords, is_address_verification=is_address_verification), frames_to_ocr))

        all_ocr_text = " ".join(ocr_results)
        found_keywords = []
        addr_ok = False
        
        # Check against keywords
        _, addr_ok, found_keywords, _, _ = _perform_text_matching(
            all_ocr_text, None, None, None, None, 
            keywords=keywords, is_indigency=is_address_verification
        )
        
        is_success = bool(found_keywords) # For COE/Grades, any keyword found is success
        if expected_address and not addr_ok:
            is_success = False
                
        if expected_address and not addr_ok:
            fail_msg = f"Address mismatch: Region '{expected_address}' not clearly visible in video."
            _cache_set(vid_hash, (False, fail_msg))
            return False, fail_msg

        normalized_text = re.sub(r'\s+', ' ', all_ocr_text).strip()

        if not is_success and not is_address_verification and len(normalized_text) >= (fallback_text_length or 20):
            msg = f"Validated: recognizable document text detected ({len(normalized_text)} chars)"
            _cache_set(vid_hash, (True, msg))
            return True, msg

        if not is_success:
            fail_msg = "Required document content not detected in video."
            _cache_set(vid_hash, (False, fail_msg))
            return False, fail_msg
        
        msg = f"Validated: Found {', '.join(found_keywords)}"
        if expected_address:
            msg += f" and address matched."
        _cache_set(vid_hash, (True, msg))
        return True, msg
    except Exception as e:
        print(f"[VIDEO OCR ERROR] {e}")
        return False, f"Processing error: {str(e)}"
    finally:
        if 'cap' in locals() and cap is not None:
            try:
                cap.release()
            except:
                pass
        if 'tmp_path' in locals() and tmp_path and not is_url and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except:
                pass
        clear_heavy_memory()

def extract_school_year_from_text(text):
    if not text: return None
    
    # 1. Advanced Character Hygiene
    hygiene_map = {
        'O': '0', 'o': '0', 'Q': '0', 'D': '0', 'U': '0',
        'I': '1', 'l': '1', '|': '1', 'i': '1', '!': '1', '(': '1', ')': '1', 'L': '1',
        'Z': '2', 'z': '2', 'A': '2',
        'S': '5', 's': '5', '$': '5',
        'B': '8', 'E': '8',
        'G': '6', 'b': '6',
        'g': '9', 'q': '9', 'P': '9'
    }
    
    def apply_hygiene(s):
        res = ""
        for c in s:
            res += hygiene_map.get(c, c)
        return res

    # Normalize delimiters: replace weird hyphens/dots/underscores between digits with a standard dash
    # e.g. "2024.2025", "2024/2025" or "2024_2025" -> "2024-2025"
    text = re.sub(r'(20\d{2})[\s\.\,_\~\/\-\|\[\]\(\)\:\;]+(20\d{2})', r'\1-\2', text)
    
    # Fix corruptions in chunks that look like years (4 chars starting with something like 2)
    def fix_year_chunk(m):
        chunk = m.group(0)
        fixed = apply_hygiene(chunk)
        # Verify it's now a plausible year (2020-2035)
        if re.match(r'20[23][0-9]', fixed):
            return fixed
        return chunk

    # Pass 1: Fix standalone 4-char year-like strings
    clean_text = re.sub(r'[2ZSI][0OQoDU][2ZSI][0-9SszBGeGQ\d]', fix_year_chunk, text)
    
    # 2. Label Normalization
    clean_text = re.sub(r'\bS\.?Y\.?\s*[:\-\/]?\s*', 'school year ', clean_text, flags=re.IGNORECASE)
    clean_text = re.sub(r'\bA\.?Y\.?\s*[:\-\/]?\s*', 'academic year ', clean_text, flags=re.IGNORECASE)
    clean_text = re.sub(r'\bVALID\s+UNTIL\s*[:\-\/]?\s*', 'valid until ', clean_text, flags=re.IGNORECASE)
    
    # Flatten whitespace for uniform matching
    compact_text = re.sub(r'\s+', ' ', clean_text).strip()

    # 3. Targeted Pattern Matching (Priority Ordered)
    
    # Priority A: Year Range (e.g., 2025-2026)
    # Stricter matching: Usually preceded by labels or in a specific block
    # Look for patterns with optional SY/Year/School labels nearby (within 30 chars)
    year_patterns = [
        r'(?:sy|s\.y\.|year|school\s+year|academic\s+year|school\s+year\s+sem)\s*[:=]?\s*(20\d{2})[-/\s]+(20\d{2})', # Labelled Range
        r'(?:sy|s\.y\.|year|school\s+year|academic\s+year|school\s+year\s+sem)\s*[:=]?\s*(20\d{2})\b', # Labelled Single
        r'\b(20\d{2})[-/\s]+(20\d{2})\b' # Raw fallback Range
    ]
    
    for pattern in year_patterns:
        match = re.search(pattern, compact_text, re.IGNORECASE)
        if match:
            res = f"{match.group(1)}-{match.group(2)}" if len(match.groups()) > 1 else match.group(1)
            print(f"[OCR-YEAR-DIAG] Found year via pattern '{pattern}': {res}", flush=True)
            return res

    # Priority B: Keyword Proximity
    # Handles "Valid Until: 2025", "SY 2026", "School Year Sem 2025-2026"
    # We grab all digits and common year separators following the keyword
    keyword_pat = r'(?:school\s*year|academic\s*year|valid\s*until|v\.?u\.?|exp\.?\s*date|sem\b|sy\b|ay\b)'
    keyword_match = re.search(f'{keyword_pat}.{{0,40}}?([0-9\\s\\-\\/\\.\\,\\~\\|]{{4,25}})', compact_text, re.IGNORECASE)
    if keyword_match:
        captured = keyword_match.group(1).strip()
        # Clean the captured part to only keep digits and separators
        cleaned_captured = re.sub(r'[^0-9\-\/]', '', captured)
        if len(cleaned_captured) >= 4:
            # If it's a range like 2024-2025, format it
            rng = re.search(r'(20\d{2})[\s\-\/]+(20\d{2})', captured)
            if rng:
                return f"{rng.group(1)}-{rng.group(2)}"
            # If it's just a single year
            yr = re.search(r'20[2-3][0-9]', captured)
            if yr:
                return yr.group(0)

    # Priority C: Short Range (e.g., 2024-25)
    short_range = re.search(r'(20[2-3][0-9])[\s\-\/\\–—]+([2-3][0-9])\b', compact_text)
    if short_range:
        return f"{short_range.group(1)}-20{short_range.group(2)}"

    # Priority D: Any plausible years in range
    all_years = re.findall(r'20[2-3][0-9]', compact_text)
    if all_years:
        # Filter duplicates and return as a space-separated string for the matching logic
        unique_years = []
        for y in all_years:
            if y not in unique_years: unique_years.append(y)
        
        # If we have exactly two, it might be a range
        if len(unique_years) == 2:
            return f"{unique_years[0]}-{unique_years[1]}"
        
        return " ".join(unique_years)

    return None

def extract_school_year(image_bytes):
    text = _run_tesseract(image_bytes, fast_mode=True)
    return extract_school_year_from_text(text)

def extract_semester_from_text(text):
    if not text: return None
    semester_patterns = [
        r'(1st|2nd|first|second|1|2|I|II|and|lst|ist|4)\s*(?:sem|semester|grading|sern|sen|sun)\b',
        r'\b(?:sem|semester|grading|sern|sen|sun)\s*[:\-]?\s*(1st|2nd|first|second|1|2|I|II|and|lst|ist|4)\b',
        r'\b(First|Second|and)\s+Semester\b',
        r'\b(1|2|and|lst|ist|4)\s*-\s*(?:Sem|Sern|Sen)\b',
        r'(?:sem|semester|grading|sern|sen|sun|school\s+year\s+sem|school\s+year|AY).{0,35}?\b(1|2|I|II|1st|2nd|4)\b'
    ]
    for pattern in semester_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            # We always want the first captured group in these patterns
            val = match.group(1) if match.groups() else match.group(0)
            return normalize_semester_label(val)
    return None

def normalize_semester_label(value):
    if value is None:
        return None

    semester_value = str(value).strip().lower()
    if not semester_value:
        return None

    # Handle numeric strings "1" or "2" directly
    if semester_value == "1": return "1st"
    if semester_value == "2": return "2nd"

    # Aggressive keyword check
    if any(x in semester_value for x in ['1st', 'first', 'lst', 'ist', '1']):
        return "1st"
    if any(x in semester_value for x in ['2nd', 'second', 'and', '2']):
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

def _create_uniface_model(model_cls, providers, session_options):
    """Instantiate UniFace models across package versions with different kwargs."""
    try:
        return model_cls(providers=providers, session_options=session_options)
    except TypeError as exc:
        if 'session_options' not in str(exc):
            raise
        return model_cls(providers=providers)

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
            import onnxruntime as ort

            # Limit thread count to avoid OOM and server freeze on Render
            sess_options = ort.SessionOptions()
            sess_options.intra_op_num_threads = 1
            sess_options.inter_op_num_threads = 1
            sess_options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
            
            # Explicitly define CPU provider for ONNX Runtime to avoid NameError
            providers = ['CPUExecutionProvider']

            _FACE_DETECTOR = _create_uniface_model(RetinaFace, providers, sess_options)
            _FACE_RECOGNIZER = _create_uniface_model(ArcFace, providers, sess_options)
            print("[FACE] UniFace RetinaFace and ArcFace initialized on CPU (Single-Threaded).", flush=True)
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

def _pick_primary_face(faces, image_label, min_area_pct=0.0):
    """
    Select the highest-confidence face above threshold.
    Optional: Ensure it covers a minimum percentage of image area (for selfies).
    """
    if not faces:
        raise ValueError(f"No face detected in {image_label}. Please look directly at the camera.")

    # Select faces above detection confidence
    valid_faces = [face for face in faces if getattr(face, 'confidence', 0.0) >= _FACE_DETECTION_THRESHOLD]
    
    if not valid_faces:
        raise ValueError(f"No reliable face detected in {image_label}. Ensure your face is clearly visible.")

    # Pick the best one
    best_face = max(valid_faces, key=lambda face: getattr(face, 'confidence', 0.0))
    
    # Enforce minimum area for 'live photo' (selfies)
    if min_area_pct > 0 and hasattr(best_face, 'bbox'):
        # bbox is typically [x1, y1, x2, y2]
        x1, y1, x2, y2 = best_face.bbox
        area = (x2 - x1) * (y2 - y1)
        # Using 512x512 as max internal canvas area
        total_area = 512 * 512 
        pct = (area / total_area) * 100
        
        if pct < min_area_pct:
            raise ValueError(f"Face is too far or too small in {image_label}. Please move closer to the camera.")

    return best_face

def verify_face_with_id(user_photo_bytes, id_photo_bytes):
    """
    Verify a live/selfie photo against the face in the uploaded ID image.
    Enforces that the live photo has a prominent face.
    """
    try:
        detector, recognizer = _init_face_models()

        user_image = _decode_face_image(user_photo_bytes)
        id_image = _decode_face_image(id_photo_bytes)

        # For selfies, we want the face to occupy at least 6% of the processing frame (lowered from 8%)
        user_faces = detector.detect(user_image)
        user_face = _pick_primary_face(user_faces, 'the live photo', min_area_pct=3.0)
        
        # For ID cards, the face can be quite small (no min_area)
        id_faces = detector.detect(id_image)
        id_face = _pick_primary_face(id_faces, 'the ID image')

        user_embedding = recognizer.get_normalized_embedding(user_image, user_face.landmarks)
        id_embedding = recognizer.get_normalized_embedding(id_image, id_face.landmarks)

        # Visibility Check: Ensure key landmarks are not occluded (e.g. mouth covered)
        # Landmarks: [left_eye, right_eye, nose, left_mouth, right_mouth]
        if hasattr(user_face, 'landmarks') and len(user_face.landmarks) >= 5:
            lm = user_face.landmarks
            # Calculate distance between mouth corners
            mouth_width = np.linalg.norm(lm[3] - lm[4])
            # Calculate distance from nose to mouth center
            mouth_center = (lm[3] + lm[4]) / 2
            nose_to_mouth = np.linalg.norm(lm[2] - mouth_center)
            
            # Heuristic: If mouth width is suspiciously small or too close to nose, it's likely occluded
            eye_dist = np.linalg.norm(lm[0] - lm[1])
            if mouth_width < (eye_dist * 0.35) or nose_to_mouth < (eye_dist * 0.15):
                return False, "Your mouth or lower face seems covered. Please ensure your entire face is visible.", 0.0

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

        if similarity >= 0.25:
            return False, f"Face match uncertain (similarity: {similarity:.3f}). Please try a clearer selfie.", similarity

        return False, f"Face does not match the ID (similarity: {similarity:.3f}).", similarity
    except ValueError as exc:
        return False, str(exc), 0.0
    except Exception as exc:
        print(f"[FACE] Verification error: {exc}", flush=True)
        return False, f"Face verification error: {str(exc)}", 0.0


def _prepare_signature_preview(signature_img):
    if signature_img is None:
        return None

    gray = cv2.cvtColor(signature_img, cv2.COLOR_BGR2GRAY) if len(signature_img.shape) == 3 else signature_img
    binary = _build_signature_mask(gray)
    if binary is None:
        return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
    binary = _match_mask_to_image(binary, gray.shape)

    coords = cv2.findNonZero(binary)
    if coords is None:
        return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)

    x, y, w, h = cv2.boundingRect(coords)
    pad = max(4, int(min(w, h) * 0.15))
    x0 = max(0, x - pad)
    y0 = max(0, y - pad)
    x1 = min(gray.shape[1], x + w + pad)
    y1 = min(gray.shape[0], y + h + pad)
    cropped = gray[y0:y1, x0:x1]
    cropped_mask = binary[y0:y1, x0:x1]
    if cropped.size == 0 or cropped_mask.size == 0:
        return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)

    preview_mask = _refine_signature_mask(cropped_mask)
    preview_mask = _match_mask_to_image(preview_mask, cropped.shape)
    mask_coords = cv2.findNonZero(preview_mask)
    if mask_coords is not None:
        mx, my, mw, mh = cv2.boundingRect(mask_coords)
        inner_pad = max(2, int(min(mw, mh) * 0.08))
        mx0 = max(0, mx - inner_pad)
        my0 = max(0, my - inner_pad)
        mx1 = min(cropped.shape[1], mx + mw + inner_pad)
        my1 = min(cropped.shape[0], my + mh + inner_pad)
        cropped = cropped[my0:my1, mx0:mx1]
        preview_mask = preview_mask[my0:my1, mx0:mx1]

    softened_mask = cv2.GaussianBlur(preview_mask, (3, 3), 0)
    preview_gray = np.full(cropped.shape, 255, dtype=np.uint8)
    preview_gray[preview_mask > 0] = cropped[preview_mask > 0]
    preview_gray = cv2.normalize(preview_gray, None, 0, 255, cv2.NORM_MINMAX)
    preview_gray = cv2.min(preview_gray, 245)
    preview_gray[softened_mask <= 8] = 255
    preview = cv2.cvtColor(preview_gray, cv2.COLOR_GRAY2BGR)

    target_width = 480
    scale = target_width / float(max(preview.shape[1], 1))
    if scale > 1.0:
        preview = cv2.resize(preview, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)

    return preview


def _prepare_signature_blob_preview(signature_img):
    if signature_img is None:
        return None

    gray = cv2.cvtColor(signature_img, cv2.COLOR_BGR2GRAY) if len(signature_img.shape) == 3 else signature_img
    binary = _build_signature_mask(gray)
    if binary is None:
        return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
    binary = _match_mask_to_image(binary, gray.shape)

    coords = cv2.findNonZero(binary)
    if coords is None:
        return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)

    x, y, w, h = cv2.boundingRect(coords)
    pad = max(4, int(min(w, h) * 0.10))
    x0 = max(0, x - pad)
    y0 = max(0, y - pad)
    x1 = min(gray.shape[1], x + w + pad)
    y1 = min(gray.shape[0], y + h + pad)
    blob_mask = binary[y0:y1, x0:x1]
    if blob_mask.size == 0:
        return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)

    preview = np.full((blob_mask.shape[0], blob_mask.shape[1], 3), 255, dtype=np.uint8)
    preview[blob_mask > 0] = (0, 0, 0)

    target_width = 480
    scale = target_width / float(max(preview.shape[1], 1))
    if scale > 1.0:
        preview = cv2.resize(preview, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)

    return preview


def _decode_cv_image(image_bytes, white_background=False):
    data = decode_base64(image_bytes)
    img_array = np.frombuffer(data, np.uint8)
    img = cv2.imdecode(img_array, cv2.IMREAD_UNCHANGED)
    if img is None:
        return None

    if len(img.shape) == 2:
        return cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)

    if len(img.shape) == 3 and img.shape[2] == 4:
        if white_background:
            alpha = img[:, :, 3].astype(np.float32) / 255.0
            rgb = img[:, :, :3].astype(np.float32)
            white = np.full_like(rgb, 255.0)
            blended = (rgb * alpha[..., None]) + (white * (1.0 - alpha[..., None]))
            return blended.astype(np.uint8)
        return cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)

    return img


def _build_signature_mask(gray_image):
    if gray_image is None or gray_image.size == 0:
        return None

    normalized = cv2.normalize(gray_image, None, 0, 255, cv2.NORM_MINMAX)
    upscaled = cv2.resize(normalized, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
    denoised = cv2.bilateralFilter(upscaled, 7, 50, 50)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    enhanced = clahe.apply(denoised)

    # Adaptive threshold - larger block size to avoid hollow strokes in thick signatures
    adaptive = cv2.adaptiveThreshold(
        enhanced,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        31,
        7,
    )

    return _refine_signature_mask(adaptive)


def _match_mask_to_image(mask, image_shape):
    if mask is None:
        return None

    image_height, image_width = image_shape[:2]
    if mask.shape[:2] == (image_height, image_width):
        return mask

    return cv2.resize(mask, (image_width, image_height), interpolation=cv2.INTER_NEAREST)


def _refine_signature_mask(binary_mask):
    if binary_mask is None or binary_mask.size == 0:
        return binary_mask

    # Light close to connect nearby strokes slightly
    refined = cv2.morphologyEx(
        binary_mask,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)),
        iterations=1,
    )
    
    # Remove granular noise
    refined = cv2.medianBlur(refined, 3)

    contours, _ = cv2.findContours(refined, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    # Filter by area to remove final small specks
    min_area = max(15, int(refined.shape[0] * refined.shape[1] * 0.00018))
    cleaned = np.zeros_like(refined)
    for contour in contours:
        area = cv2.contourArea(contour)
        if area >= min_area:
            # Skip likely underlines
            x, y, w, h = cv2.boundingRect(contour)
            if w > refined.shape[1] * 0.7 and h < 8:
                 continue
            cv2.drawContours(cleaned, [contour], -1, 255, thickness=cv2.FILLED)

    return cleaned


def _isolate_signature_ink_region(signature_crop):
    if signature_crop is None or signature_crop.size == 0:
        return signature_crop

    gray = cv2.cvtColor(signature_crop, cv2.COLOR_BGR2GRAY) if len(signature_crop.shape) == 3 else signature_crop
    height, width = gray.shape[:2]
    if height == 0 or width == 0:
        return signature_crop

    binary = _build_signature_mask(gray)
    if binary is None:
        return signature_crop
    binary = _match_mask_to_image(binary, gray.shape)

    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidate_boxes = []

    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        area = w * h
        if area < 20:
            continue

        if area > (width * height * 0.25): # More lenient with large signatures
            continue

        # Ignore anything touching the borders (likely the crop frame or outer boxes)
        if x <= 2 or y <= 2 or (x + w) >= (width - 2) or (y + h) >= (height - 2):
            continue

        # Ignore large hollow boxes - typically ID photo borders
        # Most signatures aren't perfect rectangles
        extent = area / float(w * h) if w * h > 0 else 0
        if extent > 0.8 and area > (width * height * 0.08): 
            # This is likely a solid border or a printed box
            continue

        center_y = y + (h / 2.0)
        aspect_ratio = w / float(max(h, 1))

        # Ignore the top logo/star and bottom printed "Signature" label.
        # The handwritten mark sits in a fairly narrow middle band.
        if center_y < height * 0.18 or center_y > height * 0.58:
            continue

        # Reject long thin printed lines and underline strokes.
        # Handwritten signatures are rarely perfectly horizontal and very long ( > 70% width)
        if w > width * 0.65 and h < max(12, int(height * 0.12)) and aspect_ratio > 8.0:
            print(f"[SIGNATURE] Rejecting potential underline: {w}x{h}, aspect {aspect_ratio:.1f}", flush=True)
            continue

        # Reject extremely small noise (already handled by area but as a safety)
        if h < 5:
            continue

        candidate_boxes.append((x, y, w, h))

    if not candidate_boxes:
        return signature_crop

    # CLUSTER SELECTION: Find the most significant cluster (presumably the signature)
    # Sort boxes by area (descending)
    candidate_boxes.sort(key=lambda b: b[2] * b[3], reverse=True)
    
    # Start with the largest component that is likely a signature part (not a border)
    # Borders are usually very wide and thin, or very tall and thin.
    primary_box = None
    for box in candidate_boxes:
        x_p, y_p, w_p, h_p = box
        ar = w_p / float(h_p)
        # Signature typical aspect ratios 1.5 to 7.0
        if 1.0 < ar < 10.0:
            primary_box = box
            break
            
    if not primary_box:
        primary_box = candidate_boxes[0]

    # Only keep boxes that are within a reasonable distance of the primary box
    selected_boxes = [primary_box]
    px, py, pw, ph = primary_box
    pcx, pcy = px + pw/2, py + ph/2
    
    max_dist = max(width * 0.35, height * 0.35)
    
    for box in candidate_boxes:
        if box == primary_box: continue
        bx, by, bw, bh = box
        bcx, bcy = bx + bw/2, by + bh/2
        
        # Manhattan distance to center
        dist = abs(bcx - pcx) + abs(bcy - pcy)
        if dist < max_dist:
            selected_boxes.append(box)

    x0 = min(box[0] for box in selected_boxes)
    y0 = min(box[1] for box in selected_boxes)
    x1 = max(box[0] + box[2] for box in selected_boxes)
    y1 = max(box[1] + box[3] for box in selected_boxes)

    pad_x = max(6, int((x1 - x0) * 0.12))
    pad_y = max(6, int((y1 - y0) * 0.25))
    x0 = max(0, x0 - pad_x)
    y0 = max(0, y0 - pad_y)
    x1 = min(width, x1 + pad_x)
    y1 = min(height, y1 + pad_y)

    cropped_gray = gray[y0:y1, x0:x1]
    # Isolate only ink pixels on a clean white background
    isolated = np.full((cropped_gray.shape[0], cropped_gray.shape[1], 3), 255, dtype=np.uint8)
    isolated_mask = _build_signature_mask(cropped_gray)
    if isolated_mask is None:
        return signature_crop
    
    # Final noise pass on the isolated mask
    isolated_mask = cv2.medianBlur(isolated_mask, 3)
    
    isolated_mask = _match_mask_to_image(isolated_mask, cropped_gray.shape)
    isolated[isolated_mask > 0] = (0, 0, 0)
    
    # Resize up with cubic interpolation to keep it smooth but not blurry
    isolated = cv2.resize(isolated, None, fx=1.5, fy=1.5, interpolation=cv2.INTER_CUBIC)
    return isolated


def _extract_signature_from_id_back(id_img):
    if id_img is None:
        return None

    gray = cv2.cvtColor(id_img, cv2.COLOR_BGR2GRAY) if len(id_img.shape) == 3 else id_img
    height, width = gray.shape[:2]
    if height == 0 or width == 0:
        return None

    # Step 1: Broadened signature zone to capture wide/slanted signatures
    lane_y0, lane_y1 = int(height * 0.18), int(height * 0.48)
    lane_x0, lane_x1 = int(width * 0.05), int(width * 0.95)
    roi_gray = gray[lane_y0:lane_y1, lane_x0:lane_x1].copy()
    
    # NEW: OCR-Assisted Label Erasure
    try:
        import pytesseract
        import re
        ocr_data = pytesseract.image_to_data(roi_gray, output_type=pytesseract.Output.DICT, config='--psm 11')
        for i in range(len(ocr_data['text'])):
            text = ocr_data['text'][i].strip().lower()
            clean_text = re.sub(r'[^a-z]', '', text)
            # Erase common ID labels and footers
            if clean_text in ['signature', 'sign', 'sig', 'signatureof', 'student', 'transferable', 'valid', 'until', 'this']:
                tx, ty, tw, th = ocr_data['left'][i], ocr_data['top'][i], ocr_data['width'][i], ocr_data['height'][i]
                cv2.rectangle(roi_gray, (tx-10, ty-10), (tx+tw+10, ty+th+10), (255), -1)
                print(f"[SIGNATURE] OCR Filter: Erased label '{text}' at ROI coords ({tx},{ty})", flush=True)
    except Exception as e:
        print(f"[SIGNATURE] OCR pre-filter error (non-critical): {e}", flush=True)

    print(f"[SIGNATURE] Extracted ROI from ID Back: shape={roi_gray.shape}, zone=y({lane_y0}:{lane_y1}), x({lane_x0}:{lane_x1})", flush=True)
    
    # Step 2: High-contrast smoothing
    norm = cv2.normalize(roi_gray, None, 0, 255, cv2.NORM_MINMAX)
    smooth = cv2.bilateralFilter(norm, 9, 75, 75)
    
    # Adaptive threshold - larger block size to avoid hollow strokes in thick signatures
    binary = cv2.adaptiveThreshold(
        smooth, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, 31, 7
    )
    
    # Step 3: Component isolation
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates = []
    h_idx, w_idx = binary.shape[:2]
    
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        
        # SIDE-MARGIN PURGE: Frames/edges
        if x < 8 or (x+w) > w_idx-8: continue
        if y < 4 or (y+h) > h_idx-4: continue
        
        area = cv2.contourArea(cnt)
        if area < 50: continue # Slightly more aggressive noise filter
        
        # SOLIDITY & SHAPE REJECTION: Lines, stars, and printed text blocks
        solidity = area / float(w * h) if w * h > 0 else 0
        aspect = w / float(h) if h > 0 else 0
        extent = area / float(w_idx * h_idx)
        
        # Printed lines/underlines - signatures are rarely extremely long and flat
        if aspect > 3.0 and h < 20: 
            print(f"[SIGNATURE] Rejecting potential underline: aspect={aspect:.1f}, h={h}", flush=True)
            continue
        
        # RECTANGULARITY FILTER: Catch photo boxes and "Valid Until" boxes
        # Printed boxes have 4 corners and high solidity. 
        # Relaxed solidity to 0.5 to catch noisy/hollow boxes.
        peri = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
        if 4 <= len(approx) <= 6 and solidity > 0.5:
             print(f"[SIGNATURE] Rejecting geometric box: corners={len(approx)}, solidity={solidity:.2f}", flush=True)
             continue
             
        # Stars and solid logos
        if 0.6 < aspect < 1.6 and solidity > 0.40:
            continue
            
        # Photo boxes / larger borders / solid rectangular text blocks
        if (extent > 0.10 or w > w_idx * 0.35) and solidity > 0.45: continue
            
        complexity = cv2.arcLength(cnt, True)
        # Handwriting score: favors complexity relative to area
        hw_score = complexity / (np.sqrt(area) + 1)
        
        candidates.append({
            'box': (x, y, w, h), 
            'complex': complexity, 
            'hw_score': hw_score,
            'y_mid': y + h/2, 
            'area': area
        })

    if not candidates:
        ch, cw = int(h_idx * 0.6), int(w_idx * 0.7)
        qy0, qx0 = int((h_idx - ch)/2), int((w_idx - cw)/2)
        fallback = roi_gray[qy0:qy0+ch, qx0:qx0+cw]
        result = cv2.cvtColor(fallback, cv2.COLOR_GRAY2BGR)
        return cv2.resize(result, (400, int(400 * ch/cw)), interpolation=cv2.INTER_LINEAR)
        
    # Step 4: ANCHOR ON THE SIGNATURE
    # We prefer components with high hw_score in the target lane
    candidates.sort(key=lambda c: c['hw_score'], reverse=True)
    
    # Vertically tighten: We expect the signature to be near the top/center of our ROI
    signature_lane = [c for c in candidates if h_idx * 0.10 < c['y_mid'] < h_idx * 0.60]
    anchor = signature_lane[0] if signature_lane else candidates[0]
    
    # VERTICAL PURGE: Only grab pieces that are physically close to the signature cluster.
    # Handwriting flows horizontally; printed lines/boxes sit in a separate 'lane' below.
    final_parts = []
    for c in candidates:
        # Distance check: Components must be within 25% of the ROI height from the anchor center
        # This prevents 'jumping' to a line or box sitting significantly below the signature.
        if abs(c['y_mid'] - anchor['y_mid']) < h_idx * 0.25:
            final_parts.append(c['box'])
            
    if not final_parts:
        final_parts = [anchor['box']]
            
    x0 = min(b[0] for b in final_parts)
    y0 = min(b[1] for b in final_parts)
    x1 = max(b[0] + b[2] for b in final_parts)
    y1 = max(b[1] + b[3] for b in final_parts)
    
    pad = 8
    crop_bin = binary[max(0, y0-pad):min(h_idx, y1+pad), 
                      max(0, x0-pad):min(w_idx, x1+pad)]
    
    result = np.full((crop_bin.shape[0], crop_bin.shape[1], 3), 255, dtype=np.uint8)
    result[crop_bin > 0] = (0, 0, 0)
    
    target_w = 400
    target_h = int(target_w * (result.shape[0] / float(result.shape[1])))
    return cv2.resize(result, (target_w, target_h), interpolation=cv2.INTER_CUBIC)

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
        from .signature_brain import calculate_neural_match, compare_signature_images, prepare_signature_match_view
        
        if not signature_bytes or not id_back_bytes:
            return False, "Missing signature or ID image", 0.0, None, None
        
        # Safely decode signature
        try:
            sig_img = _decode_cv_image(signature_bytes, white_background=True)
        except Exception as e:
            print(f"[SIGNATURE] Error decoding signature: {e}", flush=True)
            return False, "Invalid signature format", 0.0, None, None
        
        # Safely decode ID back image
        try:
            id_img = _decode_cv_image(id_back_bytes)
        except Exception as e:
            print(f"[SIGNATURE] Error decoding ID image: {e}", flush=True)
            return False, "Invalid ID image format", 0.0, None, None
        
        if sig_img is None or id_img is None:
            return False, "Could not decode images", 0.0, None, None

        preview_signature = _prepare_signature_preview(sig_img)
        extracted_id_signature = _extract_signature_from_id_back(id_img)
        matcher_submitted_view = prepare_signature_match_view(sig_img)

        if extracted_id_signature is None or extracted_id_signature.size == 0:
            print("[SIGNATURE] Failed to isolate signature from ID Back.", flush=True)
            return False, "Could not isolate a signature from the ID back image", 0.0, preview_signature, None, matcher_submitted_view, None

        print(f"[SIGNATURE] ID signature isolated: shape={extracted_id_signature.shape}", flush=True)
        extracted_id_preview = extracted_id_signature  # Already display-ready via single-pass extraction
        matcher_reference_view = prepare_signature_match_view(extracted_id_signature)
        
        # Neural matching restored: System now benefits from patterns learned in the Bench
        try:
            direct_score, sig_embedding = compare_signature_images(sig_img, extracted_id_signature)
            profile_score = calculate_neural_match(sig_img, student_id, current_embedding=sig_embedding) if student_id else 0.0

            if profile_score > 0.0:
                # 80/20 weighted average incorporates learning without overriding the primary ID check
                score = (direct_score * 0.8) + (profile_score * 0.2)
                score_source = f"direct={direct_score:.2f}, profile={profile_score:.2f} (80/20 weighted)"
            elif profile_score < 0:
                # Blacklist penalty applied
                score = direct_score + profile_score 
                score_source = f"direct={direct_score:.2f}, penalty={profile_score:.2f}"
            else:
                score = direct_score
                score_source = f"direct={direct_score:.2f}"
            
            print(f"[SIGNATURE] Final combined score: {score:.4f} ({score_source})", flush=True)
        except Exception as e:
            print(f"[SIGNATURE] Error in neural matching: {e}", flush=True)
            return False, f"Matching error: {str(e)}", 0.0, preview_signature, extracted_id_preview, matcher_submitted_view, matcher_reference_view
        
        # Threshold raised to 0.58 to reduce false positives from complex doodles
        threshold = 0.58
        is_verified = score >= threshold
        status = (
            f"Signature match successful ({score_source})"
            if is_verified else
            f"Signature mismatch ({score_source}, threshold: {threshold:.2f})"
        )
        
        return is_verified, status, float(score), preview_signature, extracted_id_preview, matcher_submitted_view, matcher_reference_view
    except Exception as e:
        print(f"[SIGNATURE] Wrapper error: {e}", flush=True)
        return False, str(e), 0.0, None, None, None, None

def save_signature_profile(student_id, drawing_data, profile_type='real'):
    """
    Saves a drawing sample to the student's Neural History or Blacklist.
    """
    try:
        if not drawing_data: return False
        
        # Safe decode base64
        if isinstance(drawing_data, str):
            if ',' in drawing_data: drawing_data = drawing_data.split(',')[1]
            drawing_data = base64.b64decode(drawing_data)
        
        # Determine subdirectory based on type
        sub_dir = 'history' if profile_type == 'real' else 'blacklist'
        history_dir = os.path.join(os.getcwd(), 'knowledge', 'signature_profiles', sub_dir, str(student_id))
        os.makedirs(history_dir, exist_ok=True)
        
        # Save with high-res timestamp
        file_path = os.path.join(history_dir, f"{int(time.time() * 1000)}.png")
        with open(file_path, 'wb') as f:
            f.write(drawing_data)
            
        print(f"[SIGNATURE] Saved {profile_type} training sample for student {student_id}", flush=True)
        return True
    except Exception as e:
        print(f"[SIGNATURE] Save error: {e}", flush=True)
        return False

def clear_heavy_memory():
    """Aggressive memory release to keep Render happy."""
    gc.collect()
    try:
        import ctypes
        libc = ctypes.CDLL("libc.so.6")
        libc.malloc_trim(0)
    except:
        pass