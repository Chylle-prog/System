import base64
import json
import os
from datetime import datetime
from email.mime.text import MIMEText
from urllib import parse, request as urllib_request, error as urllib_error
from services.db_service import get_db
from services.email_table_service import get_applicant_email_table

_socketio = None

def init_socketio(socketio_instance):
    """Initialize the global socketio instance for this service."""
    global _socketio
    _socketio = socketio_instance
    print("[NOTIF SERVICE] SocketIO instance initialized.")

def fetch_google_access_token():
    """Exchange the configured refresh token for a Gmail API access token."""
    GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', '').strip()
    GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET', '').strip()
    GOOGLE_REFRESH_TOKEN = os.environ.get('GOOGLE_REFRESH_TOKEN', '').strip()
    
    missing_settings = []
    if not GOOGLE_CLIENT_ID: missing_settings.append('GOOGLE_CLIENT_ID')
    if not GOOGLE_CLIENT_SECRET: missing_settings.append('GOOGLE_CLIENT_SECRET')
    if not GOOGLE_REFRESH_TOKEN: missing_settings.append('GOOGLE_REFRESH_TOKEN')

    def mask(s, visible=4):
        if not s: return "None"
        if len(s) <= visible * 2: return s
        return f"{s[:visible]}...{s[-visible:]} ({len(s)} chars)"

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
            
            # Specific guidance for invalid_grant (expired/revoked token)
            if error_reason == 'invalid_grant':
                diagnostic = (
                    "CRITICAL: Your Google Refresh Token has EXPIRED or been REVOKED. "
                    "This usually happens 7 days after generation if your Google Cloud Project is in 'Testing' mode. "
                    "ACTION REQUIRED: Please regenerate a new Refresh Token in the Google Cloud Console and update your GOOGLE_REFRESH_TOKEN environment variable."
                )
            else:
                diagnostic = f"Google OAuth rejected the request (error: {error_reason}, description: {error_desc})."
            
            diagnostic += f" [CID: {mask(GOOGLE_CLIENT_ID, 12)}, Secret: {mask(GOOGLE_CLIENT_SECRET, 6)}]"
        except:
            diagnostic = f"HTTP Error {e.code}: {e.reason}. [CID: {mask(GOOGLE_CLIENT_ID, 12)}]"
        
        print(f"[NOTIF ERROR] Token exchange failed: {diagnostic}")
        raise RuntimeError(diagnostic)
    except Exception as e:
        print(f"[NOTIF ERROR] Token exchange failed: {e}")
        raise RuntimeError(f"Token exchange failed: {str(e)}")

def send_verification_email(receiver_email, code, is_admin=False):
    """Unified helper to send verification codes via Gmail API."""
    GMAIL_SENDER_EMAIL = os.environ.get('GMAIL_SENDER_EMAIL', '').strip()
    if not GMAIL_SENDER_EMAIL:
        raise RuntimeError('GMAIL_SENDER_EMAIL is not configured.')

    site_name = "ISKOMATS Admin" if is_admin else "ISKOMATS"
    
    body = f"""Hello,

Thank you for registering with {site_name}. To complete your registration, please use the following verification code:

{code}

If you did not register for an account, please ignore this email.

Best regards,
The ISKOMATS Team
"""
    msg = MIMEText(body)
    msg['Subject'] = f"Verify your {site_name} Account"
    msg['From'] = GMAIL_SENDER_EMAIL
    msg['To'] = receiver_email
    
    try:
        access_token = fetch_google_access_token()
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
            print(f"[EMAIL SUCCESS] Sent verification to {receiver_email}")
            return True
    except Exception as e:
        print(f"[EMAIL ERROR] Failed to send verification to {receiver_email}: {e}")
        raise e


def create_notification(user_no, title, message, notif_type='message', send_email=True, db_conn=None, google_access_token=None, sync_email=False):
    """Create an applicant notification and optionally send an email alert."""
    GMAIL_SENDER_EMAIL = (
        os.environ.get('GMAIL_SENDER_EMAIL')
        or os.environ.get('SMTP_SENDER_EMAIL')
        or os.environ.get('SMTP_EMAIL')
    )
    
    conn = db_conn
    try:
        # Use a local context manager if no connection provided, 
        # but keep the logic compatible with an external connection.
        if not conn:
            with get_db() as local_conn:
                return _create_notification_internal(local_conn, user_no, title, message, notif_type, send_email, google_access_token, sync_email, commit=True)
        else:
            return _create_notification_internal(conn, user_no, title, message, notif_type, send_email, google_access_token, sync_email, commit=False)
            
    except Exception as e:
        print(f"[NOTIF ERROR] Notification creation failed: {e}", flush=True)
        return {'created': False, 'email_sent': False, 'reason': str(e)}

