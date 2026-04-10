import sys
import os
import json
from decimal import Decimal
from flask import Blueprint, request, jsonify, send_file, url_for, session
from flask_bcrypt import Bcrypt
from functools import wraps
from flask_socketio import emit, join_room
import jwt
from datetime import date, datetime, timedelta
import psycopg2
import base64
from urllib import parse, request as urllib_request, error as urllib_error
from email.mime.text import MIMEText
from cryptography.fernet import Fernet
from io import BytesIO
import traceback
import threading

# Global SocketIO instance to avoid circular imports with app.py
_socketio_instance = None

def safe_emit(event, data, **kwargs):
    """Emit a SocketIO event safely from HTTP route context.
    Uses the captured socketio instance instead of the request-scoped emit(),
    which crashes with 'Request has no attribute namespace' outside SocketIO handlers.
    """
    try:
        if _socketio_instance:
            _socketio_instance.emit(event, data, **kwargs)
        else:
            print(f"[SOCKETIO EMIT] Skipped '{event}': SocketIO not initialized yet", flush=True)
    except Exception as _e:
        print(f"[SOCKETIO EMIT] Could not broadcast '{event}': {_e}", flush=True)

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_DIR not in sys.path:
    sys.path.append(PROJECT_DIR)

from project_config import get_db, get_db_startup
from services.notification_service import create_notification

def convert_bytea_array_to_urls(bytea_array):
    """Convert PostgreSQL bytea[] array to list of base64 data URLs."""
    if not bytea_array:
        return []
    
    result = []
    for i, img_data in enumerate(bytea_array):
        try:
            # Handle memoryview objects from psycopg2
            if isinstance(img_data, (memoryview, bytearray)):
                img_data = bytes(img_data)
            
            # Convert to base64 data URL
            if img_data:
                b64 = base64.b64encode(img_data).decode('utf-8')
                data_url = f'data:image/jpeg;base64,{b64}'
                result.append({
                    'id': i,
                    'url': data_url,
                    'name': f'image_{i}'
                })
        except Exception as e:
            print(f"ERROR converting image {i}: {e}", file=sys.stderr)
            continue
    
    return result

def convert_blob_to_media_array(blob, name="document"):
    """Convert a single BYTEA blob to the list structure expected by the frontend."""
    # This version is still used by other parts if they have the blob in memory
    if not blob:
        return []
    try:
        if hasattr(blob, 'tobytes'):
            blob = blob.tobytes()
        b64 = base64.b64encode(blob).decode('utf-8')
        return [{
            'src': f'data:image/jpeg;base64,{b64}',
            'type': 'image/jpeg',
            'name': f"{name} ({len(blob)} bytes)"
        }]
    except Exception as e:
        print(f"ERROR converting blob: {e}", file=sys.stderr)
        return []

def get_applicant_media_metadata(applicant_no, column_name, has_data, data_value=None, name="document"):
    """Return the media metadata with a URL instead of embedded base64 data for performance.
    
    For image/document columns (BYTEA):
        - Returns lazy-loaded URL to get_applicant_image endpoint
        - Type is detected from column name
    
    For video URL columns (VARCHAR):
        - If data_value provided, returns it directly as the src
        - Otherwise returns None
    """
    if not has_data:
        return []
    
    # Detect if this is a video column based on naming convention
    is_video = column_name.endswith('_vid_url') if column_name else False
    media_type = 'video/mp4' if is_video else 'image/jpeg'
    
    if is_video and data_value:
        # For video URLs, use the URL directly from database
        return [{
            'src': data_value,
            'type': media_type,
            'name': f"{name}"
        }]
    elif not is_video:
        # For binary image/document data, use lazy-loading endpoint
        return [{
            'src': url_for('admin_api.get_applicant_image', applicant_no=applicant_no, column_name=column_name, _external=True),
            'type': media_type,
            'name': f"{name} (Lazy Loaded)"
        }]
    
    return []

def normalize_json_value(value):
    """Convert DB values into JSON-safe primitives."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value

    if isinstance(value, Decimal):
        return float(value)

    if isinstance(value, (datetime, date)):
        return value.isoformat()

    if hasattr(value, 'tobytes'):
        try:
            return value.tobytes().decode('utf-8', errors='ignore')
        except Exception:
            return None

    if isinstance(value, (bytes, bytearray)):
        try:
            return bytes(value).decode('utf-8', errors='ignore')
        except Exception:
            return None

    if isinstance(value, dict):
        return {key: normalize_json_value(item) for key, item in value.items()}

    if isinstance(value, (list, tuple)):
        return [normalize_json_value(item) for item in value]

    return str(value)


def normalize_json_object(record):
    """Normalize a mapping or sequence into a JSON-safe object."""
    if isinstance(record, dict):
        return {key: normalize_json_value(value) for key, value in record.items()}
    return normalize_json_value(record)

def decrypt_image_to_data_url(encrypted_data):
    """Decrypt binary data and return as base64 data URL for signatures."""
    if not encrypted_data or not _fernet:
        return None
    try:
        if hasattr(encrypted_data, 'tobytes'):
            encrypted_data = encrypted_data.tobytes()
        decrypted = _fernet.decrypt(encrypted_data)
        b64 = base64.b64encode(decrypted).decode('utf-8')
        return f'data:image/png;base64,{b64}'
    except Exception as e:
        print(f"Decryption error: {e}", file=sys.stderr)
        return None

api_bp = Blueprint('admin_api', __name__, url_prefix='/api/admin')
bcrypt = Bcrypt()

# ===== JWT CONFIG =====
# Use common secret key logic
SECRET_KEY = os.environ.get('SECRET_KEY', 'development-key-replace-in-production')
TOKEN_EXPIRY = 24  # hours
PASSWORD_RESET_EXPIRY_MINUTES = int(os.environ.get('PASSWORD_RESET_EXPIRY_MINUTES', '30'))
FRONTEND_URL = os.environ.get('FRONTEND_URL', 'https://iskomats-admin.surge.sh').rstrip('/')
GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID')
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET')
GOOGLE_REFRESH_TOKEN = os.environ.get('GOOGLE_REFRESH_TOKEN')
GMAIL_SENDER_EMAIL = os.environ.get('GMAIL_SENDER_EMAIL') or os.environ.get('SMTP_SENDER_EMAIL') or os.environ.get('SMTP_EMAIL')

# ===== ENCRYPTION SETUP =====
_ENCRYPTION_KEY = os.environ.get('ENCRYPTION_KEY')
_fernet = None

print("[API_ROUTES] ENCRYPTION_KEY loaded:", "Yes" if _ENCRYPTION_KEY else "No")
print(f"[API_ROUTES] ENCRYPTION_KEY value (first 20 chars): {_ENCRYPTION_KEY[:20] if _ENCRYPTION_KEY else 'None'}...")

if _ENCRYPTION_KEY:
    try:
        if isinstance(_ENCRYPTION_KEY, str):
            _ENCRYPTION_KEY = _ENCRYPTION_KEY.encode()
        _fernet = Fernet(_ENCRYPTION_KEY)
        print("[API_ROUTES] Fernet object initialized successfully")
    except Exception as e:
        print(f"[API_ROUTES] Failed to initialize Fernet: {e}")
else:
    print("[API_ROUTES] WARNING: ENCRYPTION_KEY not found in environment variables!")

def decrypt_image_to_data_url(encrypted_bytes, mime='image/png'):
    """Decrypt Fernet-encrypted image bytes and return a base64 data URL."""
    if not _fernet:
        print("[API_ROUTES] Decryption failed: Fernet not initialized")
        return None
    if not encrypted_bytes:
        return None
    try:
        # encrypted_bytes may come as memoryview from psycopg2
        if hasattr(encrypted_bytes, 'tobytes'):
            encrypted_bytes = encrypted_bytes.tobytes()
        decrypted = _fernet.decrypt(bytes(encrypted_bytes))
        b64 = base64.b64encode(decrypted).decode('utf-8')
        return f'data:{mime};base64,{b64}'
    except Exception as e:
        print(f"[API_ROUTES] Decryption error: {e}")
        return None

def base64_to_bytes(b64_string):
    """Convert base64 data URL or raw string to bytes."""
    if not b64_string:
        return None
    try:
        if ',' in b64_string:
            b64_string = b64_string.split(',')[1]
        return base64.b64decode(b64_string)
    except Exception:
        return None

def bytes_to_data_url(byte_data, mime=None):
    """Convert binary data to base64 data URL."""
    if not byte_data:
        return None
    try:
        if hasattr(byte_data, 'tobytes'):
            byte_data = byte_data.tobytes()
        if not mime:
            mime = get_mime_type(byte_data)
        b64 = base64.b64encode(byte_data).decode('utf-8')
        return f'data:{mime};base64,{b64}'
    except Exception:
        return None

def get_mime_type(data):
    """Detect MIME type from binary data magic bytes."""
    if not data:
        return 'application/octet-stream'
    
    if hasattr(data, 'tobytes'):
        data = data.tobytes()
    
    # PNG
    if data[:4] == b'\x89PNG':
        return 'image/png'
    # JPEG
    elif data[:2] == b'\xff\xd8':
        return 'image/jpeg'
    # GIF
    elif data[:4] == b'GIF8':
        return 'image/gif'
    # WEBP
    elif data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'image/webp'
    # ISO Base Media File Format (AVIF, HEIC, etc.)
    elif data[4:8] == b'ftyp':
        brand = data[8:12]
        if brand in [b'avif', b'avis']:
            return 'image/avif'
        elif brand in [b'heic', b'heix', b'hevc', b'hevx']:
            return 'image/heic'
        elif brand in [b'mif1', b'msf1', b'heif', b'heix']:
            return 'image/heif'
    # SVG
    elif data[:5].lower() == b'<svg ' or data[:14].lower() == b'<?xml version=':
        return 'image/svg+xml'
    # PDF
    elif data[:4] == b'%PDF':
        return 'application/pdf'
        
    return 'application/octet-stream'


_announcement_image_columns = None


def get_entity_image_columns(cursor, entity='announcement'):
    """Resolve entity image table column names specifically for the entity type."""
    cursor.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'announcement_images'
        """
    )
    columns = {
        row['column_name'] if isinstance(row, dict) else row[0]
        for row in cursor.fetchall()
    }

    # Specifically prioritize based on entity type to avoid cross-contamination
    if entity == 'scholarship':
        primary_key_column = 'sch_img_no' if 'sch_img_no' in columns else 'ann_img_no' if 'ann_img_no' in columns else None
        foreign_key_column = 'req_no' if 'req_no' in columns else None
    else:
        primary_key_column = 'ann_img_no' if 'ann_img_no' in columns else 'sch_img_no' if 'sch_img_no' in columns else None
        foreign_key_column = 'ann_no' if 'ann_no' in columns else None

    # Fallback to general names if specific ones not found
    if not primary_key_column:
        primary_key_column = 'ann_img_no' if 'ann_img_no' in columns else 'sch_img_no' if 'sch_img_no' in columns else None
    if not foreign_key_column:
        foreign_key_column = 'ann_no' if 'ann_no' in columns else 'req_no' if 'req_no' in columns else None

    if not primary_key_column or not foreign_key_column or 'img' not in columns:
        raise RuntimeError(f'announcement_images table does not contain the expected columns for {entity}')

    return primary_key_column, foreign_key_column

def ensure_schema_integrity(cursor):
    """Ensure all required columns exist in scholarships and announcements tables."""
    def read_count(row):
        if isinstance(row, dict):
            return next(iter(row.values()), 0)
        if isinstance(row, (list, tuple)):
            return row[0] if row else 0
        return 0

    # 1. Soft-delete columns
    for table in ['scholarships', 'announcements']:
        cursor.execute(
            """
            SELECT COUNT(*)
            FROM information_schema.columns
            WHERE table_name = %s AND column_name = 'is_removed'
            """,
            (table,)
        )
        if read_count(cursor.fetchone()) == 0:
            print(f"[MIGRATION] Adding is_removed to {table} table")
            cursor.execute(f"ALTER TABLE {table} ADD COLUMN is_removed BOOLEAN DEFAULT FALSE")

    # 2. Scholarship specific fields
    scholarship_cols = {
        'semester': 'VARCHAR(50)',
        'year': 'VARCHAR(50)'
    }
    for col, col_type in scholarship_cols.items():
        cursor.execute(
            """
            SELECT COUNT(*)
            FROM information_schema.columns
            WHERE table_name = 'scholarships' AND column_name = %s
            """,
            (col,)
        )
        if read_count(cursor.fetchone()) == 0:
            print(f"[MIGRATION] Adding {col} to scholarships table")
            cursor.execute(f"ALTER TABLE scholarships ADD COLUMN {col} {col_type}")


def get_row_value(row, key, default=None):
    if row is None:
        return default
    if isinstance(row, dict):
        return row.get(key, default)
    try:
        return row[key]
    except Exception:
        return default

def ensure_is_removed_columns(cursor):
    # Keep wrapper for bit-backwards compatibility if needed elsewhere
    ensure_schema_integrity(cursor)

# ===== DATABASE MIGRATIONS =====

