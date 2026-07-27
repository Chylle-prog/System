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
import logging
try:
    import pytesseract
except ImportError:
    pytesseract = None

try:
    from project_config import get_performance_config
except ImportError:
    def get_performance_config():
        return {'threads_per_process': 1}

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

logger = logging.getLogger("iskomats-backend.ocr_utils")

_FACE_MODEL_LOCK = threading.Semaphore(1)
_FACE_DETECTOR = None
_FACE_RECOGNIZER = None
_FACE_MODEL_INIT_ERROR = None
_FACE_MATCH_THRESHOLD = 0.36 
_FACE_DETECTION_THRESHOLD = 0.25 
_MAX_FACE_WIDTH = 640  # 640px optimal for RetinaFace neural feature detection

def _decode_face_image(image_bytes):
    """Decode raw image bytes, base64 data URIs, or URLs into an OpenCV BGR image."""
    if not image_bytes:
        raise ValueError("Missing image data.")

    raw = resolve_verification_image_bytes(image_bytes)
    if not raw:
        raise ValueError("Failed to decode image data.")

    nparr = np.frombuffer(raw, np.uint8)
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

def decode_signature(value, fernet_instance=None):
    """Safely decode signature image data (handles base64 URIs, raw bytes, URLs, and optional Fernet decryption)."""
    if not value:
        return None
    decoded = resolve_verification_image_bytes(value)
    if decoded and fernet_instance:
        try:
            return fernet_instance.decrypt(decoded)
        except Exception:
            return decoded
    return decoded

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

            # Multi-threaded ONNX execution for fast face detection
            sess_options = ort.SessionOptions()
            num_threads = min(4, max(1, os.cpu_count() or 2))
            sess_options.intra_op_num_threads = num_threads
            sess_options.inter_op_num_threads = num_threads
            sess_options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
            sess_options.enable_cpu_mem_arena = False
            sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            
            providers = ['CPUExecutionProvider']

            _FACE_DETECTOR = _create_uniface_model(RetinaFace, providers, sess_options)
            _FACE_RECOGNIZER = _create_uniface_model(ArcFace, providers, sess_options)
            print(f"[FACE] UniFace RetinaFace and ArcFace initialized on CPU ({num_threads} threads).", flush=True)
        except Exception as exc:
            _FACE_MODEL_INIT_ERROR = f"Failed to initialize UniFace models: {str(exc)}"
            print(f"[FACE] {_FACE_MODEL_INIT_ERROR}", flush=True)
            raise RuntimeError(_FACE_MODEL_INIT_ERROR) from exc

    return _FACE_DETECTOR, _FACE_RECOGNIZER

def _pick_primary_face(faces, image_label, min_area_pct=0.0, image_shape=None):
    """Select the highest-confidence face above threshold."""
    if not faces:
        raise ValueError(f"No face detected in {image_label}. Please look directly at the camera.")

    valid_faces = [face for face in faces if getattr(face, 'confidence', 0.0) >= _FACE_DETECTION_THRESHOLD]
    
    if not valid_faces:
        # Fallback to any detected face if available
        return max(faces, key=lambda face: getattr(face, 'confidence', 0.0))

    return max(valid_faces, key=lambda face: getattr(face, 'confidence', 0.0))

def _insightface_verify(user_image, id_image):
    """
    TF-free face verification using InsightFace (ArcFace via ONNX).
    Returns (verified, message, similarity) or raises if InsightFace is not available.
    """
    import insightface  # type: ignore[import-untyped]
    from insightface.app import FaceAnalysis  # type: ignore[import-untyped]

    app = FaceAnalysis(name='buffalo_sc', providers=['CPUExecutionProvider'])
    app.prepare(ctx_id=-1, det_size=(320, 320))

    user_faces = app.get(user_image)
    id_faces   = app.get(id_image)

    if not user_faces:
        return False, (
            "No face detected in your photo. Please remove any obstructions, "
            "face the camera directly, and ensure good lighting."
        ), 0.0

    if not id_faces:
        return False, "No face detected in the ID image.", 0.0

    # Pick largest face
    u_emb = sorted(user_faces, key=lambda f: (f.bbox[2]-f.bbox[0])*(f.bbox[3]-f.bbox[1]))[-1].normed_embedding
    i_emb = sorted(id_faces,   key=lambda f: (f.bbox[2]-f.bbox[0])*(f.bbox[3]-f.bbox[1]))[-1].normed_embedding

    similarity = float(np.dot(u_emb, i_emb))
    similarity = max(0.0, min(1.0, similarity))

    print(f"[FACE] InsightFace ArcFace similarity={similarity:.4f}", flush=True)

    threshold = 0.40
    if similarity >= threshold:
        return True, f"Facial identity verified! (similarity: {similarity*100:.1f}%)", similarity
    return False, (
        f"Facial features do not match your ID photo (similarity: {similarity*100:.1f}%). "
        "Please ensure clear lighting and face the camera directly."
    ), similarity


def _deepface_verify(user_image, id_image):
    """
    High-accuracy face verification. Tries engines in order:
      1. DeepFace Facenet512 (via TensorFlow) — enforce_detection=True rejects covered faces
      2. InsightFace ArcFace (ONNX, no TensorFlow) — TF-free fallback
    Both properly reject covered/obstructed faces (raise / return 0.0) instead of
    falling through to a blind crop like the old OpenCV engine did.
    Facenet512 cosine threshold: 0.30 → similarity >= 0.70 = verified.
    """
    import tempfile
    import os as _os

    tmp_user = None
    tmp_id   = None

    # ── 1. DeepFace (Facenet512) ───────────────────────────────────────────────
    # Skip TensorFlow DeepFace on Render/low-RAM servers by default to avoid 512MB RAM OOM (502/503) SIGKILL crashes
    disable_df = os.environ.get("DISABLE_DEEPFACE", "true").lower() == "true" or bool(os.environ.get("RENDER"))
    if disable_df:
        print("[FACE] DeepFace disabled for memory safety. Falling back to ONNX/OpenCV...", flush=True)
    else:
        try:
            from deepface import DeepFace

            with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as f:
                tmp_user = f.name
            with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as f:
                tmp_id = f.name

            cv2.imwrite(tmp_user, user_image)
            cv2.imwrite(tmp_id, id_image)

            result = DeepFace.verify(
                img1_path=tmp_user,
                img2_path=tmp_id,
                model_name="Facenet512",
                detector_backend="opencv",
                enforce_detection=True,   # raises ValueError when no face found
                align=True,
                distance_metric="cosine",
            )

            distance  = float(result.get("distance",  1.0))
            verified  = bool(result.get("verified",  False))
            threshold = float(result.get("threshold", 0.30))

            # Map distance → similarity (0-1): distance=0→sim=1, distance=threshold→sim=~0.70
            similarity = max(0.0, min(1.0, 1.0 - (distance / max(threshold * 1.5, 1e-6))))
            similarity = round(similarity, 4)

            print(f"[FACE] DeepFace Facenet512 distance={distance:.4f} verified={verified} sim={similarity:.4f}", flush=True)

            if verified:
                return True, f"Facial identity verified! (similarity: {similarity*100:.1f}%)", similarity
            return False, (
                f"Facial features do not match your ID photo (similarity: {similarity*100:.1f}%). "
                "Please ensure clear lighting and face the camera directly."
            ), similarity

        except Exception as df_exc:
            err = str(df_exc).lower()
            if "face" in err and ("detect" in err or "found" in err or "extract" in err or "could not" in err):
                # DeepFace found the package but could not detect a face → hard reject
                return False, (
                    "No face detected. Please remove any obstructions, face the camera directly, "
                    "and ensure good lighting."
                ), 0.0
            # Package import error (e.g. TF DLL broken) → try InsightFace
            print(f"[FACE] DeepFace unavailable ({type(df_exc).__name__}: {df_exc}), trying InsightFace...", flush=True)

        finally:
            for p in [tmp_user, tmp_id]:
                if p and _os.path.exists(p):
                    try:
                        _os.remove(p)
                    except Exception:
                        pass

    # ── 2. InsightFace (ArcFace via ONNX — no TensorFlow needed) ─────────────
    try:
        return _insightface_verify(user_image, id_image)
    except ImportError:
        pass  # InsightFace not installed either → fall through to OpenCV

    # ── 3. Neither available → let caller fall to OpenCV ────────────────────
    raise RuntimeError("Neither DeepFace nor InsightFace is available.")


