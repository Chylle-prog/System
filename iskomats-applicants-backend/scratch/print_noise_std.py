import os
import cv2
import numpy as np

SAMPLE_DIR = r"c:\Users\Chyle\OneDrive\Desktop\System\iskomats-dashboards-thesis-aclm-g3-master\iskomats-admins\TESTPYTHON\Samples\Her Samples"

for fname in sorted(os.listdir(SAMPLE_DIR)):
    if not fname.lower().endswith(('.png', '.jpg', '.jpeg')): continue
    fpath = os.path.join(SAMPLE_DIR, fname)
    img = cv2.imread(fpath)
    if img is None: continue
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    high_freq_noise = cv2.Laplacian(gray, cv2.CV_32F)
    page_noise_std = float(np.std(high_freq_noise[np.abs(high_freq_noise) < 25]))
    print(f"{fname:25} | page_noise_std: {page_noise_std:.3f}")
