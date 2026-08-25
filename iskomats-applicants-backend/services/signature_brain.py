import os
import cv2
import numpy as np
import logging

logger = logging.getLogger("verifier-bench-backend.signature_brain")

import importlib.util

TENSORFLOW_AVAILABLE = importlib.util.find_spec("tensorflow") is not None
print(f"[BRAIN] Signature verification system initialized. OpenCV Neural Engine Active. (TensorFlow Optional: {TENSORFLOW_AVAILABLE})", flush=True)

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
    
    _, binary = cv2.threshold(gray, 220, 255, cv2.THRESH_BINARY_INV)
    
    ink_pixels = cv2.countNonZero(binary)
    if ink_pixels < 80:
        return False, "Signature is too faint or empty. Please draw a clearer signature."

    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return False, "No signature stroke detected."

    valid_contours = [c for c in contours if cv2.contourArea(c) > 15]
    if not valid_contours:
        return False, "Signature stroke is too small or faint."

    all_pts = np.vstack(valid_contours)
    x, y, w, h = cv2.boundingRect(all_pts)

    if h < 14:
        return False, "Submitted signature is too simple (e.g. a single straight line). Please draw your full handwritten signature."

    aspect_ratio = w / float(h) if h > 0 else 0.0
    if aspect_ratio > 6.0 and len(valid_contours) <= 3:
        return False, "Submitted signature is a single line. Please draw your complete signature."

    return True, "Valid"


def _extract_ink_crop(img_np):
    gray = cv2.cvtColor(img_np, cv2.COLOR_BGR2GRAY) if len(img_np.shape) == 3 else img_np
    
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    
    binary = cv2.adaptiveThreshold(
        enhanced, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
        cv2.THRESH_BINARY_INV, 31, 7
    )
    
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=1)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel, iterations=1)
    
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return gray

    H, W = gray.shape[:2]
    valid_contours = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < max(25, int(H * W * 0.0003)):
            continue
        x, y, w, h = cv2.boundingRect(contour)
        cx_c = x + w / 2.0
        cy_c = y + h / 2.0
        aspect = w / float(h) if h > 0 else 0.0

        # 1. Filter out long horizontal underlines (wide & very thin)
        if (aspect > 6.0 and h <= 10 and w > W * 0.25 and cy_c > H * 0.40) or (aspect > 10.0 and h <= 12):
            continue

        # 2. Filter out printed "Signature" / "Date" text labels.
        #    These appear in the lower ~35% of the crop and are small isolated letter blobs
        if cy_c > H * 0.65 and h < 24 and area < 250 and aspect < 2.5:
            continue

        # 3. Filter out top header logos (star, seal, etc.).
        #    Logo blobs sit entirely in the top 35% of the image AND are compact/square
        if cy_c < H * 0.35 and (y + h) < H * 0.45:
            if 0.5 <= aspect <= 2.0 and area > 300:
                continue

        # 4. Drop isolated tiny dots far from the image centre
        cx_img, cy_img = W / 2.0, H / 2.0
        dist = ((cx_c - cx_img) ** 2 + (cy_c - cy_img) ** 2) ** 0.5
        max_dist = (cx_img ** 2 + cy_img ** 2) ** 0.5
        if area < 100 and dist > max_dist * 0.75:
            continue

        valid_contours.append((x, y, w, h, area))
    
    if not valid_contours:
        return gray
 
    # Anchor on the largest surviving contour (the main signature body)
    valid_contours.sort(key=lambda c: c[4], reverse=True)
    main_cy = valid_contours[0][1] + valid_contours[0][3] / 2.0

    filtered_pts = []
    for x, y, w, h, area in valid_contours:
        cy_c = y + h / 2.0
        # Discard small stray marks more than 40% of height away from the anchor
        if area < 150 and abs(cy_c - main_cy) > H * 0.40:
            continue
        filtered_pts.append((x, y, w, h))

    if not filtered_pts:
        filtered_pts = [(c[0], c[1], c[2], c[3]) for c in valid_contours]

    x = min(p[0] for p in filtered_pts)
    y = min(p[1] for p in filtered_pts)
    w = max(p[0] + p[2] for p in filtered_pts) - x
    h = max(p[1] + p[3] for p in filtered_pts) - y
    
    pad = max(6, int(min(w, h) * 0.08))
    x_p, y_p = max(0, x - pad), max(0, y - pad)
    w_p = min(W - x_p, w + 2 * pad)
    h_p = min(H - y_p, h + 2 * pad)
    
    return gray[y_p:y_p + h_p, x_p:x_p + w_p]

