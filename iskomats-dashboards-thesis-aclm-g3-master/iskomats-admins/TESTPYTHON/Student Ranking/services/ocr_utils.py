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
_MAX_OCR_WIDTH = 900 # Reduced from 1200 for speed
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
        
        # Unified Strategy (Fast & Reliable)
        # Combine CLAHE and Adaptive Threshold into one robust pass
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        gray_clahe = clahe.apply(gray)
        binary = cv2.adaptiveThreshold(gray_clahe, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 21, 10)
        
        text = pytesseract.image_to_string(binary, config='--psm 3')
        
        if not text.strip() and not fast_mode:
            # Fallback only if fast_mode is Off
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
    
    import re
    import difflib
    
    def normalize_for_ocr(s):
        if not s: return ""
        # Remove punctuation like . , ( ) etc and normalize spaces
        return re.sub(r'[^a-z0-9\s]', ' ', s.lower()).strip()

    def check_match(ocr_text, target_name, target_addr, is_indigency=False):
        norm_txt = normalize_for_ocr(ocr_text)
        all_ocr_words = norm_txt.split()
        
        # 1. Fuzzy Name Matching
        n_verified = True # Default to true if no name to match
        m_ratio = 1.0
        if target_name:
            n_words = [w.strip() for w in normalize_for_ocr(target_name).split() if len(w.strip()) >= 2]
            if not n_words:
                n_words = [w.strip() for w in normalize_for_ocr(target_name).split() if w.strip()]
                
            f_count = 0
            matched_words = []
            for word in n_words:
                # Check for exact substring match first
                if word in norm_txt:
                    f_count += 1
                    matched_words.append(word)
                    continue
                
                # Fuzzy match with individual OCR words
                is_fuzzy = False
                for ocr_w in all_ocr_words:
                    if len(ocr_w) < len(word) - 1: continue 
                    if difflib.SequenceMatcher(None, word, ocr_w).ratio() >= (0.7 if is_indigency else 0.8):
                        is_fuzzy = True
                        matched_words.append(f"{word}~(as {ocr_w})")
                        break
                if is_fuzzy: f_count += 1
                
            m_ratio = f_count / len(n_words) if n_words else 0
            # Extremely permissive for Indigency certificates.
            # Fallback: if we find indigency keywords, lower the threshold even more.
            ind_keywords = ["indigent", "indigency", "barangay", "residency", "social", "welfare"]
            found_ind_kw = any(kw in norm_txt for kw in ind_keywords)
            
            pass_threshold = 0.25 if is_indigency else 0.6
            if is_indigency and found_ind_kw:
                pass_threshold = 0.05 # Only need 5% name match if keywords are found
                
            n_verified = m_ratio >= pass_threshold
        
        if not n_verified and is_indigency:
            print(f"[OCR DEBUG] Name mismatch for Indigency. Expected: {target_name} | Ratio: {m_ratio:.2f} | KW Found: {found_ind_kw}", flush=True)

        # 2. Address Matching
        a_verified = True
        if target_addr:
            norm_target_addr = normalize_for_ocr(target_addr)
            if norm_target_addr in norm_txt:
                a_verified = True
            else:
                a_words = [w.strip() for w in norm_target_addr.split() if len(w.strip()) >= 2]
                if not a_words:
                    a_words = [w.strip() for w in norm_target_addr.split() if w.strip()]
                
                f_a_count = 0
                for word in a_words:
                    if word in norm_txt: f_a_count += 1; continue
                    for ocr_w in all_ocr_words:
                        if len(ocr_w) < 2: continue
                        if difflib.SequenceMatcher(None, word, ocr_w).ratio() >= 0.7:
                            f_a_count += 1
                            break
                
                a_match_ratio = f_a_count / len(a_words) if a_words else 0
                # Address matching for Indigency is also more permissive (25% match required)
                a_verified = a_match_ratio >= 0.25 if is_indigency else 0.5
        
        return n_verified, a_verified, m_ratio

    # Flag if this is likely an indigency certificate based on expected address presence
    is_indigency = (expected_address is not None) 
    
    # Pass 1: Fast Mode
    text = _run_tesseract(image_bytes, fast_mode=True)
    name_v, addr_v, ratio = check_match(text, expected_name, expected_address, is_indigency)
    
    # Pass 2: Retry with Full Preprocessing
    if not (name_v and addr_v) and image_bytes:
        text_full = _run_tesseract(image_bytes, fast_mode=False)
        name_v_f, addr_v_f, ratio_f = check_match(text_full, expected_name, expected_address, is_indigency)
        if (name_v_f and addr_v_f) or ratio_f > ratio:
            text, name_v, addr_v, ratio = text_full, name_v_f, addr_v_f, ratio_f

    # Slow passes (PSM 11/6) removed to prevent timeouts on Render CPU

    if name_v and addr_v:
        return True, "Name and Address verified via OCR.", text, 1.0
    elif name_v:
        return False, "Address verification doesn't match", text, 0.7
    
    if ratio >= 0.3: # Return partial match if at least 30% matches
        return False, f"Identity check: Name partially matched ({ratio:.0%}). Please ensure image is clear.", text, ratio
        
    print(f"[OCR] Verification Failed. Expected: '{expected_name}'. Snippet: '{text[:100]}...'", flush=True)
    return False, "Identity verification doesn't match", text, 0.0

