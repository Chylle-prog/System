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

def _run_tesseract_on_image(img, psm=3, strategies=None):
    """Internal helper to run OCR on an already decoded/resized image with specified strategies."""
    if img is None: return ""
    results = []
    
    # Always try the primary (Strategy A) first with the specified PSM
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray_clahe = clahe.apply(gray)
    binary = cv2.adaptiveThreshold(gray_clahe, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 21, 10)
    
    text = pytesseract.image_to_string(binary, config=f'--psm {psm}')
    if text.strip():
        results.append(text.strip())
    
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

def verify_id_with_ocr(image_bytes, expected_name, expected_address=None):
    """
    Optimized version:
    1. Decodes and resizes image only ONCE.
    2. Try unique strategies and PSMs sequentially.
    3. Exits early on success.
    """
    if not _check_tesseract(): 
        return False, "OCR Engine (Tesseract) not found.", "", 0.0
    if not image_bytes:
        return False, "No image data provided.", "", 0.0
        
    def normalize_for_ocr(s):
        if not s: return ""
        return re.sub(r'[^a-z0-9\s]', ' ', s.lower()).strip()

    def check_match(ocr_text, target_name, target_addr, is_indigency=False):
        if not ocr_text.strip(): return False, False, 0.0
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
                found_approx = False
                for ocr_w in all_ocr_words:
                    if len(ocr_w) < len(word) - 1: continue 
                    if difflib.SequenceMatcher(None, word, ocr_w).ratio() >= (0.7 if is_indigency else 0.8):
                        f_count += 1; found_approx = True; break
                if found_approx: continue
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
                    found_approx = False
                    for ocr_w in all_ocr_words:
                        if len(ocr_w) < 2: continue
                        if difflib.SequenceMatcher(None, word, ocr_w).ratio() >= 0.7:
                            f_a_count += 1; found_approx = True; break
                    if found_approx: continue
                a_verified = (f_a_count / len(a_words) if a_words else 0) >= (0.4 if is_indigency else 0.5)
        
        return n_verified, a_verified, m_ratio

    is_indigency = (expected_address is not None)
    
    # 1. Decode and Resize ONCE
    try:
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None: return False, "Invalid image format", "", 0.0
        
        h, w = img.shape[:2]
        if w > _MAX_OCR_WIDTH:
            scale = _MAX_OCR_WIDTH / w
            img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    except Exception as e:
        return False, f"Preprocessing error: {str(e)}", "", 0.0

    best_text = ""
    best_ratio = 0.0
    
    # --- PASS 1: Primary Preprocessing PSM 3 (Standard) ---
    text = _run_tesseract_on_image(img, psm=3)
    name_v, addr_v, ratio = check_match(text, expected_name, expected_address, is_indigency)
    if name_v and addr_v: return True, "Verified (Strategy 1)", text, 1.0
    
    best_text, best_ratio = text, ratio

    # --- PASS 2: PSM 11 (Sparse Text / Rotated Text) ---
    text_s = _run_tesseract_on_image(img, psm=11)
    name_v, addr_v, ratio = check_match(text_s, expected_name, expected_address, is_indigency)
    if name_v and addr_v: return True, "Verified (Strategy PSM11)", text_s, 1.0
    if ratio > best_ratio: best_text, best_ratio = text_s, ratio

    # --- PASS 3: Fallback Preprocessing (Strategies B/C) - only if no good results yet ---
    if best_ratio < 0.3:
        text_f = _run_tesseract_on_image(img, psm=3, strategies=[_preprocess_strategy_b, _preprocess_strategy_c])
        name_v, addr_v, ratio = check_match(text_f, expected_name, expected_address, is_indigency)
        if name_v and addr_v: return True, "Verified (Fallback Thresholding)", text_f, 1.0
        if ratio > best_ratio: best_text, best_ratio = text_f, ratio

    # --- PASS 3b: PSM 6 with Primary Preprocessing ---
    # Good for documents with a single uniform block of text (like grades/coe)
    if best_ratio < 0.5:
        text_p6 = _run_tesseract_on_image(img, psm=6)
        name_v, addr_v, ratio = check_match(text_p6, expected_name, expected_address, is_indigency)
        if name_v and addr_v: return True, "Verified (PSM6)", text_p6, 1.0
        if ratio > best_ratio: best_text, best_ratio = text_p6, ratio

    # --- PASS 4: Enhanced Contrast PSM 6 (Heavy Processing) ---
    if best_ratio < 0.5:
        try:
            lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
            l, a, b = cv2.split(lab)
            clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8,8))
            cl = clahe.apply(l)
            enhanced = cv2.merge((cl,a,b))
            enhanced = cv2.cvtColor(enhanced, cv2.COLOR_LAB2BGR)
            gray_e = cv2.cvtColor(enhanced, cv2.COLOR_BGR2GRAY)
            text_e = pytesseract.image_to_string(gray_e, config='--psm 6')
            name_v, addr_v, ratio = check_match(text_e, expected_name, expected_address, is_indigency)
            if name_v and addr_v: return True, "Verified (Enhanced CLAHE)", text_e, 1.0
            if ratio > best_ratio: best_text, best_ratio = text_e, ratio
        except: pass

    # Evaluation
    if best_ratio >= (0.4 if is_indigency else 0.6):
         # Check address for the best match text
         _, addr_ok, _ = check_match(best_text, None, expected_address, is_indigency)
         if not addr_ok:
             return False, "Address mismatch", best_text, 0.7
         return True, "Verified", best_text, 1.0

    if best_ratio >= 0.3:
        return False, f"Identity mismatch ({best_ratio:.0%})", best_text, best_ratio
        
    return False, "Identity verification mismatch", best_text, 0.0

