import os
import cv2
import numpy as np

try:
    from tensorflow.keras.applications import MobileNetV2
    from tensorflow.keras.applications.mobilenet_v2 import preprocess_input
    from tensorflow.keras.preprocessing import image
    TENSORFLOW_AVAILABLE = True
except Exception as exc:
    MobileNetV2 = None
    preprocess_input = None
    image = None
    TENSORFLOW_AVAILABLE = False
    print(f"[BRAIN] TensorFlow unavailable, using OpenCV fallback: {exc}", flush=True)

print(f"[BRAIN] Signature verification system initialized. TensorFlow Available: {TENSORFLOW_AVAILABLE}", flush=True)

# --- GLOBAL MODEL CACHE ---
# Using MobileNetV2 for its extreme efficiency on CPU
_SIGNATURE_MODELS = {}
_PROFILE_CACHE = {}
_BLACKLIST_CACHE = {}


def _normalize_vector(vector):
    if vector is None:
        return None

    vector = np.asarray(vector, dtype=np.float32).flatten()
    norm = np.linalg.norm(vector)
    if not np.isfinite(norm) or norm <= 1e-8:
        return None
    return vector / norm


def _cosine_similarity(vector_a, vector_b):
    normalized_a = _normalize_vector(vector_a)
    normalized_b = _normalize_vector(vector_b)
    if normalized_a is None or normalized_b is None:
        return 0.0
    return float(np.clip(np.dot(normalized_a, normalized_b), -1.0, 1.0))


def validate_signature_complexity(img_np):
    """
    Checks if a signature image has genuine handwriting complexity
    rather than a single straight line, dot, or blank stroke.
    Returns (is_valid, reason).
    """
    if img_np is None:
        return False, "No signature image provided."

    gray = cv2.cvtColor(img_np, cv2.COLOR_BGR2GRAY) if len(img_np.shape) == 3 else img_np
    
    # Threshold ink (assuming dark ink on light background)
    _, binary = cv2.threshold(gray, 220, 255, cv2.THRESH_BINARY_INV)
    
    ink_pixels = cv2.countNonZero(binary)
    if ink_pixels < 80:
        return False, "Signature is too faint or empty. Please draw a clearer signature."

    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return False, "No signature stroke detected."

    # Filter out tiny noise dots
    valid_contours = [c for c in contours if cv2.contourArea(c) > 15]
    if not valid_contours:
        return False, "Signature stroke is too small or faint."

    # Compute bounding box of all ink
    all_pts = np.vstack(valid_contours)
    x, y, w, h = cv2.boundingRect(all_pts)

    if h < 14:
        return False, "Submitted signature is too simple (e.g. a single straight line). Please draw your full handwritten signature."

    aspect_ratio = w / float(h) if h > 0 else 0.0
    
    # A single line has very high aspect ratio (> 6.0) and low vertical variation / simple contours
    if aspect_ratio > 6.0 and len(valid_contours) <= 3:
        return False, "Submitted signature is a single line. Please draw your complete signature."

    return True, "Valid"


def _extract_ink_crop(img_np):
    gray = cv2.cvtColor(img_np, cv2.COLOR_BGR2GRAY) if len(img_np.shape) == 3 else img_np
    
    # Simple CLAHE for contrast
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    
    # Adaptive threshold - larger block size to avoid hollow strokes in thick signatures
    binary = cv2.adaptiveThreshold(
        enhanced, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
        cv2.THRESH_BINARY_INV, 31, 7
    )
    
    # Close tiny gaps but don't dilate significantly
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=1)
    
    # Remove isolated noise dots
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel, iterations=1)
    
    # Find contours and filter - DON'T fill holes aggressively
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        print("[BRAIN] No ink detected, using full canvas.", flush=True)
        return gray

    # Find bounding box of all significant contours
    min_area = max(30, int(gray.shape[0] * gray.shape[1] * 0.0005))
    all_x, all_y, all_w, all_h = [], [], [], []
    
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < min_area:
            continue
        x, y, w, h = cv2.boundingRect(contour)
        # Skip obvious underlines
        if w > gray.shape[1] * 0.6 and h < 10:
            continue
        all_x.append(x)
        all_y.append(y)
        all_w.append(x + w)
        all_h.append(y + h)
    
    if not all_x:
        print("[BRAIN] No significant components, using full canvas.", flush=True)
        return gray
    
    x = min(all_x)
    y = min(all_y)
    w = max(all_w) - x
    h = max(all_h) - y
    
    # Add padding
    pad = max(5, int(min(w, h) * 0.1))
    x_p, y_p = max(0, x - pad), max(0, y - pad)
    w_p = min(gray.shape[1] - x_p, w + 2 * pad)
    h_p = min(gray.shape[0] - y_p, h + 2 * pad)
    
    return gray[y_p:y_p + h_p, x_p:x_p + w_p]