def _create_notification_internal(conn, user_no, title, message, notif_type='message', send_email=True, google_access_token=None, sync_email=False, commit=True):
    """Internal helper for notification creation with an active connection."""
    GMAIL_SENDER_EMAIL = (
        os.environ.get('GMAIL_SENDER_EMAIL')
        or os.environ.get('SMTP_SENDER_EMAIL')
        or os.environ.get('SMTP_EMAIL')
    )
    
    try:
        cur = conn.cursor()
        
        # DEBUG: Verify applicant exists first (check if foreign key will fail)
        cur.execute("SELECT applicant_no FROM applicants WHERE applicant_no = %s LIMIT 1", (user_no,))
        applicant_check = cur.fetchone()
        if not applicant_check:
            print(f"[NOTIF ERROR] Applicant {user_no} not found in applicants table - cannot create notification (FK constraint)")
            return {'created': False, 'email_sent': False, 'reason': 'applicant-not-found'}
        
        # 1. Insert into database
        cur.execute("""
            INSERT INTO notifications (user_no, title, message, type, expires_at)
            VALUES (%s, %s, %s, %s, NOW() + INTERVAL '10 days')
            RETURNING notif_id
        """, (user_no, title, message, notif_type))
        notif_result = cur.fetchone()
        if notif_result:
            notif_id = notif_result['notif_id']
        else:
            print(f"[NOTIF ERROR] INSERT returned no result for user {user_no}")
            if commit: conn.rollback()
            return {'created': False, 'email_sent': False, 'reason': 'notification-insert-empty'}
        
        # 2. Emit SocketIO event if initialized
        if _socketio:
            try:
                room = f"applicant_{user_no}"
                print(f"[NOTIF SOCKET] Emitting 'new_notification' to room {room} for notif {notif_id}")
                _socketio.emit('new_notification', {
                    'id': notif_id,
                    'title': title,
                    'message': message,
                    'type': notif_type,
                    'time': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                }, room=room)
                print(f"[NOTIF SOCKET] Emit successful for user {user_no}")
            except Exception as socket_err:
                print(f"[NOTIF SOCKET ERROR] Failed to emit: {socket_err}")
        else:
            print(f"[NOTIF SOCKET SKIP] _socketio not initialized - cannot send real-time alert to user {user_no}")

        if not send_email:
            if commit: conn.commit()
            return {'created': True, 'email_sent': False, 'reason': 'email-disabled'}

        # 3. Get the applicant's email address
        applicant_email_table = get_applicant_email_table(cur)
        cur.execute(f"SELECT email_address FROM {applicant_email_table} WHERE applicant_no = %s LIMIT 1", (user_no,))
        user_row = cur.fetchone()
        
        if commit: conn.commit()
        
        if not user_row or not user_row['email_address']:
            return {'created': True, 'email_sent': False, 'reason': 'email-not-found'}
            
        receiver_email = user_row['email_address']
        
        # 4. Send Email alert via Gmail API
        if GMAIL_SENDER_EMAIL:
            def _send_email_logic(access_token=None):
                try:
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
                    
                    if not access_token:
                        access_token = fetch_google_access_token()
                    
                    if not access_token:
                        return False

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
                        return True
                except Exception as email_err:
                    print(f"[NOTIF EMAIL ERROR] Failed to send email to {receiver_email}: {email_err}")
                    return False

            if sync_email:
                _send_email_logic(google_access_token)
                return {'created': True, 'email_sent': True, 'email': receiver_email}
            else:
                import threading
                thread = threading.Thread(target=lambda: _send_email_logic(google_access_token))
                thread.daemon = True
                thread.start()
                return {'created': True, 'email_sent': True, 'email': receiver_email, 'info': 'Sending in background'}
        else:
            return {'created': True, 'email_sent': False, 'email': receiver_email, 'reason': 'sender-email-not-configured'}
            
    except Exception as e:
        if commit: 
            try: conn.rollback()
            except: pass
        raise e

