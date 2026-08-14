import os
import cv2
import numpy as np

SAMPLE_DIR = r"c:\Users\Chyle\OneDrive\Desktop\System\iskomats-dashboards-thesis-aclm-g3-master\iskomats-admins\TESTPYTHON\Samples\Her Samples"
FAKE_COR = os.path.join(SAMPLE_DIR, "Fake_COR_test.png")
REAL_COR = os.path.join(SAMPLE_DIR, "Cor_uncooperative.jpg")

img_fake = cv2.imread(FAKE_COR)
img_real = cv2.imread(REAL_COR)

hsv_fake = cv2.cvtColor(img_fake, cv2.COLOR_BGR2HSV)
hsv_real = cv2.cvtColor(img_real, cv2.COLOR_BGR2HSV)

# Magenta mask
mag_mask = (hsv_fake[:,:,0] >= 130) & (hsv_fake[:,:,0] <= 175) & (hsv_fake[:,:,1] >= 60)
print(f"Fake has {np.sum(mag_mask)} magenta pixels")

mag_mask_real = (hsv_real[:,:,0] >= 130) & (hsv_real[:,:,0] <= 175) & (hsv_real[:,:,1] >= 60)
print(f"Real has {np.sum(mag_mask_real)} magenta pixels")

# Why did it not trigger our check earlier?
# Let's check margin pixels in fake image:
h, w = img_fake.shape[:2]
m_top = hsv_fake[:int(h * 0.08), :]
m_left = hsv_fake[:, :int(w * 0.08)]
m_right = hsv_fake[:, int(w * 0.92):]
m_bot = hsv_fake[int(h * 0.92):, :]

mag_px_fake = int(
    np.sum((m_top[:,:,0] >= 130) & (m_top[:,:,0] <= 175) & (m_top[:,:,1] >= 60)) +
    np.sum((m_left[:,:,0] >= 130) & (m_left[:,:,0] <= 175) & (m_left[:,:,1] >= 60)) +
    np.sum((m_right[:,:,0] >= 130) & (m_right[:,:,0] <= 175) & (m_right[:,:,1] >= 60)) +
    np.sum((m_bot[:,:,0] >= 130) & (m_bot[:,:,0] <= 175) & (m_bot[:,:,1] >= 60))
)
print(f"Fake margin magenta px: {mag_px_fake}")

# Now check on real image:
h_r, w_r = img_real.shape[:2]
m_top_r = hsv_real[:int(h_r * 0.08), :]
m_left_r = hsv_real[:, :int(w_r * 0.08)]
m_right_r = hsv_real[:, int(w_r * 0.92):]
m_bot_r = hsv_real[int(h_r * 0.92):, :]

mag_px_real = int(
    np.sum((m_top_r[:,:,0] >= 130) & (m_top_r[:,:,0] <= 175) & (m_top_r[:,:,1] >= 60)) +
    np.sum((m_left_r[:,:,0] >= 130) & (m_left_r[:,:,0] <= 175) & (m_left_r[:,:,1] >= 60)) +
    np.sum((m_right_r[:,:,0] >= 130) & (m_right_r[:,:,0] <= 175) & (m_right_r[:,:,1] >= 60)) +
    np.sum((m_bot_r[:,:,0] >= 130) & (m_bot_r[:,:,0] <= 175) & (m_bot_r[:,:,1] >= 60))
)
print(f"Real margin magenta px: {mag_px_real}")