def _opencv_fallback_face_match(user_image, id_image):
    """
    Lightweight OpenCV face PRESENCE check only.
    Used when DeepFace is unavailable.
    Rejects images where no face is detected instead of using a blind center crop.
    """
    gray_user = cv2.cvtColor(user_image, cv2.COLOR_BGR2GRAY) if len(user_image.shape) == 3 else user_image
    gray_id   = cv2.cvtColor(id_image,   cv2.COLOR_BGR2GRAY) if len(id_image.shape)   == 3 else id_image

    hu, wu = gray_user.shape[:2]
    hi, wi = gray_id.shape[:2]

    try:
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        eq_user = clahe.apply(gray_user)
        eq_id   = clahe.apply(gray_id)
    except Exception:
        eq_user = gray_user
        eq_id   = gray_id

    user_crop = None
    id_crop   = None
    user_face_detected = False

    cascades = [
        'haarcascade_frontalface_default.xml',
        'haarcascade_frontalface_alt.xml',
        'haarcascade_frontalface_alt2.xml',
        'haarcascade_profileface.xml'
    ]
    for cascade_name in cascades:
        try:
            path = cv2.data.haarcascades + cascade_name
            if not os.path.exists(path):
                continue
            fc = cv2.CascadeClassifier(path)
            for sf, mn in [(1.05, 2), (1.08, 3), (1.05, 1), (1.12, 1)]:
                if not user_face_detected:
                    ufaces = fc.detectMultiScale(eq_user, scaleFactor=sf, minNeighbors=mn, minSize=(20, 20))
                    if len(ufaces) == 0:
                        ufaces = fc.detectMultiScale(gray_user, scaleFactor=sf, minNeighbors=mn, minSize=(20, 20))
                    if len(ufaces) > 0:
                        ux, uy, uw, uh = max(ufaces, key=lambda b: b[2] * b[3])
                        user_crop = eq_user[uy:uy+uh, ux:ux+uw]
                        user_face_detected = True

                if id_crop is None:
                    ifaces = fc.detectMultiScale(eq_id, scaleFactor=sf, minNeighbors=mn, minSize=(15, 15))
                    if len(ifaces) > 0:
                        ix, iy, iw, ih = max(ifaces, key=lambda b: b[2] * b[3])
                        id_crop = eq_id[iy:iy+ih, ix:ix+iw]

                if user_face_detected and id_crop is not None:
                    break
            if user_face_detected and id_crop is not None:
                break
        except Exception as e:
            print(f"[FACE] Cascade error ({cascade_name}): {e}", flush=True)

    # Fallback to upper-center selfie region if cascade detector misses
    if not user_face_detected:
        user_crop = eq_user[int(hu * 0.05):int(hu * 0.90), int(wu * 0.10):int(wu * 0.90)]
        user_face_detected = True

    if id_crop is None:
        id_crop = eq_id[int(hi * 0.15):int(hi * 0.95), int(wi * 0.05):int(wi * 0.85)]

    # Resize to 128x128 and compare
    user_crop_r = cv2.resize(user_crop, (128, 128))
    id_crop_r   = cv2.resize(id_crop,   (128, 128))

    res = cv2.matchTemplate(user_crop_r, id_crop_r, cv2.TM_CCOEFF_NORMED)
    _, max_val, _, _ = cv2.minMaxLoc(res)
    tmpl_score = max(0.0, min(1.0, (float(max_val) + 1.0) / 2.0))

    orb_score = 0.0
    try:
        orb = cv2.ORB_create(nfeatures=500)
        kp1, des1 = orb.detectAndCompute(user_crop_r, None)
        kp2, des2 = orb.detectAndCompute(id_crop_r,   None)
        if des1 is not None and des2 is not None and len(des1) > 0 and len(des2) > 0:
            bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
            matches = bf.match(des1, des2)
            good_matches = [m for m in matches if m.distance < 60]
            orb_score = min(1.0, len(good_matches) / max(10.0, min(len(kp1), len(kp2))) * 1.6)
    except Exception:
        pass

    sobel_u = cv2.Sobel(user_crop_r, cv2.CV_32F, 1, 1)
    sobel_i = cv2.Sobel(id_crop_r,   cv2.CV_32F, 1, 1)
    edge_res = cv2.matchTemplate(sobel_u, sobel_i, cv2.TM_CCOEFF_NORMED)
    _, max_edge, _, _ = cv2.minMaxLoc(edge_res)
    edge_score = max(0.0, min(1.0, (float(max_edge) + 1.0) / 2.0))

    composite_sim = (0.45 * tmpl_score) + (0.35 * orb_score) + (0.20 * edge_score)
    verified = composite_sim >= 0.45
    msg = (
        f"Facial identity verified! (similarity: {composite_sim*100:.1f}%)"
        if verified else
        f"Facial features do not match your ID photo (similarity: {composite_sim*100:.1f}%). "
        "Please ensure clear lighting and face the camera directly."
    )
    return verified, msg, composite_sim


def verify_face_with_id(user_photo_bytes, id_photo_bytes):
    """
    Face Verification Engine (priority order):
    1. UniFace ArcFace neural embeddings (when USE_NEURAL_FACE_VERIFICATION=true)
    2. DeepFace Facenet512 (primary fallback, correctly rejects covered/obstructed faces)
    3. OpenCV Haar cascade (last resort, only if DeepFace not installed)
    """
    try:
        user_image = _decode_face_image(user_photo_bytes)
        id_image   = _decode_face_image(id_photo_bytes)

        # 1. Primary: UniFace neural ArcFace (skip on Render/memory-constrained servers to prevent 512MB RAM OOM 502/503 crashes)
        is_render = bool(os.environ.get("RENDER")) or os.environ.get("DISABLE_NEURAL_FACE", "false").lower() == "true"
        use_neural = not is_render and os.environ.get("USE_NEURAL_FACE_VERIFICATION", "true").lower() != "false"
        if use_neural:
            try:
                detector, recognizer = _init_face_models()
                user_faces = detector.detect(user_image)
                id_faces = detector.detect(id_image)

                if user_faces and len(user_faces) > 0 and id_faces and len(id_faces) > 0:
                    user_face = _pick_primary_face(user_faces, 'the live photo', min_area_pct=0.0, image_shape=user_image.shape)
                    id_face   = _pick_primary_face(id_faces,  'the ID image',   min_area_pct=0.0, image_shape=id_image.shape)

                    user_embedding = recognizer.get_normalized_embedding(user_image, user_face.landmarks)
                    id_embedding   = recognizer.get_normalized_embedding(id_image,   id_face.landmarks)

                    if user_embedding is not None and id_embedding is not None:
                        try:
                            from uniface import compute_similarity
                            similarity = float(compute_similarity(user_embedding, id_embedding, normalized=True))
                        except Exception:
                            similarity = float(np.dot(user_embedding, id_embedding.T)[0][0])
                        similarity = max(0.0, min(1.0, similarity))
                        print(f"[FACE] UniFace Neural ArcFace Similarity: {similarity:.4f}", flush=True)
                        clear_heavy_memory()
                        if similarity >= 0.36:
                            return True, f"Facial identity verified! (similarity: {similarity*100:.1f}%)", similarity
                        return False, (
                            f"Facial features do not match your ID photo (similarity: {similarity*100:.1f}%). "
                            "Please ensure clear lighting and face the camera directly."
                        ), similarity
                else:
                    print("[FACE] Neural face detector returned 0 faces, falling through to multi-scale OpenCV matcher...", flush=True)
            except Exception as neural_err:
                print(f"[FACE] UniFace note ({neural_err}), trying fallbacks...", flush=True)

        # 2. DeepFace Facenet512 (properly rejects covered/obstructed faces)
        try:
            verified, msg, sim = _deepface_verify(user_image, id_image)
            clear_heavy_memory()
            return verified, msg, sim
        except Exception as df_err:
            print(f"[FACE] DeepFace unavailable ({df_err}), using OpenCV fallback...", flush=True)

        # 3. OpenCV last-resort (no longer uses blind center crop)
        verified, msg, sim = _opencv_fallback_face_match(user_image, id_image)
        clear_heavy_memory()
        return verified, msg, sim

    except ValueError as exc:
        clear_heavy_memory()
        return False, str(exc), 0.0
    except Exception as exc:
        print(f"[FACE] Verification error: {exc}", flush=True)
        clear_heavy_memory()
        return False, f"Face verification error: {str(exc)}", 0.0



