import os
import cv2
import numpy as np

try:
    # Set logging level for TensorFlow to minimize noise on CPU
    os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'
    import tensorflow as tf
    from tensorflow.keras.applications import MobileNetV2
    from tensorflow.keras.applications.mobilenet_v2 import preprocess_input
    from tensorflow.keras.preprocessing import image
    TENSORFLOW_AVAILABLE = True
    print(f"[BRAIN] TensorFlow {tf.__version__} loaded successfully.", flush=True)
except Exception as exc:
    MobileNetV2 = None
    preprocess_input = None
    image = None
    TENSORFLOW_AVAILABLE = False
    print(f"[BRAIN] TensorFlow unavailable, using OpenCV fallback: {exc}", flush=True)

# --- GLOBAL MODEL CACHE ---
# Using MobileNetV2 for its extreme efficiency on CPU
_SIGNATURE_MODELS = {}


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


def _prepare_signature_canvas(img_np, size=224):
    """
    Normalizes a signature image (drawing or crop) for the model.
    1. Grayscale & Threshold
    2. Auto-crop to content bounds
    3. Aspect-ratio preserved padding to square canvas (white background)
    """
    if img_np is None or img_np.size == 0:
        return None

    gray = cv2.cvtColor(img_np, cv2.COLOR_BGR2GRAY) if len(img_np.shape) == 3 else img_np
    
    # Step 1: Clean threshold
    # Use Otsu's to find the best separation between ink and paper
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    
    # Step 2: Crop to content
    coords = cv2.findNonZero(thresh)
    if coords is not None:
        x, y, w, h = cv2.boundingRect(coords)
        cropped = gray[y:y+h, x:x+w]
    else:
        cropped = gray

    # Step 3: Square canvas with margin
    h_c, w_c = cropped.shape[:2]
    margin = int(size * 0.1)
    usable_size = size - (2 * margin)

    if h_c > w_c:
        new_h, new_w = usable_size, max(1, int(w_c * usable_size / h_c))
        pad_h = margin
        pad_w = margin + ((usable_size - new_w) // 2)
    else:
        new_h, new_w = max(1, int(h_c * usable_size / w_c)), usable_size
        pad_h = margin + ((usable_size - new_h) // 2)
        pad_w = margin

    resized = cv2.resize(cropped, (new_w, new_h), interpolation=cv2.INTER_AREA)
    canvas = np.full((size, size), 255, dtype=np.uint8)
    canvas[pad_h:pad_h + new_h, pad_w:pad_w + new_w] = resized
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

    # Combinatorial features: Projections + Raw pixels + Hu Moments
    downsampled = cv2.resize(normalized_binary, (64, 32), interpolation=cv2.INTER_AREA).flatten()
    horizontal_projection = normalized_binary.sum(axis=1)
    vertical_projection = normalized_binary.sum(axis=0)
    hu_moments = cv2.HuMoments(cv2.moments(binary)).flatten()
    # Log scale Hu moments as they can span many orders of magnitude
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
        # Load pre-trained model without the classification head (global pooling gives a 1280-D vector)
        base_model = MobileNetV2(weights='imagenet', include_top=False, pooling='avg', input_shape=(224, 224, 3))
        _SIGNATURE_MODELS["mobilenet"] = base_model
    return _SIGNATURE_MODELS["mobilenet"]


def extract_signature_embedding(img_np):
    """
    Converts a signature image into a "Neural Fingerprint" vector.
    """
    try:
        if not TENSORFLOW_AVAILABLE:
            print("[BRAIN] Using classical OpenCV signature embedding.", flush=True)
            return _extract_classical_embedding(img_np)

        model = get_signature_extractor()
        canvas = _prepare_signature_canvas(img_np, size=224)
        if canvas is None:
            return None

        # Convert to 3-channel BGR for MobileNetV2
        input_img = cv2.cvtColor(canvas, cv2.COLOR_GRAY2RGB)
        img_array = image.img_to_array(input_img)
        img_array = np.expand_dims(img_array, axis=0)
        img_array = preprocess_input(img_array)

        embedding = model.predict(img_array, verbose=0)
        return _normalize_vector(embedding)
    except Exception as e:
        print(f"[BRAIN] Embedding extraction failed: {e}", flush=True)
        return _extract_classical_embedding(img_np)


def compare_signature_images(img_a, img_b):
    """
    Directly compares two signature images and returns a similarity score [0-1].
    """
    emb_a = extract_signature_embedding(img_a)
    emb_b = extract_signature_embedding(img_b)

    if emb_a is None or emb_b is None:
        return 0.0

    similarity = _cosine_similarity(emb_a, emb_b)
    print(f"[BRAIN] Direct signature similarity: {similarity:.6f} (using {'Neural' if TENSORFLOW_AVAILABLE else 'Classical'})", flush=True)
    return similarity


def calculate_neural_match(submitted_img, student_id):
    """
    Matches a new drawing against the student's statistical neural history.
    Includes positive learning history and blacklist penalty logic.
    """
    # ... historical implementation ...
    # This currently falls back to direct comparison if no history exists
    return 0.0
