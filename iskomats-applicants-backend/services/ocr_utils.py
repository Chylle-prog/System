import os
import re
import cv2
import numpy as np
import pytesseract
import tempfile
import time
import base64
import gc
import difflib
import json
import hashlib
import traceback
import eventlet
import eventlet.tpool
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from fractions import Fraction

# --- THREADING & RESOURCE CONTROLS ---
# We use a semaphore to limit simultaneous OCR tasks, preventing OOM on small servers.
OCR_SEMAPHORE = Lock() # Standard lock for local blocking
_OCR_POOL = ThreadPoolExecutor(max_workers=3)
_FACE_MODEL_LOCK = Lock()
_FACE_MODEL_INIT_ERROR = None
_FACE_DETECTOR = None
_FACE_RECOGNIZER = None

# --- CONFIGURATION & THRESHOLDS ---
_FACE_MATCH_THRESHOLD = 0.55
_FACE_DETECTION_THRESHOLD = 0.60
_MAX_OCR_WIDTH = 1100
_MAX_FACE_WIDTH = 512
_OCR_CACHE = {} # Persistent cache within process life
_OCR_CACHE_MAX_SIZE = 100
_CLAHE = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))

# Tesseract Discovery Logic (Ported from Admin Thesis for reliability)
def _init_tesseract():
    """Finds Tesseract binary across local and cloud environments."""
    possible_paths = [
        r'tesseract', # Default (Render/Linux)
        r'C:\Program Files\Tesseract-OCR\tesseract.exe',
        r'C:\Program Files (x86)\Tesseract-OCR\tesseract.exe',
        r'usr/bin/tesseract',
        r'/usr/local/bin/tesseract'
    ]
    
    # Check environment variable first
    env_path = os.environ.get('TESSERACT_PATH')
    if env_path:
        possible_paths.insert(0, env_path)

    for path in possible_paths:
        try:
            # Basic version check to see if it works
            pytesseract.get_tesseract_version()
            print(f"[OCR] Tesseract is available via default shell path.", flush=True)
            return True
        except:
            if os.path.exists(path):
                pytesseract.pytesseract.tesseract_cmd = path
                print(f"[OCR] Found Tesseract at: {path}", flush=True)
                return True
    return False

# Initialize on import
_TESSERACT_AVAILABLE = _init_tesseract()

def _check_tesseract():
    global _TESSERACT_AVAILABLE
    if not _TESSERACT_AVAILABLE:
        _TESSERACT_AVAILABLE = _init_tesseract()
    return _TESSERACT_AVAILABLE

# --- CACHE HELPERS ---
def _hash_image(image_bytes, suffix=b""):
    """Creates a unique hash for an image to avoid redundant OCR."""
    if not image_bytes: return "empty"
    # Ensure both are bytes
    b_data = image_bytes if isinstance(image_bytes, bytes) else str(image_bytes).encode('utf-8')
    b_suffix = suffix if isinstance(suffix, bytes) else str(suffix).encode('utf-8')
    return hashlib.md5(b_data + b_suffix).hexdigest()

def _cache_get(key):
    return _OCR_CACHE.get(key)

def _cache_set(key, val):
    if len(_OCR_CACHE) >= _OCR_CACHE_MAX_SIZE:
        _OCR_CACHE.clear() # Primitive LRU
    _OCR_CACHE[key] = val

# --- TEXT NORMALIZATION ---
def normalize_for_ocr(s):
    if not s: return ""
    # Standardize to lowercase and remove non-alphanumeric for matching
    return re.sub(r'[^a-z0-9\s]', ' ', str(s).lower()).strip()

def normalize_semester_label(value):
    if not value: return None
    s = str(value).lower().strip()
    if any(k in s for k in ['1st', 'first', '1', 'i', 'ist', 'lst']): return "1st"
    if any(k in s for k in ['2nd', 'second', '2', 'ii', 'and']): return "2nd"
    return None

