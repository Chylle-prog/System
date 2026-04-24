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

# --- GLOBAL CACHES ---
_SIGNATURE_MODELS = {}
_PROFILE_CACHE = {}   # { student_id: mean_vector }
_BLACKLIST_CACHE = {} # { student_id: [vector1, vector2, ...] }

def get_profile_weight(sample_count):
    """
    Returns how much to trust the profile based on number of training samples.
    """
    if sample_count < 3:
        return 0.0      # Too few samples, don't use profile at all
    elif sample_count < 10:
        return 0.20     # 20% profile, 80% direct comparison
    elif sample_count < 30:
        return 0.35     # 35% profile, 65% direct comparison
    elif sample_count < 100:
        return 0.50     # 50/50 split
    else:
        return 0.65     # 65% profile, 35% direct comparison (profile is more reliable)


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


def _extract_ink_crop(img_np):
    gray = cv2.cvtColor(img_np, cv2.COLOR_BGR2GRAY) if len(img_np.shape) == 3 else img_np
    
    # 1. Pre-process for clean binary - Lowered constant for faint ink (from 10 to 4)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    binary = cv2.adaptiveThreshold(
        enhanced, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
        cv2.THRESH_BINARY_INV, 31, 4
    )
    
    # 2. Noise Removal (Kill 'salt and pepper' dots)
    binary = cv2.medianBlur(binary, 3)
    
    # 3. Geometric Noise Removal (Erase boxes and straight lines)
    # Find all components
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    h_img, w_img = binary.shape[:2]
    
    clean_mask = np.zeros_like(binary)
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        area = cv2.contourArea(cnt)
        if area < 40: continue
        
        solidity = area / float(w * h) if w * h > 0 else 0
        aspect = w / float(h) if h > 0 else 0
        
        # REJECT BOXES/LINES: 
        # Perfect rectangles (boxes) have very high solidity (>0.8)
        # Long lines have very high aspect ratios
        if solidity > 0.85 and (w > w_img * 0.15 or h > h_img * 0.15):
            continue # Likely a box border
        if aspect > 8.0 or aspect < 0.12:
            continue # Likely an underline or side bar
            
        # Complexity check: Handwriting is curvy/complex
        peri = cv2.arcLength(cnt, True)
        complexity = peri / (np.sqrt(area) + 1)
        if complexity < 2.5 and solidity > 0.5:
            continue # Likely a printed character or small geometric mark
            
        cv2.drawContours(clean_mask, [cnt], -1, 255, -1)

    # 3. Component Filter: Keep only the most significant strokes
    # Printed text and noise specks are made of many tiny components.
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(clean_mask, connectivity=8)
    if num_labels > 2: # 1 is background
        areas = stats[1:, 4]
        max_area = np.max(areas)
        
        final_mask = np.zeros_like(clean_mask)
        for i in range(1, num_labels):
            # Noise Floor: Ignore anything smaller than 60 pixels
            if stats[i, 4] < 60: continue
            
            # Keep component if it's large enough relative to the main stroke
            if stats[i, 4] > (max_area * 0.12) or stats[i, 4] > 800:
                final_mask[labels == i] = 255
        clean_mask = final_mask

    # 4. Final Bounding Box on Cleaned Mask
    coords = cv2.findNonZero(clean_mask)
    if coords is None:
        return gray
    
    x, y, w, h = cv2.boundingRect(coords)
    pad = max(4, int(min(w, h) * 0.08))
    return gray[max(0, y-pad):min(h_img, y+h+pad), 
                max(0, x-pad):min(w_img, x+w+pad)]

