import os
import sys
import gc
import base64
import time
import cv2
import numpy as np
import threading
import shutil
import re
import difflib
import platform
try:
    import pytesseract
except ImportError:
    pytesseract = None
from project_config import get_performance_config

# Get performance profile
_perf = get_performance_config()
_threads_per_proc = str(_perf.get('threads_per_process', 1))

# Environment-aware hints for UniFace
os.environ["OMP_NUM_THREADS"] = _threads_per_proc
os.environ["MKL_NUM_THREADS"] = _threads_per_proc
os.environ["OPENBLAS_NUM_THREADS"] = _threads_per_proc
os.environ["VECLIB_MAXIMUM_THREADS"] = _threads_per_proc
os.environ["NUMEXPR_NUM_THREADS"] = _threads_per_proc
cv2.setNumThreads(int(_threads_per_proc))

_FACE_MODEL_LOCK = threading.Semaphore(1)
_FACE_DETECTOR = None
_FACE_RECOGNIZER = None
_FACE_MODEL_INIT_ERROR = None
_FACE_MATCH_THRESHOLD = 0.36 
_FACE_DETECTION_THRESHOLD = 0.25 
_MAX_FACE_WIDTH = 320  # Match frontend resize; smaller = faster inference

def decode_base64(data):
    """Safely decode base64 strings/URIs to bytes."""
    if isinstance(data, str):
        if ',' in data:
            data = data.split(',')[1]
        try:
            return base64.b64decode(data)
        except Exception:
            return None
    return data

def resolve_verification_image_bytes(image_data):
    """Resolve base64, bytes, memoryview, or http URL to raw image bytes."""
    if not image_data:
        return None
    
    if isinstance(image_data, memoryview):
        return image_data.tobytes()
    if isinstance(image_data, (bytes, bytearray)):
        return bytes(image_data)
    if isinstance(image_data, str):
        normalized = image_data.strip()
        if not normalized:
            return None
        decoded = decode_base64(normalized)
        if decoded:
            return decoded
        if normalized.startswith('http'):
            try:
                import urllib.request
                req = urllib.request.Request(normalized, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=10) as resp:
                    return resp.read()
            except Exception as e:
                print(f"[RESOLVE] Failed to fetch image URL {normalized}: {e}", flush=True)
                return None
    return None

def clear_heavy_memory():
    """Aggressive memory release to keep Render happy."""
    gc.collect()
    try:
        cv2.setNumThreads(1)
        cv2.setNumThreads(int(_threads_per_proc))
    except:
        pass
    try:
        import ctypes
        libc = ctypes.CDLL("libc.so.6")
        libc.malloc_trim(0)
    except:
        pass

def clear_student_knowledge(student_id):
    """
    Deletes the student's signature profile folders (history and blacklist).
    """
    try:
        for sub_dir in ['history', 'blacklist']:
            path = os.path.join(os.getcwd(), 'knowledge', 'signature_profiles', sub_dir, str(student_id))
            if os.path.exists(path):
                shutil.rmtree(path)
        print(f"[SIGNATURE] Cleared signature training data for student {student_id}", flush=True)
        return True
    except Exception as e:
        print(f"[SIGNATURE] Clear error: {e}", flush=True)
        return False


# ─── Face Verification Wrappers ───────────────────────────────────────────────

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
            sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            
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

def _pick_primary_face(faces, image_label, min_area_pct=0.0, image_shape=None):
    """Select the highest-confidence face above threshold."""
    if not faces:
        raise ValueError(f"No face detected in {image_label}. Please look directly at the camera.")

    valid_faces = [face for face in faces if getattr(face, 'confidence', 0.0) >= _FACE_DETECTION_THRESHOLD]
    
    if not valid_faces:
        # Fallback to any detected face if available
        return max(faces, key=lambda face: getattr(face, 'confidence', 0.0))

    return max(valid_faces, key=lambda face: getattr(face, 'confidence', 0.0))

def verify_face_with_id(user_photo_bytes, id_photo_bytes):
    """Verify a live/selfie photo against the face in the uploaded ID image."""
    try:
        detector, recognizer = _init_face_models()

        user_image = _decode_face_image(user_photo_bytes)
        id_image = _decode_face_image(id_photo_bytes)

        user_faces = detector.detect(user_image)
        user_face = _pick_primary_face(user_faces, 'the live photo', min_area_pct=0.0, image_shape=user_image.shape)
        
        id_faces = detector.detect(id_image)
        id_face = _pick_primary_face(id_faces, 'the ID image', min_area_pct=0.0, image_shape=id_image.shape)

        user_embedding = recognizer.get_normalized_embedding(user_image, user_face.landmarks)
        id_embedding = recognizer.get_normalized_embedding(id_image, id_face.landmarks)

        if user_embedding is None or id_embedding is None:
            return False, "Unable to extract face features. Please use a clearer photo.", 0.0

        try:
            from uniface import compute_similarity
            similarity = float(compute_similarity(user_embedding, id_embedding, normalized=True))
        except Exception:
            similarity = float(np.dot(user_embedding, id_embedding.T)[0][0])

        similarity = max(0.0, min(1.0, similarity))
        print(f"[FACE] Similarity score: {similarity:.4f} (threshold: {_FACE_MATCH_THRESHOLD})", flush=True)

        if similarity >= _FACE_MATCH_THRESHOLD:
            return True, f"Face verified successfully! (similarity: {similarity*100:.1f}%)", similarity

        return False, f"Face match uncertain (similarity: {similarity*100:.1f}%). Please ensure clear lighting.", similarity
    except ValueError as exc:
        return False, str(exc), 0.0
    except Exception as exc:
        print(f"[FACE] Verification error: {exc}", flush=True)
        return False, f"Face verification error: {str(exc)}", 0.0