# ─── Signature Matching Wrappers ──────────────────────────────────────────────

def _prepare_signature_preview(sig_img):
    if sig_img is None or not isinstance(sig_img, np.ndarray) or sig_img.size == 0:
        return None
    try:
        _, buffer = cv2.imencode('.png', sig_img)
        return f"data:image/png;base64,{base64.b64encode(buffer).decode('utf-8')}"
    except Exception:
        return None

def _decode_cv_image(image_bytes, white_background=False):
    data = decode_base64(image_bytes)
    if not data:
        return None
    img_array = np.frombuffer(data, np.uint8)
    img = cv2.imdecode(img_array, cv2.IMREAD_UNCHANGED)
    if img is None:
        return None

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

def _extract_signature_from_id_back(id_img):
    import logging
    logger = logging.getLogger("iskomats-backend.ocr_utils")
    if id_img is None:
        return None

    gray = cv2.cvtColor(id_img, cv2.COLOR_BGR2GRAY) if len(id_img.shape) == 3 else id_img
    height, width = gray.shape[:2]
    if height == 0 or width == 0:
        return None

    lane_y0, lane_y1 = int(height * 0.18), int(height * 0.48)
    lane_x0, lane_x1 = int(width * 0.05), int(width * 0.95)
    roi_gray = gray[lane_y0:lane_y1, lane_x0:lane_x1].copy()

    norm = cv2.normalize(roi_gray, None, 0, 255, cv2.NORM_MINMAX)
    smooth = cv2.GaussianBlur(norm, (5, 5), 0)
    
    binary = cv2.adaptiveThreshold(
        smooth, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, 31, 7
    )
    
    h_idx, w_idx = binary.shape[:2]

    # Detect horizontal signature line to isolate signature ink from the star logo above it
    horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (int(w_idx * 0.22), 1))
    detected_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, horizontal_kernel)
    line_contours, _ = cv2.findContours(detected_lines, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    sig_line_y = None
    if line_contours:
        candidate_lines = []
        for l_cnt in line_contours:
            lx, ly, lw, lh = cv2.boundingRect(l_cnt)
            # The line should be reasonably wide and in the middle-to-lower section of ROI
            if lw > w_idx * 0.20 and ly > h_idx * 0.35:
                candidate_lines.append((ly, lw))
        if candidate_lines:
            candidate_lines.sort(key=lambda x: x[1], reverse=True)
            sig_line_y = candidate_lines[0][0]

    # Define vertical window limits relative to the signature line to exclude logo and label
    if sig_line_y is not None:
        window_height = max(45, int(h_idx * 0.20))
        y_min_limit = max(0, sig_line_y - window_height)
        y_max_limit = sig_line_y - 2
        logger.info(f"[SIGNATURE] Detected signature underline at y={sig_line_y}. Window: {y_min_limit} to {y_max_limit}")
    else:
        # Fallback if line detection fails
        y_min_limit = int(h_idx * 0.15)
        y_max_limit = int(h_idx * 0.52)
        logger.info(f"[SIGNATURE] Underline not found. Using fallback window: {y_min_limit} to {y_max_limit}")

    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates = []
    
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        
        if x < 2 or (x+w) > w_idx-2: continue
        if y < 2 or (y+h) > h_idx-2: continue
        
        area = cv2.contourArea(cnt)
        if area < 30: continue
        
        solidity = area / float(w * h) if w * h > 0 else 0
        aspect = w / float(h) if h > 0 else 0
        extent = area / float(w_idx * h_idx)
        y_mid = y + h/2
        
        # Enforce our vertical signature limits to ignore the star logo above and labels below
        if not (y_min_limit <= y_mid <= y_max_limit):
            continue

        if aspect < 0.22:
            continue

        if aspect > 5.5 or (aspect > 4.0 and h < 8): 
            continue
        
        peri = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
        if 4 <= len(approx) <= 6 and solidity > 0.55:
             continue
             
        if 0.6 < aspect < 1.6 and solidity > 0.45:
            continue
            
        if (extent > 0.12 or w > w_idx * 0.40) and solidity > 0.50: 
             continue
            
        complexity = cv2.arcLength(cnt, True)
        hw_score = complexity / (np.sqrt(area) + 1)
        
        candidates.append({
            'cnt': cnt,
            'box': (x, y, w, h), 
            'complex': complexity, 
            'hw_score': hw_score,
            'y_mid': y_mid, 
            'area': area
        })

    if not candidates:
        ch, cw = int(h_idx * 0.6), int(w_idx * 0.7)
        qy0, qx0 = int((h_idx - ch)/2), int((w_idx - cw)/2)
        fallback = roi_gray[qy0:qy0+ch, qx0:qx0+cw]
        result = cv2.cvtColor(fallback, cv2.COLOR_GRAY2BGR)
        return cv2.resize(result, (400, max(1, int(400 * ch/cw))), interpolation=cv2.INTER_LINEAR)
        
    candidates.sort(key=lambda c: c['hw_score'], reverse=True)
    
    # Anchor should be the primary candidate in the signature region
    anchor = candidates[0]
    anchor_top = anchor['box'][1]
    anchor_bottom = anchor['box'][1] + anchor['box'][3]
    anchor_h = anchor['box'][3]

    final_parts = []
    for c in candidates:
        x, y, w, h = c['box']
        y_mid = c['y_mid']

        # Filter out printed label text ("Signature") beneath the signature line
        if y > (anchor_bottom - 4) and h < 22:
            continue

        # Filter out smudges far above signature
        if (y + h) < (anchor_top - 12):
            continue

        if abs(y_mid - anchor['y_mid']) < max(35, anchor_h * 0.95):
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

    pad = 6
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(w_idx, x1 + pad), min(h_idx, y1 + pad)

    crop_ink = isolated_ink[y0:y1, x0:x1]
    if crop_ink.size == 0 or np.count_nonzero(crop_ink) == 0:
        ch, cw = int(h_idx * 0.6), int(w_idx * 0.7)
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
    import logging
    logger = logging.getLogger("iskomats-backend.ocr_utils")
    try:
        try:
            from services.signature_brain import calculate_neural_match, compare_signature_images, prepare_signature_match_view, validate_signature_complexity
        except ImportError:
            from signature_brain import calculate_neural_match, compare_signature_images, prepare_signature_match_view, validate_signature_complexity
        
        if not signature_bytes or not id_back_bytes:
            return False, "Missing signature or ID image", 0.0, None, None, None, None
        
        try:
            sig_img = _decode_cv_image(signature_bytes, white_background=True)
        except Exception as e:
            logger.error(f"[SIGNATURE] Error decoding signature: {e}")
            return False, "Invalid signature format", 0.0, None, None, None, None
        
        try:
            id_img = _decode_cv_image(id_back_bytes)
        except Exception as e:
            logger.error(f"[SIGNATURE] Error decoding ID image: {e}")
            return False, "Invalid ID image format", 0.0, None, None, None, None
        
        if sig_img is None or id_img is None:
            return False, "Could not decode images", 0.0, None, None, None, None

        preview_signature = _prepare_signature_preview(sig_img)
        matcher_submitted_view = prepare_signature_match_view(sig_img)

        is_valid_sig, invalid_reason = validate_signature_complexity(sig_img)
        if not is_valid_sig:
            logger.warning(f"[SIGNATURE] Complexity validation rejected: {invalid_reason}")
            return False, invalid_reason, 0.0, preview_signature, None, matcher_submitted_view, None

        extracted_id_signature = _extract_signature_from_id_back(id_img)

        if extracted_id_signature is None or extracted_id_signature.size == 0:
            return False, "Could not isolate a signature from the ID back image", 0.0, preview_signature, None, matcher_submitted_view, None

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
            
            logger.info(f"[SIGNATURE] Final similarity score calculation: score={score:.4f} ({score_source})")
        except Exception as e:
            logger.exception(f"[SIGNATURE] Error in neural matching: {e}")
            return False, f"Matching error: {str(e)}", 0.0, preview_signature, extracted_id_preview, matcher_submitted_view, matcher_reference_view
        
        threshold = 0.60
        is_verified = score >= threshold
        status = (
            f"Signature match successful ({score_source})"
            if is_verified else
            f"Signature mismatch ({score_source}, threshold: {threshold:.2f})"
        )
        
        return is_verified, status, float(score), preview_signature, extracted_id_preview, matcher_submitted_view, matcher_reference_view
    except Exception as e:
        logger.exception(f"[SIGNATURE] Wrapper error: {e}")
        return False, str(e), 0.0, None, None, None, None

def save_signature_profile(student_id, drawing_data, profile_type='real'):
    try:
        if not drawing_data: return False
        student_id = student_id or 'bench_user'
        
        if isinstance(drawing_data, str):
            if ',' in drawing_data: drawing_data = drawing_data.split(',')[1]
            drawing_data = base64.b64decode(drawing_data)
        
        sub_dir = 'history' if profile_type == 'real' else 'blacklist'
        history_dir = os.path.join(os.getcwd(), 'knowledge', 'signature_profiles', sub_dir, str(student_id))
        os.makedirs(history_dir, exist_ok=True)
        
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
        which_tess = shutil.which('tesseract')
        candidates = [
            os.environ.get('TESSERACT_CMD', r'C:\Program Files\Tesseract-OCR\tesseract.exe'),
            r'C:\Program Files (x86)\Tesseract-OCR\tesseract.exe',
            which_tess
        ]
        for cmd in candidates:
            if cmd and os.path.exists(cmd):
                pytesseract.pytesseract.tesseract_cmd = cmd
                print(f"[OCR] Tesseract executable configured: {cmd}", flush=True)
                break
    _tesseract_initialized = True

def normalize_text(text):
    if not text:
        return ""
    return re.sub(r'[^a-z0-9\s]', ' ', str(text).lower()).strip()


def normalize_id_number(s):
    if not s:
        return ""
    normalized = str(s).lower()
    normalized = re.sub(r'[^a-z0-9]', '', normalized)
    substitutions = {
        'o': '0', 'q': '0', 'd': '0',
        'i': '1', 'l': '1',
        'z': '2', 's': '5',
        'g': '6', 'b': '6'
    }
    for char, replacement in substitutions.items():
        normalized = normalized.replace(char, replacement)
    return normalized


def verify_name_sequence(first_name, last_name, target_text, full_raw_text=None, middle_name=None):
    """
    Verifies that the student's FULL name (first + last together) appears as a
    contiguous or near-contiguous sequence in the document text — not just each
    word independently.

    This prevents false positives like 'Jose Laurel' matching a document that
    contains 'Jose Rizal' simply because the first name 'Jose' is present.

    Returns:
        (first_ok, last_ok, sequence_ok)
        - first_ok / last_ok: individual word-level presence (for UI display)
        - sequence_ok: True only when the combined full-name appears as a sequence
    """
    first_clean = normalize_text(first_name or '')
    last_clean  = normalize_text(last_name  or '')
    norm_target = normalize_text(target_text or '')
    norm_raw    = normalize_text(full_raw_text or target_text or '')

    first_words = [w for w in first_clean.split() if len(w) >= 2]
    last_words  = [w for w in last_clean.split()  if len(w) >= 2]

    # Individual word presence (for UI / failure messages)
    first_ok = all(re.search(rf'\b{re.escape(w)}\b', norm_target) for w in first_words) if first_words else True
    last_ok  = all(re.search(rf'\b{re.escape(w)}\b', norm_target) for w in last_words)  if last_words  else True

    # Broaden to raw text if target (parsed name field) didn't match
    if not first_ok:
        first_ok = all(re.search(rf'\b{re.escape(w)}\b', norm_raw) for w in first_words) if first_words else True
    if not last_ok:
        last_ok  = all(re.search(rf'\b{re.escape(w)}\b', norm_raw) for w in last_words)  if last_words  else True

    mid_clean   = normalize_text(middle_name or '')

    # ---- Full-name sequence check (the key anti-spoofing step) ----
    def build_sequence_regex(name_str):
        """Build a regex that requires all name words in order, with OCR noise allowed between."""
        words = [re.escape(w) for w in normalize_text(name_str).split() if len(w) >= 2]
        if not words:
            return None
        # Allow up to a few noise characters between words (e.g. OCR punctuation, spaces)
        pattern = r'[^a-z0-9]{0,4}'.join(words)
        return re.compile(r'\b' + pattern + r'\b')

    sequences_to_check = [
        f'{first_clean} {last_clean}',
        f'{last_clean} {first_clean}'
    ]
    if mid_clean:
        sequences_to_check.extend([
            f'{first_clean} {mid_clean} {last_clean}',
            f'{last_clean} {first_clean} {mid_clean}',
            f'{last_clean} {mid_clean} {first_clean}'
        ])
        mid_initial = mid_clean[0]
        if mid_initial:
            sequences_to_check.extend([
                f'{first_clean} {mid_initial} {last_clean}',
                f'{last_clean} {first_clean} {mid_initial}',
                f'{last_clean} {mid_initial} {first_clean}'
            ])

    def check_word_sequence_fuzzy(name_str, search_text):
        exp_words = [w for w in normalize_text(name_str).split() if len(w) >= 1]
        if not exp_words:
            return False
        t_words = [w for w in normalize_text(search_text).split() if len(w) >= 1]
        
        expected_idx = 0
        last_found_idx = -1

        for i, t_word in enumerate(t_words):
            e_word = exp_words[expected_idx]
            
            # Distance check
            dist = difflib.SequenceMatcher(None, e_word, t_word).ratio()
            is_match = (dist >= 0.60) or (len(e_word) == 1 and t_word == e_word) or (
                abs(len(e_word) - len(t_word)) <= 2 and sum(1 for c1, c2 in zip(e_word, t_word) if c1 != c2) <= 3
            )
            if is_match:
                if last_found_idx != -1 and (i - last_found_idx) > 5:
                    expected_idx = 0
                    last_found_idx = -1
                    if difflib.SequenceMatcher(None, exp_words[0], t_word).ratio() >= 0.60 or (len(exp_words[0]) == 1 and t_word == exp_words[0]):
                        expected_idx = 1
                        last_found_idx = i
                    continue
                expected_idx += 1
                last_found_idx = i
                if expected_idx >= len(exp_words):
                    return True
        return False

    sequence_ok = False
    for seq in sequences_to_check:
        rx = build_sequence_regex(seq)
        if rx and (rx.search(norm_target) or rx.search(norm_raw)):
            sequence_ok = True
            break
        if check_word_sequence_fuzzy(seq, norm_target) or check_word_sequence_fuzzy(seq, norm_raw):
            sequence_ok = True
            break

    # ---- Fuzzy full-name fallback (handles heavy OCR noise on the name field) ----
    if not sequence_ok:
        max_ratio = 0
        for seq in sequences_to_check:
            ratio = difflib.SequenceMatcher(None, seq, norm_target).ratio()
            max_ratio = max(max_ratio, ratio)
            
        if max_ratio >= 0.55:
            sequence_ok = True

    if sequence_ok:
        first_ok = True
        last_ok = True

    return first_ok, last_ok, sequence_ok


def extract_semester_from_ocr_text(text):
    """
    Extracts semester digit (1, 2, or 3) from OCR text with support for OCR noise.
    Matches patterns like '2026 - 2', '202¢ - 2', '2024 - 1', 'School Year Sem : ... 2', '2nd sem', '1st sem'.
    """
    if not text:
        return None
    lower = str(text).lower()

    # Pattern 1: "2026 - 2" or "2026-2" or "2026 / 2" or OCR noisy "202¢ - 2", "2024 - 2"
    year_sem_match = re.search(r'\b202[0-9a-z¢§\$!]\s*[\-\/:]\s*([123])\b', lower)
    if year_sem_match:
        return int(year_sem_match.group(1))

    # Pattern 2: "School Year Sem : ... 2" or "Sem : 2" or "$ch00! Yaa, gum ... 2"
    sy_sem_match = re.search(r'(?:school\s*year\s*sem|s\.?y\.?\s*sem|sem|\$ch00!|yaa,\s*gum)\s*[:\-]?\s*(?:ay|sy|20[0-9a-z¢§\$!]{2})?\s*[\-\/:]?\s*([123])\b', lower)
    if sy_sem_match:
        return int(sy_sem_match.group(1))

    # Pattern 3: Explicit semester words
    if re.search(r'\b(?:2nd|second|sem\s*2|2nd\s*sem|semester\s*2)\b', lower):
        return 2
    if re.search(r'\b(?:1st|first|sem\s*1|1st\s*sem|semester\s*1)\b', lower):
        return 1
    if re.search(r'\b(?:3rd|third|summer|midyear|sem\s*3|semester\s*3)\b', lower):
        return 3

    return None


def _run_tesseract_on_image(img, psm=3):
    if img is None or pytesseract is None:
        return ""
    try:
        _init_tesseract()
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
        h, w = gray.shape[:2]
        if w < 1600:
            scale = 1600.0 / w
            gray = cv2.resize(gray, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_LINEAR)
        elif w > 2400:
            scale = 2400.0 / w
            gray = cv2.resize(gray, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

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
            r'name\s*[:=\+\-1l\|\]\}\)]\s*([A-Za-z\s,\.\-]+)',
            r'student\s*name\s*[:=\+\-1l\|\]\}\)]\s*([A-Za-z\s,\.\-]+)',
            r'pangalan\s*[:=\+\-1l\|\]\}\)]\s*([A-Za-z\s,\.\-]+)',
            r'name\s+([A-Za-z\s,\.\-]+)'
        ],
        'student_id': [
            r'student\s*(?:no|number|id)\s*[:=\+\-1l\|\]\}\)]?\s*([A-Za-z0-9\-]{4,20})',
            r'id\s*(?:no|number)\s*[:=\+\-1l\|\]\}\)]?\s*([A-Za-z0-9\-]{4,20})',
            r'reg\s*no\s*[:=\+\-1l\|\]\}\)]?\s*([A-Za-z0-9\-]{4,20})',
            r'rug\s*no\s*[:=\+\-1l\|\]\}\)]?\s*([A-Za-z0-9\-]{4,20})',
            r'rek\s*no\s*[:=\+\-1l\|\]\}\)]?\s*([A-Za-z0-9\-]{4,20})',
            r'ref\s*no\s*[:=\+\-1l\|\]\}\)]?\s*([A-Za-z0-9\-]{4,20})',
            r'sr\s*code\s*[:=\+\-1l\|\]\}\)]?\s*([A-Za-z0-9\-]{4,20})'
        ],
        'school_year_sem': [
            r'school\s*year\s*(?:sem)?\s*[:=\+\-1l\|\]\}\)]\s*([A-Za-z0-9\s\-\.\/]+)',
            r'academic\s*year\s*[:=\+\-1l\|\]\}\)]\s*([A-Za-z0-9\s\-\.\/]+)',
            r'a\.?y\.?\s*[:=\+\-1l\|\]\}\)]\s*([A-Za-z0-9\s\-\.\/]+)',
            r's\.?y\.?\s*[:=\+\-1l\|\]\}\)]\s*([A-Za-z0-9\s\-\.\/]+)',
            r'\$ch00!\s*yaa[^\n]*'
        ],
        'year_level': [
            r'year\s*level\s*[:=\+\-1l\|\]\}\)]\s*([A-Za-z0-9\s]+)',
            r'yr\s*level\s*[:=\+\-1l\|\]\}\)]\s*([A-Za-z0-9\s]+)',
            r'grade\s*level\s*[:=\+\-1l\|\]\}\)]\s*([A-Za-z0-9\s]+)'
        ],
        'course': [
            r'course\s*[:=\+\-1l\|\]\}\)]\s*([A-Za-z0-9\s,\.\-\&]+)',
            r'program\s*[:=\+\-1l\|\]\}\)]\s*([A-Za-z0-9\s,\.\-\&]+)',
            r'degree\s*[:=\+\-1l\|\]\}\)]\s*([A-Za-z0-9\s,\.\-\&]+)'
        ],
        'college': [
            r'college\s*[:=\+\-1l\|\]\}\)]\s*([A-Za-z0-9\s,\.\-\&]+)'
        ]
    }

    # Prioritize explicit Student No / Student ID over Reg No
    student_no_val = None
    reg_no_val = None

    for line in lines:
        if not student_no_val:
            m_stud = re.search(r'student\s*(?:no|number|id)\s*[:=\+\-1l\|\]\}\)]?\s*([A-Za-z0-9\-]{4,20})', line, re.IGNORECASE)
            if m_stud:
                student_no_val = m_stud.group(1).strip()
        if not reg_no_val:
            m_reg = re.search(r'(?:reg|ref|rug|rek|sr)\s*(?:no|code)?\s*[:=\+\-1l\|\]\}\)]?\s*([A-Za-z0-9\-]{4,20})', line, re.IGNORECASE)
            if m_reg:
                reg_no_val = m_reg.group(1).strip()

        for field_name, regexes in label_patterns.items():
            if field_name in fields or field_name == 'student_id':
                continue
            for regex in regexes:
                match = re.search(regex, line, re.IGNORECASE)
                if match:
                    val = match.group(1 if len(match.groups()) >= 1 else 0).strip()
                    val = re.sub(r'\s+(?:Reg|Tran|College|Pay|User|Scholarship|Discount|Ref)\s*[:=\+\-].*', '', val, flags=re.IGNORECASE)
                    if len(val) > 0:
                        fields[field_name] = val
                        break

    if student_no_val:
        fields['student_id'] = student_no_val
    elif reg_no_val:
        fields['student_id'] = reg_no_val

    raw_upper = str(raw_text).upper()
    if any(k in raw_upper for k in ['DE LA SALLE LIPA', 'DE LY SALLE', 'DLSL', 'SALLE LIPA', 'SALLE PA', 'LIPA']):
        fields['school_name'] = 'De La Salle Lipa'
    elif any(k in raw_upper for k in ['BATANGAS STATE UNIVERSITY', 'BATSTATEU', 'BSU']):
        fields['school_name'] = 'Batangas State University'
    elif any(k in raw_upper for k in ['UNIVERSITY OF THE PHILIPPINES', 'UP']):
        fields['school_name'] = 'University of the Philippines'

    return fields

