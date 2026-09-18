import base64
import json
import os
import threading
import time
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

_CACHED_ACCESS_TOKEN = None
_TOKEN_EXPIRY = 0
_TOKEN_LOCK = threading.Lock()

def fetch_google_access_token(force_refresh=False):
    """Exchange the configured refresh token for a Gmail API access token (with caching)."""
    global _CACHED_ACCESS_TOKEN, _TOKEN_EXPIRY

    now = time.time()
    if not force_refresh and _CACHED_ACCESS_TOKEN and now < (_TOKEN_EXPIRY - 180):
        return _CACHED_ACCESS_TOKEN

    with _TOKEN_LOCK:
        if not force_refresh and _CACHED_ACCESS_TOKEN and now < (_TOKEN_EXPIRY - 180):
            return _CACHED_ACCESS_TOKEN

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
        
        expires_in = int(payload.get('expires_in', 3600))
        _CACHED_ACCESS_TOKEN = access_token
        _TOKEN_EXPIRY = now + expires_in
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
    import re
    if not receiver_email or re.search(r'^(dlsl\.applicant|applicant\d*|test_?applicant\d*|dummy|fake|mock)@|@(example\.com|test\.com|sample\.com|invalid|localhost)$', receiver_email.strip().lower()):
        print(f"[EMAIL SKIP] Suppressed verification email to test address '{receiver_email}'.", flush=True)
        return True

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
        raw_bytes = msg.as_bytes()
        raw_bytes = raw_bytes.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
        encoded_message = base64.urlsafe_b64encode(raw_bytes).decode('utf-8')
        
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


def is_test_email(email_str):
    if not email_str:
        return True
    import re
    email = str(email_str).strip().lower()
    
    # 1. Standard test prefixes (e.g. dlsl.applicant01@gmail.com, test@..., dummy@...)
    if re.search(r'^(dlsl\.applicant\d*|applicant\d+|test_?applicant\d*|dummy|fake|mock|test\d*|user\d+)@', email):
        return True
    
    # 2. Fake generated DLSL student emails matching pattern: name.name###@dlsl.edu.ph
    # Specifically: dot(s) in username part, ending with numbers right before @, and @dlsl.edu.ph domain
    # Example: alexander.ramos646@dlsl.edu.ph, adrian.ramos190@dlsl.edu.ph, kaitlyn.delrosario120@dlsl.edu.ph
    if re.search(r'^[a-z]+(?:\.[a-z]+)+\d+@dlsl\.edu\.ph$', email):
        return True
        
    # 3. Invalid/test domains
    if re.search(r'@(example\.com|test\.com|sample\.com|invalid|localhost)$', email):
        return True
        
    # 4. Incomplete/invalid email strings (e.g., '@gm', '@dlsl')
    if '@' not in email or not re.search(r'@[a-z0-9.-]+\.[a-z]{2,}$', email):
        return True
        
    return False


