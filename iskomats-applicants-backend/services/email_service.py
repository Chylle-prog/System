import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

def send_registration_email(to_email, first_name=None):
    smtp_server = os.environ.get('SMTP_SERVER', 'smtp.gmail.com')
    smtp_port = int(os.environ.get('SMTP_PORT', 587))
    smtp_user = os.environ.get('SMTP_USER', 'iskomats@gmail.com')
    smtp_password = os.environ.get('SMTP_PASSWORD')

    subject = 'Welcome to ISKOMATS!'
    body = f"""
    Hi {first_name or ''},\n\nThank you for registering at ISKOMATS.\n\nYou can now log in and complete your profile.\n\nBest regards,\nISKOMATS Team
    """

    msg = MIMEMultipart()
    msg['From'] = smtp_user
    msg['To'] = to_email
    msg['Subject'] = subject
    msg.attach(MIMEText(body, 'plain'))

    try:
        with smtplib.SMTP(smtp_server, smtp_port) as server:
            server.starttls()
            server.login(smtp_user, smtp_password)
            server.sendmail(smtp_user, to_email, msg.as_string())
        return True
    except Exception as e:
        print(f"[EMAIL ERROR] Failed to send registration email: {e}")
        return False