def _prepare_signature_canvas(img_np, size=128):
    cropped = _extract_ink_crop(img_np)
    h_c, w_c = cropped.shape[:2]
    if h_c == 0 or w_c == 0:
        return None

    # Normalize ink crop to fill usable canvas area without blank margin exploits
    margin = 8
    usable_size = max(8, size - (margin * 2))

    resized = cv2.resize(cropped, (usable_size, usable_size), interpolation=cv2.INTER_AREA)
    canvas = np.full((size, size), 255, dtype=np.uint8)
    canvas[margin:margin + usable_size, margin:margin + usable_size] = resized
    return canvas


def prepare_signature_match_view(img_np, size=224):
    """
    Return the normalized canvas used by the matcher as a displayable BGR image.
    """
    canvas = _prepare_signature_canvas(img_np, size=size)
    if canvas is None:
        return None
    return cv2.cvtColor(canvas, cv2.COLOR_GRAY2BGR)


def _extract_classical_embedding(img_np):
    canvas = _prepare_signature_canvas(img_np, size=128)
    if canvas is None:
        return None

    _, binary = cv2.threshold(canvas, 200, 255, cv2.THRESH_BINARY_INV)

    # Stroke Thickness Normalization: Dilate thin strokes so digital stylus lines (2px) match paper marker lines (~6px)
    dilation_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    binary = cv2.dilate(binary, dilation_kernel, iterations=1)

    normalized_binary = binary.astype(np.float32) / 255.0

    downsampled = cv2.resize(normalized_binary, (64, 32), interpolation=cv2.INTER_AREA).flatten()
    horizontal_projection = normalized_binary.sum(axis=1)
    vertical_projection = normalized_binary.sum(axis=0)
    hu_moments = cv2.HuMoments(cv2.moments(binary)).flatten()
    hu_moments = np.sign(hu_moments) * np.log1p(np.abs(hu_moments))

    # Helper function to normalize components individually
    def _safe_normalize(v):
        v = np.asarray(v, dtype=np.float32)
        norm = np.linalg.norm(v)
        return v / norm if norm > 1e-8 else v

    # Normalize each feature sub-vector individually
    down_norm = _safe_normalize(downsampled)
    h_proj_norm = _safe_normalize(horizontal_projection)
    v_proj_norm = _safe_normalize(vertical_projection)
    hu_norm = _safe_normalize(hu_moments)

    # Combine with balanced weights (40% Hu moments topology, 30% projections, 30% spatial geometry)
    embedding = np.concatenate([
        hu_norm * 0.40, 
        h_proj_norm * 0.15, 
        v_proj_norm * 0.15, 
        down_norm * 0.30
    ])
    
    return _normalize_vector(embedding)


def get_signature_extractor():
    """
    Lazy-loads a pre-trained MobileNetV2 model for feature extraction.
    Weights are frozen (ImageNet pre-trained).
    """
    if not TENSORFLOW_AVAILABLE:
        return None

    if "mobilenet" not in _SIGNATURE_MODELS:
        print("[BRAIN] Initializing Neural Signature Extractor (MobileNetV2)...", flush=True)
        # Load pre-trained model without the classification head
        base_model = MobileNetV2(weights='imagenet', include_top=False, pooling='avg', input_shape=(224, 224, 3))
        _SIGNATURE_MODELS["mobilenet"] = base_model
    return _SIGNATURE_MODELS["mobilenet"]

def extract_signature_embedding(img_np):
    """
    Converts a signature image into a normalized classical shape descriptor.
    Bypasses generic ImageNet features to ensure high accuracy signature matching.
    """
    return _extract_classical_embedding(img_np)

