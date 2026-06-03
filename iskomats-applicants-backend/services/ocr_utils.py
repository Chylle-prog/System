import os
import sys
import gc
import base64
import time
import cv2
import numpy as np
import threading
import shutil
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
_FACE_MATCH_THRESHOLD = 0.42 
_FACE_DETECTION_THRESHOLD = 0.40 
_MAX_FACE_WIDTH = 400

def decode_base64(data):
    """Safely decode base64 strings/URIs to bytes."""
    if isinstance(data, str):
        if ',' in data:
            data = data.split(',')[1]
        return base64.b64decode(data)
    return data

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
    """Select the highest-confidence face above threshold."""
    if not faces:
        raise ValueError(f"No face detected in {image_label}. Please look directly at the camera.")

    valid_faces = [face for face in faces if getattr(face, 'confidence', 0.0) >= _FACE_DETECTION_THRESHOLD]
    
    if not valid_faces:
        raise ValueError(f"No reliable face detected in {image_label}. Ensure your face is clearly visible.")

    best_face = max(valid_faces, key=lambda face: getattr(face, 'confidence', 0.0))
    
    if min_area_pct > 0 and hasattr(best_face, 'bbox'):
        x1, y1, x2, y2 = best_face.bbox
        area = (x2 - x1) * (y2 - y1)
        total_area = 512 * 512 
        pct = (area / total_area) * 100
        
        if pct < min_area_pct:
            raise ValueError(f"Face is too far or too small in {image_label}. Please move closer to the camera.")

    return best_face

def verify_face_with_id(user_photo_bytes, id_photo_bytes):
    """Verify a live/selfie photo against the face in the uploaded ID image."""
    try:
        detector, recognizer = _init_face_models()

        user_image = _decode_face_image(user_photo_bytes)
        id_image = _decode_face_image(id_photo_bytes)

        user_faces = detector.detect(user_image)
        user_face = _pick_primary_face(user_faces, 'the live photo', min_area_pct=3.0)
        
        id_faces = detector.detect(id_image)
        id_face = _pick_primary_face(id_faces, 'the ID image')

        user_embedding = recognizer.get_normalized_embedding(user_image, user_face.landmarks)
        id_embedding = recognizer.get_normalized_embedding(id_image, id_face.landmarks)

        if hasattr(user_face, 'landmarks') and len(user_face.landmarks) >= 5:
            lm = user_face.landmarks
            mouth_width = np.linalg.norm(lm[3] - lm[4])
            mouth_center = (lm[3] + lm[4]) / 2
            nose_to_mouth = np.linalg.norm(lm[2] - mouth_center)
            
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

    lane_y0, lane_y1 = int(height * 0.18), int(height * 0.48)
    lane_x0, lane_x1 = int(width * 0.05), int(width * 0.95)
    roi_gray = gray[lane_y0:lane_y1, lane_x0:lane_x1].copy()
    
    # We erased pytesseract label erasure to fully isolate signature extraction without any server-side Tesseract dependency.
    # Handwriting ink components will naturally be isolated by aspect and solidity.

    print(f"[SIGNATURE] Extracted ROI from ID Back: shape={roi_gray.shape}", flush=True)
    
    norm = cv2.normalize(roi_gray, None, 0, 255, cv2.NORM_MINMAX)
    smooth = cv2.bilateralFilter(norm, 9, 75, 75)
    
    binary = cv2.adaptiveThreshold(
        smooth, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, 31, 7
    )
    
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates = []
    h_idx, w_idx = binary.shape[:2]
    
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        
        if x < 8 or (x+w) > w_idx-8: continue
        if y < 4 or (y+h) > h_idx-4: continue
        
        area = cv2.contourArea(cnt)
        if area < 50: continue
        
        solidity = area / float(w * h) if w * h > 0 else 0
        aspect = w / float(h) if h > 0 else 0
        extent = area / float(w_idx * h_idx)
        
        if aspect > 3.0 and h < 20: 
            continue
        
        peri = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
        if 4 <= len(approx) <= 6 and solidity > 0.5:
             continue
             
        if 0.6 < aspect < 1.6 and solidity > 0.40:
            continue
            
        if (extent > 0.10 or w > w_idx * 0.35) and solidity > 0.45: continue
            
        complexity = cv2.arcLength(cnt, True)
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
        
    candidates.sort(key=lambda c: c['hw_score'], reverse=True)
    
    signature_lane = [c for c in candidates if h_idx * 0.10 < c['y_mid'] < h_idx * 0.60]
    anchor = signature_lane[0] if signature_lane else candidates[0]
    
    final_parts = []
    for c in candidates:
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
    """
    try:
        from .signature_brain import calculate_neural_match, compare_signature_images, prepare_signature_match_view
        
        if not signature_bytes or not id_back_bytes:
            return False, "Missing signature or ID image", 0.0, None, None
        
        try:
            sig_img = _decode_cv_image(signature_bytes, white_background=True)
        except Exception as e:
            print(f"[SIGNATURE] Error decoding signature: {e}", flush=True)
            return False, "Invalid signature format", 0.0, None, None
        
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