def ensure_verification_columns():
    """Ensure email table has verification columns for admin registration"""
    try:
        conn = get_db_startup()
        cur = conn.cursor()
        
        # Check if verification columns exist
        cur.execute("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'email' AND column_name IN ('is_verified', 'verification_code')
        """)
        existing = [row['column_name'] for row in cur.fetchall()]
        
        if 'is_verified' not in existing:
            print("[MIGRATION] Adding is_verified to email table")
            cur.execute("ALTER TABLE email ADD COLUMN is_verified BOOLEAN DEFAULT FALSE")
            cur.execute("UPDATE email SET is_verified = TRUE") # Existing accounts are considered verified
        
        if 'verification_code' not in existing:
            print("[MIGRATION] Adding verification_code to email table")
            cur.execute("ALTER TABLE email ADD COLUMN verification_code VARCHAR(10)")
        
        conn.commit()
        cur.close()
        conn.close()
        print("[MIGRATION] Email table verification columns ensured")
    except Exception as e:
        print(f"[MIGRATION ERROR] Failed to ensure verification columns: {e}")

# Run migration on startup
try:
    ensure_verification_columns()
except Exception as e:
    print(f"[STARTUP ERROR] Verification migration failed: {e}")

try:
    conn = get_db_startup()
    cur = conn.cursor()
    ensure_schema_integrity(cur)
    conn.commit()
    cur.close()
    conn.close()
except Exception as e:
    print(f"[STARTUP ERROR] Schema integrity migration failed: {e}")

# ===== DECORATORS =====

def _extract_token_from_request():
    token = None

    if 'Authorization' in request.headers:
        auth_header = request.headers['Authorization']
        try:
            token = auth_header.split(" ")[1]
        except IndexError:
            raise ValueError('Invalid token format')

    if not token:
        raise ValueError('Token is missing')

    return token


def _decode_request_token():
    token = _extract_token_from_request()
    data = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
    return data['user_id'], data.get('pro_no'), data.get('role')

def token_required(f):
    """Require valid JWT token"""
    @wraps(f)
    def decorated(*args, **kwargs):
        conn = None
        cursor = None
        
        try:
            current_user_id, pro_no, role = _decode_request_token()
            
            # Real-time synchronization check: Verify if the account is locked in the database
            conn = get_db()
            cursor = conn.cursor()
            
            # Check either user_no (for admins) or applicant_no (for scholars)
            if role and (role.lower() == 'scholar' or role.lower() == 'user'):
                cursor.execute("SELECT is_locked FROM email WHERE applicant_no = %s", (current_user_id,))
            else:
                cursor.execute("SELECT is_locked FROM email WHERE user_no = %s", (current_user_id,))
            
            lock_record = cursor.fetchone()
            if lock_record and lock_record.get('is_locked'):
                cursor.close()
                conn.close()
                cursor = None
                conn = None
                return jsonify({'message': 'Account has been suspended. Please contact the administrator.', 'suspended': True}), 403
                
            cursor.close()
            conn.close()
            cursor = None
            conn = None
            
        except (ValueError, KeyError) as e:
            return jsonify({'message': str(e)}), 401
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid token'}), 401
        except Exception as e:
            print(f"[AUTH] Synchronization check failed: {e}")
            # If database check fails, we allow the request to proceed if the JWT is valid to prevent complete system lock-out
            # during temporary DB hiccups, but in production, you might want to block this as well.
        finally:
            if cursor:
                try:
                    cursor.close()
                except Exception:
                    pass
            if conn:
                try:
                    conn.close()
                except Exception:
                    pass

        
        return f(current_user_id, pro_no, role, *args, **kwargs)
    
    return decorated


def token_required_lightweight(f):
    """Require a valid JWT token without a database synchronization check."""
    @wraps(f)
    def decorated(*args, **kwargs):
        try:
            current_user_id, pro_no, role = _decode_request_token()
        except (ValueError, KeyError) as e:
            return jsonify({'message': str(e)}), 401
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid token'}), 401
        except Exception as e:
            print(f"[AUTH ERROR LIGHT] Token decode failed: {str(e)}", flush=True)
            return jsonify({'message': 'Internal auth error'}), 401

        return f(current_user_id, pro_no, role, *args, **kwargs)

    return decorated

def generate_token(user_id, role, pro_no):
    """Generate JWT token with user_id, role, and pro_no"""
    payload = {
        'user_id': user_id,
        'role': role,
        'pro_no': pro_no,
        'iat': datetime.utcnow(),
        'exp': datetime.utcnow() + timedelta(hours=TOKEN_EXPIRY)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm='HS256')


def generate_password_reset_token(user_no, email, provider_name, pro_no):
    """Generate a time-limited password reset token."""
    payload = {
        'purpose': 'password-reset',
        'user_no': user_no,
        'email': email,
        'provider_name': provider_name,
        'pro_no': pro_no,
        'iat': datetime.utcnow(),
        'exp': datetime.utcnow() + timedelta(minutes=PASSWORD_RESET_EXPIRY_MINUTES),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm='HS256')


def decode_password_reset_token(token):
    """Validate and decode a password reset token."""
    payload = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
    if payload.get('purpose') != 'password-reset':
        raise jwt.InvalidTokenError('Invalid password reset token')
    return payload


def fetch_google_access_token():
    """Exchange the configured refresh token for a Gmail API access token."""
    print("[FETCH_GOOGLE_ACCESS_TOKEN] Starting token exchange...", flush=True)
    
    missing_settings = []
    if not GOOGLE_CLIENT_ID:
        missing_settings.append('GOOGLE_CLIENT_ID')
    if not GOOGLE_CLIENT_SECRET:
        missing_settings.append('GOOGLE_CLIENT_SECRET')
    if not GOOGLE_REFRESH_TOKEN:
        missing_settings.append('GOOGLE_REFRESH_TOKEN')

    if missing_settings:
        print(f"[FETCH_GOOGLE_ACCESS_TOKEN] ERROR: Missing settings: {missing_settings}", flush=True)
        raise RuntimeError(
            f"Google Gmail API credentials are not configured. Missing: {', '.join(missing_settings)}"
        )
    
    print("[FETCH_GOOGLE_ACCESS_TOKEN] All credentials present, exchanging refresh token...", flush=True)

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
        print("[FETCH_GOOGLE_ACCESS_TOKEN] Sending token exchange request to OAuth2...", flush=True)
        with urllib_request.urlopen(token_request, timeout=30) as response:
            payload = json.loads(response.read().decode('utf-8'))
        print("[FETCH_GOOGLE_ACCESS_TOKEN] Token exchange response received", flush=True)
    except urllib_error.HTTPError as exc:
        response_body = exc.read().decode('utf-8', errors='replace')
        print(f"[FETCH_GOOGLE_ACCESS_TOKEN] OAuth2 HTTP Error: {exc.code} - {response_body}", flush=True)
        raise RuntimeError(f'Google token exchange failed: {response_body}') from exc
    except OSError as exc:
        print(f"[FETCH_GOOGLE_ACCESS_TOKEN] Network error: {str(exc)}", flush=True)
        raise RuntimeError('Google token exchange failed because the network request could not be completed') from exc

    access_token = payload.get('access_token')
    if not access_token:
        print(f"[FETCH_GOOGLE_ACCESS_TOKEN] ERROR: No access token in response: {payload}", flush=True)
        raise RuntimeError('Google token exchange succeeded but no access token was returned')

    print("[FETCH_GOOGLE_ACCESS_TOKEN] Access token obtained successfully", flush=True)
    return access_token


def generate_verification_code():
    """Generate a random 6-digit verification code."""
    import random
    return str(random.randint(100000, 999999))


def send_verification_email(receiver_email, code):
    """Send a verification email via the Gmail API."""
    if not GMAIL_SENDER_EMAIL:
        raise RuntimeError('Gmail sender email is not configured.')

    body = f"""Hello,

Thank you for registering with ISKOMATS Admin. To complete your registration, please use the following verification code:

{code}

This code will expire in {PASSWORD_RESET_EXPIRY_MINUTES} minutes.

If you did not register for an account, please ignore this email.

Best regards,
The ISKOMATS Team
"""
    
    # Create proper MIME email using MIMEText
    msg = MIMEText(body)
    msg['Subject'] = 'Verify your ISKOMATS Admin Account'
    msg['From'] = GMAIL_SENDER_EMAIL
    msg['To'] = receiver_email
    
    try:
        access_token = fetch_google_access_token()
    except Exception as e:
        print(f"[GOOGLE AUTH ERROR] {e}")
        raise RuntimeError(f"Authentication with Google failed: {e}")

    encoded_message = base64.urlsafe_b64encode(msg.as_bytes()).decode('utf-8')
    gmail_request_body = json.dumps({'raw': encoded_message}).encode('utf-8')
    
    email_request = urllib_request.Request(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        data=gmail_request_body,
        headers={
            'Authorization': f'Bearer {access_token}',
            'Content-Type': 'application/json',
        },
        method='POST',
    )
    
    try:
        with urllib_request.urlopen(email_request, timeout=30) as response:
            return json.loads(response.read().decode('utf-8'))
    except urllib_error.HTTPError as exc:
        response_body = exc.read().decode('utf-8', errors='replace')
        raise RuntimeError(f'Gmail API send failed: {response_body}') from exc
    except OSError as exc:
        raise RuntimeError('Gmail API request failed because the network request could not be completed') from exc


def send_password_reset_email(receiver_email, reset_url, provider_name=None):
    """Send a password reset email via the Gmail API over HTTPS."""
    from email.mime.text import MIMEText
    
    print(f"[SEND_PASSWORD_RESET_EMAIL] Starting email send process...", flush=True)
    print(f"[SEND_PASSWORD_RESET_EMAIL] Recipient: {receiver_email}", flush=True)
    print(f"[SEND_PASSWORD_RESET_EMAIL] GMAIL_SENDER_EMAIL: {GMAIL_SENDER_EMAIL}", flush=True)
    
    if not GMAIL_SENDER_EMAIL:
        print("[SEND_PASSWORD_RESET_EMAIL] ERROR: GMAIL_SENDER_EMAIL not configured", flush=True)
        raise RuntimeError('Gmail sender email is not configured. Missing: GMAIL_SENDER_EMAIL')

    provider_label = provider_name or 'ISKOMATS Admin'
    body = f"""Hello,

We received a request to reset your password for {provider_label}.

Use the link below to set a new password:
{reset_url}

This link will expire in {PASSWORD_RESET_EXPIRY_MINUTES} minutes.

If you did not request a password reset, you can ignore this email.

Best regards,
The ISKOMATS Team
"""

    # Create proper MIME email using MIMEText (like the student API does)
    msg = MIMEText(body)
    msg['Subject'] = 'Reset your ISKOMATS password'
    msg['From'] = GMAIL_SENDER_EMAIL
    msg['To'] = receiver_email

    print("[SEND_PASSWORD_RESET_EMAIL] Fetching Google access token...", flush=True)
    access_token = fetch_google_access_token()
    print("[SEND_PASSWORD_RESET_EMAIL] Access token obtained successfully", flush=True)
    
    encoded_message = base64.urlsafe_b64encode(msg.as_bytes()).decode('utf-8')
    gmail_request_body = json.dumps({'raw': encoded_message}).encode('utf-8')
    gmail_request = urllib_request.Request(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        data=gmail_request_body,
        headers={
            'Authorization': f'Bearer {access_token}',
            'Content-Type': 'application/json',
        },
        method='POST',
    )

    try:
        print("[SEND_PASSWORD_RESET_EMAIL] Sending request to Gmail API...", flush=True)
        with urllib_request.urlopen(gmail_request, timeout=30) as response:
            response_data = response.read()
            print(f"[SEND_PASSWORD_RESET_EMAIL] Gmail API response: {response_data.decode('utf-8')}", flush=True)
    except urllib_error.HTTPError as exc:
        response_body = exc.read().decode('utf-8', errors='replace')
        print(f"[SEND_PASSWORD_RESET_EMAIL] Gmail API HTTP Error: {exc.code} - {response_body}", flush=True)
        raise RuntimeError(f'Gmail API send failed: {response_body}') from exc
    except OSError as exc:
        print(f"[SEND_PASSWORD_RESET_EMAIL] Network error: {str(exc)}", flush=True)
        raise RuntimeError('Gmail API request failed because the network request could not be completed') from exc
    except Exception as exc:
        print(f"[SEND_PASSWORD_RESET_EMAIL] Unexpected error: {str(exc)}", flush=True)
        raise
        
    print("[SEND_PASSWORD_RESET_EMAIL] Email sent successfully!", flush=True)


def send_announcement_emails(
    title,
    message,
    provider_no,
    provider_name=None,
    send_to_all=True,
    subject_prefix='New Announcement from',
    intro_prefix='You have received a new announcement from',
):
    """Send announcement emails to applicants via Gmail API (runs asynchronously).
    
    Args:
        title: Announcement title
        message: Announcement message
        provider_no: Provider number
        provider_name: Provider name (optional)
        send_to_all: If True, send to ALL applicants in the system. If False, send only to applicants who applied to this provider.
    """
    if not GMAIL_SENDER_EMAIL:
        print("[EMAIL ERROR] Gmail sender email is not configured")
        return False
    
    try:
        conn = get_db()
        cur = conn.cursor()
        
        # Get applicants based on send_to_all flag
        if send_to_all:
            # Send to ALL applicants in the system
            cur.execute("""
                SELECT DISTINCT a.applicant_no, a.first_name, a.last_name, COALESCE(e.email_address, a.email) AS email_address
                FROM applicants a
                LEFT JOIN email e ON a.applicant_no = e.applicant_no
                WHERE COALESCE(e.email_address, a.email) IS NOT NULL
            """)
        else:
            # Send only to applicants who applied to this provider's scholarships
            cur.execute("""
                SELECT DISTINCT a.applicant_no, a.first_name, a.last_name, COALESCE(e.email_address, a.email) AS email_address
                FROM applicants a
                INNER JOIN applicant_status ast ON a.applicant_no = ast.applicant_no
                INNER JOIN scholarships s ON ast.scholarship_no = s.req_no
                LEFT JOIN email e ON a.applicant_no = e.applicant_no
                WHERE s.pro_no = %s AND COALESCE(e.email_address, a.email) IS NOT NULL
            """, (provider_no,))
        
        applicants = cur.fetchall()
        conn.close()
        
        if not applicants:
            print(f"[EMAIL INFO] No applicants found to send announcement, provider {provider_no}")
            return True
        
        print(f"[EMAIL BACKGROUND] Starting email batch job for announcement - {len(applicants)} recipients")
        
        provider_label = provider_name or 'ISKOMATS'
        access_token = fetch_google_access_token()
        success_count = 0
        fail_count = 0
        
        for idx, applicant in enumerate(applicants):
            try:
                email_address = applicant['email_address']
                first_name = applicant['first_name'] or 'Applicant'
                
                body = f"""Hello {first_name},

{intro_prefix} {provider_label}:

Title: {title}

Message:
{message}

Please log in to your ISKOMATS account for more details.

Best regards,
ISKOMATS Team
"""
                
                # Create proper MIME email using MIMEText
                msg = MIMEText(body)
                msg['Subject'] = f'{subject_prefix} {provider_label}'
                msg['From'] = GMAIL_SENDER_EMAIL
                msg['To'] = email_address
                
                encoded_message = base64.urlsafe_b64encode(msg.as_bytes()).decode('utf-8')
                gmail_request_body = json.dumps({'raw': encoded_message}).encode('utf-8')
                gmail_request = urllib_request.Request(
                    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
                    data=gmail_request_body,
                    headers={
                        'Authorization': f'Bearer {access_token}',
                        'Content-Type': 'application/json',
                    },
                    method='POST',
                )
                
                with urllib_request.urlopen(gmail_request, timeout=30) as response:
                    response.read()
                success_count += 1
                
                # Log progress every 10 emails
                if (idx + 1) % 10 == 0:
                    print(f"[EMAIL BACKGROUND] Progress: {idx + 1}/{len(applicants)} emails sent")
                
            except Exception as e:
                print(f"[EMAIL ERROR] Failed to send to {applicant['email_address']}: {str(e)}", flush=True)
                fail_count += 1
        
        print(f"[EMAIL COMPLETE] Sent {success_count}/{len(applicants)} announcement emails (failed: {fail_count}) for provider {provider_no}", flush=True)
        return True
        
    except Exception as e:
        print(f"[EMAIL ERROR] Critical error in background email job: {str(e)}", flush=True)
        traceback.print_exc()
        return False


def notify_all_applicants(title, message, notif_type='scholarship'):
    """Send an in-app notification to all applicants."""
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT DISTINCT a.applicant_no
            FROM applicants a
            """
        )
        applicants = cur.fetchall()
        conn.close()
        conn = None

        for applicant in applicants:
            create_notification(
                user_no=applicant['applicant_no'],
                title=title,
                message=message,
                notif_type=notif_type,
            )
    except Exception as exc:
        print(f"[NOTIF ERROR] Failed to notify applicants: {exc}")
    finally:
        if conn:
            conn.close()


def run_background_task(target, *args, **kwargs):
    worker = threading.Thread(target=target, args=args, kwargs=kwargs, daemon=True)
    worker.start()
    return worker


def notify_announcement_applicants(
    title,
    message,
    provider_no,
    provider_name=None,
    send_to_all_applicants=True,
    send_email_alerts=False,
    notification_title_prefix='New Announcement',
):
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        if send_to_all_applicants:
            cur.execute(
                """
                SELECT DISTINCT a.applicant_no
                FROM applicants a
                """
            )
        else:
            cur.execute(
                """
                SELECT DISTINCT ast.applicant_no
                FROM applicant_status ast
                JOIN scholarships s ON ast.scholarship_no = s.req_no
                WHERE s.pro_no = %s
                """,
                (provider_no,),
            )

        recipients = cur.fetchall()
        conn.close()
        conn = None

        provider_label = (provider_name or 'ISKOMATS').strip()
        notification_title = f"{notification_title_prefix}: {title}"
        notification_message = message[:100] + ('...' if len(message) > 100 else '')

        if provider_label and provider_label.lower() != 'iskomats':
            notification_message = f"{provider_label}: {notification_message}"

        email_success_count = 0
        email_failure_count = 0

        for recipient in recipients:
            result = create_notification(
                user_no=recipient['applicant_no'],
                title=notification_title,
                message=notification_message,
                notif_type='announcement',
                send_email=send_email_alerts,
            )

            if send_email_alerts:
                if result and result.get('email_sent'):
                    email_success_count += 1
                else:
                    email_failure_count += 1

        if send_email_alerts:
            print(
                f"[ANNOUNCEMENT EMAIL] Notification email dispatch finished for provider {provider_no}: "
                f"sent={email_success_count}, failed={email_failure_count}",
                flush=True,
            )
    except Exception as exc:
        print(f"[NOTIF ERROR] Failed to notify announcement recipients: {exc}", flush=True)
    finally:
        if conn:
            conn.close()


def ensure_admin_activity_log_table(cursor):
    """Ensure the admin audit table exists before writing or reading logs."""
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS admin_activity_logs (
            log_id SERIAL PRIMARY KEY,
            actor_user_no INTEGER,
            action VARCHAR(120) NOT NULL,
            target_type VARCHAR(80),
            target_id VARCHAR(80),
            target_label VARCHAR(255),
            provider_no INTEGER,
            status VARCHAR(50) NOT NULL DEFAULT 'success',
            occurred_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_occurred_at ON admin_activity_logs(occurred_at DESC)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_provider_no ON admin_activity_logs(provider_no)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_actor_user_no ON admin_activity_logs(actor_user_no)"
    )


def fetch_actor_context(cursor, user_no):
    """Resolve the actor's display information from the users/email tables."""
    if not user_no:
        return None

    cursor.execute(
        """
        SELECT
            u.user_no,
            COALESCE(u.user_name, p.provider_name, 'Unknown User') AS actor_name,
            e.email_address AS actor_email,
            p.pro_no AS provider_no,
            COALESCE(p.provider_name, 'All') AS provider_name
        FROM users u
        LEFT JOIN scholarship_providers p ON u.pro_no = p.pro_no
        LEFT JOIN email e ON e.user_no = u.user_no
        WHERE u.user_no = %s
        LIMIT 1
        """,
        (user_no,),
    )
    return cursor.fetchone()


def resolve_provider_context(cursor, user_no, role, token_pro_no=None):
    actor_context = fetch_actor_context(cursor, user_no) if user_no else None
    normalized_role = (role or '').strip().lower()
    resolved_provider_no = token_pro_no
    resolved_provider_name = None

    if actor_context:
        actor_provider_no = actor_context.get('provider_no')
        actor_provider_name = (actor_context.get('provider_name') or '').strip()
        
        print(f"[AUTH DEBUG] Actor {user_no} context: Role={role}, ActorPro={actor_provider_no}, ActorName={actor_provider_name}, TokenPro={token_pro_no}")

        if normalized_role != 'admin' and actor_provider_no is not None:
            resolved_provider_no = actor_provider_no

        if actor_provider_name and actor_provider_name.lower() != 'all':
            resolved_provider_name = actor_provider_name

    if resolved_provider_no is not None and not resolved_provider_name:
        cursor.execute(
            "SELECT provider_name FROM scholarship_providers WHERE pro_no = %s LIMIT 1",
            (resolved_provider_no,),
        )
        provider_row = cursor.fetchone()
        if provider_row and provider_row.get('provider_name'):
            resolved_provider_name = provider_row['provider_name']

    if not resolved_provider_name:
        resolved_provider_name = 'ISKOMATS' if normalized_role != 'admin' else 'All'

    print(f"[AUTH DEBUG] Final Resolved Context: ProNo={resolved_provider_no}, ProName={resolved_provider_name}")
    return resolved_provider_no, resolved_provider_name