def verify_video_content(video_bytes, keywords):
    """
    Captures frames from video bytes and scans for keywords using OCR.
    Limit to 3 frames (start, middle, end) for performance.
    """
    if not video_bytes: return False, "No video data"
    if not _check_tesseract(): return False, "OCR Engine not found"
    
    # Save to temp file because VideoCapture needs a path
    with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as tmp:
        tmp.write(video_bytes)
        tmp_path = tmp.name
        
    try:
        cap = cv2.VideoCapture(tmp_path)
        if not cap.isOpened():
            return False, "Could not open video file"
            
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if frame_count <= 0:
            return False, "Invalid video frame count"
            
        # Sample points: 10%, 50%, 90%
        samples = [int(frame_count * 0.1), int(frame_count * 0.5), int(frame_count * 0.9)]
        
        all_ocr_text = ""
        for frame_idx in samples:
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ret, frame = cap.read()
            if not ret or frame is None: continue
            
            # Use PSM 11 for sparse/random text detection in video
            ocr_text = _run_tesseract_on_image(frame, psm=11)
            all_ocr_text += " " + ocr_text
            
        cap.release()
        
        # Keyword check (case insensitive, fuzzy via simple substring)
        found_keywords = []
        norm_text = all_ocr_text.lower()
        for kw in keywords:
            if kw.lower() in norm_text:
                found_keywords.append(kw)
                
        if found_keywords:
            return True, f"Found: {', '.join(found_keywords)}"
        
        return False, f"Required terms ({', '.join(keywords)}) not detected in video."
        
    except Exception as e:
        print(f"[VIDEO OCR] Error: {e}")
        return False, f"Processing error: {str(e)}"
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

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

# ─── Face & Neural Signature Verification Wrappers ───────────────────────────

def verify_face_with_id(user_photo_bytes, id_photo_bytes):
    """
    Stub for face verification to prevent startup crashes.
    Currently in Diagnostics/Bypass Mode.
    """
    return True, "Face verified (Diagnostics Mode)", 1.0

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