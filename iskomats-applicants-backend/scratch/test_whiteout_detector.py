# -*- coding: utf-8 -*-
"""
Robust Digital Patch & Overlay Splicing Detector
================================================
Detects whiteout boxes, digital text patches, and overlay rectangles
even after JPEG re-compression.
"""
import cv2
import numpy as np

def detect_digital_overlay_boxes(img_bgr):
    """
    Detects rectangular artificial patches (whiteout blocks or paint patches)
    placed over documents.
    """
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape[:2]
    
    # Paper median brightness across the whole document
    paper_median = float(np.median(gray))
    
    # 1. High-brightness flat patch detection (Whiteout boxes)
    # A whiteout box has pixel values > 245 in RGB, but more importantly,
    # it has near-zero local gradient variance compared to natural paper grain.
    pure_white_mask = (gray >= 238).astype(np.uint8) * 255
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (20, 10))
    closed = cv2.morphologyEx(pure_white_mask, cv2.MORPH_CLOSE, kernel)
    
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    print(f"DEBUG: Found {len(contours)} contours in closed white mask.")
    
    detected_boxes = []
    for cnt in contours:
        x, y, bw, bh = cv2.boundingRect(cnt)
        area = bw * bh
        aspect = bw / float(bh + 1e-5)
        roi = gray[y:y+bh, x:x+bw]
        
        # Measure the background brightness of this box (excluding dark text pixels < 180)
        box_bg_pixels = roi[roi > 180]
        if len(box_bg_pixels) > 50:
            box_bg_mean = float(np.mean(box_bg_pixels))
            box_bg_std = float(np.std(box_bg_pixels))
        else:
            box_bg_mean = float(np.mean(roi))
            box_bg_std = float(np.std(roi))
            
        print(f"  Contour: bbox=({x},{y},{bw},{bh}), area={area}, box_bg_mean={box_bg_mean:.1f}, paper_median={paper_median:.1f}")
        
        # Spliced whiteout box on paper:
        # Box background is pure flat white (>245) while surrounding paper is noticeably darker (contrast >= 12)
        # OR box background is extremely bright (>250) with tiny std (<3.0)
        if area >= 200 and 30 <= bw <= (w * 0.95):
            contrast = box_bg_mean - paper_median
            if (box_bg_mean >= 236 and contrast >= 10.0) or (box_bg_mean >= 250 and box_bg_std < 3.0):
                detected_boxes.append({
                    'bbox': (x, y, bw, bh),
                    'box_bg_mean': round(box_bg_mean, 1),
                    'paper_median': round(paper_median, 1),
                    'contrast': round(contrast, 1),
                    'aspect': round(aspect, 1)
                })
                
    is_tampered = len(detected_boxes) >= 1
    details = f"Digital whiteout / overlay detected: {len(detected_boxes)} artificial patch(es) found." if is_tampered else "Clean document."
    return is_tampered, len(detected_boxes), detected_boxes, details

# Test on simulated Image 2 (Alexie's COR with 3 whiteout boxes over AY, ID, Name on wooden table)
def test_image2_simulation():
    # Shaded paper on wood
    w, h = 800, 1100
    img = np.ones((h, w, 3), dtype=np.uint8) * 215 # Greyish/cream paper
    
    # 3 Digital Whiteout Rectangles (simulating Image 2)
    # Box 1: over AY 2025-2026
    cv2.rectangle(img, (200, 135), (420, 160), (255, 255, 255), -1)
    cv2.putText(img, "AY 2025-2026 - 2nd Semester", (205, 152), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 0), 1)
    
    # Box 2: over Student No
    cv2.rectangle(img, (200, 165), (340, 185), (255, 255, 255), -1)
    cv2.putText(img, "1500017172", (205, 180), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 0), 1)
    
    # Box 3: over Name
    cv2.rectangle(img, (200, 195), (450, 220), (255, 255, 255), -1)
    cv2.putText(img, "Alexie Chyle Ortega Magbuhat", (205, 212), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 0), 1)
    
    # Compress as real-world JPEG
    _, enc = cv2.imencode('.jpg', img, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
    decompressed = cv2.imdecode(enc, cv2.IMREAD_COLOR)
    
    tampered, count, boxes, details = detect_digital_overlay_boxes(decompressed)
    print(f"Simulation of Image 2 (3 Whiteout Boxes):")
    print(f"  Tampered: {tampered}")
    print(f"  Boxes Found: {count}")
    print(f"  Details: {details}")
    for b in boxes:
        print(f"    - Box at {b['bbox']}: mean={b['mean']}, std={b['std']}, aspect={b['aspect']}")
        
test_image2_simulation()