def _prepare_signature_canvas(img_np, size=128):
    cropped = _extract_ink_crop(img_np)
    h_c, w_c = cropped.shape[:2]
    if h_c == 0 or w_c == 0:
        return None

    margin = 8
    usable_size = max(8, size - (margin * 2))

    # Resize preserving aspect ratio
    scale = min(usable_size / float(w_c), usable_size / float(h_c))
    new_w = max(1, int(w_c * scale))
    new_h = max(1, int(h_c * scale))

    resized = cv2.resize(cropped, (new_w, new_h), interpolation=cv2.INTER_AREA)
    
    canvas = np.full((size, size), 255, dtype=np.uint8)
    y_offset = margin + (usable_size - new_h) // 2
    x_offset = margin + (usable_size - new_w) // 2
    canvas[y_offset:y_offset + new_h, x_offset:x_offset + new_w] = resized
    return canvas


def prepare_signature_match_view(img_np, size=224):
    canvas = _prepare_signature_canvas(img_np, size=size)
    if canvas is None:
        return None
    return cv2.cvtColor(canvas, cv2.COLOR_GRAY2BGR)


def _extract_classical_embedding(img_np):
    canvas = _prepare_signature_canvas(img_np, size=128)
    if canvas is None:
        return None

    _, binary = cv2.threshold(canvas, 200, 255, cv2.THRESH_BINARY_INV)

    dilation_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    binary = cv2.dilate(binary, dilation_kernel, iterations=1)

    normalized_binary = binary.astype(np.float32) / 255.0

    downsampled = cv2.resize(normalized_binary, (64, 32), interpolation=cv2.INTER_AREA).flatten()
    horizontal_projection = normalized_binary.sum(axis=1)
    vertical_projection = normalized_binary.sum(axis=0)
    hu_moments = cv2.HuMoments(cv2.moments(binary)).flatten()
    hu_moments = np.sign(hu_moments) * np.log1p(np.abs(hu_moments))

    def _safe_normalize(v):
        v = np.asarray(v, dtype=np.float32)
        norm = np.linalg.norm(v)
        return v / norm if norm > 1e-8 else v

    down_norm = _safe_normalize(downsampled)
    h_proj_norm = _safe_normalize(horizontal_projection)
    v_proj_norm = _safe_normalize(vertical_projection)
    hu_norm = _safe_normalize(hu_moments)

    embedding = np.concatenate([
        hu_norm * 0.40, 
        h_proj_norm * 0.15, 
        v_proj_norm * 0.15, 
        down_norm * 0.30
    ])
    
    return _normalize_vector(embedding)


def extract_signature_embedding(img_np):
    return _extract_classical_embedding(img_np)

def get_mean_profile_vector(student_id):
    try:
        history_dir = os.path.join(os.getcwd(), 'knowledge', 'signature_profiles', 'history', str(student_id))
        files = []
        if os.path.exists(history_dir):
            files = [f for f in os.listdir(history_dir) if f.endswith('.png')]
            
        if student_id in _PROFILE_CACHE and _PROFILE_CACHE[student_id].get('count') == len(files):
            return _PROFILE_CACHE[student_id]['mean_vector']

        if not files:
            return None
            
        embeddings = []
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
        
        mean_vector = np.mean(embeddings, axis=0)
        normalized_mean = _normalize_vector(mean_vector)
        
        if normalized_mean is not None:
            _PROFILE_CACHE[student_id] = {'count': len(files), 'master_only': False, 'mean_vector': normalized_mean}
            
        return normalized_mean
    except Exception as e:
        print(f"[BRAIN] Mean vector calculation failed: {e}", flush=True)
        return None

def calculate_neural_match(drawing_img, student_id, current_embedding=None):
    if current_embedding is None:
        current_embedding = extract_signature_embedding(drawing_img)
    if current_embedding is None: 
        return 0.0
    
    blacklist_dir = os.path.join(os.getcwd(), 'knowledge', 'signature_profiles', 'blacklist', str(student_id))
    b_files = []
    if os.path.exists(blacklist_dir):
        b_files = [f for f in os.listdir(blacklist_dir) if f.endswith('.png')]
        
    if b_files:
        if student_id not in _BLACKLIST_CACHE or _BLACKLIST_CACHE[student_id].get('count') != len(b_files):
            b_embeddings = []
            for file in b_files:
                b_img = cv2.imread(os.path.join(blacklist_dir, file))
                if b_img is None: continue
                b_emb = extract_signature_embedding(b_img)
                if b_emb is not None: b_embeddings.append(b_emb)
            _BLACKLIST_CACHE[student_id] = {'count': len(b_files), 'embeddings': b_embeddings}
        
        for b_embedding in _BLACKLIST_CACHE[student_id].get('embeddings', []):
            sim = _cosine_similarity(current_embedding, b_embedding)
            if sim > 0.90:
                print(f"[BRAIN] Blacklist HIT ({sim:.4f}). Applying penalty.", flush=True)
                return -0.5
    
    mean_real_vector = get_mean_profile_vector(student_id)
    if mean_real_vector is None: 
        return 0.0
    
    similarity = _cosine_similarity(current_embedding, mean_real_vector)
    return float(similarity)

