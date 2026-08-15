import os, sys
sys.path.insert(0, os.path.abspath('.'))
from dotenv import load_dotenv
load_dotenv()

from email.mime.text import MIMEText
from services.notification_service import send_email_message

msg = MIMEText("Test verification code: 123456")
msg['Subject'] = "ISKOMATS Test Verification"
msg['From'] = os.environ.get('GMAIL_SENDER_EMAIL', 'iskomats@gmail.com')
msg['To'] = 'mwahahahahaha.lol@gmail.com'

try:
    res = send_email_message(msg)
    print("Email sent successfully:", res)
except Exception as e:
    print("Email send error:", e)