def send_email_message(msg):
    """
    Reliable email dispatcher. Tries SMTP (App Password) first as it is not
    subject to Gmail API rate limits. Falls back to OAuth (Gmail REST API)
    if SMTP is not configured.
    """
    import smtplib

    receiver_email = msg['To']
    sender_email = msg['From'] or os.environ.get('GMAIL_SENDER_EMAIL', '').strip() or 'iskomats@gmail.com'

    # Suppress test/dummy emails
    if is_test_email(receiver_email):
        print(f"[EMAIL SKIP] Suppressed email to test address '{receiver_email}'.", flush=True)
        return True

    # 1. Try SMTP first (App Password) — reliable, no API rate limits
    raw_app_pass = (
        os.environ.get('GMAIL_APP_PASSWORD', '').strip() or
        os.environ.get('SMTP_PASSWORD', '').strip() or
        os.environ.get('SMTP_PASS', '').strip()
    )
    app_password = raw_app_pass.replace(' ', '') if raw_app_pass else ''
    smtp_user = os.environ.get('SMTP_USER', '').strip() or sender_email
    smtp_host = os.environ.get('SMTP_HOST', 'smtp.gmail.com').strip()
    smtp_port = int(os.environ.get('SMTP_PORT', '587'))

    if app_password and smtp_user:
        try:
            print(f"[EMAIL SMTP] Sending to {receiver_email} via {smtp_host}:{smtp_port}...", flush=True)
            with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
                server.starttls()
                server.login(smtp_user, app_password)
                server.send_message(msg)
            print(f"[EMAIL SMTP SUCCESS] Sent to {receiver_email}", flush=True)
            return True
        except Exception as smtp_err:
            print(f"[EMAIL SMTP ERROR] SMTP failed for {receiver_email}: {smtp_err}. Trying OAuth...", flush=True)

    # 2. Fallback: Gmail REST API via OAuth
    has_oauth = bool(
        os.environ.get('GOOGLE_CLIENT_ID', '').strip() and
        os.environ.get('GOOGLE_CLIENT_SECRET', '').strip() and
        os.environ.get('GOOGLE_REFRESH_TOKEN', '').strip()
    )
    if has_oauth:
        try:
            access_token = fetch_google_access_token()
            raw_bytes = msg.as_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
            encoded_message = base64.urlsafe_b64encode(raw_bytes).decode('utf-8')
            req = urllib_request.Request(
                'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
                data=json.dumps({'raw': encoded_message}).encode('utf-8'),
                headers={
                    'Authorization': f'Bearer {access_token}',
                    'Content-Type': 'application/json',
                },
                method='POST',
            )
            with urllib_request.urlopen(req, timeout=15) as response:
                print(f"[EMAIL OAUTH SUCCESS] Sent to {receiver_email} via OAuth", flush=True)
                return True
        except Exception as oauth_err:
            print(f"[EMAIL OAUTH ERROR] OAuth failed for {receiver_email}: {oauth_err}", flush=True)

    raise RuntimeError(f"Email delivery to {receiver_email} failed via both SMTP and OAuth.")


# Whitelist of allowed SMS recipients.
# Options:
# - Set to {True}, True, {'*'}, or {'all'} to allow sending SMS to ALL valid real numbers.
# - Set to a set of specific numbers, e.g. {'09949878905', '09464417742'}, to restrict sending.
ALLOWED_SMS_RECIPIENTS = {
    '09949878905',
    '09464417742',
    '09458654425',
    '09927400293'
}

def normalize_ph_mobile_number(raw_num):
    """Normalize Philippine mobile number to standard 11-digit format 09XXXXXXXXX."""
    digits = "".join(c for c in str(raw_num or '') if c.isdigit())
    if digits.startswith('63') and len(digits) == 12:
        return '0' + digits[2:]
    if digits.startswith('9') and len(digits) == 10:
        return '0' + digits
    return digits

def is_sms_recipient_allowed(raw_num):
    """
    Check if number is in the allowed whitelist to save Semaphore credits.
    Supports allowing ALL valid mobile numbers if:
    - ALLOWED_SMS_RECIPIENTS is {True}, True, {'*'}, {'all'}, or '*'
    - OR environment variable SMS_ALLOWED_NUMBERS is '*', 'all', 'true', or '1'
    """
    norm = normalize_ph_mobile_number(raw_num)
    if not norm or len(norm) < 10:
        return False

    env_allowed = os.environ.get('SMS_ALLOWED_NUMBERS', '').strip()

    # 1. If SMS_ALLOWED_NUMBERS is set to 'true', '*', or 'all', bypass whitelist and allow ALL numbers
    if env_allowed.lower() in ('*', 'all', 'true', '1', 'any'):
        return True

    # 2. If SMS_ALLOWED_NUMBERS is explicitly 'false', '0', 'none', or 'off', block all numbers
    if env_allowed.lower() in ('false', '0', 'none', 'off', 'disable', 'disabled'):
        return False

    # 3. If env var provides comma-separated numbers (e.g. "09949878905,09464417742"), check that whitelist
    if env_allowed:
        whitelist = {normalize_ph_mobile_number(n.strip()) for n in env_allowed.split(',') if n.strip()}
        return norm in whitelist

    # 4. Fall back to ALLOWED_SMS_RECIPIENTS in the code
    if ALLOWED_SMS_RECIPIENTS is True or str(ALLOWED_SMS_RECIPIENTS).strip().lower() in ('*', 'all', 'true', '1', 'any'):
        return True

    if isinstance(ALLOWED_SMS_RECIPIENTS, (set, list, tuple)):
        for item in ALLOWED_SMS_RECIPIENTS:
            if item is True or str(item).strip().lower() in ('true', '1', '*', 'all', 'any'):
                return True
        whitelist = {normalize_ph_mobile_number(n) for n in ALLOWED_SMS_RECIPIENTS if n is not None}
        return norm in whitelist

    return False