def compare_signature_images(submitted_img, reference_img, submitted_embedding=None):
    embedding_a = submitted_embedding if submitted_embedding is not None else extract_signature_embedding(submitted_img)
    embedding_b = extract_signature_embedding(reference_img)
    
    if embedding_a is None or embedding_b is None:
        return 0.0, embedding_a

    base_similarity = _cosine_similarity(embedding_a, embedding_b)

    # Robust shape verification using Symmetric Chamfer Distance, Aspect Ratio, and Ink Density
    try:
        canvas_a = _prepare_signature_canvas(submitted_img, size=128)
        canvas_b = _prepare_signature_canvas(reference_img, size=128)

        if canvas_a is not None and canvas_b is not None:
            _, bin_a = cv2.threshold(canvas_a, 200, 255, cv2.THRESH_BINARY_INV)
            _, bin_b = cv2.threshold(canvas_b, 200, 255, cv2.THRESH_BINARY_INV)

            # Compute distance transforms for tolerance-based stroke matching
            dist_a = cv2.distanceTransform(255 - bin_a, cv2.DIST_L2, 3)
            dist_b = cv2.distanceTransform(255 - bin_b, cv2.DIST_L2, 3)

            tolerance = 3.0

            # Direct vector boolean indexing (5x faster than np.argwhere tuple indexing)
            mask_b = bin_b > 0
            fraction_b_in_a = float((dist_a[mask_b] <= tolerance).mean()) if np.any(mask_b) else 0.0

            mask_a = bin_a > 0
            fraction_a_in_b = float((dist_b[mask_a] <= tolerance).mean()) if np.any(mask_a) else 0.0

            # Stroke Overlap Ratio is the minimum of both directions to strictly penalize extra/missing strokes
            sor = min(fraction_b_in_a, fraction_a_in_b)

            # Compute aspect ratio penalty
            pts_a_y, pts_a_x = np.where(bin_a > 0)
            if len(pts_a_y) > 0:
                h_a = np.max(pts_a_y) - np.min(pts_a_y) + 1
                w_a = np.max(pts_a_x) - np.min(pts_a_x) + 1
                ar_a = w_a / float(h_a) if h_a > 0 else 1.0
            else:
                ar_a = 1.0

            pts_b_y, pts_b_x = np.where(bin_b > 0)
            if len(pts_b_y) > 0:
                h_b = np.max(pts_b_y) - np.min(pts_b_y) + 1
                w_b = np.max(pts_b_x) - np.min(pts_b_x) + 1
                ar_b = w_b / float(h_b) if h_b > 0 else 1.0
            else:
                ar_b = 1.0

            ar_diff = abs(ar_a - ar_b)
            ar_penalty = min(0.30, ar_diff * 0.15)

            # Compute ink density penalty
            density_a = np.count_nonzero(bin_a) / float(bin_a.size)
            density_b = np.count_nonzero(bin_b) / float(bin_b.size)
            density_diff = abs(density_a - density_b)
            density_penalty = min(0.30, max(0.0, density_diff - 0.08) * 1.5)

            # Calculate final combined similarity using SOR and classical features
            similarity = (sor * 0.70) + (base_similarity * 0.30)
            similarity = similarity - ar_penalty - density_penalty
            similarity = max(0.0, min(1.0, similarity))

            logger.info(f"[BRAIN] Direct match: base={base_similarity:.4f}, sor={sor:.4f} (B_in_A={fraction_b_in_a:.4f}, A_in_B={fraction_a_in_b:.4f}), ar_pen={ar_penalty:.4f}, den_pen={density_penalty:.4f} -> final={similarity:.4f}")
            return float(similarity), embedding_a
        else:
            return float(base_similarity), embedding_a
    except Exception as e:
        logger.exception(f"[BRAIN] Error in robust direct matching: {e}")
        return float(base_similarity), embedding_a

def get_training_count(student_id):
    try:
        history_dir = os.path.join(os.getcwd(), 'knowledge', 'signature_profiles', 'history', str(student_id))
        if not os.path.exists(history_dir): return 0
        return len([f for f in os.listdir(history_dir) if f.endswith('.png')])
    except:
        return 0