# --- QUALITY ASSESSMENT ---
def assess_image_quality(img_gray):
    """Checks for blur and contrast to fail quickly on bad photos."""
    if img_gray is None: return False, "No image"
    
    # Laplacian Variance for blur detection
    laplacian_var = cv2.Laplacian(img_gray, cv2.CV_64F).var()
    if laplacian_var < 15: # Very blurry
        return False, "Image is too blurry. Please use better lighting."
    
    # Contrast check
    min_v, max_v, _, _ = cv2.minMaxLoc(img_gray)
    if (max_v - min_v) < 40:
        return False, "Low contrast signal. Ensure the document is well-lit."
        
    return True, "Success"

# --- CORE OCR EXECUTION ---
def _run_tesseract_on_image(img, psm=3, skip_pass2=False):
    if not _check_tesseract(): return ""
    config = f'--psm {psm} --oem 1'
    try:
        res = eventlet.tpool.execute(pytesseract.image_to_string, img, config=config)
        text = res.decode('utf-8') if isinstance(res, bytes) else str(res)
        
        if not skip_pass2 and len(text.strip()) < 10:
            res_alt = eventlet.tpool.execute(pytesseract.image_to_string, img, config='--psm 11 --oem 1')
            text_alt = res_alt.decode('utf-8') if isinstance(res_alt, bytes) else str(res_alt)
            if len(text_alt) > len(text): text = text_alt
        return text
    except Exception as e:
        print(f"[OCR ERROR] Tesseract failure: {e}")
        return ""

def _decode_cv_image(image_source, white_background=False):
    """Robust image decoder covering raw bytes, base64, and files."""
    try:
        if not image_source: return None
        b_data = decode_base64(image_source) if not isinstance(image_source, bytes) else image_source
        nparr = np.frombuffer(b_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_UNCHANGED)
        if img is None: return None
        
        # Handle alpha channel
        if len(img.shape) == 3 and img.shape[2] == 4:
            if white_background:
                alpha = img[:, :, 3] / 255.0
                bg = np.ones_like(img[:, :, :3], dtype=np.uint8) * 255
                for c in range(3):
                    img[:, :, c] = (alpha * img[:, :, c] + (1 - alpha) * bg[:, :, c]).astype(np.uint8)
            img = img[:, :, :3]
        return img
    except: return None

def _ocr_video_frame(processed_frame, allow_alt_pass=True, keywords=None):
    """Run OCR for a single video frame."""
    with OCR_SEMAPHORE:
        psm = 11 if keywords else 3
        res = eventlet.tpool.execute(pytesseract.image_to_string, processed_frame, config=f'--psm {psm} --oem 1')
        text = res.decode('utf-8') if isinstance(res, bytes) else str(res)
        
        if keywords and any(k.lower() in text.lower() for k in keywords):
            return text

        if allow_alt_pass and len(text.strip()) < 12:
            res_alt = eventlet.tpool.execute(pytesseract.image_to_string, processed_frame, config='--psm 6 --oem 1')
            text_alt = res_alt.decode('utf-8') if isinstance(res_alt, bytes) else str(res_alt)
            if len(text_alt.strip()) > len(text.strip()):
                text = text_alt
    return text

def _preprocess_frame_for_ocr(frame):
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    enhanced = _CLAHE.apply(gray)
    return cv2.normalize(enhanced, None, 0, 255, cv2.NORM_MINMAX)

# --- MATCHING LOGIC (PORTED FROM ADMIN) ---
def year_level_matches_text(target_year, text):
    if not target_year: return True, None
    t_year = str(target_year).lower().strip()
    match_number = re.search(r'\b(\d{1,2})(?:st|nd|rd|th)?\b', t_year)
    expected_level = match_number.group(1) if match_number else t_year
    norm_text = text.lower()
    
    digit_misreads = {'1': r'[1Il|!i]', '2': r'[2Zz]', '5': r'[5SsS\$]', '0': r'[0OQoD]'}
    def get_char_pattern(digit): return digit_misreads.get(digit, re.escape(digit))
    number_pattern = "".join(get_char_pattern(d) for d in expected_level)
    suffix_pattern = r'(?:st|nd|rd|th|ist|lst)?'
    
    if re.search(rf'\b(?:year\s*)?level\s*[:\-.;]?\s*{number_pattern}{suffix_pattern}\b', norm_text, re.IGNORECASE):
        return True, expected_level
    if re.search(rf'\b{number_pattern}{suffix_pattern}?\s*(?:year|yr\.?)\b', norm_text, re.IGNORECASE):
        return True, expected_level
    return False, None

