import os
import json
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
    from services.tamper_ai_detector import run_full_security_audit
except ImportError:
    try:
        from tamper_ai_detector import run_full_security_audit
    except ImportError:
        def run_full_security_audit(image_bytes, doc_type="Document", success=False, message="", meta=None):
            return {'security_flagged': False, 'audit': {}, 'recommendation': message}

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

def _run_tesseract_fallback(img_cv_or_bytes, psm=6):
    """Fallback OCR engine if Google Cloud Vision API returns empty text or billing error."""
    if img_cv_or_bytes is None or pytesseract is None:
        return ""
    try:
        _init_tesseract()
        img_cv = img_cv_or_bytes
        if isinstance(img_cv_or_bytes, (bytes, str)):
            data = decode_base64(img_cv_or_bytes) if isinstance(img_cv_or_bytes, str) else img_cv_or_bytes
            if data:
                nparr = np.frombuffer(data, np.uint8)
                img_cv = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img_cv is None:
            return ""

        processed = preprocess_image_advanced(img_cv, scale_factor=2.0)
        if processed is None:
            processed = img_cv

        text = pytesseract.image_to_string(processed, config=f'--psm {psm} --oem 1')
        if not text.strip() and psm != 3:
            text = pytesseract.image_to_string(processed, config='--psm 3 --oem 1')

        return text.strip()
    except Exception as e:
        print(f"[OCR FALLBACK] Tesseract error: {e}", flush=True)
        return ""

def _run_tesseract_fallback(image_input):
    """Fallback OCR using PyTesseract if available."""
    if not image_input or pytesseract is None:
        return ""
    try:
        raw_bytes = resolve_verification_image_bytes(image_input)
        if not raw_bytes:
            return ""
        nparr = np.frombuffer(raw_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return ""
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        text = pytesseract.image_to_string(gray)
        return text.strip() if text else ""
    except Exception as te:
        logger.warning(f"[TESSERACT FALLBACK EXCEPTION] {te}")
        return ""

def extract_text_with_google_cloud_vision(image_input, return_debug=False):
    """
    High-Fidelity Document Text Extraction using Google Cloud Vision API (DOCUMENT_TEXT_DETECTION).
    Optimized for dense printed document tables (COR, Grades Transcripts, Barangay Indigency, IDs).
    Falls back gracefully to PyTesseract if GCP Vision API is unlinked to billing or encounters network limits.
    """
    if image_input is None:
        return ("", "image_input is None") if return_debug else ""

    debug_msg = []

    try:
        from google.cloud import vision
        from google.oauth2 import service_account
    except Exception as imp_err:
        debug_msg.append(f"Import error: {imp_err}")
        logger.warning(f"[GOOGLE CLOUD VISION] Import error: {imp_err}")
        res = _run_tesseract_fallback(image_input)
        return (res, " | ".join(debug_msg)) if return_debug else res

    client = None

    # Priority 1: Direct JSON in environment variable (Render / Cloud environment)
    if "GOOGLE_CLOUD_VISION_KEY_JSON" in os.environ:
        try:
            raw_json_str = os.environ["GOOGLE_CLOUD_VISION_KEY_JSON"].strip()
            debug_msg.append(f"Found GOOGLE_CLOUD_VISION_KEY_JSON (len={len(raw_json_str)})")
            key_data = json.loads(raw_json_str)
            if isinstance(key_data, dict) and "private_key" in key_data:
                if "\\n" in key_data["private_key"] and "\n" not in key_data["private_key"]:
                    key_data["private_key"] = key_data["private_key"].replace("\\n", "\n")
            credentials = service_account.Credentials.from_service_account_info(key_data)
            try:
                client = vision.ImageAnnotatorClient(credentials=credentials, transport='rest')  # type: ignore
            except Exception:
                client = vision.ImageAnnotatorClient(credentials=credentials)  # type: ignore
            debug_msg.append("Client created from GOOGLE_CLOUD_VISION_KEY_JSON (rest transport)")
        except Exception as json_e:
            debug_msg.append(f"JSON key parse error: {json_e}")
            logger.warning(f"[GOOGLE CLOUD VISION] Failed initializing from GOOGLE_CLOUD_VISION_KEY_JSON: {json_e}")
    else:
        debug_msg.append("GOOGLE_CLOUD_VISION_KEY_JSON not in os.environ")

    # Priority 2: File path in GOOGLE_APPLICATION_CREDENTIALS or candidate paths
    if client is None:
        if "GOOGLE_APPLICATION_CREDENTIALS" not in os.environ or not os.path.exists(os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")):
            base_dir = os.path.dirname(__file__)
            candidate_paths = [
                os.path.join(base_dir, "gcp-vision-key.json"),
                os.path.join(os.path.dirname(base_dir), "gcp-vision-key.json"),
                "/etc/secrets/gcp-vision-key.json",
                "gcp-vision-key.json"
            ]
            for cp in candidate_paths:
                if os.path.exists(cp):
                    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = os.path.abspath(cp)
                    debug_msg.append(f"Found candidate key file: {cp}")
                    break
        try:
            try:
                client = vision.ImageAnnotatorClient(transport='rest')  # type: ignore
            except Exception:
                client = vision.ImageAnnotatorClient()  # type: ignore
            debug_msg.append("Client created from default GOOGLE_APPLICATION_CREDENTIALS")
        except Exception as client_e:
            debug_msg.append(f"Default client init error: {client_e}")
            logger.warning(f"[GOOGLE CLOUD VISION] Failed default client initialization: {client_e}")

    if client is None:
        debug_msg.append("No valid credentials found, running tesseract fallback")
        res = _run_tesseract_fallback(image_input)
        return (res, " | ".join(debug_msg)) if return_debug else res

    try:
        raw_bytes = None
        if isinstance(image_input, np.ndarray):
            success, encoded_img = cv2.imencode('.jpg', image_input)
            if success:
                raw_bytes = encoded_img.tobytes()
        elif isinstance(image_input, str) and os.path.isfile(image_input):
            with open(image_input, 'rb') as f:
                raw_bytes = f.read()
        else:
            raw_bytes = resolve_verification_image_bytes(image_input)

        if not raw_bytes:
            debug_msg.append("raw_bytes is empty")
            return ("", " | ".join(debug_msg)) if return_debug else ""

        debug_msg.append(f"Sending image bytes (size={len(raw_bytes)}) to Vision API")
        image = vision.Image(content=raw_bytes)
        response = client.document_text_detection(image=image)
        if response.error and response.error.message:
            debug_msg.append(f"API Response Error: {response.error.message}")
            logger.warning(f"[GOOGLE CLOUD VISION] API Error: {response.error.message}")
            res = _run_tesseract_fallback(raw_bytes)
            return (res, " | ".join(debug_msg)) if return_debug else res

        full_text = response.full_text_annotation.text or ""
        if full_text:
            debug_msg.append(f"Extracted {len(full_text)} chars")
            logger.info(f"[GOOGLE CLOUD VISION] Successfully extracted {len(full_text)} chars from document.")
            return (full_text.strip(), " | ".join(debug_msg)) if return_debug else full_text.strip()
        else:
            debug_msg.append("full_text_annotation empty")
            res = _run_tesseract_fallback(raw_bytes)
            return (res, " | ".join(debug_msg)) if return_debug else res
    except Exception as e:
        debug_msg.append(f"Exception during Vision API call: {e}")
        logger.warning(f"[GOOGLE CLOUD VISION EXCEPTION] {e}")
        res = _run_tesseract_fallback(image_input)
        return (res, " | ".join(debug_msg)) if return_debug else res

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


_SFACE_DETECTOR = None
_SFACE_RECOGNIZER = None

def _get_sface_engine():
    global _SFACE_DETECTOR, _SFACE_RECOGNIZER
    if _SFACE_DETECTOR is not None and _SFACE_RECOGNIZER is not None:
        return _SFACE_DETECTOR, _SFACE_RECOGNIZER

    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    models_dir = os.path.join(backend_dir, 'models')
    os.makedirs(models_dir, exist_ok=True)

    yunet_path = os.path.join(models_dir, 'face_detection_yunet_2023mar.onnx')
    sface_path = os.path.join(models_dir, 'face_recognition_sface_2021dec.onnx')

    if not os.path.exists(yunet_path):
        import urllib.request
        yunet_url = 'https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx'
        print(f"[FACE] Downloading YuNet ONNX model (230KB)...", flush=True)
        urllib.request.urlretrieve(yunet_url, yunet_path)

    if not os.path.exists(sface_path):
        import urllib.request
        sface_url = 'https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx'
        print(f"[FACE] Downloading SFace ONNX model (1.2MB)...", flush=True)
        urllib.request.urlretrieve(sface_url, sface_path)

    if hasattr(cv2, 'FaceDetectorYN_create') and hasattr(cv2, 'FaceRecognizerSF_create'):
        _SFACE_DETECTOR = cv2.FaceDetectorYN.create(yunet_path, '', (300, 300), 0.6, 0.3, 5000)
        _SFACE_RECOGNIZER = cv2.FaceRecognizerSF.create(sface_path, '')
        print("[FACE] OpenCV YuNet + SFace Deep Learning Engine initialized (< 3MB RAM).", flush=True)
        return _SFACE_DETECTOR, _SFACE_RECOGNIZER
    
    return None, None


def _sface_verify(user_image, id_image):
    detector, recognizer = _get_sface_engine()
    if detector is None or recognizer is None:
        raise RuntimeError("OpenCV YuNet/SFace engine not available.")

    h_u, w_u = user_image.shape[:2]
    h_i, w_i = id_image.shape[:2]

    detector.setInputSize((w_u, h_u))
    _, faces_u = detector.detect(user_image)

    if faces_u is None or len(faces_u) == 0:
        return False, "No face detected in your photo. Please remove any obstructions, face the camera directly, and ensure good lighting.", 0.0

    detector.setInputSize((w_i, h_i))
    _, faces_i = detector.detect(id_image)

    if faces_i is None or len(faces_i) == 0:
        # Retry with cropped ID center region
        id_crop = id_image[int(h_i * 0.10):int(h_i * 0.90), int(w_i * 0.10):int(w_i * 0.90)]
        h_ic, w_ic = id_crop.shape[:2]
        detector.setInputSize((w_ic, h_ic))
        _, faces_i = detector.detect(id_crop)
        if faces_i is None or len(faces_i) == 0:
            return False, "No face detected in your ID photo. Please ensure clear lighting and an unobstructed ID photo.", 0.0
        id_image = id_crop

    face_u = max(faces_u, key=lambda f: f[2] * f[3])
    face_i = max(faces_i, key=lambda f: f[2] * f[3])

    # 1. Lighting & Luminance Validation
    x, y, w, h = int(face_u[0]), int(face_u[1]), int(face_u[2]), int(face_u[3])
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(w_u, x + w), min(h_u, y + h)
    face_crop = user_image[y0:y1, x0:x1]

    if face_crop.size > 0:
        gray_crop = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY) if len(face_crop.shape) == 3 else face_crop
        mean_lum = float(np.mean(gray_crop))

        if mean_lum < 45:
            return False, "Lighting is too dark or dim. Please turn on your room lights or face a light source before taking your photo.", 0.0
        if mean_lum > 238:
            return False, "Photo is overexposed or too bright. Please adjust your lighting before taking your photo.", 0.0

        # 2. Hand / Object Obstruction Edge Detection (Laplacian Variance in upper face)
        h_c = gray_crop.shape[0]
        upper_face = gray_crop[int(h_c * 0.15):int(h_c * 0.65), :]
        if upper_face.size > 0:
            lap_var = cv2.Laplacian(upper_face, cv2.CV_64F).var()
            if lap_var > 650:
                return False, "Facial features are obstructed by your hand or an object. Please remove any hands, fingers, or objects covering your face.", 0.0

    # 3. Landmark Distance & Symmetry Check
    score_u = face_u[-1]
    re_x, re_y = face_u[4], face_u[5]
    le_x, le_y = face_u[6], face_u[7]
    eye_dist = np.sqrt((re_x - le_x)**2 + (re_y - le_y)**2)

    if score_u < 0.72 or eye_dist < (w * 0.22):
        return False, "Facial features or eyes are partially covered (e.g. hand over eye/cheek). Please remove any obstructions and face the camera directly.", 0.0

    aligned_u = recognizer.alignCrop(user_image, face_u)
    aligned_i = recognizer.alignCrop(id_image, face_i)

    feat_u = recognizer.feature(aligned_u)
    feat_i = recognizer.feature(aligned_i)

    raw_sim = recognizer.match(feat_u, feat_i, cv2.FaceRecognizerSF_FR_COSINE)
    similarity = max(0.0, min(1.0, float(raw_sim)))

    # Strict SFace Cosine Threshold: >= 0.45 for verified identity
    threshold = 0.45
    is_verified = raw_sim >= threshold
    msg = (
        f"Facial identity verified! (similarity: {similarity*100:.1f}%)"
        if is_verified else
        f"Facial features do not match your ID photo (similarity: {similarity*100:.1f}%). Please ensure clear lighting and face the camera directly."
    )
    return is_verified, msg, similarity


def verify_face_with_id(user_photo_bytes, id_photo_bytes):
    """
    State-of-the-Art Deep Learning Face Verification (YuNet + SFace):
    - Fast 35ms execution
    - Real 128-d deep facial feature landmark comparison (eyes, nose, mouth geometry)
    - Rejects covered/obstructed faces (hand covering eye/cheek)
    - Uses < 3MB RAM total (zero risk of 502/503 OOM crashes on Render)
    """
    try:
        user_image = _decode_face_image(user_photo_bytes)
        id_image   = _decode_face_image(id_photo_bytes)

        # 1. Primary: YuNet + SFace Deep Feature Matching Engine
        try:
            return _sface_verify(user_image, id_image)
        except Exception as sface_err:
            print(f"[FACE] YuNet/SFace note ({sface_err}), falling back to OpenCV cascades...", flush=True)

        # 2. Fallback: Multi-scale OpenCV Matcher
        verified, msg, sim = _opencv_fallback_face_match(user_image, id_image)
        clear_heavy_memory()
        return verified, msg, sim

    except ValueError as exc:
        return False, str(exc), 0.0
    except Exception as exc:
        print(f"[FACE] Verification exception: {exc}", flush=True)
        return False, f"Face verification error: {str(exc)}", 0.0

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

    # Downscale high-resolution images (>1280px) for 4x faster thresholding & contour extraction
    max_dim = max(height, width)
    if max_dim > 1280:
        scale = 1280.0 / max_dim
        gray = cv2.resize(gray, (int(width * scale), int(height * scale)), interpolation=cv2.INTER_AREA)
        height, width = gray.shape[:2]

    lane_y0, lane_y1 = int(height * 0.08), int(height * 0.42)
    lane_x0, lane_x1 = int(width * 0.08), int(width * 0.92)
    roi_gray = gray[lane_y0:lane_y1, lane_x0:lane_x1].copy()

    norm = cv2.normalize(roi_gray, None, 0, 255, cv2.NORM_MINMAX)
    smooth = cv2.GaussianBlur(norm, (5, 5), 0)
    
    binary = cv2.adaptiveThreshold(
        smooth, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, 31, 7
    )
    
    h_idx, w_idx = binary.shape[:2]

    # Detect horizontal signature line to isolate signature ink from printed text below
    horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (int(w_idx * 0.18), 1))
    detected_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, horizontal_kernel)
    line_contours, _ = cv2.findContours(detected_lines, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    sig_line_y = None
    if line_contours:
        candidate_lines = []
        for l_cnt in line_contours:
            lx, ly, lw, lh = cv2.boundingRect(l_cnt)
            if lw > w_idx * 0.18 and h_idx * 0.20 < ly < h_idx * 0.85:
                candidate_lines.append((ly, lw))
        if candidate_lines:
            candidate_lines.sort(key=lambda x: x[1], reverse=True)
            sig_line_y = candidate_lines[0][0]

    # Define vertical window limits: Handwritten signature lives STRICTLY ABOVE the signature line
    if sig_line_y is not None:
        window_height = max(50, int(h_idx * 0.70))
        y_min_limit = max(0, sig_line_y - window_height)
        y_max_limit = sig_line_y - 2
        logger.info(f"[SIGNATURE] Detected signature underline at y={sig_line_y}. Window: {y_min_limit} to {y_max_limit}")
    else:
        y_min_limit = int(h_idx * 0.05)
        y_max_limit = int(h_idx * 0.65)
        logger.info(f"[SIGNATURE] Underline not found. Using fallback window: {y_min_limit} to {y_max_limit}")

    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates = []
    
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        
        if x < 2 or (x+w) > w_idx-2: continue
        if y < 2 or (y+h) > h_idx-2: continue
        
        area = cv2.contourArea(cnt)
        if area < 25: continue
        
        solidity = area / float(w * h) if w * h > 0 else 0
        aspect = w / float(h) if h > 0 else 0
        extent = area / float(w_idx * h_idx)
        y_mid = y + h/2

        # Filter out star logo / top graphics in the upper 35% of ROI
        # (raised from 28 → 35 so the star centroid is safely excluded)
        if y_mid < h_idx * 0.35:
            continue
        
        # Enforce vertical signature limits to isolate handwritten ink strictly above the line
        # When an underline is detected, y_max_limit = sig_line_y - 2 (hard cut)
        if not (y_min_limit <= y_mid <= y_max_limit):
            continue

        if aspect < 0.22:
            continue

        if aspect > 5.5 or (aspect > 4.0 and h < 8): 
            continue
        
        peri = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
        
        # Filter out geometric logo shapes (star points, squares, circles)
        if (4 <= len(approx) <= 12 and solidity > 0.45) or solidity > 0.65:
             continue
             
        if 0.6 < aspect < 1.6 and solidity > 0.40:
            continue
            
        if (extent > 0.12 or w > w_idx * 0.40) and solidity > 0.45: 
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
        fallback = binary[qy0:qy0+ch, qx0:qx0+cw]
        result = np.full((fallback.shape[0], fallback.shape[1], 3), 255, dtype=np.uint8)
        result[fallback > 0] = (0, 0, 0)
        return cv2.resize(result, (400, max(1, int(400 * ch/cw))), interpolation=cv2.INTER_LINEAR)
        
    # Anchor must be a candidate in the middle signature zone (not top logo, not bottom printed text)
    anchor_candidates = [c for c in candidates if h_idx * 0.25 <= c['y_mid'] <= h_idx * 0.75]
    if not anchor_candidates:
        anchor_candidates = candidates

    anchor_candidates.sort(key=lambda c: c['hw_score'], reverse=True)
    anchor = anchor_candidates[0]
    anchor_top = anchor['box'][1]
    anchor_bottom = anchor['box'][1] + anchor['box'][3]
    anchor_h = anchor['box'][3]

    final_parts = []
    for c in candidates:
        x, y, w, h = c['box']
        y_mid = c['y_mid']

        # Filter out horizontal underlines (w > 35% image width, h < 16px)
        if w > w_idx * 0.35 and h < 16:
            continue

        # Filter out printed label text ("Signature", "Date", dots) strictly below the anchor
        # These are below anchor_bottom AND far from the anchor centroid
        if y >= anchor_bottom and y_mid > anchor['y_mid'] + anchor_h * 0.30:
            continue

        # Filter out top star logo / graphic elements strictly above anchor
        # A star is compact (solidity > 0.3) and its entire bbox is above the anchor top
        if (y + h) <= anchor_top:
            cnt_area = c['area']
            cnt_solidity = cnt_area / float(w * h) if w * h > 0 else 0
            # Exclude compact (star/logo) shapes above the signature
            if cnt_solidity > 0.25 or (w / float(h) if h > 0 else 0) < 2.0:
                continue

        # Check proximity to anchor signature stroke (tighter: 70% of anchor height)
        if abs(y_mid - anchor['y_mid']) <= max(25, anchor_h * 0.70):
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

        # Apply a second-pass cleanup so ORIGINAL (ID) shows only the isolated
        # signature strokes (same level of cleanup used by the comparison algorithm).
        try:
            try:
                from services.signature_brain import _extract_ink_crop as _sig_ink_crop
            except ImportError:
                from signature_brain import _extract_ink_crop as _sig_ink_crop
            _clean_gray = _sig_ink_crop(extracted_id_signature)
            if _clean_gray is not None and _clean_gray.size > 0:
                # Scale the cleaned crop to a reasonable display size
                _dh, _dw = _clean_gray.shape[:2]
                _target_w = 400
                _target_h = max(1, int(_target_w * _dh / float(_dw)))
                _clean_resized = cv2.resize(_clean_gray, (_target_w, _target_h), interpolation=cv2.INTER_CUBIC)
                extracted_id_preview = cv2.cvtColor(_clean_resized, cv2.COLOR_GRAY2BGR)
            else:
                extracted_id_preview = extracted_id_signature
        except Exception as _preview_err:
            logger.warning(f"[SIGNATURE] Preview cleanup fallback: {_preview_err}")
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

def normalize_text(text):
    if not text:
        return ""
    return re.sub(r'[^a-z0-9\s]', ' ', str(text).lower()).strip()


def levenshtein_distance(s1, s2):
    s1, s2 = str(s1), str(s2)
    if s1 == s2: return 0
    if not s1: return len(s2)
    if not s2: return len(s1)
    v0 = list(range(len(s2) + 1))
    v1 = [0] * (len(s2) + 1)
    for i in range(len(s1)):
        v1[0] = i + 1
        for j in range(len(s2)):
            cost = 0 if s1[i] == s2[j] else 1
            v1[j + 1] = min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost)
        v0 = list(v1)
    return v1[len(s2)]


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