def fetch_account_activity_context(cursor, account_id):
    """Resolve the current account context for audit logging."""
    cursor.execute(
        """
        SELECT
            e.em_no AS account_id,
            e.email_address AS email,
            COALESCE(
                u.user_name,
                NULLIF(TRIM(COALESCE(a.first_name, '') || ' ' || COALESCE(a.last_name, '')), ''),
                'Unknown Account'
            ) AS name,
            CASE WHEN e.user_no IS NOT NULL THEN 'Admin' ELSE 'Applicant' END AS account_type,
            COALESCE(p.pro_no, s.pro_no) AS provider_no,
            COALESCE(p.provider_name, s.scholarship_name, 'All') AS provider_name
        FROM email e
        LEFT JOIN users u ON e.user_no = u.user_no
        LEFT JOIN scholarship_providers p ON u.pro_no = p.pro_no
        LEFT JOIN applicants a ON e.applicant_no = a.applicant_no
        LEFT JOIN (
            SELECT applicant_no, scholarship_no,
                   ROW_NUMBER() OVER (PARTITION BY applicant_no ORDER BY stat_no DESC) AS rn
            FROM applicant_status
        ) ast ON ast.applicant_no = a.applicant_no AND ast.rn = 1
        LEFT JOIN scholarships s ON ast.scholarship_no = s.req_no
        WHERE e.em_no = %s
        LIMIT 1
        """,
        (account_id,),
    )
    return cursor.fetchone()


def record_admin_activity(
    *,
    actor_user_no=None,
    action,
    target_type=None,
    target_id=None,
    target_label=None,
    provider_no=None,
    status='success',
):
    """Persist an audit event without interrupting the primary request flow."""
    conn = None
    cursor = None

    try:
        conn = get_db()
        cursor = conn.cursor()
        ensure_admin_activity_log_table(cursor)

        actor_context = None
        if actor_user_no:
            actor_context = fetch_actor_context(cursor, actor_user_no)

        resolved_provider_no = provider_no if provider_no is not None else (actor_context['provider_no'] if actor_context else None)

        cursor.execute(
            """
            INSERT INTO admin_activity_logs (
                actor_user_no,
                action,
                target_type,
                target_id,
                target_label,
                provider_no,
                status
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                actor_user_no,
                action,
                target_type,
                str(target_id) if target_id is not None else None,
                target_label,
                resolved_provider_no,
                (status or 'success').lower(),
            ),
        )
        conn.commit()
    except Exception as exc:
        if conn:
            conn.rollback()
        print(f"[AUDIT] Failed to write admin activity log: {exc}")
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

# ===== CHAT SOCKET EVENTS =====

def initialize_auto_chat_rooms():
    """Create initial chat rooms for all pending/accepted applicants and their providers"""
    conn = None
    cursor = None
    try:
        conn = get_db_startup()
        cursor = conn.cursor()
        
        # Ensure table exists with new schema
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS message (
                m_id SERIAL PRIMARY KEY,
                applicant_no INTEGER,
                pro_no INTEGER,
                room VARCHAR(50),
                username VARCHAR(255) NOT NULL,
                message TEXT NOT NULL,
                timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_message_app_pro ON message(applicant_no, pro_no)")
        
        # Get all valid applicant-provider pairs
        cursor.execute("""
            SELECT DISTINCT ast.applicant_no, s.pro_no 
            FROM applicant_status ast
            JOIN scholarships s ON ast.scholarship_no = s.req_no
            WHERE ast.is_accepted IS NULL OR ast.is_accepted IS TRUE
        """)
        pairs = cursor.fetchall()
        
        # Look up provider names dynamically from DB
        cursor.execute("SELECT pro_no, provider_name FROM scholarship_providers")
        program_names = {row['pro_no']: row['provider_name'] for row in cursor.fetchall()}
        
        for p in pairs:
            app_no = p['applicant_no']
            pro_no = p['pro_no']
            if not app_no or not pro_no: continue
            
            sender_name = program_names.get(pro_no, 'Scholarship Program')
            
            # Check if room already has messages in new columns
            cursor.execute("SELECT 1 FROM message WHERE applicant_no = %s AND pro_no = %s LIMIT 1", (app_no, pro_no))
            if not cursor.fetchone():
                room = f"{app_no}+{pro_no}"
                # Create initial system message
                cursor.execute("""
                    INSERT INTO message (applicant_no, pro_no, room, username, message, timestamp)
                    VALUES (%s, %s, %s, %s, %s, NOW())
                """, (app_no, pro_no, room, sender_name, f'Chat initiated for Applicant {app_no}.'))
        
        conn.commit()
    except Exception as e:
        print(f"Chat initialization error: {e}")
        print("Skipping automatic chat room initialization until the database becomes available.")
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

def init_socketio(socketio):
    """Initialize SocketIO events for chatting"""
    global _socketio_instance
    _socketio_instance = socketio
    
    # Run once on initialization
    import eventlet
    print("[STARTUP] Spawning chat room initialization in background...")
    eventlet.spawn(initialize_auto_chat_rooms)

    @socketio.on('login')
    def on_login(data):
        token = data.get('token')
        if not token:
            emit('error', {'msg': 'Token required'})
            return

        try:
            # Decode token to identify user
            decoded = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
            # Support both student (user_no) and admin (user_id) token formats
            user_id = decoded.get('user_id') or decoded.get('user_no')
            user_role = decoded.get('role', 'student' if 'user_no' in decoded else None)
            session['role'] = user_role
            session['user_id'] = user_id
            
            # Normalize user_role before checking against admin_roles
            if user_role and user_role != 'student':
                ur_low = user_role.lower()
                if 'vilma' in ur_low:
                    user_role = 'vilma'
                elif 'africa' in ur_low:
                    user_role = 'africa'
                elif 'tulong' in ur_low or 'mandanas' in ur_low or 'ched' in ur_low:
                    user_role = 'tulong'
                elif 'admin' in ur_low:
                    user_role = 'admin'

            print(f"DEBUG Chat Login: user_id={user_id}, role={user_role}")
            
            if not user_id:
                print("ERROR: No user_id/user_no in token")
                emit('error', {'msg': 'Invalid token payload'})
                return

            # Always ensure rooms are up to date for this user on login
            initialize_auto_chat_rooms()
            
            # Identify name and provider for chat
            conn = get_db()
            cursor = conn.cursor()
            
            # For providers/admins, check users table
            cursor.execute("SELECT user_name, pro_no FROM users WHERE user_no = %s", (user_id,))
            user_row = cursor.fetchone()
            username = user_row['user_name'] if user_row else None
            pro_no = user_row['pro_no'] if user_row else None

            # For students, check applicants table
            if not username or user_role == 'student':
                cursor.execute("SELECT first_name FROM applicants WHERE applicant_no = %s", (user_id,))
                app_row = cursor.fetchone()
                if app_row:
                    username = app_row['first_name']
                    print(f"DEBUG Chat Login: Found student '{username}'")
            
            if not username:
                username = f"User {user_id}"
                print(f"DEBUG Chat Login: User name not found, using default '{username}'")
            
            # Find rooms for this user
            rooms = []
            admin_roles = ['admin', 'vilma', 'africa', 'tulong']
            if user_role in admin_roles:
                # Provider room format: applicant_id+pro_no
                if pro_no:
                    # Find all relevant scholarships for this provider
                    cursor.execute("""
                        SELECT DISTINCT ast.applicant_no, s.pro_no 
                        FROM applicant_status ast
                        JOIN scholarships s ON ast.scholarship_no = s.req_no
                        WHERE s.pro_no = %s
                        UNION
                        SELECT DISTINCT applicant_no, pro_no
                        FROM message
                        WHERE pro_no = %s
                    """, (pro_no, pro_no))
                    relevant_pairs = cursor.fetchall()
                    rooms = [f"{p['applicant_no']}+{p['pro_no']}" for p in relevant_pairs]
                else:
                    # Super admin - can see all rooms with messages
                    cursor.execute("SELECT DISTINCT room FROM message WHERE room IS NOT NULL")
                    rooms = [row['room'] for row in cursor.fetchall()]
            else:
                # Student (Scholar) room format: applicant_id+pro_no
                # Find all scholarships student applied to OR has messages for
                cursor.execute("""
                    SELECT DISTINCT ast.applicant_no, s.pro_no 
                    FROM applicant_status ast
                    JOIN scholarships s ON ast.scholarship_no = s.req_no
                    WHERE ast.applicant_no = %s
                    UNION
                    SELECT DISTINCT applicant_no, pro_no
                    FROM message
                    WHERE applicant_no = %s
                """, (user_id, user_id))
                student_pairs = cursor.fetchall()
                rooms = [f"{p['applicant_no']}+{p['pro_no']}" for p in student_pairs]
                print(f"DEBUG Chat Login: Studentrooms={rooms}")
            
            for room in rooms:
                join_room(room)
            
            # Attach provider names to rooms for the frontend
            rooms_with_names = []
            for room in rooms:
                try:
                    pro_no_for_room = int(room.split('+')[1]) if '+' in room else None
                    if pro_no_for_room:
                        cursor.execute("SELECT provider_name FROM scholarship_providers WHERE pro_no = %s", (pro_no_for_room,))
                        prov = cursor.fetchone()
                        provider_label = prov['provider_name'] if prov else f"Provider {pro_no_for_room}"
                    else:
                        provider_label = "Admin"
                except Exception:
                    provider_label = room
                rooms_with_names.append({'room': room, 'provider_name': provider_label})
            
            emit('logged_in', {
                'name': username,
                'id': user_id,
                'role': user_role,
                'rooms': rooms_with_names
            })
            cursor.close()
            conn.close()
        except Exception as e:
            emit('error', {'msg': f'Authentication failed: {str(e)}'})

    @socketio.on('start_chat')
    def on_start_chat(data):
        # Admin starting chat with applicant
        applicant_id = data.get('applicant_id')
        pro_no = data.get('pro_no') # provider pro_no
        
        if not applicant_id or not pro_no:
            emit('error', {'msg': 'Missing ID'})
            return

        room = f"{applicant_id}+{pro_no}"
        join_room(room)
        
        # Get applicant name for UI
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT first_name, last_name FROM applicants WHERE applicant_no = %s", (applicant_id,))
        app = cursor.fetchone()
        other_name = app['first_name'] if app else f"Applicant {applicant_id}"
        cursor.close()
        conn.close()

        emit('add_room', {
            'room': room,
            'applicant_no': applicant_id,
            'pro_no': pro_no,
            'other_name': other_name
        })

    @socketio.on('load_history')
    def on_load_history(data):
        room = data.get('room')
        if not room:
            return

        try:
            # Parse IDs from room format "app_no+pro_no"
            app_no, pro_no = map(int, room.split('+'))
            
            conn = get_db()
            cursor = conn.cursor()
            
            # Fetch message history JOINED with current applicant status and applicant info
            query = """
                SELECT m.m_id, 
                       CASE 
                           WHEN m.username = (a.first_name || ' ' || a.last_name) OR m.username = a.first_name THEN a.first_name 
                           ELSE m.username 
                       END as username,
                       m.message, m.timestamp,
                       CASE 
                           WHEN s.is_accepted IS TRUE THEN 'Accepted'
                           WHEN s.is_accepted IS FALSE THEN 'Declined'
                           ELSE 'Pending'
                       END as student_status
                FROM message m
                LEFT JOIN applicant_status s ON m.applicant_no = s.applicant_no
                LEFT JOIN applicants a ON m.applicant_no = a.applicant_no
                WHERE m.applicant_no = %s AND m.pro_no = %s
            """
            params = [app_no, pro_no]

            # If the user is a student, we filter the history so they only see 
            # messages from their CURRENT application sessions.
            if session.get('role') == 'student':
                # Get the oldest creation date among active applications for this provider
                cursor.execute("""
                    SELECT MIN(created_at) as session_start
                    FROM applicant_status ast
                    JOIN scholarships sch ON ast.scholarship_no = sch.req_no
                    WHERE ast.applicant_no = %s AND sch.pro_no = %s
                """, (app_no, pro_no))
                row = cursor.fetchone()
                session_start = row.get('session_start') if row else None
                
                if session_start:
                    query += " AND m.timestamp >= %s"
                    params.append(session_start)
                else:
                    # If no active application exists, don't show any history to the student
                    query += " AND 1=0"
            
            query += " ORDER BY m.timestamp ASC LIMIT 100"
            cursor.execute(query, tuple(params))
            messages = cursor.fetchall()
            
            for msg in messages:
                emit('message', {
                    'm_id': msg['m_id'],
                    'username': msg['username'],
                    'message': msg['message'],
                    'timestamp': msg['timestamp'].strftime('%Y-%m-%d %H:%M:%S'),
                    'room': room,
                    'student_status': msg['student_status']
                })
            cursor.close()
            conn.close()
        except Exception as e:
            print(f"Error loading history: {e}")

    @socketio.on('message')
    def on_message(data):
        room = data.get('room')
        username = data.get('username')
        sender_id = data.get('sender_id')  # ID of who is sending (applicant_no or user_no)
        message_text = data.get('message')

        if not all([room, message_text, sender_id]):
            print(f"Missing required fields: room={room}, message={message_text}, sender_id={sender_id}")
            return

        try:
            # Parse IDs from room format "app_no+pro_no"
            app_no, pro_no = map(int, room.split('+'))
            
            conn = get_db()
            cursor = conn.cursor()
            sender_role = (session.get('role') or '').lower()
            is_student_sender = sender_role == 'student'
            
            # Determine the sender's actual name from the database
            actual_username = username
            
            if is_student_sender:
                cursor.execute("SELECT first_name FROM applicants WHERE applicant_no = %s", (sender_id,))
                applicant_sender = cursor.fetchone()
                if applicant_sender and applicant_sender.get('first_name'):
                    actual_username = applicant_sender['first_name']
                else:
                    actual_username = username or f"Applicant {sender_id}"
            else:
                cursor.execute("""
                    SELECT COALESCE(sp.provider_name, u.user_name) AS sender_name
                    FROM users u
                    LEFT JOIN scholarship_providers sp ON u.pro_no = sp.pro_no
                    WHERE u.user_no = %s
                    LIMIT 1
                """, (sender_id,))
                admin_sender = cursor.fetchone()
                if admin_sender and admin_sender.get('sender_name'):
                    actual_username = admin_sender['sender_name']
                elif username:
                    actual_username = username
                else:
                    actual_username = f"Provider {pro_no}"
            
            # Insert message with explicit IDs and correct username
            cursor.execute("""
                INSERT INTO message (applicant_no, pro_no, room, username, message, timestamp)
                VALUES (%s, %s, %s, %s, %s, NOW())
                RETURNING m_id, timestamp
            """, (app_no, pro_no, room, actual_username, message_text))
            row = cursor.fetchone()
            m_id = row['m_id']
            timestamp = row['timestamp']
            
            # Fetch current status of the applicant to include in the payload
            cursor.execute("""
                SELECT CASE 
                    WHEN is_accepted IS TRUE THEN 'Accepted'
                    WHEN is_accepted IS FALSE THEN 'Declined'
                    ELSE 'Pending'
                END as student_status
                FROM applicant_status 
                WHERE applicant_no = %s
            """, (app_no,))
            status_row = cursor.fetchone()
            student_status = status_row['student_status'] if status_row else 'Pending'
            
            conn.commit()
            cursor.close()
            conn.close()

            emit('message', {
                'm_id': m_id,
                'username': actual_username,
                'message': message_text,
                'room': room,
                'timestamp': timestamp.strftime('%Y-%m-%d %H:%M:%S'),
                'student_status': student_status
            }, to=room)
            
            # Trigger applicant notification and email only for admin/provider-originated messages.
            if not is_student_sender:
                try:
                    notification_result = create_notification(
                        user_no=app_no,
                        title=f"New Message from {actual_username}",
                        message=message_text[:100] + ('...' if len(message_text) > 100 else ''),
                        notif_type='message',
                        send_email=True,
                    )
                    print(
                        f"[MESSAGE NOTIF] applicant_no={app_no}, room={room}, created={notification_result.get('created')}, "
                        f"email_sent={notification_result.get('email_sent')}, reason={notification_result.get('reason', 'ok')}",
                        flush=True,
                    )
                except Exception as e:
                    print(f"[NOTIF ERROR] Failed to trigger message notification: {e}")
        except Exception as e:
            print(f"Error saving message: {e}")

    @socketio.on('applicant_accept')
    def on_applicant_accept(data):
        """Handle applicant acceptance from admin dashboard"""
        try:
            program = data.get('program')
            applicantId = data.get('applicantId')
            applicantName = data.get('applicantName')
            adminName = data.get('adminName')
            
            # Broadcast to all other connected admins (except sender)
            emit('applicant_status_update', {
                'applicantId': applicantId,
                'applicantName': applicantName,
                'program': program,
                'newStatus': 'Accepted',
                'adminName': adminName,
                'timestamp': data.get('timestamp')
            }, broadcast=True, include_self=False)
        except Exception as e:
            print(f"Error broadcasting applicant acceptance: {e}")
            emit('error', {'msg': f'Failed to broadcast acceptance: {str(e)}'})

    @socketio.on('applicant_decline')
    def on_applicant_decline(data):
        """Handle applicant declination from admin dashboard"""
        try:
            program = data.get('program')
            applicantId = data.get('applicantId')
            applicantName = data.get('applicantName')
            adminName = data.get('adminName')
            
            # Broadcast to all other connected admins (except sender)
            emit('applicant_status_update', {
                'applicantId': applicantId,
                'applicantName': applicantName,
                'program': program,
                'newStatus': 'Declined',
                'adminName': adminName,
                'timestamp': data.get('timestamp')
            }, broadcast=True, include_self=False)
        except Exception as e:
            print(f"Error broadcasting applicant declination: {e}")
            emit('error', {'msg': f'Failed to broadcast declination: {str(e)}'})

# Initial check on module load removed as it's handled in init_socketio
# create_message_table()

# ===== AUTH ENDPOINTS =====

@api_bp.route('/auth/login', methods=['POST'])
def login():
    """Login endpoint - returns JWT token"""
    data = request.get_json()
    
    if not data or not data.get('email') or not data.get('password'):
        return jsonify({'message': 'Email and password are required'}), 400
    
    try:
        conn = get_db()
        cursor = conn.cursor()
        normalized_email = data['email'].strip()
        
        # Query user from database based on email table joining with user and scholarship_providers
        cursor.execute('''
            SELECT e.password_hash, e.applicant_no, e.user_no, e.is_locked, u.user_name, u.pro_no, p.provider_name
            FROM email e
            LEFT JOIN users u ON e.user_no = u.user_no
            LEFT JOIN scholarship_providers p ON u.pro_no = p.pro_no
            WHERE e.email_address ILIKE %s
        ''', (normalized_email,))
        user = cursor.fetchone()
        cursor.close()
        conn.close()
        
        if not user or user['applicant_no'] is not None or user['user_no'] is None:
            # Users with applicant_no are applicants, disregarding them entirely
            record_admin_activity(
                action='Login Failed',
                status='failed',
            )
            return jsonify({'message': "Email not found"}), 404

        provider_name = (user['provider_name'] or '').strip() or 'All'
        user_name = user['user_name'] or provider_name or normalized_email
        
        if not bcrypt.check_password_hash(user['password_hash'], data['password']):
            record_admin_activity(
                actor_user_no=user['user_no'],
                action='Login Failed',
                provider_no=user['pro_no'],
                status='failed',
            )
            return jsonify({'message': 'Incorrect password'}), 401
        
        # Check if account is locked
        if user.get('is_locked'):
            record_admin_activity(
                actor_user_no=user['user_no'],
                action='Login Failed',
                provider_no=user['pro_no'],
                status='failed',
            )
            return jsonify({'message': 'Account has been suspended. Please contact the administrator.', 'suspended': True}), 403
        
        # Normalize role for frontend routing
        prov_name = provider_name
        normalized_role = 'admin'
        if 'vilma' in prov_name.lower():
            normalized_role = 'vilma'
        elif 'africa' in prov_name.lower():
            normalized_role = 'africa'
        elif 'tulong' in prov_name.lower() or 'mandanas' in prov_name.lower() or 'ched' in prov_name.lower():
            normalized_role = 'tulong'
        elif 'admin' in prov_name.lower():
            normalized_role = 'admin'
        else:
            normalized_role = prov_name.lower()
        
        # Generate JWT token with pro_no and provider_name
        token = generate_token(user['user_no'], prov_name, user['pro_no'])

        record_admin_activity(
            actor_user_no=user['user_no'],
            action='Login',
            provider_no=user['pro_no'],
            status='success',
        )
        
        return jsonify({
            'success': True,
            'token': token,
            'userRole': normalized_role,
            'userName': user_name,
            'userFirstName': user_name
        }), 200
    
    except Exception as e:
        return jsonify({'message': f'Database error: {str(e)}'}), 500

@api_bp.route('/auth/check-email', methods=['POST'])
def check_email():
    """
    Check if email is available for registration.
    Only checks for conflicts with the same account type being registered.
    
    Request body:
    {
        "email": "user@example.com",
        "account_type": "admin" or "applicant" (optional, defaults to "admin")
    }
    
    Response:
    - If email is NOT used for the specified account_type: available=true (can register)
    - If email IS used for the specified account_type: available=false (conflict)
    """
    data = request.get_json()
    if not data or not data.get('email'):
        return jsonify({'message': 'Email is required'}), 400
    
    account_type_to_check = data.get('account_type', 'admin').lower()  # Default to admin
    if account_type_to_check not in ['admin', 'applicant']:
        account_type_to_check = 'admin'
    
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Check if email exists and get account type
        cursor.execute('''
            SELECT applicant_no, user_no 
            FROM email 
            WHERE email_address ILIKE %s
        ''', (data['email'],))
        result = cursor.fetchone()
        cursor.close()
        conn.close()
        
        if result:
            applicant_no = result.get('applicant_no')
            user_no = result.get('user_no')
            
            # Determine what's currently registered
            has_admin_account = user_no is not None
            has_applicant_account = applicant_no is not None
            
            # Check conflict based on what account type is being registered
            if account_type_to_check == 'admin':
                # Registering as admin: only reject if email already has a user account
                if has_admin_account:
                    return jsonify({
                        'exists': True,
                        'available': False,
                        'account_type': 'admin',
                        'message': 'Email already registered as admin account'
                    }), 200
                else:
                    # Email may exist as applicant, but that's OK for admin registration
                    return jsonify({
                        'exists': True,
                        'available': True,
                        'account_type': 'applicant' if has_applicant_account else None,
                        'message': 'Email available for admin registration'
                    }), 200
            else:  # applicant
                # Registering as applicant: only reject if email already has an applicant account
                if has_applicant_account:
                    return jsonify({
                        'exists': True,
                        'available': False,
                        'account_type': 'applicant',
                        'message': 'Email already registered as applicant account'
                    }), 200
                else:
                    # Email may exist as admin, but that's OK for applicant registration
                    return jsonify({
                        'exists': True,
                        'available': True,
                        'account_type': 'admin' if has_admin_account else None,
                        'message': 'Email available for applicant registration'
                    }), 200
        else:
            # Email doesn't exist at all
            return jsonify({
                'exists': False,
                'available': True,
                'account_type': None,
                'message': 'Email available'
            }), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500

@api_bp.route('/providers', methods=['GET'])
def get_providers():
    """Fetch all scholarship providers from the database"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT pro_no, provider_name FROM scholarship_providers ORDER BY provider_name ASC")
        rows = cursor.fetchall()
        
        result = []
        for row in rows:
            if not row:
                continue

            if isinstance(row, dict):
                provider_no = row.get('pro_no')
                provider_name = row.get('provider_name')
            else:
                if len(row) < 2:
                    continue
                provider_no = row[0]
                provider_name = row[1]

            if provider_name:
                result.append({
                    'pro_no': provider_no,
                    'provider_name': provider_name
                })
            
        cursor.close()
        conn.close()
        return jsonify(result), 200
    except Exception as e:
        print(f"[AUTH] Error fetching providers: {str(e)}")
        return jsonify({'message': f'Error fetching providers: {str(e)}'}), 500