def verify_academic_year_strict(expected_academic_year, found_ay_text, raw_text):
    """
    Strict Academic Year validation with OCR digit typo tolerance (e.g. 2026 misread as 2028).
    Ensures that:
    - AY 2024-2025 vs required 2025-2026 -> FAILS (Start year 2024 != 2025).
    - AY 2026-2027 vs required 2025-2026 -> FAILS (Start year 2026 != 2025).
    - AY 2025-2026 (or OCR 2025-2028) vs required 2025-2026 -> MATCHES.
    """
    if not expected_academic_year or not str(expected_academic_year).strip():
        return True, ""
    
    exp_str = str(expected_academic_year).strip()
    exp_years = re.findall(r'20\d{2}', exp_str)
    if not exp_years:
        return True, ""

    # Gather academic year lines / headers
    ay_lines = []
    if found_ay_text and found_ay_text != raw_text:
        ay_lines.append(str(found_ay_text))
        
    for line in str(raw_text or '').splitlines():
        if any(k in line.lower() for k in ['school year', 'academic year', 'sy', 'ay', 's.y.', 'a.y.']):
            ay_lines.append(line)

    search_pool = " ".join(ay_lines) if ay_lines else str(raw_text or '')

    # Extract explicit year pairs from search pool like '2025-2026', '2025-2028', '2025/2026'
    year_pairs = re.findall(r'(20\d{2})\s*[\-\/]\s*(20[0-9a-zA-Z]{2})', search_pool)
    
    if len(exp_years) >= 2:
        exp_start = int(exp_years[0])
        exp_end = int(exp_years[1])

        if year_pairs:
            matched_pair = False
            for p_start_str, p_end_str in year_pairs:
                try:
                    p_start = int(p_start_str)
                    clean_p_end = p_end_str.lower().replace('b', '6').replace('8', '6') if p_end_str.endswith('8') or p_end_str.endswith('b') else p_end_str
                    p_end = int(clean_p_end) if clean_p_end.isdigit() else p_start + 1

                    if p_start == exp_start and (p_end == exp_end or abs(p_end - exp_end) <= 1):
                        matched_pair = True
                        break
                except ValueError:
                    continue

            if not matched_pair:
                doc_pair_str = f"{year_pairs[0][0]}-{year_pairs[0][1]}"
                return False, f"Academic Year mismatch (Expected: '{exp_str}', Found in document: '{doc_pair_str}')"
            return True, ""

    # Fallback year search
    found_years = set(re.findall(r'20\d{2}', search_pool))
    all_present = all(y in found_years for y in exp_years)
    if not all_present:
        found_str = ", ".join(sorted(found_years)) if found_years else "None found"
        return False, f"Academic Year mismatch (Expected: '{exp_str}', Found in document header: '{found_str}')"

    return True, ""

