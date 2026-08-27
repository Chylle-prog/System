import sys
import os
import re
import json
from decimal import Decimal
from flask import Blueprint, request, jsonify, send_file, url_for, session, current_app, Response, redirect, make_response
from flask_bcrypt import Bcrypt
from werkzeug.security import check_password_hash as werkzeug_check_password_hash
from functools import wraps
from flask_socketio import emit, join_room
import jwt
from datetime import date, datetime, timedelta
import psycopg2
import base64
from urllib import parse, request as urllib_request, error as urllib_error
from email import encoders
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from cryptography.fernet import Fernet
from io import BytesIO
import time
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

from flask import Blueprint, request, jsonify, send_file, url_for, session, current_app
api_bp = Blueprint('admin_api', __name__, url_prefix='/api/admin')

@api_bp.record_once
def on_blueprint_init(state):
    """Run migrations once when the app starts up."""
    with state.app.app_context():
        try:
            from project_config import get_db
            conn = get_db()
            cur = conn.cursor()
            ensure_schema_integrity(cur)
            ensure_admin_activity_log_table(cur)
            conn.commit()
            cur.close()
            conn.close()
            print("[BACKEND] Admin schema initialization complete.")
        except Exception as e:
            print(f"[BACKEND] Admin schema migration skipped or failed: {e}")

from project_config import get_db, get_db_startup, use_storage, upload_to_supabase
from services.notification_service import create_notification, init_socketio as init_notification_socketio, fetch_google_access_token, send_verification_email, send_email_message

# ─── SCHEMA & AUDIT CACHE ───
_SCHEMA_INITIALIZED = False
_COLUMN_CACHE = {} # { table_name: set(column_names) }
from services.email_table_service import (
    get_applicant_email_table,
    get_user_email_table,
    make_account_identifier,
    parse_account_identifier,
)
from services.applicant_document_service import (
    applicant_has_column,
    applicant_document_expr,
    applicant_document_join_sql,
    fetch_applicant_document_values,
    normalize_supabase_url,
)

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
    
    if data_value and isinstance(data_value, str) and data_value.startswith('http'):
        # If we have a direct URL (from Supabase storage), use it directly for best performance
        return [{
            'src': data_value,
            'type': media_type,
            'name': f"{name}"
        }]
    elif not is_video:
        # For legacy binary data OR if we need a consistent interface, use lazy-loading endpoint
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

bcrypt = Bcrypt()

def safe_check_password_hash(stored_hash, candidate_password):
    """
    Safely check candidate_password against stored_hash using bcrypt or werkzeug fallback.
    Prevents crashing with 500 (ValueError: Invalid salt) when stored_hash is non-bcrypt (e.g., pbkdf2/scrypt/legacy/corrupted).
    Returns tuple: (is_valid: bool, needs_rehash: bool).
    """
    if not stored_hash or not candidate_password:
        return False, False

    # 1. Try bcrypt verification
    try:
        if bcrypt.check_password_hash(stored_hash, candidate_password):
            return True, False
    except Exception:
        pass

    # 2. Try Werkzeug security fallback (for legacy/seeded accounts using pbkdf2/scrypt)
    try:
        if werkzeug_check_password_hash(stored_hash, candidate_password):
            return True, True
    except Exception:
        pass

    return False, False

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
SCHOOL_VERIFICATION_EMAILS = {
    'dlsl': 'dlsl.edu.ph@gmail.com',
    'de la salle lipa': 'dlsl.edu.ph@gmail.com',
}
INDIGENCY_VERIFICATION_EMAIL = 'lipacityhall.gov.ph@gmail.com'

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
    """Ensure all required columns exist (runs once per service lifetime)."""
    global _SCHEMA_INITIALIZED
    if _SCHEMA_INITIALIZED:
        return
    
    def read_count(row):
        if isinstance(row, dict):
            return next(iter(row.values()), 0)
        if isinstance(row, (list, tuple)):
            return row[0] if row else 0
        return 0

    # 1. Ensure announcement_images table exists
    cursor.execute(
        """
        SELECT COUNT(*)
        FROM information_schema.tables
        WHERE table_name = 'announcement_images'
        """
    )
    if read_count(cursor.fetchone()) == 0:
        print("[MIGRATION] Creating announcement_images table")
        cursor.execute(
            """
            CREATE TABLE announcement_images (
                ann_img_no SERIAL PRIMARY KEY,
                ann_no INTEGER REFERENCES announcements(ann_no) ON DELETE CASCADE,
                img TEXT
            )
            """
        )

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

    # 2. Convert announcement_images.img to TEXT if it's still BYTEA
    cursor.execute(
        """
        SELECT data_type 
        FROM information_schema.columns 
        WHERE table_name = 'announcement_images' AND column_name = 'img'
        """
    )
    res = cursor.fetchone()
    if res:
        col_type = res['data_type'] if isinstance(res, dict) else res[0]
        if col_type.lower() == 'bytea':
            print("[MIGRATION] Converting announcement_images.img from BYTEA to TEXT (preserving data via Base64 encode)")
            # Try to preserve data by converting binary to its Base64 string representation
            try:
                cursor.execute("ALTER TABLE announcement_images ALTER COLUMN img TYPE TEXT USING encode(img, 'base64')")
            except Exception as e:
                print(f"[MIGRATION WARNING] Binary conversion failed, forcing NULL: {e}")
                cursor.execute("ALTER TABLE announcement_images ALTER COLUMN img TYPE TEXT USING NULL")

    # 3. Scholarship specific fields
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
    
    # 3. Add jwt_token and verification_timestamp columns to applicants table if missing
    applicant_extra_cols = {
        'jwt_token': 'TEXT',
        'verification_timestamp': 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP'
    }
    for col, col_type in applicant_extra_cols.items():
        cursor.execute(
            """
            SELECT COUNT(*)
            FROM information_schema.columns
            WHERE table_name = 'applicants' AND column_name = %s
            """,
            (col,)
        )
        if read_count(cursor.fetchone()) == 0:
            print(f"[MIGRATION] Adding {col} column to applicants table")
            cursor.execute(f"ALTER TABLE applicants ADD COLUMN {col} {col_type}")

    _SCHEMA_INITIALIZED = True