@api_bp.route('/auth/register', methods=['POST'])
def register():
    """Register endpoint - create new user and send verification email"""
    data = request.get_json()
    
    required_fields = ['fullName', 'email', 'username', 'password', 'role']
    if not all(key in data for key in required_fields):
        return jsonify({'message': 'Missing required fields'}), 400
    
    try:
        conn = get_db()
        cursor = conn.cursor()

        normalized_email = data['email'].strip()
        # Only check if email exists as an ADMIN user (user_no is not NULL)
        # Applicant emails (applicant_no only) are allowed to register as admin
        cursor.execute("SELECT 1 FROM email WHERE email_address ILIKE %s AND user_no IS NOT NULL", (normalized_email,))
        if cursor.fetchone():
            cursor.close()
            conn.close()
            return jsonify({'message': 'Email already exists as admin account'}), 409

        password_hash = bcrypt.generate_password_hash(data['password']).decode('utf-8')
        
        # 1. Find or create scholarship provider
        cursor.execute("SELECT pro_no FROM scholarship_providers WHERE provider_name ILIKE %s", (data['role'],))
        provider = cursor.fetchone()
        
        if not provider:
            cursor.execute("INSERT INTO scholarship_providers (provider_name) VALUES (%s) RETURNING pro_no", (data['role'],))
            pro_no = cursor.fetchone()['pro_no']
        else:
            pro_no = provider['pro_no']
        
        # 2. Generate verification code
        verification_code = generate_verification_code()
        
        # 3. Insert into users table
        cursor.execute(
            "INSERT INTO users (pro_no, user_name) VALUES (%s, %s) RETURNING user_no",
            (pro_no, data['fullName'])
        )
        user_no = cursor.fetchone()['user_no']
        
        # 4. Insert into email table with verification code
        cursor.execute(
            "INSERT INTO email (email_address, password_hash, user_no, verification_code, is_verified) VALUES (%s, %s, %s, %s, %s) RETURNING em_no",
            (normalized_email, password_hash, user_no, verification_code, False)
        )
        em_no = cursor.fetchone()['em_no']
        
        conn.commit()
        cursor.close()
        conn.close()

        # 5. Send verification email
        try:
            print(f"[VERIFICATION EMAIL] Attempting to send verification code to {normalized_email}")
            send_verification_email(normalized_email, verification_code)
            print(f"[VERIFICATION EMAIL] Successfully sent verification code to {normalized_email}")
        except Exception as e:
            print(f"[VERIFICATION EMAIL ERROR] Failed to send verification email to {normalized_email}: {str(e)}", flush=True)
            import traceback
            traceback.print_exc()
            # Don't fail registration if email fails to send, but log it

        record_admin_activity(
            actor_user_no=user_no,
            action='Account Registered (Awaiting Verification)',
            target_type='Admin',
            target_id=user_no,
            target_label=data['fullName'],
            provider_no=pro_no,
            status='success',
        )
        
        return jsonify({
            'success': True,
            'message': 'Registration successful. Please check your email for the verification code.',
            'userId': em_no,
            'email': normalized_email
        }), 201
    
    except psycopg2.IntegrityError:
        return jsonify({'message': 'Email already exists'}), 409
    except Exception as e:
        return jsonify({'message': f'Error: {str(e)}'}), 500

@api_bp.route('/auth/logout', methods=['POST'])
@token_required
def logout(current_user_id, pro_no, role):
    """Logout endpoint - invalidate token (frontend should delete token)"""
    record_admin_activity(
        actor_user_no=current_user_id,
        action='Logout',
        provider_no=pro_no,
        status='success',
    )
    return jsonify({'message': 'Logged out successfully'}), 200

@api_bp.route('/auth/forgot-password', methods=['POST'])
def forgot_password():
    """Request password reset - Admin/User accounts only"""
    data = request.get_json()
    
    if not data or not data.get('email'):
        return jsonify({'message': 'Email is required'}), 400

    try:
        normalized_email = data['email'].strip()
        conn = get_db()
        cursor = conn.cursor()
        
        # Check if email exists as a USER account ONLY (user_no must be set, applicant_no must be NULL)
        cursor.execute(
            '''
            SELECT e.user_no, e.email_address, u.user_name, u.pro_no, p.provider_name
            FROM email e
            JOIN users u ON e.user_no = u.user_no
            LEFT JOIN scholarship_providers p ON u.pro_no = p.pro_no
            WHERE e.email_address ILIKE %s
            AND e.user_no IS NOT NULL
            AND e.applicant_no IS NULL
            LIMIT 1
            ''',
            (normalized_email,),
        )
        user = cursor.fetchone()

        if user:
            # User account found - send password reset email
            try:
                reset_token = generate_password_reset_token(
                    user['user_no'],
                    user['email_address'],
                    user['provider_name'],
                    user['pro_no'],
                )
                reset_url = f"{FRONTEND_URL}/reset-password/{reset_token}"
                print(f"[FORGOT PASSWORD] Attempting to send reset email to {user['email_address']}")
                send_password_reset_email(user['email_address'], reset_url, user['provider_name'])
                print(f"[FORGOT PASSWORD] Reset email sent successfully to {user['email_address']}")
                return jsonify({'message': 'If an account exists with this email, a password reset link has been sent'}), 200
            except Exception as email_error:
                print(f"[FORGOT PASSWORD ERROR] Failed to send email to {user['email_address']}: {str(email_error)}", flush=True)
                import traceback
                traceback.print_exc()
                raise  # Re-raise to return error to user
        else:
            # No user account found - check if it's an applicant-only or non-existent
            cursor.execute(
                '''
                SELECT e.applicant_no, e.user_no
                FROM email e
                WHERE e.email_address ILIKE %s
                LIMIT 1
                ''',
                (normalized_email,),
            )
            existing_email = cursor.fetchone()
            
            if existing_email:
                # Email exists but only as applicant (user_no is NULL)
                print(f"[FORGOT PASSWORD] Email {normalized_email} is registered as applicant only, not user account")
            else:
                # Email doesn't exist in system at all
                print(f"[FORGOT PASSWORD] No account found for email: {normalized_email}")
            
            cursor.close()
            conn.close()
            
            # Return error message - account does not exist
            return jsonify({'message': 'Account does not exist', 'success': False}), 404

        cursor.close()
        conn.close()
    except Exception as e:
        print(f"[FORGOT PASSWORD ENDPOINT ERROR] {str(e)}", flush=True)
        return jsonify({'message': f'Failed to send password reset email: {str(e)}'}), 500

@api_bp.route('/auth/reset-password', methods=['POST'])
def reset_password():
    """Reset password with token"""
    data = request.get_json()
    
    if not data or not data.get('token') or not data.get('newPassword'):
        return jsonify({'message': 'Token and new password are required'}), 400

    try:
        payload = decode_password_reset_token(data['token'])
        password_hash = bcrypt.generate_password_hash(data['newPassword']).decode('utf-8')

        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            '''
            UPDATE email
            SET password_hash = %s
            WHERE user_no = %s AND email_address ILIKE %s
            RETURNING em_no
            ''',
            (password_hash, payload['user_no'], payload['email']),
        )
        updated = cursor.fetchone()
        conn.commit()
        cursor.close()
        conn.close()

        if not updated:
            return jsonify({'message': 'Password reset token is invalid'}), 400

        record_admin_activity(
            actor_user_no=payload['user_no'],
            action='Change Password',
            target_type='Auth',
            provider_no=payload.get('pro_no'),
            status='success',
        )
        return jsonify({'message': 'Password reset successfully'}), 200
    except jwt.ExpiredSignatureError:
        return jsonify({'message': 'Password reset link has expired'}), 400
    except jwt.InvalidTokenError:
        return jsonify({'message': 'Password reset link is invalid'}), 400
    except Exception as e:
        return jsonify({'message': f'Failed to reset password: {str(e)}'}), 500

@api_bp.route('/auth/verify-email', methods=['POST'])
def verify_email():
    """Verify admin email with verification code"""
    data = request.get_json()
    
    if not data or not data.get('email') or not data.get('verificationCode'):
        return jsonify({'message': 'Email and verification code are required'}), 400

    try:
        email = data.get('email', '').strip()
        code = data.get('verificationCode', '').strip()
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Check if email exists and code matches
        cursor.execute(
            "SELECT user_no, verification_code, is_verified FROM email WHERE email_address ILIKE %s",
            (email,)
        )
        result = cursor.fetchone()
        
        if not result:
            cursor.close()
            conn.close()
            return jsonify({'message': 'Email not found'}), 404
        
        user_no, stored_code, is_verified = result['user_no'], result['verification_code'], result.get('is_verified', False)
        
        # Check if already verified
        if is_verified:
            cursor.close()
            conn.close()
            return jsonify({
                'message': 'Email is already verified',
                'success': True
            }), 200
        
        # Check if code matches
        if not stored_code or stored_code != code:
            cursor.close()
            conn.close()
            return jsonify({'message': 'Verification code is incorrect'}), 400
        
        # Mark email as verified
        cursor.execute(
            "UPDATE email SET is_verified = TRUE, verification_code = NULL WHERE email_address ILIKE %s",
            (email,)
        )
        conn.commit()
        cursor.close()
        conn.close()
        
        return jsonify({
            'message': 'Email verified successfully',
            'success': True
        }), 200
    except Exception as e:
        return jsonify({'message': f'Failed to verify email: {str(e)}'}), 500

# ===== ADMIN ENDPOINTS =====

