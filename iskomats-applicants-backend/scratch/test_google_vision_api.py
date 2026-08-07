import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services.ocr_utils import extract_text_with_google_cloud_vision
import numpy as np
import cv2

# Create a sample document image with text
img = np.ones((600, 1000, 3), dtype=np.uint8) * 255
cv2.putText(img, "OFFICIAL CERTIFICATE OF REGISTRATION", (50, 100), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 0), 2)
cv2.putText(img, "De La Salle Lipa", (50, 180), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 2)
cv2.putText(img, "Student No : 2021305751", (50, 260), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
cv2.putText(img, "Name : LANTAFE, MIKAELA YSABEL LINATOC", (50, 340), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
cv2.putText(img, "Course : BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY", (50, 420), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)

print("[TEST] Sending generated document image to Google Cloud Vision API...")
extracted_text = extract_text_with_google_cloud_vision(img)

print("\n--- EXTRACTED TEXT FROM GOOGLE CLOUD VISION API ---")
print(extracted_text)
print("----------------------------------------------------\n")

assert "LANTAFE" in extracted_text or "2021305751" in extracted_text or "REGISTRATION" in extracted_text, "Cloud Vision OCR failed to extract text"
print("[OK] Google Cloud Vision API OCR Test Passed Successfully!")