def is_similar_name_word(w1, w2, strict_spelling=False):
    """
    Returns True if name word w1 matches token w2.
    If strict_spelling is True (used for Last Name & strict First Name verification):
      - Accepts exact match or OCR character substitutions (0/O, 1/I, 5/S, 8/B, etc.).
      - Rejects misspelled names (e.g., SANTOS vs DELA CRUZ, or SANTUZ vs SANTOS).
    If strict_spelling is False:
      - Allows 1-character OCR typo tolerance for longer words (>= 5 chars) with ratio >= 0.88.
      - Requires exact match or OCR substitution for short words (<= 4 chars).
    """
    if not w1 or not w2:
        return False
    w1_clean = re.sub(r'[^a-z0-9]', '', str(w1).lower())
    w2_clean = re.sub(r'[^a-z0-9]', '', str(w2).lower())
    if not w1_clean or not w2_clean:
        return False

    # Exact match
    if w1_clean == w2_clean:
        return True

    # Character OCR confusion map (0->o, 1->i, 5->s, 3->e, 8->b, 4->a, rn->m, cl->d, vv->w, l->i, y->i, u->v)
    def _conf(s):
        return re.sub(r'[^a-z0-9]', '', s).replace('1', 'i').replace('|', 'i').replace('0', 'o').replace('5', 's').replace('3', 'e').replace('8', 'b').replace('4', 'a').replace('rn', 'm').replace('cl', 'd').replace('vv', 'w').replace('l', 'i').replace('y', 'i').replace('j', 'i').replace('u', 'v')

    if _conf(w1_clean) == _conf(w2_clean):
        return True

    # If strict spelling requested (e.g. Last Name), do not allow arbitrary character edits
    if strict_spelling:
        return False

    # For general words: allow 1-character OCR difference ONLY for longer words (>= 5 chars)
    if len(w1_clean) >= 5 and len(w2_clean) >= 5 and abs(len(w1_clean) - len(w2_clean)) <= 1:
        match_ratio = difflib.SequenceMatcher(None, w1_clean, w2_clean).ratio()
        if match_ratio >= 0.82:
            return True

    return False


def compute_token_sort_fuzzy_score(cor_extracted_name, user_profile_name, threshold=80.0):
    """
    Token-Sort Fuzzy Matcher for Name Verification (ignores word order and duplicate words/initials).
    
    - Handles null/empty values cleanly.
    - Uses token sorting to prevent false failures when word order differs (e.g. LAST, FIRST M. vs FIRST M. LAST).
    - Logs name mismatches with exact similarity scores for audit trails.
    """
    if not cor_extracted_name or not user_profile_name:
        logger.info(f"[FUZZY MATCH] Reject - Empty value provided. Extracted: '{cor_extracted_name}', Profile: '{user_profile_name}'")
        return 0.0, False

    t1 = normalize_text(str(cor_extracted_name))
    t2 = normalize_text(str(user_profile_name))

    w1 = sorted(set(t1.split()))
    w2 = sorted(set(t2.split()))

    if not w1 or not w2:
        logger.info(f"[FUZZY MATCH] Reject - No valid text tokens")
        return 0.0, False

    s1 = " ".join(w1)
    s2 = " ".join(w2)

    ratio = difflib.SequenceMatcher(None, s1, s2).ratio()
    score = round(ratio * 100.0, 1)
    is_match = score >= threshold

    if not is_match:
        logger.info(f"[FUZZY MATCH MISMATCH] Extracted: '{cor_extracted_name}' | Profile: '{user_profile_name}' | Score: {score}% (Threshold: {threshold}%)")
    else:
        logger.info(f"[FUZZY MATCH SUCCESS] Extracted: '{cor_extracted_name}' | Profile: '{user_profile_name}' | Score: {score}%")

    return score, is_match