def get_table_columns(cursor, table_name):
    """Retrieve and cache column list for dynamic queries."""
    if table_name in _COLUMN_CACHE:
        return _COLUMN_CACHE[table_name]
    
    cursor.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_name = %s",
        (table_name,)
    )
    cols = {row['column_name'] if isinstance(row, dict) else row[0] for row in cursor.fetchall()}
    _COLUMN_CACHE[table_name] = cols
    return cols


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
        user_email_table = get_user_email_table(cur)
        
        # Check if verification columns exist
        cur.execute("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = %s AND column_name IN ('is_verified', 'verification_code')
        """, (user_email_table,))
        existing = [row['column_name'] for row in cur.fetchall()]
        
        if 'is_verified' not in existing:
            print(f"[MIGRATION] Adding is_verified to {user_email_table}")
            cur.execute(f"ALTER TABLE {user_email_table} ADD COLUMN is_verified BOOLEAN DEFAULT FALSE")
            cur.execute(f"UPDATE {user_email_table} SET is_verified = TRUE")
        
        if 'verification_code' not in existing:
            print(f"[MIGRATION] Adding verification_code to {user_email_table}")
            cur.execute(f"ALTER TABLE {user_email_table} ADD COLUMN verification_code VARCHAR(10)")
        
        conn.commit()
        cur.close()
        conn.close()
        print("[MIGRATION] Email table verification columns ensured")
    finally:
        if 'cur' in locals() and cur:
            try: cur.close()
            except: pass
        if 'conn' in locals() and conn:
            try: conn.close()
            except: pass

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
            user_email_table = get_user_email_table(cursor)
            applicant_email_table = get_applicant_email_table(cursor)
            
            # Check either user_no (for admins) or applicant_no (for scholars)
            if role and (role.lower() == 'scholar' or role.lower() == 'user'):
                cursor.execute(f"SELECT is_locked FROM {applicant_email_table} WHERE applicant_no = %s", (current_user_id,))
            else:
                cursor.execute(f"SELECT is_locked FROM {user_email_table} WHERE user_no = %s", (current_user_id,))
            
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


# fetch_google_access_token removed in favor of services.notification_service version


def generate_verification_code():
    """Generate a random 6-digit verification code."""
    import random
    return str(random.randint(100000, 999999))


def resolve_school_verification_email(school_name):
    # Always send to DLSL regardless of school
    return 'dlsl.edu.ph@gmail.com'


def build_applicant_full_name(applicant_row):
    return ' '.join(
        part for part in [
            applicant_row.get('first_name'),
            applicant_row.get('middle_name'),
            applicant_row.get('last_name'),
        ]
        if str(part or '').strip()
    ).strip()


def coerce_binary_bytes(value):
    if value is None:
        return None
    if hasattr(value, 'tobytes'):
        return value.tobytes()
    if isinstance(value, bytearray):
        return bytes(value)
    if isinstance(value, bytes):
        return value
    if isinstance(value, str):
        # Handle Base64 URL data
        if value.startswith('data:'):
            try:
                comma_idx = value.find(',')
                if comma_idx != -1:
                    return base64.b64decode(value[comma_idx+1:])
            except Exception:
                pass
        
        # Handle HTTP URLs (Download)
        if value.startswith('http'):
            try:
                # Use a timeout to prevent hanging the background thread indefinitely
                with urllib_request.urlopen(value, timeout=15) as response:
                    return response.read()
            except Exception as download_error:
                print(f"[DOWNLOAD ERROR] Failed to fetch document from {value}: {download_error}", flush=True)
                # Fallback to returning the URL bytes if download fails
        
        # Fallback to UTF-8 encoding if it's just a string (not a URL)
        return value.encode('utf-8', errors='replace')
    return bytes(value)


def guess_extension_for_mime(mime_type):
    extension_map = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/avif': 'avif',
        'image/heic': 'heic',
        'image/heif': 'heif',
        'image/svg+xml': 'svg',
        'application/pdf': 'pdf',
    }
    return extension_map.get(mime_type, 'bin')


def create_email_attachment(filename, content_bytes, mime_type):
    safe_bytes = coerce_binary_bytes(content_bytes)
    if not safe_bytes:
        return None

    if '/' in mime_type:
        main_type, sub_type = mime_type.split('/', 1)
    else:
        main_type, sub_type = 'application', 'octet-stream'

    attachment = MIMEBase(main_type, sub_type)
    attachment.set_payload(safe_bytes)
    encoders.encode_base64(attachment)
    attachment.add_header('Content-Disposition', 'attachment', filename=filename)
    return attachment


def is_test_or_dummy_email(email):
    """Detects dummy, placeholder, or seeded test email addresses to prevent sending and avoid mailer-daemon bouncebacks."""
    if not email or not isinstance(email, str):
        return True
    email_clean = email.strip().lower()
    
    test_patterns = [
        r'^dlsl\.applicant\d*@',       # dlsl.applicant1@gmail.com, dlsl.applicant16@gmail.com, etc.
        r'^applicant\d*@',            # applicant1@gmail.com, applicant2@gmail.com
        r'^test_?applicant\d*@',      # test_applicant1@gmail.com
        r'@example\.com$',            # @example.com
        r'@test\.com$',               # @test.com
        r'@sample\.com$',             # @sample.com
        r'@invalid$',                 # @invalid
        r'@localhost$',               # @localhost
        r'^dummy',                    # dummy*@...
        r'^fake',                     # fake*@...
        r'^mock',                     # mock*@...
    ]
    for pattern in test_patterns:
        if re.search(pattern, email_clean):
            return True
    return False


def send_gmail_message(receiver_email, subject, body, attachments=None):
    if not GMAIL_SENDER_EMAIL:
        raise RuntimeError('Gmail sender email is not configured.')

    if is_test_or_dummy_email(receiver_email):
        print(f"[EMAIL SKIP] Suppressed email to test/dummy address '{receiver_email}' to prevent bounce emails.", flush=True)
        return {'status': 'skipped', 'recipient': receiver_email, 'reason': 'test_address_suppressed'}

    message = MIMEMultipart()
    message['Subject'] = subject
    message['From'] = GMAIL_SENDER_EMAIL
    message['To'] = receiver_email
    message.attach(MIMEText(body))

    for attachment in attachments or []:
        if attachment is not None:
            message.attach(attachment)

    access_token = fetch_google_access_token()
    raw_bytes = message.as_bytes()
    raw_bytes = raw_bytes.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
    encoded_message = base64.urlsafe_b64encode(raw_bytes).decode('utf-8')
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


def send_gmail_message_async(receiver_email, subject, body, attachments=None):
    """Send a Gmail message in a background thread to prevent blocking the HTTP response."""
    def _worker():
        try:
            print(f"[BG_EMAIL] Starting background send to {receiver_email}...", flush=True)
            send_gmail_message(receiver_email, subject, body, attachments)
            print(f"[BG_EMAIL] Success: Message sent to {receiver_email}", flush=True)
        except Exception as e:
            print(f"[BG_EMAIL ERROR] Failed to send email to {receiver_email}: {e}", flush=True)
            traceback.print_exc()

    thread = threading.Thread(target=_worker)
    thread.daemon = True
    thread.start()
    return thread


def load_applicant_verification_context(cursor, applicant_no, scholarship_no):
    cursor.execute(
        '''
        SELECT a.applicant_no,
               a.first_name,
               a.middle_name,
               a.last_name,
               a.school,
               a.school_id_no,
               esc.req_no AS scholarship_no,
               esc.scholarship_name,
               esc.pro_no,
               p.provider_name
        FROM applicants a
        INNER JOIN applicant_status ast ON a.applicant_no = ast.applicant_no
        INNER JOIN scholarships esc ON ast.scholarship_no = esc.req_no
        INNER JOIN scholarship_providers p ON esc.pro_no = p.pro_no
        WHERE a.applicant_no = %s AND ast.scholarship_no = %s
        LIMIT 1
        ''',
        (applicant_no, scholarship_no),
    )
    return cursor.fetchone()


# send_verification_email removed in favor of services.notification_service version


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
    
    raw_bytes = msg.as_bytes()
    raw_bytes = raw_bytes.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
    encoded_message = base64.urlsafe_b64encode(raw_bytes).decode('utf-8')
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


@api_bp.route('/applicants/<int:applicant_no>/school-verification', methods=['POST'])
@token_required
def send_school_verification_dispatch(current_user_id, pro_no, role, applicant_no):
    """Email school verification documents to the configured school contact in the background."""
    try:
        data = request.get_json(silent=True) or {}
        scholarship_no = data.get('scholarshipNo')
        if scholarship_no is None:
            return jsonify({'success': False, 'message': 'scholarshipNo is required'}), 400

        conn = get_db()
        cursor = conn.cursor()
        applicant_row = load_applicant_verification_context(cursor, applicant_no, scholarship_no)

        if not applicant_row:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'message': 'Applicant record not found for this scholarship'}), 404

        if role != 'Admin' and applicant_row['pro_no'] != pro_no:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'message': 'Unauthorized'}), 403

        school_email = resolve_school_verification_email(applicant_row.get('school'))
        if not school_email:
            cursor.close()
            conn.close()
            return jsonify({
                'success': False,
                'message': f"No verification email is configured yet for {applicant_row.get('school') or 'this school'}. Currently only DLSL is supported.",
            }), 400

        applicant_name = build_applicant_full_name(applicant_row) or f"Applicant #{applicant_no}"
        
        # Clean up initial connection
        cursor.close()
        conn.close()

        def _background_dispatch():
            bg_conn = None
            bg_cursor = None
            try:
                bg_conn = get_db()
                bg_cursor = bg_conn.cursor()
                
                print(f"[BG_DISPATCH] Fetching documents for school verification: Applicant #{applicant_no}", flush=True)
                document_values = fetch_applicant_document_values(
                    bg_cursor,
                    applicant_no,
                    ['enrollment_certificate_doc', 'grades_doc', 'id_img_front', 'id_img_back', 'schoolID_photo']
                )

                front_id = document_values.get('id_img_front') or document_values.get('schoolID_photo')
                back_id = document_values.get('id_img_back')
                enrollment_doc = document_values.get('enrollment_certificate_doc')
                grades_doc = document_values.get('grades_doc')

                attachment_specs = [
                    ('enrollment_certificate', enrollment_doc),
                    ('grades_report', grades_doc),
                    ('school_id_front', front_id),
                    ('school_id_back', back_id),
                ]

                # Fetch and attach Merit Document(s) for the applicant
                merit_proofs = []
                try:
                    from services.merit_proof_service import fetch_merit_proofs_for_applicant
                    merit_proofs = fetch_merit_proofs_for_applicant(bg_cursor, applicant_no)
                except Exception as m_err:
                    print(f"[BG_DISPATCH] Error fetching merit proofs: {m_err}", flush=True)

                for idx, mp in enumerate(merit_proofs, 1):
                    m_doc = mp.get('merit_document')
                    if m_doc:
                        m_title = mp.get('merit_title') or f"document_{idx}"
                        clean_title = re.sub(r'[^a-zA-Z0-9_]', '_', m_title.strip().lower())
                        attachment_specs.append((f"merit_{idx}_{clean_title}", m_doc))
                
                attachments = []
                for label, raw_content in attachment_specs:
                    if not raw_content:
                        continue
                    content_bytes = coerce_binary_bytes(raw_content)
                    mime_type = get_mime_type(content_bytes)
                    extension = guess_extension_for_mime(mime_type)
                    attachments.append(
                        create_email_attachment(
                            f"{applicant_name.replace(' ', '_').lower()}_{label}.{extension}",
                            content_bytes,
                            mime_type,
                        )
                    )

                attached_doc_lines = [
                    "- Enrollment certificate",
                    "- Grades report",
                    "- School ID front",
                    "- School ID back"
                ]
                if merit_proofs:
                    for idx, mp in enumerate(merit_proofs, 1):
                        m_title = mp.get('merit_title') or f"Certificate #{idx}"
                        attached_doc_lines.append(f"- Merit Document #{idx} ({m_title})")
                
                attached_docs_str = "\n".join(attached_doc_lines)

                subject = f"School Verification Request - {applicant_name}"
                body = f"""Hello,

Please help verify the attached applicant records for {applicant_name}.

Scholarship: {applicant_row.get('scholarship_name') or 'N/A'}
Provider: {applicant_row.get('provider_name') or 'N/A'}
Applicant ID: {applicant_row.get('applicant_no')}
School: {applicant_row.get('school') or 'N/A'}
School ID Number: {applicant_row.get('school_id_no') or 'N/A'}

Attached documents:
{attached_docs_str}

Please review the documents and respond to this email with your verification findings.

Best regards,
ISKOMATS Admin
"""
                print(f"[BG_DISPATCH] Sending school verification email to {school_email}...", flush=True)
                send_gmail_message(school_email, subject, body, attachments=attachments)
                print(f"[BG_DISPATCH] Successfully sent school verification email for #{applicant_no}", flush=True)

            except Exception as bg_e:
                print(f"[BG_DISPATCH ERROR] Failed to dispatch school verification: {bg_e}", flush=True)
                traceback.print_exc()
            finally:
                if bg_cursor: bg_cursor.close()
                if bg_conn: bg_conn.close()

        # Start the background threat for data-heavy operations
        threading.Thread(target=_background_dispatch, daemon=True).start()

        return jsonify({
            'success': True, 
            'message': f'School verification dispatch for {applicant_name} has been started in the background. The email will be sent to {school_email} shortly.',
            'email': school_email
        }), 200

    except Exception as e:
        print(f"[SCHOOL VERIFICATION EMAIL] Error: {e}", flush=True)
        traceback.print_exc()
        return jsonify({'success': False, 'message': f'Failed to initiate school verification: {str(e)}'}), 500
    finally:
        if 'cursor' in locals() and cursor:
            cursor.close()
        if 'conn' in locals() and conn:
            conn.close()


@api_bp.route('/applicants/<int:applicant_no>/indigency-verification', methods=['POST'])
@token_required
def send_indigency_verification_dispatch(current_user_id, pro_no, role, applicant_no):
    """Email the applicant indigency image to the city hall verification inbox."""
    conn = None
    cursor = None
    try:
        data = request.get_json(silent=True) or {}
        scholarship_no = data.get('scholarshipNo')
        if scholarship_no is None:
            return jsonify({'success': False, 'message': 'scholarshipNo is required'}), 400

        conn = get_db()
        cursor = conn.cursor()
        applicant_row = load_applicant_verification_context(cursor, applicant_no, scholarship_no)

        if not applicant_row:
            return jsonify({'success': False, 'message': 'Applicant record not found for this scholarship'}), 404

        if role != 'Admin' and applicant_row['pro_no'] != pro_no:
            return jsonify({'success': False, 'message': 'Unauthorized'}), 403

        document_values = fetch_applicant_document_values(cursor, applicant_no, ['indigency_doc'])
        indigency_doc = document_values.get('indigency_doc')
        if not indigency_doc:
            return jsonify({'success': False, 'message': 'Missing required document: Indigency Proof'}), 400

        applicant_name = build_applicant_full_name(applicant_row) or f"Applicant #{applicant_no}"
        indigency_bytes = coerce_binary_bytes(indigency_doc)
        indigency_mime = get_mime_type(indigency_bytes)
        indigency_extension = guess_extension_for_mime(indigency_mime)
        attachments = [
            create_email_attachment(
                f"{applicant_name.replace(' ', '_').lower()}_indigency_proof.{indigency_extension}",
                indigency_bytes,
                indigency_mime,
            )
        ]

        subject = f"Indigency Verification Request - {applicant_name}"
        body = f"""Hello,

Please help verify the attached indigency document for {applicant_name}.

Scholarship: {applicant_row.get('scholarship_name') or 'N/A'}
Provider: {applicant_row.get('provider_name') or 'N/A'}
Applicant ID: {applicant_row.get('applicant_no')}
School: {applicant_row.get('school') or 'N/A'}

Attached document:
- Indigency proof image

Please review the attachment and respond to this email with your verification findings.

Best regards,
ISKOMATS Admin
"""

        if cursor:
            cursor.close()
            cursor = None
        if conn:
            conn.close()
            conn = None

        # Send email in background to return response instantly
        send_gmail_message_async(INDIGENCY_VERIFICATION_EMAIL, subject, body, attachments=attachments)
        
        return jsonify({
            'success': True,
            'message': f'Indigency verification dispatch initiated to {INDIGENCY_VERIFICATION_EMAIL}. The email is being sent in the background.',
            'email': INDIGENCY_VERIFICATION_EMAIL,
        }), 200
    except Exception as e:
        print(f"[INDIGENCY VERIFICATION EMAIL] Error: {e}", flush=True)
        traceback.print_exc()
        return jsonify({'success': False, 'message': f'Failed to send indigency verification email: {str(e)}'}), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
        


def send_announcement_emails(
    title,
    message,
    provider_no,
    provider_name=None,
    send_to_all=True,
    subject_prefix='New Announcement from',
    intro_prefix='You have received a new announcement from',
):
    """Send announcement emails to applicants (OAuth + SMTP fallback, parallel worker threads)."""
    sender_email = (
        os.environ.get('GMAIL_SENDER_EMAIL')
        or os.environ.get('SMTP_SENDER_EMAIL')
        or os.environ.get('SMTP_EMAIL')
        or (globals().get('GMAIL_SENDER_EMAIL'))
    )
    if not sender_email:
        print("[EMAIL ERROR] Sender email is not configured (GMAIL_SENDER_EMAIL / SMTP_SENDER_EMAIL missing)", flush=True)
        return False

    try:
        with get_db() as conn:
            cur = conn.cursor()
            applicant_email_table = get_applicant_email_table(cur)

            if send_to_all:
                cur.execute(f"""
                    SELECT DISTINCT e.applicant_no, a.first_name, a.last_name, e.email_address
                    FROM {applicant_email_table} e
                    LEFT JOIN applicants a ON e.applicant_no = a.applicant_no
                    WHERE e.is_verified = TRUE AND e.email_address IS NOT NULL
                """)
            else:
                cur.execute(f"""
                    SELECT DISTINCT a.applicant_no, a.first_name, a.last_name, COALESCE(e.email_address, a.email) AS email_address
                    FROM applicants a
                    INNER JOIN applicant_status ast ON a.applicant_no = ast.applicant_no
                    INNER JOIN scholarships s ON ast.scholarship_no = s.req_no
                    LEFT JOIN {applicant_email_table} e ON a.applicant_no = e.applicant_no
                    WHERE s.pro_no = %s AND COALESCE(e.email_address, a.email) IS NOT NULL
                """, (provider_no,))

            applicants = cur.fetchall()

        from services.notification_service import is_test_email
        valid_applicants = [a for a in applicants if a.get('email_address') and not is_test_email(a['email_address'])]

        if not valid_applicants:
            print(f"[EMAIL INFO] No valid real applicants found to send announcement (all {len(applicants)} suppressed/test), provider {provider_no}", flush=True)
            return True

        print(f"[EMAIL BACKGROUND] Starting parallel email batch for announcement - {len(valid_applicants)} real recipients (filtered {len(applicants) - len(valid_applicants)} mock/test addresses)", flush=True)

        provider_label = provider_name or 'ISKOMATS'

        def send_single_email(applicant):
            email_address = applicant['email_address']
            first_name = applicant['first_name'] or 'Applicant'
            if not email_address:
                return False
            if is_test_or_dummy_email(email_address):
                print(f"[EMAIL SKIP] Suppressed announcement to test recipient: {email_address}", flush=True)
                return True
            try:
                body = f"""Hello {first_name},

{intro_prefix} {provider_label}:

Title: {title}

Message:
{message}

Please log in to your ISKOMATS account for more details.

Best regards,
ISKOMATS Team
"""
                msg = MIMEText(body, 'plain', 'utf-8')
                msg['Subject'] = f'{subject_prefix} {provider_label}'
                msg['From'] = sender_email
                msg['To'] = email_address
                # Use send_email_message which tries OAuth first, then falls back to SMTP
                return send_email_message(msg)
            except Exception as e:
                print(f"[EMAIL ERROR] Failed to send to {email_address}: {e}", flush=True)
                return False

        from concurrent.futures import ThreadPoolExecutor
        success_count = 0
        fail_count = 0
        with ThreadPoolExecutor(max_workers=10) as executor:
            results = list(executor.map(send_single_email, applicants))
            success_count = sum(1 for r in results if r)
            fail_count = len(results) - success_count

        print(f"[EMAIL COMPLETE] Sent {success_count}/{len(applicants)} announcement emails (failed: {fail_count}) for provider {provider_no}", flush=True)
        return True

    except Exception as e:
        print(f"[EMAIL ERROR] Critical error in background email job: {str(e)}", flush=True)
        traceback.print_exc()
        return False


def notify_all_applicants(title, message, notif_type='scholarship'):
    """Send an in-app notification to all applicants using a single fast set-based SQL query."""
    try:
        with get_db() as conn:
            cur = conn.cursor()
            applicant_email_table = get_applicant_email_table(cur)
            cur.execute(
                f"""
                INSERT INTO notifications (user_no, title, message, type, expires_at, created_at)
                SELECT DISTINCT applicant_no, %s, %s, %s, NOW() + INTERVAL '10 days', NOW()
                FROM {applicant_email_table}
                WHERE is_verified = TRUE AND applicant_no IS NOT NULL
                """,
                (title, message, notif_type)
            )
            conn.commit()
            print(f"[NOTIF BATCH] Fast batch notification sent to all applicants (title='{title}')", flush=True)
            safe_emit('notification_update', {'type': notif_type, 'title': title}, broadcast=True)
            safe_emit('new_notification', {'title': title, 'message': message, 'type': notif_type}, broadcast=True)
    except Exception as exc:
        print(f"[NOTIF ERROR] Failed to batch notify applicants: {exc}", flush=True)


def run_background_task(target, *args, **kwargs):
    from flask import current_app
    app = current_app._get_current_object()
    
    def context_target(*a, **kw):
        with app.app_context():
            target(*a, **kw)
            
    worker = threading.Thread(target=context_target, args=args, kwargs=kwargs, daemon=True)
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
            applicant_email_table = get_applicant_email_table(cur)
            cur.execute(
                f"""
                SELECT DISTINCT e.applicant_no, a.first_name, a.last_name, e.email_address
                FROM {applicant_email_table} e
                LEFT JOIN applicants a ON e.applicant_no = a.applicant_no
                WHERE e.is_verified = TRUE AND e.email_address IS NOT NULL
                """
            )
        else:
            applicant_email_table = get_applicant_email_table(cur)
            cur.execute(
                f"""
                SELECT DISTINCT a.applicant_no, a.first_name, a.last_name, COALESCE(e.email_address, a.email) AS email_address
                FROM applicants a
                INNER JOIN applicant_status ast ON a.applicant_no = ast.applicant_no
                INNER JOIN scholarships s ON ast.scholarship_no = s.req_no
                LEFT JOIN {applicant_email_table} e ON a.applicant_no = e.applicant_no
                WHERE s.pro_no = %s AND COALESCE(e.email_address, a.email) IS NOT NULL
                """,
                (provider_no,),
            )

        recipients = cur.fetchall()
        
        # Prefetch Google access token for reuse
        google_access_token = None
        if send_email_alerts:
            try:
                google_access_token = fetch_google_access_token()
            except Exception as e:
                print(f"[ANNOUNCEMENT ERROR] Failed to fetch access token for batch: {e}")
                send_email_alerts = False

        provider_label = (provider_name or 'ISKOMATS').strip()
        notification_title = f"{notification_title_prefix}: {title}"
        notification_message = message[:100] + ('...' if len(message) > 100 else '')

        if provider_label and provider_label.lower() != 'iskomats':
            notification_message = f"{provider_label}: {notification_message}"

        email_success_count = 0
        email_failure_count = 0
        
        print(f"[ANNOUNCEMENT BG] Found {len(recipients)} recipients. Bulk inserting in-app notifications...")
        
        # 1. Fast bulk insert in-app notifications
        app_ids = [r['applicant_no'] for r in recipients if r and r.get('applicant_no')]
        if app_ids:
            try:
                with get_db() as bulk_conn:
                    bcur = bulk_conn.cursor()
                    from psycopg2.extras import execute_values
                    execute_values(
                        bcur,
                        """
                        INSERT INTO notifications (user_no, title, message, type, expires_at)
                        VALUES %s
                        """,
                        [(a_no, notification_title, notification_message, 'announcement') for a_no in app_ids],
                        template="(%s, %s, %s, %s, NOW() + INTERVAL '10 days')"
                    )
                    bulk_conn.commit()
                    safe_emit('notification_update', {'type': 'announcement', 'count': len(app_ids)}, broadcast=True)
                    safe_emit('new_notification', {'title': notification_title, 'message': notification_message, 'type': 'announcement'}, broadcast=True)
            except Exception as bulk_err:
                print(f"[ANNOUNCEMENT NOTIF BULK ERROR] {bulk_err}")

        # 2. High-speed Parallel Email Delivery (Real-time dispatch)
        if send_email_alerts:
            GMAIL_SENDER_EMAIL = (
                os.environ.get('GMAIL_SENDER_EMAIL')
                or os.environ.get('SMTP_SENDER_EMAIL')
                or os.environ.get('SMTP_USER')
                or os.environ.get('SMTP_EMAIL')
                or 'iskomats@gmail.com'
            )
            from services.notification_service import is_test_email, fetch_google_access_token, send_email_message
            seen_emails = set()
            valid_recipients = []
            for r in recipients:
                email = r.get('email_address') if hasattr(r, 'get') else (r['email_address'] if isinstance(r, dict) else None)
                if email and email.strip() and not is_test_email(email.strip()):
                    clean_email = email.strip().lower()
                    if clean_email not in seen_emails:
                        seen_emails.add(clean_email)
                        valid_recipients.append(r)

            # Pre-warm Google OAuth token in memory
            try:
                if os.environ.get('GOOGLE_REFRESH_TOKEN'):
                    fetch_google_access_token()
            except Exception:
                pass

            # Pre-check SMTP connectivity once with a fast timeout (2.5s)
            smtp_available = False
            raw_pass = (
                os.environ.get('GMAIL_APP_PASSWORD', '').strip() or
                os.environ.get('SMTP_PASSWORD', '').strip() or
                os.environ.get('SMTP_PASS', '').strip()
            )
            app_password = raw_pass.replace(' ', '') if raw_pass else ''
            smtp_user = os.environ.get('SMTP_USER', '').strip() or GMAIL_SENDER_EMAIL
            smtp_host = os.environ.get('SMTP_HOST', 'smtp.gmail.com').strip()
            smtp_port = int(os.environ.get('SMTP_PORT', '587'))

            if app_password and smtp_user:
                import smtplib
                try:
                    with smtplib.SMTP(smtp_host, smtp_port, timeout=3.0) as test_server:
                        test_server.starttls()
                        test_server.login(smtp_user, app_password)
                        smtp_available = True
                except Exception as test_err:
                    print(f"[ANNOUNCEMENT EMAIL] SMTP test failed ({test_err}). Fast-falling back to Gmail OAuth.", flush=True)
                    smtp_available = False

            def _send_single_announcement(recipient_row):
                email = recipient_row.get('email_address') if hasattr(recipient_row, 'get') else recipient_row['email_address']
                first_name = (recipient_row.get('first_name') if hasattr(recipient_row, 'get') else recipient_row['first_name']) or 'Applicant'
                if not email:
                    return False
                try:
                    email_body = f"""Hello {first_name},

A new announcement has been published by {provider_label}:

--------------------------------------------------
{title}
--------------------------------------------------

{message}

Please log in to your ISKOMATS account to view full announcement details and updates.

Best regards,
ISKOMATS Team
"""
                    msg = MIMEText(email_body, 'plain', 'utf-8')
                    msg['Subject'] = f"{notification_title_prefix} from {provider_label}: {title}"
                    msg['From'] = GMAIL_SENDER_EMAIL
                    msg['To'] = email

                    if smtp_available and app_password:
                        try:
                            import smtplib
                            with smtplib.SMTP(smtp_host, smtp_port, timeout=5.0) as s:
                                s.starttls()
                                s.login(smtp_user, app_password)
                                s.send_message(msg)
                            return True
                        except Exception:
                            pass

                    return send_email_message(msg)
                except Exception as row_err:
                    print(f"[ANNOUNCEMENT ERROR] Failed email for {email}: {row_err}", flush=True)
                    return False

            if valid_recipients:
                import concurrent.futures as _cf
                worker_count = min(20, max(1, len(valid_recipients)))
                with _cf.ThreadPoolExecutor(max_workers=worker_count) as pool:
                    results = list(pool.map(_send_single_announcement, valid_recipients))
                    email_success_count = sum(1 for r in results if r)
                    email_failure_count = len(valid_recipients) - email_success_count

        if send_email_alerts:
            print(
                f"[ANNOUNCEMENT EMAIL] Notification email dispatch finished for provider {provider_no}: "
                f"sent={email_success_count}, failed={email_failure_count}",
                flush=True,
            )
    except Exception as exc:
        print(f"[NOTIF ERROR] Failed to notify announcement recipients: {exc}", flush=True)
        import traceback
        traceback.print_exc()
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

    user_email_table = get_user_email_table(cursor)

    cursor.execute(
        f"""
        SELECT
            u.user_no,
            COALESCE(u.user_name, p.provider_name, 'Unknown User') AS actor_name,
            e.email_address AS actor_email,
            p.pro_no AS provider_no,
            COALESCE(p.provider_name, 'All') AS provider_name
        FROM users u
        LEFT JOIN scholarship_providers p ON u.pro_no = p.pro_no
        LEFT JOIN {user_email_table} e ON e.user_no = u.user_no
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


def resolve_account_email_record(cursor, account_id):
    """Resolve a synthetic account id to its underlying auth-table row."""
    requested_type, numeric_id = parse_account_identifier(account_id)
    user_email_table = get_user_email_table(cursor)
    applicant_email_table = get_applicant_email_table(cursor)

    def fetch_admin_record(email_id):
        cursor.execute(
            f"""
            SELECT
                'Admin' AS account_type,
                {email_id}::INTEGER AS lookup_id,
                ue.user_em_no AS email_id,
                ue.email_address AS email,
                ue.user_no,
                NULL::INTEGER AS applicant_no,
                COALESCE(u.user_name, p.provider_name, 'Unknown Account') AS name,
                p.pro_no AS provider_no,
                COALESCE(p.provider_name, 'All') AS provider_name,
                COALESCE(ue.is_locked, FALSE) AS locked
            FROM {user_email_table} ue
            LEFT JOIN users u ON ue.user_no = u.user_no
            LEFT JOIN scholarship_providers p ON u.pro_no = p.pro_no
            WHERE ue.user_em_no = %s
            LIMIT 1
            """,
            (email_id,),
        )
        return cursor.fetchone()

    def fetch_applicant_record(email_id):
        cursor.execute(
            f"""
            SELECT
                'Applicant' AS account_type,
                {email_id}::INTEGER AS lookup_id,
                ae.app_em_no AS email_id,
                ae.email_address AS email,
                NULL::INTEGER AS user_no,
                ae.applicant_no,
                COALESCE(
                    NULLIF(TRIM(COALESCE(a.first_name, '') || ' ' || COALESCE(a.last_name, '')), ''),
                    'Unknown Account'
                ) AS name,
                s.pro_no AS provider_no,
                COALESCE(sch.scholarship_name, 'Unassigned') AS provider_name,
                COALESCE(ae.is_locked, FALSE) AS locked
            FROM {applicant_email_table} ae
            LEFT JOIN applicants a ON ae.applicant_no = a.applicant_no
            LEFT JOIN (
                SELECT applicant_no, scholarship_no,
                       ROW_NUMBER() OVER (PARTITION BY applicant_no ORDER BY stat_no DESC) AS rn
                FROM applicant_status
            ) ast ON ast.applicant_no = a.applicant_no AND ast.rn = 1
            LEFT JOIN scholarships sch ON ast.scholarship_no = sch.req_no
            LEFT JOIN scholarship_providers s ON sch.pro_no = s.pro_no
            WHERE ae.app_em_no = %s
            LIMIT 1
            """,
            (email_id,),
        )
        return cursor.fetchone()

    if requested_type == 'admin':
        return fetch_admin_record(numeric_id)
    if requested_type == 'applicant':
        return fetch_applicant_record(numeric_id)

    admin_record = fetch_admin_record(numeric_id)
    applicant_record = fetch_applicant_record(numeric_id)

    if admin_record and applicant_record:
        raise ValueError('Ambiguous account identifier. Refresh the account list and retry.')
    return admin_record or applicant_record


def fetch_account_activity_context(cursor, account_id):
    return resolve_account_email_record(cursor, account_id)


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
    """Offload audit event to background to keep the main request fast."""
    if action in ['Login', 'Logout']:
        return
        
    run_background_task(
        _record_admin_activity_worker,
        actor_user_no=actor_user_no,
        action=action,
        target_type=target_type,
        target_id=target_id,
        target_label=target_label,
        provider_no=provider_no,
        status=status
    )

def _record_admin_activity_worker(
    *,
    actor_user_no=None,
    action,
    target_type=None,
    target_id=None,
    target_label=None,
    provider_no=None,
    status='success',
):
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
                sender_id INTEGER,
                is_student_sender BOOLEAN,
                message TEXT NOT NULL,
                timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_message_app_pro ON message(applicant_no, pro_no)")
        
        # Migration check: add new columns to existing table
        cursor.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'message'")
        existing_columns = [row['column_name'] for row in cursor.fetchall()]
        
        if 'sender_id' not in existing_columns:
            print("[MIGRATION] Adding missing column sender_id to message as INTEGER", flush=True)
            cursor.execute("ALTER TABLE message ADD COLUMN sender_id INTEGER")
            
        if 'is_student_sender' not in existing_columns:
            print("[MIGRATION] Adding missing column is_student_sender to message as BOOLEAN", flush=True)
            cursor.execute("ALTER TABLE message ADD COLUMN is_student_sender BOOLEAN")
        
        # Get all valid applicant-provider pairs
        cursor.execute("""
            SELECT DISTINCT ast.applicant_no, s.pro_no 
            FROM applicant_status ast
            JOIN scholarships s ON ast.scholarship_no = s.req_no
            WHERE COALESCE(ast.is_accepted, 'Pending') IN ('Pending', 'Accepted')
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
                # Get applicant name
                cursor.execute("SELECT first_name, last_name FROM applicants WHERE applicant_no = %s", (app_no,))
                app_row = cursor.fetchone()
                app_name = f"{app_row['first_name']} {app_row['last_name']}".strip() if app_row and (app_row.get('first_name') or app_row.get('last_name')) else f"Applicant {app_no}"
                # Create initial system message
                cursor.execute("""
                    INSERT INTO message (applicant_no, pro_no, room, username, message, timestamp)
                    VALUES (%s, %s, %s, %s, %s, NOW())
                """, (app_no, pro_no, room, sender_name, f'Chat initiated for {app_name}.'))
        
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
    
    # Initialize notification service with socketio for background alerts
    init_notification_socketio(socketio)
    
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
                    # Find all relevant scholarships for this provider, excluding those where they were declined FOR THIS PROVIDER
                    cursor.execute("""
                        SELECT DISTINCT ast.applicant_no, s.pro_no 
                        FROM applicant_status ast
                        JOIN scholarships s ON ast.scholarship_no = s.req_no
                        WHERE s.pro_no = %s AND COALESCE(ast.is_accepted, 'Pending') IN ('Pending', 'Accepted')
                        UNION
                        SELECT DISTINCT m.applicant_no, m.pro_no
                        FROM message m
                        JOIN scholarships sch ON m.pro_no = sch.pro_no
                        LEFT JOIN applicant_status ast ON (m.applicant_no = ast.applicant_no AND ast.scholarship_no = sch.req_no)
                        WHERE m.pro_no = %s AND COALESCE(ast.is_accepted, 'Pending') IN ('Pending', 'Accepted')
                    """, (pro_no, pro_no))
                    relevant_pairs = cursor.fetchall()
                    rooms = [f"{p['applicant_no']}+{p['pro_no']}" for p in relevant_pairs]
                else:
                    # Super admin - can see all rooms with messages, excluding those explicitly declined
                    cursor.execute("""
                        SELECT DISTINCT m.room 
                        FROM message m
                        LEFT JOIN scholarships s ON m.pro_no = s.pro_no
                        LEFT JOIN applicant_status ast ON (m.applicant_no = ast.applicant_no AND ast.scholarship_no = s.req_no)
                        WHERE m.room IS NOT NULL AND COALESCE(ast.is_accepted, 'Pending') IN ('Pending', 'Accepted')
                    """)
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
            
            # Personal Notification Room for students
            if user_role == 'student':
                personal_room = f"applicant_{user_id}"
                join_room(personal_room)
                print(f"DEBUG Socket: Student joined notification room '{personal_room}'")
            
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
            
            # Fetch message history JOINED with current applicant status for THIS provider and applicant info
            query = """
                SELECT m.m_id, m.applicant_no, m.sender_id, m.is_student_sender,
                       CASE 
                           WHEN m.username = (a.first_name || ' ' || a.last_name) OR m.username = a.first_name THEN a.first_name 
                           ELSE m.username 
                       END as username,
                       a.first_name, a.last_name,
                       CONCAT_WS(' ', NULLIF(a.first_name, ''), NULLIF(a.last_name, '')) as applicant_name,
                       m.message, m.timestamp,
                       CASE 
                           WHEN s.is_accepted = 'Accepted' THEN 'Accepted'
                           WHEN s.is_accepted = 'Rejected' THEN 'Rejected'
                           WHEN s.is_accepted = 'Cancelled' THEN 'Cancelled'
                           ELSE 'Pending'
                       END as student_status
                FROM message m
                LEFT JOIN applicants a ON m.applicant_no = a.applicant_no
                LEFT JOIN (
                    SELECT DISTINCT ON (ast.applicant_no) ast.applicant_no, ast.is_accepted
                    FROM applicant_status ast
                    JOIN scholarships sch ON ast.scholarship_no = sch.req_no
                    WHERE sch.pro_no = %s
                    ORDER BY ast.applicant_no, 
                             CASE WHEN ast.is_accepted = 'Accepted' THEN 1 WHEN ast.is_accepted IS NULL OR ast.is_accepted = 'Pending' THEN 2 ELSE 3 END
                ) s ON m.applicant_no = s.applicant_no
                WHERE m.applicant_no = %s AND m.pro_no = %s
            """
            params = [pro_no, app_no, pro_no]

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
            
            formatted_list = []
            for msg in messages:
                app_name = msg.get('applicant_name') or f"Applicant {msg['applicant_no']}"
                formatted_list.append({
                    'm_id': msg['m_id'],
                    'applicant_no': msg['applicant_no'],
                    'username': msg['username'],
                    'first_name': msg.get('first_name'),
                    'last_name': msg.get('last_name'),
                    'applicant_name': app_name,
                    'sender_id': msg['sender_id'],
                    'is_student_sender': msg['is_student_sender'],
                    'message': msg['message'],
                    'timestamp': msg['timestamp'].strftime('%Y-%m-%d %H:%M:%S') if hasattr(msg['timestamp'], 'strftime') else str(msg['timestamp']),
                    'room': room,
                    'student_status': msg['student_status']
                })

            emit('history', {
                'room': room,
                'messages': formatted_list
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
                INSERT INTO message (applicant_no, pro_no, room, username, message, timestamp, sender_id, is_student_sender)
                VALUES (%s, %s, %s, %s, %s, NOW(), %s, %s)
                RETURNING m_id, timestamp
            """, (app_no, pro_no, room, actual_username, message_text, sender_id, is_student_sender))
            row = cursor.fetchone()
            m_id = row['m_id']
            timestamp = row['timestamp']
            
            # Fetch current status of the applicant to include in the payload (specific to THIS provider)
            cursor.execute("""
                SELECT CASE 
                    WHEN ast.is_accepted = 'Accepted' THEN 'Accepted'
                    WHEN ast.is_accepted = 'Rejected' THEN 'Rejected'
                    WHEN ast.is_accepted = 'Cancelled' THEN 'Cancelled'
                    ELSE 'Pending'
                END as student_status
                FROM applicant_status ast
                JOIN scholarships sch ON ast.scholarship_no = sch.req_no
                WHERE ast.applicant_no = %s AND sch.pro_no = %s
                ORDER BY 
                    CASE WHEN ast.is_accepted = 'Accepted' THEN 1 WHEN ast.is_accepted IS NULL OR ast.is_accepted = 'Pending' THEN 2 ELSE 3 END
                LIMIT 1
            """, (app_no, pro_no))
            status_row = cursor.fetchone()
            student_status = status_row['student_status'] if status_row else 'Pending'
            
            conn.commit()
            cursor.close()
            conn.close()

            emit('message', {
                'm_id': m_id,
                'applicant_no': app_no,
                'username': actual_username,
                'sender_id': sender_id,
                'is_student_sender': is_student_sender,
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
        with get_db() as conn:
            cursor = conn.cursor()
            user_email_table = get_user_email_table(cursor)
            normalized_email = data['email'].strip()
            
            # Query user from database based on email table joining with user and scholarship_providers
            cursor.execute(f'''
                SELECT e.password_hash, e.user_no, e.is_locked, e.is_verified, u.user_name, u.pro_no, p.provider_name, e.user_em_no
                FROM {user_email_table} e
                LEFT JOIN users u ON e.user_no = u.user_no
                LEFT JOIN scholarship_providers p ON u.pro_no = p.pro_no
                WHERE e.email_address ILIKE %s
            ''', (normalized_email,))
            user = cursor.fetchone()
            
            if not user or user['user_no'] is None:
                record_admin_activity(
                    action='Login Failed',
                    status='failed',
                )
                return jsonify({'message': "Email not found"}), 404

        provider_name = (user['provider_name'] or '').strip() or 'All'
        user_name = user['user_name'] or provider_name or normalized_email
        
        is_valid, needs_rehash = safe_check_password_hash(user['password_hash'], data['password'])
        if not is_valid:
            record_admin_activity(
                actor_user_no=user['user_no'],
                action='Login Failed',
                provider_no=user['pro_no'],
                status='failed',
            )
            return jsonify({'message': 'Incorrect password'}), 401

        if needs_rehash and user.get('user_em_no'):
            try:
                with get_db() as conn:
                    cursor = conn.cursor()
                    new_hash = bcrypt.generate_password_hash(data['password']).decode('utf-8')
                    cursor.execute(f"UPDATE {user_email_table} SET password_hash = %s WHERE user_em_no = %s", (new_hash, user['user_em_no']))
                    conn.commit()
            except Exception as rehash_err:
                print(f"[AUTH REHASH WARNING] Failed to upgrade admin password hash to bcrypt: {rehash_err}")
        
        # Check if account is locked
        if user.get('is_locked'):
            record_admin_activity(
                actor_user_no=user['user_no'],
                action='Login Failed',
                provider_no=user['pro_no'],
                status='failed',
            )
            return jsonify({'message': 'Account has been suspended. Please contact the administrator.', 'suspended': True}), 403
        
        # Check if account is verified
        if not user.get('is_verified', True):
            return jsonify({
                'message': 'Email address not verified.',
                'requires_verification': True,
                'email': normalized_email,
                'userId': make_account_identifier('admin', user['user_no'])
            }), 403
        
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
        with get_db() as conn:
            cursor = conn.cursor()
            user_email_table = get_user_email_table(cursor)
            applicant_email_table = get_applicant_email_table(cursor)
            
            cursor.execute(f'SELECT user_no FROM {user_email_table} WHERE email_address ILIKE %s LIMIT 1', (data['email'],))
            user_result = cursor.fetchone()
            cursor.execute(f'SELECT applicant_no FROM {applicant_email_table} WHERE email_address ILIKE %s LIMIT 1', (data['email'],))
            applicant_result = cursor.fetchone()
            
            has_admin_account = user_result is not None
            has_applicant_account = applicant_result is not None

        if has_admin_account or has_applicant_account:
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
        with get_db() as conn:
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
        with get_db() as conn:
            cursor = conn.cursor()
            user_email_table = get_user_email_table(cursor)

            normalized_email = data['email'].strip()
            # Only check if email exists as an ADMIN user (user_no is not NULL)
            # Applicant emails (applicant_no only) are allowed to register as admin
            cursor.execute(f"SELECT 1 FROM {user_email_table} WHERE email_address ILIKE %s AND user_no IS NOT NULL", (normalized_email,))
            if cursor.fetchone():
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
            
            # 4. Insert into user auth table with verification code
            cursor.execute(
                f"INSERT INTO {user_email_table} (email_address, password_hash, user_no, verification_code, is_verified) VALUES (%s, %s, %s, %s, %s) RETURNING user_em_no",
                (normalized_email, password_hash, user_no, verification_code, False)
            )
            user_em_no = cursor.fetchone()['user_em_no']
            
            conn.commit()

        # 5. Send verification email (Offloaded to background to prevent UI lag)
        # Using unified service with is_admin=True
        run_background_task(send_verification_email, normalized_email, verification_code, True)

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
            'userId': make_account_identifier('admin', user_em_no),
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
        user_email_table = get_user_email_table(cursor)
        applicant_email_table = get_applicant_email_table(cursor)
        

        # Check if email exists as a USER account ONLY (user_no must be set, applicant_no must be NULL)
        cursor.execute(
            f'''
            SELECT e.user_no, e.email_address, u.user_name, u.pro_no, p.provider_name
            FROM {user_email_table} e
            JOIN users u ON e.user_no = u.user_no
            LEFT JOIN scholarship_providers p ON u.pro_no = p.pro_no
            WHERE e.email_address ILIKE %s
            AND e.user_no IS NOT NULL
            LIMIT 1
            ''',
            (normalized_email,),
        )
        user = cursor.fetchone()

        if user:
            # User account found - send password reset email
            # User account found - send password reset email (Offloaded to background)
            reset_token = generate_password_reset_token(
                user['user_no'],
                user['email_address'],
                user['provider_name'],
                user['pro_no'],
            )
            reset_url = f"{FRONTEND_URL}/reset-password/{reset_token}"
            run_background_task(send_password_reset_email, user['email_address'], reset_url, user['provider_name'])
            return jsonify({'message': 'If an account exists with this email, a password reset link has been sent'}), 200
        else:
            # No user account found - check if it's an applicant-only or non-existent
            cursor.execute(
                f'''
                SELECT e.applicant_no, e.is_verified
                FROM {applicant_email_table} e
                WHERE e.email_address ILIKE %s
                LIMIT 1
                ''',
                (normalized_email,),
            )
            existing_email = cursor.fetchone()
            
            if existing_email:
                # Email exists but only as applicant (user_no is NULL)
                # If not verified, treat as non-existent for password reset
                if not existing_email.get('is_verified', False):
                    print(f"[FORGOT PASSWORD] Email {normalized_email} is applicant but not verified. Blocking reset.")
                    cursor.close()
                    conn.close()
                    return jsonify({'message': 'Account does not exist', 'success': False}), 404
                else:
                    print(f"[FORGOT PASSWORD] Email {normalized_email} is applicant and verified, but not a user account.")
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
        user_email_table = get_user_email_table(cursor)
        cursor.execute(
            f'''
            UPDATE {user_email_table}
            SET password_hash = %s
            WHERE user_no = %s AND email_address ILIKE %s
            RETURNING user_em_no
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
        user_email_table = get_user_email_table(cursor)
        
        # Check if email exists and code matches
        cursor.execute(
            f"SELECT user_no, verification_code, is_verified FROM {user_email_table} WHERE email_address ILIKE %s",
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
            f"UPDATE {user_email_table} SET is_verified = TRUE, verification_code = NULL WHERE email_address ILIKE %s",
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
@api_bp.route('/admin/accounts', methods=['GET'])
@token_required
def get_accounts(current_user_id, pro_no, role):
    """Get all user accounts"""
    try:
        filters = request.args
        conn = get_db()
        cursor = conn.cursor()
        user_email_table = get_user_email_table(cursor)
        applicant_email_table = get_applicant_email_table(cursor)

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
        status_column = ', status_updated' if has_status_updated else ''
        applicant_order = 'status_updated DESC' if has_status_updated else 'stat_no DESC'

        query = f'''
            SELECT *
            FROM (
                SELECT
                    'admin-' || u.user_no::text AS id,
                    COALESCE(ue.email_address, 'No email') AS email,
                    COALESCE(u.user_name, p.provider_name, 'Unknown') AS name,
                    COALESCE(u.user_name, p.provider_name, 'Unknown') AS first_name,
                    '' AS last_name,
                    'admin' AS role,
                    'Admin' AS type,
                    COALESCE(p.provider_name, 'All') AS scholarship,
                    p.pro_no AS provider_no,
                    'Registered' AS status,
                    NULL::date AS joined,
                    COALESCE(ue.is_locked, FALSE) AS locked
                FROM users u
                LEFT JOIN {user_email_table} ue ON u.user_no = ue.user_no
                LEFT JOIN scholarship_providers p ON u.pro_no = p.pro_no

                UNION ALL

                SELECT
                    'applicant-' || a.applicant_no::text AS id,
                    COALESCE(ae.email_address, 'No email') AS email,
                    COALESCE(NULLIF(TRIM(COALESCE(a.first_name, '') || ' ' || COALESCE(a.last_name, '')), ''), 'Unknown') AS name,
                    COALESCE(a.first_name, 'Unknown') AS first_name,
                    COALESCE(a.last_name, '') AS last_name,
                    'scholar' AS role,
                    'Applicant' AS type,
                    COALESCE(s.scholarship_name, 'Unassigned') AS scholarship,
                    s.pro_no AS provider_no,
                    CASE
                        WHEN ast.is_accepted = 'Accepted' THEN 'Accepted'
                        WHEN ast.is_accepted = 'Rejected' THEN 'Rejected'
                        WHEN ast.is_accepted = 'Cancelled' THEN 'Cancelled'
                        ELSE 'Pending'
                    END AS status,
                    {joined_expr} AS joined,
                    COALESCE(ae.is_locked, FALSE) AS locked
                FROM applicants a
                LEFT JOIN {applicant_email_table} ae ON a.applicant_no = ae.applicant_no
                LEFT JOIN (
                    SELECT applicant_no, scholarship_no, is_accepted{status_column},
                           ROW_NUMBER() OVER(PARTITION BY applicant_no ORDER BY {applicant_order}) as rn
                    FROM applicant_status
                ) ast ON a.applicant_no = ast.applicant_no AND ast.rn = 1
                LEFT JOIN scholarships s ON ast.scholarship_no = s.req_no
                WHERE COALESCE(s.is_removed, FALSE) = FALSE OR s.req_no IS NULL
            ) accounts
            WHERE 1=1
        '''
        params = []
        
        # Isolation: If not superadmin, only show accounts related to this provider
        if role != 'Admin':
            query += ' AND provider_no = %s'
            params.append(pro_no)
        
        if filters.get('role'):
            role_filter = filters['role'].lower()
            if role_filter == 'admin':
                query += " AND role = 'admin'"
            elif role_filter == 'scholar':
                query += " AND role = 'scholar'"
        
        if filters.get('search'):
            query += ' AND (email ILIKE %s OR name ILIKE %s OR scholarship ILIKE %s OR id ILIKE %s)'
            search_term = f"%{filters['search']}%"
            params.extend([search_term, search_term, search_term, search_term])

        query += ' ORDER BY name ASC, id ASC'
        
        cursor.execute(query, params)
        accounts = cursor.fetchall()
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
        user_email_table = get_user_email_table(cursor)
        applicant_email_table = get_applicant_email_table(cursor)

        normalized_email = data['email'].strip()
        cursor.execute(f"SELECT user_em_no FROM {user_email_table} WHERE email_address ILIKE %s LIMIT 1", (normalized_email,))
        existing_admin = cursor.fetchone()
        cursor.execute(f"SELECT app_em_no FROM {applicant_email_table} WHERE email_address ILIKE %s LIMIT 1", (normalized_email,))
        existing_applicant = cursor.fetchone()
        if existing_admin or existing_applicant:
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
            
            # 3a. Insert into user auth table
            cursor.execute(
                f"INSERT INTO {user_email_table} (email_address, password_hash, user_no, is_verified) VALUES (%s, %s, %s, TRUE) RETURNING user_em_no",
                (normalized_email, password_hash, user_no)
            )
            account_id = make_account_identifier('admin', cursor.fetchone()['user_em_no'])
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
            
            # 3b. Insert into applicant auth table
            cursor.execute(
                f"INSERT INTO {applicant_email_table} (email_address, password_hash, applicant_no, is_verified) VALUES (%s, %s, %s, TRUE) RETURNING app_em_no",
                (normalized_email, password_hash, applicant_no)
            )
            account_id = make_account_identifier('applicant', cursor.fetchone()['app_em_no'])
        
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

@api_bp.route('/accounts/<account_id>', methods=['PUT'])
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
        
        if account_context['user_no']:
            # Update user table
            if 'name' in data or 'firstName' in data or 'lastName' in data:
                name = data.get('name') or f"{data.get('firstName', '')} {data.get('lastName', '')}".strip()
                if name:
                    cursor.execute("UPDATE users SET user_name = %s WHERE user_no = %s", (name, account_context['user_no']))
        elif account_context['applicant_no'] and ('name' in data or 'firstName' in data or 'lastName' in data):
            full_name = data.get('name') or f"{data.get('firstName', '')} {data.get('lastName', '')}".strip()
            name_parts = full_name.split()
            if len(name_parts) >= 2:
                cursor.execute(
                    "UPDATE applicants SET first_name = %s, last_name = %s WHERE applicant_no = %s",
                    (' '.join(name_parts[:-1]), name_parts[-1], account_context['applicant_no'])
                )
                    
        target_table = get_user_email_table(cursor) if account_context['account_type'] == 'Admin' else get_applicant_email_table(cursor)
        id_column = 'user_em_no' if account_context['account_type'] == 'Admin' else 'app_em_no'

        # Update auth table
        if 'email' in data:
            cursor.execute(f"UPDATE {target_table} SET email_address = %s WHERE {id_column} = %s", (data['email'], account_context['email_id']))
        if 'password' in data and data['password']:
            password_hash = bcrypt.generate_password_hash(data['password']).decode('utf-8')
            cursor.execute(f"UPDATE {target_table} SET password_hash = %s WHERE {id_column} = %s", (password_hash, account_context['email_id']))
            
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

@api_bp.route('/accounts/<account_id>', methods=['DELETE'])
@token_required
def delete_account(current_user_id, pro_no, role, account_id):
    """Delete user account and all related records from applicants and users tables"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            account_context = fetch_account_activity_context(cursor, account_id)
            if not account_context:
                return jsonify({'message': 'Account not found'}), 404
            
            email_addr = account_context.get('email')
            user_no = account_context.get('user_no')
            applicant_no = account_context.get('applicant_no')
            email_id = account_context.get('email_id')

            if account_context['account_type'] == 'Admin':
                user_email_table = get_user_email_table(cursor)
                if email_id:
                    try:
                        cursor.execute(f'DELETE FROM {user_email_table} WHERE user_em_no = %s', (email_id,))
                    except Exception as e:
                        print(f"[ACCOUNT DELETE NOTICE] {e}", flush=True)
                if user_no:
                    try:
                        cursor.execute('DELETE FROM notifications WHERE user_no = %s', (user_no,))
                    except Exception:
                        pass
                    cursor.execute('DELETE FROM users WHERE user_no = %s', (user_no,))
            else:
                applicant_email_table = get_applicant_email_table(cursor)

                # If applicant_no is missing, try looking it up by app_em_no or email
                if not applicant_no and email_id:
                    try:
                        cursor.execute(f"SELECT applicant_no FROM {applicant_email_table} WHERE app_em_no = %s LIMIT 1", (email_id,))
                        row = cursor.fetchone()
                        if row:
                            applicant_no = row['applicant_no'] if isinstance(row, dict) else row[0]
                    except Exception:
                        pass

                if not applicant_no and email_addr:
                    try:
                        cursor.execute(f"SELECT applicant_no FROM {applicant_email_table} WHERE email_address ILIKE %s LIMIT 1", (email_addr,))
                        row = cursor.fetchone()
                        if row:
                            applicant_no = row['applicant_no'] if isinstance(row, dict) else row[0]
                    except Exception:
                        pass

                # 1. Delete dependent/related records in foreign tables
                cleanup_statements = [
                    f"DELETE FROM {applicant_email_table} WHERE applicant_no = %s OR app_em_no = %s",
                    "DELETE FROM applicant_status WHERE applicant_no = %s",
                    "DELETE FROM merit_proofs WHERE applicant_no = %s",
                    "DELETE FROM messages WHERE applicant_no = %s",
                    "DELETE FROM message WHERE applicant_no = %s",
                    "DELETE FROM applicant_documents WHERE applicant_no = %s",
                    "DELETE FROM applicant_family_background WHERE applicant_no = %s",
                    "DELETE FROM applicant_educational_background WHERE applicant_no = %s",
                    "DELETE FROM applicant_signatures WHERE applicant_no = %s",
                    "DELETE FROM applicant_face_encodings WHERE applicant_no = %s",
                    "DELETE FROM notifications WHERE user_no = %s",
                ]

                for stmt in cleanup_statements:
                    try:
                        if 'app_em_no' in stmt:
                            cursor.execute(stmt, (applicant_no, email_id))
                        else:
                            if applicant_no:
                                cursor.execute(stmt, (applicant_no,))
                    except Exception as clean_err:
                        print(f"[ACCOUNT DELETE CLEANUP NOTICE] {clean_err}", flush=True)

                if email_addr:
                    try:
                        cursor.execute("DELETE FROM pending_registrations WHERE email_address ILIKE %s", (email_addr,))
                    except Exception:
                        pass

                # 2. Delete the entire user from the applicants table!
                if applicant_no:
                    cursor.execute("DELETE FROM applicants WHERE applicant_no = %s", (applicant_no,))

                # 3. If there is a corresponding users table record
                if user_no:
                    try:
                        cursor.execute('DELETE FROM users WHERE user_no = %s', (user_no,))
                    except Exception:
                        pass

            conn.commit()

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
            safe_emit('account_change', {'action': 'deleted', 'account_id': account_id, 'applicant_no': applicant_no, 'user_no': user_no}, broadcast=True)
            
            return jsonify({'success': True, 'message': 'Account and applicant profile deleted successfully'}), 200
        
    except Exception as e:
        return jsonify({'message': f'Error: {str(e)}'}), 500

@api_bp.route('/debug/delete-applicant-by-email', methods=['POST', 'DELETE'])
@token_required
def debug_delete_applicant_by_email(current_user_id, pro_no, role):
    """
    Debug route: Delete an applicant in the applicants table based on the applicant_no
    tied to the inputted email address.
    """
    try:
        data = request.get_json() or {}
        target_email = (data.get('email') or request.args.get('email') or '').strip()

        if not target_email:
            return jsonify({'success': False, 'message': 'Email is required'}), 400

        with get_db() as conn:
            cursor = conn.cursor()
            applicant_email_table = get_applicant_email_table(cursor)

            # 1. Look up applicant_no tied to the inputted email
            cursor.execute(
                f"SELECT applicant_no, app_em_no FROM {applicant_email_table} WHERE email_address ILIKE %s LIMIT 1",
                (target_email,)
            )
            row = cursor.fetchone()

            applicant_no = None
            app_em_no = None

            if row:
                if isinstance(row, dict):
                    applicant_no = row.get('applicant_no')
                    app_em_no = row.get('app_em_no')
                else:
                    applicant_no = row[0]
                    app_em_no = row[1] if len(row) > 1 else None

            if not applicant_no:
                # Fallback: check pending_registrations
                try:
                    cursor.execute("SELECT pr_no FROM pending_registrations WHERE email_address ILIKE %s", (target_email,))
                    pr_row = cursor.fetchone()
                    if pr_row:
                        pr_no_val = pr_row['pr_no'] if isinstance(pr_row, dict) else pr_row[0]
                        cursor.execute("DELETE FROM pending_registrations WHERE pr_no = %s", (pr_no_val,))
                        conn.commit()
                        return jsonify({
                            'success': True,
                            'message': f'Pending registration for {target_email} deleted.'
                        }), 200
                except Exception:
                    pass

                return jsonify({
                    'success': False,
                    'message': f'No applicant found tied to email: {target_email}'
                }), 404

            # 2. Delete related records in dependent tables before deleting from applicants
            cleanup_statements = [
                f"DELETE FROM {applicant_email_table} WHERE applicant_no = %s OR app_em_no = %s",
                "DELETE FROM applicant_status WHERE applicant_no = %s",
                "DELETE FROM notifications WHERE user_no = %s",
                "DELETE FROM messages WHERE applicant_no = %s",
                "DELETE FROM applicant_documents WHERE applicant_no = %s",
                "DELETE FROM applicant_family_background WHERE applicant_no = %s",
                "DELETE FROM applicant_educational_background WHERE applicant_no = %s",
                "DELETE FROM applicant_signatures WHERE applicant_no = %s",
                "DELETE FROM applicant_face_encodings WHERE applicant_no = %s",
                "DELETE FROM pending_registrations WHERE email_address ILIKE %s",
            ]

            for stmt in cleanup_statements:
                try:
                    if 'app_em_no' in stmt:
                        cursor.execute(stmt, (applicant_no, app_em_no))
                    elif 'pending_registrations' in stmt:
                        cursor.execute(stmt, (target_email,))
                    else:
                        cursor.execute(stmt, (applicant_no,))
                except Exception as clean_err:
                    print(f"[DEBUG DELETE CLEANUP NOTICE] {clean_err}", flush=True)

            # 3. Delete from applicants table based on applicant_no
            cursor.execute("DELETE FROM applicants WHERE applicant_no = %s RETURNING applicant_no", (applicant_no,))
            conn.commit()

            # Audit activity log
            try:
                record_admin_activity(
                    actor_user_no=current_user_id,
                    action='Debug Applicant Deleted',
                    target_type='Applicant',
                    target_id=str(applicant_no),
                    target_label=target_email,
                    provider_no=pro_no,
                    status='success',
                )
            except Exception:
                pass

            # Notify frontend admin clients to refresh accounts tables
            safe_emit('account_change', {'action': 'deleted', 'applicant_no': applicant_no, 'email': target_email}, broadcast=True)

            return jsonify({
                'success': True,
                'message': f'Applicant #{applicant_no} tied to email {target_email} successfully deleted from applicants table.'
            }), 200

    except Exception as e:
        print(f"[DEBUG DELETE APPLICANT ERROR] {traceback.format_exc()}", flush=True)
        return jsonify({'success': False, 'message': f'Error deleting applicant: {str(e)}'}), 500


@api_bp.route('/accounts/<account_id>/lock', methods=['PUT'])
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
        
        target_table = get_user_email_table(cursor) if account_context['account_type'] == 'Admin' else get_applicant_email_table(cursor)
        id_column = 'user_em_no' if account_context['account_type'] == 'Admin' else 'app_em_no'

        cursor.execute(f'''
            UPDATE {target_table}
            SET is_locked = %s
            WHERE {id_column} = %s
            RETURNING {id_column}
        ''', (data['locked'], account_context['email_id']))
        
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
@api_bp.route('/admin/statistics', methods=['GET'])
@token_required
def get_statistics(current_user_id, pro_no, role):
    """Get dashboard statistics"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        user_email_table = get_user_email_table(cursor)
        applicant_email_table = get_applicant_email_table(cursor)
        
        if role != 'Admin':
            # Get total users related to this provider
            cursor.execute('''
                SELECT (
                    (SELECT COUNT(DISTINCT u.user_no)
                     FROM users u
                     WHERE u.pro_no = %s) +
                    (SELECT COUNT(DISTINCT ast.applicant_no)
                     FROM applicant_status ast 
                     JOIN scholarships s ON ast.scholarship_no = s.req_no 
                     WHERE s.pro_no = %s)
                ) as total
            ''', (pro_no, pro_no))
            total_users = cursor.fetchone()['total']
            
            by_role = [
                {'role': 'admin', 'count': 0},
                {'role': 'scholar', 'count': 0},
            ]
            cursor.execute('SELECT COUNT(DISTINCT user_no) as count FROM users WHERE pro_no = %s', (pro_no,))
            by_role[0]['count'] = cursor.fetchone()['count']
            cursor.execute('''
                SELECT COUNT(DISTINCT ast.applicant_no) as count
                FROM applicant_status ast 
                JOIN scholarships s ON ast.scholarship_no = s.req_no 
                WHERE s.pro_no = %s
            ''', (pro_no,))
            by_role[1]['count'] = cursor.fetchone()['count']
            
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
            cursor.execute('SELECT (SELECT COUNT(*) FROM users) + (SELECT COUNT(DISTINCT applicant_no) FROM applicant_status) as total')
            total_users = cursor.fetchone()['total']

            cursor.execute('SELECT COUNT(*) as count FROM users')
            admin_count = cursor.fetchone()['count']
            cursor.execute('SELECT COUNT(DISTINCT applicant_no) as count FROM applicant_status')
            applicant_count = cursor.fetchone()['count']
            by_role = [
                {'role': 'admin', 'count': admin_count},
                {'role': 'scholar', 'count': applicant_count},
            ]
            
            cursor.execute('SELECT COUNT(DISTINCT applicant_no) as total FROM applicant_status')
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
@api_bp.route('/admin/logs', methods=['GET'])
@token_required
def get_activity_logs(current_user_id, pro_no, role):
    """Get admin audit activity logs from the dedicated audit table."""
    try:
        filters = request.args
        conn = get_db()
        cursor = conn.cursor()
        user_email_table = get_user_email_table(cursor)

        ensure_admin_activity_log_table(cursor)

        query = f'''
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
                FROM {user_email_table}
                WHERE user_no = logs.actor_user_no
                ORDER BY user_em_no ASC
                LIMIT 1
            ) AS actor_email ON TRUE
            LEFT JOIN scholarship_providers AS event_provider ON logs.provider_no = event_provider.pro_no
            WHERE 1=1
        '''
        params = []

        if role != 'Admin':
            query += ' AND logs.provider_no = %s'
            params.append(pro_no)

        query += " AND logs.action NOT IN ('Login', 'Logout', 'Login Failed')"

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
                'date': (row['occurred_at'].isoformat() + ('Z' if not str(row['occurred_at']).endswith(('+', 'Z')) else '')) if row['occurred_at'] else None,
            }
            for row in rows
        ]

        cursor.close()
        conn.close()

        return jsonify({'success': True, 'logs': filtered_logs}), 200

    except Exception as e:
        return jsonify({'message': f'Error: {str(e)}'}), 500

@api_bp.route('/scholarships/<program>', methods=['GET'])
@api_bp.route('/admin/scholarships/<program>', methods=['GET'])
@token_required
def get_scholarship_by_program(current_user_id, pro_no, role, program):
    """Get scholarship data for a program (provider) - returns metadata and base64-encoded images"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        resolved_provider_no, _ = resolve_provider_context(cursor, current_user_id, role, pro_no)
        is_super_admin = (role or '').strip().lower() == 'admin'

        scholarship_columns = get_table_columns(cursor, 'scholarships')

        description_expr = 's."desc"' if 'desc' in scholarship_columns else 'NULL'
        date_created_expr = 's.date_created' if 'date_created' in scholarship_columns else 'NULL'
        semester_expr = 's.semester' if 'semester' in scholarship_columns else 'NULL'
        year_expr = 's.year' if 'year' in scholarship_columns else 'NULL'

        include_removed = request.args.get('include_removed', 'false').lower() == 'true'
        where_clauses = []
        if 'is_removed' in scholarship_columns and not include_removed:
            where_clauses.append('COALESCE(s.is_removed, FALSE) = FALSE')
        
        is_removed_expr = 'COALESCE(s.is_removed, FALSE)' if 'is_removed' in scholarship_columns else 'FALSE'
        
        query = '''
            SELECT s.req_no as id, s.req_no as "reqNo", s.scholarship_name as "scholarshipName", 
                   s.gpa as "minGpa", s.location, s.parent_finance as "parentFinance",
                   s.slots, s.deadline, s.pro_no as "proNo", p.provider_name as "providerName",
                   {is_removed_expr} as "isRemoved",
                                         {description_expr} as description, {date_created_expr} as "dateCreated",
                                         {semester_expr} as semester, {year_expr} as year,
                                         COUNT(ast.applicant_no) FILTER (WHERE ast.is_accepted = 'Accepted') as "acceptedCount",
                                         COUNT(ast.applicant_no) FILTER (WHERE ast.is_accepted IS NULL OR ast.is_accepted = 'Pending') as "pendingCount",
                                         COUNT(ast.applicant_no) FILTER (WHERE ast.is_accepted = 'Rejected') as "declinedCount"
            FROM scholarships s
            LEFT JOIN scholarship_providers p ON s.pro_no = p.pro_no
                        LEFT JOIN applicant_status ast ON ast.scholarship_no = s.req_no
        '''.format(
            is_removed_expr=is_removed_expr,
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
        if 'is_removed' in scholarship_columns:
            group_by_columns.append('s.is_removed')
        if 'desc' in scholarship_columns:
            group_by_columns.append('s."desc"')
        if 'date_created' in scholarship_columns:
            group_by_columns.append('s.date_created')
        if 'semester' in scholarship_columns:
            group_by_columns.append('s.semester')
        if 'year' in scholarship_columns:
            group_by_columns.append('s.year')

        # Add Pagination
        limit = int(request.args.get('limit', 100))
        offset = int(request.args.get('offset', 0))
        
        query += '\n            GROUP BY ' + ', '.join(group_by_columns) + '\n            ORDER BY s.req_no DESC LIMIT %s OFFSET %s\n        '
        params.extend([limit, offset])
        
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


# In-memory cache for AI merit evaluations so each unique merits text is only
# evaluated once per server lifetime (avoids re-calling Gemini for every applicant).
_MERIT_EVAL_CACHE = {}
_MERIT_EVAL_CACHE_MAX = 2000  # Limit memory footprint

def analyze_merits_onthefly(merits_text):
    """
    Parses merits_text using Gemini API if GEMINI_API_KEY is present in env,
    otherwise falls back to a calibrated rule-based parser.
    Strictly evaluates academic achievements and academic honors.
    """
    import os
    import json
    import requests

    if not merits_text or not merits_text.strip():
        return 0, "No merits or awards provided."

    text_clean = merits_text.strip().lower()

    # --- Cache hit: return previously computed result instantly ---
    cache_key = text_clean[:500]  # cap key length
    if cache_key in _MERIT_EVAL_CACHE:
        return _MERIT_EVAL_CACHE[cache_key]
    academic_keywords = [
        'summa', 'magna', 'cum laude', 'laude', 'valedictorian', 'salutatorian',
        'first honor', '1st honor', 'second honor', '2nd honor', 'third honor', '3rd honor',
        'highest honors', 'high honors', 'with honors', 'honor', 'dean', 'quiz', 'olympiad',
        'math', 'science', 'academic', 'research', 'thesis', 'scholar', 'lister', 'gwa'
    ]

    # Calculate base rule-based score
    base_score = 0
    base_reason = "No recognized academic honors or awards."
    if any(k in text_clean for k in ['summa cum laude', 'summa', 'valedictorian', 'national math olympiad', 'national science olympiad', 'international olympiad', 'rank 1 overall']):
        base_score, base_reason = 20, "Highest academic distinction (Summa Cum Laude / Valedictorian / National Olympiad Champion)."
    elif any(k in text_clean for k in ['magna cum laude', 'magna', 'salutatorian', 'regional olympiad champion', 'top 3 national']):
        base_score, base_reason = 18, "Top national / regional academic distinction (Magna Cum Laude / Salutatorian / Regional Champion)."
    elif any(k in text_clean for k in ['cum laude', 'first honor', '1st honor', 'with highest honors', 'highest honors', '1st place division']):
        base_score, base_reason = 15, "High academic honors (Cum Laude / 1st Honor / With Highest Honors / Division Champion)."
    elif any(k in text_clean for k in ['second honor', '2nd honor', 'with high honors', 'high honors', "president's list", 'presidents list', 'division olympiad', 'division quiz bee']):
        base_score, base_reason = 12, "High academic honors (2nd Honor / With High Honors / President's List / Division Placement)."
    elif any(k in text_clean for k in ['third honor', '3rd honor', "dean's list", 'deans list', 'dean', 'academic lister', 'honor student', 'with honors', 'academic excellence', 'quiz bee', 'science fair', 'math contest', 'academic award']):
        base_score, base_reason = 8, "School-level academic honors (3rd Honor / With Honors / Dean's List / Academic Contest)."
    elif any(k in text_clean for k in ['academic', 'honor', 'award', 'certificate', 'contestant', 'top 10', 'best in math', 'best in science', 'best in research']):
        base_score, base_reason = 5, "General academic recognition / subject award."

    api_key = os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY')
    if api_key:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key={api_key}"
            prompt = f"""You are a Senior Academic Scholarship Reviewer on a holistic admissions committee.
Your role is to evaluate the applicant's academic merit profile using qualitative, multi-dimensional assessment.

DO NOT simply match keywords. Instead, subjectively evaluate the applicant's academic dedication, consistency, rigor, and scholarly initiative.

EVALUATION FRAMEWORK (Total: 0 - 20 Points):

**COMPONENT A: Core Academic Achievement (0 - 5 points)**
This is the FLOOR/CEILING score based on the highest academic honor achieved.

- 5 pts: Valedictorian, Summa Cum Laude, Rank 1 Overall Batch, National/International Olympiad Champion.
- 4 pts: Magna Cum Laude, Salutatorian, Rank 2, National Olympiad Top 3.
- 3 pts: Cum Laude, With Highest Honors (GWA 98-100), Rank 3-5, Regional Champion.
- 2 pts: With High Honors (GWA 95-97), President's Lister, Top 10% of batch, Division Champion.
- 1 pt: With Honors (GWA 90-94), Dean's Lister, Top 15% of batch, School-Level Honors.
- 0 pts: No academic honors or recognitions mentioned.

**COMPONENT B: Adversity & Resilience (0 - 5 points)**
Evaluate if the student overcame significant obstacles to achieve their academic standing.

- 5 pts: Explicit major adversity (e.g., self-supporting student, orphaned, extreme poverty, remote/underprivileged school, major illness/disability, or refugee/displaced background).
- 4 pts: Significant challenges (e.g., worked part-time while studying, first-generation college student, single-parent household, or transferred schools mid-year).
- 3 pts: Moderate challenges (e.g., balancing academics with family responsibilities or leadership roles).
- 2 pts: Minor contextual challenges mentioned but not severe.
- 1 pt: Hint of challenge but not explicitly described.
- 0 pts: No adversity or challenges mentioned.

**COMPONENT C: Sustained Excellence & Consistency (0 - 5 points)**
Evaluate if the student maintained their academic performance over time.

- 5 pts: Multi-year excellence (e.g., "Valedictorian for 4 straight years", "Consistent Dean's Lister for 5+ semesters", "With Honors from Grade 7-12").
- 4 pts: Sustained honors for at least 2 full academic years or 4+ semesters.
- 3 pts: Sustained honors for 1 full academic year or 3 consecutive semesters.
- 2 pts: Honors for at least 2 consecutive semesters.
- 1 pt: Single-term or one-off achievement with no evidence of sustained performance.
- 0 pts: No evidence of sustained performance or only a single achievement listed.

**COMPONENT D: Scholarly Initiative & Rigor (0 - 5 points)**
Evaluate academic activities beyond the classroom that show intellectual curiosity.

- 5 pts: Major research publication, international-level investigatory project, national olympiad medalist, or formal thesis with distinction.
- 4 pts: Regional/division olympiad placements, published school research, or multi-year academic club leadership (e.g., President of Science Club for 2+ years).
- 3 pts: Active participation in inter-school academic competitions (quiz bees, debates, math challenges), or mentorship/tutoring roles.
- 2 pts: School-level contest participation, academic club officer, or classroom project leader.
- 1 pt: General attendance in academic seminars or passive club membership.
- 0 pts: No academic competitions, research, or specialized scholarly projects mentioned.

---

SUBJECTIVITY RULE:
If the applicant's text includes context of adversity (e.g., working while studying, self-supporting student, coming from an underprivileged/remote school), this is explicitly rewarded in Component B. Do not double-count. Be generous but honest.

FEW-SHOT EXAMPLES:

Example 1 (Perfect Candidate):
Input: "High School Batch Valedictorian for 4 straight years. Champion in National Math Olympiad. Worked as a vendor to support studies. President of Science Club."
Output: {{
  "score": 20,
  "breakdown": {{
    "core_achievement": 5,
    "adversity": 5,
    "sustained_excellence": 5,
    "initiative_rigor": 5
  }},
  "reason": "Awarded 5/5 for Valedictorian peak achievement, 5/5 for overcoming work-study adversity, 5/5 for 4-year sustained excellence, and 5/5 for National Math Olympiad champion and Science Club leadership. Perfect 20/20."
}}

Example 2 (High Achiever, No Context):
Input: "Cum Laude graduate from Ateneo de Manila University. Dean's Lister for 1 semester."
Output: {{
  "score": 7,
  "breakdown": {{
    "core_achievement": 3,
    "adversity": 0,
    "sustained_excellence": 1,
    "initiative_rigor": 0
  }},
  "reason": "Awarded 3/5 for Cum Laude, 0/5 for no adversity, 1/5 for single-semester Dean's List, and 0/5 for no scholarly initiative. Total: 7/20."
}}

Example 3 (Mid Honors, High Initiative, Some Adversity):
Input: "With High Honors (GWA 96) for 2 consecutive years. 1st Place in Division Science Fair. First-generation college student. President of Math Club."
Output: {{
  "score": 14,
  "breakdown": {{
    "core_achievement": 2,
    "adversity": 3,
    "sustained_excellence": 3,
    "initiative_rigor": 4
  }},
  "reason": "Awarded 2/5 for With High Honors, 3/5 for first-generation college student adversity, 3/5 for 2-year sustained excellence, and 4/5 for Division Science Fair champion and Math Club leadership. Total: 14/20."
}}

Example 4 (No Achievements):
Input: "Regular student, no awards or honors."
Output: {{
  "score": 0,
  "breakdown": {{
    "core_achievement": 0,
    "adversity": 0,
    "sustained_excellence": 0,
    "initiative_rigor": 0
  }},
  "reason": "No academic honors, adversity, sustained performance, or scholarly initiative mentioned. Score: 0/20."
}}

---

NOW EVALUATE THIS APPLICANT:
Input Text: \"\"\"{merits_text}\"\"\"

Return ONLY a valid JSON object. No markdown, no extra text.
{{
  "score": <total 0-20>,
  "breakdown": {{
    "core_achievement": <0-5>,
    "adversity": <0-5>,
    "sustained_excellence": <0-5>,
    "initiative_rigor": <0-5>
  }},
  "reason": "<2-sentence qualitative review explaining the allocation>"
}}"""
            
            payload = {
                "contents": [{
                    "parts": [{"text": prompt}]
                }],
                "generationConfig": {
                    "responseMimeType": "application/json"
                }
            }
            response = requests.post(url, json=payload, timeout=5)
            if response.status_code == 200:
                res_data = response.json()
                text = res_data['candidates'][0]['content']['parts'][0]['text']
                parsed = json.loads(text.strip())
                if 'score' in parsed:
                    score = int(parsed['score'])
                elif 'breakdown' in parsed and isinstance(parsed['breakdown'], dict):
                    score = sum(int(v) for v in parsed['breakdown'].values() if isinstance(v, (int, float)))
                else:
                    score = 0
                score = max(0, min(20, score))
                reason = str(parsed.get('reason', 'Evaluated by AI based on holistic merit profile.'))
                # Cache the AI result so we don't re-call for the same text
                ai_result = (score, reason)
                if len(_MERIT_EVAL_CACHE) >= _MERIT_EVAL_CACHE_MAX:
                    try:
                        del _MERIT_EVAL_CACHE[next(iter(_MERIT_EVAL_CACHE))]
                    except StopIteration:
                        pass
                _MERIT_EVAL_CACHE[cache_key] = ai_result
                return ai_result
            else:
                print(f"[AI MERITS ERROR] API call returned status {response.status_code}: {response.text}", flush=True)
        except Exception as e:
            print(f"[AI MERITS ERROR] API call failed: {e}", flush=True)

    # Calibrated rule-based academic evaluation fallback
    result = base_score, base_reason
    # Store in cache (evict oldest entry if at max capacity)
    if len(_MERIT_EVAL_CACHE) >= _MERIT_EVAL_CACHE_MAX:
        try:
            del _MERIT_EVAL_CACHE[next(iter(_MERIT_EVAL_CACHE))]
        except StopIteration:
            pass
    _MERIT_EVAL_CACHE[cache_key] = result
    return result

@api_bp.route('/test-ai', methods=['GET'])
def test_ai():
    import os
    merit_text = request.args.get('merits', 'Valedictorian')
    score, reason = analyze_merits_onthefly(merit_text)
    return jsonify({
        'status': 'success',
        'merit_tested': merit_text,
        'ai_score': score,
        'ai_reason': reason,
        'api_key_exists': bool(os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY'))
    })

@api_bp.route('/applicants/<program>', methods=['GET'])
@api_bp.route('/admin/applicants/<program>', methods=['GET'])
@token_required
def get_applicants(current_user_id, pro_no, role, program):
    """Get applicants for a program"""
    try:
        print(f"[APPLICANTS API] Loading applicants for program='{program}', role='{role}', pro_no='{pro_no}'", flush=True)
        filters = request.args
        conn = get_db()
        cursor = conn.cursor()
        applicant_email_table = get_applicant_email_table(cursor)
        document_join = applicant_document_join_sql(cursor, 'a', 'ad')
        profile_picture_expr = '(a.profile_picture IS NOT NULL)' if applicant_has_column(cursor, 'profile_picture') else 'FALSE'
        
        query = f'''
            SELECT a.applicant_no as id, a.applicant_no, a.first_name as "firstName", a.last_name as "lastName", 
                   a.middle_name as "middleName",
                   a.mother_name as "motherName",
                   a.father_name as "fatherName",
                   a.merits_awards_received as "meritsAwardsReceived",
                   a.first_name as name, a.overall_gpa as grade,
                   a.financial_income_of_parents as income, CONCAT_WS(', ', NULLIF(a.street_brgy, ''), NULLIF(a.town_city_municipality, ''), NULLIF(a.province, ''), NULLIF(a.zip_code, '')) as location,
                   a.maiden_name as "maidenName",
                   a.street_brgy as "streetBrgy",
                   a.street_brgy as street_brgy,
                   a.town_city_municipality as municipality,
                   a.town_city_municipality as town_city_municipality,
                   a.province,
                   a.zip_code as "zipCode",
                   a.birthdate as dob,
                   a.birth_place as "pob",
                   a.sex,
                   a.course,
                   a.school,
                   a.school_id_no, a.school_id_no as "schoolId",
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
                   a.school_address as "schoolAddress",
                   s.is_accepted, s.scholarship_no as "scholarshipNo", p.provider_name as program,
                   e.email_address as email,
                   CASE 
                       WHEN s.is_accepted = 'Accepted' THEN 'Accepted'
                       WHEN s.is_accepted = 'Rejected' THEN 'Rejected'
                       WHEN s.is_accepted = 'Cancelled' THEN 'Cancelled'
                       ELSE 'Pending'
                   END as status,
                   esc.scholarship_name as "scholarshipName",
                   COALESCE(s.created_at, s.status_updated) as "createdAt",
                   COALESCE(s.created_at, s.status_updated) as "dateApplied",
                   s.created_at as "status_created_at",
                   s.created_at as "created_at",
                   ({applicant_document_expr(cursor, 'indigency_doc', 'a', 'ad')} IS NOT NULL) as "has_indigency_doc",
                   ({applicant_document_expr(cursor, 'enrollment_certificate_doc', 'a', 'ad')} IS NOT NULL) as "has_enrollment_certificate_doc",
                   ({applicant_document_expr(cursor, 'grades_doc', 'a', 'ad')} IS NOT NULL) as "has_grades_doc",
                   ({applicant_document_expr(cursor, 'schoolID_photo', 'a', 'ad')} IS NOT NULL) as "has_schoolID_photo",
                   ({applicant_document_expr(cursor, 'id_img_front', 'a', 'ad')} IS NOT NULL) as "has_id_img_front",
                   ({applicant_document_expr(cursor, 'id_img_back', 'a', 'ad')} IS NOT NULL) as "has_id_img_back",
                   ({applicant_document_expr(cursor, 'id_pic', 'a', 'ad')} IS NOT NULL) as "has_id_pic",
                   {profile_picture_expr} as "has_profile_picture",
                   ({applicant_document_expr(cursor, 'signature_image_data', 'a', 'ad')} IS NOT NULL) as "has_signature",
                   {applicant_document_expr(cursor, 'indigency_vid_url', 'a', 'ad')} as indigency_vid_url,
                   {applicant_document_expr(cursor, 'enrollment_certificate_vid_url', 'a', 'ad')} as enrollment_certificate_vid_url,
                   {applicant_document_expr(cursor, 'grades_vid_url', 'a', 'ad')} as grades_vid_url,
                   {applicant_document_expr(cursor, 'schoolid_front_vid_url', 'a', 'ad')} as schoolid_front_vid_url,
                   {applicant_document_expr(cursor, 'schoolid_back_vid_url', 'a', 'ad')} as schoolid_back_vid_url
            FROM applicants a
            INNER JOIN applicant_status s ON a.applicant_no = s.applicant_no
            INNER JOIN scholarships esc ON s.scholarship_no = esc.req_no
            INNER JOIN scholarship_providers p ON esc.pro_no = p.pro_no
            LEFT JOIN {applicant_email_table} e ON a.applicant_no = e.applicant_no
            {document_join}
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
            query += " AND s.is_accepted = 'Accepted'"
        
        if filters.get('search'):
            query += ' AND (a.first_name ILIKE %s OR a.last_name ILIKE %s OR e.email_address ILIKE %s)'
            search_term = f"%{filters['search']}%"
            params.extend([search_term, search_term, search_term])
        
        # Add Pagination if explicitly requested by client
        if filters.get('limit'):
            limit = int(filters.get('limit'))
            offset = int(filters.get('offset', 0))
            query += ' ORDER BY COALESCE(s.created_at, s.status_updated) DESC NULLS LAST, a.applicant_no DESC LIMIT %s OFFSET %s'
            params.extend([limit, offset])
        else:
            query += ' ORDER BY COALESCE(s.created_at, s.status_updated) DESC NULLS LAST, a.applicant_no DESC'
        
        # Note: filters.get('status') ignored because table schema does not properly match it yet
        
        cursor.execute(query, params)
        applicants = cursor.fetchall()

        # Fetch 1NF merit_proofs for all returned applicants in batch
        merit_proofs_by_app = {}
        if applicants:
            try:
                app_ids = [
                    (row['id'] if isinstance(row, dict) and 'id' in row else (row['applicant_no'] if isinstance(row, dict) else row[0]))
                    for row in applicants
                ]
                app_ids = [aid for aid in app_ids if aid is not None]
                if app_ids:
                    cursor.execute("""
                        SELECT merit_id, applicant_no, merit_document, merit_title, created_at
                        FROM merit_proofs
                        WHERE applicant_no = ANY(%s)
                        ORDER BY merit_id ASC
                    """, (app_ids,))
                    mp_rows = cursor.fetchall()
                    for mp in mp_rows:
                        mp_dict = normalize_json_object(dict(mp))
                        a_no = mp_dict.get('applicant_no')
                        if a_no not in merit_proofs_by_app:
                            merit_proofs_by_app[a_no] = []
                        merit_proofs_by_app[a_no].append(mp_dict)
            except Exception as mp_err:
                print(f"[APPLICANTS API] Warning querying merit_proofs in batch: {mp_err}", flush=True)

        cursor.close()
        conn.close()
        print(f"[APPLICANTS API] Query returned {len(applicants)} rows for program='{program}'", flush=True)
        
        # Convert rows to plain dicts and provide URLs for binary data
        result = []
        for row in applicants:
            try:
                a = normalize_json_object(dict(row))
                app_no = a['id'] # 'id' is aliased from 'applicant_no'

                # Resolve profile picture URL
                if a.get('has_profile_picture'):
                    a['profile_picture'] = url_for('admin_api.get_applicant_image', applicant_no=app_no, column_name='profile_picture', _external=True)
                else:
                    a['profile_picture'] = None

                # Resolve face verification photo (id_pic)
                if a.get('has_id_pic'):
                    a['id_pic'] = url_for('admin_api.get_applicant_image', applicant_no=app_no, column_name='id_pic', _external=True)
                else:
                    a['id_pic'] = None

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
                
                # Include ID Front, ID Back images and their verification videos in idFiles
                id_files = []
                if a.get('has_id_img_front'):
                    id_files.extend(get_applicant_media_metadata(app_no, 'id_img_front', True, None, "ID Front"))
                if a.get('schoolid_front_vid_url'):
                    id_files.extend(get_applicant_media_metadata(app_no, 'schoolid_front_vid_url', True, a.get('schoolid_front_vid_url'), "ID Front Video"))
                
                if a.get('has_id_img_back'):
                    id_files.extend(get_applicant_media_metadata(app_no, 'id_img_back', True, None, "ID Back"))
                if a.get('schoolid_back_vid_url'):
                    id_files.extend(get_applicant_media_metadata(app_no, 'schoolid_back_vid_url', True, a.get('schoolid_back_vid_url'), "ID Back Video"))
                
                a['idFiles'] = id_files

                # Fill in ID# with school_id_no
                a['idNumber'] = a.get('school_id_no') or a.get('schoolId')

                # Merit proofs from merit_proofs table (1NF)
                a_merit_proofs = merit_proofs_by_app.get(app_no, [])
                a['merit_proofs'] = a_merit_proofs
                merit_files = []
                for idx, mp in enumerate(a_merit_proofs):
                    doc_val = mp.get('merit_document')
                    m_title = mp.get('merit_title') or f"Merit #{idx+1}"
                    if doc_val:
                        merit_files.append({
                            'src': doc_val,
                            'type': 'image/jpeg',
                            'name': m_title,
                            'title': m_title,
                            'id': mp.get('merit_id')
                        })
                a['meritFiles'] = merit_files
                
                # AI merits evaluation calculated purely in memory (on-the-fly) without saving to DB
                merits_text = a.get('meritsAwardsReceived') or ""
                m_score, m_reason = analyze_merits_onthefly(merits_text)
                a['meritScore'] = m_score
                a['meritReason'] = m_reason
                
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
            '''SELECT ast.is_accepted, s.slots, s.pro_no, s.scholarship_name
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

        if status_row['slots'] is not None and status_row['is_accepted'] != 'Accepted':
            cursor.execute(
                '''SELECT COUNT(*) AS accepted_count
                   FROM applicant_status
                   WHERE scholarship_no = %s AND is_accepted = 'Accepted' ''',
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
               SET is_accepted = 'Accepted', status_updated = CURRENT_DATE
               WHERE applicant_no = %s AND scholarship_no = %s''',
            (applicant_no, scholarship_no)
        )

        # Auto-decline other applications for the same applicant
        cursor.execute(
            "SELECT s.scholarship_name, s.req_no FROM applicant_status ast JOIN scholarships s ON ast.scholarship_no = s.req_no WHERE ast.applicant_no = %s AND ast.scholarship_no != %s AND (ast.is_accepted IS NULL OR ast.is_accepted = 'Pending' OR ast.is_accepted = 'Accepted')",
            (applicant_no, scholarship_no)
        )
        declined_scholarships = cursor.fetchall()
        
        cursor.execute(
            """
            UPDATE applicant_status
            SET is_accepted = 'Rejected'
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

        try:
            create_notification(
                user_no=applicant_no,
                title='Application Accepted',
                message=f"Congratulations! We are pleased to inform you that your application for {status_row['scholarship_name']} has been accepted.",
                notif_type='result'
            )
            # Notify the student portal and admin dashboards instantly via socket
            safe_emit('notification_update', {'user_no': applicant_no}, broadcast=True)
            safe_emit('applicant_status_update', {
                'applicant_no': applicant_no,
                'applicantId': applicant_no,
                'scholarship_no': scholarship_no,
                'status': 'Accepted',
                'newStatus': 'Accepted',
                'is_accepted': 'Accepted',
                'program': status_row.get('pro_no')
            }, broadcast=True)
            safe_emit('account_change', {'type': 'applicant_status_accepted', 'applicant_no': applicant_no}, broadcast=True)
        except Exception as notif_err:
            print(f"[NOTIF ERROR] Failed to notify accepted applicant {applicant_no}: {notif_err}", flush=True)

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
            '''SELECT s.pro_no, s.scholarship_name
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
               SET is_accepted = 'Rejected', status_updated = CURRENT_DATE
               WHERE applicant_no = %s AND scholarship_no = %s''',
            (applicant_no, scholarship_no)
        )
        conn.commit()

        try:
            create_notification(
                user_no=applicant_no,
                title='Application Declined',
                message=f"Thank you for your interest in {status_row['scholarship_name']}. We regret to inform you that your application has been declined.",
                notif_type='result'
            )
            safe_emit('notification_update', {'user_no': applicant_no}, broadcast=True)
            safe_emit('applicant_status_update', {
                'applicant_no': applicant_no,
                'applicantId': applicant_no,
                'scholarship_no': scholarship_no,
                'status': 'Rejected',
                'newStatus': 'Rejected',
                'is_accepted': 'Rejected',
                'program': status_row.get('pro_no')
            }, broadcast=True)
            safe_emit('account_change', {'type': 'applicant_status_declined', 'applicant_no': applicant_no}, broadcast=True)
        except Exception as notif_err:
            print(f"[NOTIF ERROR] Failed to notify declined applicant {applicant_no}: {notif_err}", flush=True)

        cursor.close()
        conn.close()
        
        return jsonify({'success': True, 'message': 'Applicant declined'}), 200
    
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500

@api_bp.route('/applicants/<int:applicant_no>/revert', methods=['POST'])
@token_required
def revert_applicant(current_user_id, pro_no, role, applicant_no):
    """Revert an applicant back to pending status"""
    try:
        data = request.get_json(silent=True) or {}
        scholarship_no = data.get('scholarshipNo')
        if scholarship_no is None:
            return jsonify({'success': False, 'message': 'scholarshipNo is required'}), 400

        conn = get_db()
        cursor = conn.cursor()

        cursor.execute(
            '''SELECT s.pro_no, s.scholarship_name
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
        
        # Update applicant status back to Pending (NULL)
        cursor.execute(
            '''UPDATE applicant_status 
               SET is_accepted = NULL, status_updated = CURRENT_DATE
               WHERE applicant_no = %s AND scholarship_no = %s''',
            (applicant_no, scholarship_no)
        )
        conn.commit()

        try:
            safe_emit('notification_update', {'user_no': applicant_no}, broadcast=True)
            safe_emit('applicant_status_update', {
                'applicant_no': applicant_no,
                'applicantId': applicant_no,
                'scholarship_no': scholarship_no,
                'status': 'Pending',
                'newStatus': 'Pending',
                'is_accepted': None,
                'program': status_row.get('pro_no')
            }, broadcast=True)
            safe_emit('account_change', {'type': 'applicant_status_reverted', 'applicant_no': applicant_no}, broadcast=True)
        except Exception as notif_err:
            print(f"[NOTIF ERROR] Failed to emit revert for applicant {applicant_no}: {notif_err}", flush=True)

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
        
        # Auto-ensure required columns exist in scholarships table if missing
        try:
            cursor.execute("ALTER TABLE scholarships ADD COLUMN IF NOT EXISTS units INTEGER")
            cursor.execute("ALTER TABLE scholarships ADD COLUMN IF NOT EXISTS residency_doc_type VARCHAR(100) DEFAULT 'Indigency Document'")
            cursor.execute("ALTER TABLE scholarships ADD COLUMN IF NOT EXISTS id_type VARCHAR(100) DEFAULT 'School ID'")
            cursor.execute("ALTER TABLE scholarships ADD COLUMN IF NOT EXISTS course VARCHAR(255)")
            cursor.execute("ALTER TABLE scholarships ADD COLUMN IF NOT EXISTS program_type VARCHAR(100)")
            cursor.execute("ALTER TABLE scholarships ADD COLUMN IF NOT EXISTS grades_sem VARCHAR(50)")
            cursor.execute("ALTER TABLE scholarships ADD COLUMN IF NOT EXISTS grades_year VARCHAR(50)")
        except Exception as schema_err:
            print(f"[SCHEMA AUTO-MIGRATION WARNING]: {schema_err}")

        units_val = int(data.get('units')) if data.get('units') not in (None, '', 'null') else None
        res_doc_type = data.get('residencyDocType', 'Indigency Document')
        id_type_val = data.get('idType', 'School ID')

        # 2. Insert into scholarships table (without images)
        cursor.execute('''
            INSERT INTO scholarships (scholarship_name, gpa, parent_finance, location, pro_no, slots, deadline, "desc", semester, year, grades_sem, grades_year, course, program_type, units, residency_doc_type, id_type, date_created)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            RETURNING req_no
        ''', (
            data.get('scholarshipName'),
            data.get('minGpa'),
            data.get('parentFinance'),
            data.get('location'),
            target_pro_no,
            data.get('slots'),
            data.get('deadline'),
            data.get('description', ''),
            data.get('semester', ''),
            data.get('year', ''),
            data.get('grades_sem', ''),
            data.get('grades_year', ''),
            data.get('course', 'All'),
            data.get('program_type', 'All'),
            units_val,
            res_doc_type,
            id_type_val
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

        safe_emit('scholarship_update', {
            'action': 'create',
            'req_no': req_no,
            'scholarship_name': data.get('scholarshipName'),
            'program': provider_label,
            'pro_no': target_pro_no
        }, broadcast=True)
        safe_emit('scholarship_change', {'action': 'create', 'req_no': req_no}, broadcast=True)
        safe_emit('account_change', {'type': 'scholarship_create'}, broadcast=True)
        
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
             
        # Auto-ensure required columns exist in scholarships table if missing
        try:
            cursor.execute("ALTER TABLE scholarships ADD COLUMN IF NOT EXISTS units INTEGER")
            cursor.execute("ALTER TABLE scholarships ADD COLUMN IF NOT EXISTS residency_doc_type VARCHAR(100) DEFAULT 'Indigency Document'")
            cursor.execute("ALTER TABLE scholarships ADD COLUMN IF NOT EXISTS id_type VARCHAR(100) DEFAULT 'School ID'")
            cursor.execute("ALTER TABLE scholarships ADD COLUMN IF NOT EXISTS course VARCHAR(255)")
            cursor.execute("ALTER TABLE scholarships ADD COLUMN IF NOT EXISTS program_type VARCHAR(100)")
            cursor.execute("ALTER TABLE scholarships ADD COLUMN IF NOT EXISTS grades_sem VARCHAR(50)")
            cursor.execute("ALTER TABLE scholarships ADD COLUMN IF NOT EXISTS grades_year VARCHAR(50)")
        except Exception as schema_err:
            print(f"[SCHEMA AUTO-MIGRATION WARNING]: {schema_err}")

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
            'semester': 'semester',
            'grades_sem': 'grades_sem',
            'grades_year': 'grades_year',
            'course': 'course',
            'program_type': 'program_type',
            'units': 'units',
            'residencyDocType': 'residency_doc_type',
            'idType': 'id_type'
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

        safe_emit('scholarship_update', {
            'action': 'update',
            'req_no': req_no,
            'scholarship_name': data.get('scholarshipName', sch_row.get('scholarship_name')),
            'program': display_provider_name,
            'pro_no': resolved_provider_no
        }, broadcast=True)
        safe_emit('scholarship_change', {'action': 'update', 'req_no': req_no}, broadcast=True)
        safe_emit('account_change', {'type': 'scholarship_update'}, broadcast=True)
        
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
        
        # Remove active in-app notifications for this deleted scholarship
        try:
            cursor.execute(
                """
                DELETE FROM notifications
                WHERE type = 'scholarship'
                  AND (title ILIKE %s OR message ILIKE %s)
                """,
                (f"%{scholarship_name}%", f"%{scholarship_name}%")
            )
        except Exception as notif_del_err:
            print(f"[SCHOLARSHIP NOTIF DELETE WARN] {notif_del_err}", flush=True)

        conn.commit()
        record_admin_activity(
            actor_user_no=current_user_id,
            action='delete_scholarship',
            target_type='scholarship',
            target_id=req_no,
            target_label=scholarship_name,
            provider_no=resolved_provider_no,
        )

        safe_emit('scholarship_update', {
            'action': 'delete',
            'req_no': req_no,
            'scholarship_name': scholarship_name,
            'pro_no': resolved_provider_no
        }, broadcast=True)
        safe_emit('scholarship_change', {'action': 'delete', 'req_no': req_no}, broadcast=True)
        safe_emit('notification_update', {'type': 'scholarship', 'action': 'delete', 'req_no': req_no, 'title': scholarship_name}, broadcast=True)
        safe_emit('account_change', {'type': 'scholarship_delete'}, broadcast=True)
        
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
        primary_key_column, _ = get_entity_image_columns(cursor, entity='announcement')
        
        # Get image from database
        cursor.execute(f"SELECT img FROM announcement_images WHERE {primary_key_column} = %s", (image_id,))
        row = cursor.fetchone()
        cursor.close()
        conn.close()
        
        if not row or not row['img']:
            return jsonify({'message': 'Image not found'}), 404
            
        data = row['img']
        
        # --- CLOUD STORAGE REDIRECT ---
        if isinstance(data, str) and (data.startswith('http://') or data.startswith('https://')):
            from services.applicant_document_service import normalize_supabase_url
            normalized_url = normalize_supabase_url(data)
            print(f"[ANN IMAGE] Redirecting {image_id} to cloud URL: {normalized_url[:60]}...", flush=True)
            return redirect(normalized_url)

        encrypted_img = data
        
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
            
        data = row['img']
        
        # --- CLOUD STORAGE REDIRECT ---
        if isinstance(data, str) and (data.startswith('http://') or data.startswith('https://')):
            from services.applicant_document_service import normalize_supabase_url
            normalized_url = normalize_supabase_url(data)
            print(f"[ANN INDEX ENDPOINT] Redirecting {ann_no}/{idx} to cloud URL: {normalized_url[:60]}...", flush=True)
            return redirect(normalized_url)

        encrypted_img = data
        
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

def fetch_cloud_media_bytes(url):
    """Fetch cloud media bytes (Supabase or HTTP) using Service Role Key or Supabase SDK."""
    if not url or not isinstance(url, str) or not url.startswith('http'):
        return None
        
    normalized_url = normalize_supabase_url(url.strip())
    
    # 1. Try Supabase SDK download directly
    try:
        from project_config import get_supabase_client
        supabase = get_supabase_client()
        if supabase and 'supabase.co' in normalized_url:
            parts = normalized_url.split('/storage/v1/object/')
            if len(parts) > 1:
                subpath = parts[1]
                for prefix in ('public/', 'authenticated/', 'sign/'):
                    if subpath.startswith(prefix):
                        subpath = subpath[len(prefix):]
                        break
                if '/' in subpath:
                    bucket_name, file_path = subpath.split('/', 1)
                    file_path = file_path.split('?')[0]
                    res_bytes = supabase.storage.from_(bucket_name).download(file_path)
                    if res_bytes:
                        return res_bytes
    except Exception as sdk_err:
        print(f"[CLOUD MEDIA SDK] SDK download fallback triggered for {normalized_url}: {sdk_err}", flush=True)

    # 2. HTTP GET with Service Role Key / Anon Key
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ISKOMATS-AdminBackend/1.0'
    }
    
    url_to_fetch = normalized_url
    supabase_key = (
        os.environ.get('SUPABASE_SERVICE_ROLE_KEY') 
        or os.environ.get('SUPABASE_KEY') 
        or os.environ.get('SUPABASE_ANON_KEY')
    )
    if supabase_key and 'supabase.co' in url_to_fetch:
        headers['apikey'] = supabase_key
        headers['Authorization'] = f"Bearer {supabase_key}"

    urls_to_try = [url_to_fetch]
    if '/object/public/' in url_to_fetch:
        urls_to_try.insert(0, url_to_fetch.replace('/object/public/', '/object/authenticated/'))
    elif '/object/authenticated/' in url_to_fetch:
        urls_to_try.append(url_to_fetch.replace('/object/authenticated/', '/object/public/'))

    try:
        import requests
        for attempt_url in urls_to_try:
            resp = requests.get(attempt_url, headers=headers, timeout=20)
            if resp.status_code == 200 and resp.content:
                return resp.content
            print(f"[CLOUD MEDIA FETCH] HTTP {resp.status_code} for {attempt_url}", flush=True)
    except Exception as e:
        print(f"[CLOUD MEDIA FETCH] Error fetching {url_to_fetch}: {e}", flush=True)

    return None


@api_bp.route('/applicant-image/<int:applicant_no>/<column_name>', methods=['GET'])
def get_applicant_image(applicant_no, column_name):
    """Get applicant image or document as binary file on demand (Lazy Loading)"""
    allowed_columns = [
        'indigency_doc', 'enrollment_certificate_doc', 'grades_doc', 
        'schoolID_photo', 'id_img_front', 'id_img_back', 'id_pic', 'profile_picture',
        'signature_image_data',
        'id_vid_url', 'indigency_vid_url', 'grades_vid_url',
        'enrollment_certificate_vid_url', 'schoolid_front_vid_url', 'schoolid_back_vid_url'
    ]
    if column_name not in allowed_columns:
        return jsonify({'message': 'Invalid column name'}), 400
        
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            app_doc_no = request.args.get('app_doc_no')
            scholarship_no = request.args.get('scholarship_no')
            
            if app_doc_no in (None, '', 'null', 'undefined', 'None'):
                app_doc_no = None
            if scholarship_no in (None, '', 'null', 'undefined', 'None'):
                scholarship_no = None

            if not app_doc_no and scholarship_no:
                try:
                    status_cols = [c.lower() for c in get_table_columns(cursor, 'applicant_status')]
                    if 'app_doc_no' in status_cols:
                        cursor.execute("SELECT app_doc_no FROM applicant_status WHERE applicant_no = %s AND scholarship_no = %s LIMIT 1", (applicant_no, scholarship_no))
                        s_row = cursor.fetchone()
                        if s_row and (s_row.get('app_doc_no') if isinstance(s_row, dict) else s_row[0]):
                            app_doc_no = s_row.get('app_doc_no') if isinstance(s_row, dict) else s_row[0]
                except Exception as s_err:
                    print(f"[APPLICANT IMAGE] Non-fatal status lookup error: {s_err}", flush=True)

            row = fetch_applicant_document_values(cursor, applicant_no, [column_name], app_doc_no=app_doc_no)
        
            if not row or not row.get(column_name):
                return jsonify({'message': 'Image not found'}), 404
        
            data = row[column_name]
        
            if hasattr(data, 'tobytes'):
                data = data.tobytes()
            elif isinstance(data, memoryview):
                data = bytes(data)
        
        # --- CLOUD STORAGE & PROXY URL RESOLUTION ---
        if isinstance(data, str) and (data.startswith('http://') or data.startswith('https://')):
            # Check if this URL is a student proxy route pointing to another field
            if '/applicant/document/raw/' in data:
                try:
                    parts = data.split('/applicant/document/raw/')
                    if len(parts) > 1:
                        raw_field = parts[1].split('?')[0]
                        field_mapping = {
                            'face_video': 'id_vid_url',
                            'mayorIndigency_video': 'indigency_vid_url',
                            'mayorGrades_video': 'grades_vid_url',
                            'mayorCOE_video': 'enrollment_certificate_vid_url',
                            'schoolIdFront_video': 'schoolid_front_vid_url',
                            'schoolIdBack_video': 'schoolid_back_vid_url',
                            'id_front': 'id_img_front',
                            'id_back': 'id_img_back',
                            'face_photo': 'id_pic',
                        }
                        mapped_col = field_mapping.get(raw_field, raw_field)
                        if mapped_col in allowed_columns:
                            with get_db() as conn:
                                cursor = conn.cursor()
                                re_row = fetch_applicant_document_values(cursor, applicant_no, [mapped_col], app_doc_no=app_doc_no)
                                if re_row and re_row.get(mapped_col):
                                    real_val = re_row[mapped_col]
                                    if isinstance(real_val, str) and not ('/applicant/document/raw/' in real_val):
                                        data = real_val
                except Exception as ex:
                    print(f"[APPLICANT IMAGE] Proxy resolution error: {ex}", flush=True)

        if isinstance(data, str) and (data.startswith('http://') or data.startswith('https://')):
            return redirect(normalize_supabase_url(data), code=302)
            
        # Convert memoryview to bytes if needed
        if hasattr(data, 'tobytes'):
            data = data.tobytes()
        elif not isinstance(data, bytes):
            # If it's not bytes but we expect binary (and it's not a URL), attempt to treat it as such
            try:
                data = bytes(data)
            except (TypeError, ValueError):
                return jsonify({'message': 'Invalid data format in database'}), 500
            
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
@api_bp.route('/admin/announcements', methods=['GET'])
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

        announcement_columns = get_table_columns(cur, 'announcements')

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
            image_select=f"ai.{primary_key_column} AS image_id, ai.img AS announcement_image_data" if primary_key_column and foreign_key_column else "NULL AS image_id, NULL AS announcement_image_data",
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
                img_data_val = row_dict.get('announcement_image_data')
                
                # Check for cloud URL directly in result set
                from services.applicant_document_service import normalize_supabase_url
                if isinstance(img_data_val, str) and img_data_val.startswith('http'):
                    image_url = normalize_supabase_url(img_data_val)
                else:
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
@api_bp.route('/admin/announcements', methods=['POST'])
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

            def _upload_image(args):
                i, img_bytes = args
                file_path = f"ann_{ann_no}_img_{i}_{int(datetime.now().timestamp())}.jpg"
                url = upload_to_supabase(img_bytes, 'announcement_images', file_path)
                if not url:
                    raise ValueError(f"Failed to upload announcement image {i} to cloud storage bucket 'announcement_images'.")
                return url

            # Upload all images in parallel
            import concurrent.futures as _cf
            with _cf.ThreadPoolExecutor(max_workers=min(6, len(image_attachments))) as pool:
                uploaded_urls = list(pool.map(_upload_image, enumerate(image_attachments)))

            for url in uploaded_urls:
                cur.execute(
                    f"INSERT INTO announcement_images ({foreign_key_column}, img) VALUES (%s, %s)",
                    (ann_no, url)
                )

        conn.commit()

        run_background_task(
            record_admin_activity,
            actor_user_no=current_user_id,
            action='create_announcement',
            target_type='announcement',
            target_id=ann_no,
            target_label=title,
            provider_no=target_pro_no
        )

        safe_emit('announcement_update', {
            'action': 'create',
            'ann_no': ann_no,
            'title': title,
            'program': provider_name,
            'pro_no': target_pro_no
        }, broadcast=True)
        safe_emit('new_announcement', {
            'action': 'create',
            'ann_no': ann_no,
            'title': title,
            'content': message,
            'provider': provider_name,
            'pro_no': target_pro_no
        }, broadcast=True)
        
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
@api_bp.route('/admin/announcements/<int:ann_no>', methods=['PUT'])
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
    should_notify = data.get('notify', False) # New flag to prevent duplicate notifications
    
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

        # Optimized image update: Avoid downloading and re-uploading binary blobs
        # 1. Map existing images to their primary keys
        cur.execute(
            f"SELECT {primary_key_column} FROM announcement_images WHERE {foreign_key_column} = %s ORDER BY {primary_key_column}",
            (ann_no,)
        )
        existing_ids = [row[primary_key_column] for row in cur.fetchall()]
        
        # 2. Build instructions for the new sequence (either raw bytes or an existing ID)
        new_sequence = []
        
        # Process existing URLs and base64 from JSON
        if 'announcementImages' in data and isinstance(data['announcementImages'], list):
            for image_val in data['announcementImages']:
                url = image_val.get('url') if isinstance(image_val, dict) else image_val
                if not isinstance(url, str):
                    continue
                
                if url.startswith('data:'):
                    img_bytes = base64_to_bytes(url)
                    if img_bytes:
                        new_sequence.append(img_bytes)
                elif url.startswith('http'):
                    # Preserve existing cloud URLs
                    new_sequence.append(url)
                elif '/announcement-image/' in url:
                    try:
                        # Extract the index from the URL (last part of the path)
                        # Remove query params if any
                        clean_url = url.split('?')[0]
                        idx_str = clean_url.split('/')[-1]
                        idx = int(idx_str)
                        if 0 <= idx < len(existing_ids):
                            new_sequence.append(existing_ids[idx])
                    except:
                        pass
        
        # 3. Process new Multipart File Uploads
        if request.files:
            for file_key in sorted(request.files.keys()):
                if file_key.startswith('image_'):
                    file = request.files[file_key]
                    if file:
                        new_sequence.append(file.read())

        # 4. Sync image table — parallel upload of new images
        import concurrent.futures as _cf
        new_items_to_upload = [(i, item) for i, item in enumerate(new_sequence) if isinstance(item, bytes)]
        existing_items = [(i, item) for i, item in enumerate(new_sequence) if not isinstance(item, bytes)]

        def _upload_update_image(args):
            i, item = args
            file_path = f"ann_{ann_no}_upd_{i}_{int(datetime.now().timestamp())}.jpg"
            try:
                url = upload_to_supabase(item, 'announcement_images', file_path)
                if url:
                    return (i, url)
                # Fallback: store as base64 if upload fails
                b64 = base64.b64encode(item).decode('utf-8')
                return (i, f"data:image/jpeg;base64,{b64}")
            except Exception as e:
                print(f"[ANNOUNCEMENT UPDATE] Cloud upload error: {e}", flush=True)
                b64 = base64.b64encode(item).decode('utf-8')
                return (i, f"data:image/jpeg;base64,{b64}")

        # Upload new images in parallel
        uploaded = {}
        if new_items_to_upload:
            with _cf.ThreadPoolExecutor(max_workers=min(6, len(new_items_to_upload))) as pool:
                for idx, url in pool.map(_upload_update_image, new_items_to_upload):
                    uploaded[idx] = url

        # Build final ordered URL list matching new_sequence order
        cur.execute("CREATE TEMP TABLE temp_ann_imgs (seq INT, img text)")
        for i, item in enumerate(new_sequence):
            if isinstance(item, bytes):
                url = uploaded.get(i)
                if url:
                    cur.execute("INSERT INTO temp_ann_imgs (seq, img) VALUES (%s, %s)", (i, url))
            elif isinstance(item, str) and item.startswith('http'):
                cur.execute("INSERT INTO temp_ann_imgs (seq, img) VALUES (%s, %s)", (i, item))
            else:
                # Copy existing DB image by ID
                cur.execute(
                    f"INSERT INTO temp_ann_imgs (seq, img) SELECT %s, img FROM announcement_images WHERE {primary_key_column} = %s",
                    (i, item)
                )
        
        # Replace the original image set (ordered by seq)
        cur.execute(f"DELETE FROM announcement_images WHERE {foreign_key_column} = %s", (ann_no,))
        cur.execute(f"INSERT INTO announcement_images ({foreign_key_column}, img) SELECT %s, img FROM temp_ann_imgs ORDER BY seq", (ann_no,))
        cur.execute("DROP TABLE temp_ann_imgs")

        conn.commit()

        run_background_task(
            record_admin_activity,
            actor_user_no=current_user_id,
            action='update_announcement',
            target_type='announcement',
            target_id=ann_no,
            target_label=title,
            provider_no=resolved_provider_no
        )

        safe_emit('announcement_update', {
            'action': 'update',
            'ann_no': ann_no,
            'title': title,
            'program': target_provider_name,
            'pro_no': target_provider_no
        }, broadcast=True)

        if should_notify:
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
@api_bp.route('/admin/announcements/<int:ann_no>', methods=['DELETE'])
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
        
        # Remove active in-app notifications for this deleted announcement
        try:
            cur.execute(
                """
                DELETE FROM notifications
                WHERE type = 'announcement'
                  AND (title ILIKE %s OR message ILIKE %s)
                """,
                (f"%{title}%", f"%{title}%")
            )
        except Exception as notif_del_err:
            print(f"[ANNOUNCEMENT NOTIF DELETE WARN] {notif_del_err}", flush=True)

        conn.commit()
        
        record_admin_activity(
            actor_user_no=current_user_id,
            action='delete_announcement',
            target_type='announcement',
            target_id=ann_no,
            target_label=title,
            provider_no=resolved_provider_no
        )

        safe_emit('announcement_update', {
            'action': 'delete',
            'ann_no': ann_no,
            'title': title,
            'pro_no': resolved_provider_no
        }, broadcast=True)
        safe_emit('notification_update', {'type': 'announcement', 'action': 'delete', 'ann_no': ann_no, 'title': title}, broadcast=True)
        
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