@api_bp.route('/accounts', methods=['GET'])
@token_required
def get_accounts(current_user_id, pro_no, role):
    """Get all user accounts"""
    try:
        filters = request.args
        conn = get_db()
        cursor = conn.cursor()

        cursor.execute(
            '''
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'applicant_status' AND column_name = 'status_updated'
            ) AS has_status_updated
            '''
        )
        has_status_updated = cursor.fetchone()['has_status_updated']
        joined_expr = 'COALESCE(ast.status_updated, NOW())::date' if has_status_updated else 'NULL::date'
        
        query = f'''
            SELECT e.em_no as id, e.email_address as email, 
                   COALESCE(u.user_name, p.provider_name, a.first_name || ' ' || a.last_name, 'Unknown') as name,
                   COALESCE(u.user_name, a.first_name, p.provider_name, 'Unknown') as first_name,
                   COALESCE(a.last_name, '') as last_name,
                   CASE WHEN e.user_no IS NOT NULL THEN 'admin' ELSE 'scholar' END as role,
                   CASE WHEN e.user_no IS NOT NULL THEN 'Admin' ELSE 'Applicant' END as type,
                   COALESCE(p.provider_name, s.scholarship_name, 'All') as scholarship,
                   COALESCE(p.pro_no, s.pro_no) as provider_no,
                   CASE
                       WHEN e.user_no IS NOT NULL THEN 'Registered'
                       WHEN ast.is_accepted IS TRUE THEN 'Accepted'
                       WHEN ast.is_accepted IS FALSE THEN 'Rejected'
                       ELSE 'Pending'
                   END as status,
                   {joined_expr} as joined,
                   COALESCE(e.is_locked, false) as locked
            FROM email e
            LEFT JOIN users u ON e.user_no = u.user_no
            LEFT JOIN scholarship_providers p ON u.pro_no = p.pro_no
            LEFT JOIN applicants a ON e.applicant_no = a.applicant_no
            LEFT JOIN (
                SELECT applicant_no, scholarship_no, is_accepted{', status_updated' if has_status_updated else ''},
                       ROW_NUMBER() OVER(PARTITION BY applicant_no ORDER BY {'status_updated DESC' if has_status_updated else 'stat_no DESC'}) as rn
                FROM applicant_status
            ) ast ON a.applicant_no = ast.applicant_no AND ast.rn = 1
            LEFT JOIN scholarships s ON ast.scholarship_no = s.req_no
            WHERE COALESCE(s.is_removed, FALSE) = FALSE
        '''
        params = []
        
        # Isolation: If not superadmin, only show accounts related to this provider
        if role != 'Admin':
            query += ' AND (u.pro_no = %s OR s.pro_no = %s)'
            params.extend([pro_no, pro_no])
        
        if filters.get('role'):
            role_filter = filters['role'].lower()
            if role_filter == 'admin':
                query += ' AND e.user_no IS NOT NULL'
            elif role_filter == 'scholar':
                query += ' AND e.applicant_no IS NOT NULL'
        
        if filters.get('search'):
            query += ' AND (e.email_address ILIKE %s OR a.first_name ILIKE %s OR a.last_name ILIKE %s OR p.provider_name ILIKE %s OR u.user_name ILIKE %s)'
            search_term = f"%{filters['search']}%"
            params.extend([search_term, search_term, search_term, search_term, search_term])
        
        cursor.execute(query, params)
        accounts = cursor.fetchall()
        
        # Deduplicate accounts
        seen_ids = set()
        unique_accounts = []
        for acc in accounts:
            if acc['id'] not in seen_ids:
                seen_ids.add(acc['id'])
                unique_accounts.append(acc)
        
        accounts = unique_accounts
        cursor.close()
        conn.close()
        
        return jsonify({'success': True, 'accounts': accounts}), 200
    
    except Exception as e:
        return jsonify({'message': f'Error: {str(e)}'}), 500

@api_bp.route('/accounts', methods=['POST'])
@token_required
def create_account(current_user_id, pro_no, role):
    """Create new user account"""
    data = request.get_json()
    
    required_fields = ['email', 'password', 'role', 'firstName', 'lastName']
    if not all(key in data for key in required_fields):
        return jsonify({'message': 'Missing required fields'}), 400
    
    try:
        conn = get_db()
        cursor = conn.cursor()

        normalized_email = data['email'].strip()
        cursor.execute("SELECT em_no FROM email WHERE email_address ILIKE %s", (normalized_email,))
        if cursor.fetchone():
            cursor.close()
            conn.close()
            return jsonify({'message': 'Email already exists'}), 409

        password_hash = bcrypt.generate_password_hash(data['password']).decode('utf-8')
        
        account_role = data.get('role', 'scholar').lower()
        
        # 1. Find or create scholarship provider based on 'scholarship' field or 'role'
        provider_name = data.get('scholarship', data.get('role', 'All'))
        cursor.execute("SELECT pro_no FROM scholarship_providers WHERE provider_name ILIKE %s", (provider_name,))
        provider = cursor.fetchone()
        
        if not provider:
            cursor.execute("INSERT INTO scholarship_providers (provider_name) VALUES (%s) RETURNING pro_no", (provider_name,))
            target_provider_no = cursor.fetchone()['pro_no']
        else:
            target_provider_no = provider['pro_no']
            
        full_name = f"{data['firstName']} {data['lastName']}"
        account_id = None
        
        if account_role == 'admin':
            # 2a. Insert into users table
            cursor.execute(
                "INSERT INTO users (pro_no, user_name) VALUES (%s, %s) RETURNING user_no",
                (target_provider_no, full_name)
            )
            user_no = cursor.fetchone()['user_no']
            
            # 3a. Insert into email table
            cursor.execute(
                "INSERT INTO email (email_address, password_hash, user_no) VALUES (%s, %s, %s) RETURNING em_no",
                (normalized_email, password_hash, user_no)
            )
            account_id = cursor.fetchone()['em_no']
        else:
            # 2b. Insert into applicants table
            cursor.execute(
                "INSERT INTO applicants (first_name, last_name) VALUES (%s, %s) RETURNING applicant_no",
                (data['firstName'], data['lastName'])
            )
            applicant_no = cursor.fetchone()['applicant_no']
            
            # Optional: Link to a specific scholarship if provided
            scholarship_name = data.get('scholarship')
            if scholarship_name and scholarship_name not in ['All', 'Admin']:
                cursor.execute("SELECT req_no FROM scholarships WHERE scholarship_name ILIKE %s", (scholarship_name,))
                sch = cursor.fetchone()
                if sch:
                     cursor.execute(
                         "INSERT INTO applicant_status (applicant_no, scholarship_no) VALUES (%s, %s)",
                         (applicant_no, sch['req_no'])
                     )
            
            # 3b. Insert into email table
            cursor.execute(
                "INSERT INTO email (email_address, password_hash, applicant_no) VALUES (%s, %s, %s) RETURNING em_no",
                (normalized_email, password_hash, applicant_no)
            )
            account_id = cursor.fetchone()['em_no']
        
        conn.commit()
        cursor.close()
        conn.close()

        audit_provider_no = target_provider_no
        record_admin_activity(
            actor_user_no=current_user_id,
            action='Account Created',
            target_type='Admin' if account_role == 'admin' else 'Applicant',
            target_id=account_id,
            target_label=full_name,
            provider_no=audit_provider_no,
            status='success',
        )
        
        # Real-time synchronization: Notify connected admins
        safe_emit('account_change', {'action': 'created', 'account_id': account_id}, broadcast=True)
        
        return jsonify({'success': True, 'account': {
            'id': account_id,
            'email': normalized_email,
            'name': full_name,
            'first_name': data['firstName'],
            'last_name': data['lastName'],
            'role': account_role,
            'type': 'Admin' if account_role == 'admin' else 'Applicant',
            'scholarship': provider_name if account_role == 'admin' else data.get('scholarship', 'Unassigned'),
            'status': 'Registered' if account_role == 'admin' else 'Pending',
            'joined': datetime.utcnow().date().isoformat(),
            'locked': False,
        }}), 201
    
    except Exception as e:
        return jsonify({'message': f'Error: {str(e)}'}), 500
    
    except Exception as e:
        return jsonify({'message': f'Error: {str(e)}'}), 500

@api_bp.route('/accounts/<int:account_id>', methods=['PUT'])
@token_required
def update_account(current_user_id, pro_no, role, account_id):
    """Update user account"""
    data = request.get_json()
    
    try:
        conn = get_db()
        cursor = conn.cursor()
        account_context = fetch_account_activity_context(cursor, account_id)
        
        if not account_context:
            cursor.close()
            conn.close()
            return jsonify({'message': 'Account not found'}), 404
        
        # Get user_no or applicant_no from email table
        cursor.execute("SELECT user_no, applicant_no FROM email WHERE em_no = %s", (account_id,))
        email_record = cursor.fetchone()
        
        if not email_record:
            cursor.close()
            conn.close()
            return jsonify({'message': 'Account not found'}), 404
            
        if email_record['user_no']:
            # Update user table
            if 'name' in data or 'firstName' in data or 'lastName' in data:
                name = data.get('name') or f"{data.get('firstName', '')} {data.get('lastName', '')}".strip()
                if name:
                    cursor.execute("UPDATE users SET user_name = %s WHERE user_no = %s", (name, email_record['user_no']))
        elif email_record['applicant_no'] and ('name' in data or 'firstName' in data or 'lastName' in data):
            full_name = data.get('name') or f"{data.get('firstName', '')} {data.get('lastName', '')}".strip()
            name_parts = full_name.split()
            if len(name_parts) >= 2:
                cursor.execute(
                    "UPDATE applicants SET first_name = %s, last_name = %s WHERE applicant_no = %s",
                    (' '.join(name_parts[:-1]), name_parts[-1], email_record['applicant_no'])
                )
                    
        # Update email table
        if 'email' in data:
            cursor.execute("UPDATE email SET email_address = %s WHERE em_no = %s", (data['email'], account_id))
        if 'password' in data and data['password']:
            password_hash = bcrypt.generate_password_hash(data['password']).decode('utf-8')
            cursor.execute("UPDATE email SET password_hash = %s WHERE em_no = %s", (password_hash, account_id))
            
        conn.commit()
        cursor.close()
        conn.close()

        updated_name = data.get('name') or account_context['name']
        record_admin_activity(
            actor_user_no=current_user_id,
            action='Profile Update',
            target_type=account_context['account_type'],
            target_id=account_id,
            target_label=updated_name,
            provider_no=account_context['provider_no'],
            status='success',
        )
        
        # Real-time synchronization: Notify connected admins
        safe_emit('account_change', {'action': 'updated', 'account_id': account_id}, broadcast=True)
        
        return jsonify({'success': True, 'message': 'Account updated'}), 200
    
    except Exception as e:
        return jsonify({'message': f'Error: {str(e)}'}), 500

@api_bp.route('/accounts/<int:account_id>', methods=['DELETE'])
@token_required
def delete_account(current_user_id, pro_no, role, account_id):
    """Delete user account"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        account_context = fetch_account_activity_context(cursor, account_id)
        if not account_context:
            cursor.close()
            conn.close()
            return jsonify({'message': 'Account not found'}), 404
        
        # Get user_no from email table
        cursor.execute("SELECT user_no FROM email WHERE em_no = %s", (account_id,))
        email_record = cursor.fetchone()
        
        # Delete from email table
        cursor.execute('DELETE FROM email WHERE em_no = %s RETURNING em_no', (account_id,))
        deleted = cursor.fetchone()
        
        if deleted and email_record and email_record['user_no']:
            # Also delete from users table
            cursor.execute('DELETE FROM users WHERE user_no = %s', (email_record['user_no'],))
            
        conn.commit()
        cursor.close()
        conn.close()
        
        if not deleted:
            return jsonify({'message': 'Account not found'}), 404

        record_admin_activity(
            actor_user_no=current_user_id,
            action='Account Deleted',
            target_type=account_context['account_type'],
            target_id=account_id,
            target_label=account_context['name'],
            provider_no=account_context['provider_no'],
            status='success',
        )
        
        # Real-time synchronization: Notify connected admins
        safe_emit('account_change', {'action': 'deleted', 'account_id': account_id}, broadcast=True)
        
        return jsonify({'success': True, 'message': 'Account deleted'}), 200
    
    except Exception as e:
        return jsonify({'message': f'Error: {str(e)}'}), 500

@api_bp.route('/accounts/<int:account_id>/lock', methods=['PUT'])
@token_required
def toggle_account_lock(current_user_id, pro_no, role, account_id):
    """Lock or unlock a user account"""
    data = request.get_json()
    if not data or 'locked' not in data:
        return jsonify({'message': 'Missing locked field'}), 400
    
    try:
        conn = get_db()
        cursor = conn.cursor()
        account_context = fetch_account_activity_context(cursor, account_id)
        if not account_context:
            cursor.close()
            conn.close()
            return jsonify({'message': 'Account not found'}), 404
        
        # Update the email table with lock status
        cursor.execute('''
            UPDATE email 
            SET is_locked = %s 
            WHERE em_no = %s
            RETURNING em_no
        ''', (data['locked'], account_id))
        
        result = cursor.fetchone()
        conn.commit()
        cursor.close()
        conn.close()
        
        if not result:
            return jsonify({'message': 'Account not found'}), 404
        
        status = 'locked' if data['locked'] else 'unlocked'
        record_admin_activity(
            actor_user_no=current_user_id,
            action='Account Locked' if data['locked'] else 'Account Unlocked',
            target_type=account_context['account_type'],
            target_id=account_id,
            target_label=account_context['name'],
            provider_no=account_context['provider_no'],
            status='success',
        )
        
        # Real-time synchronization: Notify connected admins
        safe_emit('account_change', {'action': status, 'account_id': account_id}, broadcast=True)
        
        return jsonify({'success': True, 'message': f'Account {status}'}), 200
    
    except Exception as e:
        return jsonify({'message': f'Error: {str(e)}'}), 500

@api_bp.route('/statistics', methods=['GET'])
@token_required
def get_statistics(current_user_id, pro_no, role):
    """Get dashboard statistics"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        if role != 'Admin':
            # Get total users related to this provider
            cursor.execute('''
                SELECT COUNT(DISTINCT e.em_no) as total FROM email e 
                LEFT JOIN users u ON e.user_no = u.user_no 
                WHERE u.pro_no = %s OR e.applicant_no IN (
                    SELECT applicant_no FROM applicant_status ast 
                    JOIN scholarships s ON ast.scholarship_no = s.req_no 
                    WHERE s.pro_no = %s
                )
            ''', (pro_no, pro_no))
            total_users = cursor.fetchone()['total']
            
            # Get users by role for this provider
            cursor.execute('''
                SELECT CASE WHEN e.user_no IS NOT NULL THEN 'admin' ELSE 'scholar' END as role, 
                       COUNT(DISTINCT e.em_no) as count 
                FROM email e
                LEFT JOIN users u ON e.user_no = u.user_no
                WHERE u.pro_no = %s OR e.applicant_no IN (
                    SELECT applicant_no FROM applicant_status ast 
                    JOIN scholarships s ON ast.scholarship_no = s.req_no 
                    WHERE s.pro_no = %s
                )
                GROUP BY CASE WHEN e.user_no IS NOT NULL THEN 'admin' ELSE 'scholar' END
            ''', (pro_no, pro_no))
            by_role = cursor.fetchall()
            
            # Get total applications for this provider
            cursor.execute('''
                SELECT COUNT(DISTINCT ast.applicant_no) as total 
                FROM applicant_status ast 
                JOIN scholarships s ON ast.scholarship_no = s.req_no 
                WHERE s.pro_no = %s
            ''', (pro_no,))
            total_applicants = cursor.fetchone()['total']
        else:
            # Superadmin gets everything
            cursor.execute('SELECT COUNT(*) as total FROM email')
            total_users = cursor.fetchone()['total']
            
            cursor.execute('''
                SELECT CASE WHEN user_no IS NOT NULL THEN 'admin' ELSE 'scholar' END as role, 
                       COUNT(*) as count 
                FROM email GROUP BY CASE WHEN user_no IS NOT NULL THEN 'admin' ELSE 'scholar' END
            ''')
            by_role = cursor.fetchall()
            
            cursor.execute('SELECT COUNT(*) as total FROM applicants')
            total_applicants = cursor.fetchone()['total']
        
        cursor.close()
        conn.close()
        
        return jsonify({
            'success': True,
            'statistics': {
                'totalUsers': total_users,
                'usersByRole': by_role,
                'totalApplicants': total_applicants
            }
        }), 200
    
    except Exception as e:
        return jsonify({'message': f'Error: {str(e)}'}), 500

