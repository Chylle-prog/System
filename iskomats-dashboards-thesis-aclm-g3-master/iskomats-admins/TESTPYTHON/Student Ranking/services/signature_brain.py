import os
import cv2
import numpy as np
import tensorflow as tf
from tensorflow.keras.applications import MobileNetV2
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input
from tensorflow.keras.preprocessing import image
from sklearn.metrics.pairwise import cosine_similarity

# --- GLOBAL MODEL CACHE ---
# Using MobileNetV2 for its extreme efficiency on CPU
_SIGNATURE_MODELS = {}

def get_signature_extractor():
    """
    Lazy-loads a pre-trained MobileNetV2 model for feature extraction.
    Weights are frozen (ImageNet pre-trained).
    """
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
    try:
        model = get_signature_extractor()
        
        # 1. AUTO-CROP TO CONTENT (FIX FOR LEARNING FAILURE)
        # Convert to grayscale binary to find the ink bounding box
        gray = cv2.cvtColor(img_np, cv2.COLOR_BGR2GRAY) if len(img_np.shape) == 3 else img_np
        _, binary = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)
        coords = cv2.findNonZero(binary)
        
        if coords is not None:
            x, y, w, h = cv2.boundingRect(coords)
            # Add a small 10% padding around the ink for better context
            pad = int(min(w, h) * 0.1)
            x_p, y_p = max(0, x-pad), max(0, y-pad)
            w_p, h_p = min(img_np.shape[1]-x_p, w+2*pad), min(img_np.shape[0]-y_p, h+2*pad)
            cropped = img_np[y_p:y_p+h_p, x_p:x_p+w_p]
            print(f"[BRAIN] Auto-Cropping ink: {w}x{h} pixels detected.", flush=True)
        else:
            cropped = img_np
            print("[BRAIN] No ink detected, using full canvas.", flush=True)
            
        # 2. Resize and Pad to 224x224 (MobileNetV2 standard)
        h_c, w_c = cropped.shape[:2]
        size = 224
        if h_c > w_c:
            new_h, new_w = size, int(w_c * size / h_c)
            pad_w = (size - new_w) // 2
            pad_h = 0
        else:
            new_h, new_w = int(h_c * size / w_c), size
            pad_h = (size - new_h) // 2
            pad_w = 0
            
        resized = cv2.resize(cropped, (new_w, new_h))
        # Use white background for the 224x224 canvas
        canvas = np.full((size, size, 3), 255, dtype=np.uint8)
        
        # Convert back to BGR for MobileNetV2 compatibility
        if len(resized.shape) == 2:
            canvas[pad_h:pad_h+new_h, pad_w:pad_w+new_w] = cv2.cvtColor(resized, cv2.COLOR_GRAY2BGR)
        else:
            canvas[pad_h:pad_h+new_h, pad_w:pad_w+new_w] = resized
            
        # 3. Predict embedding
        x = image.img_to_array(canvas)
        x = np.expand_dims(x, axis=0)
        x = preprocess_input(x)
        
        embedding = model.predict(x, verbose=0)
        embedding_flat = embedding.flatten()
        # Normalize for consistent cosine similarity comparison
        embedding_normalized = embedding_flat / np.linalg.norm(embedding_flat)
        return embedding_normalized
    except Exception as e:
        print(f"[BRAIN] Embedding extraction failed: {e}", flush=True)
        return None

def get_mean_profile_vector(student_id):
    """
    Loads ALL confirmed 'Real' signatures for a student and calculates their
    statistical centroid (Mean Vector). This is the "Learning" component.
    """
    try:
        history_dir = os.path.join(os.getcwd(), 'knowledge', 'signature_profiles', 'history', str(student_id))
        if not os.path.exists(history_dir):
            # Fallback to the single master profile if history doesn't exist yet
            master_profile = os.path.join(os.getcwd(), 'knowledge', 'signature_profiles', f"{student_id}.png")
            if os.path.exists(master_profile):
                img = cv2.imread(master_profile)
                print(f"[BRAIN] Using master profile for {student_id}", flush=True)
                return extract_signature_embedding(img)
            return None
            
        embeddings = []
        files = [f for f in os.listdir(history_dir) if f.endswith('.png')]
        print(f"[BRAIN] Loading {len(files)} training signatures for student {student_id}", flush=True)
        
        for file in files:
            file_path = os.path.join(history_dir, file)
            img = cv2.imread(file_path)
            if img is None:
                print(f"[BRAIN] Failed to load {file}", flush=True)
                continue
            embedding = extract_signature_embedding(img)
            if embedding is not None:
                embeddings.append(embedding)
                print(f"[BRAIN] Loaded {file}: shape {embedding.shape}, norm {np.linalg.norm(embedding):.4f}", flush=True)
            else:
                print(f"[BRAIN] Failed to extract from {file}", flush=True)
        
        if not embeddings:
            print(f"[BRAIN] No valid embeddings!", flush=True)
            return None
        
        # Calculate the Centroid (Mean Vector)
        mean_vector = np.mean(embeddings, axis=0)
        # Re-normalize after averaging (averaging normalized vectors can reduce magnitude)
        normalized_mean = mean_vector / np.linalg.norm(mean_vector)
        print(f"[BRAIN] Mean vector: {len(embeddings)} samples, final norm {np.linalg.norm(normalized_mean):.6f}", flush=True)
        return normalized_mean
    except Exception as e:
        print(f"[BRAIN] Mean vector calculation failed: {e}", flush=True)
        return None

def calculate_neural_match(drawing_img, student_id):
    """
    Matches a new drawing against the student's statistical neural history.
    Returns similarity score (0.0 to 1.0).
    """
    current_embedding = extract_signature_embedding(drawing_img)
    if current_embedding is None: 
        print(f"[BRAIN] Current embedding is None", flush=True)
        return 0.0
    
    mean_real_vector = get_mean_profile_vector(student_id)
    if mean_real_vector is None: 
        print(f"[BRAIN] Mean profile is None", flush=True)
        return 0.0
    
    # Calculate Cosine Similarity
    similarity = cosine_similarity(
        current_embedding.reshape(1, -1), 
        mean_real_vector.reshape(1, -1)
    )[0][0]
    
    print(f"[BRAIN] Cosine similarity: {similarity:.6f} (current norm: {np.linalg.norm(current_embedding):.6f}, mean norm: {np.linalg.norm(mean_real_vector):.6f})", flush=True)
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

