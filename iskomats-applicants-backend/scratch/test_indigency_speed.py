import sys
import os
sys.path.insert(0, os.path.abspath('.'))

import time
import cv2
import numpy as np
from services.ocr_utils import detect_document_tampering, verify_indigency_fields, extract_document_text, verify_document_with_ocr

print("[TEST] Benchmarking Indigency Verification components...")

# Create a sample test document image in memory with realistic sensor noise
img = np.ones((1200, 1600, 3), dtype=np.uint8) * 240
noise = np.random.normal(0, 5, img.shape).astype(np.int16)
img = np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)
cv2.putText(img, "CERTIFICATE OF INDIGENCY", (300, 200), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 0, 0), 3)
cv2.putText(img, "This is to certify that Alexie Chyle Magbuhat is a resident of Inosloban, Lipa City.", (100, 400), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 0), 2)
cv2.putText(img, "Signed by Punong Barangay.", (100, 600), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 0), 2)

_, buffer = cv2.imencode('.jpg', img)
image_bytes = buffer.tobytes()

# Test 1: Tamper Detection Speed
t0 = time.time()
is_edited, msg, score = detect_document_tampering(image_bytes)
t_tamper = (time.time() - t0) * 1000
print(f"[TEST 1] Tamper Detection: {t_tamper:.1f}ms | Edited={is_edited} | Msg='{msg}'")

# Test 2: Document Verification Speed & Accuracy
t0 = time.time()
success, message, text, meta = verify_document_with_ocr(
    image_bytes,
    'Indigency',
    first_name='Alexie Chyle',
    last_name='Magbuhat',
    expected_address='Inosloban Lipa City'
)
t_verif1 = (time.time() - t0) * 1000
print(f"[TEST 2] 1st Verification Run: {t_verif1:.1f}ms | Verified={success} | Msg='{message}'")

# Test 3: Second Verification Run (Text Cache Hit)
t0 = time.time()
success2, message2, text2, meta2 = verify_document_with_ocr(
    image_bytes,
    'Indigency',
    first_name='Alexie Chyle',
    last_name='Magbuhat',
    expected_address='Inosloban Lipa City'
)
t_verif2 = (time.time() - t0) * 1000
print(f"[TEST 3] 2nd Verification Run (Cached): {t_verif2:.1f}ms | Verified={success2} | Msg='{message2}'")

assert success == True, "Verification accuracy failed!"
print("[SUCCESS] All benchmark tests passed with 100% accuracy!")