def send_sms_logic(number, message):
    """Sends SMS to a mobile number using Semaphore or Twilio (restricted to allowed numbers)."""
    import urllib.parse
    import base64
    
    # Feature flag to toggle SMS globally. Set ENABLE_SMS=true in .env to turn on.
    enable_sms = os.environ.get('ENABLE_SMS', 'false').strip().lower() in ('true', '1', 'yes')
    if not enable_sms:
        print("[SMS INFO] SMS notifications are currently disabled (ENABLE_SMS=false).", flush=True)
        return False

    # Normalize Philippine mobile numbers (09XXXXXXXXX)
    clean_number = normalize_ph_mobile_number(number)
    if not clean_number or len(clean_number) < 10:
        print(f"[SMS ERROR] Invalid mobile number: {number}", flush=True)
        return False

    # Whitelist filtering to save Semaphore credits
    if not is_sms_recipient_allowed(clean_number):
        print(f"[SMS FILTER] Number {clean_number} is not in allowed SMS recipients whitelist. Skipping SMS to save Semaphore credits.", flush=True)
        return False

    provider = os.environ.get('SMS_PROVIDER', 'semaphore').strip().lower()
    if not provider or provider == 'none':
        provider = 'semaphore'
        
    print(f"[SMS INFO] Attempting to send SMS via {provider} to {clean_number}...", flush=True)
    
    if provider == 'semaphore':
        api_key = os.environ.get('SEMAPHORE_API_KEY', '6f921f42fdbd618957783dd03c425cc9').strip()
        sender_name = os.environ.get('SEMAPHORE_SENDER_NAME', 'Iskomats').strip()
        if not api_key:
            print("[SMS ERROR] Semaphore apikey not configured (SEMAPHORE_API_KEY is empty)", flush=True)
            return False
            
        url = "https://api.semaphore.co/api/v4/messages"
        payload_dict = {
            'apikey': api_key,
            'number': clean_number,
            'message': message,
        }
        if sender_name:
            payload_dict['sendername'] = sender_name

        data = urllib.parse.urlencode(payload_dict).encode('utf-8')
        req = urllib_request.Request(url, data=data, method='POST')
        try:
            with urllib_request.urlopen(req, timeout=15) as response:
                resp_data = json.loads(response.read().decode('utf-8'))
                print(f"[SMS SUCCESS] Semaphore response: {resp_data}", flush=True)
                return True
        except urllib_error.HTTPError as err:
            try:
                err_body = err.read().decode('utf-8')
                print(f"[SMS ERROR] Semaphore HTTP Error {err.code}: {err_body}", flush=True)
            except Exception:
                print(f"[SMS ERROR] Semaphore HTTP Error {err.code}: {err}", flush=True)
            return False
        except Exception as err:
            print(f"[SMS ERROR] Semaphore failed: {err}", flush=True)
            return False
            
    elif provider == 'twilio':
        account_sid = os.environ.get('TWILIO_ACCOUNT_SID', '').strip()
        auth_token = os.environ.get('TWILIO_AUTH_TOKEN', '').strip()
        from_number = os.environ.get('TWILIO_FROM_NUMBER', '').strip()
        
        if not all([account_sid, auth_token, from_number]):
            print("[SMS ERROR] Twilio settings not fully configured (SID/Token/From is empty)")
            return False
            
        # Twilio prefers E.164 format. If number doesn't start with '+', 
        # check if it's a PH mobile number starting with '09' or '9' and prepend '+63'
        formatted_number = clean_number
        if not formatted_number.startswith('+'):
            if formatted_number.startswith('0'):
                formatted_number = '+63' + formatted_number[1:]
            elif formatted_number.startswith('9'):
                formatted_number = '+63' + formatted_number
            else:
                # Fallback to appending '+' just in case
                formatted_number = '+' + formatted_number
                
        url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"
        data = urllib.parse.urlencode({
            'From': from_number,
            'To': formatted_number,
            'Body': message
        }).encode('utf-8')
        
        auth_string = f"{account_sid}:{auth_token}"
        auth_header = base64.b64encode(auth_string.encode('utf-8')).decode('utf-8')
        
        req = urllib_request.Request(url, data=data, method='POST')
        req.add_header('Authorization', f'Basic {auth_header}')
        req.add_header('Content-Type', 'application/x-www-form-urlencoded')
        
        try:
            with urllib_request.urlopen(req, timeout=15) as response:
                resp_data = json.loads(response.read().decode('utf-8'))
                print(f"[SMS SUCCESS] Twilio SID: {resp_data.get('sid')}")
                return True
        except Exception as err:
            print(f"[SMS ERROR] Twilio failed: {err}")
            return False
    else:
        print(f"[SMS ERROR] Unknown SMS provider: {provider}")
        return False