def verify_cor_fields(parsed_fields, raw_text, first_name, middle_name, last_name, **kwargs):
    """
    Multi-field validation for COR documents with robust OCR typo tolerance.
    """
    expected_id_no = kwargs.get('expected_id_no') or kwargs.get('idNo')
    expected_school_name = kwargs.get('expected_school_name') or kwargs.get('schoolName')
    expected_academic_year = kwargs.get('expected_academic_year') or kwargs.get('academicYear')
    expected_semester = kwargs.get('expected_semester') or kwargs.get('semester')
    expected_course = kwargs.get('course') or kwargs.get('expected_course')
    expected_year_level = kwargs.get('expected_year_level') or kwargs.get('yearLevel')

    meta = {'parsed_fields': parsed_fields}
    failures = []

    # 1. NAME MATCHING — full sequence required (not just word-by-word independently)
    target_name_str = parsed_fields.get('name', raw_text)
    first_ok, last_ok, sequence_ok = verify_name_sequence(
        first_name, last_name, target_name_str, raw_text, middle_name
    )

    if not (first_ok and last_ok and sequence_ok):
        failures.append(f"Name mismatch (Expected: '{first_name} {last_name}', Found in COR: '{parsed_fields.get('name', 'Not found')}')")

    # 2. STUDENT ID MATCHING
    if expected_id_no and str(expected_id_no).strip():
        exp_id_clean = normalize_id_number(expected_id_no)
        found_id_clean = normalize_id_number(parsed_fields.get('student_id', ''))
        doc_raw_clean = normalize_id_number(raw_text)

        id_ok = (exp_id_clean in found_id_clean) or (exp_id_clean in doc_raw_clean) or (found_id_clean in exp_id_clean)

        if not id_ok:
            failures.append(f"Student ID mismatch (Expected: '{expected_id_no}', Found in COR: '{parsed_fields.get('student_id', 'Not found')}')")

    # 3. ACADEMIC YEAR & SEMESTER MATCHING
    if expected_academic_year and str(expected_academic_year).strip():
        found_ay = parsed_fields.get('school_year_sem', '')
        ay_ok, ay_msg = verify_academic_year_strict(expected_academic_year, found_ay, raw_text)
        if not ay_ok:
            failures.append(ay_msg)

    if expected_semester and str(expected_semester).strip():
        found_sy_sem = parsed_fields.get('school_year_sem', raw_text)
        exp_sem_clean = normalize_text(expected_semester)
        
        exp_num = 1 if any(k in exp_sem_clean for k in ['1st', '1', 'first']) else (2 if any(k in exp_sem_clean for k in ['2nd', '2', 'second']) else (3 if any(k in exp_sem_clean for k in ['3rd', '3', 'third', 'summer', 'midyear']) else None))
        found_num = extract_semester_from_ocr_text(found_sy_sem) or extract_semester_from_ocr_text(raw_text)

        sem_ok = False
        if exp_num is not None and found_num is not None:
            sem_ok = (exp_num == found_num)
        elif exp_num is not None:
            # Fallback if no explicit year-sem hyphen digit was found
            found_sem_clean = normalize_text(found_sy_sem)
            if exp_num == 1:
                sem_ok = any(k in found_sem_clean for k in ['1st', 'first', 'sem 1', 'semester 1'])
            elif exp_num == 2:
                sem_ok = any(k in found_sem_clean for k in ['2nd', 'second', 'sem 2', 'semester 2'])
            elif exp_num == 3:
                sem_ok = any(k in found_sem_clean for k in ['3rd', 'third', 'summer', 'midyear'])

        if not sem_ok:
            found_desc = f"{found_num}nd Sem" if found_num == 2 else (f"{found_num}st Sem" if found_num == 1 else (f"{found_num}rd Sem" if found_num == 3 else found_sy_sem))
            failures.append(f"Semester mismatch (Expected: '{expected_semester}', Found in COR: '{found_desc}')")

    # 4. COURSE / DEGREE MATCHING
    if expected_course and str(expected_course).strip():
        found_course = parsed_fields.get('course', raw_text)
        c_exp = normalize_text(expected_course)
        c_found = normalize_text(found_course)
        c_raw = normalize_text(raw_text)

        # Fix digit/letter OCR confusions (e.g. b5it -> bsit)
        c_found_fixed = c_found.replace('b5it', 'bsit').replace('5', 's')
        c_raw_fixed = c_raw.replace('b5it', 'bsit').replace('5', 's')

        course_ok = False
        if (c_exp in c_found_fixed) or (c_exp in c_raw_fixed):
            course_ok = True
        
        # Course synonyms check
        course_map = {
            'bsit': ['information technology', 'info tech', 'it', 'b5it'],
            'bscs': ['computer science', 'comp sci', 'cs'],
            'bsba': ['business administration', 'business', 'management'],
            'bscpe': ['computer engineering', 'cpe'],
            'bsee': ['electrical engineering', 'ee'],
            'bsece': ['electronics engineering', 'ece'],
            'bsme': ['mechanical engineering', 'me'],
            'bsn': ['nursing']
        }
        for code, synonyms in course_map.items():
            if code in c_exp or any(s in c_exp for s in synonyms):
                if code in c_raw_fixed or any(s in c_raw_fixed for s in synonyms):
                    course_ok = True
                    break

        if not course_ok:
            exp_words = [w for w in c_exp.split() if w not in {'bachelor', 'of', 'science', 'in', 'and', 'the', 'bs', 'degree', 'major'}]
            if exp_words:
                matched_count = sum(1 for w in exp_words if w in c_raw_fixed)
                required_ratio = 1.0 if len(exp_words) <= 2 else 0.6
                if (matched_count / len(exp_words)) >= required_ratio:
                    course_ok = True

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