def course_matches_text(target_course, text):
    if not target_course: return True, None
    t_course = target_course.lower().strip()
    norm_text = text.lower()
    if t_course in norm_text: return True, t_course
    
    words = [w.strip() for w in re.split(r'[^a-zA-Z0-9]', target_course) if w.strip()]
    if len(words) >= 2:
        acronym = "".join(w[0].lower() for w in words)
        if len(acronym) >= 2 and re.search(rf'\b{re.escape(acronym)}\b', norm_text):
            return True, acronym
    return False, None

def student_id_no_matches_text(target_id, text):
    if not target_id: return True, None
    def normalize_id(s):
        s = "".join(filter(str.isalnum, str(s))).lower()
        s = s.replace('o', '0').replace('q', '0').replace('d', '0')
        s = s.replace('i', '1').replace('l', '1').replace('|', '1').replace('!', '1')
        return s
    
    t_id = normalize_id(target_id)
    if not t_id: return True, None
    norm_text = normalize_id(text)
    if t_id in norm_text: return True, target_id
    
    # Strict homoglyph regex pattern matching
    mapping = {'0':'[0oqhd]', '1':'[1ilsj7/!|]', '2':'[2zsa7]', '3':'[3e8]', '4':'[4a]', '5':'[5s1]', '6':'[6gb5]', '7':'[71lty/]', '8':'[8b3]', '9':'[9gq]'}
    clean_target = "".join(filter(str.isalnum, str(target_id))).lower()
    if len(clean_target) >= 6:
        pattern = "".join([mapping.get(c, re.escape(c)) for c in clean_target])
        full_clean_text = "".join(filter(str.isalnum, str(text))).lower()
        if re.search(pattern, full_clean_text): return True, target_id
    return False, None

def student_name_matches_text(ocr_text, first_name, middle_name, last_name, is_indigency=False):
    name_ok, _, _, match_ratio, meta = _perform_text_matching(ocr_text, first_name, middle_name, last_name, is_indigency=is_indigency)
    return name_ok, match_ratio, meta.get('name_details', {})

