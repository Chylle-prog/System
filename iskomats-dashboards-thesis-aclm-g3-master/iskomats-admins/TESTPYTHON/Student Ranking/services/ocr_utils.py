import os
import sys
import gc
import base64
import time
import cv2
import numpy as np
import pytesseract
import platform
import multiprocessing as mp
import re
import difflib
from skimage.metrics import structural_similarity as ssim
from scipy.spatial.distance import cosine

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

# ─── Tesseract availability check ─────────────────────────────────────────────
if platform.system() == 'Windows':
    try:
        import pytesseract
        _tess_cmd = os.environ.get('TESSERACT_CMD', r'C:\Program Files\Tesseract-OCR\tesseract.exe')
        pytesseract.pytesseract.tesseract_cmd = _tess_cmd
    except ImportError:
        pass

_tesseract_available = None
def _check_tesseract():
    global _tesseract_available
    if _tesseract_available is not None: return _tesseract_available
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
_MAX_OCR_WIDTH = 1200
_MAX_FACE_WIDTH = 224

def _preprocess_strategy_a(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)
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

# ─── OCR extraction ───────────────────────────────────────────────────────────
def _run_tesseract(image_bytes, fast_mode=True):
    if not image_bytes: return ""
    try:
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None: return ""
        
        h, w = img.shape[:2]
        if w > _MAX_OCR_WIDTH:
            scale = _MAX_OCR_WIDTH / w
            img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        
        # Unified Strategy
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        gray_clahe = clahe.apply(gray)
        binary = cv2.adaptiveThreshold(gray_clahe, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 21, 10)
        
        text = pytesseract.image_to_string(binary, config='--psm 3')
        
        if not text.strip() and not fast_mode:
            strategies = [_preprocess_strategy_b, _preprocess_strategy_c]
            all_text = [text] if text.strip() else []
            for strat in strategies:
                binary_fallback = strat(img)
                txt = pytesseract.image_to_string(binary_fallback, config='--psm 3')
                if txt.strip(): all_text.append(txt.strip())
            return "\n".join(all_text)
            
        return text.strip()
    except Exception as e:
        print(f"[OCR] Error: {e}", flush=True)
        return ""