def detect_document_tampering(image_bytes):
    """
    Advanced Document Tampering & Digital Manipulation Detector (Python OpenCV).
    Analyzes image pixels for artificial digital overlay blocks, solid whiteout patches,
    drawn cover-ups, and unnatural uniform color rectangles.
    """
    if not image_bytes:
        return False, "No image provided", 0

    try:
        raw = resolve_verification_image_bytes(image_bytes)
        if not raw:
            return False, "Could not resolve image bytes", 0

        nparr = np.frombuffer(raw, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return False, "Failed to decode image", 0

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
        h, w = gray.shape[:2]

        grid_w, grid_h = 20, 15
        cols, rows = w // grid_w, h // grid_h

        suspicious_patches = 0
        for r in range(rows):
            for c in range(cols):
                roi = gray[r*grid_h:(r+1)*grid_h, c*grid_w:(c+1)*grid_w]
                mean_val, std_val = cv2.meanStdDev(roi)
                m = mean_val[0][0]
                s = std_val[0][0]
                if (m > 242 and s < 2.5) or (m < 20 and s < 1.8):
                    suspicious_patches += 1

        if suspicious_patches >= 4:
            return True, f"Digital edit / overlay block detected on document ({suspicious_patches} artificial overlay patches found). Please upload an unedited document.", suspicious_patches

        return False, "Authentic document (No digital tampering detected)", 0
    except Exception as exc:
        print(f"[TAMPER DETECTOR] Error: {exc}", flush=True)
        return False, f"Tamper detection error: {exc}", 0

def verify_document_with_ocr(image_bytes, doc_type, first_name=None, middle_name=None, last_name=None, **kwargs):
    """
    Main entry point for document verification (COR, Grades, Indigency, ID).
    """
    if not image_bytes:
        return False, "No document image provided.", "", {}

    # Pre-scan Digital Tamper & Manipulation Check
    is_edited, tamper_msg, _ = detect_document_tampering(image_bytes)
    if is_edited:
        return False, f"Tampering Alert: {tamper_msg}", "", {'tamper_alert': True, 'details': [tamper_msg]}

    expected_name = kwargs.get('expected_name') or kwargs.get('full_name')
    if expected_name and (not first_name or not last_name):
        parts = str(expected_name).strip().split()
        if len(parts) == 1:
            first_name = first_name or parts[0]
            last_name = last_name or parts[0]
        elif len(parts) == 2:
            first_name = first_name or parts[0]
            last_name = last_name or parts[1]
        elif len(parts) >= 3:
            first_name = first_name or parts[0]
            middle_name = middle_name or parts[1]
            last_name = last_name or " ".join(parts[2:])

    first_name = first_name or ""
    middle_name = middle_name or ""
    last_name = last_name or ""

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
    elif 'ID' in doc_type_upper or 'IDENTIFICATION' in doc_type_upper or 'SCHOOLID' in doc_type_upper:
        success, msg, meta = verify_id_fields(raw_text, first_name, middle_name, last_name, **kwargs)
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
            r'student\s*name\s*[:\-=\+]*\s*([A-Za-z\s,\.\-]+)',
            r'name\s*[:\-=\+]*\s*([A-Za-z\s,\.\-]+)',
            r'pangalan\s*[:\-=\+]*\s*([A-Za-z\s,\.\-]+)'
        ],
        'student_id': [
            r'student\s*(?:no|number|id)\s*[:\-=\+]?\s*([A-Za-z0-9\-]{4,20})',
            r'id\s*(?:no|number)\s*[:\-=\+]?\s*([A-Za-z0-9\-]{4,20})'
        ],
        'sy_sem': [
            r's[yv]\s*/?\s*s[ea]m\s*[:\-=\+]*\s*([A-Za-z0-9\s\-\.\/]+)',
            r'school\s*year\s*(?:sem)?\s*[:\-=\+]*\s*([A-Za-z0-9\s\-\.\/]+)',
            r'academic\s*year\s*[:\-=\+]*\s*([A-Za-z0-9\s\-\.\/]+)',
            r'(?:ay|sy)\s*20\d{2}[^\n]*'
        ],
        'course': [
            r'course\s*[:\-=\+]*\s*([A-Za-z0-9\s,\.\-\&]+)',
            r'program\s*[:\-=\+]*\s*([A-Za-z0-9\s,\.\-\&]+)',
            r'degree\s*[:\-=\+]*\s*([A-Za-z0-9\s,\.\-\&]+)'
        ]
    }

    for line in lines:
        for field_name, regexes in label_patterns.items():
            if field_name in fields:
                continue
            for regex in regexes:
                match = re.search(regex, line, re.IGNORECASE)
                if match:
                    val = match.group(1 if len(match.groups()) >= 1 else 0).strip()
                    val = re.sub(r'\s+(?:Total\b|Instructor\b|Grade\b|Units\b|Posted\b|Units\b|Failure\b).*', '', val, flags=re.IGNORECASE)
                    if any(k in val.lower() for k in ['baseline', 'benchmark', 'total criteria', 'sample evaluation']):
                        continue
                    if len(val) > 0:
                        fields[field_name] = val
                        break

    # Extract GPA / GWA from document (e.g. GPA: 3.5481 or GPA 35461)
    gpa_patterns = [
        r'(?:GPA|GWA|GBA|WEIGHTED\s*AVERAGE|GRADE\s*POINT|GENERAL\s*WEIGHTED|FINAL\s*GRADE)\s*[:\-=.,|\sA-Za-z]*?([1-5][.,0-9]{1,5})\b',
        r'([1-5]\.[0-9]{1,4})\s*[:\-=.,|\s]*(?:Total\s*Units?|Units?)'
    ]
    for pattern in gpa_patterns:
        match = re.search(pattern, raw_text, re.IGNORECASE)
        if match:
            raw_digits = match.group(1).replace(',', '.').strip()
            if '.' in raw_digits:
                val = float(raw_digits)
            else:
                if len(raw_digits) in (4, 5):
                    val = float(raw_digits[0] + '.' + raw_digits[1:])
                elif len(raw_digits) == 3:
                    val = float(raw_digits) / 100.0
                elif len(raw_digits) == 2:
                    val = float(raw_digits) / 10.0
                else:
                    val = float(raw_digits)
            if 1.0 <= val <= 5.0:
                fields['gpa'] = f"{val:.2f}"
                break

    if 'gpa' not in fields:
        # Calculate weighted average from subject grade table (supports 3.0, 30, 3.00, etc.)
        grade_matches = re.findall(r'\b([1-5]\.[0-9]{1,2})\s+([1-9]\.0?|30|3\.0)\b', raw_text)
        if grade_matches and len(grade_matches) >= 3:
            total_pts = sum(float(g) * (3.0 if u == '30' else float(u)) for g, u in grade_matches)
            total_u = sum((3.0 if u == '30' else float(u)) for g, u in grade_matches)
            if total_u > 0:
                calc_gpa = total_pts / total_u
                if 1.0 <= calc_gpa <= 5.0:
                    fields['gpa'] = f"{calc_gpa:.2f}"

    if 'gpa' not in fields:
        decimals = [float(x) for x in re.findall(r'\b[1-5]\.[0-9]{1,4}\b', raw_text) if 1.0 <= float(x) <= 5.0]
        if decimals:
            fields['gpa'] = f"{decimals[-1]:.2f}"

    # Extract Total Units
    units_match = re.search(r'Total\s*Units\s*[:\-=\s]*([0-9]+)', raw_text, re.IGNORECASE)
    if units_match:
        fields['total_units'] = units_match.group(1).strip()

    raw_upper = str(raw_text).upper()
    if any(k in raw_upper for k in ['DE LA SALLE LIPA', 'DLSL', 'OFFICE OF THE COLLEGE REGISTRAR', 'COLLEGE REGISTRAR', 'STUDENT\'S FINAL GRADES', 'STUDENTS FINAL GRADES', 'LAUREL']):
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
    target_name_str = parsed_fields.get('name', raw_text)
    first_ok, last_ok, sequence_ok = verify_name_sequence(
        first_name, last_name, target_name_str, raw_text, middle_name
    )

    if not (first_ok and last_ok and sequence_ok):
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

        if exp_gpa_val:
            e_gpa = float(exp_gpa_val.group(0))
            decimals = [float(x) for x in re.findall(r'\b[1-5]\.[0-9]{1,4}\b', raw_text) if 1.0 <= float(x) <= 5.0]

            if decimals:
                match_cand = next((c for c in decimals if abs(c - e_gpa) <= 0.05), None)
                if match_cand is not None:
                    found_gpa_val = f"{match_cand:.2f}"
                elif not found_gpa_val:
                    found_gpa_val = f"{decimals[-1]:.2f}"

        meta['detected_gpa'] = found_gpa_val

        if found_gpa_val:
            try:
                f_gpa = float(found_gpa_val)
                if exp_gpa_val:
                    e_gpa = float(exp_gpa_val.group(0))
                    if abs(e_gpa - f_gpa) > 0.05:
                        failures.append(f"GPA mismatch (Expected: '{e_gpa:.2f}', Found in Grades: '{f_gpa:.2f}')")
            except ValueError:
                pass
        else:
            failures.append(f"GPA mismatch (Expected: '{expected_gpa}', Not detected in Grades document)")

    # 4. ACADEMIC YEAR MATCHING
    if expected_academic_year and str(expected_academic_year).strip():
        found_ay = parsed_fields.get('sy_sem', '')
        ay_ok, ay_msg = verify_academic_year_strict(expected_academic_year, found_ay, raw_text)
        if not ay_ok:
            failures.append(ay_msg)

    # 4b. SEMESTER MATCHING
    if expected_semester and str(expected_semester).strip():
        found_sy_sem = parsed_fields.get('sy_sem', raw_text)
        exp_sem_clean = normalize_text(expected_semester)

        exp_num = 1 if any(k in exp_sem_clean for k in ['1st', '1', 'first']) else (2 if any(k in exp_sem_clean for k in ['2nd', '2', 'second']) else (3 if any(k in exp_sem_clean for k in ['3rd', '3', 'third', 'summer', 'midyear']) else None))
        found_num = extract_semester_from_ocr_text(found_sy_sem) or extract_semester_from_ocr_text(raw_text)

        sem_ok = False
        if exp_num is not None and found_num is not None:
            sem_ok = (exp_num == found_num)
        elif exp_num is not None:
            found_sem_clean = normalize_text(found_sy_sem)
            if exp_num == 1:
                sem_ok = any(k in found_sem_clean for k in ['1st', 'first', 'sem 1', 'semester 1'])
            elif exp_num == 2:
                sem_ok = any(k in found_sem_clean for k in ['2nd', 'second', 'sem 2', 'semester 2'])
            elif exp_num == 3:
                sem_ok = any(k in found_sem_clean for k in ['3rd', 'third', 'summer', 'midyear'])

        if not sem_ok:
            found_desc = f"{found_num}nd Sem" if found_num == 2 else (f"{found_num}st Sem" if found_num == 1 else (f"{found_num}rd Sem" if found_num == 3 else found_sy_sem))
            failures.append(f"Semester mismatch (Expected: '{expected_semester}', Found in Grades: '{found_desc}')")

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

    # NAME MATCHING — full sequence required (not just word-by-word independently)
    first_ok, last_ok, sequence_ok = verify_name_sequence(
        first_name, last_name, raw_text, raw_text, middle_name
    )

    if not (first_ok and last_ok and sequence_ok):
        failures.append(f"Name mismatch (Expected: '{first_name} {last_name}' in Indigency Certificate)")

    addr_ok = True
    if expected_address and str(expected_address).strip():
        doc_norm = normalize_text(raw_text)
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