def extract_school_year_from_text(text):
    if not text: return None
    import re
    # Match 20XX-20XX or just 20XX
    match = re.search(r'20\d{2}(?:\s*-\s*20\d{2})?', text)
    return match.group(0) if match else None

def extract_school_year(image_bytes):
    text = _run_tesseract(image_bytes, fast_mode=True)
    return extract_school_year_from_text(text)

def is_current_school_year(year_str, current_year=2026):
    if not year_str: return False
    # Today is 2026-04-03. Current active A.Y. is 2025-2026.
    # Documents for this year will contain '2026'.
    # We also allow 2026-2027 if the user is advanced.
    import re
    years = re.findall(r'20\d{2}', year_str)
    if not years: return False
    
    # Check if the current year (2026) is mentioned in the academic year pair/string
    return any(int(y) == current_year for y in years)



# ─── Face verification ────────────────────────────────────────────────────────
def verify_face_with_id(user_photo_bytes, id_photo_bytes):
    # This usually uses DeepFace or a lightweight ONNX model
    # For now, we'll keep the signature verification focus as requested
    return True, "Face verification bypassed (Diagnostics Mode)", 1.0

# ─── Robust Signature Extraction ──────────────────────────────────────────────

def _extract_signature_regions(id_image_data, max_signatures=3):
    try:
        nparr = np.frombuffer(id_image_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None: return []
        height, width = img.shape[:2]
        search_window = None
        try:
            ocr_data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
            for i in range(len(ocr_data['text'])):
                text = ocr_data['text'][i].strip().lower()
                if any(kw in text for kw in ["signature", "sign", "over", "printed"]):
                    x, y, w, h = ocr_data['left'][i], ocr_data['top'][i], ocr_data['width'][i], ocr_data['height'][i]
                    if ocr_data['conf'][i] > 30:
                        look_up = min(150, int(height * 0.15))
                        target_y = max(0, y - look_up)
                        target_x = max(0, x - int(width * 0.25))
                        target_w = min(width - target_x, w + int(width * 0.5))
                        target_h = y - target_y
                        search_window = (target_x, target_y, target_w, target_h)
                        break
        except: pass
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        binary = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 41, 10)
        kernel = np.ones((2, 2), np.uint8)
        binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        signature_regions = []
        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            area = cv2.contourArea(contour)
            if area < 70 or area > (width * height * 0.40): continue 
            hull = cv2.convexHull(contour)
            solidity = float(area) / (cv2.contourArea(hull) + 1e-6)
            aspect_ratio = w / (h + 1e-6)
            if aspect_ratio < 0.6: continue
            if search_window:
                tx, ty, tw, th = search_window
                cx, cy = x + w//2, y + h//2
                if tx <= cx <= tx+tw and ty <= cy <= ty+th:
                    if solidity > 0.5: continue
                    ar_score = 2.5 if aspect_ratio > 2.0 else 1.0
                    score = area * 20.0 * ar_score
                    signature_regions.append((x, y, w, h, score))
            else:
                if solidity < 0.35 and aspect_ratio > 1.2 and y > height * 0.1:
                    signature_regions.append((x, y, w, h, area * 2.0))
        signature_regions.sort(key=lambda r: r[4], reverse=True)
        signature_regions = signature_regions[:max_signatures]
        cropped_signatures = []
        for x, y, w, h, score in signature_regions:
            px, py = 15, 10
            sig_crop = img[max(0, y-py):min(height, y+h+py), max(0, x-px):min(width, x+w+px)]
            if sig_crop.size > 0: cropped_signatures.append(sig_crop)
        return cropped_signatures
    except Exception as e:
        print(f"[SIGNATURE] Extraction failed: {e}", flush=True)
        return []

