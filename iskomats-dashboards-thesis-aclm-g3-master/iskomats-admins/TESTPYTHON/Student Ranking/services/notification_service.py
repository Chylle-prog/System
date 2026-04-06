import base64
import json
import os
from datetime import datetime
from email.mime.text import MIMEText
from urllib import parse, request as urllib_request, error as urllib_error
from services.db_service import get_db

def fetch_google_access_token():
    """Exchange the configured refresh token for a Gmail API access token."""
    GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID')
    GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET')
    GOOGLE_REFRESH_TOKEN = os.environ.get('GOOGLE_REFRESH_TOKEN')
    
    missing_settings = []
    if not GOOGLE_CLIENT_ID: missing_settings.append('GOOGLE_CLIENT_ID')
    if not GOOGLE_CLIENT_SECRET: missing_settings.append('GOOGLE_CLIENT_SECRET')
    if not GOOGLE_REFRESH_TOKEN: missing_settings.append('GOOGLE_REFRESH_TOKEN')

    if missing_settings:
        error_msg = f"Google Gmail API credentials are not configured. Missing: {', '.join(missing_settings)}"
        print(f"[NOTIF ERROR] {error_msg}")
        raise RuntimeError(error_msg)

    token_request_body = parse.urlencode({
        'client_id': GOOGLE_CLIENT_ID,
        'client_secret': GOOGLE_CLIENT_SECRET,
        'refresh_token': GOOGLE_REFRESH_TOKEN,
        'grant_type': 'refresh_token',
    }).encode('utf-8')

    token_request = urllib_request.Request(
        'https://oauth2.googleapis.com/token',
        data=token_request_body,
        headers={'Content-Type': 'application/x-www-form-urlencoded'},
        method='POST',
    )

    try:
        with urllib_request.urlopen(token_request, timeout=30) as response:
            payload = json.loads(response.read().decode('utf-8'))
        
        access_token = payload.get('access_token')
        if not access_token:
            raise RuntimeError("Token exchange succeeded but no access_token was returned.")
        return access_token
    except urllib_error.HTTPError as e:
        try:
            error_payload = json.loads(e.read().decode('utf-8'))
            error_reason = error_payload.get('error', 'unknown_error')
            error_desc = error_payload.get('error_description', 'No description provided')
            diagnostic = f"Google OAuth rejected the request (error: {error_reason}, description: {error_desc})"
        except:
            diagnostic = f"HTTP Error {e.code}: {e.reason}"
        
        print(f"[NOTIF ERROR] Token exchange failed: {diagnostic}")
        raise RuntimeError(diagnostic)
    except Exception as e:
        print(f"[NOTIF ERROR] Token exchange failed: {e}")
        raise RuntimeError(f"Token exchange failed: {str(e)}")

def create_notification(user_no, title, message, notif_type='message'):
    """Create a database notification and send an email alert to the user."""
    GMAIL_SENDER_EMAIL = os.environ.get('GMAIL_SENDER_EMAIL')
    
    try:
        conn = get_db()
        cur = conn.cursor()
        
        # 1. Insert into database
        cur.execute("""
            INSERT INTO notifications (user_no, title, message, type)
            VALUES (%s, %s, %s, %s)
            RETURNING notif_id
        """, (user_no, title, message, notif_type))
        
        # Get user's email
        cur.execute("SELECT email_address FROM email WHERE applicant_no = %s OR user_no = %s LIMIT 1", (user_no, user_no))
        user_row = cur.fetchone()
        conn.commit()
        conn.close()
        
        if not user_row or not user_row['email_address']:
            print(f"[NOTIF ERROR] No email found for user {user_no}")
            return
            
        receiver_email = user_row['email_address']
        
        # 2. Send Email alert via Gmail API
        if GMAIL_SENDER_EMAIL:
            # Prepare email
            email_body = f"""Hello,

You have a new notification from ISKOMATS:

{title}
{message}

Please log in to the portal to view more details.

Best regards,
The ISKOMATS Team
"""
            msg = MIMEText(email_body)
            msg['Subject'] = f"ISKOMATS Notification: {title}"
            msg['From'] = GMAIL_SENDER_EMAIL
            msg['To'] = receiver_email
            
            try:
                access_token = fetch_google_access_token()
                if not access_token:
                    print(f"[NOTIF EMAIL ERROR] No access token, skipping email.")
                    return

                encoded_message = base64.urlsafe_b64encode(msg.as_bytes()).decode('utf-8')
                
                email_request = urllib_request.Request(
                    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
                    data=json.dumps({'raw': encoded_message}).encode('utf-8'),
                    headers={
                        'Authorization': f'Bearer {access_token}',
                        'Content-Type': 'application/json',
                    },
                    method='POST',
                )
                
                with urllib_request.urlopen(email_request, timeout=30) as response:
                    print(f"[NOTIF] Email sent to {receiver_email}")
            except Exception as e:
                print(f"[NOTIF EMAIL ERROR] Failed to send email to {receiver_email}: {e}")
        
    except Exception as e:
        print(f"[NOTIF ERROR] {e}")
        if 'conn' in locals() and conn: conn.close()