def _perform_text_matching(ocr_text, target_first_name=None, target_middle_name=None, target_last_name=None, target_address=None, target_id_no=None, target_year_level=None, target_school_name=None, keywords=None, is_indigency=False):
    meta = {}
    if not ocr_text or not ocr_text.strip(): return False, False, [], 0.0, meta
    norm_txt = normalize_for_ocr(ocr_text)
    all_ocr_words = norm_txt.split()
    
    n_verified = True
    m_ratio = 1.0
    
    if target_first_name or target_last_name:
        def check_name_part(name_part, is_middle=False):
            if not name_part: return True, 1.0
            n_words = [w.strip() for w in normalize_for_ocr(name_part).split() if len(w.strip()) >= 2]
            if not n_words: n_words = [w.strip() for w in normalize_for_ocr(name_part).split() if w.strip()]
            f_count = 0
            thresh = 0.70 if is_indigency else 0.80
            
            for word in n_words:
                found = False
                if re.search(rf'\b{re.escape(word)}\b', norm_txt): f_count += 1; found = True
                elif is_middle and len(word) > 1 and re.search(rf'\b{re.escape(word[0])}\b', norm_txt): f_count += 1; found = True
                
                if not found:
                    for ocr_w in all_ocr_words:
                        if difflib.SequenceMatcher(None, word, ocr_w).ratio() >= thresh:
                            f_count += 1; found = True; break
            
            p_ratio = f_count / len(n_words) if n_words else 0
            if p_ratio < thresh:
                clean_name = "".join(filter(str.isalnum, str(name_part))).lower()
                clean_text = "".join(filter(str.isalnum, str(norm_txt)))
                if len(clean_name) >= 4 and clean_name in clean_text: return True, 1.0
            return p_ratio >= thresh, p_ratio

        f_ok, f_r = check_name_part(target_first_name)
        m_ok, m_r = check_name_part(target_middle_name, is_middle=True)
        l_ok, l_r = check_name_part(target_last_name)
        
        n_verified = f_ok and l_ok if is_indigency else (f_ok and m_ok and l_ok)
        meta['name_details'] = {'first_ok': f_ok, 'middle_ok': m_ok, 'last_ok': l_ok}
        m_ratio = (f_r + m_r + l_r) / 3.0

    a_verified = True if not target_address else False
    if target_address and norm_txt.strip():
        nt_addr = normalize_for_ocr(target_address)
        if nt_addr in norm_txt: a_verified = True
        else:
            ignore = ['city', 'municipality', 'town', 'brgy', 'barangay']
            a_words = [w.strip() for w in nt_addr.split() if len(w.strip()) >= 2 and w.strip() not in ignore]
            if a_words:
                f_a = sum(1 for w in a_words if w in norm_txt or any(difflib.SequenceMatcher(None, w, ow).ratio() >= 0.75 for ow in all_ocr_words if len(ow) >= 2))
                a_verified = f_a >= min(2, len(a_words)) if is_indigency else (f_a / len(a_words) >= 0.5)

    found_kw = []
    if keywords:
        for kw in keywords:
            nkw = normalize_for_ocr(kw)
            if nkw in norm_txt or any(difflib.SequenceMatcher(None, nkw, ow).ratio() >= 0.7 for ow in all_ocr_words if len(ow) >= 3):
                found_kw.append(kw)
                
    meta['detected_brgy'] = list(set(re.findall(r'(?:barangay|brgy)\.?\s+([A-Z][A-Za-z]+)', ocr_text, re.IGNORECASE)))
    return n_verified, a_verified, found_kw, m_ratio, meta

# --- PUBLIC API FUNCTIONS ---
def verify_id_with_ocr(image_bytes, first_name, middle_name, last_name, address=None, expected_id_no=None, expected_school_name=None):
    if not _check_tesseract() or not image_bytes: return False, "Service Unavailable", "", {}
    
    is_indigency = address is not None
    b_data = decode_base64(image_bytes) if not isinstance(image_bytes, bytes) else image_bytes
    img_hash = _hash_image(b_data)
    cached = _cache_get(img_hash)
    if cached: return True, "Verified (cached)", cached[0], {'name_ok':True, 'addr_ok':True}

    nparr = np.frombuffer(b_data, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_GRAYSCALE)
    if img is None: return False, "Invalid image", "", {}
    
    is_q, q_msg = assess_image_quality(img)
    if not is_q: return False, q_msg, "", {}
    
    h, w = img.shape[:2]
    if w > _MAX_OCR_WIDTH:
        sc = _MAX_OCR_WIDTH / w
        img = cv2.resize(img, (int(w*sc), int(h*sc)), interpolation=cv2.INTER_AREA)
    
    with OCR_SEMAPHORE:
        # Full scan
        text = _run_tesseract_on_image(img, psm=6 if is_indigency else 3)
        # Header scan
        h_h, l_w = int(h*0.35), int(w*0.55)
        l_text = _run_tesseract_on_image(img[:h_h, :l_w], psm=6, skip_pass2=True)
        r_text = _run_tesseract_on_image(img[:h_h, l_w:], psm=6, skip_pass2=True)
        full_text = f"{text}\n{l_text}\n{r_text}"
        
    n_v, a_v, f_kw, ratio, meta = _perform_text_matching(full_text, first_name, middle_name, last_name, address, expected_id_no, None, expected_school_name, None, is_indigency)
    
    if n_v and a_v:
        _cache_set(img_hash, (full_text, ratio))
        return True, "Verified", full_text, meta
    
    return False, f"Identity mismatch ({ratio:.0%})", full_text, meta