# ─── Matching Core ────────────────────────────────────────────────────────────

def _compare_signatures_orb(submitted_sig_data, extracted_signatures, student_id=None):
    try:
        nparr = np.frombuffer(submitted_sig_data, np.uint8)
        submitted = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if submitted is None: return 0.0, "Invalid format", None, None, None
        
        # === ONLY ID COMPARISON (neural boost handled by caller) ===
        sub_gray = cv2.cvtColor(submitted, cv2.COLOR_BGR2GRAY) if len(submitted.shape) == 3 else submitted
        sub_gray = cv2.normalize(sub_gray, None, 0, 255, cv2.NORM_MINMAX)
        _, sub_bin_raw = cv2.threshold(sub_gray, 200, 255, cv2.THRESH_BINARY_INV)  # Match signature_brain threshold
        sub_bin = _crop_and_pad_signature(sub_bin_raw)
        
        best_match_ratio = 0.0
        best_sig_index = None
        best_extracted_img = None
        
        for idx, ext_img in enumerate(extracted_signatures):
            try:
                ext_gray = cv2.cvtColor(ext_img, cv2.COLOR_BGR2GRAY) if len(ext_img.shape) == 3 else ext_img
                ext_gray = cv2.normalize(ext_gray, None, 0, 255, cv2.NORM_MINMAX)
                _, ext_bin_raw = cv2.threshold(ext_gray, 200, 255, cv2.THRESH_BINARY_INV)  # Match signature_brain threshold
                ext_bin = _crop_and_pad_signature(ext_bin_raw)
                
                s_f32, e_f32 = sub_bin.astype(np.float32), ext_bin.astype(np.float32)
                s_m, e_m = s_f32 - s_f32.mean(), e_f32 - e_f32.mean()
                corr_score = max(0, np.sum(s_m * e_m) / (np.sqrt(np.sum(s_m**2) * np.sum(e_m**2)) + 1e-6))
                
                if corr_score > best_match_ratio:
                    best_match_ratio, best_sig_index, best_extracted_img = corr_score, idx + 1, ext_bin
            except: 
                continue
        
        # === CHECK AGAINST BLACKLISTED FAKE SIGNATURES ===
        if student_id:
            fakes_dir = os.path.join(os.getcwd(), 'knowledge', 'signature_profiles', 'fakes', str(student_id))
            if os.path.exists(fakes_dir):
                print(f"[SIGNATURE] Checking {len(os.listdir(fakes_dir))} fake signatures for student {student_id}...", flush=True)
                try:
                    # Use simple pixel correlation instead of complex ORB matching
                    for f_file in os.listdir(fakes_dir):
                        if not f_file.endswith('.png'): continue
                        try:
                            f_img = cv2.imread(os.path.join(fakes_dir, f_file))
                            if f_img is None: continue
                            
                            f_gray = cv2.cvtColor(f_img, cv2.COLOR_BGR2GRAY) if len(f_img.shape) == 3 else f_img
                            f_gray = cv2.normalize(f_gray, None, 0, 255, cv2.NORM_MINMAX)
                            _, f_bin_raw = cv2.threshold(f_gray, 200, 255, cv2.THRESH_BINARY_INV)
                            f_bin = _crop_and_pad_signature(f_bin_raw)
                            
                            # Direct pixel correlation
                            s_f32 = sub_bin.astype(np.float32)
                            f_f32 = f_bin.astype(np.float32)
                            s_m, f_m = s_f32 - s_f32.mean(), f_f32 - f_f32.mean()
                            fake_corr = max(0, np.sum(s_m * f_m) / (np.sqrt(np.sum(s_m**2) * np.sum(f_m**2)) + 1e-6))
                            
                            if fake_corr > 0.5:  # If >50% similar to a fake
                                print(f"[SIGNATURE] ⚠️ MATCHES FAKE {f_file}! Similarity: {fake_corr:.1%} - PENALIZING", flush=True)
                                best_match_ratio *= 0.05  # Reduce by 95%
                                break
                        except Exception as fe:
                            print(f"[SIGNATURE] Fake file error {f_file}: {fe}", flush=True)
                            continue
                except Exception as fake_err:
                    print(f"[SIGNATURE] Fake check error: {fake_err}", flush=True)
        
        conf = float(min(best_match_ratio * 100, 100.0))
        msg = f"ID match (Signature {best_sig_index}): {conf:.1f}%" if best_match_ratio >= 0.35 else f"ID mismatch"
        print(f"[SIGNATURE] ID correlation: {conf:.1f}%", flush=True)
        return conf, msg, best_sig_index, sub_bin, best_extracted_img
        
    except Exception as e:
        print(f"[SIGNATURE] ORB comparison failed: {e}", flush=True)
        return 0.0, str(e), None, None, None