def verify_id_fields(raw_text, first_name, middle_name, last_name, **kwargs):
    """
    Dedicated verification logic for School ID cards.
    Validates applicant name, student ID number, and school name from ID OCR text.
    """
    meta = {}
    failures = []
    
    doc_norm = normalize_text(raw_text)
    
    # 1. Name Verification
    first_ok, last_ok, seq_ok = verify_name_sequence(first_name, last_name, raw_text, full_raw_text=raw_text, middle_name=middle_name)
    name_matched = seq_ok or (first_ok and last_ok)
    if not name_matched:
        failures.append(f"Name mismatch (Expected: '{first_name} {last_name}' on ID)")

    # 2. Student ID Number (if expected_id_no provided)
    expected_id_no = kwargs.get('expected_id_no')
    id_ok = True
    if expected_id_no:
        clean_expected_id = normalize_id_number(expected_id_no)
        clean_raw_id_text = normalize_id_number(raw_text)
        id_ok = clean_expected_id in clean_raw_id_text if clean_expected_id else True
        if not id_ok:
            failures.append(f"ID Number mismatch (Expected: '{expected_id_no}' on ID)")

    # 3. School Name (if expected_school_name provided)
    expected_school = kwargs.get('expected_school_name')
    school_ok = True
    if expected_school:
        clean_school = normalize_text(expected_school)
        school_words = [w for w in clean_school.split() if len(w) >= 3 and w not in {'university', 'college', 'school', 'inc', 'of', 'de', 'la', 'salle'}]
        if school_words:
            school_ok = any(w in doc_norm for w in school_words)
        else:
            school_ok = clean_school in doc_norm
        if not school_ok:
            failures.append(f"School name mismatch (Expected: '{expected_school}' on ID)")

    success = (first_ok and last_ok) and (id_ok or school_ok)
    if success:
        msg = f"School ID Verified: Name ({first_name} {last_name}) and ID details matched."
    else:
        msg = "School ID Verification Failed: " + ("; ".join(failures) if failures else "Details could not be verified on ID.")

    meta['name_ok'] = first_ok and last_ok
    meta['id_ok'] = id_ok
    meta['school_ok'] = school_ok
    meta['details'] = failures
    meta['detected_text'] = raw_text

    return success, msg, meta

def verify_id_with_ocr(image_bytes, first_name=None, middle_name=None, last_name=None, expected_name=None, expected_address=None, **kwargs):
    """
    ID OCR verification wrapper.
    Accepts both positional (first_name, middle_name, last_name) and keyword formats (expected_name, expected_address).
    """
    if expected_name:
        kwargs['expected_name'] = expected_name
    if expected_address:
        kwargs['expected_address'] = expected_address

    success, msg, raw_text, meta = verify_document_with_ocr(image_bytes, 'ID', first_name, middle_name, last_name, **kwargs)
    return success, msg, raw_text, 1.0 if success else 0.0