def extract_document_text(image_bytes, max_width=None, is_id_back=False, prefer_fast_layout=False, crop_percent=None):
    if not _check_tesseract() or not image_bytes: return "", "Service Unavailable"
    
    b_data = decode_base64(image_bytes) if not isinstance(image_bytes, bytes) else image_bytes
    nparr = np.frombuffer(b_data, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_GRAYSCALE)
    if img is None: return "", "Invalid image"
    
    h, w = img.shape[:2]
    if crop_percent: img = img[:int(h*crop_percent), :]
    
    target_w = max_width or (950 if is_id_back else 850)
    if w > target_w:
        sc = target_w / w
        img = cv2.resize(img, (int(w*sc), int(h*sc)), interpolation=cv2.INTER_AREA)
        
    with OCR_SEMAPHORE:
        psm = 6 if prefer_fast_layout or is_id_back else 3
        text = _run_tesseract_on_image(img, psm=psm)
        if not is_id_back:
            h_h, l_w = int(img.shape[0]*0.35), int(img.shape[1]*0.55)
            h_text = _run_tesseract_on_image(img[:h_h, :l_w], psm=6, skip_pass2=True)
            text = f"{h_text}\n{text}"
            
    return text, None

def verify_video_content(video_bytes, keywords, expected_address=None, sample_positions=None, max_width=None, allow_alt_pass=True, fallback_text_length=0):
    if not video_bytes or not _check_tesseract(): return False, "Service Unavailable"
    
    is_addr = expected_address is not None
    with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as tmp:
        tmp.write(video_bytes)
        tmp_p = tmp.name
        
    try:
        cap = cv2.VideoCapture(tmp_p)
        f_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if f_count <= 0: return False, "Corrupt video file"
        
        pos = sample_positions or [0.5]
        frames = []
        for p in pos:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(f_count * p))
            ret, frame = cap.read()
            if ret:
                proc = _preprocess_frame_for_ocr(frame)
                tw = max_width or (520 if is_addr else 400)
                if proc.shape[1] > tw:
                    sc = tw / proc.shape[1]
                    proc = cv2.resize(proc, (int(proc.shape[1]*sc), int(proc.shape[0]*sc)), interpolation=cv2.INTER_AREA)
                frames.append(proc)
        cap.release()
        
        if not frames: return False, "No frames captured"
        
        with ThreadPoolExecutor(max_workers=3) as ex:
            results = list(ex.map(lambda f: _ocr_video_frame(f, allow_alt_pass=allow_alt_pass, keywords=keywords), frames))
            
        all_text = " ".join(results)
        _, a_v, f_kw, _, _ = _perform_text_matching(all_text, None, None, None, expected_address, keywords=keywords, is_indigency=is_addr)
        
        if f_kw or (not is_addr and len(all_text.strip()) >= (fallback_text_length or 10)):
            if expected_address and not a_v: return False, f"Address mismatch. Target: {expected_address}"
            return True, f"Found {', '.join(f_kw) if f_kw else 'document text'}"
            
        return False, "Required keywords not detected in video. (Target: " + ", ".join(keywords) + ")"
    except Exception as e: return False, f"Process error: {str(e)}"
    finally:
        if os.path.exists(tmp_p): os.remove(tmp_p)
        clear_heavy_memory()

def extract_school_year(image_bytes):
    text = _run_tesseract_on_image(_decode_cv_image(image_bytes), psm=3, skip_pass2=True)
    return extract_school_year_from_text(text)

def extract_school_year_from_text(text):
    if not text: return None
    match = re.search(r'(20\d{2})[\s\-\/\\–—]+(20\d{2})', text)
    if match: return f"{match.group(1)}-{match.group(2)}"
    match = re.search(r'20[2-3][0-9]', text)
    return match.group(0) if match else None