@api_bp.route('/logs', methods=['GET'])
@token_required
def get_activity_logs(current_user_id, pro_no, role):
    """Get admin audit activity logs from the dedicated audit table."""
    try:
        filters = request.args
        conn = get_db()
        cursor = conn.cursor()

        ensure_admin_activity_log_table(cursor)

        query = '''
            SELECT
                logs.log_id AS id,
                COALESCE(u.user_name, actor_provider.provider_name, 'Unknown User') AS user,
                logs.action AS activity,
                logs.status,
                COALESCE(event_provider.provider_name, 'All') AS scholarship,
                occurred_at,
                actor_email.email_address AS actor_email
            FROM admin_activity_logs AS logs
            LEFT JOIN users u ON logs.actor_user_no = u.user_no
            LEFT JOIN scholarship_providers AS actor_provider ON u.pro_no = actor_provider.pro_no
            LEFT JOIN LATERAL (
                SELECT email_address
                FROM email
                WHERE user_no = logs.actor_user_no
                ORDER BY em_no ASC
                LIMIT 1
            ) AS actor_email ON TRUE
            LEFT JOIN scholarship_providers AS event_provider ON logs.provider_no = event_provider.pro_no
            WHERE 1=1
        '''
        params = []

        if role != 'Admin':
            query += ' AND logs.provider_no = %s'
            params.append(pro_no)

        if filters.get('program') and filters.get('program') != 'All':
            query += " AND COALESCE(event_provider.provider_name, 'All') = %s"
            params.append(filters.get('program'))

        if filters.get('action') and filters.get('action') != 'All':
            query += ' AND logs.action ILIKE %s'
            params.append(f"%{filters.get('action')}%")

        search = (filters.get('search') or '').strip()
        if search:
            search_term = f"%{search}%"
            query += '''
                AND (
                    COALESCE(u.user_name, actor_provider.provider_name, 'Unknown User') ILIKE %s
                    OR COALESCE(actor_email.email_address, '') ILIKE %s
                    OR logs.action ILIKE %s
                    OR COALESCE(logs.target_label, '') ILIKE %s
                    OR COALESCE(event_provider.provider_name, 'All') ILIKE %s
                )
            '''
            params.extend([search_term, search_term, search_term, search_term, search_term])

        query += ' ORDER BY logs.occurred_at DESC, logs.log_id DESC LIMIT 250'
        cursor.execute(query, params)
        rows = cursor.fetchall()

        filtered_logs = [
            {
                'id': f"audit-{row['id']}",
                'user': row['user'],
                'activity': row['activity'],
                'status': (row['status'] or 'success').lower(),
                'scholarship': row['scholarship'],
                'date': row['occurred_at'].strftime('%Y-%m-%d %H:%M') if row['occurred_at'] else None,
            }
            for row in rows
        ]

        cursor.close()
        conn.close()

        return jsonify({'success': True, 'logs': filtered_logs}), 200

    except Exception as e:
        return jsonify({'message': f'Error: {str(e)}'}), 500

@api_bp.route('/scholarships/<program>', methods=['GET'])
@token_required
def get_scholarship_by_program(current_user_id, pro_no, role, program):
    """Get scholarship data for a program (provider) - returns metadata and base64-encoded images"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        resolved_provider_no, _ = resolve_provider_context(cursor, current_user_id, role, pro_no)
        is_super_admin = (role or '').strip().lower() == 'admin'

        cursor.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'scholarships'
              AND column_name IN ('desc', 'date_created', 'semester', 'year', 'is_removed')
            """
        )
        scholarship_columns = {
            row['column_name'] if isinstance(row, dict) else row[0]
            for row in cursor.fetchall()
        }

        description_expr = 's."desc"' if 'desc' in scholarship_columns else 'NULL'
        date_created_expr = 's.date_created' if 'date_created' in scholarship_columns else 'NULL'
        semester_expr = 's.semester' if 'semester' in scholarship_columns else 'NULL'
        year_expr = 's.year' if 'year' in scholarship_columns else 'NULL'

        where_clauses = []
        if 'is_removed' in scholarship_columns:
            where_clauses.append('COALESCE(s.is_removed, FALSE) = FALSE')
        
        query = '''
            SELECT s.req_no as id, s.req_no as "reqNo", s.scholarship_name as "scholarshipName", 
                   s.gpa as "minGpa", s.location, s.parent_finance as "parentFinance",
                   s.slots, s.deadline, s.pro_no as "proNo", p.provider_name as "providerName",
                                         {description_expr} as description, {date_created_expr} as "dateCreated",
                                         {semester_expr} as semester, {year_expr} as year,
                                         COUNT(ast.applicant_no) FILTER (WHERE ast.is_accepted IS TRUE) as "acceptedCount",
                                         COUNT(ast.applicant_no) FILTER (WHERE ast.is_accepted IS NULL) as "pendingCount",
                                         COUNT(ast.applicant_no) FILTER (WHERE ast.is_accepted IS FALSE) as "declinedCount"
            FROM scholarships s
            LEFT JOIN scholarship_providers p ON s.pro_no = p.pro_no
                        LEFT JOIN applicant_status ast ON ast.scholarship_no = s.req_no
        '''.format(
            description_expr=description_expr,
            date_created_expr=date_created_expr,
            semester_expr=semester_expr,
            year_expr=year_expr,
        )
        params = []

        if where_clauses:
            query += ' WHERE ' + ' AND '.join(where_clauses)
        
        # Isolation: If not superadmin, only show scholarships for this provider
        if not is_super_admin:
            if resolved_provider_no is None:
                cursor.close()
                conn.close()
                return jsonify({'message': 'User not associated with a scholarship provider'}), 403
            query += (' AND ' if where_clauses else ' WHERE ') + 's.pro_no = %s'
            params.append(resolved_provider_no)
        elif program.lower() != 'all':
            query += (' AND ' if where_clauses else ' WHERE ') + 'p.provider_name ILIKE %s'
            params.append(f"%{program}%")
            
        group_by_columns = [
            's.req_no',
            's.scholarship_name',
            's.gpa',
            's.location',
            's.parent_finance',
            's.slots',
            's.deadline',
            's.pro_no',
            'p.provider_name',
        ]
        if 'desc' in scholarship_columns:
            group_by_columns.append('s."desc"')
        if 'date_created' in scholarship_columns:
            group_by_columns.append('s.date_created')
        if 'semester' in scholarship_columns:
            group_by_columns.append('s.semester')
        if 'year' in scholarship_columns:
            group_by_columns.append('s.year')

        query += '\n            GROUP BY ' + ', '.join(group_by_columns) + '\n            ORDER BY s.req_no DESC\n        '
        
        cursor.execute(query, params)
        rows = cursor.fetchall()
        cursor.close()
        conn.close()
        
        if not rows:
            return jsonify({'success': True, 'scholarships': []}), 200

        result = []
        for row in rows:
            scholarship = dict(row)
            slots = scholarship.get('slots')
            accepted_count = int(scholarship.get('acceptedCount') or 0)
            pending_count = int(scholarship.get('pendingCount') or 0)
            declined_count = int(scholarship.get('declinedCount') or 0)

            scholarship['acceptedCount'] = accepted_count
            scholarship['pendingCount'] = pending_count
            scholarship['declinedCount'] = declined_count
            scholarship['totalApplicants'] = accepted_count + pending_count + declined_count

            if slots is None:
                scholarship['availableSlots'] = None
                scholarship['isFull'] = False
            else:
                scholarship['availableSlots'] = max(int(slots) - accepted_count, 0)
                scholarship['isFull'] = accepted_count >= int(slots)

            result.append(scholarship)

        return jsonify({'success': True, 'scholarships': result}), 200
    
    except Exception as e:
        print(f"[SCHOLARSHIP API] Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'message': f'Error: {str(e)}'}), 500


@api_bp.route('/applicants/<program>', methods=['GET'])
@token_required
def get_applicants(current_user_id, pro_no, role, program):
    """Get applicants for a program"""
    try:
        print(f"[APPLICANTS API] Loading applicants for program='{program}', role='{role}', pro_no='{pro_no}'", flush=True)
        filters = request.args
        conn = get_db()
        cursor = conn.cursor()
        
        query = '''
            SELECT a.applicant_no as id, a.first_name as "firstName", a.last_name as "lastName", 
                   a.middle_name as "middleName",
                   a.mother_fname as "motherFirstName", a.mother_lname as "motherLastName",
                   a.father_fname as "fatherFirstName", a.father_lname as "fatherLastName",
                   a.first_name as name, a.overall_gpa as grade,
                   a.financial_income_of_parents as income, CONCAT_WS(', ', NULLIF(a.street_brgy, ''), NULLIF(a.town_city_municipality, ''), NULLIF(a.province, ''), NULLIF(a.zip_code, '')) as location,
                   a.maiden_name as "maidenName",
                   a.street_brgy as "streetBrgy",
                   a.town_city_municipality as municipality,
                   a.province,
                   a.zip_code as "zipCode",
                   a.birthdate as dob,
                   a.birth_place as "pob",
                   a.sex,
                   a.course,
                   a.school,
                   a.school_id_no as "schoolId",
                   a.school_sector as "schoolSector",
                   a.mobile_no as "mobileNumber",
                   a.year_lvl as year,
                   a.mother_occupation as "motherOccupation",
                   a.father_occupation as "fatherOccupation",
                   a.sibling_no as "siblingNo",
                   CASE WHEN a.mother_status = true THEN 'Living' ELSE 'Deceased' END as "motherStatus",
                   CASE WHEN a.father_status = true THEN 'Living' ELSE 'Deceased' END as "fatherStatus",
                   a.mother_phone_no as "motherPhone",
                   a.father_phone_no as "fatherPhone",
                   CONCAT_WS(', ', NULLIF(a.street_brgy, ''), NULLIF(a.town_city_municipality, ''), NULLIF(a.province, ''), NULLIF(a.zip_code, '')) as "schoolAddress",
                   s.is_accepted, s.scholarship_no as "scholarshipNo", p.provider_name as program,
                   e.email_address as email,
                   CASE 
                       WHEN s.is_accepted = True THEN 'Accepted'
                       WHEN s.is_accepted = False THEN 'Declined'
                       ELSE 'Pending'
                   END as status,
                   esc.scholarship_name as "scholarshipName",
                   COALESCE(s.status_updated, CURRENT_DATE) as "createdAt",
                    COALESCE(s.status_updated, CURRENT_DATE) as "dateApplied",
                    (a.indigency_doc IS NOT NULL) as "has_indigency_doc",
                    (a.enrollment_certificate_doc IS NOT NULL) as "has_enrollment_certificate_doc",
                    (a.grades_doc IS NOT NULL) as "has_grades_doc",
                    (a."schoolID_photo" IS NOT NULL) as "has_schoolID_photo",
                    (a.id_img_front IS NOT NULL) as "has_id_img_front",
                    (a.id_img_back IS NOT NULL) as "has_id_img_back",
                    (a.id_pic IS NOT NULL) as "has_id_pic",
                    (a.profile_picture IS NOT NULL) as "has_profile_picture",
                    (a.signature_image_data IS NOT NULL) as "has_signature",
                    a.indigency_vid_url,
                    a.enrollment_certificate_vid_url,
                    a.grades_vid_url
            FROM applicants a
            INNER JOIN applicant_status s ON a.applicant_no = s.applicant_no
            INNER JOIN scholarships esc ON s.scholarship_no = esc.req_no
            INNER JOIN scholarship_providers p ON esc.pro_no = p.pro_no
            LEFT JOIN email e ON a.applicant_no = e.applicant_no
            WHERE 1=1
        '''
        params = []
        
        # Isolation: If not superadmin, only show applicants for this provider
        if role != 'Admin':
            query += ' AND esc.pro_no = %s'
            params.append(pro_no)
        elif program.lower() != 'all':
            query += ' AND p.provider_name ILIKE %s'
            params.append(f"%{program}%")
        else:
            # For 'all' view, typically admin only wants accepted scholars as per request
            # But the endpoint is shared, so let's default to accepted if 'all' is requested for now
            query += ' AND s.is_accepted = True'
        
        if filters.get('search'):
            query += ' AND (a.first_name ILIKE %s OR a.last_name ILIKE %s OR e.email_address ILIKE %s)'
            search_term = f"%{filters['search']}%"
            params.extend([search_term, search_term, search_term])
        
        # Note: filters.get('status') ignored because table schema does not properly match it yet
        
        cursor.execute(query, params)
        applicants = cursor.fetchall()
        cursor.close()
        conn.close()
        print(f"[APPLICANTS API] Query returned {len(applicants)} rows for program='{program}'", flush=True)
        
        # Convert rows to plain dicts and provide URLs for binary data
        result = []
        for row in applicants:
            try:
                a = normalize_json_object(dict(row))
                app_no = a['id'] # 'id' is aliased from 'applicant_no'

                # Manage signature as a lazy-loaded URL too
                if a.get('has_signature'):
                    a['signature'] = url_for('admin_api.get_applicant_image', applicant_no=app_no, column_name='signature_image_data', _external=True)
                else:
                    a['signature'] = None
                
                # Ensure income is float (might be Decimal from DB)
                if a.get('income') is not None:
                    try:
                        a['income'] = float(a['income'])
                    except (ValueError, TypeError):
                        pass
                
                # Convert document blobs to media arrays (Optimized: use URLs)
                # Include both image files and video files for each document type
                a['indigencyFiles'] = get_applicant_media_metadata(app_no, 'indigency_doc', a.get('has_indigency_doc'), None, "Indigency Proof")
                if a.get('indigency_vid_url'):
                    a['indigencyFiles'].extend(get_applicant_media_metadata(app_no, 'indigency_vid_url', True, a.get('indigency_vid_url'), "Indigency Video"))
                
                a['certificateFiles'] = get_applicant_media_metadata(app_no, 'enrollment_certificate_doc', a.get('has_enrollment_certificate_doc'), None, "Enrollment Certificate")
                if a.get('enrollment_certificate_vid_url'):
                    a['certificateFiles'].extend(get_applicant_media_metadata(app_no, 'enrollment_certificate_vid_url', True, a.get('enrollment_certificate_vid_url'), "Enrollment Certificate Video"))
                
                a['gradesFiles'] = get_applicant_media_metadata(app_no, 'grades_doc', a.get('has_grades_doc'), None, "Grades / Transcript")
                if a.get('grades_vid_url'):
                    a['gradesFiles'].extend(get_applicant_media_metadata(app_no, 'grades_vid_url', True, a.get('grades_vid_url'), "Grades Video"))
                
                # Combine all ID images into idFiles (Optimized: use URLs)
                id_files = []
                if a.get('has_schoolID_photo'):
                    id_files.extend(get_applicant_media_metadata(app_no, 'schoolID_photo', True, None, "School ID"))
                if a.get('has_id_img_front'):
                    id_files.extend(get_applicant_media_metadata(app_no, 'id_img_front', True, None, "ID Front"))
                if a.get('has_id_img_back'):
                    id_files.extend(get_applicant_media_metadata(app_no, 'id_img_back', True, None, "ID Back"))
                if a.get('has_id_pic'):
                    id_files.extend(get_applicant_media_metadata(app_no, 'id_pic', True, None, "ID Photo"))
                if a.get('has_profile_picture'):
                    id_files.extend(get_applicant_media_metadata(app_no, 'profile_picture', True, None, "Profile Picture"))
                
                a['idFiles'] = id_files
                result.append(a)
            except Exception as row_error:
                app_identifier = None
                try:
                    app_identifier = dict(row).get('id')
                except Exception:
                    pass
                print(f"[APPLICANTS API] Skipping malformed applicant row {app_identifier or 'unknown'} for program='{program}': {row_error}", flush=True)
                traceback.print_exc()
        
        print(f"[APPLICANTS API] Returning {len(result)} normalized applicant rows for program='{program}'", flush=True)
        return jsonify({'success': True, 'applicants': result}), 200
    
    except Exception as e:
        print(f"[APPLICANTS API] Error while loading applicants for program='{program}': {e}", flush=True)
        traceback.print_exc()
        return jsonify({'message': f'Error: {str(e)}'}), 500

@api_bp.route('/applicants/<int:applicant_no>/accept', methods=['POST'])
@token_required
def accept_applicant(current_user_id, pro_no, role, applicant_no):
    """Accept an applicant (move from pending to accepted)"""
    try:
        data = request.get_json(silent=True) or {}
        scholarship_no = data.get('scholarshipNo')
        if scholarship_no is None:
            return jsonify({'success': False, 'message': 'scholarshipNo is required'}), 400

        conn = get_db()
        cursor = conn.cursor()

        cursor.execute(
            '''SELECT ast.is_accepted, s.slots, s.pro_no
               FROM applicant_status ast
               INNER JOIN scholarships s ON ast.scholarship_no = s.req_no
               WHERE ast.applicant_no = %s AND ast.scholarship_no = %s''',
            (applicant_no, scholarship_no)
        )
        status_row = cursor.fetchone()
        if not status_row:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'message': 'Application not found'}), 404

        if role != 'Admin' and status_row['pro_no'] != pro_no:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'message': 'Unauthorized'}), 403

        if status_row['slots'] is not None and status_row['is_accepted'] is not True:
            cursor.execute(
                '''SELECT COUNT(*) AS accepted_count
                   FROM applicant_status
                   WHERE scholarship_no = %s AND is_accepted = TRUE''',
                (scholarship_no,)
            )
            accepted_count = cursor.fetchone()['accepted_count']
            if accepted_count >= status_row['slots']:
                cursor.close()
                conn.close()
                return jsonify({'success': False, 'message': 'Scholarship slots are already full'}), 409
        
        # Update applicant status
        cursor.execute(
            '''UPDATE applicant_status 
               SET is_accepted = True, status_updated = CURRENT_DATE
               WHERE applicant_no = %s AND scholarship_no = %s''',
            (applicant_no, scholarship_no)
        )

        # Auto-decline other applications for the same applicant
        cursor.execute(
            "SELECT s.scholarship_name, s.req_no FROM applicant_status ast JOIN scholarships s ON ast.scholarship_no = s.req_no WHERE ast.applicant_no = %s AND ast.scholarship_no != %s AND (ast.is_accepted IS NULL OR ast.is_accepted = TRUE)",
            (applicant_no, scholarship_no)
        )
        declined_scholarships = cursor.fetchall()
        
        cursor.execute(
            """
            UPDATE applicant_status
            SET is_accepted = FALSE
            WHERE applicant_no = %s AND scholarship_no != %s
            """,
            (applicant_no, scholarship_no),
        )
        
        for ds in declined_scholarships:
            try:
                create_notification(
                    user_no=applicant_no,
                    title="Application Closed",
                    message=f"Your application for {ds['scholarship_name']} has been closed because you were accepted into another scholarship. Students may only hold one active scholarship.",
                    notif_type='result'
                )
            except: pass

        conn.commit()
        cursor.close()
        conn.close()
        
        return jsonify({'success': True, 'message': 'Applicant accepted and other applications declined'}), 200
    
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500

