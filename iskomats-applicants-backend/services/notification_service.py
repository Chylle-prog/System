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


def create_notification(user_no, title, message, notif_type='message', send_email=True):
    """Create an applicant notification and optionally send an email alert."""
    GMAIL_SENDER_EMAIL = (
        os.environ.get('GMAIL_SENDER_EMAIL')
        or os.environ.get('SMTP_SENDER_EMAIL')
        or os.environ.get('SMTP_EMAIL')
    )
    
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        
        # DEBUG: Verify applicant exists first (check if foreign key will fail)
        cur.execute("SELECT applicant_no FROM applicants WHERE applicant_no = %s LIMIT 1", (user_no,))
        applicant_check = cur.fetchone()
        if not applicant_check:
            print(f"[NOTIF ERROR] Applicant {user_no} not found in applicants table - cannot create notification (FK constraint)")
            conn.close()
            return {'created': False, 'email_sent': False, 'reason': 'applicant-not-found'}
        
        # 1. Insert into database
        try:
            cur.execute("""
                INSERT INTO notifications (user_no, title, message, type)
                VALUES (%s, %s, %s, %s)
                RETURNING notif_id
            """, (user_no, title, message, notif_type))
            notif_result = cur.fetchone()  # Fetch the RETURNING result
            if notif_result:
                notif_id = notif_result['notif_id']
                print(f"[NOTIF] Database notification created: notif_id={notif_id}, user_no={user_no}, type={notif_type}")
            else:
                print(f"[NOTIF ERROR] INSERT returned no result for user {user_no}")
                conn.rollback()
                conn.close()
                return {'created': False, 'email_sent': False, 'reason': 'notification-insert-empty'}
        except Exception as db_err:
            print(f"[NOTIF ERROR] Database INSERT failed for user {user_no}: {db_err}")
            if 'conn' in locals():
                conn.rollback()
            raise
        
        # 2. Emit SocketIO event if initialized
        if _socketio:
            try:
                # We emit to a room named after the applicant_no
                # The student portal should join this room on login
                room = f"applicant_{user_no}"
                _socketio.emit('new_notification', {
                    'id': notif_id,
                    'title': title,
                    'message': message,
                    'type': notif_type,
                    'time': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                }, room=room)
                print(f"[NOTIF SOCKET] Broadcasted to room {room}")
            except Exception as socket_err:
                print(f"[NOTIF SOCKET ERROR] Failed to emit: {socket_err}")

        if not send_email:
            conn.commit()
            conn.close()
            return {'created': True, 'email_sent': False, 'reason': 'email-disabled'}

        # 2. Get the applicant's email address.
        # This service stores notifications against applicants(applicant_no), so
        # do not fall back to user_no here. Applicant ids and admin user ids can
        # collide numerically and send mail to the wrong person.
        applicant_email_table = get_applicant_email_table(cur)
        cur.execute(f"SELECT email_address FROM {applicant_email_table} WHERE applicant_no = %s LIMIT 1", (user_no,))
        user_row = cur.fetchone()
        conn.commit()
        
        if not user_row or not user_row['email_address']:
            print(f"[NOTIF WARN] No email found for user {user_no} - database notification created but no email sent")
            conn.close()
            return {'created': True, 'email_sent': False, 'reason': 'email-not-found'}
            
        receiver_email = user_row['email_address']
        
        # 3. Send Email alert via Gmail API in a background thread
        if GMAIL_SENDER_EMAIL:
            def _email_worker():
                # Separate worker to handle Gmail API communication without blocking DB commit/HTTP response
                try:
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
                    
                    access_token = fetch_google_access_token()
                    if not access_token:
                        print(f"[NOTIF EMAIL ERROR] No access token for {receiver_email}, skipping email.")
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
                        print(f"[NOTIF BG] Email sent successfully to {receiver_email}")
                except Exception as email_err:
                    print(f"[NOTIF BG ERROR] Failed to send email to {receiver_email}: {email_err}")

            import threading
            thread = threading.Thread(target=_email_worker)
            thread.daemon = True
            thread.start()
            
            conn.close()
            return {'created': True, 'email_sent': True, 'email': receiver_email, 'info': 'Sending in background'}
        else:
            print(f"[NOTIF] GMAIL_SENDER_EMAIL not configured - notification saved but email not sent to {receiver_email if receiver_email else 'unknown'}")
            conn.close()
            return {'created': True, 'email_sent': False, 'email': receiver_email, 'reason': 'sender-email-not-configured'}
        
        conn.close()
        return {'created': True, 'email_sent': False, 'email': receiver_email, 'reason': 'email-path-not-executed'}
        
    except Exception as e:
        print(f"[NOTIF ERROR] Notification creation failed: {e}", flush=True)
        if conn:
            try:
                conn.close()
            except:
                pass
        return {'created': False, 'email_sent': False, 'reason': str(e)}
