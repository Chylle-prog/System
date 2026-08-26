import sys
import os
import re
import json
import time
from decimal import Decimal
from flask import Blueprint, request, jsonify, send_file, url_for, session
from flask_bcrypt import Bcrypt
from werkzeug.security import check_password_hash as werkzeug_check_password_hash
import functools
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
import traceback
import threading
from services.applicant_document_service import normalize_supabase_url

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

def safe_invalidate_public_caches():
    """Immediately clears in-memory public caches (announcements and scholarships) on data mutation."""
    try:
        from blueprints.student_api import invalidate_public_caches
        invalidate_public_caches()
    except Exception as _e:
        print(f"[CACHE] Could not invalidate public caches: {_e}", flush=True)

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_DIR not in sys.path:
    sys.path.append(PROJECT_DIR)

from flask import Blueprint, request, jsonify, send_file, url_for, session, current_app
api_bp = Blueprint('admin_api', __name__, url_prefix='/api/admin')

@api_bp.record_once
def on_blueprint_init(state):
    """Run migrations once when the app starts up and register global message endpoints."""
    app = state.app
    with app.app_context():
        try:
            from project_config import get_db
            with get_db() as conn:
                cur = conn.cursor()
                ensure_schema_integrity(cur)
                ensure_admin_activity_log_table(cur)
                conn.commit()
                cur.close()
                print("[BACKEND] Admin schema initialization complete.")
        except Exception as e:
            print(f"[BACKEND] Admin schema migration skipped or failed: {e}")

    try:
        app.add_url_rule('/api/messages/all', 'global_get_all_messages', get_all_messages_rest, methods=['GET'])
        app.add_url_rule('/api/messages/provider/<int:pro_no>', 'global_get_provider_messages', get_all_messages_rest, methods=['GET'])
        app.add_url_rule('/api/messages/<path:room_id>', 'global_handle_room_messages', handle_room_messages_rest, methods=['GET', 'POST'])
        print("[BACKEND] Registered global /api/messages REST endpoints.")
    except Exception as e:
        print(f"[BACKEND] Error registering global message rules: {e}")

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
    normalize_supabase_url
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
    
    # ALWAYS use the proxy endpoint if encryption is available to ensure decryption
    # This allows the server to fetch from Supabase (even if it's a URL) and decrypt before serving.
    if _fernet:
        return [{
            'src': url_for('admin_api.get_applicant_image', applicant_no=applicant_no, column_name=column_name, _external=True),
            'type': media_type,
            'name': f"{name} (Secure Proxy)"
        }]

    if is_video and data_value:
        # Fallback for unencrypted videos
        return [{
            'src': normalize_supabase_url(data_value),
            'type': media_type,
            'name': f"{name}"
        }]
    elif not is_video:
        # Fallback for unencrypted images
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
TOKEN_EXPIRY = 720  # hours (30 days)
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
        elif brand in [b'mp41', b'mp42', b'isom', b'avc1']:
            return 'video/mp4'
        elif brand == b'qt  ':
            return 'video/quicktime'
    # Matroska / WebM
    elif data[:4] == b'\x1a\x45\xdf\xa3':
        return 'video/webm'
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

    # 2. Scholarship specific fields
    scholarship_cols = {
        'semester': 'VARCHAR(50)',
        'year': 'VARCHAR(50)',
        'grades_sem': 'VARCHAR(50)',
        'grades_year': 'VARCHAR(50)',
        'course': 'VARCHAR(255)',
        'program_type': 'VARCHAR(100)',
        'units': 'INTEGER',
        'residency_doc_type': 'VARCHAR(100)',
        'id_type': 'VARCHAR(100)'
    }
    for col, col_type in scholarship_cols.items():
        cursor.execute(
            """
            SELECT data_type
            FROM information_schema.columns
            WHERE table_name = 'scholarships' AND column_name = %s
            """,
            (col,)
        )
        res = cursor.fetchone()
        if not res:
            print(f"[MIGRATION] Adding {col} to scholarships table")
            cursor.execute(f"ALTER TABLE scholarships ADD COLUMN {col} {col_type}")
        else:
            current_type = (res['data_type'] if isinstance(res, dict) else res[0]).lower()
            if 'int' in current_type:
                print(f"[MIGRATION] Converting scholarships.{col} from {current_type} to {col_type}")
                try:
                    cursor.execute(f"ALTER TABLE scholarships ALTER COLUMN {col} TYPE {col_type} USING {col}::text")
                except Exception as e:
                    print(f"[MIGRATION WARNING] Failed to convert scholarships.{col}: {e}")
    
    # 3. Add jwt_token and verification_timestamp columns to applicants table if missing
    applicant_extra_cols = {
        'jwt_token': 'TEXT',
        'verification_timestamp': 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
        'units': 'INTEGER'
    }
    for col, col_type in applicant_extra_cols.items():
        cursor.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'applicants' AND column_name = %s
            """,
            (col,)
        )
        if not cursor.fetchone():
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
    """Ensure email tables have verification and lock columns for admin and applicant accounts"""
    try:
        conn = get_db_startup()
        cur = conn.cursor()
        user_email_table = get_user_email_table(cur)
        applicant_email_table = get_applicant_email_table(cur)
        
        # Check user_email columns
        cur.execute("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = %s AND column_name IN ('is_verified', 'verification_code', 'is_locked')
        """, (user_email_table,))
        existing_user = [row['column_name'] for row in cur.fetchall()]
        
        if 'is_verified' not in existing_user:
            print(f"[MIGRATION] Adding is_verified to {user_email_table}")
            cur.execute(f"ALTER TABLE {user_email_table} ADD COLUMN is_verified BOOLEAN DEFAULT FALSE")
            cur.execute(f"UPDATE {user_email_table} SET is_verified = TRUE")
        
        if 'verification_code' not in existing_user:
            print(f"[MIGRATION] Adding verification_code to {user_email_table}")
            cur.execute(f"ALTER TABLE {user_email_table} ADD COLUMN verification_code VARCHAR(10)")

        if 'is_locked' not in existing_user:
            print(f"[MIGRATION] Adding is_locked to {user_email_table}")
            cur.execute(f"ALTER TABLE {user_email_table} ADD COLUMN is_locked BOOLEAN DEFAULT FALSE")

        # Check applicant_email columns
        cur.execute("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = %s AND column_name = 'is_locked'
        """, (applicant_email_table,))
        existing_app = [row['column_name'] for row in cur.fetchall()]

        if 'is_locked' not in existing_app:
            print(f"[MIGRATION] Adding is_locked to {applicant_email_table}")
            cur.execute(f"ALTER TABLE {applicant_email_table} ADD COLUMN is_locked BOOLEAN DEFAULT FALSE")
        
        conn.commit()
        cur.close()
        conn.close()
        print("[MIGRATION] Email table verification and lock columns ensured")
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
            with get_db() as conn:
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
                    cursor = None
                    conn = None
                    return jsonify({'message': 'Account has been suspended. Please contact the administrator.', 'suspended': True}), 403
                
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
        
    result_bytes = None
    if hasattr(value, 'tobytes'):
        result_bytes = value.tobytes()
    elif isinstance(value, bytearray):
        result_bytes = bytes(value)
    elif isinstance(value, bytes):
        result_bytes = value
    elif isinstance(value, str):
        # Handle Base64 URL data
        if value.startswith('data:'):
            try:
                comma_idx = value.find(',')
                if comma_idx != -1:
                    result_bytes = base64.b64decode(value[comma_idx+1:])
            except Exception:
                pass
        
        # Handle HTTP URLs (Download)
        if not result_bytes and value.startswith('http'):
            try:
                # Use a timeout to prevent hanging the background thread indefinitely
                with urllib_request.urlopen(value, timeout=15) as response:
                    result_bytes = response.read()
            except Exception as download_error:
                print(f"[DOWNLOAD ERROR] Failed to fetch document from {value}: {download_error}", flush=True)
                # Fallback to returning the URL bytes if download fails
        
        # Fallback to UTF-8 encoding if it's just a string (not a URL)
        if not result_bytes:
            result_bytes = value.encode('utf-8', errors='replace')
    else:
        result_bytes = bytes(value)

    # Ensure we decrypt the binary bytes if they are encrypted
    if result_bytes:
        from services.crypto_service import decrypt_if_encrypted
        try:
            result_bytes = decrypt_if_encrypted(result_bytes)
        except Exception as e:
            print(f"[COERCE DECRYPT ERROR] Failed to decrypt: {e}", flush=True)

    return result_bytes


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


def send_gmail_message(receiver_email, subject, body, attachments=None):
    if not GMAIL_SENDER_EMAIL:
        raise RuntimeError('Gmail sender email is not configured.')

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
    """Send a password reset email via Google OAuth API / SMTP fallback."""
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

    msg = MIMEText(body)
    msg['Subject'] = 'Reset your ISKOMATS password'
    msg['From'] = GMAIL_SENDER_EMAIL
    msg['To'] = receiver_email

    return send_email_message(msg)


@api_bp.route('/applicants/<int:applicant_no>/school-verification', methods=['POST'])
@token_required
def send_school_verification_dispatch(current_user_id, pro_no, role, applicant_no):
    """Email school verification documents to the configured school contact in the background."""
    try:
        data = request.get_json(silent=True) or {}
        scholarship_no = data.get('scholarshipNo')
        if scholarship_no is None:
            return jsonify({'success': False, 'message': 'scholarshipNo is required'}), 400

        with get_db() as conn:
            cursor = conn.cursor()
            applicant_row = load_applicant_verification_context(cursor, applicant_no, scholarship_no)

            if not applicant_row:
                return jsonify({'success': False, 'message': 'Applicant record not found for this scholarship'}), 404

            if role != 'Admin' and applicant_row['pro_no'] != pro_no:
                return jsonify({'success': False, 'message': 'Unauthorized'}), 403

            school_email = resolve_school_verification_email(applicant_row.get('school'))
            if not school_email:
                return jsonify({
                    'success': False,
                    'message': f"No verification email is configured yet for {applicant_row.get('school') or 'this school'}. Currently only DLSL is supported.",
                }), 400

            applicant_name = build_applicant_full_name(applicant_row) or f"Applicant #{applicant_no}"
        
            # Clean up initial connection

            def _background_dispatch():
                try:
                    with get_db() as bg_conn:
                        bg_cursor = bg_conn.cursor()
                    
                        print(f"[BG_DISPATCH] Fetching documents for school verification: Applicant #{applicant_no}", flush=True)
                        document_values = fetch_applicant_document_values(
                            bg_cursor,
                            applicant_no,
                            ['enrollment_certificate_doc', 'grades_doc', 'id_img_front', 'id_img_back']
                        )

                        front_id = document_values.get('id_img_front')
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

        with get_db() as conn:
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
    """Send announcement emails to applicants via Gmail API (runs asynchronously with parallel worker threads)."""
    sender_email = (
        os.environ.get('GMAIL_SENDER_EMAIL')
        or os.environ.get('SMTP_SENDER_EMAIL')
        or os.environ.get('SMTP_EMAIL')
        or (globals().get('GMAIL_SENDER_EMAIL'))
    )
    if not sender_email:
        print("[EMAIL ERROR] Gmail sender email is not configured")
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
        
            if not applicants:
                print(f"[EMAIL INFO] No applicants found to send announcement, provider {provider_no}")
                return True
        
            print(f"[EMAIL BACKGROUND] Starting parallel email batch job for announcement - {len(applicants)} recipients", flush=True)
        
            provider_label = provider_name or 'ISKOMATS'
            access_token = fetch_google_access_token()
            if not access_token:
                print("[EMAIL ERROR] Failed to obtain access token for announcement email dispatch", flush=True)
                return False

            def send_single_email(applicant):
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
                    msg = MIMEText(body)
                    msg['Subject'] = f'{subject_prefix} {provider_label}'
                    msg['From'] = sender_email
                    msg['To'] = email_address
                    
                    raw_bytes = msg.as_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
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
                    
                    with urllib_request.urlopen(gmail_request, timeout=15) as response:
                        response.read()
                    return True
                except Exception as e:
                    print(f"[EMAIL ERROR] Failed to send to {applicant.get('email_address')}: {e}", flush=True)
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
    send_email_alerts=True,
    notification_title_prefix='New Announcement',
):
    log_path = os.path.join(os.getcwd(), 'announcement_dispatch.log')
    def log(msg):
        with open(log_path, 'a') as f:
            f.write(f"[{datetime.now()}] {msg}\n")
        print(msg, flush=True)

    log(f"[ANNOUNCEMENT NOTIF] Starting task: title='{title}', pro_no={provider_no}, all={send_to_all_applicants}")
    recipients = []
    try:
        log(f"[ANNOUNCEMENT NOTIF] Task started. send_to_all={send_to_all_applicants}, provider={provider_no}")
        with get_db() as conn:
            cur = conn.cursor()
            recipients = []
            if not send_to_all_applicants and provider_no:
                log(f"[ANNOUNCEMENT NOTIF] Mode: Provider-specific ({provider_no}).")
                cur.execute(
                    """
                    SELECT DISTINCT ast.applicant_no
                    FROM applicant_status ast
                    JOIN scholarships s ON ast.scholarship_no = s.req_no
                    WHERE s.pro_no = %s AND ast.applicant_no IS NOT NULL
                    """,
                    (provider_no,),
                )
                recipients = cur.fetchall()

            if not recipients:
                log("[ANNOUNCEMENT NOTIF] Fetching verified applicants as primary recipients.")
                applicant_email_table = get_applicant_email_table(cur)
                cur.execute(
                    f"SELECT DISTINCT applicant_no FROM {applicant_email_table} WHERE is_verified = TRUE AND applicant_no IS NOT NULL"
                )
                recipients = cur.fetchall()

            if not recipients:
                log("[ANNOUNCEMENT NOTIF] Fallback: Fetching all applicants from email table.")
                applicant_email_table = get_applicant_email_table(cur)
                cur.execute(
                    f"SELECT DISTINCT applicant_no FROM {applicant_email_table} WHERE applicant_no IS NOT NULL"
                )
                recipients = cur.fetchall()

            if not recipients:
                log("[ANNOUNCEMENT NOTIF] Secondary Fallback: Fetching all applicants from applicants table.")
                cur.execute(
                    "SELECT DISTINCT applicant_no FROM applicants WHERE applicant_no IS NOT NULL"
                )
                recipients = cur.fetchall()
            
        if not recipients:
            log(f"[ANNOUNCEMENT NOTIF WARNING] No recipients found for announcement.")
            return

        log(f"[ANNOUNCEMENT NOTIF] Found {len(recipients)} recipients. Bulk inserting in-app notifications...")
        
        provider_label = (provider_name or 'ISKOMATS').strip()
        notification_title = f"{notification_title_prefix}: {title}"
        notification_message = message[:100] + ('...' if len(message) > 100 else '')

        if provider_label and provider_label.lower() != 'iskomats':
            notification_message = f"{provider_label}: {notification_message}"

        # 1. Instant Bulk Insert for all recipients so they see it in real-time immediately
        app_ids = []
        for r in recipients:
            if hasattr(r, 'get'): a_no = r.get('applicant_no')
            elif isinstance(r, dict): a_no = r.get('applicant_no')
            else: a_no = r[0]
            if a_no: app_ids.append(a_no)

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
                    log(f"[ANNOUNCEMENT NOTIF] Bulk inserted {len(app_ids)} notifications successfully.")
                    safe_emit('notification_update', {'type': 'announcement', 'count': len(app_ids)}, broadcast=True)
                    safe_emit('new_notification', {'title': notification_title, 'message': notification_message, 'type': 'announcement'}, broadcast=True)
            except Exception as bulk_err:
                log(f"[ANNOUNCEMENT NOTIF BULK ERROR] {bulk_err}")

        email_success_count = 0
        email_failure_count = 0

        # 2. Asynchronous email delivery in background
        if send_email_alerts:
            GMAIL_SENDER_EMAIL = (
                os.environ.get('GMAIL_SENDER_EMAIL')
                or os.environ.get('SMTP_SENDER_EMAIL')
                or os.environ.get('SMTP_EMAIL')
                or 'iskomats@gmail.com'
            )
            for r in recipients:
                email = r.get('email_address') if hasattr(r, 'get') else (r['email_address'] if isinstance(r, dict) else None)
                if not email:
                    continue
                try:
                    msg = MIMEText(f"Hello,\n\nAn announcement has been posted:\n\n{title}\n\n{message}\n\nBest regards,\n{provider_label}")
                    msg['Subject'] = notification_title
                    msg['From'] = GMAIL_SENDER_EMAIL
                    msg['To'] = email
                    ok = send_email_message(msg)
                    if ok:
                        email_success_count += 1
                    else:
                        email_failure_count += 1
                    time.sleep(0.05)
                except Exception as inner_e:
                    log(f"[ANNOUNCEMENT EMAIL ERROR] Failed for {email}: {inner_e}")
                    email_failure_count += 1
                
        log(f"[ANNOUNCEMENT NOTIF] Task completed. Total Recipients: {len(recipients)}, Email Success: {email_success_count}, Failure: {email_failure_count}")

    except Exception as exc:
        log(f"[ANNOUNCEMENT NOTIF CRITICAL FAILURE] {exc}")
        import traceback
        traceback.print_exc()


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
        with get_db() as conn:
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
        print(f"[AUDIT] Failed to write admin activity log: {exc}", flush=True)

# ===== CHAT SOCKET EVENTS =====

def initialize_auto_chat_rooms():
    """Create initial chat rooms for all pending/accepted applicants and their providers"""
    conn = None
    try:
        # Use fast_startup=True to avoid blocking deploy if DB is slow
        conn = get_db(fast_startup=True)
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
            
        # Migration check: add new columns to existing table
        cursor.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'message'")
        existing_columns = [row['column_name'] for row in cursor.fetchall()]
        
        if 'sender_id' not in existing_columns:
            print("[MIGRATION] Adding missing column sender_id to message as INTEGER", flush=True)
            cursor.execute("ALTER TABLE message ADD COLUMN sender_id INTEGER")
            
        if 'is_student_sender' not in existing_columns:
            print("[MIGRATION] Adding missing column is_student_sender to message as BOOLEAN", flush=True)
            cursor.execute("ALTER TABLE message ADD COLUMN is_student_sender BOOLEAN")
            
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_message_app_pro ON message(applicant_no, pro_no)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_message_room ON message(room)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_message_timestamp ON message(timestamp)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_message_pro_no ON message(pro_no)")
            
        # Get all valid applicant-provider pairs
        # Using COALESCE for safer comparison of the 'is_accepted' text field
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
            
            # Check if room already has messages
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
        print(f"Chat initialization error: {e}", flush=True)
        print("Skipping automatic chat room initialization until the database becomes available.", flush=True)
    finally:
        if conn:
            try: conn.close()
            except: pass

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
            session['role'] = user_role
            session['user_id'] = user_id

            # Identify name and provider for chat
            with get_db() as conn:
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
                            WHERE s.pro_no = %s AND (ast.is_accepted = 'Pending' OR ast.is_accepted = 'Accepted' OR ast.is_accepted IS NULL)
                            UNION
                            SELECT DISTINCT m.applicant_no, m.pro_no
                            FROM message m
                            JOIN scholarships sch ON m.pro_no = sch.pro_no
                            LEFT JOIN applicant_status ast ON (m.applicant_no = ast.applicant_no AND ast.scholarship_no = sch.req_no)
                            WHERE m.pro_no = %s AND (ast.is_accepted = 'Pending' OR ast.is_accepted = 'Accepted' OR ast.is_accepted IS NULL)
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
                            WHERE m.room IS NOT NULL AND (ast.is_accepted = 'Pending' OR ast.is_accepted = 'Accepted' OR ast.is_accepted IS NULL)
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
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT first_name, last_name FROM applicants WHERE applicant_no = %s", (applicant_id,))
            app = cursor.fetchone()
            other_name = app['first_name'] if app else f"Applicant {applicant_id}"

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
            with get_db() as conn:
                cursor = conn.cursor()
                
                # Check if room follows app_no+pro_no format
                if '+' in room:
                    try:
                        app_no, pro_no = map(int, room.split('+'))
                        query = """
                            SELECT m.m_id, m.username, m.message, m.timestamp,
                                   m.sender_id, m.is_student_sender,
                                   COALESCE(ast.is_accepted, 'Pending') as student_status
                            FROM message m
                            LEFT JOIN LATERAL (
                                SELECT is_accepted
                                FROM applicant_status
                                WHERE applicant_no = m.applicant_no
                                LIMIT 1
                            ) ast ON TRUE
                            WHERE (m.room = %s OR (m.applicant_no = %s AND m.pro_no = %s))
                        """
                        params = [room, app_no, pro_no]

                        user_role = session.get('role')
                        if user_role == 'student':
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
                    except Exception:
                        query = """
                            SELECT m.m_id, m.username, m.message, m.timestamp,
                                   m.sender_id, m.is_student_sender, 'Pending' as student_status
                            FROM message m
                            WHERE m.room = %s
                        """
                        params = [room]
                else:
                    query = """
                        SELECT m.m_id, m.username, m.message, m.timestamp,
                               m.sender_id, m.is_student_sender, 'Pending' as student_status
                        FROM message m
                        WHERE m.room = %s
                    """
                    params = [room]
            
                query += " ORDER BY m.timestamp ASC LIMIT 200"
                cursor.execute(query, tuple(params))
                messages = cursor.fetchall()

                formatted_list = []
                for msg in messages:
                    fmt = {
                        'm_id': msg['m_id'],
                        'username': msg['username'],
                        'sender_id': msg['sender_id'],
                        'is_student_sender': msg['is_student_sender'],
                        'message': msg['message'],
                        'timestamp': msg['timestamp'].strftime('%Y-%m-%d %H:%M:%S') if hasattr(msg['timestamp'], 'strftime') else str(msg['timestamp']),
                        'room': room,
                        'student_status': msg.get('student_status', 'Pending')
                    }
                    formatted_list.append(fmt)

                emit('history', {
                    'room': room,
                    'messages': formatted_list
                })
        except Exception as e:
            print(f"[SOCKET HISTORY ERROR] Error loading history for room {room}: {e}")

    @socketio.on('message')
    def on_message(data):
        room = data.get('room')
        username = data.get('username')
        sender_id = data.get('sender_id')  # ID of who is sending (applicant_no or user_no)
        message_text = data.get('message')

        if not room or not message_text:
            print(f"Missing required fields: room={room}, message={message_text}")
            return

        try:
            app_no = None
            pro_no = None
            if '+' in room:
                try:
                    parts = room.split('+')
                    app_no = int(parts[0])
                    pro_no = int(parts[1])
                except Exception:
                    pass

            clean_sender_id = None
            if sender_id is not None:
                try:
                    clean_sender_id = int(sender_id)
                except (ValueError, TypeError):
                    clean_sender_id = app_no

            if not clean_sender_id and app_no:
                clean_sender_id = app_no
            
            with get_db() as conn:
                cursor = conn.cursor()
                sender_role = (session.get('role') or '').lower()
                is_student_sender = (sender_role == 'student') or (app_no is not None and str(clean_sender_id) == str(app_no))
            
                # Determine the sender's actual name from the database
                actual_username = username
            
                if is_student_sender and clean_sender_id:
                    cursor.execute("SELECT first_name FROM applicants WHERE applicant_no = %s", (clean_sender_id,))
                    applicant_sender = cursor.fetchone()
                    if applicant_sender and applicant_sender.get('first_name'):
                        actual_username = applicant_sender['first_name']
                    else:
                        actual_username = username or f"Applicant {clean_sender_id}"
                elif clean_sender_id:
                    cursor.execute("""
                        SELECT COALESCE(sp.provider_name, u.user_name) AS sender_name
                        FROM users u
                        LEFT JOIN scholarship_providers sp ON u.pro_no = sp.pro_no
                        WHERE u.user_no = %s
                        LIMIT 1
                    """, (clean_sender_id,))
                    admin_sender = cursor.fetchone()
                    if admin_sender and admin_sender.get('sender_name'):
                        actual_username = admin_sender['sender_name']
                    elif username:
                        actual_username = username
                    else:
                        actual_username = f"Admin {clean_sender_id}"
                else:
                    actual_username = username or "Admin"
            
                # Insert message into DB
                cursor.execute("""
                    INSERT INTO message (applicant_no, pro_no, room, username, message, timestamp, sender_id, is_student_sender)
                    VALUES (%s, %s, %s, %s, %s, NOW(), %s, %s)
                    RETURNING m_id, timestamp
                """, (app_no, pro_no, room, actual_username, message_text, clean_sender_id, is_student_sender))
                row = cursor.fetchone()
                m_id = row['m_id']
                timestamp = row['timestamp']
            
                student_status = 'Pending'
                if app_no:
                    cursor.execute("""
                        SELECT CASE 
                            WHEN is_accepted = 'Accepted' THEN 'Accepted'
                            WHEN is_accepted = 'Rejected' THEN 'Rejected'
                            WHEN is_accepted = 'Cancelled' THEN 'Cancelled'
                            ELSE 'Pending'
                        END as student_status
                        FROM applicant_status 
                        WHERE applicant_no = %s
                    """, (app_no,))
                    status_row = cursor.fetchone()
                    if status_row:
                        student_status = status_row['student_status']
            
                conn.commit()

                msg_payload = {
                    'm_id': m_id,
                    'username': actual_username,
                    'sender_id': clean_sender_id,
                    'is_student_sender': is_student_sender,
                    'message': message_text,
                    'room': room,
                    'timestamp': timestamp.strftime('%Y-%m-%d %H:%M:%S') if hasattr(timestamp, 'strftime') else str(timestamp),
                    'student_status': student_status
                }

                emit('message', msg_payload, to=room)
            
                # Trigger applicant notification and email asynchronously in background so socket emits return instantly.
                if not is_student_sender and app_no:
                    try:
                        def _bg_create_notif(target_app_no, sender_name, msg_snippet, target_room):
                            try:
                                notification_result = create_notification(
                                    user_no=target_app_no,
                                    title=f"New Message from {sender_name}",
                                    message=msg_snippet,
                                    notif_type='message',
                                    send_email=True,
                                )
                                print(
                                    f"[MESSAGE NOTIF BG] applicant_no={target_app_no}, room={target_room}, created={notification_result.get('created')}, "
                                    f"email_sent={notification_result.get('email_sent')}, reason={notification_result.get('reason', 'ok')}",
                                    flush=True,
                                )
                            except Exception as bg_err:
                                print(f"[NOTIF ERROR BG] Failed to trigger message notification: {bg_err}", flush=True)

                        notif_snippet = message_text[:100] + ('...' if len(message_text) > 100 else '')
                        threading.Thread(target=_bg_create_notif, args=(app_no, actual_username, notif_snippet, room), daemon=True).start()
                    except Exception as e:
                        print(f"[NOTIF ERROR] Failed to spawn notification thread: {e}")
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
            emit('error', {'msg': f'Failed to broadcast declination: {str(e)}'})

    @socketio.on('scholarship_update')
    def on_scholarship_update(data):
        """Handle scholarship updates from admin dashboard"""
        try:
            # Broadcast to all other connected clients
            emit('scholarship_update', data, broadcast=True, include_self=False)
        except Exception as e:
            print(f"Error broadcasting scholarship update: {e}")

    @socketio.on('announcement_update')
    def on_announcement_update(data):
        """Handle announcement updates from admin dashboard"""
        try:
            # Broadcast to all other connected clients
            emit('announcement_update', data, broadcast=True, include_self=False)
            
            # Also emit a notification for the dashboard UI alert
            emit('announcement_notification', {
                'title': f"New Announcement: {data.get('program', 'ISKOMATS')}",
                'message': f"A new announcement was {data.get('action', 'created')} by {data.get('adminName', 'an Admin')}.",
                'program': data.get('program')
            }, broadcast=True, include_self=True)
        except Exception as e:
            print(f"Error broadcasting announcement update: {e}")

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
        with get_db() as conn:
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
                        return jsonify({'message': 'Account does not exist', 'success': False}), 404
                    else:
                        print(f"[FORGOT PASSWORD] Email {normalized_email} is applicant and verified, but not a user account.")
                else:
                    # Email doesn't exist in system at all
                    print(f"[FORGOT PASSWORD] No account found for email: {normalized_email}")
            
            
                # Return error message - account does not exist
                return jsonify({'message': 'Account does not exist', 'success': False}), 404

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

        with get_db() as conn:
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
        
        with get_db() as conn:
            cursor = conn.cursor()
            user_email_table = get_user_email_table(cursor)
        
            # Check if email exists and code matches
            cursor.execute(
                f"SELECT user_no, verification_code, is_verified FROM {user_email_table} WHERE email_address ILIKE %s",
                (email,)
            )
            result = cursor.fetchone()
        
            if not result:
                return jsonify({'message': 'Email not found'}), 404
        
            user_no, stored_code, is_verified = result['user_no'], result['verification_code'], result.get('is_verified', False)
        
            # Check if already verified
            if is_verified:
                return jsonify({
                    'message': 'Email is already verified',
                    'success': True
                }), 200
        
            # Check if code matches
            if not stored_code or stored_code != code:
                return jsonify({'message': 'Verification code is incorrect'}), 400
        
            # Mark email as verified
            cursor.execute(
                f"UPDATE {user_email_table} SET is_verified = TRUE, verification_code = NULL WHERE email_address ILIKE %s",
                (email,)
            )
            conn.commit()
        
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
        with get_db() as conn:
            cursor = conn.cursor()
            user_email_table = get_user_email_table(cursor)
            applicant_email_table = get_applicant_email_table(cursor)

            cursor.execute(
                f'''
                SELECT 
                    EXISTS (
                        SELECT 1 FROM information_schema.columns 
                        WHERE table_name = '{user_email_table}' AND column_name = 'is_locked'
                    ) AS has_user_locked,
                    EXISTS (
                        SELECT 1 FROM information_schema.columns 
                        WHERE table_name = '{applicant_email_table}' AND column_name = 'is_locked'
                    ) AS has_app_locked,
                    EXISTS (
                        SELECT 1 FROM information_schema.columns 
                        WHERE table_name = 'applicant_status' AND column_name = 'status_updated'
                    ) AS has_status_updated
                '''
            )
            col_info = cursor.fetchone()
            has_user_locked = col_info['has_user_locked']
            has_app_locked = col_info['has_app_locked']
            has_status_updated = col_info['has_status_updated']

            user_locked_expr = 'COALESCE(ue.is_locked, FALSE)' if has_user_locked else 'FALSE'
            app_locked_expr = 'COALESCE(ae.is_locked, FALSE)' if has_app_locked else 'FALSE'
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
                        {user_locked_expr} AS locked
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
                        {app_locked_expr} AS locked
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
        with get_db() as conn:
            cursor = conn.cursor()
            user_email_table = get_user_email_table(cursor)
            applicant_email_table = get_applicant_email_table(cursor)

            normalized_email = data['email'].strip()
            cursor.execute(f"SELECT user_em_no FROM {user_email_table} WHERE email_address ILIKE %s LIMIT 1", (normalized_email,))
            existing_admin = cursor.fetchone()
            cursor.execute(f"SELECT app_em_no FROM {applicant_email_table} WHERE email_address ILIKE %s LIMIT 1", (normalized_email,))
            existing_applicant = cursor.fetchone()
            if existing_admin or existing_applicant:
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
        with get_db() as conn:
            cursor = conn.cursor()
            account_context = fetch_account_activity_context(cursor, account_id)
        
            if not account_context:
                return jsonify({'message': 'Account not found'}), 404
        
            if account_context['user_no']:
                # Update user table
                if 'name' in data or 'firstName' in data or 'lastName' in data:
                    name = (data.get('name') or f"{data.get('firstName', '')} {data.get('lastName', '')}").strip()
                    if name:
                        cursor.execute("UPDATE users SET user_name = %s WHERE user_no = %s", (name, account_context['user_no']))

                # Update scholarship provider assignment for admin account
                scholarship_val = data.get('scholarship')
                if scholarship_val is not None:
                    scholarship_str = str(scholarship_val).strip()
                    if not scholarship_str or scholarship_str.lower() in ['all', 'unassigned', 'no scholarship']:
                        cursor.execute("UPDATE users SET pro_no = NULL WHERE user_no = %s", (account_context['user_no'],))
                    else:
                        cursor.execute("SELECT pro_no FROM scholarship_providers WHERE provider_name ILIKE %s LIMIT 1", (f"%{scholarship_str}%",))
                        prov = cursor.fetchone()
                        if not prov:
                            cursor.execute("INSERT INTO scholarship_providers (provider_name) VALUES (%s) RETURNING pro_no", (scholarship_str,))
                            prov = cursor.fetchone()
                        if prov:
                            cursor.execute("UPDATE users SET pro_no = %s WHERE user_no = %s", (prov['pro_no'], account_context['user_no']))

            elif account_context['applicant_no']:
                if 'name' in data or 'firstName' in data or 'lastName' in data:
                    full_name = (data.get('name') or f"{data.get('firstName', '')} {data.get('lastName', '')}").strip()
                    name_parts = full_name.split()
                    if name_parts:
                        first_name = ' '.join(name_parts[:-1]) if len(name_parts) > 1 else name_parts[0]
                        last_name = name_parts[-1] if len(name_parts) > 1 else ''
                        cursor.execute(
                            "UPDATE applicants SET first_name = %s, last_name = %s WHERE applicant_no = %s",
                            (first_name, last_name, account_context['applicant_no'])
                        )

                scholarship_val = data.get('scholarship')
                if scholarship_val and str(scholarship_val).strip().lower() not in ['all', 'unassigned', 'no scholarship']:
                    cursor.execute("SELECT req_no FROM scholarships WHERE scholarship_name ILIKE %s LIMIT 1", (f"%{scholarship_val}%",))
                    sch = cursor.fetchone()
                    if sch:
                        cursor.execute("SELECT stat_no FROM applicant_status WHERE applicant_no = %s LIMIT 1", (account_context['applicant_no'],))
                        st = cursor.fetchone()
                        if st:
                            cursor.execute("UPDATE applicant_status SET scholarship_no = %s WHERE applicant_no = %s", (sch['req_no'], account_context['applicant_no']))
                        else:
                            cursor.execute("INSERT INTO applicant_status (applicant_no, scholarship_no) VALUES (%s, %s)", (account_context['applicant_no'], sch['req_no']))
                    
            target_table = get_user_email_table(cursor) if account_context['account_type'] == 'Admin' else get_applicant_email_table(cursor)
            id_column = 'user_em_no' if account_context['account_type'] == 'Admin' else 'app_em_no'

            # Update auth table
            if 'email' in data:
                cursor.execute(f"UPDATE {target_table} SET email_address = %s WHERE {id_column} = %s", (data['email'], account_context['email_id']))
            if 'password' in data and data['password']:
                password_hash = bcrypt.generate_password_hash(data['password']).decode('utf-8')
                cursor.execute(f"UPDATE {target_table} SET password_hash = %s WHERE {id_column} = %s", (password_hash, account_context['email_id']))
            
            conn.commit()

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
    """Delete user account"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            account_context = fetch_account_activity_context(cursor, account_id)
            if not account_context:
                return jsonify({'message': 'Account not found'}), 404
        
            if account_context['account_type'] == 'Admin':
                target_table = get_user_email_table(cursor)
                id_column = 'user_em_no'
            else:
                target_table = get_applicant_email_table(cursor)
                id_column = 'app_em_no'

            cursor.execute(f'DELETE FROM {target_table} WHERE {id_column} = %s RETURNING {id_column}', (account_context['email_id'],))
            deleted = cursor.fetchone()
        
            if deleted and account_context['user_no']:
                # Also delete from users table
                cursor.execute('DELETE FROM users WHERE user_no = %s', (account_context['user_no'],))
            
            conn.commit()
        
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
        with get_db() as conn:
            cursor = conn.cursor()
            account_context = fetch_account_activity_context(cursor, account_id)
            if not account_context:
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
        with get_db() as conn:
            cursor = conn.cursor()
        
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
        with get_db() as conn:
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

            return jsonify({'success': True, 'logs': filtered_logs}), 200

    except Exception as e:
        return jsonify({'message': f'Error: {str(e)}'}), 500

@api_bp.route('/scholarships/<program>', methods=['GET'])
@api_bp.route('/admin/scholarships/<program>', methods=['GET'])
@token_required
def get_scholarship_by_program(current_user_id, pro_no, role, program):
    """Get scholarship data for a program (provider) - returns metadata and base64-encoded images"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            resolved_provider_no, _ = resolve_provider_context(cursor, current_user_id, role, pro_no)
            is_super_admin = (role or '').strip().lower() == 'admin'

            scholarship_columns = get_table_columns(cursor, 'scholarships')

            description_expr = 's."desc"' if 'desc' in scholarship_columns else 'NULL'
            date_created_expr = 's.date_created' if 'date_created' in scholarship_columns else 'NULL'
            semester_expr = 's.semester' if 'semester' in scholarship_columns else 'NULL'
            year_expr = 's.year' if 'year' in scholarship_columns else 'NULL'
            grades_sem_expr = 's.grades_sem' if 'grades_sem' in scholarship_columns else 'NULL'
            grades_year_expr = 's.grades_year' if 'grades_year' in scholarship_columns else 'NULL'
            units_expr = 's.units' if 'units' in scholarship_columns else 'NULL'
            residency_doc_type_expr = 's.residency_doc_type' if 'residency_doc_type' in scholarship_columns else "'Indigency Document'"
            id_type_expr = 's.id_type' if 'id_type' in scholarship_columns else "'School ID'"

            params = []
            where_clauses = []
            
            # 1. Base Filters (Scholarship ID)
            req_no_filter = request.args.get('req_no')
            if req_no_filter:
                where_clauses.append('s.req_no = %s')
                params.append(req_no_filter)

            include_removed = request.args.get('include_removed', 'false').lower() == 'true'
            
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
                       {grades_sem_expr} as grades_sem, {grades_year_expr} as grades_year,
                       {units_expr} as units,
                       {residency_doc_type_expr} as "residencyDocType",
                       {id_type_expr} as "idType",
                       COUNT(ast.applicant_no) FILTER (WHERE LOWER(ast.is_accepted) = 'accepted') as "acceptedCount",
                       COUNT(ast.applicant_no) FILTER (WHERE LOWER(ast.is_accepted) = 'pending' OR ast.is_accepted IS NULL) as "pendingCount",
                       COUNT(ast.applicant_no) FILTER (WHERE LOWER(ast.is_accepted) IN ('rejected', 'declined')) as "declinedCount"
                FROM scholarships s
                LEFT JOIN scholarship_providers p ON s.pro_no = p.pro_no
                LEFT JOIN applicant_status ast ON ast.scholarship_no = s.req_no
            '''.format(
                is_removed_expr=is_removed_expr,
                description_expr=description_expr,
                date_created_expr=date_created_expr,
                semester_expr=semester_expr,
                year_expr=year_expr,
                grades_sem_expr=grades_sem_expr,
                grades_year_expr=grades_year_expr,
                units_expr=units_expr,
                residency_doc_type_expr=residency_doc_type_expr,
                id_type_expr=id_type_expr,
            )

            if where_clauses:
                query += ' WHERE ' + ' AND '.join(where_clauses)
            
            # Isolation: If not superadmin, only show scholarships for this provider
            if not is_super_admin:
                if resolved_provider_no is None:
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
            if 'grades_sem' in scholarship_columns:
                group_by_columns.append('s.grades_sem')
            if 'grades_year' in scholarship_columns:
                group_by_columns.append('s.grades_year')
            if 'units' in scholarship_columns:
                group_by_columns.append('s.units')
            if 'residency_doc_type' in scholarship_columns:
                group_by_columns.append('s.residency_doc_type')
            if 'id_type' in scholarship_columns:
                group_by_columns.append('s.id_type')

            # Add Pagination
            limit = int(request.args.get('limit', 100))
            offset = int(request.args.get('offset', 0))
            
            query += '\n            GROUP BY ' + ', '.join(group_by_columns) + '\n            ORDER BY s.req_no DESC LIMIT %s OFFSET %s\n        '
            params.extend([limit, offset])
            
            cursor.execute(query, params)
            rows = cursor.fetchall()
            cursor.close()
            
            if not rows:
                return jsonify({'success': True, 'scholarships': []}), 200

            result = []
            for row in rows:
                scholarship = dict(row)
                def safe_int(val, default=0):
                    if val is None: return default
                    try: return int(val)
                    except: return default

                slots = scholarship.get('slots')
                accepted_count = safe_int(scholarship.get('acceptedCount'))
                pending_count = safe_int(scholarship.get('pendingCount'))
                declined_count = safe_int(scholarship.get('declinedCount'))

                scholarship['acceptedCount'] = accepted_count
                scholarship['pendingCount'] = pending_count
                scholarship['declinedCount'] = declined_count
                scholarship['totalApplicants'] = accepted_count + pending_count + declined_count

                if slots is None:
                    scholarship['availableSlots'] = None
                    scholarship['isFull'] = False
                else:
                    scholarship['availableSlots'] = max(safe_int(slots) - accepted_count, 0)
                    scholarship['isFull'] = accepted_count >= safe_int(slots)

                result.append(scholarship)

            return jsonify({'success': True, 'scholarships': result}), 200
    
    except Exception as e:
        print(f"[SCHOLARSHIP API] CRITICAL ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        # Return more diagnostic info in the 500 response to help debugging
        return jsonify({
            'success': False,
            'message': f'Server Error: {str(e)}',
            'error_type': type(e).__name__,
            'traceback': traceback.format_exc().splitlines()[-3:] # Last few lines of traceback
        }), 500





@api_bp.route('/applicants/<program>', methods=['GET'])
@api_bp.route('/admin/applicants/<program>', methods=['GET'])
@token_required
def get_applicants(current_user_id, pro_no, role, program):
    """Get applicants for a program"""
    try:
        print(f"[APPLICANTS API] Loading applicants for program='{program}', role='{role}', pro_no='{pro_no}'", flush=True)
        filters = request.args
        with get_db() as conn:
            cursor = conn.cursor()
            applicant_email_table = get_applicant_email_table(cursor)
            document_join = applicant_document_join_sql(cursor, 'a', 'ad')
            profile_picture_expr = '(a.profile_picture IS NOT NULL)' if applicant_has_column(cursor, 'profile_picture') else '(a.profile_pic IS NOT NULL)' if applicant_has_column(cursor, 'profile_pic') else 'FALSE'
            
            query = f'''
                SELECT a.applicant_no, a.applicant_no as id, a.first_name as "firstName", a.last_name as "lastName", 
                       a.middle_name as "middleName",
                       a.mother_name as "motherName",
                       a.father_name as "fatherName",
                       a.first_name as name, a.overall_gpa as grade,
                       a.financial_income_of_parents as income, CONCAT_WS(', ', NULLIF(a.street_brgy, ''), NULLIF(a.town_city_municipality, ''), NULLIF(a.province, ''), NULLIF(a.zip_code, '')) as location,
                       a.maiden_name as "maidenName",
                       a.merits_awards_received as "meritsAwardsReceived",
                       a.street_brgy as "streetBrgy",
                       a.street_brgy as "street_brgy",
                       a.town_city_municipality as municipality,
                       a.town_city_municipality as "town_city_municipality",
                       a.province,
                       a.zip_code as "zipCode",
                       a.zip_code as "zip_code",
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
                       CONCAT_WS(', ', NULLIF(a.street_brgy, ''), NULLIF(a.town_city_municipality, ''), NULLIF(a.province, ''), NULLIF(a.zip_code, '')) as "schoolAddress",
                       s.is_accepted, s.scholarship_no as "scholarshipNo", p.provider_name as program,
                       e.email_address as email,
                       CASE 
                           WHEN s.is_accepted = 'Accepted' THEN 'Accepted'
                           WHEN s.is_accepted = 'Rejected' THEN 'Rejected'
                           WHEN s.is_accepted = 'Cancelled' THEN 'Cancelled'
                           ELSE 'Pending'
                       END as status,
                       esc.scholarship_name as "scholarshipName",
                        COALESCE(s.created_at, s.status_updated, CURRENT_TIMESTAMP) as "createdAt",
                        COALESCE(s.created_at, s.status_updated, CURRENT_TIMESTAMP) as "dateApplied",
                        s.created_at as "status_created_at",
                        ({applicant_document_expr(cursor, 'indigency_doc', 'a', 'ad')} IS NOT NULL) as "has_indigency_doc",
                        ({applicant_document_expr(cursor, 'enrollment_certificate_doc', 'a', 'ad')} IS NOT NULL) as "has_enrollment_certificate_doc",
                        ({applicant_document_expr(cursor, 'grades_doc', 'a', 'ad')} IS NOT NULL) as "has_grades_doc",
                        ({applicant_document_expr(cursor, 'id_img_front', 'a', 'ad')} IS NOT NULL) as "has_id_img_front",
                        ({applicant_document_expr(cursor, 'id_img_back', 'a', 'ad')} IS NOT NULL) as "has_id_img_back",
                        ({applicant_document_expr(cursor, 'id_pic', 'a', 'ad')} IS NOT NULL) as "has_id_pic",
                        ({applicant_document_expr(cursor, 'signature_image_data', 'a', 'ad')} IS NOT NULL) as "has_signature",
                        {profile_picture_expr} as "has_profile_picture",
                        {applicant_document_expr(cursor, 'indigency_vid_url', 'a', 'ad')} as indigency_vid_url,
                        {applicant_document_expr(cursor, 'enrollment_certificate_vid_url', 'a', 'ad')} as enrollment_certificate_vid_url,
                        {applicant_document_expr(cursor, 'grades_vid_url', 'a', 'ad')} as grades_vid_url,
                        {applicant_document_expr(cursor, 'schoolid_front_vid_url', 'a', 'ad')} as schoolid_front_vid_url,
                        {applicant_document_expr(cursor, 'schoolid_back_vid_url', 'a', 'ad')} as schoolid_back_vid_url,
                        {applicant_document_expr(cursor, 'id_vid_url', 'a', 'ad')} as id_vid_url,
                        ({applicant_document_expr(cursor, 'schoolid_front_vid_url', 'a', 'ad')} IS NOT NULL) as "has_schoolid_front_vid",
                        ({applicant_document_expr(cursor, 'schoolid_back_vid_url', 'a', 'ad')} IS NOT NULL) as "has_schoolid_back_vid",
                        ({applicant_document_expr(cursor, 'id_vid_url', 'a', 'ad')} IS NOT NULL) as "has_id_vid"
                FROM applicants a
                LEFT JOIN applicant_status s ON a.applicant_no = s.applicant_no
                LEFT JOIN scholarships esc ON s.scholarship_no = esc.req_no
                LEFT JOIN scholarship_providers p ON esc.pro_no = p.pro_no
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
                # Superadmins can see all applicants in the 'all' view
                pass
            
            if filters.get('search'):
                query += ' AND (a.first_name ILIKE %s OR a.last_name ILIKE %s OR e.email_address ILIKE %s)'
                search_term = f"%{filters['search']}%"
                params.extend([search_term, search_term, search_term])
            
            # Add Pagination if explicitly requested by client
            if filters.get('limit'):
                limit = int(filters.get('limit'))
                offset = int(filters.get('offset', 0))
                query += ' ORDER BY a.applicant_no DESC LIMIT %s OFFSET %s'
                params.extend([limit, offset])
            else:
                query += ' ORDER BY a.applicant_no DESC'

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

                # Proxy profile picture too
                if a.get('has_profile_picture'):
                    a['profile_picture'] = url_for('admin_api.get_applicant_image', applicant_no=app_no, column_name='profile_picture', _external=True)
                else:
                    a['profile_picture'] = None

                # Proxy face verification photo (id_pic)
                if a.get('has_id_pic'):
                    a['id_pic'] = url_for('admin_api.get_applicant_image', applicant_no=app_no, column_name='id_pic', _external=True)
                else:
                    a['id_pic'] = None
                
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
                
                # Include ID Front and Back images and videos in idFiles
                id_files = []
                if a.get('has_id_img_front'):
                    id_files.extend(get_applicant_media_metadata(app_no, 'id_img_front', True, None, "ID Front"))

                has_front_vid = a.get('has_schoolid_front_vid') or bool(a.get('schoolid_front_vid_url'))
                has_id_vid = a.get('has_id_vid') or bool(a.get('id_vid_url'))
                if has_front_vid:
                    id_files.extend(get_applicant_media_metadata(app_no, 'schoolid_front_vid_url', True, a.get('schoolid_front_vid_url'), "ID Front Video"))
                elif has_id_vid:
                    id_files.extend(get_applicant_media_metadata(app_no, 'id_vid_url', True, a.get('id_vid_url'), "ID Video"))

                if a.get('has_id_img_back'):
                    id_files.extend(get_applicant_media_metadata(app_no, 'id_img_back', True, None, "ID Back"))

                has_back_vid = a.get('has_schoolid_back_vid') or bool(a.get('schoolid_back_vid_url'))
                if has_back_vid:
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
        print(f"[APPLICANTS API] CRITICAL ERROR loading applicants for program='{program}': {e}", flush=True)
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'message': f'Server Error: {str(e)}',
            'error_type': type(e).__name__,
            'traceback': traceback.format_exc().splitlines()[-3:]
        }), 500

@api_bp.route('/applicants/<int:applicant_no>/accept', methods=['POST'])
@token_required
def accept_applicant(current_user_id, pro_no, role, applicant_no):
    """Accept an applicant (move from pending to accepted)"""
    try:
        data = request.get_json(silent=True) or {}
        scholarship_no = data.get('scholarshipNo')
        if scholarship_no is None:
            return jsonify({'success': False, 'message': 'scholarshipNo is required'}), 400

        with get_db() as conn:
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
                return jsonify({'success': False, 'message': 'Application not found'}), 404

            if role != 'Admin' and status_row['pro_no'] != pro_no:
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
                "SELECT s.scholarship_name, s.req_no FROM applicant_status ast JOIN scholarships s ON ast.scholarship_no = s.req_no WHERE ast.applicant_no = %s AND ast.scholarship_no != %s AND (ast.is_accepted = 'Pending' OR ast.is_accepted IS NULL OR ast.is_accepted = 'Accepted')",
                (applicant_no, scholarship_no)
            )
            declined_scholarships = cursor.fetchall()
            
            cursor.execute(
                """
                UPDATE applicant_status
                SET is_accepted = 'Cancelled'
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
                # Notify the student portal instantly via socket
                safe_emit('notification_update', {'user_no': applicant_no}, broadcast=True)
            except Exception as notif_err:
                print(f"[NOTIF ERROR] Failed to notify accepted applicant {applicant_no}: {notif_err}", flush=True)

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

        with get_db() as conn:
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
                return jsonify({'success': False, 'message': 'Application not found'}), 404

            if role != 'Admin' and status_row['pro_no'] != pro_no:
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
                # Notify the student portal instantly via socket
                safe_emit('notification_update', {'user_no': applicant_no}, broadcast=True)
            except Exception as notif_err:
                print(f"[NOTIF ERROR] Failed to notify declined applicant {applicant_no}: {notif_err}", flush=True)

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

        with get_db() as conn:
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
                return jsonify({'success': False, 'message': 'Application not found'}), 404

            if role != 'Admin' and status_row['pro_no'] != pro_no:
                return jsonify({'success': False, 'message': 'Unauthorized'}), 403
        
            # Update applicant status back to NULL (pending review)
            cursor.execute(
                '''UPDATE applicant_status 
                   SET is_accepted = 'Pending', status_updated = CURRENT_DATE
                   WHERE applicant_no = %s AND scholarship_no = %s''',
                (applicant_no, scholarship_no)
            )
            conn.commit()
            
            return jsonify({'success': True, 'message': 'Applicant status cancelled'}), 200
    
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500

@api_bp.route('/applicants/<program>', methods=['POST'])
@token_required
def create_applicant(current_user_id, pro_no, role, program):
    """Create new applicant"""
    data = request.get_json()
    
    try:
        with get_db() as conn:
            cursor = conn.cursor()
        
            cursor.execute(
                '''INSERT INTO applicants (program, first_name, last_name, email, phone, status, created_at)
                   VALUES (%s, %s, %s, %s, %s, 'Pending', NOW())
                   RETURNING *''',
                (program.lower(), data['firstName'], data['lastName'], data['email'], data.get('phone', ''))
            )
            applicant = cursor.fetchone()
            conn.commit()
        
            return jsonify({'success': True, 'applicant': applicant}), 201
    
    except Exception as e:
        return jsonify({'message': f'Error: {str(e)}'}), 500

@api_bp.route('/rankings/<program>', methods=['GET'])
@token_required
def get_rankings(current_user_id, pro_no, role, program):
    """Get rankings for a program"""
    try:
        with get_db() as conn:
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
        with get_db() as conn:
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
            cursor.execute('''
                INSERT INTO scholarships (scholarship_name, gpa, parent_finance, location, pro_no, slots, deadline, "desc", semester, year, grades_sem, grades_year, course, program_type, units, residency_doc_type, id_type, date_created)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_DATE)
                RETURNING req_no
            ''', (
                data.get('scholarshipName'), data.get('minGpa'), data.get('parentFinance'),
                data.get('location'), target_pro_no, data.get('slots'), data.get('deadline'),
                data.get('description'), data.get('semester'), data.get('year'),
                data.get('grades_sem'), data.get('grades_year'), data.get('course', 'All'),
                data.get('program_type', 'All'), units_val, res_doc_type, id_type_val
            ))
        
            new_scholarship = cursor.fetchone()
            req_no = new_scholarship['req_no']

            conn.commit()

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
            safe_invalidate_public_caches()
        
            return jsonify({
                'success': True, 
                'message': 'Scholarship created successfully',
                'id': req_no
            }), 201
        
    except Exception as e:
        print(f"[SCHOLARSHIP CREATE] CRITICAL ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'message': f'Server Error: {str(e)}',
            'error_type': type(e).__name__,
            'traceback': traceback.format_exc().splitlines()[-3:]
        }), 500

