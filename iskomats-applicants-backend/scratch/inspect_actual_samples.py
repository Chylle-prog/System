# -*- coding: utf-8 -*-
"""
Inspect what OCR extracts from Fake_COR_test.png and Cor_uncooperative.jpg
"""
import os
import sys
import cv2
import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services.ocr_utils import extract_document_text, parse_cor_document, verify_cor_fields

SAMPLE_DIR = r"c:\Users\Chyle\OneDrive\Desktop\System\iskomats-dashboards-thesis-aclm-g3-master\iskomats-admins\TESTPYTHON\Samples\Her Samples"
FAKE_COR = os.path.join(SAMPLE_DIR, "Fake_COR_test.png")
REAL_COR = os.path.join(SAMPLE_DIR, "Cor_uncooperative.jpg")

print(f"Fake exists: {os.path.exists(FAKE_COR)}")
print(f"Real exists: {os.path.exists(REAL_COR)}")

with open(FAKE_COR, 'rb') as f:
    fake_bytes = f.read()

with open(REAL_COR, 'rb') as f:
    real_bytes = f.read()

fake_text = extract_document_text(fake_bytes)
real_text = extract_document_text(real_bytes)

print("\n" + "="*65)
print("  FAKE_COR_TEST.PNG EXTRACTED OCR TEXT:")
print("="*65)
print(fake_text)

print("\n" + "="*65)
print("  COR_UNCOOPERATIVE.JPG EXTRACTED OCR TEXT:")
print("="*65)
print(real_text)