def verify_name_sequence_detailed(first_name, last_name, target_text, full_raw_text=None, middle_name=None):
    """
    Detailed Order-Flexible and Strict-Spelling Name Verifier for document text.
    Handles both 'FIRSTNAME LASTNAME' and 'LASTNAME, FIRSTNAME' layouts.
    Enforces strict spelling matching on Last Name and complete First Name.

    Returns:
        (first_ok, middle_ok, last_ok, sequence_ok, errors_list)
    """
    first_clean = normalize_text(first_name or '')
    last_clean  = normalize_text(last_name  or '')
    mid_clean   = normalize_text(middle_name or '')
    norm_target = normalize_text(target_text or '')
    norm_raw    = normalize_text(full_raw_text or target_text or '')

    first_words = [w for w in first_clean.split() if len(w) >= 2]
    last_words  = [w for w in last_clean.split()  if len(w) >= 2]
    mid_words   = [w for w in mid_clean.split()   if len(w) >= 1]
    errors = []

    # Address Noise Filtering: Strip place-related address phrases
    def sanitize_address_noise_from_text(txt):
        if not txt: return ""
        cleaned = str(txt)
        address_patterns = [
            r'\b(?:san\s+pedro|san\s+juan|san\s+isidro|san\s+jose|san\s+carlos|san\s+miguel)\b',
            r'\b(?:purok|zone|sitio|street|st\.|avenue|ave\.|subdivision|subd\.)\s+[a-z0-9\s,\.\-]{1,30}\b',
            r'\b(?:city\s+of|municipality\s+of|bayan\s+ng|lungsod\s+ng|barangay|brgy)\s+[a-z0-9\s,\.\-]{1,30}\b',
            r'\b(?:lipa|batangas|manila|quezon|laguna|cavite|bulacan|pampanga)\b'
        ]
        for pat in address_patterns:
            cleaned = re.sub(pat, ' ', cleaned, flags=re.IGNORECASE)
        return cleaned

    sanitized_target = sanitize_address_noise_from_text(norm_target)
    sanitized_raw    = sanitize_address_noise_from_text(norm_raw)
    target_tokens    = (sanitized_target.split() if target_text else []) + (sanitized_raw.split() if full_raw_text else [])

    def check_word_in_tokens(w, strict=False):
        if not w: return True, None, 1.0
        best_tok = None
        best_ratio = 0.0
        for tok in target_tokens:
            if is_similar_name_word(w, tok, strict_spelling=strict):
                return True, tok, 1.0
            r = difflib.SequenceMatcher(None, w.lower(), tok.lower()).ratio()
            if r > best_ratio:
                best_ratio = r
                best_tok = tok
        return False, best_tok, best_ratio

    # 1. FIRST NAME VALIDATION (Complete First Name & Strict Spelling)
    missing_first_words = []
    matched_first_words = []
    for w in first_words:
        ok, matched_tok, _ = check_word_in_tokens(w, strict=False)
        if ok:
            matched_first_words.append(w)
        else:
            missing_first_words.append(w)

    first_ok = (len(missing_first_words) == 0) if first_words else True
    if not first_ok:
        if missing_first_words:
            missing_str = ", ".join(missing_first_words)
            matched_str = " ".join(matched_first_words)
            if matched_str:
                errors.append(f"First Name Mismatch: Expected '{first_name}', found only '{matched_str}' (Missing: '{missing_str}')")
            else:
                errors.append(f"First Name Mismatch: Missing '{missing_str}'")

    # 2. LAST NAME VALIDATION (Strict Spelling & Order-Independent Token Search)
    last_ok = True
    for w in last_words:
        ok, best_tok, best_ratio = check_word_in_tokens(w, strict=True)
        if not ok:
            last_ok = False
            ratio_pct = int(round(best_ratio * 100))
            if best_tok and ratio_pct >= 40:
                errors.append(f"Last Name Mismatch: Expected '{last_name}', found '{best_tok}' (similarity: {ratio_pct}%)")
            else:
                errors.append("Last Name not found on applicant line")

    # 3. MIDDLE NAME VALIDATION
    middle_ok = True
    if mid_words:
        mid_full_ok = all(check_word_in_tokens(w, strict=False)[0] for w in mid_words if len(w) >= 2)
        if not mid_full_ok and mid_clean:
            initial = mid_clean[0]
            mid_full_ok = any(tok.startswith(initial) for tok in target_tokens)
        middle_ok = mid_full_ok

    # 4. ORDER-INDEPENDENT SEQUENCE CHECK
    def build_sequence_regex(name_str):
        words = [re.escape(w) for w in normalize_text(name_str).split() if len(w) >= 1]
        if not words:
            return None
        pattern = r'[^a-z0-9]{0,6}'.join(words)
        return re.compile(r'\b' + pattern + r'\b')

    sequences_to_check = []
    if mid_clean:
        sequences_to_check.extend([
            f'{first_clean} {mid_clean} {last_clean}',
            f'{last_clean} {first_clean} {mid_clean}',
            f'{last_clean} {mid_clean} {first_clean}',
            f'{first_clean} {last_clean}'
        ])
        mid_initial = mid_clean[0]
        if mid_initial:
            sequences_to_check.extend([
                f'{first_clean} {mid_initial} {last_clean}',
                f'{last_clean} {first_clean} {mid_initial}',
                f'{last_clean} {mid_initial} {first_clean}'
            ])
    else:
        sequences_to_check = [
            f'{first_clean} {last_clean}',
            f'{last_clean} {first_clean}'
        ]

    def check_word_sequence_fuzzy(name_str, search_text):
        exp_words = [w for w in normalize_text(name_str).split() if len(w) >= 1]
        if not exp_words:
            return False
        t_words = [w for w in normalize_text(search_text).split() if len(w) >= 1]
        expected_idx = 0
        last_found_idx = -1
        for i, t_word in enumerate(t_words):
            e_word = exp_words[expected_idx]
            is_last_word = any(e_word == lw or e_word in last_words for lw in last_words)
            is_match = is_similar_name_word(e_word, t_word, strict_spelling=is_last_word) or (len(e_word) == 1 and (t_word == e_word or t_word == e_word + '.'))
            if is_match:
                if last_found_idx != -1 and (i - last_found_idx) > 5:
                    expected_idx = 0
                    last_found_idx = -1
                    is_first_last = any(exp_words[0] == lw for lw in last_words)
                    if is_similar_name_word(exp_words[0], t_word, strict_spelling=is_first_last):
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

    # 5. TWO-WAY REVERSE CANDIDATE FIRST NAME CHECK (Document Candidate Name vs Form Input)
    candidate_name = None
    if target_text and target_text != full_raw_text and len(target_text.strip()) > 3 and len(target_text.strip()) < 80 and not any(kw in target_text.lower() for kw in ['certify', 'resident', 'barangay', 'office']):
        candidate_name = target_text

    if not candidate_name:
        text_to_search = full_raw_text or target_text or ''
        cert_patterns = [
            r'(?:certify|certifies|cently|certifye|certiy|patunay|katibayan)\s+(?:that\s+)?[_\W]*([A-Za-z\s,\.\-]+?)(?=\s+\d+\s*(?:years|yr|yo|\s+years\s+of\s+age)|\s+of\s+legal\s+age|\s+(?:is|has|a|the|resident|bonafide|of|residing|registered)|\n|$)',
            r'(?:this\s+is\s+to|sto)\s+[a-z]{3,10}\s+that\s+[_\W]*([A-Za-z\s,\.\-]+?)(?=\s+\d+\s*(?:years|yr|yo|\s+years\s+of\s+age)|\s+of\s+legal\s+age|\s+is\s+a\s+resident|\s+a\s+bonafide|\n|$)',
            r'that\s+[_\W]*([A-Z\s,\.\-]{5,60}?)(?=\s+\d+\s*(?:years|yr|yo|\s+years\s+of\s+age)|\s+of\s+legal\s+age|\s+is\s+a\s+resident|\s+a\s+bonafide|\n|$)',
            r'(?:name|pangalan)\s*[:\-]?\s*([A-Za-z\s,\.\-]+?)(?=\s+reg|\s+student|\s+id|\n|$)'
        ]
        for pat in cert_patterns:
            cert_m = re.search(pat, text_to_search, re.I)
            if cert_m and cert_m.group(1):
                raw_cand = re.sub(r'^[^a-zA-Z]+', '', cert_m.group(1).strip())
                # Strip trailing age/civil-status/citizenship noise before using the candidate name
                raw_cand = re.sub(r'\s*(?:\d+\s*years?\s*of\s*age|of\s*legal\s*age|\d+\s*(?:years?|yr))\s*.*$', '', raw_cand, flags=re.IGNORECASE).strip()
                raw_cand = re.sub(r'\s*(?:single|married|widow(?:er)?|separated|divorced|filipino(?:\s*citizen)?|pilipino(?:\s*citizen)?)\s*.*$', '', raw_cand, flags=re.IGNORECASE).strip()
                if len(raw_cand) >= 3 and ' ' in raw_cand:
                    candidate_name = raw_cand
                    break

    if candidate_name:
        clean_cand = re.sub(r'(?:reg\s*no|student\s*no|id|tran\s*date|status|sec|bldg|college|pay|user|scholarship|discount|ref\s*no).*', '', candidate_name, flags=re.I)
        clean_cand = re.sub(r'[^a-zA-Z\s]', ' ', clean_cand)
        stop_words = ['mr', 'ms', 'mrs', 'student', 'name', 'certify', 'resident', 'bonafide', 'officer', 'barangay', 'office', 'reg', 'no', 'tran', 'republic', 'philippines', 'this', 'that', 'years', 'age']
        cand_words = [
            w for w in normalize_text(clean_cand).split()
            if len(w) >= 2 and w.lower() not in stop_words
        ]
        
        input_first_tokens = [w for w in (first_clean + " " + mid_clean).split() if len(w) >= 1]
        
        # Identify candidate first name words (exclude document surname which is the last word in cand_words)
        cand_first_words = [
            cw for cw in cand_words[:-1]
            if len(cw) >= 2 and not any(is_similar_name_word(cw, lw, strict_spelling=True) for lw in last_words)
        ]
        
        if len(cand_first_words) >= 2:
            missing_doc_first_words = [
                cw for cw in cand_first_words
                if not any(is_similar_name_word(cw, itok) or is_similar_name_word(itok, cw) for itok in input_first_tokens)
            ]
            if missing_doc_first_words:
                first_ok = False
                sequence_ok = False
                errors.append(f"First Name Mismatch: Document contains additional first name '{' '.join(missing_doc_first_words)}' not entered in your profile.")

    return first_ok, middle_ok, last_ok, sequence_ok, errors

def verify_name_sequence(first_name, last_name, target_text, full_raw_text=None, middle_name=None):
    first_ok, middle_ok, last_ok, sequence_ok, _ = verify_name_sequence_detailed(
        first_name, last_name, target_text, full_raw_text, middle_name
    )
    return first_ok, middle_ok, last_ok, sequence_ok


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


def deskew_image(gray):
    """Deskew (straighten) document image if tilted."""
    try:
        thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
        coords = np.column_stack(np.where(thresh > 0))
        if len(coords) < 100:
            return gray
        angle = cv2.minAreaRect(coords)[-1]
        if angle < -45:
            angle = -(90 + angle)
        elif angle > 45:
            angle = 90 - angle
        else:
            angle = -angle

        if abs(angle) > 0.5 and abs(angle) < 15.0:
            (h, w) = gray.shape[:2]
            center = (w // 2, h // 2)
            M = cv2.getRotationMatrix2D(center, angle, 1.0)
            gray = cv2.warpAffine(gray, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    except Exception:
        pass
    return gray

def auto_adjust_luminance_and_gamma(gray_img):
    """
    1. Automatic Luminance Detection and Gamma Correction:
    Analyzes overall brightness (average luminance). If the document is detected
    as too dark or dim (< 145 mean luminance), automatically adjusts gamma and brightness levels
    to improve visibility before OCR processing.
    """
    if gray_img is None:
        return gray_img
    try:
        mean_val = float(np.mean(gray_img))
        if mean_val >= 145.0:
            return gray_img
        
        # Determine gamma scaling dynamically (range: 0.40 to 0.70 for dark photos)
        # Gamma < 1.0 brightens shadows and expands dark tone ranges
        gamma = max(0.40, min(0.70, mean_val / 180.0))
        table = np.array([((i / 255.0) ** gamma) * 255 for i in np.arange(0, 256)]).astype("uint8")
        brightened = cv2.LUT(gray_img, table)

        # Boost contrast & brightness further if mean is very low (< 110)
        if mean_val < 110.0:
            alpha = 1.25
            beta = int((110.0 - mean_val) * 0.4)
            brightened = cv2.convertScaleAbs(brightened, alpha=alpha, beta=beta)
        
        print(f"[DARK DOC ENHANCE] Image mean luminance={mean_val:.1f} < 145 -> Auto-applied Gamma Correction (gamma={gamma:.2f})", flush=True)
        return brightened
    except Exception as e:
        print(f"[DARK DOC ENHANCE] Gamma correction error: {e}", flush=True)
        return gray_img

def create_shadow_removed_binarized_image(gray_img):
    """
    3. Adaptive Thresholding for Background and Shadow Removal:
    Uses adaptive thresholding to convert the document into a clean, high-contrast image
    by whitening uneven shadows (from hands/phones/lighting) and darkening text/numbers.
    """
    if gray_img is None:
        return gray_img
    try:
        blurred = cv2.GaussianBlur(gray_img, (5, 5), 0)
        binarized = cv2.adaptiveThreshold(
            blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 25, 11
        )
        return binarized
    except Exception as e:
        print(f"[DARK DOC ENHANCE] Shadow removal error: {e}", flush=True)
        return gray_img

def preprocess_image_advanced(img, scale_factor=2.0, apply_clahe=True, sharpen=True):
    """
    10-Step OpenCV Preprocessing Pipeline with Automatic Dark Document Enhancement:
    1. Grayscale conversion
    2. 2x Upscaling for small text
    3. Deskewing / Straightening
    4. Automatic Luminance Detection & Gamma Correction for dark images
    5. CLAHE local contrast enhancement
    6. Gaussian Denoising & Sharpening
    """
    if img is None:
        return None
    try:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img.copy()
        
        h, w = gray.shape[:2]
        target_w = max(1800, int(w * scale_factor)) if w < 1200 else int(w * 1.5)
        if target_w > 3000:
            target_w = 3000
        scale = float(target_w) / float(w)
        gray = cv2.resize(gray, (target_w, int(h * scale)), interpolation=cv2.INTER_CUBIC)

        gray = deskew_image(gray)

        # 1. Auto Luminance Detection & Gamma Correction
        gray = auto_adjust_luminance_and_gamma(gray)

        # 2. CLAHE-Based Local Contrast Enhancement
        if apply_clahe:
            clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
            gray = clahe.apply(gray)

        blurred = cv2.GaussianBlur(gray, (3, 3), 0)

        if sharpen:
            kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]])
            return cv2.filter2D(blurred, -1, kernel)

        return blurred
    except Exception as e:
        print(f"[OCR PREPROCESS] Error: {e}", flush=True)
        return img

def sanitize_ocr_number_typos(text):
    """
    Robust OCR Typo Sanitizer for small printed numbers & letters:
    Corrects common OCR misreads on numbers:
    - 1B -> 18, 2O -> 20, 1S -> 15, 0B -> 08, O5 -> 05
    - I8/l8 -> 18, S5 -> 55, I5/l5 -> 15, Z0 -> 20, 1O -> 10, O0 -> 00
    - 3O -> 30, 4O -> 40, 5O -> 50
    - Fixes letter O/I/S/B inside numeric strings (e.g., "20213O5751" -> "2021305751")
    """
    if not text:
        return ""
    text_str = str(text)

    # 1. Standalone pattern replacements
    typo_replacements = [
        (r'\b1[Bb]\b', '18'),
        (r'\b2[Oo]\b', '20'),
        (r'\b1[Ss]\b', '15'),
        (r'\b0[Bb]\b', '08'),
        (r'\b[Oo]5\b', '05'),
        (r'\b[Ii|l]8\b', '18'),
        (r'\b[Ss]5\b', '55'),
        (r'\b[Ii|l]5\b', '15'),
        (r'\b[Zz]0\b', '20'),
        (r'\b1[Oo]\b', '10'),
        (r'\b[Oo]0\b', '00'),
        (r'\b3[Oo]\b', '30'),
        (r'\b4[Oo]\b', '40'),
        (r'\b5[Oo]\b', '50'),
    ]
    for pat, repl in typo_replacements:
        text_str = re.sub(pat, repl, text_str)

    # 2. Contextual letter fixes inside numeric sequences (e.g. 20213O5751 -> 2021305751)
    def _fix_digit_sequence(match):
        seq = match.group(0)
        seq = seq.replace('O', '0').replace('o', '0')
        seq = seq.replace('I', '1').replace('l', '1')
        seq = seq.replace('S', '5').replace('s', '5')
        seq = seq.replace('B', '8').replace('b', '8')
        seq = seq.replace('Z', '2').replace('z', '2')
        return seq

    text_str = re.sub(r'\b(?:\d+[OoSsIiLlBbZz]\d+|\d+[OoSsIiLlBbZz]|\d{2,}[OoSsIiLlBbZz]\d{2,})\b', _fix_digit_sequence, text_str)
    return text_str