def get_mean_profile_vector(student_id):
    """
    Loads ALL confirmed 'Real' signatures for a student and calculates their
    statistical centroid (Mean Vector). This is the "Learning" component.
    Results are cached to dramatically improve performance.
    """
    try:
        history_dir = os.path.join(os.getcwd(), 'knowledge', 'signature_profiles', 'history', str(student_id))
        files = []
        if os.path.exists(history_dir):
            files = [f for f in os.listdir(history_dir) if f.endswith('.png')]
            
        # Cache check
        if student_id in _PROFILE_CACHE and _PROFILE_CACHE[student_id].get('count') == len(files):
            return _PROFILE_CACHE[student_id]['mean_vector']

        if not files:
            # Fallback to the single master profile if history doesn't exist yet
            master_profile = os.path.join(os.getcwd(), 'knowledge', 'signature_profiles', f"{student_id}.png")
            if os.path.exists(master_profile):
                if student_id in _PROFILE_CACHE and _PROFILE_CACHE[student_id].get('master_only') == True:
                    return _PROFILE_CACHE[student_id]['mean_vector']
                
                img = cv2.imread(master_profile)
                if img is not None:
                    print(f"[BRAIN] Using master profile for {student_id}", flush=True)
                    embedding = extract_signature_embedding(img)
                    _PROFILE_CACHE[student_id] = {'count': 0, 'master_only': True, 'mean_vector': embedding}
                    return embedding
            return None
            
        embeddings = []
        print(f"[BRAIN] Loading {len(files)} training signatures for student {student_id}", flush=True)
        
        for file in files:
            file_path = os.path.join(history_dir, file)
            img = cv2.imread(file_path)
            if img is None:
                continue
            embedding = extract_signature_embedding(img)
            if embedding is not None:
                embeddings.append(embedding)
        
        if not embeddings:
            return None
        
        # Calculate the Centroid (Mean Vector)
        mean_vector = np.mean(embeddings, axis=0)
        normalized_mean = _normalize_vector(mean_vector)
        
        # Save to cache
        if normalized_mean is not None:
            _PROFILE_CACHE[student_id] = {'count': len(files), 'master_only': False, 'mean_vector': normalized_mean}
            
        return normalized_mean
    except Exception as e:
        print(f"[BRAIN] Mean vector calculation failed: {e}", flush=True)
        return None

def calculate_neural_match(drawing_img, student_id, current_embedding=None):
    """
    Matches a new drawing against the student's statistical neural history.
    Now also checks the BLACKLIST to penalize known 'Fake' patterns.
    """
    if current_embedding is None:
        current_embedding = extract_signature_embedding(drawing_img)
    if current_embedding is None: 
        return 0.0
    
    # 1. Check Blacklist (Negative Learning) with Caching
    blacklist_dir = os.path.join(os.getcwd(), 'knowledge', 'signature_profiles', 'blacklist', str(student_id))
    b_files = []
    if os.path.exists(blacklist_dir):
        b_files = [f for f in os.listdir(blacklist_dir) if f.endswith('.png')]
        
    if b_files:
        if student_id not in _BLACKLIST_CACHE or _BLACKLIST_CACHE[student_id].get('count') != len(b_files):
            # Rebuild blacklist cache
            b_embeddings = []
            for file in b_files:
                b_img = cv2.imread(os.path.join(blacklist_dir, file))
                if b_img is None: continue
                b_emb = extract_signature_embedding(b_img)
                if b_emb is not None: b_embeddings.append(b_emb)
            _BLACKLIST_CACHE[student_id] = {'count': len(b_files), 'embeddings': b_embeddings}
        
        # Check against all cached blacklist embeddings
        for b_embedding in _BLACKLIST_CACHE[student_id].get('embeddings', []):
            sim = _cosine_similarity(current_embedding, b_embedding)
            if sim > 0.90:  # Very high similarity to a KNOWN fake
                print(f"[BRAIN] Blacklist HIT ({sim:.4f}). Applying penalty.", flush=True)
                return -0.5  # Heavy penalty
    
    # 2. Check History (Positive Learning)
    mean_real_vector = get_mean_profile_vector(student_id)
    if mean_real_vector is None: 
        return 0.0
    
    similarity = _cosine_similarity(current_embedding, mean_real_vector)
    print(f"[BRAIN] Profile similarity: {similarity:.6f} (Student {student_id})", flush=True)
    return float(similarity)

def compare_signature_images(submitted_img, reference_img, submitted_embedding=None):
    """
    Direct comparison between two signature images (usually submitted vs ID back).
    """
    embedding_a = submitted_embedding if submitted_embedding is not None else extract_signature_embedding(submitted_img)
    embedding_b = extract_signature_embedding(reference_img)
    
    if embedding_a is None or embedding_b is None:
        print("[BRAIN] Failed to extract one or both embeddings.", flush=True)
        return 0.0, embedding_a

    similarity = _cosine_similarity(embedding_a, embedding_b)
    print(f"[BRAIN] Direct signature similarity: {similarity:.6f} (using {'Neural' if TENSORFLOW_AVAILABLE else 'Classical'})", flush=True)
    return float(similarity), embedding_a

def get_training_count(student_id):
    """
    Returns the number of confirmed 'Real' signatures for a student.
    Used to decide how much trust to place in the Neural Brain.
    """
    try:
        history_dir = os.path.join(os.getcwd(), 'knowledge', 'signature_profiles', 'history', str(student_id))
        if not os.path.exists(history_dir): return 0
        return len([f for f in os.listdir(history_dir) if f.endswith('.png')])
    except:
        return 0