def create_notification(user_no, title, message, notif_type='message', send_email=True, db_conn=None, google_access_token=None, sync_email=False):
    """Create an applicant notification and optionally send an email alert."""
    GMAIL_SENDER_EMAIL = (
        os.environ.get('GMAIL_SENDER_EMAIL')
        or os.environ.get('SMTP_SENDER_EMAIL')
        or os.environ.get('SMTP_EMAIL')
    )
    
    conn = db_conn
    should_close_conn = False
    try:
        if not conn:
            conn = get_db()
            should_close_conn = True
            
        cur = conn.cursor()
        
        # DEBUG: Verify applicant exists first (check if foreign key will fail)
        cur.execute("SELECT applicant_no FROM applicants WHERE applicant_no = %s LIMIT 1", (user_no,))
        applicant_check = cur.fetchone()
        if not applicant_check:
            print(f"[NOTIF ERROR] Applicant {user_no} not found in applicants table - cannot create notification (FK constraint)")
            if should_close_conn: conn.close()
            return {'created': False, 'email_sent': False, 'reason': 'applicant-not-found'}
        
        # 1. Insert into database
        cur.execute("""
            INSERT INTO notifications (user_no, title, message, type, expires_at)
            VALUES (%s, %s, %s, %s, NOW() + INTERVAL '10 days')
            RETURNING notif_id
        """, (user_no, title, message, notif_type))
        notif_result = cur.fetchone()  # Fetch the RETURNING result
        if notif_result:
            notif_id = notif_result['notif_id']
        else:
            print(f"[NOTIF ERROR] INSERT returned no result for user {user_no}")
            if not db_conn: conn.rollback()
            if should_close_conn: conn.close()
            return {'created': False, 'email_sent': False, 'reason': 'notification-insert-empty'}
        
        # 2. Emit SocketIO event if initialized
        if _socketio:
            try:
                room = f"applicant_{user_no}"
                payload = {
                    'id': notif_id,
                    'user_no': user_no,
                    'title': title,
                    'message': message,
                    'type': notif_type,
                    'read': False,
                    'time': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                }
                _socketio.emit('new_notification', payload, room=room)
                _socketio.emit('notification_update', payload, room=room)
                # Also broadcast lightweight event so any student tab syncs immediately
                _socketio.emit('notification_update', {'user_no': user_no, 'id': notif_id, 'type': notif_type})
            except Exception as socket_err:
                print(f"[NOTIF SOCKET ERROR] Failed to emit: {socket_err}")

        # 3. Get the applicant's email address and mobile number
        applicant_email_table = get_applicant_email_table(cur)
        cur.execute(f"SELECT email_address FROM {applicant_email_table} WHERE applicant_no = %s LIMIT 1", (user_no,))
        user_row = cur.fetchone()
        
        cur.execute("SELECT mobile_no FROM applicants WHERE applicant_no = %s LIMIT 1", (user_no,))
        mobile_row = cur.fetchone()
        
        if not db_conn: conn.commit()
        
        receiver_email = None
        receiver_mobile = None
        if user_row:
            if isinstance(user_row, dict):
                receiver_email = user_row.get('email_address')
            elif isinstance(user_row, (list, tuple)):
                receiver_email = user_row[0]
            elif hasattr(user_row, '__getitem__'):
                try:
                    receiver_email = user_row['email_address']
                except Exception:
                    receiver_email = user_row[0]
                    
        if mobile_row:
            if isinstance(mobile_row, dict):
                receiver_mobile = mobile_row.get('mobile_no')
            elif isinstance(mobile_row, (list, tuple)):
                receiver_mobile = mobile_row[0]
            elif hasattr(mobile_row, '__getitem__'):
                try:
                    receiver_mobile = mobile_row['mobile_no']
                except Exception:
                    receiver_mobile = mobile_row[0]
        
        # SMS alert trigger in the background
        sms_sent = False
        if receiver_mobile:
            sms_text = f"ISKOMATS: {title} - {message}"
            if len(sms_text) > 300:
                sms_text = sms_text[:297] + "..."
            import threading
            sms_thread = threading.Thread(target=lambda: send_sms_logic(receiver_mobile, sms_text))
            sms_thread.daemon = True
            sms_thread.start()
            sms_sent = True
        else:
            print(f"[NOTIF SMS SKIP] No mobile number found for applicant {user_no}", flush=True)

        if not send_email or not receiver_email:
            if should_close_conn: conn.close()
            return {
                'created': True, 
                'email_sent': False, 
                'sms_sent': sms_sent, 
                'reason': 'email-disabled-or-not-found' if not send_email else 'email-not-found'
            }
            
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

                    raw_bytes = msg.as_bytes()
                    raw_bytes = raw_bytes.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
                    encoded_message = base64.urlsafe_b64encode(raw_bytes).decode('utf-8')
                    
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
                # Synchronous send (for batch jobs that are already in a background thread)
                _send_email_logic(google_access_token)
                if should_close_conn: conn.close()
                return {'created': True, 'email_sent': True, 'sms_sent': sms_sent, 'email': receiver_email}
            else:
                # Background send (for individual notifications)
                import threading
                thread = threading.Thread(target=lambda: _send_email_logic(google_access_token))
                thread.daemon = True
                thread.start()
                
                if should_close_conn: conn.close()
                return {'created': True, 'email_sent': True, 'sms_sent': sms_sent, 'email': receiver_email, 'info': 'Sending in background'}
        else:
            if should_close_conn: conn.close()
            return {'created': True, 'email_sent': False, 'sms_sent': sms_sent, 'email': receiver_email, 'reason': 'sender-email-not-configured'}
        
    except Exception as e:
        print(f"[NOTIF ERROR] Notification creation failed: {e}", flush=True)
        if should_close_conn and conn:
            try: conn.close()
            except: pass
        return {'created': False, 'email_sent': False, 'reason': str(e)}