def extract_semester_from_text(text):
    if not text: return None
    patterns = [
        r'(1st|2nd|first|second|1|2|I|II|and|lst|ist)\s*(?:sem|semester|grading|sern|sun)\b',
        r'\b(?:sem|semester|grading|sern|sun)\s*[:\-]?\s*(1st|2nd|first|second|1|2|I|II|and|lst|ist)\b',
        r'\b(First|Second|and)\s+Semester\b'
    ]
    for p in patterns:
        m = re.search(p, text, re.IGNORECASE)
        if m: return normalize_semester_label(m.group(1))
    return None

def is_current_school_year(year_str, semester_str=None, expected_year="2026", expected_semester=None):
    if not year_str or not expected_year: return False
    ext = re.findall(r'20\d{2}', str(year_str))
    exp = re.findall(r'20\d{2}', str(expected_year)) or [2025, 2026]
    if not ext: return False
    y_ok = any(min(int(y) for y in exp) <= int(ye) <= max(int(y) for y in exp) for ye in ext)
    if not y_ok: return False
    
    n_exp = normalize_semester_label(expected_semester)
    n_ext = normalize_semester_label(semester_str)
    if n_exp and n_ext and n_exp != n_ext: return False
    return True

# --- FACE & UTILITIES ---
def _init_face_models():
    global _FACE_DETECTOR, _FACE_RECOGNIZER, _FACE_MODEL_INIT_ERROR
    if _FACE_DETECTOR: return _FACE_DETECTOR, _FACE_RECOGNIZER
    with _FACE_MODEL_LOCK:
        try:
            from uniface.detection import RetinaFace
            from uniface.recognition import ArcFace
            _FACE_DETECTOR = RetinaFace(providers=['CPUExecutionProvider'])
            _FACE_RECOGNIZER = ArcFace(providers=['CPUExecutionProvider'])
            return _FACE_DETECTOR, _FACE_RECOGNIZER
        except Exception as e:
            _FACE_MODEL_INIT_ERROR = str(e)
            raise RuntimeError(e)

def verify_face_with_id(user_bytes, id_bytes):
    try:
        det, rec = _init_face_models()
        b_user = decode_base64(user_bytes) if not isinstance(user_bytes, bytes) else user_bytes
        u_nparr = np.frombuffer(b_user, np.uint8)
        u_img = cv2.imdecode(u_nparr, cv2.IMREAD_COLOR)
        
        b_id = decode_base64(id_bytes) if not isinstance(id_bytes, bytes) else id_bytes
        i_nparr = np.frombuffer(b_id, np.uint8)
        i_img = cv2.imdecode(i_nparr, cv2.IMREAD_COLOR)
        
        u_faces = det.detect(u_img)
        i_faces = det.detect(i_img)
        if not u_faces or not i_faces: return False, "No face detected", 0.0
        
        u_emb = rec.get_normalized_embedding(u_img, u_faces[0].landmarks)
        i_emb = rec.get_normalized_embedding(i_img, i_faces[0].landmarks)
        sim = float(np.dot(u_emb, i_emb.T))
        return sim >= _FACE_MATCH_THRESHOLD, f"Similarity: {sim:.2f}", sim
    except Exception as e: return False, str(e), 0.0

def fetch_video_bytes_from_url(url):
    import requests
    try:
        r = requests.get(url, timeout=10)
        return r.content, None
    except Exception as e: return None, str(e)

def db_bytes(val):
    if not val: return None
    if isinstance(val, bytes): return val
    if isinstance(val, memoryview): return val.tobytes()
    return None

def decode_base64(s):
    if not s: return None
    if isinstance(s, bytes): return s
    try:
        if ',' in s: s = s.split(',')[1]
        s = s.strip().replace(' ', '+')
        
        # Add missing padding
        missing_padding = len(s) % 4
        if missing_padding:
            s += '=' * (4 - missing_padding)
            
        return base64.b64decode(s)
    except Exception as e:
        print(f"[BASE64 ERROR] Failed to decode: {str(e)}")
        return None

def clear_heavy_memory():
    gc.collect()
    try:
        import ctypes
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except: pass