@api_bp.route('/scholarships/<int:req_no>', methods=['PUT'])
@token_required
def update_scholarship(current_user_id, pro_no, role, req_no):
    """Update scholarship post"""
    data = request.get_json()
    
    try:
        with get_db() as conn:
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
             

            units_val = int(data.get('units')) if data.get('units') not in (None, '', 'null') else None
            res_doc_type = data.get('residencyDocType', 'Indigency Document')
            id_type_val = data.get('idType', 'School ID')
            cursor.execute('''
                UPDATE scholarships 
                SET scholarship_name = %s, gpa = %s, parent_finance = %s, location = %s, slots = %s, 
                    deadline = %s, "desc" = %s, semester = %s, year = %s, grades_sem = %s, grades_year = %s,
                    course = %s, program_type = %s, units = %s, residency_doc_type = %s, id_type = %s
                WHERE req_no = %s
            ''', (
                data.get('scholarshipName'), data.get('minGpa'), data.get('parentFinance'),
                data.get('location'), data.get('slots'), data.get('deadline'),
                data.get('description'), data.get('semester'), data.get('year'),
                data.get('grades_sem'), data.get('grades_year'), data.get('course', 'All'),
                data.get('program_type', 'All'), units_val, res_doc_type, id_type_val, req_no
            ))
        
            conn.commit()

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
            safe_invalidate_public_caches()
        
            return jsonify({'success': True, 'message': 'Scholarship updated'}), 200
    
    except Exception as e:
        print(f"[SCHOLARSHIP UPDATE] Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'message': f'Error: {str(e)}'}), 500

@api_bp.route('/scholarships/<int:req_no>', methods=['DELETE'])
@api_bp.route('/admin/scholarships/<int:req_no>', methods=['DELETE'])
@token_required
def delete_scholarship(current_user_id, pro_no, role, req_no):
    """Soft-delete scholarship post."""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            is_superadmin = ((role or '').strip().lower() in ('admin', 'superadmin', 'super_admin'))
            resolved_provider_no, _ = resolve_provider_context(cursor, current_user_id, role, pro_no)
        
            cursor.execute("SELECT pro_no, scholarship_name FROM scholarships WHERE req_no = %s", (req_no,))
            sch_row = cursor.fetchone()
            if not sch_row:
                return jsonify({'message': 'Scholarship not found'}), 404
            
            scholarship_provider_no = get_row_value(sch_row, 'pro_no')
            scholarship_name = get_row_value(sch_row, 'scholarship_name')

            def safe_int_cmp(val):
                if val is None: return None
                try: return int(val)
                except: return None

            if not is_superadmin and scholarship_provider_no is not None and resolved_provider_no is not None:
                if safe_int_cmp(scholarship_provider_no) != safe_int_cmp(resolved_provider_no):
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

            safe_emit('scholarship_update', {
                'action': 'delete',
                'req_no': req_no,
                'scholarship_name': scholarship_name,
                'pro_no': resolved_provider_no
            }, broadcast=True)
            safe_emit('scholarship_change', {'action': 'delete', 'req_no': req_no}, broadcast=True)
            safe_emit('account_change', {'type': 'scholarship_delete'}, broadcast=True)
            safe_invalidate_public_caches()
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
        with get_db() as conn:
            cursor = conn.cursor()
            primary_key_column, _ = get_entity_image_columns(cursor, entity='announcement')
        
            # Get image from database
            cursor.execute(f"SELECT img FROM announcement_images WHERE {primary_key_column} = %s", (image_id,))
            row = cursor.fetchone()
        
            if not row or not row['img']:
                return jsonify({'message': 'Image not found'}), 404
        
            data = row['img']
        
            # --- CLOUD STORAGE PROXY ---
            if isinstance(data, str) and (data.startswith('http://') or data.startswith('https://')):
                from services.applicant_document_service import normalize_supabase_url
                normalized_url = normalize_supabase_url(data)
                try:
                    import requests
                    proxy_resp = requests.get(normalized_url, timeout=20)
                    if proxy_resp.status_code == 200 and proxy_resp.content:
                        data = proxy_resp.content
                    else:
                        from flask import redirect
                        return redirect(normalized_url)
                except Exception:
                    from flask import redirect
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
        with get_db() as conn:
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
        
            if not row or not row['img']:
                return jsonify({'message': f'Image not found for announcement {ann_no} at index {idx}'}), 404
        
            data = row['img']
        
            # --- CLOUD STORAGE PROXY ---
            if isinstance(data, str) and (data.startswith('http://') or data.startswith('https://')):
                from services.applicant_document_service import normalize_supabase_url
                normalized_url = normalize_supabase_url(data)
                try:
                    import requests
                    proxy_resp = requests.get(normalized_url, timeout=20)
                    if proxy_resp.status_code == 200 and proxy_resp.content:
                        data = proxy_resp.content
                    else:
                        from flask import redirect
                        return redirect(normalized_url)
                except Exception:
                    from flask import redirect
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
        'id_img_front', 'id_img_back', 'profile_picture',
        'profile_pic', 'signature_image_data', 'id_pic',
        'id_vid_url', 'indigency_vid_url', 'grades_vid_url',
        'enrollment_certificate_vid_url', 'schoolid_front_vid_url', 'schoolid_back_vid_url'
    ]
    if column_name not in allowed_columns:
        return jsonify({'message': 'Invalid column name'}), 400
        
    try:
        with get_db() as conn:
            cursor = conn.cursor()

            row = fetch_applicant_document_values(cursor, applicant_no, [column_name])
        
            if not row or not row.get(column_name):
                return jsonify({'message': 'Image not found'}), 404
        
            data = row[column_name]
        
            if hasattr(data, 'tobytes'):
                data = data.tobytes()
            elif isinstance(data, memoryview):
                data = bytes(data)
        
        # --- CLOUD STORAGE & PROXY URL RESOLUTION ---
        if isinstance(data, str) and (data.startswith('http://') or data.startswith('https://')):
            # If the URL is an admin proxy pointing to itself, return 404 to avoid infinite recursion loop
            if '/applicant-image/' in data:
                return jsonify({'message': 'Image not found (recursive proxy)'}), 404

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
                                re_row = fetch_applicant_document_values(cursor, applicant_no, [mapped_col])
                                if re_row and re_row.get(mapped_col):
                                    real_val = re_row[mapped_col]
                                    if isinstance(real_val, str) and not ('/applicant/document/raw/' in real_val):
                                        data = real_val
                except Exception as ex:
                    print(f"[APPLICANT IMAGE] Proxy resolution error: {ex}", flush=True)

        if isinstance(data, str) and (data.startswith('http://') or data.startswith('https://')):
            fetched_bytes = fetch_cloud_media_bytes(data)
            if fetched_bytes:
                data = fetched_bytes
            else:
                try:
                    import requests
                    proxy_url = normalize_supabase_url(data)
                    proxy_resp = requests.get(proxy_url, timeout=20)
                    if proxy_resp.status_code == 200 and proxy_resp.content:
                        data = proxy_resp.content
                    else:
                        print(f"[APPLICANT IMAGE] Fallback HTTP fetch failed: {proxy_resp.status_code} for {proxy_url}", flush=True)
                        return jsonify({'message': 'Media file unavailable'}), 404
                except Exception as proxy_err:
                    print(f"[APPLICANT IMAGE] Proxy fetch error for {data}: {proxy_err}", flush=True)
                    return jsonify({'message': 'Failed to load media file'}), 500

        # Convert to bytes if not already
        if not isinstance(data, (bytes, bytearray)):
            try:
                data = bytes(data)
            except (TypeError, ValueError):
                if isinstance(data, str):
                    data = data.encode('utf-8')
                else:
                    data = bytes(str(data), 'utf-8')
            
        # Handle decryption for all fields if encrypted
        if data:
            from services.crypto_service import decrypt_if_encrypted
            try:
                decrypted = decrypt_if_encrypted(data)
                if decrypted != data:
                    data = decrypted
                    print(f"[APPLICANT IMAGE] Decrypted {column_name} (Applicant {applicant_no})", flush=True)
            except Exception as e:
                print(f"[APPLICANT IMAGE] Failed to decrypt {column_name}: {e}")
        
        # Detect image type from magic bytes
        mime_type = get_mime_type(data)
        
        # Final conversion check for BytesIO
        if not isinstance(data, (bytes, bytearray)):
            print(f"[APPLICANT IMAGE] Data for {column_name} is still not bytes (type: {type(data)}). Attempting final conversion.")
            try:
                if isinstance(data, str):
                    data = data.encode('utf-8')
                else:
                    data = bytes(str(data), 'utf-8')
            except:
                return jsonify({'message': f'Invalid data format for {column_name}'}), 500

        if mime_type.startswith('video/'):
            from flask import request, Response
            range_header = request.headers.get('Range', None)
            if range_header and range_header.startswith('bytes='):
                try:
                    byte_ranges = range_header.replace('bytes=', '').split('-')
                    start = int(byte_ranges[0]) if byte_ranges[0] else 0
                    end = int(byte_ranges[1]) if byte_ranges[1] else len(data) - 1
                except ValueError:
                    start = 0
                    end = len(data) - 1
                
                if end >= len(data):
                    end = len(data) - 1
                if start > end:
                    start = end
                
                chunk = data[start:end+1]
                response = Response(chunk, status=206, mimetype=mime_type)
                response.headers.set('Accept-Ranges', 'bytes')
                response.headers.set('Content-Range', f'bytes {start}-{end}/{len(data)}')
                response.headers.set('Content-Length', str(len(chunk)))
                response.headers.set('Cache-Control', 'public, max-age=3600')
                return response
            else:
                response = Response(data, mimetype=mime_type)
                response.headers.set('Accept-Ranges', 'bytes')
                response.headers.set('Content-Length', str(len(data)))
                response.headers.set('Cache-Control', 'public, max-age=3600')
                return response
        
        try:
            response = send_file(
                BytesIO(data),
                mimetype=mime_type,
                as_attachment=False,
                download_name=f'applicant_{applicant_no}_{column_name}.png',
                max_age=86400
            )
            response.headers['Cache-Control'] = 'public, max-age=86400, immutable'
            return response
        except Exception as e:
            print(f"[APPLICANT IMAGE] send_file failed: {e}")
            return jsonify({'message': f'Failed to serve image: {str(e)}'}), 500

    except Exception as e:
        print(f"[APPLICANT IMAGE] CRITICAL ERROR serving {column_name} for applicant {applicant_no}: {str(e)}", flush=True)
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'message': f'Internal Image Error: {str(e)}',
            'error_type': type(e).__name__
        }), 500

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
        with get_db() as conn:
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

            include_removed = request.args.get('include_removed', 'false').lower() == 'true'
            where_clauses = []
            if 'is_removed' in announcement_columns and not include_removed:
                where_clauses.append('COALESCE(a.is_removed, FALSE) = FALSE')
        
            is_removed_expr = 'COALESCE(a.is_removed, FALSE)' if 'is_removed' in announcement_columns else 'FALSE'

            query = """
                SELECT
                    a.ann_no,
                    a.ann_title,
                    a.ann_message,
                    a.pro_no,
                    {date_col} AS ann_date,
                    {date_col} AS time_added,
                    COALESCE(sp.provider_name, 'Unknown Provider') AS provider_name,
                    {is_removed_expr} as is_removed,
                    {image_select}
                FROM announcements a
                LEFT JOIN scholarship_providers sp ON a.pro_no = sp.pro_no
                {image_join}
            """.format(
                date_col=date_col,
                is_removed_expr=is_removed_expr,
                image_select=f"ai.{primary_key_column} AS image_id, ai.img AS announcement_image_data" if primary_key_column and foreign_key_column else "NULL AS image_id, NULL AS announcement_image_data",
                image_join=f"LEFT JOIN announcement_images ai ON a.ann_no = ai.{foreign_key_column}" if primary_key_column and foreign_key_column else "",
            )
            params = []

            if where_clauses:
                query += ' WHERE ' + ' AND '.join(where_clauses)

            if not is_super_admin:
                if resolved_provider_no is None:
                    cur.close()
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
        with get_db() as conn:
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
                for i, img_bytes in enumerate(image_attachments):
                    # Upload to Supabase bucket 'announcement_images'
                    file_path = f"ann_{ann_no}_img_{i}_{int(datetime.now().timestamp())}.jpg"
                    url = upload_to_supabase(img_bytes, 'announcement_images', file_path)
                
                    if url:
                        cur.execute(
                            f"INSERT INTO announcement_images ({foreign_key_column}, img) VALUES (%s, %s)",
                            (ann_no, url)
                        )
                    else:
                        print(f"[ANNOUNCEMENT ERROR] Storage failed for image {i}. Check Supabase credentials/bucket.", flush=True)
                        raise ValueError("Failed to upload announcement image to cloud storage bucket 'announcement_images'.")

            conn.commit()
        
            record_admin_activity(
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
            safe_emit('notification_update', {'type': 'announcement', 'ann_no': ann_no}, broadcast=True)
            safe_invalidate_public_caches()
        
            # Dispatch notifications asynchronously in background thread
            print(f"[ANNOUNCEMENT] Dispatching notifications for ann_no {ann_no} (SendToAll: {send_to_all_applicants})", flush=True)
            try:
                run_background_task(
                    notify_announcement_applicants,
                    title,
                    message,
                    target_pro_no,
                    provider_name,
                    send_to_all_applicants,
                    True,
                )
                print(f"[ANNOUNCEMENT] Background notification delivery queued successfully for ann_no {ann_no}.")
            except Exception as notif_err:
                print(f"[ANNOUNCEMENT WARN] Notification dispatch error: {notif_err}", flush=True)

            return jsonify({'message': 'Announcement created', 'ann_no': ann_no}), 201
    except Exception as e:
        if 'conn' in locals() and conn:
            conn.rollback()
        error_msg = f"Announcement creation failed: {str(e)}"
        print(f"[ANNOUNCEMENT ERROR] {error_msg}", flush=True)
        traceback.print_exc()
        return jsonify({
            'message': error_msg,
            'details': traceback.format_exc()
        }), 500
    finally:
        if 'cur' in locals() and cur:
            cur.close()
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
    should_notify = data.get('notify', True) # Default to true to ensure updates send notifications
    
    if not title or not message:
        return jsonify({'message': 'Title and content are required'}), 400
        
    try:
        with get_db() as conn:
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

            # 4. Sync image table directly
            final_image_urls = []
            for i, item in enumerate(new_sequence):
                if isinstance(item, bytes):
                    file_path = f"ann_{ann_no}_upd_{i}_{int(datetime.now().timestamp())}.jpg"
                    try:
                        url = upload_to_supabase(item, 'announcement_images', file_path)
                        if url:
                            final_image_urls.append(url)
                        else:
                            b64 = base64.b64encode(item).decode('utf-8')
                            final_image_urls.append(f"data:image/jpeg;base64,{b64}")
                    except Exception as e:
                        print(f"[ANNOUNCEMENT UPDATE] Cloud upload error: {e}", flush=True)
                        b64 = base64.b64encode(item).decode('utf-8')
                        final_image_urls.append(f"data:image/jpeg;base64,{b64}")
                elif isinstance(item, str) and item.startswith('http'):
                    final_image_urls.append(item)
                else:
                    cur.execute(f"SELECT img FROM announcement_images WHERE {primary_key_column} = %s", (item,))
                    row = cur.fetchone()
                    if row:
                        val = row['img'] if isinstance(row, dict) else row[0]
                        if val: final_image_urls.append(val)

            # Replace the original image set in one clean operation
            cur.execute(f"DELETE FROM announcement_images WHERE {foreign_key_column} = %s", (ann_no,))
            for url in final_image_urls:
                cur.execute(f"INSERT INTO announcement_images ({foreign_key_column}, img) VALUES (%s, %s)", (ann_no, url))

            conn.commit()
        
            record_admin_activity(
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
            safe_emit('notification_update', {'type': 'announcement', 'ann_no': ann_no}, broadcast=True)
            safe_invalidate_public_caches()

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
        if 'conn' in locals() and conn:
            conn.rollback()
        error_msg = f"Announcement update failed: {str(e)}"
        print(f"[ANNOUNCEMENT ERROR] {error_msg}", flush=True)
        traceback.print_exc()
        return jsonify({
            'message': error_msg,
            'details': traceback.format_exc()
        }), 500
    finally:
        if 'cur' in locals() and cur:
            cur.close()
        if 'conn' in locals() and conn:
            conn.close()

@api_bp.route('/announcements/<int:ann_no>', methods=['DELETE'])
@api_bp.route('/admin/announcements/<int:ann_no>', methods=['DELETE'])
@token_required
def delete_announcement(current_user_id, pro_no, role, ann_no):
    """Soft-delete announcement post."""
    try:
        with get_db() as conn:
            cur = conn.cursor()
            resolved_provider_no, _ = resolve_provider_context(cur, current_user_id, role, pro_no)
        
            is_superadmin = ((role or '').strip().lower() in ('admin', 'superadmin', 'super_admin'))
            cur.execute("SELECT pro_no, ann_title FROM announcements WHERE ann_no = %s", (ann_no,))
            row = cur.fetchone()
            if not row:
                return jsonify({'message': 'Announcement not found'}), 404

            title = get_row_value(row, 'ann_title', 'Unknown')
            ann_provider_no = get_row_value(row, 'pro_no')

            def safe_int_cmp(val):
                if val is None: return None
                try: return int(val)
                except: return None

            if not is_superadmin and ann_provider_no is not None and resolved_provider_no is not None:
                if safe_int_cmp(ann_provider_no) != safe_int_cmp(resolved_provider_no):
                    return jsonify({'message': 'Unauthorized to delete this announcement'}), 403

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

            safe_emit('announcement_update', {
                'action': 'delete',
                'ann_no': ann_no,
                'title': title,
                'pro_no': ann_provider_no
            }, broadcast=True)
            safe_emit('notification_update', {'type': 'announcement', 'ann_no': ann_no}, broadcast=True)
            safe_invalidate_public_caches()
        
            return jsonify({'success': True, 'message': 'Announcement deleted'}), 200
    except Exception as e:
        print(f"[ANNOUNCEMENT DELETE] Error deleting announcement {ann_no}: {e}", flush=True)
        traceback.print_exc()
        return jsonify({'message': str(e)}), 500
    finally:
        if conn:
            conn.close()

# ===== ADMIN / SUPERADMIN MESSAGES REST API =====

@api_bp.route('/messages/superadmin/<admin_id>', methods=['GET'])
@api_bp.route('/messages/superadmin/<int:admin_id>', methods=['GET'])
def get_superadmin_messages_by_admin_id(admin_id):
    """REST endpoint to fetch messages for superadmin_room_<admin_id>."""
    try:
        room = f"superadmin_room_{admin_id}"
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT m_id, room, username, message, timestamp, sender_id, is_student_sender
                FROM message
                WHERE room = %s OR room = %s
                ORDER BY timestamp ASC
            """, (room, f"superadmin_{admin_id}"))
            rows = cursor.fetchall()
            messages = []
            for r in rows:
                messages.append({
                    'm_id': r['m_id'],
                    'room': r['room'],
                    'username': r['username'],
                    'message': r['message'],
                    'timestamp': r['timestamp'].strftime('%Y-%m-%d %H:%M:%S') if hasattr(r['timestamp'], 'strftime') else str(r['timestamp']),
                    'sender_id': r['sender_id'],
                    'is_student_sender': r['is_student_sender']
                })
            return jsonify({'success': True, 'messages': messages}), 200
    except Exception as e:
        print(f"[REST MESSAGES ERROR] {e}", flush=True)
        return jsonify({'success': False, 'error': str(e), 'messages': []}), 200

@api_bp.route('/messages/superadmin', methods=['GET', 'POST'])
def handle_superadmin_messages_endpoint():
    """REST endpoint to post or get superadmin messages."""
    if request.method == 'POST':
        data = request.json or {}
        sender_id = data.get('sender_id') or 1
        room = data.get('room') or f"superadmin_room_{sender_id}"
        message_text = data.get('message')
        username = data.get('username') or 'Admin'
        
        if not message_text:
            return jsonify({'success': False, 'message': 'Message text is required'}), 400
            
        try:
            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO message (room, username, message, timestamp, sender_id, is_student_sender)
                    VALUES (%s, %s, %s, NOW(), %s, FALSE)
                    RETURNING m_id, timestamp
                """, (room, username, message_text, sender_id))
                row = cursor.fetchone()
                conn.commit()
                
                msg_payload = {
                    'm_id': row['m_id'],
                    'room': room,
                    'username': username,
                    'message': message_text,
                    'timestamp': row['timestamp'].strftime('%Y-%m-%d %H:%M:%S') if hasattr(row['timestamp'], 'strftime') else str(row['timestamp']),
                    'sender_id': sender_id,
                    'is_student_sender': False
                }
                safe_emit('message', msg_payload, to=room)
                return jsonify({'success': True, 'message': msg_payload}), 200
        except Exception as e:
            print(f"[REST POST MESSAGE ERROR] {e}", flush=True)
            return jsonify({'success': False, 'error': str(e)}), 500
    else:
        try:
            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT m_id, room, username, message, timestamp, sender_id, is_student_sender
                    FROM message
                    WHERE room LIKE 'superadmin%'
                    ORDER BY timestamp ASC
                """)
                rows = cursor.fetchall()
                messages = [{
                    'm_id': r['m_id'],
                    'room': r['room'],
                    'username': r['username'],
                    'message': r['message'],
                    'timestamp': r['timestamp'].strftime('%Y-%m-%d %H:%M:%S') if hasattr(r['timestamp'], 'strftime') else str(r['timestamp']),
                    'sender_id': r['sender_id'],
                    'is_student_sender': r['is_student_sender']
                } for r in rows]
                return jsonify({'success': True, 'messages': messages}), 200
        except Exception as e:
            return jsonify({'success': False, 'error': str(e), 'messages': []}), 200

@api_bp.route('/messages/all', methods=['GET'])
@api_bp.route('/messages/provider/<int:pro_no>', methods=['GET'])
def get_all_messages_rest(pro_no=None):
    """REST endpoint to fetch all persistent messages for admin inbox."""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            valid_room_filter = """(
                (m.applicant_no IS NOT NULL AND m.applicant_no > 0 AND m.room ~ '^[1-9][0-9]*\\+[0-9]+')
                OR m.room LIKE 'provider_room_%%'
                OR m.room LIKE 'superadmin_room_%%'
                OR m.room IN ('0+1', '0+2', '0+3')
            )"""
            if pro_no:
                cursor.execute(f"""
                    SELECT m.m_id, m.applicant_no, m.pro_no, m.room, m.username,
                           m.message, m.timestamp, m.sender_id, m.is_student_sender,
                           COALESCE(ast.is_accepted, 'Pending') as student_status
                    FROM message m
                    LEFT JOIN LATERAL (
                        SELECT is_accepted FROM applicant_status
                        WHERE applicant_no = m.applicant_no LIMIT 1
                    ) ast ON TRUE
                    WHERE (m.pro_no = %s OR m.room = 'provider_room_' || %s OR m.room = 'superadmin_room_' || %s OR m.room = '0+' || %s)
                      AND {valid_room_filter}
                    ORDER BY m.timestamp ASC
                """, (pro_no, str(pro_no), str(pro_no), str(pro_no)))
            else:
                cursor.execute(f"""
                    SELECT m.m_id, m.applicant_no, m.pro_no, m.room, m.username,
                           m.message, m.timestamp, m.sender_id, m.is_student_sender,
                           COALESCE(ast.is_accepted, 'Pending') as student_status
                    FROM message m
                    LEFT JOIN LATERAL (
                        SELECT is_accepted FROM applicant_status
                        WHERE applicant_no = m.applicant_no LIMIT 1
                    ) ast ON TRUE
                    WHERE {valid_room_filter}
                    ORDER BY m.timestamp ASC
                """)
            rows = cursor.fetchall()
            messages = [{
                'm_id': r['m_id'],
                'applicant_no': r['applicant_no'],
                'pro_no': r['pro_no'],
                'room': r['room'],
                'username': r['username'],
                'message': r['message'],
                'timestamp': r['timestamp'].strftime('%Y-%m-%d %H:%M:%S') if hasattr(r['timestamp'], 'strftime') else str(r['timestamp']),
                'sender_id': r['sender_id'],
                'is_student_sender': r['is_student_sender'],
                'student_status': r['student_status'] or 'Pending'
            } for r in rows]
            return jsonify({'success': True, 'messages': messages}), 200
    except Exception as e:
        print(f"[REST ALL MESSAGES ERROR] {e}", flush=True)
        return jsonify({'success': False, 'error': str(e), 'messages': []}), 200

@api_bp.route('/messages/<path:room_id>', methods=['GET', 'POST'])
def handle_room_messages_rest(room_id):
    """REST endpoint to fetch or post messages for any room."""
    if request.method == 'POST':
        data = request.json or {}
        message_text = data.get('message')
        username = data.get('username') or 'User'
        sender_id = data.get('sender_id')

        if not message_text:
            return jsonify({'success': False, 'message': 'Message text is required'}), 400

        try:
            app_no = None
            pro_no = None
            if '+' in room_id:
                try:
                    parts = room_id.split('+')
                    app_no = int(parts[0])
                    pro_no = int(parts[1])
                except Exception:
                    pass

            clean_sender_id = None
            if sender_id is not None:
                try:
                    clean_sender_id = int(sender_id)
                except (ValueError, TypeError):
                    clean_sender_id = app_no

            if not clean_sender_id and app_no:
                clean_sender_id = app_no

            is_student_sender = data.get('is_student_sender', False)

            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO message (applicant_no, pro_no, room, username, message, timestamp, sender_id, is_student_sender)
                    VALUES (%s, %s, %s, %s, %s, NOW(), %s, %s)
                    RETURNING m_id, timestamp
                """, (app_no, pro_no, room_id, username, message_text, clean_sender_id, is_student_sender))
                row = cursor.fetchone()
                conn.commit()

                msg_payload = {
                    'm_id': row['m_id'],
                    'room': room_id,
                    'username': username,
                    'message': message_text,
                    'timestamp': row['timestamp'].strftime('%Y-%m-%d %H:%M:%S') if hasattr(row['timestamp'], 'strftime') else str(row['timestamp']),
                    'sender_id': clean_sender_id,
                    'is_student_sender': is_student_sender
                }
                safe_emit('message', msg_payload, to=room_id)
                return jsonify({'success': True, 'message': msg_payload}), 200
        except Exception as e:
            print(f"[REST POST MESSAGE ERROR] {e}", flush=True)
            return jsonify({'success': False, 'error': str(e)}), 500
    else:
        try:
            app_no = None
            pro_no = None
            if '+' in room_id:
                try:
                    parts = room_id.split('+')
                    app_no = int(parts[0])
                    pro_no = int(parts[1])
                except Exception:
                    pass

            with get_db() as conn:
                cursor = conn.cursor()
                if app_no and pro_no:
                    cursor.execute("""
                        SELECT m_id, room, username, message, timestamp, sender_id, is_student_sender
                        FROM message
                        WHERE room = %s OR (applicant_no = %s AND pro_no = %s)
                        ORDER BY timestamp ASC
                    """, (room_id, app_no, pro_no))
                else:
                    cursor.execute("""
                        SELECT m_id, room, username, message, timestamp, sender_id, is_student_sender
                        FROM message
                        WHERE room = %s
                        ORDER BY timestamp ASC
                    """, (room_id,))

                rows = cursor.fetchall()
                messages = [{
                    'm_id': r['m_id'],
                    'room': r['room'],
                    'username': r['username'],
                    'message': r['message'],
                    'timestamp': r['timestamp'].strftime('%Y-%m-%d %H:%M:%S') if hasattr(r['timestamp'], 'strftime') else str(r['timestamp']),
                    'sender_id': r['sender_id'],
                    'is_student_sender': r['is_student_sender']
                } for r in rows]
                return jsonify({'success': True, 'messages': messages}), 200
        except Exception as e:
            return jsonify({'success': False, 'error': str(e), 'messages': []}), 200

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