def _crop_and_pad_signature(binary_img, target_size=(256, 256), padding=10):
    coords = cv2.findNonZero(binary_img)
    if coords is None: return np.zeros(target_size, dtype=np.uint8)
    x, y, w, h = cv2.boundingRect(coords)
    cropped = binary_img[y:y+h, x:x+w]
    scale = min((target_size[0] - padding*2) / float(w), (target_size[1] - padding*2) / float(h))
    resized = cv2.resize(cropped, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    nh, nw = resized.shape[:2]
    canvas = np.zeros(target_size, dtype=np.uint8)
    dx, dy = (target_size[0] - nw) // 2, (target_size[1] - nh) // 2
    canvas[dy:dy+nh, dx:dx+nw] = resized
    return canvas

def save_signature_profile(student_id, signature_bytes, profile_type='real'):
    try:
        nparr = np.frombuffer(signature_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None: return False
        # Save the original image directly (not cropped/padded)
        # This ensures extract_signature_embedding processes it consistently
        # with fresh submissions (no double-cropping)
        if profile_type == 'real':
            p_dir = os.path.join(os.getcwd(), 'knowledge', 'signature_profiles')
            h_dir = os.path.join(p_dir, 'history', str(student_id))
            os.makedirs(h_dir, exist_ok=True)
            cv2.imwrite(os.path.join(p_dir, f"{student_id}.png"), img)
            cv2.imwrite(os.path.join(h_dir, f"real_{int(time.time())}.png"), img)
        else:
            p_dir = os.path.join(os.getcwd(), 'knowledge', 'signature_profiles', 'fakes', str(student_id))
            os.makedirs(p_dir, exist_ok=True)
            cv2.imwrite(os.path.join(p_dir, f"fake_{int(time.time())}.png"), img)
        return True
    except: return False

def clear_student_knowledge(student_id):
    import shutil
    try:
        shutil.rmtree(os.path.join(os.getcwd(), 'knowledge', 'signature_profiles', 'fakes', str(student_id)), ignore_errors=True)
        shutil.rmtree(os.path.join(os.getcwd(), 'knowledge', 'signature_profiles', 'history', str(student_id)), ignore_errors=True)
        p_path = os.path.join(os.getcwd(), 'knowledge', 'signature_profiles', f"{student_id}.png")
        if os.path.exists(p_path): os.remove(p_path)
        return True
    except: return False

def verify_signature_against_id(submitted_sig_data, id_back_data, student_id=None):
    """
    Signature verification bypassed as requested.
    Always returns True with 100% confidence.
    """
    return True, "Signature verification bypassed (Diagnostics Mode)", 100.0, None, None