import os
import sys
from dotenv import load_dotenv

# Load env from Student Ranking
env_path = r'c:\Users\Chyle\OneDrive\Desktop\System\iskomats-dashboards-thesis-aclm-g3-master\iskomats-admins\TESTPYTHON\Student Ranking\.env'
load_dotenv(env_path)

sys.path.insert(0, r'c:\Users\Chyle\OneDrive\Desktop\System\iskomats-dashboards-thesis-aclm-g3-master\iskomats-admins\TESTPYTHON\Student Ranking')

from services.notification_service import send_verification_email

print("Testing send_verification_email to iskomats@gmail.com...")
try:
    res = send_verification_email('iskomats@gmail.com', '123456', is_admin=False)
    print(f"[RESULT] Verification email sent successfully: {res}")
except Exception as exc:
    print(f"[ERROR] Failed to send verification email: {exc}")