@api_bp.route('/applicants/<int:applicant_no>/decline', methods=['POST'])
@token_required
def decline_applicant(current_user_id, pro_no, role, applicant_no):
    """Decline an applicant (move from pending to declined)"""
    try:
        data = request.get_json(silent=True) or {}
        scholarship_no = data.get('scholarshipNo')
        if scholarship_no is None:
            return jsonify({'success': False, 'message': 'scholarshipNo is required'}), 400

        conn = get_db()
        cursor = conn.cursor()

        cursor.execute(
            '''SELECT s.pro_no
               FROM applicant_status ast
               INNER JOIN scholarships s ON ast.scholarship_no = s.req_no
               WHERE ast.applicant_no = %s AND ast.scholarship_no = %s''',
            (applicant_no, scholarship_no)
        )
        status_row = cursor.fetchone()
        if not status_row:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'message': 'Application not found'}), 404

        if role != 'Admin' and status_row['pro_no'] != pro_no:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'message': 'Unauthorized'}), 403
        
        # Update applicant status
        cursor.execute(
            '''UPDATE applicant_status 
               SET is_accepted = False, status_updated = CURRENT_DATE
               WHERE applicant_no = %s AND scholarship_no = %s''',
            (applicant_no, scholarship_no)
        )
        conn.commit()
        cursor.close()
        conn.close()
        
        return jsonify({'success': True, 'message': 'Applicant declined'}), 200
    
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500

@api_bp.route('/applicants/<int:applicant_no>/cancel', methods=['POST'])
@token_required
def cancel_applicant(current_user_id, pro_no, role, applicant_no):
    """Cancel applicant status (revert to pending/NULL)"""
    try:
        data = request.get_json(silent=True) or {}
        scholarship_no = data.get('scholarshipNo')
        if scholarship_no is None:
            return jsonify({'success': False, 'message': 'scholarshipNo is required'}), 400

        conn = get_db()
        cursor = conn.cursor()

        cursor.execute(
            '''SELECT s.pro_no
               FROM applicant_status ast
               INNER JOIN scholarships s ON ast.scholarship_no = s.req_no
               WHERE ast.applicant_no = %s AND ast.scholarship_no = %s''',
            (applicant_no, scholarship_no)
        )
        status_row = cursor.fetchone()
        if not status_row:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'message': 'Application not found'}), 404

        if role != 'Admin' and status_row['pro_no'] != pro_no:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'message': 'Unauthorized'}), 403
        
        # Update applicant status back to NULL (pending review)
        cursor.execute(
            '''UPDATE applicant_status 
               SET is_accepted = NULL, status_updated = CURRENT_DATE
               WHERE applicant_no = %s AND scholarship_no = %s''',
            (applicant_no, scholarship_no)
        )
        conn.commit()
        cursor.close()
        conn.close()
        
        return jsonify({'success': True, 'message': 'Applicant status cancelled'}), 200
    
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500

@api_bp.route('/applicants/<program>', methods=['POST'])
@token_required
def create_applicant(current_user_id, pro_no, role, program):
    """Create new applicant"""
    data = request.get_json()
    
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute(
            '''INSERT INTO applicants (program, first_name, last_name, email, phone, status, created_at)
               VALUES (%s, %s, %s, %s, %s, 'Pending', NOW())
               RETURNING *''',
            (program.lower(), data['firstName'], data['lastName'], data['email'], data.get('phone', ''))
        )
        applicant = cursor.fetchone()
        conn.commit()
        cursor.close()
        conn.close()
        
        return jsonify({'success': True, 'applicant': applicant}), 201
    
    except Exception as e:
        return jsonify({'message': f'Error: {str(e)}'}), 500

