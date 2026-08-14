import os
import cv2
import numpy as np

SAMPLE_DIR = r"c:\Users\Chyle\OneDrive\Desktop\System\iskomats-dashboards-thesis-aclm-g3-master\iskomats-admins\TESTPYTHON\Samples\Her Samples"

# Let's inspect all sample files in Her Samples
for fname in sorted(os.listdir(SAMPLE_DIR)):
    if not fname.lower().endswith(('.png', '.jpg', '.jpeg')):
        continue
    fpath = os.path.join(SAMPLE_DIR, fname)
    img = cv2.imread(fpath)
    if img is None: continue
    h, w = img.shape[:2]
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    
    # Let's test outer 6% margins
    m_top = hsv[:int(h * 0.06), :]
    m_left = hsv[:, :int(w * 0.06)]
    m_right = hsv[:, int(w * 0.94):]
    m_bot = hsv[int(h * 0.94):, :]
    
    # Strict Vivid Magenta / Editor Crop Handle Mask:
    # Pure magenta / neon pink editor canvas: Hue 140 to 170, Saturation >= 110 (high color intensity), Value >= 70
    mag_count_strict = (
        np.sum((m_top[:,:,0] >= 140) & (m_top[:,:,0] <= 170) & (m_top[:,:,1] >= 110) & (m_top[:,:,2] >= 70)) +
        np.sum((m_left[:,:,0] >= 140) & (m_left[:,:,0] <= 170) & (m_left[:,:,1] >= 110) & (m_left[:,:,2] >= 70)) +
        np.sum((m_right[:,:,0] >= 140) & (m_right[:,:,0] <= 170) & (m_right[:,:,1] >= 110) & (m_right[:,:,2] >= 70)) +
        np.sum((m_bot[:,:,0] >= 140) & (m_bot[:,:,0] <= 170) & (m_bot[:,:,1] >= 110) & (m_bot[:,:,2] >= 70))
    )
    
    print(f"{fname:25} | Strict Magenta Count: {mag_count_strict}")