def verify_id_with_ocr(image_bytes, expected_name, expected_address=None):
    if not _check_tesseract(): 
        return False, "OCR Engine (Tesseract) not found.", "", 0.0
    
    def normalize_for_ocr(s):
        if not s: return ""
        return re.sub(r'[^a-z0-9\s]', ' ', s.lower()).strip()

    def check_match(ocr_text, target_name, target_addr, is_indigency=False):
        norm_txt = normalize_for_ocr(ocr_text)
        all_ocr_words = norm_txt.split()
        
        n_verified = True
        m_ratio = 1.0
        if target_name:
            n_words = [w.strip() for w in normalize_for_ocr(target_name).split() if len(w.strip()) >= 2]
            if not n_words: n_words = [w.strip() for w in normalize_for_ocr(target_name).split() if w.strip()]
            f_count = 0
            for word in n_words:
                if word in norm_txt: f_count += 1; continue
                for ocr_w in all_ocr_words:
                    if len(ocr_w) < len(word) - 1: continue 
                    if difflib.SequenceMatcher(None, word, ocr_w).ratio() >= (0.7 if is_indigency else 0.8):
                        f_count += 1; break
            m_ratio = f_count / len(n_words) if n_words else 0
            n_verified = m_ratio >= (0.4 if is_indigency else 0.6)

        a_verified = True
        if target_addr:
            norm_target_addr = normalize_for_ocr(target_addr)
            if norm_target_addr in norm_txt: a_verified = True
            else:
                a_words = [w.strip() for w in norm_target_addr.split() if len(w.strip()) >= 2]
                f_a_count = 0
                for word in a_words:
                    if word in norm_txt: f_a_count += 1; continue
                    for ocr_w in all_ocr_words:
                        if len(ocr_w) < 2: continue
                        if difflib.SequenceMatcher(None, word, ocr_w).ratio() >= 0.7:
                            f_a_count += 1; break
                a_verified = (f_a_count / len(a_words) if a_words else 0) >= (0.4 if is_indigency else 0.5)
        
        return n_verified, a_verified, m_ratio

    is_indigency = (expected_address is not None) 
    
    # Pass 1: Fast Mode
    text = _run_tesseract(image_bytes, fast_mode=True)
    name_v, addr_v, ratio = check_match(text, expected_name, expected_address, is_indigency)
    
    # Pass 2: Full Preprocessing
    if not (name_v and addr_v) and image_bytes:
        text_full = _run_tesseract(image_bytes, fast_mode=False)
        name_v_f, addr_v_f, ratio_f = check_match(text_full, expected_name, expected_address, is_indigency)
        if (name_v_f and addr_v_f) or ratio_f > ratio:
            text, name_v, addr_v, ratio = text_full, name_v_f, addr_v_f, ratio_f

    # Pass 3: PSM 11
    if not (name_v and addr_v) and image_bytes:
        try:
            nparr = np.frombuffer(image_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is not None:
                gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
                text_s = pytesseract.image_to_string(gray, config='--psm 11')
                name_v_s, addr_v_s, ratio_s = check_match(text_s, expected_name, expected_address, is_indigency)
                if (name_v_s and addr_v_s) or ratio_s > ratio:
                    text, name_v, addr_v, ratio = text_s, name_v_s, addr_v_s, ratio_s
        except: pass

    # Pass 4: PSM 6
    if not (name_v and addr_v) and image_bytes:
        try:
            nparr = np.frombuffer(image_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is not None:
                lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB); l, a, b = cv2.split(lab)
                clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8,8)); cl = clahe.apply(l)
                enhanced = cv2.merge((cl,a,b)); enhanced = cv2.cvtColor(enhanced, cv2.COLOR_LAB2BGR)
                gray = cv2.cvtColor(enhanced, cv2.COLOR_BGR2GRAY)
                text_c = pytesseract.image_to_string(gray, config='--psm 6')
                name_v_c, addr_v_c, ratio_c = check_match(text_c, expected_name, expected_address, is_indigency)
                if (name_v_c and addr_v_c) or ratio_c > ratio:
                    text, name_v, addr_v, ratio = text_c, name_v_c, addr_v_c, ratio_c
        except: pass

    if name_v and addr_v:
        return True, "Name and Address verified via OCR.", text, 1.0
    elif name_v:
        return False, "Address mismatch", text, 0.7
    
    if ratio >= 0.3:
        return False, f"Identity mismatch ({ratio:.0%})", text, ratio
        
    return False, "Identity verification mismatch", text, 0.0

def extract_school_year_from_text(text):
    if not text: return None
    match = re.search(r'20\d{2}(?:\s*-\s*20\d{2})?', text)
    return match.group(0) if match else None

def extract_school_year(image_bytes):
    text = _run_tesseract(image_bytes, fast_mode=True)
    return extract_school_year_from_text(text)

def is_current_school_year(year_str, current_year=2026):
    if not year_str: return False
    years = re.findall(r'20\d{2}', year_str)
    if not years: return False
    return any(int(y) == current_year for y in years)

# ─── Neural Signature Verification Wrappers ───────────────────────────────────

def verify_signature_against_id(student_id, drawing_data):
    """
    Neural matching wrapper for student_api consumption.
    """
    try:
        from .signature_brain import calculate_neural_match
        
        if not drawing_data: return False, "No drawing data", 0.0
        
        # Safe decode base64
        if isinstance(drawing_data, str):
            if ',' in drawing_data: drawing_data = drawing_data.split(',')[1]
            drawing_data = base64.b64decode(drawing_data)
            
        nparr = np.frombuffer(drawing_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None: return False, "Invalid image data", 0.0
        
        score = calculate_neural_match(img, student_id)
        # Threshold 0.65 as established in previous neural training sessions
        is_verified = score >= 0.65
        status = "Neural match successful" if is_verified else "Neural signature mismatch"
        return is_verified, status, score
    except Exception as e:
        print(f"[SIGNATURE] Wrapper error: {e}", flush=True)
        return False, str(e), 0.0

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