@api_bp.route('/rankings/<program>', methods=['GET'])
@token_required
def get_rankings(current_user_id, pro_no, role, program):
    """Get rankings for a program"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Isolation: If not superadmin, only show rankings for this provider
        if role != 'Admin':
            cursor.execute(
                'SELECT r.* FROM rankings r JOIN scholarships s ON r.scholarship_no = s.req_no WHERE s.pro_no = %s ORDER BY r.rank ASC',
                (pro_no,)
            )
        else:
            cursor.execute(
                'SELECT * FROM rankings WHERE program ILIKE %s ORDER BY rank ASC',
                (f"%{program}%",)
            )
        rankings = cursor.fetchall()
        cursor.close()
        conn.close()
        
        return jsonify({'success': True, 'rankings': rankings}), 200
    
    except Exception as e:
        return jsonify({'message': f'Error: {str(e)}'}), 500

@api_bp.route('/rankings/<program>/rank', methods=['POST'])
@token_required
def submit_ranking(current_user_id, pro_no, role, program):
    """Submit ranking/scoring for applicants"""
    # TODO: Implement ranking logic using existing scoring functions
    return jsonify({'success': True, 'message': 'Rankings submitted'}), 200

@api_bp.route('/scholarships', methods=['POST'])
@token_required
def create_scholarship(current_user_id, pro_no, role):
    """Create new scholarship post"""
    data = request.get_json()
    
    required_fields = ['scholarshipName', 'minGpa', 'slots', 'deadline', 'parentFinance', 'location']
    if not all(key in data for key in required_fields):
        return jsonify({'message': 'Missing required fields'}), 400
    
    try:
        conn = get_db()
        cursor = conn.cursor()
        target_pro_no, provider_name = resolve_provider_context(cursor, current_user_id, role, pro_no)
        provider_label = provider_name if str(provider_name or '').strip().lower() != 'all' else 'ISKOMATS'
        
        # Isolation: Use pro_no from token if not superadmin
        if role != 'Admin' and target_pro_no is None:
             return jsonify({'message': 'User not associated with a scholarship provider'}), 403
        
        # 2. Insert into scholarships table (without images)
        cursor.execute('''
            INSERT INTO scholarships (scholarship_name, gpa, parent_finance, location, pro_no, slots, deadline, "desc", semester, year)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING req_no
        ''', (
            data['scholarshipName'],
            data['minGpa'],
            data['parentFinance'],
            data['location'],
            target_pro_no,
            data['slots'],
            data['deadline'],
            data.get('description', ''),
            data.get('semester', ''),
            data.get('year', '')
        ))
        
        new_scholarship = cursor.fetchone()
        req_no = new_scholarship['req_no']

        conn.commit()
        cursor.close()
        conn.close()

        run_background_task(
            notify_all_applicants,
            title=f"New Scholarship Posted: {data['scholarshipName']}",
            message=f"{provider_label} posted a new scholarship opportunity. Deadline: {data['deadline']}.",
            notif_type='scholarship',
        )

        run_background_task(
            send_announcement_emails,
            title=f"New Scholarship: {data['scholarshipName']}",
            message=f"{provider_label} has posted a new scholarship opportunity with a deadline on {data['deadline']}.",
            provider_no=target_pro_no,
            provider_name=provider_label,
            send_to_all=True,
            subject_prefix='New Scholarship opportunity from',
            intro_prefix='A new scholarship opportunity has been posted by',
        )
        
        return jsonify({
            'success': True, 
            'message': 'Scholarship created successfully',
            'id': req_no
        }), 201
        
    except Exception as e:
        print(f"[SCHOLARSHIP CREATE] Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'message': f'Error: {str(e)}'}), 500

@api_bp.route('/scholarships/<int:req_no>', methods=['PUT'])
@token_required
def update_scholarship(current_user_id, pro_no, role, req_no):
    """Update scholarship post"""
    data = request.get_json()
    
    try:
        conn = get_db()
        cursor = conn.cursor()
        resolved_provider_no, resolved_provider_name = resolve_provider_context(cursor, current_user_id, role, pro_no)
        
        is_admin = (role == 'Admin')
        
        # 2. Check scholarship ownership
        cursor.execute(
            """
            SELECT s.pro_no, s.scholarship_name, p.provider_name
            FROM scholarships s
            LEFT JOIN scholarship_providers p ON s.pro_no = p.pro_no
            WHERE s.req_no = %s
            """,
            (req_no,)
        )
        sch_row = cursor.fetchone()
        if not sch_row:
            return jsonify({'message': 'Scholarship not found'}), 404
        display_provider_name = sch_row['provider_name'] or (resolved_provider_name if str(resolved_provider_name or '').strip().lower() != 'all' else None) or 'ISKOMATS'
            
        # Allow update if user is Admin OR pro_no matches OR if existing scholarship has NO pro_no
        if not is_admin and sch_row['pro_no'] is not None and resolved_provider_no is not None and sch_row['pro_no'] != resolved_provider_no:
            return jsonify({'message': 'Unauthorized'}), 401

        # 3. Handle orphaned scholarships
        if not is_admin and sch_row['pro_no'] is None and resolved_provider_no is not None:
            cursor.execute("UPDATE scholarships SET pro_no = %s WHERE req_no = %s", (resolved_provider_no, req_no))
             
        # 4. Process field updates (excluding images)
        update_fields = []
        params = []
        
        field_map = {
            'scholarshipName': 'scholarship_name',
            'minGpa': 'gpa',
            'parentFinance': 'parent_finance',
            'location': 'location',
            'slots': 'slots',
            'deadline': 'deadline',
            'description': '"desc"',
            'year': 'year',
            'semester': 'semester'
        }
        
        for json_key, db_col in field_map.items():
            if json_key in data:
                update_fields.append(f"{db_col} = %s")
                params.append(data[json_key])

        if update_fields:
            params.append(req_no)
            query = f"UPDATE scholarships SET {', '.join(update_fields)} WHERE req_no = %s"
            cursor.execute(query, params)
        
        conn.commit()
        cursor.close()
        conn.close()

        run_background_task(
            notify_all_applicants,
            title=f"Scholarship Updated: {data.get('scholarshipName', sch_row['scholarship_name'])}",
            message=f"{display_provider_name} updated scholarship details. Check the latest post for changes.",
            notif_type='scholarship',
        )

        run_background_task(
            send_announcement_emails,
            title=f"Updated Scholarship: {data.get('scholarshipName', sch_row['scholarship_name'])}",
            message=f"{display_provider_name} has updated the details for a scholarship. Please check the portal for latest requirements and deadlines.",
            provider_no=resolved_provider_no,
            provider_name=display_provider_name,
            send_to_all=True,
            subject_prefix='Updated Scholarship from',
            intro_prefix='A scholarship has been updated by',
        )
        
        return jsonify({'success': True, 'message': 'Scholarship updated'}), 200
    
    except Exception as e:
        print(f"[SCHOLARSHIP UPDATE] Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'message': f'Error: {str(e)}'}), 500

@api_bp.route('/scholarships/<int:req_no>', methods=['DELETE'])
@token_required
def delete_scholarship(current_user_id, pro_no, role, req_no):
    """Soft-delete scholarship post."""
    conn = None
    cursor = None
    try:
        conn = get_db()
        cursor = conn.cursor()
        ensure_schema_integrity(cursor)
        
        is_superadmin = ((role or '').strip().lower() == 'admin')
        resolved_provider_no, _ = resolve_provider_context(cursor, current_user_id, role, pro_no)
        
        # 2. Check scholarship ownership
        cursor.execute("SELECT pro_no, scholarship_name FROM scholarships WHERE req_no = %s", (req_no,))
        sch_row = cursor.fetchone()
        if not sch_row:
            return jsonify({'message': 'Scholarship not found'}), 404
            
        # Allow delete if user is Admin OR pro_no matches OR if existing scholarship has NO pro_no
        scholarship_provider_no = get_row_value(sch_row, 'pro_no')
        scholarship_name = get_row_value(sch_row, 'scholarship_name')

        if not is_superadmin and scholarship_provider_no is not None and resolved_provider_no is not None and scholarship_provider_no != resolved_provider_no:
            return jsonify({'message': 'Unauthorized'}), 401
            
        cursor.execute("UPDATE scholarships SET is_removed = TRUE WHERE req_no = %s", (req_no,))
        
        conn.commit()
        record_admin_activity(
            actor_user_no=current_user_id,
            action='delete_scholarship',
            target_type='scholarship',
            target_id=req_no,
            target_label=scholarship_name,
            provider_no=resolved_provider_no,
        )
        
        return jsonify({'success': True, 'message': 'Scholarship removed'}), 200
        
    except Exception as e:
        print(f"[SCHOLARSHIP DELETE] Error deleting scholarship {req_no}: {e}", flush=True)
        traceback.print_exc()
        return jsonify({'message': f'Error: {str(e)}'}), 500
    finally:
        if cursor:
            try:
                cursor.close()
            except Exception:
                pass
        if conn:
            try:
                conn.close()
            except Exception:
                pass


@api_bp.route('/announcement-image/<int:image_id>', methods=['GET'])
def get_announcement_image(image_id):
    """Get announcement image as binary file."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        primary_key_column, _ = get_announcement_image_columns(cursor)
        
        # Get image from database
        cursor.execute(f"SELECT img FROM announcement_images WHERE {primary_key_column} = %s", (image_id,))
        row = cursor.fetchone()
        cursor.close()
        conn.close()
        
        if not row or not row['img']:
            return jsonify({'message': 'Image not found'}), 404
        
        encrypted_img = row['img']
        
        # Convert memoryview to bytes if needed
        if hasattr(encrypted_img, 'tobytes'):
            encrypted_img = encrypted_img.tobytes()
        elif not isinstance(encrypted_img, bytes):
            encrypted_img = bytes(encrypted_img)
        
        # Decrypt with Fernet
        if not _fernet:
            return jsonify({'message': 'Encryption not configured'}), 500
        
        try:
            decrypted_img = _fernet.decrypt(encrypted_img)
        except Exception as decrypt_error:
            print(f"[IMAGE ENDPOINT] Failed to decrypt image {image_id}: {decrypt_error}")
            return jsonify({'message': 'Failed to decrypt image'}), 500
        
        # Detect image type from magic bytes
        mime_type = get_mime_type(decrypted_img)
        
        # Return as binary file
        return send_file(
            BytesIO(decrypted_img),
            mimetype=mime_type,
            as_attachment=False,
            download_name=f'announcement_image_{image_id}.png'
        )
        
    except Exception as e:
        print(f"[IMAGE ENDPOINT] Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'message': f'Error: {str(e)}'}), 500


@api_bp.route('/announcement-image/<int:ann_no>/<int:idx>', methods=['GET'])
def get_announcement_image_by_index(ann_no, idx):
    """Get announcement image by announcement id and index."""
    entity = request.args.get('entity', 'announcement')
    try:
        conn = get_db()
        cursor = conn.cursor()
        primary_key_column, foreign_key_column = get_entity_image_columns(cursor, entity)
        
        cursor.execute(
            f"""
            SELECT {primary_key_column}, img
            FROM announcement_images
            WHERE {foreign_key_column} = %s
            ORDER BY {primary_key_column}
            OFFSET %s LIMIT 1
            """,
            (ann_no, idx),
        )
        row = cursor.fetchone()
        cursor.close()
        conn.close()
        
        if not row or not row['img']:
            return jsonify({'message': f'Image not found for announcement {ann_no} at index {idx}'}), 404
        
        encrypted_img = row['img']
        
        # Convert memoryview to bytes if needed
        if hasattr(encrypted_img, 'tobytes'):
            encrypted_img = encrypted_img.tobytes()
        elif not isinstance(encrypted_img, bytes):
            encrypted_img = bytes(encrypted_img)
        
        # Decrypt with Fernet
        if not _fernet:
            return jsonify({'message': 'Encryption not configured'}), 500
        
        try:
            decrypted_img = _fernet.decrypt(encrypted_img)
        except Exception as decrypt_error:
            print(f"[IMAGE ENDPOINT] Failed to decrypt image for announcement {ann_no} at index {idx}: {decrypt_error}")
            return jsonify({'message': 'Failed to decrypt image'}), 500
        
        # Detect image type from magic bytes
        mime_type = get_mime_type(decrypted_img)
        
        # Return as binary file
        return send_file(
            BytesIO(decrypted_img),
            mimetype=mime_type,
            as_attachment=False,
            download_name=f'announcement_{ann_no}_image_{idx}.png'
        )
        
    except Exception as e:
        print(f"[IMAGE ENDPOINT] Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'message': f'Error: {str(e)}'}), 500

@api_bp.route('/applicant-image/<int:applicant_no>/<column_name>', methods=['GET'])
def get_applicant_image(applicant_no, column_name):
    """Get applicant image or document as binary file on demand (Lazy Loading)"""
    allowed_columns = [
        'indigency_doc', 'enrollment_certificate_doc', 'grades_doc', 
        'schoolID_photo', 'id_img_front', 'id_img_back', 'id_pic', 'profile_picture',
        'signature_image_data'
    ]
    if column_name not in allowed_columns:
        return jsonify({'message': 'Invalid column name'}), 400
        
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Use quoted identifier for potential mixed case columns like schoolID_photo
        query = f'SELECT "{column_name}" FROM applicants WHERE applicant_no = %s'
        cursor.execute(query, (applicant_no,))
        row = cursor.fetchone()
        cursor.close()
        conn.close()
        
        if not row or not row[column_name]:
            return jsonify({'message': 'Image not found'}), 404
        
        data = row[column_name]
        
        # Convert memoryview to bytes if needed
        if hasattr(data, 'tobytes'):
            data = data.tobytes()
        elif not isinstance(data, bytes):
            data = bytes(data)
            
        # Handle encryption for signature
        if column_name == 'signature_image_data':
            if not _fernet:
                return jsonify({'message': 'Encryption not configured'}), 500
            try:
                data = _fernet.decrypt(data)
            except Exception as e:
                print(f"[APPLICANT IMAGE] Failed to decrypt signature: {e}")
                return jsonify({'message': 'Failed to decrypt signature'}), 500
        
        # Detect image type from magic bytes
        mime_type = get_mime_type(data)
        
        return send_file(
            BytesIO(data),
            mimetype=mime_type,
            as_attachment=False,
            download_name=f'applicant_{applicant_no}_{column_name}.png'
        )
        
    except Exception as e:
        print(f"[APPLICANT IMAGE] Error: {str(e)}")
        return jsonify({'message': f'Error: {str(e)}'}), 500

# ===== UTILITY ENDPOINTS =====

@api_bp.route('/auth/me', methods=['GET'])
@token_required_lightweight
def get_current_user_info(current_user_id, pro_no, role):
    """Utility to verify token payload"""
    return jsonify({
        'user_id': current_user_id,
        'pro_no': pro_no,
        'role': role
    }), 200

# ===== ANNOUNCEMENT ENDPOINTS =====

@api_bp.route('/announcements', methods=['GET'])
@token_required
def get_admin_announcements(current_user_id, pro_no, role):
    try:
        conn = get_db()
        cur = conn.cursor()
        resolved_provider_no, _ = resolve_provider_context(cur, current_user_id, role, pro_no)
        is_super_admin = (role or '').strip().lower() == 'admin'
        try:
            primary_key_column, foreign_key_column = get_entity_image_columns(cur, 'announcement')
        except Exception:
            primary_key_column, foreign_key_column = None, None

        cur.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'announcements'
              AND column_name IN ('time_added', 'status_updated', 'ann_date', 'is_removed')
            """
        )
        announcement_columns = {
            row['column_name'] if isinstance(row, dict) else row[0]
            for row in cur.fetchall()
        }

        if 'time_added' in announcement_columns:
            date_col = 'a.time_added'
            order_col = 'a.time_added DESC'
        elif 'status_updated' in announcement_columns:
            date_col = 'a.status_updated'
            order_col = 'a.status_updated DESC'
        elif 'ann_date' in announcement_columns:
            date_col = 'a.ann_date'
            order_col = 'a.ann_date DESC'
        else:
            date_col = 'NULL'
            order_col = 'a.ann_no DESC'

        where_clauses = []
        if 'is_removed' in announcement_columns:
            where_clauses.append('COALESCE(a.is_removed, FALSE) = FALSE')

        query = """
            SELECT
                a.ann_no,
                a.ann_title,
                a.ann_message,
                {date_col} AS ann_date,
                {date_col} AS time_added,
                COALESCE(sp.provider_name, 'Unknown Provider') AS provider_name,
                {image_select}
            FROM announcements a
            LEFT JOIN scholarship_providers sp ON a.pro_no = sp.pro_no
            {image_join}
        """.format(
            date_col=date_col,
            image_select=f"ai.{primary_key_column} AS image_id" if primary_key_column and foreign_key_column else "NULL AS image_id",
            image_join=f"LEFT JOIN announcement_images ai ON a.ann_no = ai.{foreign_key_column}" if primary_key_column and foreign_key_column else "",
        )
        params = []

        if where_clauses:
            query += ' WHERE ' + ' AND '.join(where_clauses)

        if not is_super_admin:
            if resolved_provider_no is None:
                cur.close()
                conn.close()
                return jsonify({'message': 'User not associated with a scholarship provider'}), 403
            query += (' AND ' if where_clauses else ' WHERE ') + 'a.pro_no = %s'
            params.append(resolved_provider_no)

        if primary_key_column and foreign_key_column:
            query += f' ORDER BY {order_col}, ai.{primary_key_column}'
        else:
            query += f' ORDER BY {order_col}, a.ann_no DESC'
        cur.execute(query, params)
        rows = cur.fetchall()

        announcements = {}
        for row in rows:
            row_dict = dict(row)
            ann_no = row_dict['ann_no']
            image_id = row_dict.pop('image_id', None)
            ann_date = row_dict.get('ann_date')

            if ann_date and hasattr(ann_date, 'isoformat'):
                row_dict['created_at'] = ann_date.isoformat()
            elif ann_date:
                row_dict['created_at'] = str(ann_date)
            else:
                row_dict['created_at'] = None

            if ann_no not in announcements:
                announcements[ann_no] = {
                    **row_dict,
                    'announcementImages': [],
                }

            if image_id is not None:
                image_url = url_for(
                    'admin_api.get_announcement_image_by_index',
                    ann_no=ann_no,
                    idx=len(announcements[ann_no]['announcementImages']),
                    entity='announcement',
                    _external=True,
                )
                announcements[ann_no]['announcementImages'].append(image_url)

        cur.close()
        conn.close()
        return jsonify(list(announcements.values())), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500

@api_bp.route('/announcements', methods=['POST'])
@token_required
def create_announcement(current_user_id, pro_no, role):
    # Support both JSON and multipart/form-data
    if request.is_json:
        data = request.json
    else:
        # For multipart/form-data, we need to extract from request.form
        data = request.form.to_dict()
        # Parse boolean/integer fields from strings
        if 'send_to_all_applicants' in data:
            data['send_to_all_applicants'] = data['send_to_all_applicants'].lower() == 'true'
        # Check for JSON strings in form fields (like announcementImages)
        if 'announcementImages' in data and isinstance(data['announcementImages'], str):
            try:
                data['announcementImages'] = json.loads(data['announcementImages'])
            except:
                data['announcementImages'] = []

    title = data.get('title')
    message = data.get('content')
    time_added = data.get('time_added', datetime.now().isoformat())
    send_to_all_applicants = data.get('send_to_all_applicants', True)
    
    if not title or not message:
        return jsonify({'message': 'Title and content are required'}), 400
        
    try:
        conn = get_db()
        cur = conn.cursor()
        target_pro_no, provider_name = resolve_provider_context(cur, current_user_id, role, pro_no)

        if role != 'Admin' and target_pro_no is None:
            return jsonify({'message': 'User not associated with a scholarship provider'}), 403
        
        cur.execute("""
            INSERT INTO announcements (ann_title, ann_message, pro_no, time_added)
            VALUES (%s, %s, %s, %s)
            RETURNING ann_no
        """, (title, message, target_pro_no, time_added))
        ann_no = cur.fetchone()['ann_no']

        # Handle images (support both JSON base64 and Multipart files)
        image_attachments = []
        
        # 1. New Multipart File Uploads
        if request.files:
            # Sort keys to maintain order if needed
            for file_key in sorted(request.files.keys()):
                if file_key.startswith('image_'):
                    file = request.files[file_key]
                    if file:
                        image_attachments.append(file.read())
        
        # 2. Base64 images from JSON
        if 'announcementImages' in data and isinstance(data['announcementImages'], list):
            for image_data in data['announcementImages']:
                url = image_data.get('url') if isinstance(image_data, dict) else image_data
                if url and isinstance(url, str) and url.startswith('data:'):
                    img_bytes = base64_to_bytes(url)
                    if img_bytes:
                        image_attachments.append(img_bytes)

        if image_attachments:
            _, foreign_key_column = get_entity_image_columns(cur, 'announcement')
            for img_bytes in image_attachments:
                encrypted = _fernet.encrypt(img_bytes) if _fernet else img_bytes
                cur.execute(
                    f"INSERT INTO announcement_images ({foreign_key_column}, img) VALUES (%s, %s)",
                    (ann_no, encrypted)
                )

        conn.commit()
        
        record_admin_activity(
            actor_user_no=current_user_id,
            action='create_announcement',
            target_type='announcement',
            target_id=ann_no,
            target_label=title,
            provider_no=target_pro_no
        )
        
        # Notify students based on send_to_all_applicants flag
        run_background_task(
            notify_announcement_applicants,
            title,
            message,
            target_pro_no,
            provider_name,
            send_to_all_applicants,
            True,
        )
        print(f"[ANNOUNCEMENT] Notification + email delivery started in background for announcement {ann_no}")

        return jsonify({'message': 'Announcement created', 'ann_no': ann_no}), 201
    except Exception as e:
        return jsonify({'message': str(e)}), 500
    finally:
        if 'conn' in locals() and conn:
            conn.close()

@api_bp.route('/announcements/<int:ann_no>', methods=['PUT'])
@token_required
def update_announcement(current_user_id, pro_no, role, ann_no):
    # Support both JSON and multipart/form-data
    if request.is_json:
        data = request.json
    else:
        data = request.form.to_dict()
        if 'send_to_all_applicants' in data:
            data['send_to_all_applicants'] = data['send_to_all_applicants'].lower() == 'true'
        if 'announcementImages' in data and isinstance(data['announcementImages'], str):
            try:
                data['announcementImages'] = json.loads(data['announcementImages'])
            except:
                data['announcementImages'] = []

    title = data.get('title')
    message = data.get('content')
    send_to_all_applicants = data.get('send_to_all_applicants', True)
    
    if not title or not message:
        return jsonify({'message': 'Title and content are required'}), 400
        
    try:
        conn = get_db()
        cur = conn.cursor()
        resolved_provider_no, resolved_provider_name = resolve_provider_context(cur, current_user_id, role, pro_no)
        primary_key_column, foreign_key_column = get_entity_image_columns(cur, 'announcement')
        cur.execute("SELECT pro_no FROM announcements WHERE ann_no = %s", (ann_no,))
        announcement_row = cur.fetchone()
        if not announcement_row:
            return jsonify({'message': 'Announcement not found'}), 404
        target_provider_no = resolved_provider_no if resolved_provider_no is not None else announcement_row['pro_no']
        target_provider_name = resolved_provider_name
        if (not target_provider_name or str(target_provider_name).strip().lower() == 'all') and target_provider_no is not None:
            cur.execute("SELECT provider_name FROM scholarship_providers WHERE pro_no = %s", (target_provider_no,))
            provider_row = cur.fetchone()
            if provider_row and provider_row.get('provider_name'):
                target_provider_name = provider_row['provider_name']
        
        # Check ownership unless super admin
        if role.lower() != 'admin':
            if announcement_row['pro_no'] != resolved_provider_no:
                return jsonify({'message': 'Unauthorized to update this announcement'}), 403
        
        cur.execute("""
            UPDATE announcements 
            SET ann_title = %s, ann_message = %s
            WHERE ann_no = %s
        """, (title, message, ann_no))

        # Handle images (support both JSON base64 and Multipart files)
        image_attachments = []
        
        # 1. Retain existing images that weren't deleted
        if 'announcementImages' in data and isinstance(data['announcementImages'], list):
            cur.execute(
                f"SELECT {primary_key_column}, img FROM announcement_images WHERE {foreign_key_column} = %s ORDER BY {primary_key_column}",
                (ann_no,)
            )
            existing_rows = cur.fetchall()
            
            for image_val in data['announcementImages']:
                url = image_val.get('url') if isinstance(image_val, dict) else image_val
                
                if not isinstance(url, str):
                    continue
                
                if url.startswith('data:'):
                    # New base64 image
                    img_bytes = base64_to_bytes(url)
                    if img_bytes:
                        image_attachments.append(img_bytes)
                elif '/announcement-image/' in url:
                    # Existing image URL - we keep it
                    try:
                        # Extract the image identifier if needed, or just find it in existing rows
                        # For simplicity, we assume if it's an existing URL, we don't want to change that specific row
                        # but the current logic REPLACES all images. So we must re-collect the bytes.
                        idx_str = url.split('/')[-1]
                        idx = int(idx_str)
                        if 0 <= idx < len(existing_rows):
                            image_attachments.append(existing_rows[idx]['img'])
                    except:
                        pass
        
        # 2. New Multipart File Uploads
        if request.files:
            for file_key in sorted(request.files.keys()):
                if file_key.startswith('image_'):
                    file = request.files[file_key]
                    if file:
                        image_attachments.append(file.read())

        # Sync image table
        cur.execute(f"DELETE FROM announcement_images WHERE {foreign_key_column} = %s", (ann_no,))
        for img_data in image_attachments:
            # Check if already encrypted (from DB) or new (raw bytes)
            # This is a bit tricky, but Fernet usually has a specific header
            # For simplicity, we assume if it's from the DB it's already bytes/encrypted
            # and if it's new (raw bytes), we encrypt it.
            # But let's just always re-encrypt raw bytes and keep DB data as is.
            is_encrypted = False
            if isinstance(img_data, bytes) and len(img_data) > 30 and img_data.startswith(b'gAAAA'):
                is_encrypted = True
            
            final_data = img_data
            if not is_encrypted and _fernet:
                final_data = _fernet.encrypt(img_data)
                
            cur.execute(
                f"INSERT INTO announcement_images ({foreign_key_column}, img) VALUES (%s, %s)",
                (ann_no, final_data)
            )

        conn.commit()
        
        record_admin_activity(
            actor_user_no=current_user_id,
            action='update_announcement',
            target_type='announcement',
            target_id=ann_no,
            target_label=title,
            provider_no=resolved_provider_no
        )

        run_background_task(
            notify_announcement_applicants,
            title,
            message,
            target_provider_no,
            target_provider_name,
            send_to_all_applicants,
            True,
            notification_title_prefix='Announcement Updated',
        )
        
        return jsonify({'message': 'Announcement updated', 'ann_no': ann_no}), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500
    finally:
        if 'conn' in locals() and conn:
            conn.close()

@api_bp.route('/announcements/<int:ann_no>', methods=['DELETE'])
@token_required
def delete_announcement(current_user_id, pro_no, role, ann_no):
    conn = None
    cur = None
    try:
        conn = get_db()
        cur = conn.cursor()
        ensure_schema_integrity(cur)
        resolved_provider_no, _ = resolve_provider_context(cur, current_user_id, role, pro_no)
        
        # Check ownership unless super admin
        if role.lower() != 'admin':
            cur.execute("SELECT pro_no, ann_title FROM announcements WHERE ann_no = %s", (ann_no,))
            row = cur.fetchone()
            if not row:
                return jsonify({'message': 'Announcement not found'}), 404
            if get_row_value(row, 'pro_no') != resolved_provider_no:
                return jsonify({'message': 'Unauthorized to delete this announcement'}), 403
            title = get_row_value(row, 'ann_title', 'Unknown')
        else:
            cur.execute("SELECT ann_title FROM announcements WHERE ann_no = %s", (ann_no,))
            row = cur.fetchone()
            title = get_row_value(row, 'ann_title', 'Unknown')

        try:
            _, foreign_key_column = get_entity_image_columns(cur, 'announcement')
        except Exception:
            foreign_key_column = None

        if foreign_key_column:
            # We don't delete images for soft-deleted announcements to retain history
            pass
                
        # Soft-delete the announcement
        cur.execute("UPDATE announcements SET is_removed = TRUE WHERE ann_no = %s", (ann_no,))
        conn.commit()
        
        record_admin_activity(
            actor_user_no=current_user_id,
            action='delete_announcement',
            target_type='announcement',
            target_id=ann_no,
            target_label=title,
            provider_no=resolved_provider_no
        )
        
        return jsonify({'message': 'Announcement deleted'}), 200
    except Exception as e:
        print(f"[ANNOUNCEMENT DELETE] Error deleting announcement {ann_no}: {e}", flush=True)
        traceback.print_exc()
        return jsonify({'message': str(e)}), 500
    finally:
        if conn:
            conn.close()

# ===== ERROR HANDLERS =====

@api_bp.errorhandler(404)
def not_found(error):
    return jsonify({'message': 'Endpoint not found'}), 404

@api_bp.errorhandler(500)
def server_error(error):
    return jsonify({'message': 'Internal server error'}), 500

# To use this in your main Flask app:
# from api_routes import api_bp
# app.register_blueprint(api_bp)
# from flask_cors import CORS
# CORS(app)  # Enable CORS for all routes