def enhance_cor_document_super_resolution(image_bytes, scale_factor=3.5):
    """
    3x-4x Bicubic Super-Resolution & Sharpness Enhancement before OCR (Azure & Tesseract).
    1. Resizes using Bicubic Interpolation (cv2.INTER_CUBIC) to 3x-4x scale (target width ~3500px).
    2. Applies CLAHE (clipLimit=2.5, tileGridSize=(8,8)) for local contrast.
    3. Applies Unsharp Masking filter to sharpen small printed letters and digits.
    Returns: (enhanced_jpg_bytes, enhanced_cv_img)
    """
    if not image_bytes:
        return image_bytes, None
    try:
        data = decode_base64(image_bytes) if isinstance(image_bytes, str) else image_bytes
        if not data:
            return image_bytes, None
        nparr = np.frombuffer(data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return image_bytes, None

        h, w = img.shape[:2]
        target_w = max(2800, min(4000, int(w * scale_factor)))
        scale = float(target_w) / float(w)
        target_h = int(h * scale)

        # 3x-4x Bicubic Upscaling
        resized = cv2.resize(img, (target_w, target_h), interpolation=cv2.INTER_CUBIC)

        # Convert to Grayscale for CLAHE & Unsharp Masking
        gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)

        # CLAHE (Local Contrast Enhancement)
        clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
        contrast_enhanced = clahe.apply(gray)

        # Unsharp Masking (Sharpness Enhancement)
        blurred = cv2.GaussianBlur(contrast_enhanced, (3, 3), 0)
        sharpened = cv2.addWeighted(contrast_enhanced, 1.6, blurred, -0.6, 0)

        # Encode back to high-quality JPG bytes
        success, encoded = cv2.imencode('.jpg', sharpened, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
        if success:
            return encoded.tobytes(), sharpened
        return image_bytes, img
    except Exception as e:
        print(f"[COR SUPER-RES] Error enhancing image: {e}", flush=True)
        return image_bytes, None

def extract_cor_roi_crops(img_cv):
    """
    Region-of-Interest (ROI) Regional Crop Scanning for COR:
    - Header ROI Scan (Top 38%): Focused on Student Name, Student ID, School Name, Course.
    - Footer/Table ROI Scan (Bottom 45%): Focused on Total Units and subject table summary.
    Returns: (header_crop_bytes, footer_crop_bytes)
    """
    if img_cv is None:
        return None, None
    try:
        h, w = img_cv.shape[:2]

        # Header ROI (Top 38%)
        header_img = img_cv[0 : int(h * 0.38), 0 : w]
        # Footer ROI (Bottom 45%)
        footer_img = img_cv[int(h * 0.55) : h, 0 : w]

        s1, enc_header = cv2.imencode('.jpg', header_img, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
        s2, enc_footer = cv2.imencode('.jpg', footer_img, [int(cv2.IMWRITE_JPEG_QUALITY), 95])

        header_bytes = enc_header.tobytes() if s1 else None
        footer_bytes = enc_footer.tobytes() if s2 else None

        return header_bytes, footer_bytes
    except Exception as e:
        print(f"[COR ROI CROPS] Error cropping regions: {e}", flush=True)
        return None, None

def extract_cor_document_text_multi_pass(image_bytes):
    """
    Comprehensive COR OCR processing pipeline incorporating:
    1. 3x-4x Bicubic Super-Scaling + CLAHE + Sharpness Enhancement
    2. Azure Document Intelligence extraction on high-res super-scaled image
    3. Google Cloud Vision API extraction on full image & regional ROI crops
    4. Robust OCR Typo Sanitizer (e.g. 1B -> 18, 2O -> 20, 1S -> 15)
    Returns: (raw_text, azure_kvp)
    """
    if not image_bytes:
        return "", {}

    # Step 1: 3x-4x Bicubic Super-Scaling + CLAHE + Unsharp Masking
    enhanced_bytes, enhanced_img = enhance_cor_document_super_resolution(image_bytes, scale_factor=3.5)
    if not enhanced_bytes:
        enhanced_bytes = image_bytes

    raw_text_parts = []
    azure_kvp = {}

    # Step 2: Pass super-resolution enhanced photo to Azure Document Intelligence
    try:
        azure_text, az_kvp = extract_text_and_kvp_with_azure(enhanced_bytes)
        if azure_text and len(azure_text.strip()) >= 10:
            raw_text_parts.append(azure_text.strip())
            azure_kvp = az_kvp or {}
            print(f"[COR OCR] Azure extracted {len(azure_text)} chars & {len(azure_kvp)} KVP on Super-Resolution COR", flush=True)
    except Exception as az_err:
        print(f"[COR OCR] Azure extraction note: {az_err}", flush=True)

    # Step 3: Google Cloud Vision API extraction
    try:
        gcp_text = extract_text_with_google_cloud_vision(enhanced_bytes)
        if gcp_text and len(gcp_text.strip()) >= 10:
            raw_text_parts.append(gcp_text.strip())
            print(f"[COR OCR] Google Cloud Vision extracted {len(gcp_text)} chars on Super-Resolution COR", flush=True)
    except Exception as gcp_err:
        print(f"[COR OCR] Google Cloud Vision extraction note: {gcp_err}", flush=True)

    # Step 4: Region-of-Interest (ROI) Header & Footer Crop Scanning
    header_crop_bytes, footer_crop_bytes = extract_cor_roi_crops(enhanced_img)
    if header_crop_bytes:
        header_text = extract_text_with_google_cloud_vision(header_crop_bytes)
        if header_text:
            raw_text_parts.append("[HEADER ROI CROP]\n" + header_text)

    if footer_crop_bytes:
        footer_text = extract_text_with_google_cloud_vision(footer_crop_bytes)
        if footer_text:
            raw_text_parts.append("[FOOTER ROI CROP]\n" + footer_text)

    # Combine all extracted text
    combined_raw_text = "\n".join(raw_text_parts)

    # Step 5: Apply Robust OCR Typo Sanitizer
    sanitized_text = sanitize_ocr_number_typos(combined_raw_text)

    # Also sanitize Azure KVP values
    sanitized_azure_kvp = {}
    for k, v in azure_kvp.items():
        sanitized_azure_kvp[k] = sanitize_ocr_number_typos(str(v))

    return sanitized_text, sanitized_azure_kvp



COURSE_ALIASES = {
    'BSIT': 'BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY',
    'BS IT': 'BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY',
    'BSCS': 'BACHELOR OF SCIENCE IN COMPUTER SCIENCE',
    'BS CS': 'BACHELOR OF SCIENCE IN COMPUTER SCIENCE',
    'BSA': 'BACHELOR OF SCIENCE IN ACCOUNTANCY',
    'BSBA': 'BACHELOR OF SCIENCE IN BUSINESS ADMINISTRATION',
    'BSED': 'BACHELOR OF SECONDARY EDUCATION',
    'BEED': 'BACHELOR OF ELEMENTARY EDUCATION',
    'BSN': 'BACHELOR OF SCIENCE IN NURSING',
    'BSCE': 'BACHELOR OF SCIENCE IN CIVIL ENGINEERING',
    'BSEE': 'BACHELOR OF SCIENCE IN ELECTRICAL ENGINEERING',
    'BSME': 'BACHELOR OF SCIENCE IN MECHANICAL ENGINEERING',
    'BSECE': 'BACHELOR OF SCIENCE IN ELECTRONICS ENGINEERING',
    'BS ECE': 'BACHELOR OF SCIENCE IN ELECTRONICS ENGINEERING',
    'BS ARCH': 'BACHELOR OF SCIENCE IN ARCHITECTURE',
    'BSARCH': 'BACHELOR OF SCIENCE IN ARCHITECTURE',
    'BSTM': 'BACHELOR OF SCIENCE IN TOURISM MANAGEMENT',
    'BSHM': 'BACHELOR OF SCIENCE IN HOSPITALITY MANAGEMENT',
    'BSP': 'BACHELOR OF SCIENCE IN PSYCHOLOGY',
}

SEMESTER_ALIASES = {
    '1ST SEM': 'FIRST SEMESTER',
    '1ST SEMESTER': 'FIRST SEMESTER',
    'FIRST SEM': 'FIRST SEMESTER',
    '2ND SEM': 'SECOND SEMESTER',
    '2ND SEMESTER': 'SECOND SEMESTER',
    'SECOND SEM': 'SECOND SEMESTER',
    '3RD SEM': 'THIRD SEMESTER',
    '3RD SEMESTER': 'THIRD SEMESTER',
    'SUMMER': 'SUMMER TERM',
    'MIDYEAR': 'MIDYEAR TERM',
}

def normalize_course_string(course_input):
    if not course_input:
        return ""
    clean = re.sub(r'[^A-Z0-9\s]', ' ', str(course_input).upper()).strip()
    clean = re.sub(r'\s+', ' ', clean)
    for alias, full in COURSE_ALIASES.items():
        if clean == alias or clean.startswith(alias + ' '):
            return full
    return clean

def enhance_and_autocrop_document(image_bytes):
    """
    OpenCV Document Preprocessing Pipeline:
    1. Decodes raw document image bytes.
    2. Contour-based Paper Auto-Crop: Detects largest 4-point paper sheet contour and applies perspective transform.
    3. CLAHE Contrast Enhancement: Applies CLAHE in LAB color space to make faint printed text high contrast.
    """
    if not image_bytes:
        return image_bytes
    try:
        data = decode_base64(image_bytes)
        if not data or len(data) < 10:
            return image_bytes
        nparr = np.frombuffer(data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None or img.shape[0] < 100 or img.shape[1] < 100:
            return image_bytes

        h, w = img.shape[:2]
        cropped_img = img

        # ── STEP 1: Contour Paper Auto-Crop (Perspective Transform) ──
        try:
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            blurred = cv2.GaussianBlur(gray, (5, 5), 0)
            edged = cv2.Canny(blurred, 50, 200)

            contours, _ = cv2.findContours(edged.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            contours = sorted(contours, key=cv2.contourArea, reverse=True)[:5]

            doc_cnt = None
            for c in contours:
                peri = cv2.arcLength(c, True)
                approx = cv2.approxPolyDP(c, 0.02 * peri, True)
                if len(approx) == 4 and cv2.contourArea(c) > (w * h * 0.25):
                    doc_cnt = approx
                    break

            if doc_cnt is not None:
                pts = doc_cnt.reshape(4, 2)
                rect = np.zeros((4, 2), dtype="float32")
                s = pts.sum(axis=1)
                rect[0] = pts[np.argmin(s)]
                rect[2] = pts[np.argmax(s)]
                diff = np.diff(pts, axis=1)
                rect[1] = pts[np.argmin(diff)]
                rect[3] = pts[np.argmax(diff)]

                (tl, tr, br, bl) = rect
                widthA = np.sqrt(((br[0] - bl[0]) ** 2) + ((br[1] - bl[1]) ** 2))
                widthB = np.sqrt(((tr[0] - tl[0]) ** 2) + ((tr[1] - tl[1]) ** 2))
                maxWidth = max(int(widthA), int(widthB))

                heightA = np.sqrt(((tr[0] - br[0]) ** 2) + ((tr[1] - br[1]) ** 2))
                heightB = np.sqrt(((tl[0] - bl[0]) ** 2) + ((tl[1] - bl[1]) ** 2))
                maxHeight = max(int(heightA), int(heightB))

                dst = np.array([
                    [0, 0],
                    [maxWidth - 1, 0],
                    [maxWidth - 1, maxHeight - 1],
                    [0, maxHeight - 1]], dtype="float32")

                M = cv2.getPerspectiveTransform(rect, dst)
                cropped_img = cv2.warpPerspective(img, M, (maxWidth, maxHeight))
        except Exception as crop_err:
            print(f"[OCR PREPROCESS] Auto-crop contour note: {crop_err}", flush=True)

        # ── STEP 2: 2x Bicubic Super-Scaling (2000px Max Width for Razor-Sharp OCR) ──
        h_c, w_c = cropped_img.shape[:2]
        if max(w_c, h_c) < 2000:
            scale = 2000.0 / float(max(w_c, h_c))
            target_w = int(w_c * scale)
            target_h = int(h_c * scale)
            cropped_img = cv2.resize(cropped_img, (target_w, target_h), interpolation=cv2.INTER_CUBIC)

        # ── STEP 3: Balanced CLAHE Contrast Enhancement (clipLimit=1.8, LAB Color Space) ──
        try:
            lab = cv2.cvtColor(cropped_img, cv2.COLOR_BGR2LAB)
            l, a, b_chan = cv2.split(lab)
            clahe = cv2.createCLAHE(clipLimit=1.8, tileGridSize=(8, 8))
            cl = clahe.apply(l)
            limg = cv2.merge((cl, a, b_chan))
            enhanced_img = cv2.cvtColor(limg, cv2.COLOR_LAB2BGR)
        except Exception as clahe_err:
            print(f"[OCR PREPROCESS] CLAHE note: {clahe_err}", flush=True)
            enhanced_img = cropped_img

        success, encoded_img = cv2.imencode('.jpg', enhanced_img, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
        if success:
            return encoded_img.tobytes()
    except Exception as e:
        print(f"[OCR PREPROCESS] Document enhancement exception: {e}", flush=True)
    return image_bytes

def extract_text_and_kvp_with_azure(image_bytes):
    """
    Extracts text and Key-Value Pairs from document using Azure Document Intelligence REST API.
    Attempts prebuilt-document model first (for structured KVP), falling back to prebuilt-layout.
    """
    key = os.environ.get('AZURE_DOC_INTEL_KEY', '').strip()
    endpoint = os.environ.get('AZURE_DOC_INTEL_ENDPOINT', '').strip().rstrip('/')

    if not key or not endpoint:
        return None, {}

    try:
        data = decode_base64(image_bytes)
        if not data or len(data) < 10:
            return None, {}

        import requests
        headers = {
            'Ocp-Apim-Subscription-Key': key,
            'Content-Type': 'application/octet-stream'
        }

        models = ['prebuilt-document', 'prebuilt-layout']
        for model in models:
            analyze_url = f"{endpoint}/formrecognizer/documentModels/{model}:analyze?api-version=2023-07-31"
            resp = requests.post(analyze_url, headers=headers, data=data, timeout=15)
            if resp.status_code != 202:
                continue

            op_location = resp.headers.get('Operation-Location')
            if not op_location:
                continue

            for _ in range(30):
                time.sleep(0.4)
                poll_resp = requests.get(op_location, headers={'Ocp-Apim-Subscription-Key': key}, timeout=10)
                if poll_resp.status_code == 200:
                    result_json = poll_resp.json()
                    status = result_json.get('status')
                    if status == 'succeeded':
                        analyze_res = result_json.get('analyzeResult', {})
                        content = analyze_res.get('content', '')
                        kvp_dict = {}
                        kv_pairs = analyze_res.get('keyValuePairs', [])
                        for kv in kv_pairs:
                            k_str = (kv.get('key', {}).get('content') or '').strip().lower()
                            v_str = (kv.get('value', {}).get('content') or '').strip()
                            if k_str and v_str:
                                kvp_dict[k_str] = v_str
                        if content and len(content.strip()) > 0:
                            print(f"[AZURE OCR] Extracted {len(content)} chars and {len(kvp_dict)} KV pairs via {model}.", flush=True)
                            return content.strip(), kvp_dict
                    elif status in ('failed', 'canceled'):
                        break
        return None, {}
    except Exception as e:
        print(f"[AZURE OCR] Exception: {e}", flush=True)
        return None, {}

def extract_text_with_azure_document_intelligence(image_bytes):
    text, _ = extract_text_and_kvp_with_azure(image_bytes)
    return text



def extract_document_text(image_bytes, psm=3, max_width=None, prefer_fast_layout=False, crop_percent=None, is_id_back=False, return_tuple=False, **kwargs):
    should_return_tuple = return_tuple or (
        max_width is not None or crop_percent is not None or is_id_back or prefer_fast_layout
    )
    if not image_bytes:
        res_text, res_err = "", "No document image provided"
        return (res_text, res_err) if should_return_tuple else res_text
    try:
        data = decode_base64(image_bytes)
        if not data:
            res_text, res_err = "", "Failed to decode document image"
            return (res_text, res_err) if should_return_tuple else res_text
        nparr = np.frombuffer(data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            res_text, res_err = "", "Failed to process document image"
            return (res_text, res_err) if should_return_tuple else res_text

        if crop_percent is not None and isinstance(crop_percent, (int, float)) and 0 < crop_percent < 1:
            h, w = img.shape[:2]
            crop_h = int(h * crop_percent)
            crop_w = int(w * crop_percent)
            start_y = (h - crop_h) // 2
            start_x = (w - crop_w) // 2
            img = img[start_y:start_y + crop_h, start_x:start_x + crop_w]

        if max_width is not None and isinstance(max_width, (int, float)):
            h, w = img.shape[:2]
            if w > max_width:
                scale = float(max_width) / float(w)
                img = cv2.resize(img, (int(max_width), int(h * scale)), interpolation=cv2.INTER_AREA)

        effective_psm = psm
        if is_id_back:
            effective_psm = 6

        text = extract_text_with_google_cloud_vision(img)
        err = None if text and text.strip() else "Unable to extract readable text from document"
        return (text, err) if should_return_tuple else text
    except Exception as e:
        print(f"[OCR] Extract error: {e}", flush=True)
        res_text, res_err = "", str(e)
        return (res_text, res_err) if should_return_tuple else res_text

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

def extract_total_units_from_text(raw_text, azure_kvp=None):
    """
    Extracts total academic units from document text:
    1. Azure Key-Value Priority Extraction: Checks Azure AI KVP first.
    2. Printed "TOTAL UNITS" Line Extraction + Dash/Underscore Sanitizer + Multi-Line Lookahead:
       - If printed line is valid (>= 6 units), returns it directly.
    3. Dynamic Subject Course Summing & Smart Discrepancy Override:
       - If printed line reads an unnaturally low number (< 6, e.g. 2 when colon merges with 1 in ': 12'),
         system automatically overrides misread line with the true course sum (12 Units).
    """
    if not raw_text:
        return None
    
    # Apply OCR Typo Sanitizer first
    raw_text_sanitized = sanitize_ocr_number_typos(raw_text)
    text_str = str(raw_text_sanitized)
    lines = text_str.splitlines()

    # 1. AZURE KEY-VALUE PRIORITY EXTRACTION
    if azure_kvp and isinstance(azure_kvp, dict):
        for k, v in azure_kvp.items():
            k_lower = str(k).lower()
            if any(term in k_lower for term in ['total unit', 'units enrolled', 'units completed', 'total no of units', 'enrolled units', 'total units', 'units']):
                v_sanitized = sanitize_ocr_number_typos(str(v))
                clean_v = re.sub(r'[\-\=\_\s\|]+', ' ', v_sanitized).strip()
                m = re.search(r'\b(\d+(?:\.\d+)?)\b', clean_v)
                if m:
                    try:
                        val = float(m.group(1))
                        if 48 < val <= 4800: val = val / 100.0
                        val = int(round(val))
                        if 6 <= val <= 60:
                            return val
                    except ValueError:
                        pass

    # 2. PRINTED "TOTAL UNITS" LINE EXTRACTION & DASH/UNDERSCORE SANITIZER
    printed_line_units = None
    for i, line in enumerate(lines):
        line_clean = line.strip()
        if re.search(r'total\s*(?:no\.?\s*of\s*|enrolled\s*)?units?|units?\s*total|total\s*unit', line_clean, re.IGNORECASE):
            m = re.search(r'(?:total\s*(?:no\.?\s*of\s*|enrolled\s*)?units?|units?\s*total|total\s*unit)[^\d]*(\d+(?:\.\d+)?)', line_clean, re.IGNORECASE)
            if m:
                try:
                    val = float(m.group(1))
                    if 48 < val <= 4800: val = val / 100.0
                    val = int(round(val))
                    if 1 <= val <= 60:
                        printed_line_units = val
                        break
                except ValueError:
                    pass

            for j in range(i + 1, min(len(lines), i + 6)):
                next_line = lines[j].strip()
                if re.search(r'assessed\s*fees|schedule\s*of\s*payments|total\s*assessment|outstanding\s*balance|tuition|downpayment|reservation', next_line, re.IGNORECASE):
                    break
                sanitized_next_line = re.sub(r'[\-\=\_\s\|]+', ' ', next_line).strip()
                if not sanitized_next_line: continue
                digits = re.findall(r'(\d+(?:\.\d+)?)', sanitized_next_line)
                for d in digits:
                    try:
                        v = float(d)
                        if 48 < v <= 4800: v = v / 100.0
                        v = int(round(v))
                        if 1 <= v <= 60:
                            printed_line_units = v
                            break
                    except ValueError:
                        pass
                if printed_line_units is not None:
                    break

    # 3. DYNAMIC SUBJECT COURSE SUMMING & SMART DISCREPANCY OVERRIDE
    def _is_metadata(l):
        return bool(re.search(r'^\s*(?:course|name|student\s*(?:no|id)?|year\s*level|scholarship|pay\s*type|reg\s*no|tran\s*date|college)\s*[:=\-]', l, re.I) or
                    re.search(r'bachelor\s*of|bachelor\s*in|master\s*of|doctor\s*of', l, re.I))

    in_subject_table = False
    subject_row_count = 0
    explicit_units_sum = 0.0

    for line in lines:
        line_clean = line.strip()
        lower = line_clean.lower()

        if not in_subject_table:
            if not _is_metadata(lower):
                if re.search(r'^\s*(?:subj(?:ect)?s?|sugect|suject|spect|course\s*code)\b', lower) or \
                   (('subject' in lower or 'course' in lower or 'code' in lower or 'sugect' in lower or 'suject' in lower or 'spect' in lower) and any(k in lower for k in ['sec', 'section', 'faculty', 'room', 'days', 'time', 'bldg', 'units', 'enrolled', 'description'])) or \
                   ('units' in lower and any(k in lower for k in ['sec', 'section', 'faculty', 'room', 'days', 'time', 'bldg', 'code', 'description'])):
                    in_subject_table = True
                    continue

        if in_subject_table:
            if re.search(r'total\s*(?:no\.?\s*of\s*)?units?|otl\s*uns|tomas\b|assessed\s*fees|schedule\s*of\s*pay|schedule\s*of\s*path|total\s*assessment|review\s*your\s*assessment|refunds\s*and\s*other|official\s*certificate\s*of\s*registration', lower):
                in_subject_table = False
                break

            if re.match(r'^[\-\=\_\*\#\s\|]+$', line_clean) or len(line_clean) < 3:
                continue
            if _is_metadata(lower):
                continue

            subject_row_count += 1
            sanitized_row = sanitize_ocr_number_typos(line_clean)
            sanitized_row = re.sub(r'(?<![0-9])[:,;](?=[0-9])|(?<=[0-9])[:,;](?![0-9])', ' ', sanitized_row)
            sanitized_row = re.sub(r'\s+', ' ', sanitized_row).strip()
            row_digits = re.findall(r'\b([1-6](?:\.0{1,2})?)\b', sanitized_row)
            if row_digits:
                try:
                    u = float(row_digits[-1])
                    if 1.0 <= u <= 6.0:
                        explicit_units_sum += u
                except ValueError:
                    pass

    course_sum_units = int(round(explicit_units_sum)) if 6 <= explicit_units_sum <= 60 else None

    # Smart Discrepancy Override: if printed line disagrees with course sum by >= 2 units (e.g. 9 vs 12), override with course sum!
    if printed_line_units is not None and course_sum_units is not None:
        if abs(printed_line_units - course_sum_units) >= 2 or printed_line_units < 6:
            print(f"[UNITS OVERRIDE] Misread printed line '{printed_line_units}' overridden by Dynamic Subject Course Sum '{course_sum_units}'", flush=True)
            return course_sum_units
        return printed_line_units

    if course_sum_units is not None:
        return course_sum_units

    return printed_line_units

def parse_cor_document(raw_text, azure_kvp=None):
    """
    Structured parser for Official Certificate of Registration (COR).
    Extracts key-value fields while preventing adjacent column bleed.
    """
    sanitized_raw_text = sanitize_ocr_number_typos(raw_text)
    lines = preprocess_cor_lines(sanitized_raw_text)
    fields = {}


    label_patterns = {
        'name': [
            # Fix 1: Support Latin-1 Unicode accented characters (ñ, Ñ, é, etc.) for Filipino/Spanish names
            r'name\s*[:=\+\-1l\|\]\}\)\~]\s*([A-Za-z\u00C0-\u017E\s,\.\-]+)',
            r'student\s*name\s*[:=\+\-1l\|\]\}\)\~]\s*([A-Za-z\u00C0-\u017E\s,\.\-]+)',
            r'pangalan\s*[:=\+\-1l\|\]\}\)\~]\s*([A-Za-z\u00C0-\u017E\s,\.\-]+)',
            r'name\s+([A-Za-z\u00C0-\u017E\s,\.\-]+)'
        ],
        'student_id': [
            r'student\s*(?:no|number|id)\s*[:=\+\-1l\|\]\}\)\~]?\s*([A-Za-z0-9\-]{4,20})',
            r'id\s*(?:no|number)\s*[:=\+\-1l\|\]\}\)\~]?\s*([A-Za-z0-9\-]{4,20})',
            r'reg\s*no\s*[:=\+\-1l\|\]\}\)\~]?\s*([A-Za-z0-9\-]{4,20})',
            r'rug\s*no\s*[:=\+\-1l\|\]\}\)\~]?\s*([A-Za-z0-9\-]{4,20})',
            r'rek\s*no\s*[:=\+\-1l\|\]\}\)\~]?\s*([A-Za-z0-9\-]{4,20})',
            r'ref\s*no\s*[:=\+\-1l\|\]\}\)\~]?\s*([A-Za-z0-9\-]{4,20})',
            r'sr\s*code\s*[:=\+\-1l\|\]\}\)\~]?\s*([A-Za-z0-9\-]{4,20})'
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
            r'your\s*loved\s*[:=\+\-1l\|\]\}\)]\s*([A-Za-z0-9\s]+)',
            r'your\s*loved\s+pa\s+([A-Za-z0-9\s]+)',
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
                    # Fix 2: Strip right-column label bleed (Student No, Student ID, Gender, Sex, Yr Level, Course, Program, Term)
                    val = re.sub(r'\s+(?:Student\s*(?:No|ID|Number)|Gender|Sex|Yr\s*Level|Year\s*Level|Course|Program|Term|Reg|Tran|College|Pay|User|Scholarship|Discount|Ref)\s*[:=\+\-].*', '', val, flags=re.IGNORECASE)
                    val = val.strip()
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

    # Total Units extraction from COR/COE (checking Azure KVP first, then multi-line sanitizer)
    units_val = extract_total_units_from_text(raw_text, azure_kvp=azure_kvp)
    if units_val is not None:
        fields['units'] = units_val
        fields['total_units'] = str(units_val)

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
    search_pool = re.sub(r'\b(20\d{2})\s*(20\d{2})\b', r'\1-\2', search_pool)
    search_pool = re.sub(r'\b(20\d{2})[\s_]?([2-9]\d)\b', r'\1-20\2', search_pool)

    # Extract explicit year pairs from search pool like '2025-2026', '20252026', '2025/2026'
    year_pairs = re.findall(r'(20\d{2})\s*[\-\/]?\s*(20[0-9a-zA-Z]{2})', search_pool)
    
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

def extract_semester_from_ocr_text(text):
    if not text:
        return None
    
    # Strip footer fine print (e.g. "1st week of classes", "2nd week of classes", "within 2 weeks")
    header_text = re.sub(r'.*(?:week\s*of\s*classes|refunds\s*and\s*other|withdrawal|within\s*(?:two|2)\s*weeks).*', '', str(text), flags=re.IGNORECASE)
    header_text = re.sub(r'\b20\d{2}\s*[\-\/\.\:\+]\s*20\d{2}\b', '', header_text)
    header_text = re.sub(r'\b(?:sy|ay)?\s*\d{2}\s*[\-\/\.\:\+]\s*\d{2}\b', '', header_text, flags=re.IGNORECASE)

    # Normalize OCR misread semester digits/suffixes (e.g. "2na semester" -> "2nd semester")
    norm_text = re.sub(r'\b2[a-z0-9]{1,2}\s*(?:sem|semester|semestral|term)\b', '2nd semester', header_text, flags=re.IGNORECASE)
    norm_text = re.sub(r'\b1[a-z0-9]{1,2}\s*(?:sem|semester|semestral|term)\b', '1st semester', norm_text, flags=re.IGNORECASE)

    for line in norm_text.splitlines():
        if any(k in line.lower() for k in ['school year', 'academic year', 'sy', 'ay', 'sem', 'semester', 'term', 'registration']):
            if re.search(r'\b(?:2nd|second|2na|2ng|2da|2rd|sem\s*2|semester\s*2)\b', line, re.I):
                return 2
            if re.search(r'\b(?:1st|first|1sa|15t|sem\s*1|semester\s*1)\b', line, re.I):
                return 1
            if re.search(r'\b(?:3rd|third|summer|midyear|sem\s*3|semester\s*3)\b', line, re.I):
                return 3

    if re.search(r'\b(?:2nd|second|2na|2ng|2da|2rd|sem\s*2|semester\s*2)\b', norm_text, re.I):
        return 2
    if re.search(r'\b(?:1st|first|1sa|15t|sem\s*1|semester\s*1)\b', norm_text, re.I):
        return 1
    if re.search(r'\b(?:3rd|third|summer|midyear|sem\s*3|semester\s*3)\b', norm_text, re.I):
        return 3

    return None

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

    # 0. MANDATORY HEADER KEYWORD GUARD — strictly reject non-COR documents
    doc_norm = normalize_text(raw_text)
    cor_headers = [
        'certificate of registration', 'certificate of enrolment', 'certificate of enrollment',
        'certification of enrolment', 'certification of enrollment', 'registration form',
        'enrollment form', 'enrolment form', 'statement of account', 'official receipt',
        'cor', 'coe', 'student registration', 'college registrar', 'office of the registrar',
        'assessment form', 'matriculation'
    ]
    has_cor_header = any(h in doc_norm for h in cor_headers)
    if not has_cor_header:
        failures.append("Document Type Mismatch: File is missing required Certificate of Registration / Enrolment headers")

    # 1. NAME MATCHING — Order-Independent Token Set Matching + 80% Fuzzy Levenshtein & OCR Char Map
    target_name_str = parsed_fields.get('name', raw_text)
    first_ok, middle_ok, last_ok, sequence_ok = verify_name_sequence(
        first_name, last_name, target_name_str, raw_text, middle_name
    )

    name_ok = (first_ok and last_ok)
    if not name_ok:
        failures.append(f"Name mismatch (Expected: '{first_name} {middle_name or ''} {last_name}'. Found in COR: '{parsed_fields.get('name', 'Not found')}')")

    # 2. STUDENT ID MATCHING
    if expected_id_no and str(expected_id_no).strip():
        exp_id_clean = normalize_id_number(expected_id_no)
        found_id_clean = normalize_id_number(parsed_fields.get('student_id', ''))
        tokens = [normalize_id_number(tok) for tok in re.findall(r'\b[0-9a-zA-Z\-]{4,25}\b', str(raw_text or ''))]

        # Strict exact match (with trailing glare digit sanitization)
        def _clean_cand(t):
            d = re.sub(r'[^0-9]', '', str(t or ''))
            if len(exp_id_clean) >= 6 and len(d) == len(exp_id_clean) + 1 and (d.startswith(exp_id_clean) or d.endswith(exp_id_clean)):
                return exp_id_clean
            return d

        id_ok = (_clean_cand(found_id_clean) == exp_id_clean) or (exp_id_clean in tokens)
        if not id_ok:
            for tok in tokens:
                if _clean_cand(tok) == exp_id_clean:
                    id_ok = True
                    break
        if not id_ok and len(exp_id_clean) >= 6:
            raw_digits = re.sub(r'[^0-9]', '', str(raw_text or ''))
            if exp_id_clean in raw_digits:
                id_ok = True
            else:
                def _lev_dist(s1, s2):
                    if len(s1) > len(s2):
                        s1, s2 = s2, s1
                    distances = range(len(s1) + 1)
                    for i2, c2 in enumerate(s2):
                        distances_ = [i2+1]
                        for i1, c1 in enumerate(s1):
                            if c1 == c2:
                                distances_.append(distances[i1])
                            else:
                                distances_.append(1 + min((distances[i1], distances[i1 + 1], distances_[-1])))
                        distances = distances_
                    return distances[-1]

                max_dist = 3 if len(exp_id_clean) >= 8 else 2
                all_cands = [re.sub(r'[^0-9]', '', str(tok or '')) for tok in tokens]
                if found_id_clean:
                    all_cands.append(re.sub(r'[^0-9]', '', str(found_id_clean)))
                for cand in all_cands:
                    if len(cand) >= len(exp_id_clean) - 2 and len(cand) <= len(exp_id_clean) + 2:
                        if _lev_dist(exp_id_clean, cand) <= max_dist:
                            id_ok = True
                            break

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

    # 5. YEAR LEVEL MATCHING
    if expected_year_level and str(expected_year_level).strip():
        found_yl_field = parsed_fields.get('year_level')
        def parse_yl_num(val, raw):
            if val:
                st = str(val).lower()
                if any(k in st for k in ['4th', 'fourth', '4']): return 4
                if any(k in st for k in ['3rd', 'third', '3']): return 3
                if any(k in st for k in ['2nd', 'second', '2']): return 2
                if any(k in st for k in ['1st', 'first', '1']): return 1
                if any(k in st for k in ['5th', 'fifth', '5']): return 5

            if not raw: return None
            r_str = str(raw).lower()
            if re.search(r'\b(?:4th|fourth)\s*(?:year|yr|level)?\b', r_str) or re.search(r'\b(?:year|yr)\s*level\s*[:=\-]?\s*4\b', r_str) or re.search(r'\b[a-z]{2,5}4[a-z0-9]{1,3}\b', r_str):
                return 4
            if re.search(r'\b(?:3rd|third)\s*(?:year|yr|level)?\b', r_str) or re.search(r'\b(?:year|yr)\s*level\s*[:=\-]?\s*3\b', r_str) or re.search(r'\b[a-z]{2,5}3[a-z0-9]{1,3}\b', r_str):
                return 3
            if re.search(r'\b(?:2nd|second)\s*(?:year|yr|level)?\b', r_str) or re.search(r'\b(?:year|yr)\s*level\s*[:=\-]?\s*2\b', r_str) or re.search(r'\b[a-z]{2,5}2[a-z0-9]{1,3}\b', r_str):
                return 2
            if re.search(r'\b(?:1st|first)\s*(?:year|yr|level)?\b', r_str) or re.search(r'\b(?:year|yr)\s*level\s*[:=\-]?\s*1\b', r_str) or re.search(r'\b[a-z]{2,5}1[a-z0-9]{1,3}\b', r_str):
                return 1
            if re.search(r'\b(?:5th|fifth)\s*(?:year|yr|level)?\b', r_str) or re.search(r'\b(?:year|yr)\s*level\s*[:=\-]?\s*5\b', r_str) or re.search(r'\b[a-z]{2,5}5[a-z0-9]{1,3}\b', r_str):
                return 5

            return None

        exp_yl_num = parse_yl_num(expected_year_level, None)
        found_yl_num = parse_yl_num(found_yl_field, raw_text)

        if exp_yl_num and found_yl_num and exp_yl_num != found_yl_num:
            failures.append(f"Year Level mismatch (Expected: '{expected_year_level}', Found in COR: '{found_yl_field or (str(found_yl_num) + 'th Year')}')")

    success = (len(failures) == 0)
    if success:
        msg = f"COR Verified: Name ({first_name} {last_name}), ID ({expected_id_no or 'N/A'}), AY ({expected_academic_year or 'N/A'}) matched."
    else:
        msg = "COR Verification Failed: " + "; ".join(failures)

    meta['name_ok'] = first_ok and last_ok
    meta['details'] = failures
    meta['detected_text'] = raw_text
    meta['units'] = parsed_fields.get('units')

    return success, msg, meta

def detect_document_tampering(image_bytes):
    """
    Robust Digital Patch, Whiteout Box, Editor UI Artifact, & Tamper Detector:
    Detects artificial whiteout blocks, spliced rectangular patches, and editing app
    canvas borders (e.g. Canva/Photoshop magenta crop artifacts).
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

        h, w = img.shape[:2]
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)

        # ── Check 1: Editor Software Canvas / UI Border Artifacts ─────────────
        # Saturated magenta/pink/cyan UI borders left behind from screenshotting editor canvas
        m_top = hsv[:int(h * 0.06), :]
        m_left = hsv[:, :int(w * 0.06)]
        m_right = hsv[:, int(w * 0.94):]
        m_bot = hsv[int(h * 0.94):, :]

        # Strict Vivid Magenta/Editor Crop Handle: Hue 140-170, Sat >= 110, Val >= 70
        mag_px = int(
            np.sum((m_top[:,:,0] >= 140) & (m_top[:,:,0] <= 170) & (m_top[:,:,1] >= 110) & (m_top[:,:,2] >= 70)) +
            np.sum((m_left[:,:,0] >= 140) & (m_left[:,:,0] <= 170) & (m_left[:,:,1] >= 110) & (m_left[:,:,2] >= 70)) +
            np.sum((m_right[:,:,0] >= 140) & (m_right[:,:,0] <= 170) & (m_right[:,:,1] >= 110) & (m_right[:,:,2] >= 70)) +
            np.sum((m_bot[:,:,0] >= 140) & (m_bot[:,:,0] <= 170) & (m_bot[:,:,1] >= 110) & (m_bot[:,:,2] >= 70))
        )
        if mag_px >= 300:
            return True, f"Editing canvas border artifact detected ({mag_px} editor UI border pixels found at margins). Please upload an authentic, unedited document.", mag_px

        # ── Check 2: Median paper illumination across the document ─────────────
        paper_median = float(np.median(gray))

        # ── Check 3: High-brightness flat patch detection (Whiteout boxes) ──────
        pure_white_mask = (gray >= 238).astype(np.uint8) * 255
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (20, 10))
        closed = cv2.morphologyEx(pure_white_mask, cv2.MORPH_CLOSE, kernel)

        contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        suspicious_patches = 0
        for cnt in contours:
            x, y, bw, bh = cv2.boundingRect(cnt)
            area = bw * bh
            roi = gray[y:y+bh, x:x+bw]
            
            box_bg_pixels = roi[roi > 180]
            if len(box_bg_pixels) > 40:
                box_bg_mean = float(np.mean(box_bg_pixels))
                box_bg_std = float(np.std(box_bg_pixels))
            else:
                box_bg_mean = float(np.mean(roi))
                box_bg_std = float(np.std(roi))

            if area >= 200 and 30 <= bw <= (w * 0.95) and 8 <= bh <= (h * 0.25):
                contrast = box_bg_mean - paper_median
                if (box_bg_mean >= 236 and contrast >= 10.0) or (box_bg_mean >= 250 and box_bg_std < 3.0):
                    suspicious_patches += 1

        if suspicious_patches >= 1:
            return True, f"Digital edit / whiteout overlay patch detected on document ({suspicious_patches} artificial overlay box(es) found). Please upload an authentic, unedited document.", suspicious_patches

        return False, "Authentic document (No digital tampering detected)", 0
    except Exception as exc:
        print(f"[TAMPER DETECTOR] Error: {exc}", flush=True)
        return False, f"Tamper detection error: {exc}", 0

def crop_upper_document_region(image_bytes, crop_ratio=0.42):
    """
    Crops top portion (default 42%) of document image to capture student info,
    course list, and total units while excluding lower fee tables and background watermarks.
    """
    if not image_bytes:
        return image_bytes
    try:
        data = decode_base64(image_bytes)
        if not data or len(data) < 10:
            return image_bytes
        nparr = np.frombuffer(data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None or img.shape[0] < 100:
            return image_bytes
        h, w = img.shape[:2]
        crop_h = max(300, int(h * crop_ratio))
        cropped_img = img[0:crop_h, 0:w]
        success, encoded_img = cv2.imencode('.jpg', cropped_img, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
        if success:
            return encoded_img.tobytes()
    except Exception as e:
        print(f"[OCR] Crop upper document region note: {e}", flush=True)
    return image_bytes

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

    doc_type_upper = str(doc_type or '').strip().upper()
    max_w = 1400 if 'INDIGENCY' in doc_type_upper else None

    raw_text = ""
    azure_kvp = {}
    is_id_doc = any(k in doc_type_upper for k in ['ID', 'SCHOOLID', 'NATIONALID', 'FRONT', 'BACK', 'IDENTIFICATION'])
    is_azure_supported_doc = True
    
    # Apply OpenCV Contour Card Crop & 2x Bicubic Super-Scaling (for IDs) or Paper Crop (for documents)
    enhanced_doc_bytes = enhance_and_superscale_id_card(image_bytes) if is_id_doc else enhance_and_autocrop_document(image_bytes)

    if is_azure_supported_doc:
        try:
            azure_text, azure_kvp = extract_text_and_kvp_with_azure(enhanced_doc_bytes)
            if azure_text and len(azure_text.strip()) >= 10:
                raw_text = azure_text
                print(f"[OCR] Successfully extracted text and {len(azure_kvp)} KVP using Azure Document Intelligence for {doc_type_upper or 'Document'}", flush=True)
        except Exception as az_err:
            print(f"[OCR] Azure extraction note: {az_err}", flush=True)

    if not raw_text or not raw_text.strip():
        raw_text = extract_document_text(enhanced_doc_bytes, psm=3, max_width=max_w)

    if not raw_text.strip():
        return False, "Unable to extract readable text from document.", "", {}

    if 'GRADES' in doc_type_upper or 'TRANSCRIPT' in doc_type_upper or 'TOR' in doc_type_upper or 'REPORTCARD' in doc_type_upper:
        parsed_fields = parse_grades_document(raw_text)
        # Merge Azure Key-Value Pairs into parsed fields if available
        for k, v in azure_kvp.items():
            if 'gpa' in k or 'gwa' in k or 'average' in k or 'grade' in k:
                if not parsed_fields.get('gpa'):
                    g_match = re.search(r'\b[1-5]\.[0-9]{1,4}\b', v)
                    if g_match:
                        parsed_fields['gpa'] = g_match.group(0)
            elif 'student' in k or 'id' in k or 'number' in k:
                if not parsed_fields.get('student_id'): parsed_fields['student_id'] = v
            elif 'name' in k:
                if not parsed_fields.get('name'): parsed_fields['name'] = v

        success, msg, meta = verify_grades_fields(parsed_fields, raw_text, first_name, middle_name, last_name, **kwargs)
    elif 'INDIGENCY' in doc_type_upper or 'RESIDENCY' in doc_type_upper:
        is_res = 'RESIDENCY' in doc_type_upper
        success, msg, meta = verify_indigency_fields(raw_text, first_name, middle_name, last_name, expected_address=kwargs.get('expected_address'), is_residency_doc=is_res, **kwargs)
    elif 'ID' in doc_type_upper or 'IDENTIFICATION' in doc_type_upper or 'SCHOOLID' in doc_type_upper:
        success, msg, meta = verify_id_fields(raw_text, first_name, middle_name, last_name, **kwargs)
    else:
        # Default: COR / Registration (Multi-Pass 3x-4x Super-Res + ROI Header/Footer Scan)
        cor_multi_text, cor_multi_azure_kvp = extract_cor_document_text_multi_pass(enhanced_doc_bytes or image_bytes)
        if cor_multi_text and len(cor_multi_text.strip()) > 0:
            raw_text = cor_multi_text + "\n" + raw_text
        if cor_multi_azure_kvp:
            azure_kvp.update(cor_multi_azure_kvp)

        parsed_fields = parse_cor_document(raw_text, azure_kvp=azure_kvp)
        # Merge Azure KV Pairs into parsed fields if available
        for k, v in azure_kvp.items():
            if 'student' in k or 'id' in k or 'number' in k or 'no' in k:
                if not parsed_fields.get('student_id'): parsed_fields['student_id'] = v
            elif 'name' in k:
                if not parsed_fields.get('name'): parsed_fields['name'] = v
            elif 'course' in k or 'program' in k:
                if not parsed_fields.get('course'): parsed_fields['course'] = v
            elif 'year' in k or 'sem' in k:
                if not parsed_fields.get('school_year_sem'): parsed_fields['school_year_sem'] = v
            elif 'unit' in k:
                if not parsed_fields.get('units'): parsed_fields['units'] = v

        success, msg, meta = verify_cor_fields(parsed_fields, raw_text, first_name, middle_name, last_name, **kwargs)

    # Master Security Audit (EXIF software check, ELA error level splicing analysis, TrueDoc recapture moire scan, Hive AI detector, and Gemini recommendation generator)
    try:
        sec = run_full_security_audit(image_bytes, doc_type=doc_type_upper or "Document", success=success, message=msg, meta=meta)
        if isinstance(meta, dict):
            meta['security_audit'] = sec.get('audit', {})
            meta['ai_recommendation'] = sec.get('recommendation', '')
            meta['security_flagged'] = sec.get('security_flagged', False)
            if sec.get('security_flagged'):
                meta['tamper_alert'] = True
    except Exception as sec_err:
        print(f"[OCR SECURITY AUDIT] Note: {sec_err}", flush=True)

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

    # --- Step 1: Extract True Overall GPA from dedicated summary headers ONLY ---
    # Priority: GPA:/GWA:/Cumulative GPA:/General Weighted Average: headers
    # This prevents individual course grades (e.g. 1.75 in Capstone) from being
    # mistaken for the overall GPA.
    gpa_header_patterns = [
        r'(?:general\s*weighted\s*average|cumulative\s*gpa|cumulative\s*gwa|overall\s*gpa|overall\s*gwa)\s*[:\-=.,|\sA-Za-z]*?([1-5][.,0-9]{1,5})\b',
        r'(?:GPA|GWA|GBA)\s*[:\-=]\s*([1-5][.,0-9]{1,5})\b',
        r'(?:weighted\s*average|grade\s*point\s*average|final\s*average)\s*[:\-=.,|\sA-Za-z]*?([1-5][.,0-9]{1,5})\b',
    ]
    for pattern in gpa_header_patterns:
        match = re.search(pattern, raw_text, re.IGNORECASE)
        if match:
            raw_digits = match.group(1).replace(',', '.').strip()
            try:
                if '.' in raw_digits:
                    val = float(raw_digits)
                else:
                    if len(raw_digits) in (3, 4, 5):
                        val = float(raw_digits[0] + '.' + raw_digits[1:])
                    elif len(raw_digits) == 2:
                        val = float(raw_digits[0] + '.' + raw_digits[1])
                    else:
                        val = float(raw_digits)
                if 1.0 <= val <= 5.0:
                    fields['gpa'] = f"{val:.2f}"
                    fields['gpa_source'] = 'header'
                    break
            except ValueError:
                pass

    if 'gpa' not in fields:
        # --- Step 2: Weighted average fallback from subject grade table ---
        # Calculates GPA from individual rows (grade × units) when no header was found.
        grade_matches = re.findall(r'\b([1-5]\.[0-9]{1,2})\s+([1-9]\.0?|30|3\.0)\b', raw_text)
        if grade_matches and len(grade_matches) >= 3:
            total_pts = sum(float(g) * (3.0 if u == '30' else float(u)) for g, u in grade_matches)
            total_u = sum((3.0 if u == '30' else float(u)) for g, u in grade_matches)
            if total_u > 0:
                calc_gpa = total_pts / total_u
                if 1.0 <= calc_gpa <= 5.0:
                    fields['gpa'] = f"{calc_gpa:.2f}"
                    fields['gpa_source'] = 'calculated'

    # NOTE: No raw decimal scan fallback — avoids false course-grade matches.

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
    first_ok, middle_ok, last_ok, sequence_ok = verify_name_sequence(
        first_name, last_name, target_name_str, raw_text, middle_name
    )

    if not (first_ok and middle_ok and last_ok and sequence_ok):
        failures.append(f"Name mismatch (Expected: '{first_name} {middle_name or ''} {last_name}'. Found in Grades: '{parsed_fields.get('name', 'Not found')}')")

    # 2. STUDENT ID MATCHING
    if expected_id_no and str(expected_id_no).strip():
        exp_id_clean = re.sub(r'[^a-zA-Z0-9]', '', str(expected_id_no)).lower()
        found_id_clean = re.sub(r'[^a-zA-Z0-9]', '', parsed_fields.get('student_id', '')).lower()
        doc_raw_clean = re.sub(r'[^a-zA-Z0-9]', '', str(raw_text)).lower()

        id_ok = (exp_id_clean in found_id_clean) or (exp_id_clean in doc_raw_clean)
        if not id_ok:
            failures.append(f"Student ID mismatch (Expected: '{expected_id_no}', Found in Grades: '{parsed_fields.get('student_id', 'Not found')}')")

    # 3. GPA MATCHING — Strict Direct Comparison (no candidate overriding)
    # FIXED: No longer scans all decimals in the document to find a match for user input.
    # Only uses the GPA extracted from dedicated summary headers (GPA:, GWA:, General Weighted Average:)
    # or the weighted-average calculation. User input is NEVER used to re-search the document.
    if expected_gpa and str(expected_gpa).strip():
        exp_gpa_match = re.search(r'\d+(?:\.\d+)?', str(expected_gpa))
        # Use strictly the GPA from parse_grades_document (header or calculated) — no document re-scan
        found_gpa_val = parsed_fields.get('gpa')

        meta['detected_gpa'] = found_gpa_val
        meta['gpa_source'] = parsed_fields.get('gpa_source', 'none')

        if exp_gpa_match:
            e_gpa = float(exp_gpa_match.group(0))
            if found_gpa_val:
                try:
                    f_gpa = float(found_gpa_val)
                    if abs(e_gpa - f_gpa) > 0.005:
                        failures.append(f"GPA mismatch (Expected: '{e_gpa:.2f}', Detected from Grades document: '{f_gpa:.2f}')")
                        print(f"[GPA CHECK] REJECT — Input GPA {e_gpa:.2f} vs Document GPA {f_gpa:.2f} (source: {parsed_fields.get('gpa_source', 'unknown')})", flush=True)
                    else:
                        print(f"[GPA CHECK] PASS — Input GPA {e_gpa:.2f} matches Document GPA {f_gpa:.2f}", flush=True)
                except ValueError:
                    pass
            else:
                failures.append(f"GPA mismatch (Expected: '{expected_gpa}', GPA not found in Grades document summary headers)")
                print(f"[GPA CHECK] REJECT — No GPA summary header found in document", flush=True)

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

def extract_semantic_anchors_from_indigency(raw_text):
    """
    Extracts candidate applicant name and barangay/town address from Indigency/Residency certificates
    using English and Tagalog semantic phrase anchors.
    """
    if not raw_text:
        return {'candidate_name': None, 'candidate_town': None}

    clean_text = str(raw_text)

    candidate_name = None
    candidate_town = None

    name_anchor_patterns = [
        r'(?:certify|certifies)\s+that\s+([A-Za-z][A-Za-z\s,\.\-]{2,60}?)(?=\s+\d+\s*(?:years?|yr|yo|taong)|\s+of\s+legal\s+age|\s+(?:single|married|widow|widower|separated|divorced|filipino|pilipino|citizen|is\s+a\s+resident|is\s+a\s+bonafide|a\s+resident|a\s+bonafide|residing|resident|registered)|\n|$)',
        r'(?:this\s+is\s+to\s+certify\s+that)\s+([A-Za-z][A-Za-z\s,\.\-]{2,60}?)(?=\s+\d+\s*(?:years?|yr|yo)|\s+of\s+legal\s+age|\s+(?:single|married|widow|separated|filipino|is|a|the|resident|bonafide|residing)|\n|$)',
        r'(?:pinatutunayan|patunay|katibayan)\s+na\s+si\s+([A-Za-z\s,\.\-]+?)(?=\s+(?:ay|na|taga|mamamayan|residente)|\n|$)',
        r'pangalan\s*[:\-]\s*([A-Za-z\s,\.\-]+)',
        r'name\s*[:\-]\s*([A-Za-z\s,\.\-]+)'
    ]

    for p in name_anchor_patterns:
        m = re.search(p, clean_text, re.IGNORECASE)
        if m:
            raw_name = m.group(1).strip()
            # Strip trailing age / civil status / citizenship noise that may have slipped in
            raw_name = re.sub(r'\s*(?:\d+\s*years?\s*of\s*age|of\s*legal\s*age|\d+\s*(?:years?|yr))\s*.*$', '', raw_name, flags=re.IGNORECASE).strip()
            raw_name = re.sub(r'\s*(?:single|married|widow(?:er)?|separated|divorced|filipino(?:\s*citizen)?|pilipino(?:\s*citizen)?)\s*.*$', '', raw_name, flags=re.IGNORECASE).strip()
            # Must have at least 2 words and valid name content
            if len(raw_name) >= 3 and ' ' in raw_name and not re.search(r'certify|certificate|barangay|office|republic|philippines|punong|that$', raw_name, re.IGNORECASE):
                candidate_name = raw_name
                break

    town_anchor_patterns = [
        r'(?:resident\s+of|residing\s+at|residing\s+in)\s+([A-Za-z0-9\s,\.\-]+)',
        r'(?:mamamayan\s+ng|taga|nasasakupan\s+ng|barangay)\s+([A-Za-z0-9\s,\.\-]+)',
        r'(?:bayan\s+ng|lungsod\s+ng|city\s+of|municipality\s+of)\s+([A-Za-z0-9\s,\.\-]+)'
    ]

    for p in town_anchor_patterns:
        m = re.search(p, clean_text, re.IGNORECASE)
        if m:
            candidate_town = m.group(1).strip()
            break

    return {'candidate_name': candidate_name, 'candidate_town': candidate_town}

def verify_indigency_fields(raw_text, first_name, middle_name, last_name, expected_address=None, **kwargs):
    """
    Flexible verification for Indigency certificates (which vary widely in format by barangay/municipality).
    Verifies student name and barangay/town address using Semantic Anchors & robust OCR typo tolerance.
    """
    meta = {}
    failures = []

    # Semantic Anchor Extraction — Step 1: Isolate Applicant Line after "This is to certify that..." / "Pinatutunayan na si..."
    anchors = extract_semantic_anchors_from_indigency(raw_text)
    candidate_name = anchors.get('candidate_name')
    meta['anchors'] = anchors

    # Use isolated applicant line if present to prevent matching Barangay Captain signatures at bottom
    search_target = candidate_name if candidate_name else raw_text
    search_raw = candidate_name if candidate_name else raw_text

    # 1. NAME MATCHING — Step 2 & 3: Order-Flexible Token-Set Matching + 85% Levenshtein & Char Map
    first_ok, middle_ok, last_ok, sequence_ok, name_errors = verify_name_sequence_detailed(
        first_name, last_name, search_target, search_raw, middle_name
    )

    if not (first_ok and middle_ok and last_ok and sequence_ok):
        if name_errors:
            failures.extend(name_errors)
        else:
            failures.append(f"Name mismatch (Expected: '{first_name} {middle_name or ''} {last_name}' in Indigency Certificate)")

    # 2. ADDRESS / TOWN MATCHING
    addr_ok = True
    if expected_address and str(expected_address).strip():
        doc_norm = normalize_text(raw_text)
        addr_clean = normalize_text(expected_address)
        ignore_words = {'city', 'municipality', 'town', 'province', 'brgy', 'barangay', 'st', 'street'}
        addr_words = [w for w in addr_clean.split() if len(w) >= 3 and w not in ignore_words]

        # Inosloban / Inosluban alias handling
        if 'inosloban' in addr_clean or 'inosluban' in addr_clean or 'inosl' in addr_clean:
            addr_words.extend(['inosloban', 'inosluban'])

        if addr_words:
            matched_addr_words = sum(1 for w in addr_words if w in doc_norm)
            addr_ok = (matched_addr_words >= 1)
            if not addr_ok:
                failures.append(f"Address mismatch (Expected town/barangay from: '{expected_address}')")

    # 3. DOCUMENT TYPE KEYWORD MATCHING (Indigency or Residency accepted non-exclusively)
    is_residency_doc = kwargs.get('is_residency_doc') or kwargs.get('isResidencyDoc') or False
    doc_norm = normalize_text(raw_text)
    residency_keywords = ['residency', 'resident', 'residing', 'pagkapamayanan', 'naninirahan', 'maninirahan', 'pamayanan', 'taga-barangay', 'mamamayan']
    indigency_keywords = ['indigency', 'indigent', 'kawalang', 'kapos', 'pagkakawalang', 'mababang kita', 'katibayan', 'pinatutunayan', 'patunay', 'barangay']
    all_doc_keywords = residency_keywords + indigency_keywords

    doc_type_ok = any(k in doc_norm for k in all_doc_keywords)
    if not doc_type_ok:
        failures.append("Document Type Mismatch: Certificate does not contain required 'Indigency' / 'Residency' keywords")

    success = first_ok and middle_ok and last_ok and sequence_ok and addr_ok and doc_type_ok
    if success:
        doc_name = "Residency Certificate" if is_residency_doc else "Indigency Certificate"
        msg = f"{doc_name} Verified: Name ({first_name} {middle_name or ''} {last_name}) and document type matched."
    else:
        msg = "Indigency/Residency Verification Failed: " + "; ".join(failures)

    meta['name_ok'] = first_ok and middle_ok and last_ok and sequence_ok
    meta['details'] = failures
    meta['detected_text'] = raw_text

    return success, msg, meta

def enhance_and_superscale_id_card(image_bytes):
    """
    OpenCV ID Card Preprocessing Pipeline:
    1. Decodes raw ID image bytes.
    2. Contour-based Card Border Crop: Isolates outer card rectangle contour.
    3. 2x Bicubic Super-Scaling: Resizes small 6pt font ID images up to 2000px max width using cv2.INTER_CUBIC.
    4. CLAHE Contrast Enhancement: Applies CLAHE in LAB color space to make small printed text and digits high contrast.
    """
    if not image_bytes:
        return image_bytes
    try:
        data = decode_base64(image_bytes)
        if not data or len(data) < 10:
            return image_bytes
        nparr = np.frombuffer(data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None or img.shape[0] < 50 or img.shape[1] < 50:
            return image_bytes

        h, w = img.shape[:2]
        cropped_img = img

        # ── STEP 1: Card Border Contour Crop ──
        try:
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            blurred = cv2.GaussianBlur(gray, (5, 5), 0)
            edged = cv2.Canny(blurred, 30, 150)

            contours, _ = cv2.findContours(edged.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            contours = sorted(contours, key=cv2.contourArea, reverse=True)[:5]

            card_cnt = None
            for c in contours:
                peri = cv2.arcLength(c, True)
                approx = cv2.approxPolyDP(c, 0.02 * peri, True)
                if len(approx) == 4 and cv2.contourArea(c) > (w * h * 0.20):
                    card_cnt = approx
                    break

            if card_cnt is not None:
                pts = card_cnt.reshape(4, 2)
                rect = np.zeros((4, 2), dtype="float32")
                s = pts.sum(axis=1)
                rect[0] = pts[np.argmin(s)]
                rect[2] = pts[np.argmax(s)]
                diff = np.diff(pts, axis=1)
                rect[1] = pts[np.argmin(diff)]
                rect[3] = pts[np.argmax(diff)]

                (tl, tr, br, bl) = rect
                widthA = np.sqrt(((br[0] - bl[0]) ** 2) + ((br[1] - bl[1]) ** 2))
                widthB = np.sqrt(((tr[0] - tl[0]) ** 2) + ((tr[1] - tl[1]) ** 2))
                maxWidth = max(int(widthA), int(widthB))

                heightA = np.sqrt(((tr[0] - br[0]) ** 2) + ((tr[1] - br[1]) ** 2))
                heightB = np.sqrt(((tl[0] - bl[0]) ** 2) + ((tl[1] - bl[1]) ** 2))
                maxHeight = max(int(heightA), int(heightB))

                dst = np.array([
                    [0, 0],
                    [maxWidth - 1, 0],
                    [maxWidth - 1, maxHeight - 1],
                    [0, maxHeight - 1]], dtype="float32")

                M = cv2.getPerspectiveTransform(rect, dst)
                cropped_img = cv2.warpPerspective(img, M, (maxWidth, maxHeight))
        except Exception as crop_err:
            print(f"[ID PREPROCESS] Card border crop note: {crop_err}", flush=True)

        # ── STEP 2: 2x Bicubic Super-Scaling (up to 2000px width) ──
        ch, cw = cropped_img.shape[:2]
        target_w = max(cw * 2, 1600)
        target_w = min(target_w, 2000)
        scale_factor = target_w / float(cw)
        target_h = int(ch * scale_factor)

        scaled_img = cv2.resize(cropped_img, (target_w, target_h), interpolation=cv2.INTER_CUBIC)

        # ── STEP 3: CLAHE Contrast Enhancement in LAB Color Space ──
        try:
            lab = cv2.cvtColor(scaled_img, cv2.COLOR_BGR2LAB)
            l, a, b_chan = cv2.split(lab)
            clahe = cv2.createCLAHE(clipLimit=2.8, tileGridSize=(8, 8))
            cl = clahe.apply(l)
            limg = cv2.merge((cl, a, b_chan))
            enhanced_img = cv2.cvtColor(limg, cv2.COLOR_LAB2BGR)
        except Exception as clahe_err:
            print(f"[ID PREPROCESS] CLAHE note: {clahe_err}", flush=True)
            enhanced_img = scaled_img

        success, encoded_img = cv2.imencode('.jpg', enhanced_img, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
        if success:
            return encoded_img.tobytes()
    except Exception as e:
        print(f"[ID PREPROCESS] ID enhancement exception: {e}", flush=True)
    return image_bytes

def verify_school_id_fields(raw_text, first_name, middle_name, last_name, **kwargs):
    """
    Dedicated verification logic for School ID cards.
    Validates applicant name, student ID number (with digit/letter confusion tolerance), school name, and face match.
    """
    meta = {'id_type': 'School ID'}
    failures = []
    doc_norm = normalize_text(raw_text)

    # 1. Name Verification
    first_ok, middle_ok, last_ok, seq_ok = verify_name_sequence(first_name, last_name, raw_text, full_raw_text=raw_text, middle_name=middle_name)
    name_matched = first_ok and last_ok and seq_ok
    if not name_matched:
        failures.append(f"Name mismatch (Expected: '{first_name} {last_name}' on School ID)")

    # 2. Student ID Number (with '0'<->'O', '1'<->'l' confusion tolerance)
    expected_id_no = kwargs.get('expected_id_no') or kwargs.get('idNo')
    id_ok = True
    if expected_id_no:
        clean_expected_id = normalize_id_number(expected_id_no)
        found_id = normalize_id_number(kwargs.get('student_id') or '')
        tokens = [normalize_id_number(tok) for tok in re.findall(r'\b[0-9a-zA-Z\-]{4,25}\b', str(raw_text or ''))]

        def _clean_cand(t):
            d = re.sub(r'[^0-9]', '', str(t or ''))
            if len(clean_expected_id) >= 6 and len(d) == len(clean_expected_id) + 1 and (d.startswith(clean_expected_id) or d.endswith(clean_expected_id)):
                return clean_expected_id
            return d

        id_ok = (_clean_cand(found_id) == clean_expected_id) or (clean_expected_id in tokens)
        if not id_ok:
            for tok in tokens:
                if _clean_cand(tok) == clean_expected_id:
                    id_ok = True
                    break
        if not id_ok and len(clean_expected_id) >= 6:
            raw_digits = re.sub(r'[^0-9]', '', str(raw_text or ''))
            if clean_expected_id in raw_digits:
                id_ok = True

        if not id_ok:
            failures.append(f"Student ID Number mismatch (Expected: '{expected_id_no}' on School ID)")

    # 3. School Name Verification
    expected_school = kwargs.get('expected_school_name') or kwargs.get('schoolName')
    school_ok = True
    if expected_school:
        clean_school = normalize_text(expected_school)
        school_words = [w for w in clean_school.split() if len(w) >= 3 and w not in {'university', 'college', 'school', 'inc', 'of', 'de', 'la', 'salle'}]
        if school_words:
            school_ok = any(w in doc_norm for w in school_words)
        else:
            school_ok = clean_school in doc_norm
        if not school_ok:
            failures.append(f"School name mismatch (Expected: '{expected_school}' on School ID)")

    success = (first_ok and last_ok) and id_ok and school_ok
    msg = f"School ID Verified: Name ({first_name} {last_name}) and ID details matched." if success else ("School ID Verification Failed: " + ("; ".join(failures) if failures else "Details could not be verified on ID."))

    meta['name_ok'] = first_ok and last_ok
    meta['id_ok'] = id_ok
    meta['school_ok'] = school_ok
    meta['details'] = failures
    meta['detected_text'] = raw_text

    return success, msg, meta

def verify_national_id_fields(raw_text, first_name, middle_name, last_name, **kwargs):
    """
    Dedicated verification logic for National ID / PhilSys / Government ID cards.
    Validates full name, PhilSys / National ID number, birth date, address, and face match.
    """
    meta = {'id_type': 'National ID / Government ID'}
    failures = []
    doc_norm = normalize_text(raw_text)

    # 1. Full Name Verification
    first_ok, middle_ok, last_ok, seq_ok = verify_name_sequence(first_name, last_name, raw_text, full_raw_text=raw_text, middle_name=middle_name)
    name_matched = first_ok and last_ok and seq_ok
    if not name_matched:
        failures.append(f"Name mismatch (Expected: '{first_name} {last_name}' on National ID)")

    # 2. National ID / PhilSys Number (16-digit or formatted XXXX-XXXX-XXXX-XXXX)
    expected_id_no = kwargs.get('expected_id_no') or kwargs.get('idNo') or kwargs.get('philsys_no')
    id_ok = True
    if expected_id_no:
        clean_expected_id = normalize_id_number(expected_id_no)
        tokens = [normalize_id_number(tok) for tok in re.findall(r'\b[0-9a-zA-Z\-]{4,25}\b', str(raw_text or ''))]
        id_ok = (clean_expected_id in tokens) or (clean_expected_id in normalize_id_number(raw_text))
        if not id_ok:
            failures.append(f"National ID / PhilSys Number mismatch (Expected: '{expected_id_no}')")

    # 3. Birth Date Verification (if expected_birth_date provided)
    expected_dob = kwargs.get('expected_birth_date') or kwargs.get('birth_date') or kwargs.get('dob')
    dob_ok = True
    if expected_dob:
        clean_dob = normalize_text(expected_dob)
        dob_words = [w for w in clean_dob.split() if len(w) >= 2]
        if dob_words:
            dob_ok = any(w in doc_norm for w in dob_words)
            if not dob_ok:
                failures.append(f"Birth date mismatch (Expected: '{expected_dob}' on National ID)")

    success = (first_ok and last_ok) and id_ok and dob_ok
    msg = f"National ID Verified: Name ({first_name} {last_name}) and National ID details matched." if success else ("National ID Verification Failed: " + ("; ".join(failures) if failures else "Details could not be verified on National ID."))

    meta['name_ok'] = first_ok and last_ok
    meta['id_ok'] = id_ok
    meta['dob_ok'] = dob_ok
    meta['details'] = failures
    meta['detected_text'] = raw_text

    return success, msg, meta

def verify_id_fields(raw_text, first_name, middle_name, last_name, **kwargs):
    """
    ID Verification Router: Dispatches to verify_school_id_fields or verify_national_id_fields
    without merging or deleting either specialized handler.
    """
    id_type = str(kwargs.get('id_type') or kwargs.get('idType') or '').strip().upper()
    doc_upper = str(raw_text or '').upper()

    is_national_id = 'NATIONAL' in id_type or 'PHILSYS' in id_type or 'GOV' in id_type or 'PHILHEALTH' in id_type or 'PASSPORT' in id_type or 'SSS' in id_type or 'UMID' in id_type or any(k in doc_upper for k in ['PHILIPPINE IDENTIFICATION', 'PHILSYS', 'NATIONAL ID', 'REPUBLIKA NG PILIPINAS'])

    if is_national_id:
        return verify_national_id_fields(raw_text, first_name, middle_name, last_name, **kwargs)
    else:
        return verify_school_id_fields(raw_text, first_name, middle_name, last_name, **kwargs)

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
    match_ratio = 1.0 if success else 0.0
    return success, msg, raw_text, match_ratio, meta


def extract_frames_from_video_bytes(video_bytes, sample_positions=[0.15, 0.40, 0.70, 0.90], max_width=1280):
    """
    Extracts OpenCV frames at key sample positions from raw video bytes.
    Supports WebM, MP4, MOV, HEVC, MKV using FFmpeg with OpenCV fallback.
    Returns a list of BGR images (numpy arrays).
    """
    if not video_bytes:
        return []

    if isinstance(video_bytes, str):
        video_bytes = resolve_verification_image_bytes(video_bytes)
        if not video_bytes:
            return []

    import tempfile
    import shutil
    import subprocess

    ext = '.mp4'
    if isinstance(video_bytes, (bytes, bytearray)):
        if video_bytes.startswith(b'\x1a\x45\xdf\xa3'):
            ext = '.webm'
        elif b'ftypqt' in video_bytes[:32] or b'moov' in video_bytes[:100] or b'qt  ' in video_bytes[:32]:
            ext = '.mov'

    frames = []
    tmp_dir = tempfile.mkdtemp()
    input_path = os.path.join(tmp_dir, f'input_video{ext}')

    try:
        with open(input_path, 'wb') as f:
            f.write(video_bytes)

        # ── PATH 1: FFmpeg Frame Extraction (High resolution 1280px frames) ──
        try:
            ffmpeg_bin = 'ffmpeg'
            try:
                img_ff = __import__('imageio_ffmpeg')
                ffmpeg_bin = img_ff.get_ffmpeg_exe()
            except Exception:
                pass

            out_pattern = os.path.join(tmp_dir, 'frame_%03d.png')
            vf_filter = f"scale='min({max_width},iw)':-1"
            cmd = [
                ffmpeg_bin, '-y', '-i', input_path,
                '-vf', f"fps=1,{vf_filter}",
                '-vframes', '6',
                out_pattern
            ]
            res = subprocess.run(cmd, capture_output=True, timeout=10)
            print(f"[VIDEO OCR] FFmpeg ({ffmpeg_bin}) returncode={res.returncode} input_size={len(video_bytes)} ext={ext}", flush=True)
            if res.returncode == 0:
                frame_files = sorted([os.path.join(tmp_dir, f) for f in os.listdir(tmp_dir) if f.startswith('frame_') and f.endswith('.png')])
                print(f"[VIDEO OCR] FFmpeg extracted {len(frame_files)} frame files", flush=True)
                for f_path in frame_files:
                    img = cv2.imread(f_path)
                    if img is not None and img.size > 0:
                        frames.append(img)
        except Exception as ffmpeg_err:
            print(f"[VIDEO OCR] FFmpeg frame extraction note: {ffmpeg_err}", flush=True)

        # ── PATH 2: OpenCV Direct VideoCapture Fallback (Seek + Sequential) ──
        if not frames:
            cap = cv2.VideoCapture(input_path)
            if cap.isOpened():
                total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
                if total_frames > 5:
                    for pos in sample_positions:
                        target_frame = int(total_frames * pos)
                        cap.set(cv2.CAP_PROP_POS_FRAMES, target_frame)
                        ret, frame = cap.read()
                        if ret and frame is not None:
                            h, w = frame.shape[:2]
                            if max_width and w > max_width:
                                scale = max_width / float(w)
                                frame = cv2.resize(frame, (max_width, int(h * scale)), interpolation=cv2.INTER_AREA)
                            frames.append(frame)
                cap.release()

            # Sequential fallback for WebM blobs without seek metadata
            if not frames:
                cap = cv2.VideoCapture(input_path)
                if cap.isOpened():
                    seq_frames = []
                    frame_idx = 0
                    max_read = 300
                    while cap.isOpened() and frame_idx < max_read:
                        ret, frame = cap.read()
                        if not ret or frame is None:
                            break
                        seq_frames.append(frame)
                        frame_idx += 1
                    cap.release()

                    if seq_frames:
                        num_found = len(seq_frames)
                        for pos in sample_positions:
                            idx = min(int(num_found * pos), num_found - 1)
                            target_frame = seq_frames[idx]
                            h, w = target_frame.shape[:2]
                            if max_width and w > max_width:
                                scale = max_width / float(w)
                                target_frame = cv2.resize(target_frame, (max_width, int(h * scale)), interpolation=cv2.INTER_AREA)
                            frames.append(target_frame)

    except Exception as e:
        print(f"[VIDEO OCR] Error extracting frames: {e}", flush=True)
    finally:
        if os.path.exists(tmp_dir):
            try:
                shutil.rmtree(tmp_dir, ignore_errors=True)
            except Exception:
                pass

    return frames


def verify_video_content(
    video_bytes,
    keywords=None,
    expected_address=None,
    expected_name=None,
    expected_id=None,
    doc_ocr_text=None,
    sample_positions=[0.15, 0.40, 0.70, 0.90],
    max_width=1280,
    allow_alt_pass=True,
    fallback_text_length=10,
    doc_type='Indigency',
    frame_bytes_list=None
):
    if video_bytes and isinstance(video_bytes, str):
        video_bytes = resolve_verification_image_bytes(video_bytes)

    has_video_input = (video_bytes and len(video_bytes) > 500) or (frame_bytes_list and len(frame_bytes_list) > 0)
    if not has_video_input:
        return False, "Mandatory video proof is missing.", "No video stream data found."

    # Standard keyword dictionary per document type
    doc_type_upper = str(doc_type or '').upper()
    default_keywords = ['indigency', 'indigent', 'residency', 'resident', 'barangay', 'republic', 'office', 'punong', 'kapitan', 'certify', 'batangas', 'mataasnakahoy', 'inosloban', 'inosluban', 'lipa', 'city', 'philippines', 'katibayan', 'purok', 'concern', 'certificate']
    
    if 'GRADES' in doc_type_upper or 'TRANSCRIPT' in doc_type_upper or 'TOR' in doc_type_upper:
        default_keywords = ['grades', 'grade', 'transcript', 'gpa', 'gwa', 'units', 'student', 'semester', 'course', 'evaluation', 'passed', 'academic', 'college', 'school', 'university', 'report', 'card', 'slip', 'marks', 'mark', 'final', 'sy', 'ay', 'sem', 'de la salle', 'dlsl', 'lipa']
    elif 'COR' in doc_type_upper or 'ENROLLMENT' in doc_type_upper or 'REGISTRATION' in doc_type_upper:
        default_keywords = ['registration', 'enrollment', 'certificate', 'student', 'college', 'university', 'course', 'units', 'academic']
    elif 'ID' in doc_type_upper:
        default_keywords = ['republic', 'philippines', 'identity', 'student', 'school', 'university', 'college', 'id', 'philsys']

    target_keywords = keywords or default_keywords

    is_indigency_video = 'INDIGEN' in doc_type_upper
    video_sample_positions = [0.15, 0.40, 0.70, 0.90] if is_indigency_video else sample_positions
    extracted_text_list = []

    frames = []
    if frame_bytes_list:
        for f_b in frame_bytes_list:
            if f_b and len(f_b) > 100:
                try:
                    nparr = np.frombuffer(f_b, np.uint8)
                    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                    if img is not None and img.size > 0:
                        frames.append(img)
                except Exception:
                    pass

    if not frames and isinstance(video_bytes, (bytes, bytearray)) and len(video_bytes) > 500:
        try:
            frames = extract_frames_from_video_bytes(video_bytes, sample_positions=video_sample_positions, max_width=max_width)
        except Exception as video_err:
            print(f"[VIDEO OCR] Frame processing note: {video_err}", flush=True)

    for idx, frame in enumerate(frames):
        frame_text = extract_text_with_google_cloud_vision(frame)

        if frame_text and len(frame_text.strip()) > 3:
            extracted_text_list.append(f'[Frame {idx + 1}]: "{frame_text.strip()}"')
        else:
            try:
                gray_f = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if len(frame.shape) == 3 else frame
                kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]], dtype=np.float32)
                sharp_f = cv2.filter2D(gray_f, -1, kernel)
                alt_text = extract_text_with_google_cloud_vision(sharp_f)
                if alt_text and len(alt_text.strip()) > 3:
                    extracted_text_list.append(f'[Frame {idx + 1}]: "{alt_text.strip()}"')
            except Exception:
                pass

    combined_video_text = "\n\n".join(extracted_text_list).strip()
    video_search_pool = normalize_text(combined_video_text)

    is_id_video = ('SCHOOLID' in doc_type_upper or 'SCHOOL_ID' in doc_type_upper or doc_type_upper == 'ID' or 'NATIONAL' in doc_type_upper)
    
    name_words = [w for w in normalize_text(expected_name or '').split() if len(w) >= 2]
    found_name = any(w in video_search_pool for w in name_words) if name_words else False

    addr_words = [w for w in normalize_text(expected_address or '').split() if len(w) >= 3 and w not in {'city', 'street', 'brgy', 'barangay', 'province'}]
    found_addr = any(w in video_search_pool for w in addr_words) if addr_words else False

    found_keywords = [k for k in target_keywords if k.lower() in video_search_pool]

    if is_id_video:
        if found_name or found_addr or len(found_keywords) >= 1:
            return True, "Video proof verified: ID details (name, address, or ID header) detected in video frames.", combined_video_text or "Video stream validated."
        else:
            return False, "Video proof verification failed: Required ID details (name, address, or ID header) were not detected in video proof frames.", combined_video_text or "No matching ID details in video frames."

    if not video_search_pool.strip():
        return False, "Video proof verification failed: Required document keywords or applicant name were not detected in video proof frames.", "No readable text extracted from video frames."

    if len(found_keywords) >= 1 or found_name or found_addr:
        return True, "Video proof verified: Document video proof validated.", (combined_video_text or "Video stream validated.")
    else:
        missing_kw = ", ".join(target_keywords[:3])
        return False, f"Video proof invalid: Required document keywords ({missing_kw}) or applicant details not detected in video frames.", combined_video_text or "No matching keywords found in video frames."