def _prepare_signature_canvas(img_np, size=224):
    cropped = _extract_ink_crop(img_np)
    if cropped is None or cropped.size == 0:
        return np.full((size, size), 255, dtype=np.uint8)

    # 1. Standardize size while maintaining aspect ratio
    h_c, w_c = cropped.shape[:2]
    usable_size = int(size * 0.82)
    if h_c > w_c:
        new_h, new_w = usable_size, max(1, int(w_c * usable_size / h_c))
    else:
        new_w, new_h = usable_size, max(1, int(h_c * usable_size / w_c))

    resized = cv2.resize(cropped, (new_w, new_h), interpolation=cv2.INTER_AREA)
    
    # 2. Standardize Stroke Thickness (Distance Transform method)
    # Binarize aggressively
    _, binary = cv2.threshold(resized, 120, 255, cv2.THRESH_BINARY_INV)
    
    # Use Distance Transform to find the 'spine' of the signature
    dist = cv2.distanceTransform(binary, cv2.DIST_L2, 5)
    
    # Create a 1-pixel skeleton by taking the peaks of the distance transform
    skeleton = np.zeros_like(binary)
    # A simple threshold on the distance transform isn't enough, 
    # we use a Laplacian-like peak detection
    kernel = np.array([[-1,-1,-1], [-1,8,-1], [-1,-1,-1]], dtype=np.float32)
    laplacian = cv2.filter2D(dist, -1, kernel)
    skeleton[laplacian > 0] = 255
    
    # Now RE-THICKEN to exactly 3 pixels for the AI
    # This makes both signatures look identical in 'boldness'
    thick_element = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    standardized = cv2.dilate(skeleton, thick_element, iterations=1)
    
    # 3. Center on Canvas (White ink on Black background for AI)
    canvas = np.zeros((size, size), dtype=np.uint8)
    pad_h = (size - new_h) // 2
    pad_w = (size - new_w) // 2
    canvas[pad_h:pad_h + new_h, pad_w:pad_w + new_w] = standardized
    
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
    normalized_binary = binary.astype(np.float32) / 255.0

    downsampled = cv2.resize(normalized_binary, (64, 32), interpolation=cv2.INTER_AREA).flatten()
    horizontal_projection = normalized_binary.sum(axis=1)
    vertical_projection = normalized_binary.sum(axis=0)
    hu_moments = cv2.HuMoments(cv2.moments(binary)).flatten()
    hu_moments = np.sign(hu_moments) * np.log1p(np.abs(hu_moments))

    embedding = np.concatenate([downsampled, horizontal_projection, vertical_projection, hu_moments])
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
    Converts a signature image into a 1280-D "Neural Fingerprint" vector.
    Now with Translation & Scale Invariance via Auto-Cropping.
    """
    if img_np is None or img_np.size == 0:
        return None

    try:
        if not TENSORFLOW_AVAILABLE:
            print("[BRAIN] Using classical OpenCV signature embedding.", flush=True)
            return _extract_classical_embedding(img_np)

        model = get_signature_extractor()
        if model is None:
            return _extract_classical_embedding(img_np)

        canvas_gray = _prepare_signature_canvas(img_np, size=224)
        if canvas_gray is None:
            return None

        canvas = cv2.cvtColor(canvas_gray, cv2.COLOR_GRAY2BGR)
        x = image.img_to_array(canvas)
        x = np.expand_dims(x, axis=0)
        x = preprocess_input(x)

        embedding = model.predict(x, verbose=0)
        return _normalize_vector(embedding)
    except Exception as e:
        print(f"[BRAIN] Embedding extraction failed: {e}", flush=True)
        return _extract_classical_embedding(img_np)

def get_mean_profile_vector(student_id):
    """
    Loads ALL confirmed 'Real' signatures for a student and calculates their
    statistical centroid (Mean Vector). This is the "Learning" component.
    """
    if student_id in _PROFILE_CACHE:
        return _PROFILE_CACHE[student_id]

    try:
        history_dir = os.path.join(os.getcwd(), 'knowledge', 'signature_profiles', 'history', str(student_id))
        if not os.path.exists(history_dir):
            # Fallback to the single master profile if history doesn't exist yet
            master_profile = os.path.join(os.getcwd(), 'knowledge', 'signature_profiles', f"{student_id}.png")
            if os.path.exists(master_profile):
                img = cv2.imread(master_profile)
                if img is not None:
                    print(f"[BRAIN] Using master profile for {student_id}", flush=True)
                    vec = extract_signature_embedding(img)
                    if vec is not None:
                        _PROFILE_CACHE[student_id] = vec
                    return vec
            return None
            
        embeddings = []
        files = [f for f in os.listdir(history_dir) if f.endswith('.png')]
        print(f"[BRAIN] Loading {len(files)} training signatures for student {student_id}", flush=True)
        
        for file in files:
            file_path = os.path.join(history_dir, file)
            img = cv2.imread(file_path)
            if img is None: continue
            embedding = extract_signature_embedding(img)
            if embedding is not None:
                embeddings.append(embedding)
        
        if not embeddings:
            return None
        
        # Calculate the Centroid (Mean Vector)
        mean_vector = np.mean(embeddings, axis=0)
        normalized_mean = _normalize_vector(mean_vector)
        if normalized_mean is not None:
            _PROFILE_CACHE[student_id] = normalized_mean
        return normalized_mean
    except Exception as e:
        print(f"[BRAIN] Mean vector calculation failed: {e}", flush=True)
        return None

def calculate_neural_match(drawing_img, student_id, pre_extracted_embedding=None):
    """
    Matches a new drawing against the student's statistical neural history.
    Now also checks the BLACKLIST to penalize known 'Fake' patterns.
    """
    current_embedding = pre_extracted_embedding if pre_extracted_embedding is not None else extract_signature_embedding(drawing_img)
    if current_embedding is None: 
        return 0.0
    
    # 1. Check Blacklist (Negative Learning)
    if student_id:
        if student_id not in _BLACKLIST_CACHE:
            _BLACKLIST_CACHE[student_id] = []
            blacklist_dir = os.path.join(os.getcwd(), 'knowledge', 'signature_profiles', 'blacklist', str(student_id))
            if os.path.exists(blacklist_dir):
                for file in os.listdir(blacklist_dir):
                    if not file.endswith('.png'): continue
                    b_img = cv2.imread(os.path.join(blacklist_dir, file))
                    if b_img is None: continue
                    b_embedding = extract_signature_embedding(b_img)
                    if b_embedding is not None:
                        _BLACKLIST_CACHE[student_id].append(b_embedding)
        
        for b_embedding in _BLACKLIST_CACHE[student_id]:
            sim = _cosine_similarity(current_embedding, b_embedding)
            if sim > 0.88:
                penalty = -0.3 - (sim - 0.88) * 4
                print(f"[BRAIN] Blacklist HIT ({sim:.4f}). Penalty: {penalty:.2f}", flush=True)
                return float(penalty)
    
    # 2. Check History (Positive Learning)
    sample_count = get_training_count(student_id)
    if sample_count < 3:
        return 0.0
    
    mean_real_vector = get_mean_profile_vector(student_id)
    if mean_real_vector is None: 
        return 0.0
    
    similarity = _cosine_similarity(current_embedding, mean_real_vector)
    return float(similarity)

def compare_signature_images(submitted_img, reference_img, pre_extracted_submitted=None):
    """
    Compare a submitted signature directly against a reference signature crop.
    """
    submitted_embedding = pre_extracted_submitted if pre_extracted_submitted is not None else extract_signature_embedding(submitted_img)
    if submitted_embedding is None:
        return 0.0

    reference_embedding = extract_signature_embedding(reference_img)
    if reference_embedding is None:
        return 0.0

    similarity = _cosine_similarity(submitted_embedding, reference_embedding)
    return float(similarity)

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