# ─── Signature Matching Wrappers ──────────────────────────────────────────────

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

    # Downscale oversized images (e.g. 4000x3000 phone camera uploads) to max 1000px for speed boost
    h, w = img.shape[:2]
    max_dim = max(h, w)
    if max_dim > 1000:
        scale = 1000.0 / max_dim
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

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

    refined = cv2.morphologyEx(
        binary_mask,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)),
        iterations=1,
    )
    
    refined = cv2.medianBlur(refined, 3)

    contours, _ = cv2.findContours(refined, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    min_area = max(15, int(refined.shape[0] * refined.shape[1] * 0.00018))
    cleaned = np.zeros_like(refined)
    for contour in contours:
        area = cv2.contourArea(contour)
        if area >= min_area:
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

        if area > (width * height * 0.25): 
            continue

        if x <= 2 or y <= 2 or (x + w) >= (width - 2) or (y + h) >= (height - 2):
            continue

        extent = area / float(w * h) if w * h > 0 else 0
        if extent > 0.8 and area > (width * height * 0.08): 
            continue

        center_y = y + (h / 2.0)
        aspect_ratio = w / float(max(h, 1))

        if center_y < height * 0.18 or center_y > height * 0.58:
            continue

        if w > width * 0.65 and h < max(12, int(height * 0.12)) and aspect_ratio > 8.0:
            continue

        if h < 5:
            continue

        candidate_boxes.append((x, y, w, h))

    if not candidate_boxes:
        return signature_crop

    candidate_boxes.sort(key=lambda b: b[2] * b[3], reverse=True)
    
    primary_box = None
    for box in candidate_boxes:
        x_p, y_p, w_p, h_p = box
        ar = w_p / float(h_p)
        if 1.0 < ar < 10.0:
            primary_box = box
            break
            
    if not primary_box:
        primary_box = candidate_boxes[0]

    selected_boxes = [primary_box]
    px, py, pw, ph = primary_box
    pcx, pcy = px + pw/2, py + ph/2
    
    max_dist = max(width * 0.35, height * 0.35)
    
    for box in candidate_boxes:
        if box == primary_box: continue
        bx, by, bw, bh = box
        bcx, bcy = bx + bw/2, by + bh/2
        
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
    isolated = np.full((cropped_gray.shape[0], cropped_gray.shape[1], 3), 255, dtype=np.uint8)
    isolated_mask = _build_signature_mask(cropped_gray)
    if isolated_mask is None:
        return signature_crop
    
    isolated_mask = cv2.medianBlur(isolated_mask, 3)
    isolated_mask = _match_mask_to_image(isolated_mask, cropped_gray.shape)
    isolated[isolated_mask > 0] = (0, 0, 0)
    
    isolated = cv2.resize(isolated, None, fx=1.5, fy=1.5, interpolation=cv2.INTER_CUBIC)
    return isolated

def _extract_signature_from_id_back(id_img):
    if id_img is None:
        return None

    gray = cv2.cvtColor(id_img, cv2.COLOR_BGR2GRAY) if len(id_img.shape) == 3 else id_img
    height, width = gray.shape[:2]
    if height == 0 or width == 0:
        return None

    # DLSL & Philippine Student IDs have signature box in upper 8% - 38% region
    lane_y0, lane_y1 = int(height * 0.08), int(height * 0.38)
    lane_x0, lane_x1 = int(width * 0.05), int(width * 0.95)
    roi_gray = gray[lane_y0:lane_y1, lane_x0:lane_x1].copy()
    
    h_idx, w_idx = roi_gray.shape[:2]
    print(f"[SIGNATURE] Extracted ROI from ID Back: shape={roi_gray.shape}", flush=True)
    
    norm = cv2.normalize(roi_gray, None, 0, 255, cv2.NORM_MINMAX)
    smooth = cv2.GaussianBlur(norm, (5, 5), 0)
    
    binary = cv2.adaptiveThreshold(
        smooth, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, 31, 7
    )

    # Detect signature horizontal underline (if present)
    horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (int(w_idx * 0.20), 1))
    detected_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, horizontal_kernel)
    line_contours, _ = cv2.findContours(detected_lines, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    sig_line_y = None
    if line_contours:
        valid_lines = []
        for l_cnt in line_contours:
            lx, ly, lw, lh = cv2.boundingRect(l_cnt)
            if lw > w_idx * 0.18 and ly > h_idx * 0.30:
                valid_lines.append(ly)
        if valid_lines:
            sig_line_y = min(valid_lines)

    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates = []
    
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        
        if x < 2 or (x+w) > w_idx-2: continue
        if y < 2 or (y+h) > h_idx-2: continue
        
        area = cv2.contourArea(cnt)
        if area < 40: continue
        
        solidity = area / float(w * h) if w * h > 0 else 0
        aspect = w / float(h) if h > 0 else 0
        extent = area / float(w_idx * h_idx)
        
        # 1. Exclude horizontal line itself
        if aspect > 4.5 and h <= 8:
            continue

        # 2. Exclude printed text below signature baseline / line
        if sig_line_y is not None and (y + h/2) >= (sig_line_y - 2):
            continue

        # 3. Exclude small letter-like printed text at bottom ('Signature', 'Si n tu')
        if (y + h/2) > h_idx * 0.55 and area < 500:
            continue

        # 4. Exclude vertical margins
        if aspect < 0.15:
            continue
            
        complexity = cv2.arcLength(cnt, True)
        hw_score = complexity / (np.sqrt(area) + 1)
        
        candidates.append({
            'cnt': cnt,
            'box': (x, y, w, h), 
            'complex': complexity, 
            'hw_score': hw_score,
            'y_mid': y + h/2, 
            'area': area
        })

    if not candidates:
        ch, cw = int(h_idx * 0.7), int(w_idx * 0.8)
        qy0, qx0 = int((h_idx - ch)/2), int((w_idx - cw)/2)
        fallback = roi_gray[qy0:qy0+ch, qx0:qx0+cw]
        result = cv2.cvtColor(fallback, cv2.COLOR_GRAY2BGR)
        return cv2.resize(result, (400, max(1, int(400 * ch/cw))), interpolation=cv2.INTER_LINEAR)
        
    candidates.sort(key=lambda c: c['hw_score'], reverse=True)
    
    signature_lane = [c for c in candidates if c['y_mid'] < h_idx * 0.65]
    anchor = signature_lane[0] if signature_lane else candidates[0]
    
    final_parts = []
    for c in candidates:
        if abs(c['y_mid'] - anchor['y_mid']) < h_idx * 0.35:
            final_parts.append(c)
            
    if not final_parts:
        final_parts = [anchor]
            
    contour_mask = np.zeros((h_idx, w_idx), dtype=np.uint8)
    for part in final_parts:
        cv2.drawContours(contour_mask, [part['cnt']], -1, 255, -1)

    isolated_ink = cv2.bitwise_and(binary, binary, mask=contour_mask)

    x0 = min(p['box'][0] for p in final_parts)
    y0 = min(p['box'][1] for p in final_parts)
    x1 = max(p['box'][0] + p['box'][2] for p in final_parts)
    y1 = max(p['box'][1] + p['box'][3] for p in final_parts)

    pad = 8
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(w_idx, x1 + pad), min(h_idx, y1 + pad)

    crop_ink = isolated_ink[y0:y1, x0:x1]
    if crop_ink.size == 0 or np.count_nonzero(crop_ink) == 0:
        ch, cw = int(h_idx * 0.7), int(w_idx * 0.8)
        qy0, qx0 = int((h_idx - ch)/2), int((w_idx - cw)/2)
        fallback = roi_gray[qy0:qy0+ch, qx0:qx0+cw]
        result = cv2.cvtColor(fallback, cv2.COLOR_GRAY2BGR)
        return cv2.resize(result, (400, max(1, int(400 * ch/cw))), interpolation=cv2.INTER_LINEAR)

    result = np.full((crop_ink.shape[0], crop_ink.shape[1], 3), 255, dtype=np.uint8)
    result[crop_ink > 0] = (0, 0, 0)
    
    target_w = 400
    target_h = max(1, int(target_w * (result.shape[0] / float(result.shape[1]))))
    return cv2.resize(result, (target_w, target_h), interpolation=cv2.INTER_CUBIC)

def verify_signature_against_id(signature_bytes, id_back_bytes, student_id=None):
    """
    Neural signature matching against ID back image.
    """
    try:
        from .signature_brain import calculate_neural_match, compare_signature_images, prepare_signature_match_view, validate_signature_complexity
        
        if not signature_bytes or not id_back_bytes:
            return False, "Missing signature or ID image", 0.0, None, None, None, None
        
        try:
            sig_img = _decode_cv_image(signature_bytes, white_background=True)
        except Exception as e:
            print(f"[SIGNATURE] Error decoding signature: {e}", flush=True)
            return False, "Invalid signature format", 0.0, None, None, None, None
        
        try:
            id_img = _decode_cv_image(id_back_bytes)
        except Exception as e:
            print(f"[SIGNATURE] Error decoding ID image: {e}", flush=True)
            return False, "Invalid ID image format", 0.0, None, None, None, None
        
        if sig_img is None or id_img is None:
            return False, "Could not decode images", 0.0, None, None, None, None

        preview_signature = _prepare_signature_preview(sig_img)
        matcher_submitted_view = prepare_signature_match_view(sig_img)

        # Enforce stroke complexity — reject single lines, dots, or blank drawings
        is_valid_sig, invalid_reason = validate_signature_complexity(sig_img)
        if not is_valid_sig:
            print(f"[SIGNATURE] Complexity validation rejected: {invalid_reason}", flush=True)
            return False, invalid_reason, 0.0, preview_signature, None, matcher_submitted_view, None

        extracted_id_signature = _extract_signature_from_id_back(id_img)

        if extracted_id_signature is None or extracted_id_signature.size == 0:
            print("[SIGNATURE] Failed to isolate signature from ID Back.", flush=True)
            return False, "Could not isolate a signature from the ID back image", 0.0, preview_signature, None, matcher_submitted_view, None

        print(f"[SIGNATURE] ID signature isolated: shape={extracted_id_signature.shape}", flush=True)
        extracted_id_preview = extracted_id_signature  
        matcher_reference_view = prepare_signature_match_view(extracted_id_signature)
        
        try:
            direct_score, sig_embedding = compare_signature_images(sig_img, extracted_id_signature)
            profile_score = calculate_neural_match(sig_img, student_id, current_embedding=sig_embedding) if student_id else 0.0

            if profile_score > 0.0:
                score = (direct_score * 0.8) + (profile_score * 0.2)
                score_source = f"direct={direct_score:.2f}, profile={profile_score:.2f} (80/20 weighted)"
            elif profile_score < 0:
                score = direct_score + profile_score 
                score_source = f"direct={direct_score:.2f}, penalty={profile_score:.2f}"
            else:
                score = direct_score
                score_source = f"direct={direct_score:.2f}"
            
            print(f"[SIGNATURE] Final combined score: {score:.4f} ({score_source})", flush=True)
        except Exception as e:
            print(f"[SIGNATURE] Error in neural matching: {e}", flush=True)
            return False, f"Matching error: {str(e)}", 0.0, preview_signature, extracted_id_preview, matcher_submitted_view, matcher_reference_view
        
        threshold = 0.45
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
        student_id = student_id or 'bench_user'
        
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


# ─── DOCUMENT OCR & STRUCTURED COR PARSER ───────────────────────────────────

_tesseract_initialized = False

def _init_tesseract():
    global _tesseract_initialized
    if _tesseract_initialized or pytesseract is None:
        return
    if platform.system() == 'Windows':
        candidates = [
            os.environ.get('TESSERACT_CMD', r'C:\Program Files\Tesseract-OCR\tesseract.exe'),
            r'C:\Program Files (x86)\Tesseract-OCR\tesseract.exe',
            r'tesseract'
        ]
        for cmd in candidates:
            if os.path.exists(cmd):
                pytesseract.pytesseract.tesseract_cmd = cmd
                print(f"[OCR] Tesseract executable configured: {cmd}", flush=True)
                break
    _tesseract_initialized = True

def normalize_text(text):
    if not text:
        return ""
    return re.sub(r'[^a-z0-9\s]', ' ', str(text).lower()).strip()

def _run_tesseract_on_image(img, psm=3):
    if img is None or pytesseract is None:
        return ""
    try:
        _init_tesseract()
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
        h, w = gray.shape[:2]
        if w < 1000:
            scale = 1000.0 / w
            gray = cv2.resize(gray, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_CUBIC)
        text = pytesseract.image_to_string(gray, config=f'--psm {psm} --oem 1')
        return text.strip()
    except Exception as e:
        print(f"[OCR] Tesseract error: {e}", flush=True)
        return ""

def extract_document_text(image_bytes, psm=3):
    if not image_bytes:
        return ""
    try:
        data = decode_base64(image_bytes)
        if not data:
            return ""
        nparr = np.frombuffer(data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return ""
        return _run_tesseract_on_image(img, psm=psm)
    except Exception as e:
        print(f"[OCR] Extract error: {e}", flush=True)
        return ""

def preprocess_cor_lines(raw_text):
    """
    Splits lines where multi-column labels are concatenated on a single line.
    E.g. "Name : LANTAFE, MIKAELA YSABEL LINATOC Reg No : 38927" ->
         ["Name : LANTAFE, MIKAELA YSABEL LINATOC", "Reg No : 38927"]
    """
    if not raw_text:
        return []
    
    right_labels = [
        r'Reg\s*No', r'Tran\s*Date', r'College', r'Pay\s*Type',
        r'User', r'Run\s*Date', r'Scholarship', r'Discount',
        r'Ref\s*No', r'Status', r'Section', r'Bldg/Room'
    ]
    pattern = rf'\s+(?=(?:{"|".join(right_labels)})\s*[:\-])'
    
    split_lines = []
    for line in str(raw_text).splitlines():
        sublines = re.split(pattern, line.strip(), flags=re.IGNORECASE)
        for s in sublines:
            if s.strip():
                split_lines.append(s.strip())
    return split_lines

def parse_cor_document(raw_text):
    """
    Structured parser for Official Certificate of Registration (COR).
    Extracts key-value fields while preventing adjacent column bleed.
    """
    lines = preprocess_cor_lines(raw_text)
    fields = {}

    label_patterns = {
        'name': [
            r'name\s*[:\-]\s*([A-Za-z\s,\.\-]+)',
            r'student\s*name\s*[:\-]\s*([A-Za-z\s,\.\-]+)',
            r'pangalan\s*[:\-]\s*([A-Za-z\s,\.\-]+)'
        ],
        'student_id': [
            r'student\s*(?:no|number|id)\s*[:\-]?\s*([A-Za-z0-9\-]{4,20})',
            r'id\s*(?:no|number)\s*[:\-]?\s*([A-Za-z0-9\-]{4,20})',
            r'reg\s*no\s*[:\-]?\s*([A-Za-z0-9\-]{4,20})',
            r'sr\s*code\s*[:\-]?\s*([A-Za-z0-9\-]{4,20})'
        ],
        'school_year_sem': [
            r'school\s*year\s*(?:sem)?\s*[:\-]\s*([A-Za-z0-9\s\-\.\/]+)',
            r'academic\s*year\s*[:\-]\s*([A-Za-z0-9\s\-\.\/]+)',
            r'a\.?y\.?\s*[:\-]\s*([A-Za-z0-9\s\-\.\/]+)',
            r's\.?y\.?\s*[:\-]\s*([A-Za-z0-9\s\-\.\/]+)'
        ],
        'year_level': [
            r'year\s*level\s*[:\-]\s*([A-Za-z0-9\s]+)',
            r'yr\s*level\s*[:\-]\s*([A-Za-z0-9\s]+)',
            r'grade\s*level\s*[:\-]\s*([A-Za-z0-9\s]+)'
        ],
        'course': [
            r'course\s*[:\-]\s*([A-Za-z0-9\s,\.\-\&]+)',
            r'program\s*[:\-]\s*([A-Za-z0-9\s,\.\-\&]+)',
            r'degree\s*[:\-]\s*([A-Za-z0-9\s,\.\-\&]+)'
        ],
        'college': [
            r'college\s*[:\-]\s*([A-Za-z0-9\s,\.\-\&]+)'
        ]
    }

    for line in lines:
        for field_name, regexes in label_patterns.items():
            if field_name in fields:
                continue
            for regex in regexes:
                match = re.search(regex, line, re.IGNORECASE)
                if match:
                    val = match.group(1).strip()
                    val = re.sub(r'\s+(?:Reg|Tran|College|Pay|User|Scholarship|Discount|Ref)\s*[:\-].*', '', val, flags=re.IGNORECASE)
                    if len(val) > 0:
                        fields[field_name] = val
                        break

    raw_upper = str(raw_text).upper()
    if 'DE LA SALLE LIPA' in raw_upper or 'DLSL' in raw_upper:
        fields['school_name'] = 'De La Salle Lipa'
    elif 'BATANGAS STATE UNIVERSITY' in raw_upper or 'BATSTATEU' in raw_upper:
        fields['school_name'] = 'Batangas State University'
    elif 'UNIVERSITY OF THE PHILIPPINES' in raw_upper or 'UP' in raw_upper:
        fields['school_name'] = 'University of the Philippines'

    return fields

def verify_cor_fields(parsed_fields, raw_text, first_name, middle_name, last_name, **kwargs):
    """
    Strict multi-field validation for COR documents.
    Requires Name + Student ID + Academic Year/Sem + Course to ALL pass.
    No loose single-word global fallbacks allowed.
    """
    expected_id_no = kwargs.get('expected_id_no') or kwargs.get('idNo')
    expected_school_name = kwargs.get('expected_school_name') or kwargs.get('schoolName')
    expected_academic_year = kwargs.get('expected_academic_year') or kwargs.get('academicYear')
    expected_semester = kwargs.get('expected_semester') or kwargs.get('semester')
    expected_course = kwargs.get('course') or kwargs.get('expected_course')
    expected_year_level = kwargs.get('expected_year_level') or kwargs.get('yearLevel')

    meta = {'parsed_fields': parsed_fields}
    failures = []

    # 1. NAME MATCHING
    first_clean = normalize_text(first_name)
    last_clean = normalize_text(last_name)

    target_name_str = parsed_fields.get('name', raw_text)
    norm_target = normalize_text(target_name_str)

    first_words = [w for w in first_clean.split() if len(w) >= 2]
    last_words = [w for w in last_clean.split() if len(w) >= 2]

    first_ok = all(re.search(rf'\b{re.escape(w)}\b', norm_target) for w in first_words) if first_words else True
    last_ok = all(re.search(rf'\b{re.escape(w)}\b', norm_target) for w in last_words) if last_words else True

    if parsed_fields.get('name'):
        p_name_norm = normalize_text(parsed_fields['name'])
        full_expected = f"{first_clean} {last_clean}"
        if difflib.SequenceMatcher(None, full_expected, p_name_norm).ratio() >= 0.70:
            first_ok = True
            last_ok = True

    if not (first_ok and last_ok):
        failures.append(f"Name mismatch (Expected: '{first_name} {last_name}', Found in COR: '{parsed_fields.get('name', 'Not found')}')")

    # 2. STUDENT ID MATCHING
    if expected_id_no and str(expected_id_no).strip():
        exp_id_clean = re.sub(r'[^a-zA-Z0-9]', '', str(expected_id_no)).lower()
        found_id_clean = re.sub(r'[^a-zA-Z0-9]', '', parsed_fields.get('student_id', '')).lower()
        doc_raw_clean = re.sub(r'[^a-zA-Z0-9]', '', str(raw_text)).lower()

        id_ok = (exp_id_clean in found_id_clean) or (exp_id_clean in doc_raw_clean)
        if not id_ok:
            failures.append(f"Student ID mismatch (Expected: '{expected_id_no}', Found in COR: '{parsed_fields.get('student_id', 'Not found')}')")

    # 3. ACADEMIC YEAR & SEMESTER MATCHING
    if expected_academic_year and str(expected_academic_year).strip():
        found_ay = parsed_fields.get('school_year_sem', raw_text)
        exp_years = re.findall(r'20\d{2}', str(expected_academic_year))
        found_years = re.findall(r'20\d{2}', str(found_ay))

        if exp_years:
            ay_ok = all(y in found_years for y in exp_years)
            if not ay_ok:
                failures.append(f"Academic Year mismatch (Expected: '{expected_academic_year}', Found in COR: '{found_ay}')")

    if expected_semester and str(expected_semester).strip():
        found_sy_sem = parsed_fields.get('school_year_sem', raw_text)
        exp_sem_clean = normalize_text(expected_semester)
        found_sem_clean = normalize_text(found_sy_sem)

        sem_ok = False
        if any(k in exp_sem_clean for k in ['1st', '1', 'first']):
            sem_ok = any(k in found_sem_clean for k in ['1st', '1', 'first'])
        elif any(k in exp_sem_clean for k in ['2nd', '2', 'second']):
            sem_ok = any(k in found_sem_clean for k in ['2nd', '2', 'second'])
        elif any(k in exp_sem_clean for k in ['3rd', '3', 'third', 'summer', 'midyear']):
            sem_ok = any(k in found_sem_clean for k in ['3rd', '3', 'third', 'summer', 'midyear'])
        else:
            sem_ok = exp_sem_clean in found_sem_clean

        if not sem_ok:
            failures.append(f"Semester mismatch (Expected: '{expected_semester}', Found in COR: '{found_sy_sem}')")

    # 4. COURSE / DEGREE MATCHING
    if expected_course and str(expected_course).strip():
        found_course = parsed_fields.get('course', raw_text)
        c_exp = normalize_text(expected_course)
        c_found = normalize_text(found_course)

        exp_words = [w for w in c_exp.split() if w not in {'bachelor', 'of', 'science', 'in', 'and', 'the', 'bs', 'degree'}]
        course_ok = (c_exp in c_found) or (all(w in c_found for w in exp_words) if exp_words else True)

        if not course_ok:
            failures.append(f"Course mismatch (Expected: '{expected_course}', Found in COR: '{found_course}')")

    success = (len(failures) == 0)
    if success:
        msg = f"COR Verified: Name ({first_name} {last_name}), ID ({expected_id_no or 'N/A'}), AY ({expected_academic_year or 'N/A'}) matched."
    else:
        msg = "COR Verification Failed: " + "; ".join(failures)

    meta['name_ok'] = first_ok and last_ok
    meta['details'] = failures
    meta['detected_text'] = raw_text

    return success, msg, meta

def verify_document_with_ocr(image_bytes, doc_type, first_name, middle_name, last_name, **kwargs):
    """
    Main entry point for document verification (COR, Grades, Indigency, ID).
    """
    if not image_bytes:
        return False, "No document image provided.", "", {}

    raw_text = extract_document_text(image_bytes, psm=3)
    if not raw_text.strip():
        return False, "Unable to extract readable text from document.", "", {}

    doc_type_upper = str(doc_type or '').strip().upper()

    if 'GRADES' in doc_type_upper or 'TRANSCRIPT' in doc_type_upper or 'TOR' in doc_type_upper:
        parsed_fields = parse_grades_document(raw_text)
        success, msg, meta = verify_grades_fields(parsed_fields, raw_text, first_name, middle_name, last_name, **kwargs)
        return success, msg, raw_text, meta
    elif 'INDIGENCY' in doc_type_upper:
        success, msg, meta = verify_indigency_fields(raw_text, first_name, middle_name, last_name, expected_address=kwargs.get('expected_address'), **kwargs)
        return success, msg, raw_text, meta
    else:
        # Default: COR / Registration
        parsed_fields = parse_cor_document(raw_text)
        success, msg, meta = verify_cor_fields(parsed_fields, raw_text, first_name, middle_name, last_name, **kwargs)
        return success, msg, raw_text, meta

def preprocess_grades_lines(raw_text):
    """
    Splits lines where multi-column labels on Student Grades sheets are concatenated on a single line.
    E.g. "Student No : 1500017172 Total Units Enrolled : 104" ->
         ["Student No : 1500017172", "Total Units Enrolled : 104"]
    """
    if not raw_text:
        return []
    
    right_labels = [
        r'Total\s*Units\s*Enrolled', r'Total\s*Units\s*of\s*Failure',
        r'Total\s*Units\s*of\s*Incomplete', r'Total\s*Units\s*of\s*Blank\s*Grades',
        r'Total\s*Units\s*of\s*DRP\s*Grades', r'Instructor', r'Grade', r'Units', r'Posted'
    ]
    pattern = rf'\s+(?=(?:{"|".join(right_labels)})\s*[:\-])'
    
    split_lines = []
    for line in str(raw_text).splitlines():
        sublines = re.split(pattern, line.strip(), flags=re.IGNORECASE)
        for s in sublines:
            if s.strip():
                split_lines.append(s.strip())
    return split_lines

def parse_grades_document(raw_text):
    """
    Structured parser for Student Grades documents (e.g., De La Salle Lipa Student's Final Grades).
    Extracts key-value fields:
    - Name: Student Name (e.g. Alexie Chyle Magbuhat)
    - Student No: Student ID (e.g. 1500017172)
    - SY/Sem: School Year & Semester (e.g. 2026 1st Semester)
    - Course: Program name (e.g. BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY)
    - GPA: Grade Point Average (e.g. 3.5481 or 3.55)
    - Total Units: Total Units completed/passed (e.g. 26)
    """
    lines = preprocess_grades_lines(raw_text)
    fields = {}

    label_patterns = {
        'name': [
            r'student\s*name\s*[:\-]\s*([A-Za-z\s,\.\-]+)',
            r'name\s*[:\-]\s*([A-Za-z\s,\.\-]+)',
            r'pangalan\s*[:\-]\s*([A-Za-z\s,\.\-]+)'
        ],
        'student_id': [
            r'student\s*(?:no|number|id)\s*[:\-]?\s*([A-Za-z0-9\-]{4,20})',
            r'id\s*(?:no|number)\s*[:\-]?\s*([A-Za-z0-9\-]{4,20})'
        ],
        'sy_sem': [
            r'sy\s*/?\s*sem\s*[:\-]\s*([A-Za-z0-9\s\-\.\/]+)',
            r'school\s*year\s*(?:sem)?\s*[:\-]\s*([A-Za-z0-9\s\-\.\/]+)',
            r'academic\s*year\s*[:\-]\s*([A-Za-z0-9\s\-\.\/]+)'
        ],
        'course': [
            r'course\s*[:\-]\s*([A-Za-z0-9\s,\.\-\&]+)',
            r'program\s*[:\-]\s*([A-Za-z0-9\s,\.\-\&]+)',
            r'degree\s*[:\-]\s*([A-Za-z0-9\s,\.\-\&]+)'
        ]
    }

    for line in lines:
        for field_name, regexes in label_patterns.items():
            if field_name in fields:
                continue
            for regex in regexes:
                match = re.search(regex, line, re.IGNORECASE)
                if match:
                    val = match.group(1).strip()
                    val = re.sub(r'\s+(?:Total\b|Instructor\b|Grade\b|Units\b|Posted\b).*', '', val, flags=re.IGNORECASE)
                    if len(val) > 0:
                        fields[field_name] = val
                        break

    # Extract GPA / GWA from document
    gpa_patterns = [
        r'GPA\s*[:\-]?\s*([0-9]+\.[0-9]+)',
        r'GWA\s*[:\-]?\s*([0-9]+\.[0-9]+)',
        r'WEIGHTED\s*AVERAGE\s*[:\-]?\s*([0-9]+\.[0-9]+)',
        r'AVERAGE\s*[:\-]?\s*([0-9]+\.[0-9]+)'
    ]
    for pattern in gpa_patterns:
        match = re.search(pattern, raw_text, re.IGNORECASE)
        if match:
            fields['gpa'] = match.group(1).strip()
            break

    # Extract Total Units
    units_match = re.search(r'Total\s*Units\s*[:\-]\s*([0-9]+)', raw_text, re.IGNORECASE)
    if units_match:
        fields['total_units'] = units_match.group(1).strip()

    raw_upper = str(raw_text).upper()
    if 'DE LA SALLE LIPA' in raw_upper or 'DLSL' in raw_upper:
        fields['school_name'] = 'De La Salle Lipa'

    return fields

def verify_grades_fields(parsed_fields, raw_text, first_name, middle_name, last_name, **kwargs):
    """
    Strict multi-field validation for Student Grades documents.
    Requires Name + Student ID + GPA (if expected) + Academic Year/Sem + Course to pass.
    """
    expected_id_no = kwargs.get('expected_id_no') or kwargs.get('idNo')
    expected_school_name = kwargs.get('expected_school_name') or kwargs.get('schoolName')
    expected_gpa = kwargs.get('expected_gpa') or kwargs.get('gpa')
    expected_academic_year = kwargs.get('expected_academic_year') or kwargs.get('academicYear')
    expected_semester = kwargs.get('expected_semester') or kwargs.get('semester')
    expected_course = kwargs.get('course') or kwargs.get('expected_course')

    meta = {'parsed_fields': parsed_fields}
    failures = []

    # 1. NAME MATCHING
    first_clean = normalize_text(first_name)
    last_clean = normalize_text(last_name)

    target_name_str = parsed_fields.get('name', raw_text)
    norm_target = normalize_text(target_name_str)

    first_words = [w for w in first_clean.split() if len(w) >= 2]
    last_words = [w for w in last_clean.split() if len(w) >= 2]

    first_ok = all(re.search(rf'\b{re.escape(w)}\b', norm_target) for w in first_words) if first_words else True
    last_ok = all(re.search(rf'\b{re.escape(w)}\b', norm_target) for w in last_words) if last_words else True

    if parsed_fields.get('name'):
        p_name_norm = normalize_text(parsed_fields['name'])
        full_expected = f"{first_clean} {last_clean}"
        if difflib.SequenceMatcher(None, full_expected, p_name_norm).ratio() >= 0.70:
            first_ok = True
            last_ok = True

    if not (first_ok and last_ok):
        failures.append(f"Name mismatch (Expected: '{first_name} {last_name}', Found in Grades: '{parsed_fields.get('name', 'Not found')}')")

    # 2. STUDENT ID MATCHING
    if expected_id_no and str(expected_id_no).strip():
        exp_id_clean = re.sub(r'[^a-zA-Z0-9]', '', str(expected_id_no)).lower()
        found_id_clean = re.sub(r'[^a-zA-Z0-9]', '', parsed_fields.get('student_id', '')).lower()
        doc_raw_clean = re.sub(r'[^a-zA-Z0-9]', '', str(raw_text)).lower()

        id_ok = (exp_id_clean in found_id_clean) or (exp_id_clean in doc_raw_clean)
        if not id_ok:
            failures.append(f"Student ID mismatch (Expected: '{expected_id_no}', Found in Grades: '{parsed_fields.get('student_id', 'Not found')}')")

    # 3. GPA MATCHING
    if expected_gpa and str(expected_gpa).strip():
        exp_gpa_val = re.search(r'\d+(?:\.\d+)?', str(expected_gpa))
        found_gpa_val = parsed_fields.get('gpa')
        if exp_gpa_val and found_gpa_val:
            try:
                e_gpa = float(exp_gpa_val.group(0))
                f_gpa = float(found_gpa_val)
                if abs(e_gpa - f_gpa) > 0.05:
                    failures.append(f"GPA mismatch (Expected: '{e_gpa}', Found in Grades: '{f_gpa}')")
            except ValueError:
                pass

    # 4. ACADEMIC YEAR MATCHING
    if expected_academic_year and str(expected_academic_year).strip():
        found_ay = parsed_fields.get('sy_sem', raw_text)
        exp_years = re.findall(r'20\d{2}', str(expected_academic_year))
        found_years = re.findall(r'20\d{2}', str(found_ay))

        if exp_years:
            ay_ok = all(y in found_years for y in exp_years)
            if not ay_ok:
                failures.append(f"Academic Year mismatch (Expected: '{expected_academic_year}', Found in Grades: '{found_ay}')")

    # 4b. SEMESTER MATCHING
    if expected_semester and str(expected_semester).strip():
        found_sy_sem = parsed_fields.get('sy_sem', raw_text)
        exp_sem_clean = normalize_text(expected_semester)
        found_sem_clean = normalize_text(found_sy_sem)

        sem_ok = False
        if any(k in exp_sem_clean for k in ['1st', '1', 'first']):
            sem_ok = any(k in found_sem_clean for k in ['1st', '1', 'first'])
        elif any(k in exp_sem_clean for k in ['2nd', '2', 'second']):
            sem_ok = any(k in found_sem_clean for k in ['2nd', '2', 'second'])
        elif any(k in exp_sem_clean for k in ['3rd', '3', 'third', 'summer', 'midyear']):
            sem_ok = any(k in found_sem_clean for k in ['3rd', '3', 'third', 'summer', 'midyear'])
        else:
            sem_ok = exp_sem_clean in found_sem_clean

        if not sem_ok:
            failures.append(f"Semester mismatch (Expected: '{expected_semester}', Found in Grades: '{found_sy_sem}')")

    # 5. COURSE MATCHING
    if expected_course and str(expected_course).strip():
        found_course = parsed_fields.get('course', raw_text)
        c_exp = normalize_text(expected_course)
        c_found = normalize_text(found_course)

        exp_words = [w for w in c_exp.split() if w not in {'bachelor', 'of', 'science', 'in', 'and', 'the', 'bs', 'degree'}]
        course_ok = (c_exp in c_found) or (all(w in c_found for w in exp_words) if exp_words else True)

        if not course_ok:
            failures.append(f"Course mismatch (Expected: '{expected_course}', Found in Grades: '{found_course}')")

    success = (len(failures) == 0)
    if success:
        msg = f"Grades Verified: Name ({first_name} {last_name}), ID ({expected_id_no or 'N/A'}), GPA ({parsed_fields.get('gpa', 'N/A')}) matched."
    else:
        msg = "Grades Verification Failed: " + "; ".join(failures)

    meta['name_ok'] = first_ok and last_ok
    meta['details'] = failures
    meta['detected_text'] = raw_text

    return success, msg, meta

def verify_indigency_fields(raw_text, first_name, middle_name, last_name, expected_address=None, **kwargs):
    """
    Flexible verification for Indigency certificates (which vary widely in format by barangay/municipality).
    Verifies student name and barangay/town address keywords without requiring rigid template structures.
    """
    meta = {}
    failures = []

    first_clean = normalize_text(first_name)
    last_clean = normalize_text(last_name)
    doc_norm = normalize_text(raw_text)

    first_words = [w for w in first_clean.split() if len(w) >= 2]
    last_words = [w for w in last_clean.split() if len(w) >= 2]

    first_ok = all(re.search(rf'\b{re.escape(w)}\b', doc_norm) for w in first_words) if first_words else True
    last_ok = all(re.search(rf'\b{re.escape(w)}\b', doc_norm) for w in last_words) if last_words else True

    if not (first_ok and last_ok):
        failures.append(f"Name mismatch (Expected: '{first_name} {last_name}' in Indigency Certificate)")

    addr_ok = True
    if expected_address and str(expected_address).strip():
        addr_clean = normalize_text(expected_address)
        ignore_words = {'city', 'municipality', 'town', 'province', 'brgy', 'barangay'}
        addr_words = [w for w in addr_clean.split() if len(w) >= 3 and w not in ignore_words]
        if addr_words:
            addr_ok = any(w in doc_norm for w in addr_words)
            if not addr_ok:
                failures.append(f"Address/Barangay mismatch (Expected: '{expected_address}' in Indigency Certificate)")

    success = first_ok and last_ok and addr_ok
    if success:
        msg = f"Indigency Certificate Verified: Name ({first_name} {last_name}) matched."
    else:
        msg = "Indigency Verification Failed: " + "; ".join(failures)

    meta['name_ok'] = first_ok and last_ok
    meta['details'] = failures
    meta['detected_text'] = raw_text

    return success, msg, meta

def verify_id_with_ocr(image_bytes, first_name, middle_name, last_name, **kwargs):
    """
    ID OCR verification wrapper.
    """
    success, msg, raw_text, meta = verify_document_with_ocr(image_bytes, 'ID', first_name, middle_name, last_name, **kwargs)
    return success, msg, raw_text, 1.0 if success else 0.0