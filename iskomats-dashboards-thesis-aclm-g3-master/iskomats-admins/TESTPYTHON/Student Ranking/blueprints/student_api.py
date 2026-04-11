import base64
from collections import OrderedDict
import eventlet.tpool
from eventlet import GreenPool
import os
import re
import threading
import time
import traceback
import json
import requests
import urllib.request as urllib_request
from urllib import error as urllib_error
from urllib.parse import urlparse
from email.mime.text import MIMEText
from datetime import datetime, timedelta
from functools import wraps

import jwt
from cryptography.fernet import Fernet
from flask import Blueprint, jsonify, request, url_for
from flask_bcrypt import Bcrypt

import cv2
import numpy as np
from services.auth_service import get_secret_key
from services.db_service import get_db, get_db_startup
from services.email_table_service import get_applicant_email_table, get_user_email_table
from services.applicant_document_service import (
    APPLICANT_DOCUMENT_COLUMNS,
    applicant_has_column,
    fetch_applicant_document_values,
    get_applicant_document_table,
    persist_applicant_document_values,
)

from services.ocr_utils import (
    verify_id_with_ocr, verify_face_with_id, extract_school_year, 
    extract_school_year_from_text, is_current_school_year, 
    verify_signature_against_id, save_signature_profile, verify_video_content,
    extract_semester_from_text,
    normalize_semester_label,
    _perform_text_matching,
    extract_document_text
)
from services.notification_service import create_notification, fetch_google_access_token
from services.google_auth_service import verify_google_token
from concurrent.futures import ThreadPoolExecutor


student_api_bp = Blueprint('student_api', __name__, url_prefix='/api/student')
bcrypt = Bcrypt()
SECRET_KEY = get_secret_key()

_announcement_image_columns = None
_applicant_status_created_at_checked = False
_video_fetch_cache = OrderedDict()
_video_fetch_cache_lock = threading.Lock()
_VIDEO_FETCH_CACHE_SIZE_LIMIT = 24
_VIDEO_FETCH_CACHE_TTL_SECONDS = 300
HARD_CODED_SCHOOL_NAMES = [
    'DLSL/De La Salle Lipa',
    'NU/National University Lipa',
    'Batangas State University',
    'Kolehiyo ng Lungsod ng Lipa',
    'Philippine State College of Aeronautics',
    'Lipa City Colleges',
    'University of Batangas',
    'New Era University',
    'Batangas College of Arts and Sciences',
    'Royal British College',
    'STI Academic Center',
    'AMA Computer College',
    'ICT-ED'
]


def academic_year_matches_expected(found_year, expected_year):
    if not found_year or not expected_year:
        return False

    found_years = [int(year) for year in re.findall(r'20\d{2}', str(found_year))]
    expected_years = [int(year) for year in re.findall(r'20\d{2}', str(expected_year))]

    if not found_years or not expected_years:
        return False

    min_expected = min(expected_years)
    max_expected = max(expected_years)
    return any(min_expected <= year <= max_expected for year in found_years)


def format_academic_period(expected_year, expected_semester=None):
    parts = []
    if expected_year:
        parts.append(str(expected_year).strip())

    normalized_semester = normalize_semester_label(expected_semester)
    if normalized_semester:
        parts.append(normalized_semester)

    return ' '.join(parts) if parts else 'current academic period'


def student_name_matches_text(raw_text, first_name, middle_name, last_name):
    name_ok, _, _, match_ratio = _perform_text_matching(
        raw_text,
        first_name,
        middle_name,
        last_name,
        None,
        None,
        False,
    )
    return name_ok, match_ratio


def normalize_alphanumeric(value):
    return re.sub(r'[^a-z0-9]+', '', str(value or '').lower())


def id_number_matches_text(raw_text, expected_id_number):
    normalized_expected = normalize_alphanumeric(expected_id_number)
    if not normalized_expected:
        return True, None

    normalized_raw = normalize_alphanumeric(raw_text)
    if normalized_expected in normalized_raw:
        return True, expected_id_number

    raw_tokens = [normalize_alphanumeric(token) for token in re.findall(r'[A-Za-z0-9-]+', str(raw_text or ''))]
    raw_tokens = [token for token in raw_tokens if len(token) >= max(4, len(normalized_expected) - 2)]
    for token in raw_tokens:
        if not token:
            continue
        if token == normalized_expected:
            return True, token

    return False, None


def parse_expected_year_level(value):
    match = re.search(r'\b([1-9])(?:st|nd|rd|th)?\b', str(value or '').lower())
    return match.group(1) if match else None


def year_level_matches_text(raw_text, expected_year_level):
    expected_level = parse_expected_year_level(expected_year_level)
    if not expected_level:
        return True, None

    level_word_map = {
        '1': ['first', 'freshman', 'freshmen', 'freshie'],
        '2': ['second', 'sophomore'],
        '3': ['third', 'junior'],
        '4': ['fourth', 'senior'],
        '5': ['fifth'],
        '6': ['sixth'],
    }
    
    # Common OCR misreads for suffixes like 'st', 'nd', 'rd', 'th'
    # Handling L/I misreads specifically for '1st' -> 'ist', 'lst'
    suffix_map = {
        '1': [r'st', r'ist', r'lst', r'Is\b'], 
        '2': [r'nd', r'md'], 
        '3': [r'rd', r'kd'],
        '4': [r'th']
    }
    
    suffixes = suffix_map.get(expected_level, [r'st|nd|rd|th'])
    suffix_pattern = f"(?:{'|'.join(suffixes)})"
    
    level_words = level_word_map.get(expected_level, [expected_level])
    level_words_pattern = f"(?:{'|'.join(level_words)})"

    patterns = [
        # Standard: 1st Year, 1st Yr, 1stYear
        rf'\b{expected_level}{suffix_pattern}(?:\s*(?:year|yr\.?)?)?\b',
        # Labels: Year Level: 1, Level: 1, Year: 1
        rf'\b(?:year\s*)?level\s*[:\-]?\s*(?:{expected_level}{suffix_pattern}|{expected_level})\b',
        rf'\byear\s*[:\-]?\s*(?:{expected_level}{suffix_pattern}|{expected_level})\b',
        rf'\byr\.?\s*(?:{expected_level}{suffix_pattern}|{expected_level})\b',
        # Word-based: First Year, Freshman
        rf'\b{level_words_pattern}(?:\s*(?:year|yr\.?)?)?\b',
        # Numerical standalone with context (e.g. "Year 1")
        rf'\byear\s+{expected_level}\b',
    ]
    
    lowered_text = str(raw_text or '').lower()

    for pattern in patterns:
        if re.search(pattern, lowered_text, re.IGNORECASE):
            return True, expected_level

    # Ultra-lenient fallback for 1st Year specifically (highest error rate)
    if expected_level == '1':
        if re.search(r'\b[Il][s\d]t\b', lowered_text): # Matches 'Ist', 'lst', '1st'
            return True, '1'

    return False, None


def course_matches_text(raw_text, expected_course):
    if not expected_course:
        return True, None

    normalized_raw = normalize_matching_text(raw_text)
    normalized_course = normalize_matching_text(expected_course)
    if normalized_course and normalized_course in normalized_raw:
        return True, expected_course

    stop_words = {'bachelor', 'science', 'arts', 'in', 'of', 'the', 'program', 'course'}
    course_words = [
        word for word in normalized_course.split()
        if len(word) >= 3 and word not in stop_words
    ]
    raw_words = set(normalized_raw.split())
    if course_words:
        matched_words = 0
        for word in course_words:
            if word in raw_words or any(word in raw_word or raw_word in word for raw_word in raw_words if len(raw_word) >= 3):
                matched_words += 1

        required_matches = 1 if len(course_words) == 1 else min(2, len(course_words))
        if matched_words >= required_matches:
            return True, expected_course

    acronym_words = [word for word in normalized_course.split() if word and word not in stop_words]
    acronym = ''.join(word[0] for word in acronym_words if word[0].isalnum()).lower()
    normalized_raw_compact = normalize_alphanumeric(raw_text)
    if len(acronym) >= 3 and acronym in normalized_raw_compact:
        return True, acronym.upper()

    return False, None


def gpa_matches_text(raw_text, expected_gpa):
    match = re.search(r'\d+(?:\.\d+)?', str(expected_gpa or ''))
    if not match:
        return True, None

    expected_value = float(match.group(0))
    raw_numbers = [float(number) for number in re.findall(r'\d+(?:\.\d+)?', str(raw_text or ''))]
    if not raw_numbers:
        return False, None

    tolerance = 0.10 if expected_value <= 5 else 1.0
    for number in raw_numbers:
        if abs(number - expected_value) <= tolerance:
            return True, number

    return False, None


def get_announcement_image_columns(cursor):
    global _announcement_image_columns

    if _announcement_image_columns is not None:
        return _announcement_image_columns

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

    primary_key_column = 'ann_img_no' if 'ann_img_no' in columns else 'sch_img_no' if 'sch_img_no' in columns else None
    foreign_key_column = 'ann_no' if 'ann_no' in columns else 'req_no' if 'req_no' in columns else None

    if not primary_key_column or not foreign_key_column or 'img' not in columns:
        raise RuntimeError('announcement_images table does not contain the expected image columns')

    _announcement_image_columns = (primary_key_column, foreign_key_column)
    return _announcement_image_columns


def ensure_applicant_status_created_at_column(cursor):
    global _applicant_status_created_at_checked

    if _applicant_status_created_at_checked:
        return

    cursor.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_name='applicant_status' AND column_name='created_at'
            ) THEN
                ALTER TABLE applicant_status
                ADD COLUMN created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
            END IF;
        END $$;
        """
    )
    _applicant_status_created_at_checked = True


def _cache_video_fetch(url, content, error):
    now = time.time()
    with _video_fetch_cache_lock:
        _video_fetch_cache[url] = {
            'content': content,
            'error': error,
            'timestamp': now,
        }
        _video_fetch_cache.move_to_end(url)
        while len(_video_fetch_cache) > _VIDEO_FETCH_CACHE_SIZE_LIMIT:
            _video_fetch_cache.popitem(last=False)


def _get_cached_video_fetch(url):
    now = time.time()
    with _video_fetch_cache_lock:
        cached = _video_fetch_cache.get(url)
        if not cached:
            return None
        if now - cached['timestamp'] > _VIDEO_FETCH_CACHE_TTL_SECONDS:
            _video_fetch_cache.pop(url, None)
            return None
        _video_fetch_cache.move_to_end(url)
        return cached['content'], cached['error']


def prefetch_video_urls(urls, max_workers=3):
    unique_urls = []
    seen = set()
    for url in urls:
        if not isinstance(url, str):
            continue
        normalized = url.strip()
        if not normalized or not normalized.startswith('http'):
            continue
        if normalized in seen:
            continue
        seen.add(normalized)
        unique_urls.append(normalized)

    if not unique_urls:
        return

    with ThreadPoolExecutor(max_workers=min(max_workers, len(unique_urls))) as executor:
        futures = [executor.submit(fetch_video_bytes_from_url, url) for url in unique_urls]
        for future in futures:
            try:
                future.result()
            except Exception:
                pass

def fetch_video_bytes_from_url(url):
    if not url: return None, "No URL provided"
    if not isinstance(url, str) or not url.startswith('http'):
        return None, f"Invalid URL: {url}"

    normalized_url = url.strip()
    cached = _get_cached_video_fetch(normalized_url)
    if cached is not None:
        content, error = cached
        if content is not None:
            print(f"[VIDEO FETCH CACHE] Reusing {len(content)} bytes for: {normalized_url}", flush=True)
        return content, error
        
    try:
        print(f"[VIDEO FETCH] Fetching video from: {normalized_url}", flush=True)
        # Use requests with a reasonable timeout and user-agent
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ISKOMATS-Verification-Bot/1.0'
        }
        
        url_to_fetch = normalized_url
        # If it's a Supabase URL, try to use the Service Role Key for authentication
        # (This allows fetching from private buckets)
        supabase_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
        if supabase_key and 'supabase.co' in url:
            if '/object/public/' in url:
                url_to_fetch = url.replace('/object/public/', '/object/authenticated/')
                
            headers['apikey'] = supabase_key
            headers['Authorization'] = f"Bearer {supabase_key}"
            print("[VIDEO FETCH] Attaching Supabase Service Role credentials to authenticated endpoint...", flush=True)

        response = requests.get(url_to_fetch, headers=headers, timeout=15)
        
        if response.status_code == 200:
            content = response.content
            print(f"[VIDEO FETCH] Successfully fetched {len(content)} bytes", flush=True)
            _cache_video_fetch(normalized_url, content, None)
            return content, None
        else:
            err_msg = f"HTTP {response.status_code}"
            print(f"[VIDEO FETCH] {err_msg} for {url_to_fetch}", flush=True)
            _cache_video_fetch(normalized_url, None, err_msg)
            return None, err_msg
    except requests.exceptions.Timeout:
        _cache_video_fetch(normalized_url, None, "Connection timeout")
        return None, "Connection timeout"
    except Exception as e:
        error_message = str(e)
        _cache_video_fetch(normalized_url, None, error_message)
        return None, error_message


def is_trusted_storage_url(url):
    if not isinstance(url, str):
        return False

    try:
        parsed_url = urlparse(url.strip())
    except Exception:
        return False

    if parsed_url.scheme not in ('http', 'https') or not parsed_url.netloc:
        return False

    supabase_url = os.environ.get('SUPABASE_URL', '').strip()
    if supabase_url:
        try:
            supabase_host = urlparse(supabase_url).netloc.lower()
            if parsed_url.netloc.lower() == supabase_host:
                return True
        except Exception:
            pass

    return parsed_url.netloc.lower().endswith('.supabase.co')


def resolve_verification_image_bytes(image_data):
    if isinstance(image_data, memoryview):
        return image_data.tobytes()
    if isinstance(image_data, (bytes, bytearray)):
        return bytes(image_data)
    if not isinstance(image_data, str):
        return None

    normalized = image_data.strip()
    if not normalized:
        return None

    decoded = decode_base64(normalized)
    if decoded:
        return decoded

    if normalized.startswith('http') and is_trusted_storage_url(normalized):
        content, _error = fetch_video_bytes_from_url(normalized)
        return content

    return None


def normalize_matching_text(value):
    return re.sub(r'[^a-z0-9]+', ' ', str(value or '').lower()).strip()


def build_student_name_keywords(first_name, middle_name, last_name):
    name_parts = [part.strip() for part in [first_name, middle_name, last_name] if str(part or '').strip()]
    keywords = set(name_parts)

    if len(name_parts) >= 2:
        keywords.add(' '.join(name_parts))
        keywords.add(f"{name_parts[0]} {name_parts[-1]}")

    return sorted((keyword for keyword in keywords if len(normalize_matching_text(keyword)) >= 2), key=len, reverse=True)


def build_school_name_variants(school_name):
    normalized_input = normalize_matching_text(school_name)
    variants = set()

    for entry in HARD_CODED_SCHOOL_NAMES:
        aliases = [alias.strip() for alias in entry.split('/') if alias.strip()]
        normalized_aliases = [normalize_matching_text(alias) for alias in aliases]
        is_match = normalized_input and any(
            normalized_input in alias or alias in normalized_input
            for alias in normalized_aliases
            if alias
        )

        if is_match:
            variants.update(aliases)

    if not variants and school_name:
        variants.add(school_name.strip())

    expanded = set()
    for variant in variants:
        cleaned = variant.strip()
        if not cleaned:
            continue

        expanded.add(cleaned)
        normalized = normalize_matching_text(cleaned)
        if normalized:
            expanded.add(normalized)

        words = [word for word in re.split(r'[\s./-]+', cleaned) if word]
        if len(words) > 1:
            acronym = ''.join(word[0] for word in words if word[0].isalnum()).upper()
            if len(acronym) >= 2:
                expanded.add(acronym)

    return sorted((variant for variant in expanded if len(normalize_matching_text(variant)) >= 2), key=len, reverse=True)


def school_name_matches_text(raw_text, school_name):
    variants = build_school_name_variants(school_name)
    normalized_raw = normalize_matching_text(raw_text)
    raw_words = set(normalized_raw.split())
    ignore_words = {'de', 'la', 'ng', 'of', 'the', 'and', 'campus', 'office'}

    for variant in variants:
        normalized_variant = normalize_matching_text(variant)
        if normalized_variant and normalized_variant in normalized_raw:
            return True, variant, variants

    _, _, found_keywords, _ = _perform_text_matching(
        raw_text,
        None,
        None,
        None,
        None,
        keywords=variants,
        is_indigency=False
    )
    if found_keywords:
        return True, found_keywords[0], variants

    for variant in variants:
        normalized_variant = normalize_matching_text(variant)
        if not normalized_variant:
            continue

        variant_words = [
            word for word in normalized_variant.split()
            if len(word) >= 4 and word not in ignore_words
        ]
        if len(variant_words) < 2:
            continue

        matched_words = 0
        for word in variant_words:
            if word in raw_words:
                matched_words += 1
                continue

            if any(word in raw_word or raw_word in word for raw_word in raw_words if len(raw_word) >= 3):
                matched_words += 1

        if matched_words >= 2:
            return True, variant, variants

    return False, None, variants

@student_api_bp.route('/debug/env', methods=['GET'])
def debug_env():
    """Temporary debug route to check server configuration."""
    return jsonify({
        'GOOGLE_CLIENT_ID': os.environ.get('GOOGLE_CLIENT_ID'),
        'GMAIL_SENDER_EMAIL': os.environ.get('GMAIL_SENDER_EMAIL'),
        'HAS_ENV_FILE': os.path.exists('.env'),
        'PROJECT_ROOT': str(os.getcwd())
    })

ENCRYPTION_KEY = os.environ.get('ENCRYPTION_KEY')
if ENCRYPTION_KEY and isinstance(ENCRYPTION_KEY, str):
    ENCRYPTION_KEY = ENCRYPTION_KEY.encode()
fernet = Fernet(ENCRYPTION_KEY) if ENCRYPTION_KEY else None
    
# Password Reset Config
PASSWORD_RESET_EXPIRY_MINUTES = int(os.environ.get('PASSWORD_RESET_EXPIRY_MINUTES', '30'))
# Use the specific deployed domain for student portal links
STUDENT_FRONTEND_URL = os.environ.get('STUDENT_FRONTEND_URL', 'https://foregoing-giants.surge.sh').rstrip('/')
GMAIL_SENDER_EMAIL = os.environ.get('GMAIL_SENDER_EMAIL')
GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID')
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET')
GOOGLE_REFRESH_TOKEN = os.environ.get('GOOGLE_REFRESH_TOKEN')

# Database Migration: Ensure auth-related support tables exist
def ensure_verification_columns():
    try:
        conn = get_db_startup()  # Fast-fail: 3 retries × 0.5s to avoid 300s deploy stall
        cur = conn.cursor()

        # Create pending_registrations table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS pending_registrations (
                pr_no SERIAL PRIMARY KEY,
                email_address TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                first_name TEXT NOT NULL,
                middle_name TEXT,
                last_name TEXT NOT NULL,
                verification_code VARCHAR(10) NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        
        # Create notifications table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS notifications (
                notif_id SERIAL PRIMARY KEY,
                user_no INTEGER REFERENCES applicants(applicant_no),
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                type VARCHAR(50), -- 'message', 'announcement', 'scholarship', 'result'
                is_read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        
        # Legacy compatibility: keep applicant video columns only while documents still live on applicants.
        if not get_applicant_document_table(cur):
            video_cols = {
                'id_vid_url': 'id_vid_url',
                'indigency_vid_url': 'indigency_vid_url',
                'grades_vid_url': 'grades_vid_url',
                'enrollment_certificate_vid_url': 'enrollment_certificate_vid_url',
                'schoolid_front_vid_url': 'schoolid_front_vid_url',
                'schoolid_back_vid_url': 'schoolid_back_vid_url'
            }
            
            cur.execute("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'applicants' AND column_name IN %s
            """, (tuple(video_cols.keys()),))
            existing_cols = [row['column_name'] for row in cur.fetchall()]
            
            for col in video_cols.keys():
                if col not in existing_cols:
                    print(f"[MIGRATION] Adding column {col} to applicants table")
                    cur.execute(f"ALTER TABLE applicants ADD COLUMN {col} TEXT")
            
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[MIGRATION ERROR] {e}", flush=True)

try:
    ensure_verification_columns()
except Exception as e:
    print(f"[STARTUP ERROR] Verification migration failed: {e}", flush=True)

def generate_password_reset_token(user_no, email):
    """Generate a time-limited password reset token for students."""
    payload = {
        'purpose': 'password-reset',
        'user_no': user_no,
        'email': email,
        'type': 'student',
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


def send_password_reset_email(receiver_email, reset_url):
    """Send a password reset email via the Gmail API."""
    from urllib import request as urllib_request
    from email.mime.text import MIMEText
    import json
    
    if not GMAIL_SENDER_EMAIL:
        raise RuntimeError('Gmail sender email is not configured.')

    body = f"""Hello,

We received a request to reset your student password for ISKOMATS.

Use the link below to set a new password:
{reset_url}

This link will expire in {PASSWORD_RESET_EXPIRY_MINUTES} minutes.

If you did not request a password reset, you can ignore this email.
"""
    msg = MIMEText(body)
    msg['Subject'] = 'Reset your ISKOMATS Student Password'
    msg['From'] = GMAIL_SENDER_EMAIL
    msg['To'] = receiver_email

    access_token = fetch_google_access_token()
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
    urllib_request.urlopen(gmail_request, timeout=30)


def token_required(route_handler):
    @wraps(route_handler)
    def decorated(*args, **kwargs):
        # Skip token validation for OPTIONS (preflight) requests
        if request.method == 'OPTIONS':
            return '', 204 # Return empty response - CORS headers added by after_request
        
        token = request.headers.get('Authorization')
        if not token:
            return jsonify({'message': 'Token is missing'}), 401

        try:
            if token.startswith('Bearer '):
                token = token[7:]
            data = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
            applicant_no = data.get('user_no')
            request.user_no = applicant_no

            # Real-time suspension check
            try:
                conn = get_db()
                cur = conn.cursor()
                applicant_email_table = get_applicant_email_table(cur)
                cur.execute(f'SELECT is_locked FROM {applicant_email_table} WHERE applicant_no = %s', (applicant_no,))
                lock_row = cur.fetchone()
                cur.close()
                conn.close()
                if lock_row and lock_row.get('is_locked'):
                    return jsonify({'message': 'Account has been suspended. Please contact the administrator.', 'suspended': True}), 403
            except Exception as lock_err:
                print(f'[AUTH] Lock check error: {lock_err}', flush=True)

        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Token is invalid'}), 401

        return route_handler(*args, **kwargs)

    return decorated


def decode_base64(data_uri):
    if not data_uri or not isinstance(data_uri, str):
        return None
    try:
        payload = data_uri.strip()
        if payload.startswith('data:'):
            if ',' not in payload:
                return None
            payload = payload.split(',', 1)[1]
        return base64.b64decode(payload, validate=True)
    except Exception:
        return None


def db_bytes(value):
    if isinstance(value, memoryview):
        return value.tobytes()
    return value


def decode_signature(value):
    if isinstance(value, str):
        decoded = decode_base64(value)
    else:
        decoded = db_bytes(value)

    if decoded and fernet:
        try:
            return fernet.decrypt(decoded)
        except Exception:
            return decoded

    return decoded


def generate_verification_code():
    """Generate a random 6-digit verification code."""
    import random
    return str(random.randint(100000, 999999))


def send_verification_email(receiver_email, code):
    """Send a verification email via the Gmail API."""
    from urllib import request as urllib_request
    from email.mime.text import MIMEText
    import json
    
    if not GMAIL_SENDER_EMAIL:
        raise RuntimeError('Gmail sender email is not configured.')

    body = f"""Hello,

Thank you for registering with ISKOMATS. To complete your registration, please use the following verification code:

{code}

If you did not register for an account, please ignore this email.

Best regards,
The ISKOMATS Team
"""
    msg = MIMEText(body)
    msg['Subject'] = 'Verify your ISKOMATS Account'
    msg['From'] = GMAIL_SENDER_EMAIL
    msg['To'] = receiver_email

    try:
        access_token = fetch_google_access_token()
    except Exception as e:
        print(f"[GOOGLE AUTH ERROR] {e}", flush=True)
        raise RuntimeError(f"Authentication with Google failed: {e}")

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
    
    try:
        with urllib_request.urlopen(email_request, timeout=30) as response:
            return json.loads(response.read().decode('utf-8'))
    except urllib_error.HTTPError as e:
        # Most likely Gmail API rejected the access token (expired or revoked)
        if e.code == 401:
            raise RuntimeError("Gmail API rejected the access token. Your Google Refresh Token may have expired or been revoked.")
        raise RuntimeError(f"Gmail API error {e.code}: {e.reason}")
    except Exception as e:
        raise RuntimeError(f"Failed to communicate with Gmail API: {str(e)}")




@student_api_bp.route('/notifications', methods=['GET'])
@token_required
def get_notifications():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT notif_id as id, title, message, type, is_read as read, created_at
            FROM notifications
            WHERE user_no = %s
            ORDER BY created_at DESC
            LIMIT 50
        """, (request.user_no,))
        rows = cur.fetchall()
        conn.close()
        
        # Format dates for frontend
        for row in rows:
            if row['created_at']:
                row['time'] = row['created_at'].strftime('%Y-%m-%d %H:%M:%S')
                # Add a relative time if possible, or just keep it simple
            else:
                row['time'] = 'Just now'
            
            # Map type to icon
            type_icons = {
                'message': 'fa-comment-alt',
                'announcement': 'fa-bullhorn',
                'scholarship': 'fa-graduation-cap',
                'result': 'fa-file-signature'
            }
            row['icon'] = type_icons.get(row['type'], 'fa-bell')
            
        return jsonify(rows), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500


@student_api_bp.route('/notifications/read/<int:notif_id>', methods=['POST'])
@token_required
def mark_notification_read(notif_id):
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            UPDATE notifications 
            SET is_read = TRUE 
            WHERE notif_id = %s AND user_no = %s
        """, (notif_id, request.user_no))
        conn.commit()
        conn.close()
        return jsonify({'message': 'Success'}), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500


@student_api_bp.route('/notifications/read-all', methods=['POST'])
@token_required
def mark_all_notifications_read():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            UPDATE notifications 
            SET is_read = TRUE 
            WHERE user_no = %s
        """, (request.user_no,))
        conn.commit()
        conn.close()
        return jsonify({'message': 'Success'}), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500


@student_api_bp.route('/auth/login', methods=['POST'])
def student_login():
    data = request.get_json() or {}
    email = data.get('email', '').strip()
    password = data.get('password', '')

    try:
        conn = get_db()
        cur = conn.cursor()
        applicant_email_table = get_applicant_email_table(cur)
        # Only allow applicant logins - must have applicant_no
        cur.execute(
            f"""
            SELECT app_em_no, applicant_no, password_hash, is_locked
            FROM {applicant_email_table}
            WHERE email_address ILIKE %s AND applicant_no IS NOT NULL
            """,
            (email,),
        )
        user = cur.fetchone()

        # If email not found in permanent email table, check if it exists in pending registrations
        if not user:
            cur.execute(
                "SELECT email_address FROM pending_registrations WHERE email_address ILIKE %s",
                (email,),
            )
            pending_reg = cur.fetchone()
            if pending_reg:
                return jsonify({'message': 'Email not verified. Please check your email and enter the verification code to complete registration.', 'requires_verification': True}), 401
            else:
                return jsonify({'message': 'Email does not exist. Please register first.'}), 401

        if not bcrypt.check_password_hash(user['password_hash'], password):
            return jsonify({'message': 'Incorrect password'}), 401

        if user.get('is_locked'):
            return jsonify({'message': 'Account has been suspended. Please contact the administrator.', 'suspended': True}), 403
 
        payload = {
            'exp': datetime.utcnow() + timedelta(days=7),
            'iat': datetime.utcnow(),
            'user_no': user['applicant_no'],
        }
        token = jwt.encode(payload, SECRET_KEY, algorithm='HS256')

        return jsonify({
            'token': token,
            'user_no': payload['user_no'],
            'applicant_no': user['applicant_no'],
            'is_applicant': True,
        })
    except Exception as exc:
        return jsonify({'message': f'Error: {str(exc)}'}), 500
    finally:
        if 'conn' in locals():
            conn.close()


@student_api_bp.route('/auth/register', methods=['POST'])
def student_register():
    data = request.get_json() or {}
    first_name = data.get('first_name', '').strip()
    middle_name = data.get('middle_name', '').strip()
    last_name = data.get('last_name', '').strip()
    email = data.get('email', '').strip()
    password = data.get('password', '')

    if not all([first_name, last_name, email, password]):
        return jsonify({'message': 'Missing required fields'}), 400

    try:
        conn = get_db()
        cur = conn.cursor()
        applicant_email_table = get_applicant_email_table(cur)
        
        # 1. Check if email ALREADY exists as an APPLICANT (applicant_no is not NULL)
        # Admin emails (user_no only) are allowed to register as applicant
        cur.execute(f'SELECT app_em_no FROM {applicant_email_table} WHERE email_address ILIKE %s AND applicant_no IS NOT NULL LIMIT 1', (email,))
        if cur.fetchone():
            return jsonify({'message': 'Email already registered as applicant and verified. Please sign in.'}), 400

        # 2. Generate verification code
        verification_code = generate_verification_code()
        password_hash = bcrypt.generate_password_hash(password).decode('utf-8')

        # 3. Store in pending_registrations table (Upsert allowed for re-registration)
        cur.execute(
            """
            INSERT INTO pending_registrations (email_address, password_hash, first_name, middle_name, last_name, verification_code)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (email_address) DO UPDATE SET
                password_hash = EXCLUDED.password_hash,
                first_name = EXCLUDED.first_name,
                middle_name = EXCLUDED.middle_name,
                last_name = EXCLUDED.last_name,
                verification_code = EXCLUDED.verification_code,
                created_at = NOW()
            """,
            (email, password_hash, first_name, middle_name or None, last_name, verification_code),
        )
        conn.commit()

        # 4. Send verification email
        try:
            send_verification_email(email, verification_code)
        except Exception as e:
            print(f"[EMAIL ERROR] Failed to send verification email during registration: {e}", flush=True)
            # Rollback or at least inform the user
            return jsonify({'message': f'Registration failed because the verification email could not be sent: {str(e)}'}), 500

        return jsonify({
            'message': 'Registration initiated. Please check your email for the verification code.',
            'is_applicant': True,
            'requires_verification': True
        }), 201
    except Exception as exc:
        return jsonify({'message': f'Error: {str(exc)}'}), 500
    finally:
        if 'conn' in locals():
            conn.close()


@student_api_bp.route('/auth/verify-email', methods=['POST'])
def student_verify_email():
    data = request.get_json() or {}
    email = data.get('email', '').strip()
    token = data.get('token', '').strip()

    if not token:
        return jsonify({'message': 'Verification code is required'}), 400

    try:
        conn = get_db()
        cur = conn.cursor()
        applicant_email_table = get_applicant_email_table(cur)
        
        # 1. Look up in pending_registrations
        if email:
            cur.execute('SELECT * FROM pending_registrations WHERE email_address ILIKE %s', (email,))
        else:
            cur.execute('SELECT * FROM pending_registrations WHERE verification_code = %s', (token,))
            
        pending = cur.fetchone()

        if not pending:
            # Check if already verified as applicant
            if email:
                cur.execute(f'SELECT app_em_no FROM {applicant_email_table} WHERE email_address ILIKE %s AND applicant_no IS NOT NULL', (email,))
                if cur.fetchone():
                    return jsonify({'message': 'Email already verified. Please sign in.'}), 200
            return jsonify({'message': 'Invalid verification code or link has expired'}), 400

        if pending['verification_code'] != token:
            return jsonify({'message': 'Incorrect verification code'}), 400

        # 2. Promote to permanent tables
        # Insert into applicants
        cur.execute(
            """
            INSERT INTO applicants (first_name, middle_name, last_name)
            VALUES (%s, %s, %s)
            RETURNING applicant_no
            """,
            (pending['first_name'], pending['middle_name'], pending['last_name']),
        )
        applicant_no = cur.fetchone()['applicant_no']

        # Insert into applicant auth table
        cur.execute(
            f"""
            INSERT INTO {applicant_email_table} (email_address, applicant_no, password_hash)
            VALUES (%s, %s, %s)
            """,
            (pending['email_address'], applicant_no, pending['password_hash']),
        )

        # 3. Cleanup pending registration
        cur.execute('DELETE FROM pending_registrations WHERE pr_no = %s', (pending['pr_no'],))
        
        conn.commit()

        # 4. Generate session token
        payload = {
            'exp': datetime.utcnow() + timedelta(days=7),
            'iat': datetime.utcnow(),
            'user_no': applicant_no,
        }
        session_token = jwt.encode(payload, SECRET_KEY, algorithm='HS256')

        return jsonify({
            'message': 'Email verified successfully',
            'token': session_token,
            'user_no': applicant_no,
            'is_applicant': True
        }), 200
    except Exception as exc:
        return jsonify({'message': f'Error: {str(exc)}'}), 500
    finally:
        if 'conn' in locals():
            conn.close()


@student_api_bp.route('/auth/resend-verification-email', methods=['POST'])
def student_resend_verification_email():
    data = request.get_json() or {}
    email = data.get('email', '').strip()

    if not email:
        return jsonify({'message': 'Email is required'}), 400

    try:
        conn = get_db()
        cur = conn.cursor()
        applicant_email_table = get_applicant_email_table(cur)
        
        # 1. Check if email exists in permanent table (already verified)
        cur.execute(f'SELECT app_em_no FROM {applicant_email_table} WHERE email_address ILIKE %s', (email,))
        user = cur.fetchone()
        if user:
            return jsonify({'message': 'Email already verified. Please sign in.'}), 400

        # 2. Check if email exists in pending registrations
        cur.execute('SELECT pr_no FROM pending_registrations WHERE email_address ILIKE %s', (email,))
        pending = cur.fetchone()

        if not pending:
            return jsonify({'message': 'No pending registration found for this email. Please register first.'}), 404

        # 3. Generate new code and update
        new_code = generate_verification_code()
        cur.execute('UPDATE pending_registrations SET verification_code = %s WHERE pr_no = %s', (new_code, pending['pr_no']))
        conn.commit()

        # 4. Send email
        try:
            send_verification_email(email, new_code)
        except Exception as e:
            print(f"[EMAIL ERROR] Failed to resend verification email: {e}", flush=True)
            return jsonify({'message': f'Failed to send email: {str(e)}'}), 500

        return jsonify({'message': 'Verification email resent successfully'}), 200
    except Exception as exc:
        return jsonify({'message': f'Error: {str(exc)}'}), 500
    finally:
        if 'conn' in locals():
            conn.close()


@student_api_bp.route('/auth/check-email', methods=['POST'])
def student_check_email():
    """
    Check if email is available for applicant registration.
    Only rejects if email already has an applicant account.
    Allows registration even if email is used as admin account.
    
    Request body:
    {
        "email": "user@example.com"
    }
    
    Response:
    - If email is NOT used for applicant account: available=true (can register)
    - If email IS used for applicant account: available=false (conflict)
    """
    data = request.get_json() or {}
    email = data.get('email', '').strip()

    try:
        conn = get_db()
        cur = conn.cursor()
        applicant_email_table = get_applicant_email_table(cur)
        user_email_table = get_user_email_table(cur)
        
        cur.execute(f'SELECT applicant_no FROM {applicant_email_table} WHERE email_address ILIKE %s LIMIT 1', (email,))
        applicant_result = cur.fetchone()
        if applicant_result:
            return jsonify({
                'exists': True,
                'account_type': 'applicant',
                'available': False,
                'message': 'Email already registered as applicant'
            })

        cur.execute(f'SELECT user_no FROM {user_email_table} WHERE email_address ILIKE %s LIMIT 1', (email,))
        admin_result = cur.fetchone()

        if admin_result:
            return jsonify({
                'exists': True,
                'account_type': 'admin',
                'available': True,
                'message': 'Email available for applicant registration'
            })
        else:
            return jsonify({
                'exists': False,
                'account_type': None,
                'available': True,
                'message': 'Email available'
            })
    except Exception as exc:
        return jsonify({'message': str(exc)}), 500
    finally:
        if 'conn' in locals():
            conn.close()


@student_api_bp.route('/auth/google', methods=['POST'])
def student_google_login():
    """Sign in student with Google OAuth"""
    data = request.get_json() or {}
    token = data.get('idToken')
    
    if not token:
        return jsonify({'message': 'Google ID token is required'}), 400

    try:
        # 1. Verify Google token and get profile
        google_profile = verify_google_token(token)
        email = google_profile['email']
        
        # 2. Check if user exists
        conn = get_db()
        cur = conn.cursor()
        applicant_email_table = get_applicant_email_table(cur)
        cur.execute(
            f"""
            SELECT e.applicant_no, e.email_address, a.first_name, a.last_name
            FROM {applicant_email_table} e
            JOIN applicants a ON e.applicant_no = a.applicant_no
            WHERE e.email_address ILIKE %s
            LIMIT 1
            """,
            (email,),
        )
        user = cur.fetchone()
        
        # 3. Handle Existing vs. New user
        if user:
            # If the profile is still the default "User Account", update it with Google's real name
            # This allows the user to go directly to the portal without being forced into 'Profile Setup'
            if user['first_name'] == 'User' and user['last_name'] == 'Account':
                cur.execute(
                    "UPDATE applicants SET first_name = %s, last_name = %s WHERE applicant_no = %s",
                    (google_profile['first_name'], google_profile['last_name'], user['applicant_no'])
                )
                # Update our local record for the JWT and response
                user['first_name'] = google_profile['first_name']
                user['last_name'] = google_profile['last_name']
            
            conn.commit()
            print(f"[GOOGLE AUTH] Existing user {email} synced and verified.", flush=True)

        else:
            # Create user if doesn't exist (Auto-register)
            print(f"[GOOGLE AUTH] New user {email}, creating profile...", flush=True)
            # Create applicant record first
            cur.execute(
                """
                INSERT INTO applicants (first_name, middle_name, last_name)
                VALUES (%s, %s, %s)
                RETURNING applicant_no
                """,
                (google_profile['first_name'], '', google_profile['last_name']),
            )
            applicant_no = cur.fetchone()['applicant_no']
            
            # Create email/auth record
            cur.execute(
                f"""
                INSERT INTO {applicant_email_table} (applicant_no, email_address)
                VALUES (%s, %s)
                RETURNING app_em_no
                """,
                (applicant_no, email),
            )
            cur.fetchone()['app_em_no']
            conn.commit()
            
            user = {
                'applicant_no': applicant_no,
                'email_address': email,
                'first_name': google_profile['first_name'],
                'last_name': google_profile['last_name']
            }
        
        # 4. Generate JWT
        token_payload = {
            'user_no': user['applicant_no'],
            'email': user['email_address'],
            'exp': datetime.utcnow() + timedelta(days=7)
        }
        jwt_token = jwt.encode(token_payload, SECRET_KEY, algorithm='HS256')

        return jsonify({
            'token': jwt_token,
            'email': user['email_address'],
            'applicant_no': user['applicant_no'],
            'first_name': user['first_name'],
            'last_name': user['last_name']
        }), 200
        
    except Exception as exc:
        traceback.print_exc()
        return jsonify({'message': f'Google authentication failed: {str(exc)}'}), 401
    finally:
        if 'conn' in locals():
            conn.close()


@student_api_bp.route('/auth/validate', methods=['GET'])
@token_required
def validate_student_token():
    return jsonify({'message': 'Token is valid', 'user_no': request.user_no})


@student_api_bp.route('/auth/forgot-password', methods=['POST'])
def student_forgot_password():
    """Request password reset for student - Applicants only"""
    data = request.get_json() or {}
    email = data.get('email', '').strip()
    
    if not email:
        return jsonify({'message': 'Email is required'}), 400

    try:
        conn = get_db()
        cur = conn.cursor()
        applicant_email_table = get_applicant_email_table(cur)
        user_email_table = get_user_email_table(cur)
        
        # Check if email exists as an applicant
        cur.execute(
            f"""
            SELECT e.applicant_no, e.email_address, a.first_name, a.last_name
            FROM {applicant_email_table} e
            JOIN applicants a ON e.applicant_no = a.applicant_no
            WHERE e.email_address ILIKE %s
            LIMIT 1
            """,
            (email,),
        )
        user = cur.fetchone()
        
        # If not found as applicant, check if it exists as an admin user (to treat as not found)
        if not user:
            cur.execute(
                f"""
                SELECT e.user_no
                FROM {user_email_table} e
                JOIN users u ON e.user_no = u.user_no
                WHERE e.email_address ILIKE %s
                LIMIT 1
                """,
                (email,),
            )
            admin_user = cur.fetchone()
            if admin_user:
                print(f"[PASSWORD RESET] Email {email} is registered as admin user, not applicant")
        
        if user:
            reset_token = generate_password_reset_token(user['applicant_no'], user['email_address'])
            reset_url = f"{STUDENT_FRONTEND_URL}/reset-password?token={reset_token}"
            print(f"[PASSWORD RESET] Sending reset email to {user['email_address']}", flush=True)
            print(f"[PASSWORD RESET] Using portal URL: {STUDENT_FRONTEND_URL}", flush=True)
            send_password_reset_email(user['email_address'], reset_url)
            return jsonify({'message': 'A reset link has been sent to your email.'}), 200
        else:
            print(f"[PASSWORD RESET] No applicant account found for email: {email}")
            return jsonify({'message': 'Email not found in our records.'}), 404
    except Exception as exc:
        traceback.print_exc()
        return jsonify({'message': f'Failed to send reset email: {str(exc)}'}), 500
    finally:
        if 'conn' in locals():
            conn.close()


@student_api_bp.route('/auth/reset-password', methods=['POST'])
def student_reset_password():
    """Reset student password with token"""
    data = request.get_json() or {}
    token = data.get('token')
    new_password = data.get('newPassword')
    
    if not all([token, new_password]):
        return jsonify({'message': 'Token and new password are required'}), 400

    try:
        payload = decode_password_reset_token(token)
        hashed_password = bcrypt.generate_password_hash(new_password).decode('utf-8')
        # Robust payload extraction
        user_no_raw = payload.get('user_no')
        email = (payload.get('email') or '').strip().lower()
        
        try:
            user_no = int(user_no_raw) if user_no_raw is not None else None
        except (ValueError, TypeError):
            print(f"[AUTH ERROR] Invalid user_no in token: {user_no_raw}", flush=True)
            return jsonify({'message': 'Invalid token payload: invalid user identification'}), 400

        if not user_no or not email:
            print(f"[AUTH ERROR] Missing user_no or email in token: user_no={user_no}, email={email}", flush=True)
            return jsonify({'message': 'Invalid token payload'}), 400

        print(f"[AUTH] Resetting password for student #{user_no} ({email})", flush=True)

        conn = get_db()
        if not conn:
            print("[AUTH ERROR] Database connection failed during password reset", flush=True)
            return jsonify({'message': 'Database connection error'}), 500
            
        cur = conn.cursor()
        applicant_email_table = get_applicant_email_table(cur)
        
        # Check if record exists first (for better error reporting)
        # Use TRIM and ILIKE for robustness
        cur.execute(f"SELECT applicant_no FROM {applicant_email_table} WHERE applicant_no = %s AND TRIM(email_address) ILIKE %s", (user_no, email))
        if not cur.fetchone():
            # Debug: Check if email exists AT ALL for this applicant_no
            cur.execute(f"SELECT email_address FROM {applicant_email_table} WHERE applicant_no = %s", (user_no,))
            actual_record = cur.fetchone()
            actual_email = actual_record[0] if actual_record else "NOT FOUND"
            print(f"[AUTH ERROR] No matching student record found. Input: applicant_no={user_no}, email='{email}'. DB Record Email: '{actual_email}'", flush=True)
            cur.close()
            conn.close()
            return jsonify({'message': 'No matching account found. The link might be for a different user.'}), 404

        # Update password
        cur.execute(
            f"UPDATE {applicant_email_table} SET password_hash = %s WHERE applicant_no = %s AND TRIM(email_address) ILIKE %s",
            (hashed_password, user_no, email)
        )
        conn.commit()
        
        affected = cur.rowcount
        print(f"[AUTH SUCCESS] Rows updated: {affected}", flush=True)
        
        cur.close()
        conn.close()
        
        if affected == 0:
            return jsonify({'message': 'Failed to update password. Student record not found or unauthorized.'}), 404

        return jsonify({'message': 'Password reset successful'})
    except jwt.ExpiredSignatureError:
        print("[AUTH ERROR] Password reset token expired", flush=True)
        return jsonify({'message': 'Reset link has expired'}), 400
    except jwt.InvalidTokenError as e:
        print(f"[AUTH ERROR] Invalid password reset token: {str(e)}", flush=True)
        return jsonify({'message': 'Invalid reset link'}), 400
    except Exception as e:
        print(f"[AUTH ERROR] Password reset exception: {traceback.format_exc()}", flush=True)
        return jsonify({'message': f'An error occurred: {str(e)}'}), 500
    finally:
        if 'conn' in locals():
            conn.close()


@student_api_bp.route('/scholarships', methods=['GET'])
@student_api_bp.route('/scholarships/all', methods=['GET'])
def get_all_scholarships():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('SELECT * FROM scholarships WHERE COALESCE(is_removed, FALSE) = FALSE ORDER BY scholarship_name')
        rows = cur.fetchall()
        return jsonify(rows)
    except Exception as exc:
        return jsonify({'message': str(exc)}), 500
    finally:
        if 'conn' in locals():
            conn.close()


@student_api_bp.route('/scholarships/<int:req_no>', methods=['GET'])
def get_scholarship_by_id(req_no):
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('SELECT * FROM scholarships WHERE req_no = %s AND COALESCE(is_removed, FALSE) = FALSE', (req_no,))
        row = cur.fetchone()
        if not row:
            return jsonify({'message': 'Scholarship not found'}), 404
        return jsonify(row)
    except Exception as exc:
        return jsonify({'message': str(exc)}), 500
    finally:
        if 'conn' in locals():
            conn.close()


@student_api_bp.route('/scholarships/rankings', methods=['POST'])
def get_rankings():
    data = request.get_json() or {}
    gpa = float(data.get('gpa', 0))
    income = float(data.get('income', 0))
    
    # Construct address from individual parts if full address is missing
    address = data.get('address', '')
    if not address:
        parts = [
            data.get('street_brgy', ''),
            data.get('town_city_municipality', ''),
            data.get('province', ''),
            data.get('zipCode', data.get('zip_code', ''))
        ]
        address = ' '.join(filter(None, parts))
    
    address = address.lower().strip()

    try:
        conn = get_db()
        cur = conn.cursor()
        
        # ─── Optional Auth Check ──────────────────────────────────────
        user_no = None
        token = request.headers.get('Authorization')
        if token:
            try:
                if token.startswith('Bearer '):
                    token = token[7:]
                decoded = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
                user_no = decoded.get('user_no')
            except Exception:
                pass # Non-critical if token is invalid for just ranking
        
        # Get list of scholarships the user has already applied for
        applied_sch_ids = set()
        if user_no:
            cur.execute("SELECT scholarship_no FROM applicant_status WHERE applicant_no = %s", (user_no,))
            applied_sch_ids = {row['scholarship_no'] for row in cur.fetchall()}
        
        cur.execute("""
            SELECT s.*, p.provider_name,
                   COUNT(ast.applicant_no) FILTER (WHERE ast.is_accepted IS TRUE) AS accepted_count
            FROM scholarships s
            LEFT JOIN scholarship_providers p ON s.pro_no = p.pro_no
            LEFT JOIN applicant_status ast ON ast.scholarship_no = s.req_no
            WHERE COALESCE(s.is_removed, FALSE) = FALSE
            GROUP BY s.req_no, p.provider_name
            ORDER BY s.scholarship_name ASC
        """)
        scholarships = cur.fetchall()

        today = datetime.now().date()
        ranked = []
        ineligible = []

        for sch in scholarships:
            deadline = sch.get('deadline')
            is_expired = deadline and deadline < today
            
            score = 0
            reasons = []
            
            if is_expired:
                reasons.append(f"Application deadline has passed ({deadline})")

            slots = sch.get('slots')
            accepted_count = int(sch.get('accepted_count') or 0)
            if slots is not None and int(slots) > 0 and accepted_count >= int(slots):
                reasons.append('No remaining scholarship slots are available')

            # GPA
            min_gpa = sch['gpa']
            if min_gpa is not None and gpa < min_gpa:
                reasons.append(f"GPA {gpa} is lower than required {min_gpa}")
            elif min_gpa:
                score += min(60, (gpa - min_gpa) * 12)

            # Income
            max_inc = sch['parent_finance']
            if max_inc is not None and income > max_inc:
                reasons.append(f"Income ₱{income:,.0f} exceeds limit ₱{max_inc:,.0f}")
            elif max_inc:
                score += min(50, (max_inc - income) // 15000)

            # Location
            loc = sch['location']
            if loc and loc.strip():
                loc_clean = loc.lower().strip()
                address_clean = address.lower().strip()
                
                # Normalize text for better matching
                def normalize_addr(text):
                    if not text: return ""
                    t = text.lower()
                    t = t.replace('brgy.', 'barangay').replace('st.', 'street').replace('city of ', '')
                    return re.sub(r'[^a-z0-9\s]', '', t).strip()

                loc_norm = normalize_addr(loc_clean)
                addr_norm = normalize_addr(address_clean)

                if loc_norm and addr_norm:
                    if loc_norm in addr_norm or addr_norm in loc_norm:
                        score += 100
                    elif any(word in addr_norm.split() for word in loc_norm.split() if len(word) > 2):
                        score += 40
                    else:
                        reasons.append(f"Location does not match requirement '{loc}'")
                elif loc_norm:
                    reasons.append(f"Location does not match requirement '{loc}'")
            else:
                score += 10

            item = {
                'req_no': sch['req_no'],
                'name': sch['scholarship_name'],
                'provider_name': sch.get('provider_name'),
                'description': sch.get('desc'),
                'minGpa': min_gpa,
                'maxIncome': max_inc,
                'location': loc,
                'slots': slots,
                'acceptedCount': accepted_count,
                'semester': sch.get('semester'),
                'year': sch.get('year'),
                'deadline': str(deadline) if deadline else None,
                'score': round(score),
                'reasons': reasons,
                'alreadyApplied': sch['req_no'] in applied_sch_ids,
                'isExpired': is_expired
            }

            if not reasons:
                ranked.append(item)
            else:
                ineligible.append(item)

        ranked.sort(key=lambda x: -x['score'])
        return jsonify({
            'eligible': ranked,
            'ineligible': ineligible
        })
    except Exception as exc:
        return jsonify({'message': str(exc)}), 500
    finally:
        if 'conn' in locals():
            conn.close()


@student_api_bp.route('/applicant/profile', methods=['GET'])
@token_required
def get_profile():
    try:
        conn = get_db()
        cur = conn.cursor()
        
        # Binary fields to optimize away from main SELECT
        blob_fields = [
            'profile_picture', 'signature_image_data', 'id_img_front', 'id_img_back', 
            'enrollment_certificate_doc', 'grades_doc', 'indigency_doc', 'id_pic'
        ]
        
        # Map fields to has_ flags
        flag_map = {
            'profile_picture': 'has_profile_picture',
            'signature_image_data': 'has_signature',
            'id_img_front': 'has_id',
            'id_img_back': 'has_id_back',
            'enrollment_certificate_doc': 'has_mayorCOE_photo',
            'grades_doc': 'has_mayorGrades_photo',
            'indigency_doc': 'has_mayorIndigency_photo',
            'id_pic': 'has_mayorValidID_photo'
        }

        # 1. First, get all column names to build a safe SELECT query
        # This prevents 502/OOM errors by NOT pulling massive binary data into Python memory
        cur.execute("SELECT * FROM applicants LIMIT 0")
        all_columns = [desc[0] for desc in cur.description]
        
        # Build SELECT list: normal columns + IS NOT NULL checks for blobs
        select_parts = []
        for col in all_columns:
            if col in blob_fields:
                flag_name = flag_map.get(col, f"has_{col}")
                # Important: Double-quote column names for case-sensitivity in PostgreSQL
                select_parts.append(f'("{col}" IS NOT NULL) as {flag_name}')
            else:
                select_parts.append(f'"{col}"')
                
        query = f"SELECT {', '.join(select_parts)} FROM applicants WHERE applicant_no = %s"
        cur.execute(query, (request.user_no,))
        applicant = cur.fetchone()
        
        if not applicant:
            return jsonify({'message': 'Not found'}), 404

        document_values = fetch_applicant_document_values(cur, request.user_no, blob_fields)

        # 2. Add lazy-load URLs for the frontend to fetch binary data on-demand
        # This ensures the browser can still access the data without bloating the initial profile load
        for key in blob_fields:
            flag_name = flag_map.get(key, f"has_{key}")
            if key != 'profile_picture':
                applicant[flag_name] = document_values.get(key) is not None
            if applicant.get(flag_name):
                # Use absolute URL for raw bytes to avoid origin issues on Surge
                applicant[key] = url_for('student_api.get_applicant_document_raw', field_name=key, _external=True)
            else:
                applicant[key] = None

        # 3. Clean up other types
        for key, value in list(applicant.items()):
            if isinstance(value, (datetime)):
                applicant[key] = value.isoformat()
            elif key == 'birthdate' and value:
                applicant[key] = str(value)

        # 4. Email verification status
        applicant['email_verified'] = applicant.get('is_verified', False)
        if applicant.get('google_id'):
            applicant['email_verified'] = True

        return jsonify(applicant)
    except Exception as exc:
        print(f"[PROFILE ERROR] {exc}", flush=True)
        return jsonify({'message': str(exc)}), 500
    finally:
        if 'conn' in locals():
            conn.close()


@student_api_bp.route('/applicant/document/<string:field_name>', methods=['GET'])
@token_required
def get_applicant_document(field_name):
    """
    Focused endpoint to fetch a single large binary field (ID, Photo, etc.)
    This prevents memory exhaustion by avoiding loading ALL images at once in /profile.
    """
    allowed_fields = [
        'profile_picture', 'signature_image_data', 'id_img_front', 'id_img_back',
        'enrollment_certificate_doc', 'grades_doc', 'indigency_doc', 'id_pic'
    ]
    
    if field_name not in allowed_fields:
        return jsonify({'message': 'Invalid field name'}), 400
        
    try:
        conn = get_db()
        cur = conn.cursor()
        row = fetch_applicant_document_values(cur, request.user_no, [field_name])
        
        if not row or not row[field_name]:
            return jsonify({'message': 'Document not found'}), 404
            
        value = row[field_name]
        
        # Handle decryption for signature if needed
        if field_name == 'signature_image_data':
            value = decode_signature(value)
        else:
            value = bytes(value)
            
        # Determine mime type
        mime_type = 'image/jpeg'
        if field_name == 'signature_image_data':
            mime_type = 'image/png'
            
        # Optimization: Return as Base64 string so frontend can easily use it in data URI
        # But we only do it for ONE image at a time
        encoded = base64.b64encode(value).decode('utf-8')
        return jsonify({
            'fieldName': field_name,
            'data': f"data:{mime_type};base64,{encoded}"
        })
    finally:
        if 'conn' in locals():
            conn.close()

@student_api_bp.route('/applicant/document/raw/<string:field_name>', methods=['GET'])
@token_required
def get_applicant_document_raw(field_name):
    """Returns raw bytes with correct Content-Type for direct <img> usage."""
    allowed_fields = [
        'profile_picture', 'signature_image_data', 'id_img_front', 'id_img_back',
        'enrollment_certificate_doc', 'grades_doc', 'indigency_doc', 'id_pic'
    ]
    if field_name not in allowed_fields:
        return "Invalid field", 400
    try:
        conn = get_db()
        cur = conn.cursor()
        row = fetch_applicant_document_values(cur, request.user_no, [field_name])
        if not row or not row[field_name]:
            return "Not found", 404
        
        value = row[field_name]
        if field_name == 'signature_image_data':
            value = decode_signature(value)
        else:
            value = bytes(value)

        mime_type = 'image/jpeg'
        if field_name == 'signature_image_data' or value.startswith(b'\x89PNG'):
            mime_type = 'image/png'
            
        from flask import make_response
        response = make_response(value)
        response.headers.set('Content-Type', mime_type)
        response.headers.set('Cache-Control', 'public, max-age=3600')
        return response
    except Exception as e:
        print(f"[DOCUMENT RAW] Error: {e}", flush=True)
        return str(e), 500
    finally:
        if 'conn' in locals():
            conn.close()

@student_api_bp.route('/applicant/profile', methods=['PUT'])
@token_required
def update_profile():
    data = request.get_json(silent=True) or request.form.to_dict(flat=True)
    files_data = request.files

    try:
        conn = get_db()
        cur = conn.cursor()
        updates = []
        params = []
        document_updates = {}
        has_profile_picture_column = applicant_has_column(cur, 'profile_picture')

        def add_update(column_name, value):
            updates.append(f'{column_name} = %s')
            params.append(value)

        def split_parent_name(full_name):
            cleaned = ' '.join((full_name or '').split())
            if not cleaned:
                return None, None
            parts = cleaned.split(' ')
            if len(parts) == 1:
                return cleaned, None
            return ' '.join(parts[:-1]), parts[-1]

        def parse_parent_status(value):
            if isinstance(value, bool):
                return value
            if isinstance(value, str):
                normalized = value.strip().lower()
                if normalized in {'living', 'true', '1', 'yes'}:
                    return True
                if normalized in {'deceased', 'false', '0', 'no'}:
                    return False
            return None

        field_mapping = {
            'lastName': 'last_name', 'firstName': 'first_name', 'middleName': 'middle_name',
            'maidenName': 'maiden_name', 'dateOfBirth': 'birthdate', 'placeOfBirth': 'birth_place',
            'streetBarangay': 'street_brgy', 'townCity': 'town_city_municipality',
            'townCityMunicipality': 'town_city_municipality',
            'province': 'province', 'zipCode': 'zip_code', 'sex': 'sex',
            'citizenship': 'citizenship', 'schoolIdNumber': 'school_id_no',
            'schoolName': 'school', 'schoolAddress': 'school_address',
            'schoolSector': 'school_sector', 'mobileNumber': 'mobile_no',
            'yearLevel': 'year_lvl', 'fatherPhoneNumber': 'father_phone_no',
            'motherPhoneNumber': 'mother_phone_no', 'fatherOccupation': 'father_occupation',
            'motherOccupation': 'mother_occupation', 'parentsGrossIncome': 'financial_income_of_parents',
            'gpa': 'overall_gpa', 'numberOfSiblings': 'sibling_no', 'course': 'course',
        }

        document_field_mapping = {
            'id_vid_url': 'id_vid_url',
            'face_video': 'id_vid_url',
            'mayorIndigency_video': 'indigency_vid_url',
            'mayorGrades_video': 'grades_vid_url',
            'mayorCOE_video': 'enrollment_certificate_vid_url',
            'schoolIdFront_video': 'schoolid_front_vid_url',
            'schoolIdBack_video': 'schoolid_back_vid_url',
        }

        for frontend_key, db_col in field_mapping.items():
            if frontend_key in data:
                value = data[frontend_key]
                # school_id_no is an INTEGER column — coerce safely
                if db_col == 'school_id_no':
                    try:
                        value = int(value) if value not in (None, '', 'null') else None
                    except (ValueError, TypeError):
                        value = None
                add_update(db_col, value)

        for frontend_key, db_col in document_field_mapping.items():
            if frontend_key in data:
                document_updates[db_col] = data[frontend_key]

        if 'fatherName' in data:
            father_fname, father_lname = split_parent_name(data.get('fatherName'))
            add_update('father_fname', father_fname)
            add_update('father_lname', father_lname)

        if 'motherName' in data:
            mother_fname, mother_lname = split_parent_name(data.get('motherName'))
            add_update('mother_fname', mother_fname)
            add_update('mother_lname', mother_lname)

        if 'fatherStatus' in data:
            father_status = parse_parent_status(data.get('fatherStatus'))
            if father_status is not None:
                add_update('father_status', father_status)

        if 'motherStatus' in data:
            mother_status = parse_parent_status(data.get('motherStatus'))
            if mother_status is not None:
                add_update('mother_status', mother_status)

        binary_fields = {
            'profile_picture': 'profile_picture',
            'id_front': 'id_img_front',
            'id_back': 'id_img_back',
            'mayorCOE_photo': 'enrollment_certificate_doc',
            'enrollment_certificate_doc': 'enrollment_certificate_doc',
            'mayorGrades_photo': 'grades_doc',
            'grades_doc': 'grades_doc',
            'mayorIndigency_photo': 'indigency_doc',
            'indigency_doc': 'indigency_doc',
            'mayorValidID_photo': 'id_pic',
            'id_pic': 'id_pic',
            'signature_data': 'signature_image_data',
        }

        for field_key, db_col in binary_fields.items():
            uploaded_file = files_data.get(field_key)
            if uploaded_file:
                blob_bytes = uploaded_file.read()
                if field_key == 'signature_data' and blob_bytes and fernet:
                    blob_bytes = fernet.encrypt(blob_bytes)
                if db_col == 'profile_picture' and has_profile_picture_column:
                    add_update(db_col, blob_bytes)
                elif db_col != 'profile_picture':
                    document_updates[db_col] = blob_bytes
                continue

            if field_key in data and data[field_key]:
                blob_bytes = decode_base64(data[field_key])
                if blob_bytes is not None:
                    if field_key == 'signature_data' and blob_bytes and fernet:
                        blob_bytes = fernet.encrypt(blob_bytes)
                    if db_col == 'profile_picture' and has_profile_picture_column:
                        add_update(db_col, blob_bytes)
                    elif db_col != 'profile_picture':
                        document_updates[db_col] = blob_bytes

        if not updates and not document_updates:
            return jsonify({'message': 'No changes provided'}), 200

        if updates:
            params.append(request.user_no)
            sql = f"UPDATE applicants SET {', '.join(updates)} WHERE applicant_no = %s"
            cur.execute(sql, tuple(params))
        if document_updates:
            persist_applicant_document_values(cur, request.user_no, document_updates)
        conn.commit()

        return jsonify({'message': 'Progress saved successfully'})
    except Exception as exc:
        return jsonify({'message': str(exc)}), 500
    finally:
        if 'conn' in locals():
            conn.close()


@student_api_bp.route('/applications/submit', methods=['POST'])
@token_required
def submit_application():
    import time
    start_time = time.time()
    try:
        current_user_id = request.user_no
        content_length = request.content_length or 0
        print(f"[SUBMIT] Content-Length: {content_length / 1024 / 1024:.2f} MB")

        form_data = request.form
        files_data = request.files

        if request.is_json:
            req_no = request.json.get('req_no')
            skip_verify = str(request.json.get('skip_verification', 'false')).lower() == 'true'
        else:
            req_no = form_data.get('req_no')
            # Support both camelCase (frontend) and snake_case (legacy/internal)
            skip_verify_val = form_data.get('skipVerification') or form_data.get('skip_verification')
            skip_verify = str(skip_verify_val).lower() == 'true' if skip_verify_val is not None else False
        
        print(f"[SUBMIT] Processing application for User {current_user_id}, Req {req_no} (skip_verify={skip_verify})")

        if not req_no:
            return jsonify({'message': 'Requirement number (req_no) is missing'}), 400
        req_no = int(req_no)

        conn = get_db()
        cur = conn.cursor()
        has_profile_picture_column = applicant_has_column(cur, 'profile_picture')
        
        # Ensure the created_at support column exists only once per process.
        ensure_applicant_status_created_at_column(cur)
        conn.commit()
        
        # Get applicant data
        cur.execute('SELECT * FROM applicants WHERE applicant_no = %s', (current_user_id,))
        applicant = cur.fetchone()
        if not applicant:
            return jsonify({'message': 'Applicant profile not found'}), 404
        document_values = fetch_applicant_document_values(
            cur,
            current_user_id,
            [
                'signature_image_data',
                'id_img_front',
                'id_img_back',
                'enrollment_certificate_doc',
                'grades_doc',
                'indigency_doc',
                'id_pic',
                'id_vid_url',
                'indigency_vid_url',
                'grades_vid_url',
                'enrollment_certificate_vid_url',
                'schoolid_front_vid_url',
                'schoolid_back_vid_url',
            ],
        )
        if document_values:
            applicant.update(document_values)

        prefetch_video_urls([
            form_data.get('mayorIndigency_video'),
            form_data.get('mayorGrades_video'),
            form_data.get('mayorCOE_video'),
            form_data.get('schoolIdFront_video'),
            form_data.get('schoolIdBack_video'),
            form_data.get('face_video'),
            applicant.get('indigency_vid_url'),
            applicant.get('grades_vid_url'),
            applicant.get('enrollment_certificate_vid_url'),
            applicant.get('schoolid_front_vid_url'),
            applicant.get('schoolid_back_vid_url'),
            applicant.get('id_vid_url'),
        ])

        # In this system, req_no (passed from frontend) is the primary scholarship identifier
        scholarship_id = req_no
        
        # Verify the scholarship exists
        cur.execute('SELECT req_no FROM scholarships WHERE req_no = %s', (scholarship_id,))
        if not cur.fetchone():
            return jsonify({'message': 'Scholarship not found'}), 404

        # ── Data Preparation ──────────────────────────────────────────────────
        id_front_bytes = decode_base64(form_data.get('id_front')) or db_bytes(applicant.get('id_img_front'))
        id_back_bytes = decode_base64(form_data.get('id_back')) or db_bytes(applicant.get('id_img_back'))
        face_photo_bytes = decode_base64(form_data.get('face_photo'))
        profile_pic_bytes = None
        if has_profile_picture_column:
            profile_pic_bytes = decode_base64(form_data.get('profile_picture')) or db_bytes(applicant.get('profile_picture'))
        
        signature_bytes = decode_signature(form_data.get('signature_data')) or decode_signature(applicant.get('signature_image_data'))

        doc_keys = ['mayorCOE_photo', 'mayorGrades_photo', 'mayorIndigency_photo', 'mayorValidID_photo']
        doc_column_map = {
            'mayorCOE_photo': 'enrollment_certificate_doc',
            'mayorGrades_photo': 'grades_doc',
            'mayorIndigency_photo': 'indigency_doc',
            'mayorValidID_photo': 'id_pic',
        }

        doc_bytes = {}
        for key in doc_keys:
            uploaded_file = files_data.get(key)
            if uploaded_file:
                doc_bytes[key] = uploaded_file.read()
            else:
                doc_bytes[key] = decode_base64(form_data.get(key)) or db_bytes(applicant.get(doc_column_map[key]))

        # ── OCR & VIDEO VERIFICATION (PARALLEL) ───────────────────────────────
        ocr_ok = True
        ocr_status = "Verification skipped"
        
        if not skip_verify:
            try:
                from concurrent.futures import ThreadPoolExecutor
                verification_tasks = {}
                # Expand worker pool to allow true simultaneous background downloading and validation
                with ThreadPoolExecutor(max_workers=3) as executor:
                    # 1. OCR Identity Check
                    if id_front_bytes:
                        town_city = form_data.get('townCity') or applicant.get('town_city_municipality', '')
                        full_name = f"{applicant.get('first_name', '')} {applicant.get('last_name', '')}"
                        print(f"[SUBMIT] Scheduling OCR for {full_name}...")
                        verification_tasks['ocr'] = executor.submit(
                            verify_id_with_ocr, 
                            image_bytes=id_front_bytes,
                            expected_name=full_name,
                            expected_address=town_city
                        )

                    # 2. Video OCR Validations
                    video_requirements = {
                        'mayorIndigency_video': ['Indigency', 'Barangay', 'Certificate', 'Resident'],
                        'mayorGrades_video': ['Grades', 'Grade', 'Transcript', 'Records', 'Units', 'Unit', 'Subject', 'GPA', 'Evaluation', 'Academic', 'Semester'],
                        'mayorCOE_video': ['Enrollment', 'Enrolment', 'Certificate', 'Registration', 'Registered', 'College', 'Enrolled', 'COE', 'Semester']
                    }
                    def _threaded_verify(v_url, kws, addr, upl_bytes):
                        data_bytes = upl_bytes
                        if not data_bytes and v_url:
                            data_bytes, _ = fetch_video_bytes_from_url(v_url)
                        if not data_bytes: return False, "Video inaccessible."
                        return verify_video_content(data_bytes, kws, addr)

                    for field, keywords in video_requirements.items():
                        v_bytes = None
                        video_file = request.files.get(field)
                        if video_file:
                            v_bytes = video_file.read()
                            video_file.seek(0)
                        
                        video_url = form_data.get(field)
                        if v_bytes or (isinstance(video_url, str) and video_url.startswith('http')):
                            expected_addr = form_data.get('townCity') or applicant.get('town_city_municipality', '') if field == 'mayorIndigency_video' else None
                            verification_tasks[f'video_{field}'] = executor.submit(
                                _threaded_verify, video_url, keywords, expected_addr, v_bytes
                            )

                    # --- GATHER RESULTS ---
                    if 'ocr' in verification_tasks:
                        ocr_ok, ocr_status, _, _ = verification_tasks['ocr'].result()
                        print(f"[SUBMIT] OCR Result: {ocr_status}")

                    for key in verification_tasks:
                        if key.startswith('video_'):
                            is_valid, v_msg = verification_tasks[key].result()
                            if not is_valid:
                                print(f"[SUBMIT] ❌ Video Validation Failed ({key}): {v_msg}")
                                return jsonify({'message': f'Invalid Video Content: {v_msg}'}), 400
                            print(f"[SUBMIT] ✅ Video Validated ({key}): {v_msg}")

            except Exception as ai_err:
                import traceback
                traceback.print_exc()
                print(f"[SUBMIT] Parallel Verification Exception: {str(ai_err)}")
                return jsonify({
                    'message': f'Verification service error: {str(ai_err)}. Please ensure your photos are clear and try again.',
                    'verification_status': f"Error: {str(ai_err)}"
                }), 400

        # ── UPDATE APPLICANT PROFILE ──────────────────────────────────────────
        updates = []
        params = []
        field_mapping = {
            'lastName': 'last_name', 'firstName': 'first_name', 'middleName': 'middle_name',
            'dateOfBirth': 'birthdate', 'streetBarangay': 'street_brgy', 'townCity': 'town_city_municipality',
            'province': 'province', 'zipCode': 'zip_code', 'sex': 'sex', 'citizenship': 'citizenship',
            'schoolIdNumber': 'school_id_no', 'schoolName': 'school', 'schoolAddress': 'school_address',
            'schoolSector': 'school_sector', 'mobileNumber': 'mobile_no', 'yearLevel': 'year_lvl',
            'parentsGrossIncome': 'financial_income_of_parents', 'course': 'course',
        }

        document_field_mapping = {
            'id_vid_url': 'id_vid_url',
            'face_video': 'id_vid_url',
            'mayorIndigency_video': 'indigency_vid_url',
            'mayorGrades_video': 'grades_vid_url',
            'mayorCOE_video': 'enrollment_certificate_vid_url',
            'schoolIdFront_video': 'schoolid_front_vid_url',
            'schoolIdBack_video': 'schoolid_back_vid_url',
        }

        for form_key, db_col in field_mapping.items():
            if form_key in form_data:
                value = form_data[form_key]
                # school_id_no is an INTEGER column — coerce safely
                if db_col == 'school_id_no':
                    try:
                        value = int(value) if value not in (None, '', 'null') else None
                    except (ValueError, TypeError):
                        value = None
                updates.append(f'{db_col} = %s')
                params.append(value)

        document_updates = {}
        for form_key, db_col in document_field_mapping.items():
            if form_key in form_data:
                document_updates[db_col] = form_data[form_key]

        binary_map = {
            'id_img_front': id_front_bytes,
            'id_img_back': id_back_bytes,
            'profile_picture': profile_pic_bytes,
            'signature_image_data': fernet.encrypt(signature_bytes) if fernet and signature_bytes else None,
            'enrollment_certificate_doc': doc_bytes['mayorCOE_photo'],
            'grades_doc': doc_bytes['mayorGrades_photo'],
            'indigency_doc': doc_bytes['mayorIndigency_photo'],
            'id_pic': doc_bytes['mayorValidID_photo'] or face_photo_bytes,
        }

        for column_name, value in binary_map.items():
            if value is not None:
                if column_name == 'profile_picture' and has_profile_picture_column:
                    updates.append(f'{column_name} = %s')
                    params.append(value)
                elif column_name != 'profile_picture':
                    document_updates[column_name] = value

        if updates:
            sql = f"UPDATE applicants SET {', '.join(updates)} WHERE applicant_no = %s"
            params.append(current_user_id)
            cur.execute(sql, tuple(params))
        if document_updates:
            persist_applicant_document_values(cur, current_user_id, document_updates)

        # ── CREATE/UPDATE STATUS ──────────────────────────────────────────────
        cur.execute(
            """
            INSERT INTO applicant_status (scholarship_no, applicant_no, is_accepted, created_at)
            VALUES (%s, %s, NULL, NOW())
            ON CONFLICT (scholarship_no, applicant_no) 
            DO UPDATE SET created_at = EXCLUDED.created_at, is_accepted = NULL
            """,
            (scholarship_id, current_user_id),
        )

        conn.commit()
        print(f"[SUBMIT] Application successful for User {current_user_id} in {time.time() - start_time:.2f}s")
        return jsonify({
            'message': 'Application submitted successfully',
            'ocr_status': ocr_status
        }), 201

    except Exception as exc:
        traceback.print_exc()
        print(f"[SUBMIT] ❌ Error after {time.time() - start_time:.2f}s: {str(exc)}")
        if 'conn' in locals():
            conn.rollback()
        return jsonify({'message': f'Submission error: {str(exc)}'}), 500
    finally:
        if 'conn' in locals():
            conn.close()


@student_api_bp.route('/verification/ocr-check', methods=['POST'])
@token_required
def ocr_check():
    """OCR verification endpoint — supports multi-document authentication in parallel."""
    try:
        # Support both JSON and multipart/form-data
        if request.is_json:
            data = request.json
        else:
            data = request.form.to_dict()

        # 1. Get applicant record from DB
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT applicant_no, first_name, middle_name, last_name, town_city_municipality FROM applicants WHERE applicant_no = %s", (request.user_no,))
        applicant = cur.fetchone()
        document_values = fetch_applicant_document_values(
            cur,
            request.user_no,
            [
                'id_img_front',
                'id_img_back',
                'indigency_doc',
                'id_vid_url',
                'schoolid_front_vid_url',
                'schoolid_back_vid_url',
                'indigency_vid_url',
                'enrollment_certificate_vid_url',
                'grades_vid_url',
            ],
        )
        if document_values:
            applicant.update(document_values)

        prefetch_video_urls([
            data.get('video_url'),
            data.get('video_url_back'),
            data.get('mayorIndigency_video'),
            data.get('mayorGrades_video'),
            data.get('mayorCOE_video'),
            data.get('schoolIdFront_video'),
            data.get('schoolIdBack_video'),
            data.get('face_video'),
            applicant.get('indigency_vid_url'),
            applicant.get('enrollment_certificate_vid_url'),
            applicant.get('grades_vid_url'),
            applicant.get('schoolid_front_vid_url'),
            applicant.get('schoolid_back_vid_url'),
            applicant.get('id_vid_url'),
        ])

        if not applicant:
            return jsonify({'verified': False, 'message': 'Applicant profile not found'}), 404

        # 2. Resolve parameters (multipart files prioritize over payload/JSON)
        id_front_file = request.files.get('id_front') or request.files.get('idFront')
        id_back_file = request.files.get('id_back') or request.files.get('idBack')
        indigency_doc_file = request.files.get('indigency_doc') or request.files.get('indigencyDoc')
        enrollment_doc_file = request.files.get('enrollment_doc') or request.files.get('enrollmentDoc')
        grades_doc_file = request.files.get('grades_doc') or request.files.get('gradesDoc')

        id_front_param = id_front_file.read() if id_front_file else data.get('id_front') or data.get('idFront')
        id_back_param = id_back_file.read() if id_back_file else data.get('id_back') or data.get('idBack')
        indigency_doc_param = indigency_doc_file.read() if indigency_doc_file else data.get('indigency_doc') or data.get('indigencyDoc')
        enrollment_doc_param = enrollment_doc_file.read() if enrollment_doc_file else data.get('enrollment_doc') or data.get('enrollmentDoc')
        grades_doc_param = grades_doc_file.read() if grades_doc_file else data.get('grades_doc') or data.get('gradesDoc')

        first_name = str(data.get('first_name') or data.get('firstName') or '').strip()
        middle_name = str(data.get('middle_name') or data.get('middleName') or '').strip()
        last_name = str(data.get('last_name') or data.get('lastName') or '').strip()
        
        # Construct full expected name for OCR matching
        # Include middle name only if it's more than a single character or placeholder
        full_expected_name = f"{first_name} {last_name}"
        if middle_name and len(middle_name) > 1:
            full_expected_name = f"{first_name} {middle_name} {last_name}"
        town_city = str(data.get('town_city') or data.get('townCity') or '').strip()
        school_name = str(data.get('school_name') or data.get('schoolName') or '').strip()
        course = str(data.get('course') or '').strip()
        expected_gpa = str(data.get('gpa') or data.get('expectedGPA') or '').strip()
        expected_year_level = str(data.get('year_level') or data.get('yearLevel') or '').strip()
        expected_academic_year = str(data.get('expected_year') or data.get('expectedYear') or '').strip()
        expected_id_no = str(data.get('id_number') or data.get('idNumber') or '').strip()

        expected_semester = None
        scholarship_no = data.get('scholarship_no')
        if scholarship_no:
            try:
                cur.execute("SELECT year, semester FROM scholarships WHERE req_no = %s", (scholarship_no,))
                sch = cur.fetchone()
                if sch:
                    if sch['year']:
                        expected_academic_year = sch['year']
                        print(f"[OCR] Using scholarship-defined academic year: {expected_academic_year}", flush=True)
                    if sch['semester']:
                        expected_semester = sch['semester']
                        print(f"[OCR] Using scholarship-defined semester: {expected_semester}", flush=True)
            except Exception as sch_err:
                print(f"[OCR ERROR] Failed to fetch scholarship year: {sch_err}", flush=True)

        def get_bytes(param, db_val):
            if isinstance(param, bytes):
                return param
            return decode_base64(param) or db_bytes(db_val)
        
        # Now uses global fetch_video_bytes_from_url

        # ── Worker Function for Parallel Processing ──
        def process_doc(doc_type, doc_param, db_val):
            try:
                # Use standard doc bytes for provided parameters, fallback to DB only for Indigency/ID
                if isinstance(doc_param, bytes):
                    doc_bytes = doc_param
                else:
                    doc_bytes = decode_base64(doc_param) if doc_param else (db_bytes(db_val) if db_val else None)
                
                if not doc_bytes: 
                    return None

                # 1. Main OCR Verification (Identity)
                # Determine video URL for this document type (Prioritize request payload)
                frontend_video_front_url = data.get('video_url')
                frontend_video_back_url = data.get('video_url_back') or frontend_video_front_url
                school_id_front_video = applicant.get('schoolid_front_vid_url')
                school_id_back_video = applicant.get('schoolid_back_vid_url')
                vid_url_map = {
                    'Indigency': frontend_video_front_url or applicant.get('indigency_vid_url'),
                    'SchoolID': frontend_video_front_url or school_id_front_video,
                    'SchoolIDBack': frontend_video_back_url or school_id_back_video,
                    'Enrollment': frontend_video_front_url or applicant.get('enrollment_certificate_vid_url'),
                    'Grades': frontend_video_front_url or applicant.get('grades_vid_url')
                }
                vid_url = vid_url_map.get(doc_type)
                name_keywords = build_student_name_keywords(first_name, middle_name, last_name)
                school_variants = build_school_name_variants(school_name)
                video_keywords_map = {
                    'Indigency': ['Indigency', 'Certificate', 'Barangay'],
                    'Enrollment': ['Enrollment', 'Certificate', 'COE', 'Registered'],
                    'Grades': ['Grades', 'Grade', 'Transcript', 'Record', 'Evaluation', 'Rating', 'Units', 'Credit', 'Sem', 'GPA', 'Report', 'Card', 'Evaluation'],
                    'SchoolID': name_keywords or ['Student', 'Name'],
                    'SchoolIDBack': school_variants or ['School', 'Campus']
                }
                video_scan_options = {
                    'Indigency': {
                        'sample_positions': [0.35, 0.7],
                        'max_width': 560,
                        'allow_alt_pass': True,
                        'fallback_text_length': 0,
                    },
                    'Enrollment': {
                        'sample_positions': [0.5],
                        'max_width': 480,
                        'allow_alt_pass': False,
                        'fallback_text_length': 15,
                    },
                    'Grades': {
                        'sample_positions': [0.5],
                        'max_width': 480,
                        'allow_alt_pass': False,
                        'fallback_text_length': 15,
                    },
                    'SchoolID': {
                        'sample_positions': [0.35, 0.65],
                        'max_width': 480,
                        'allow_alt_pass': False,
                        'fallback_text_length': 12,
                    },
                    'SchoolIDBack': {
                        'sample_positions': [0.35, 0.65],
                        'max_width': 480,
                        'allow_alt_pass': False,
                        'fallback_text_length': 12,
                    },
                }
                # Define keywords for each document type
                # Indigency can be detected as 'Certificate' + other indicators
                doc_keywords = {
                    'Indigency': ['Indigency', 'Certificate', 'Indigent', 'Pauper', 'Barangay'],
                    'Enrollment': ['Enrollment', 'Enrolment', 'Certificate', 'Registration', 'Registered', 'Course', 'Semester', 'College', 'Enrolled', 'COE'],
                    'Grades': [
                        # Common headers on Philippine TORs
                        'Grades', 'Grade', 'Transcript', 'Records', 'Report',
                        # Unit/credit fields always present on any TOR
                        'Units', 'Unit', 'Credit', 'Subject',
                        # Grading period terms
                        'Prelim', 'Midterm', 'Finals', 'Final',
                        # Other common column headers
                        'Subject', 'Course', 'Rating', 'Evaluation', 'GPA',
                        # Filipino-context terms
                        'Semestral', 'Semester', 'Academic', 'College', 'Registrar'
                    ],
                    'SchoolID': name_keywords or ['Student', 'Name'],
                    'SchoolIDBack': school_variants or ['School', 'Campus']
                }

                # 1.a Video Content Verification (if URL present)
                v_video, msg_video = True, "Not provided"
                if vid_url:
                    vid_bytes, fetch_err = fetch_video_bytes_from_url(vid_url)
                    if vid_bytes:
                        scan_options = video_scan_options.get(doc_type, video_scan_options['Enrollment'])
                        v_video, msg_video = verify_video_content(
                            video_bytes=vid_bytes,
                            keywords=video_keywords_map.get(doc_type),
                            expected_address=None,
                            sample_positions=scan_options['sample_positions'],
                            max_width=scan_options['max_width'],
                            allow_alt_pass=scan_options['allow_alt_pass'],
                            fallback_text_length=scan_options['fallback_text_length']
                        )
                    else:
                        msg_video = f"Video file unreachable ({fetch_err})"
                        v_video = False
                else:
                    # Video is now mandatory for these specific documents
                    if doc_type in ['Indigency', 'Enrollment', 'Grades', 'SchoolID', 'SchoolIDBack']:
                        v_video = False
                        msg_video = "Mandatory supporting video is missing"
                
                # If video verification fails, the entire document verification fails
                if not v_video:
                    return {'doc': doc_type, 'verified': False, 'message': f"Video verification failed: {msg_video}", 'video_verified': False, 'video_message': msg_video}
                
                # 1.b OCR Extraction from document image
                target_address = town_city if doc_type == 'Indigency' else None
                
                if doc_type in ['Enrollment', 'Grades']:
                    raw, extraction_error = extract_document_text(doc_bytes)
                    v = bool(raw and raw.strip())
                    msg = extraction_error or ('Verified' if v else 'Unable to read document text')
                elif doc_type == 'SchoolIDBack':
                    v, msg, raw, _ = verify_id_with_ocr(doc_bytes, None, None, None, None)
                else:
                    v, msg, raw, _ = verify_id_with_ocr(doc_bytes, first_name, middle_name, last_name, target_address)
                raw_lower = raw.lower() if raw else ""
                
                # If primary OCR extraction failed, return error
                if not v:
                    return {'doc': doc_type, 'verified': False, 'message': msg, 'raw_text': raw, 'video_verified': v_video, 'video_message': msg_video}
                
                # Double-check keywords
                if doc_type in doc_keywords and doc_type not in ['SchoolID', 'SchoolIDBack']: # SchoolID images have separate front/back checks
                    _, _, found_kw, _ = _perform_text_matching(raw, None, None, None, None, keywords=doc_keywords[doc_type], is_indigency=True)
                    if not found_kw:
                        return {'doc': doc_type, 'verified': False, 'message': f"Document type mismatch: Required '{doc_keywords[doc_type][0]}' not detected.", 'raw_text': raw}

                # 2. Document-Specific Logic (REUSING 'raw' text)
                if doc_type == 'Enrollment':
                    year_label = extract_school_year_from_text(raw)
                    semester_label = extract_semester_from_text(raw)
                    normalized_expected_semester = normalize_semester_label(expected_semester)
                    normalized_semester_label = normalize_semester_label(semester_label)
                    year_only_ok = academic_year_matches_expected(year_label, expected_academic_year)
                    semester_ok = True
                    if normalized_expected_semester and normalized_semester_label:
                        semester_ok = normalized_expected_semester == normalized_semester_label
                    year_ok = is_current_school_year(year_label, semester_str=semester_label, expected_year=expected_academic_year, expected_semester=expected_semester)
                    school_ok, _, _ = school_name_matches_text(raw, school_name) if school_name else (True, None, None)
                    name_ok, _ = student_name_matches_text(raw, first_name, middle_name, last_name)
                    id_ok, _ = id_number_matches_text(raw, expected_id_no)
                    year_level_ok, _ = year_level_matches_text(raw, expected_year_level)

                    if v:
                        if not name_ok:
                            v, msg = False, "Name mismatch: Student name not detected on document"
                        else:
                            # Secondary details are now non-blocking warnings to avoid false-positive rejections
                            detail_issues = []
                            if not id_ok: detail_issues.append(f"ID No mismatch ({expected_id_no})")
                            if not year_level_ok: detail_issues.append(f"Year level mismatch ({expected_year_level})")
                            if not year_only_ok: detail_issues.append(f"A.Y. mismatch ({year_label})")
                            elif not semester_ok: detail_issues.append(f"Semester mismatch")
                            elif not year_ok: detail_issues.append(f"Period mismatch")
                            if not school_ok: detail_issues.append(f"School mismatch ({school_name})")

                            if detail_issues:
                                msg = f"Verified with warnings: {', '.join(detail_issues)}"
                            else:
                                detail_parts = []
                                if school_name: detail_parts.append(school_name)
                                if expected_year_level: detail_parts.append(expected_year_level)
                                msg = f"Verified: A.Y. {year_label}" + (f" {normalized_semester_label}" if normalized_semester_label else "") + (f" | {' | '.join(detail_parts)}" if detail_parts else "")
                    
                    return {'doc': 'Enrollment', 'verified': v, 'message': msg, 'raw_text': raw, 'school_year': year_label, 'video_verified': v_video, 'video_message': msg_video}

                elif doc_type == 'Grades':
                    year_label = extract_school_year_from_text(raw)
                    semester_label = extract_semester_from_text(raw)
                    normalized_expected_semester = normalize_semester_label(expected_semester)
                    normalized_semester_label = normalize_semester_label(semester_label)
                    year_only_ok = academic_year_matches_expected(year_label, expected_academic_year)
                    semester_ok = True
                    if normalized_expected_semester and normalized_semester_label:
                        semester_ok = normalized_expected_semester == normalized_semester_label
                    year_ok = is_current_school_year(year_label, semester_str=semester_label, expected_year=expected_academic_year, expected_semester=expected_semester)
                    school_ok, _, _ = school_name_matches_text(raw, school_name) if school_name else (True, None, None)
                    name_ok, _ = student_name_matches_text(raw, first_name, middle_name, last_name)
                    year_level_ok, _ = year_level_matches_text(raw, expected_year_level)
                    gpa_ok, matched_gpa = gpa_matches_text(raw, expected_gpa)

                    if v:
                        if not name_ok:
                            v, msg = False, "Full name mismatch: Name not found on grade report"
                        else:
                            # Secondary details are non-blocking warnings
                            detail_issues = []
                            if not year_level_ok: detail_issues.append(f"Year level mismatch ({expected_year_level})")
                            if not gpa_ok: detail_issues.append(f"GPA mismatch ({expected_gpa})")
                            if not year_only_ok: detail_issues.append(f"A.Y. mismatch ({year_label})")
                            elif not semester_ok: detail_issues.append(f"Semester mismatch")
                            elif not year_ok: detail_issues.append(f"Period mismatch")
                            if not school_ok: detail_issues.append(f"School mismatch ({school_name})")

                            if detail_issues:
                                msg = f"Verified with warnings: {', '.join(detail_issues)}"
                            else:
                                detail_parts = []
                                if school_name: detail_parts.append(school_name)
                                if expected_year_level: detail_parts.append(expected_year_level)
                                if matched_gpa is not None: detail_parts.append(f"GPA {matched_gpa}")
                                msg = f"Verified: A.Y. {year_label}" + (f" {normalized_semester_label}" if normalized_semester_label else "") + (f" | {' | '.join(detail_parts)}" if detail_parts else "")
                    
                    return {'doc': 'Grades', 'verified': v, 'message': msg, 'raw_text': raw, 'school_year': year_label, 'video_verified': v_video, 'video_message': msg_video}

                elif doc_type == 'Indigency':
                    return {'doc': 'Indigency', 'verified': v, 'message': msg, 'raw_text': raw, 'video_verified': v_video, 'video_message': msg_video}

                elif doc_type == 'SchoolID':
                    # For physical ID cards, we completely skip year level checks
                    # as they are rarely printed on the card face.
                    id_ok, _ = id_number_matches_text(raw, expected_id_no)

                    if v and not id_ok:
                        v, msg = False, f"School ID number mismatch ({expected_id_no or 'None'})"
                    elif v:
                        msg = "School ID front verified against name and ID number"

                    return {'doc': 'Identity Front', 'verified': v, 'message': msg, 'raw_text': raw, 'video_verified': v_video, 'video_message': msg_video}

                elif doc_type == 'SchoolIDBack':
                    school_ok, matched_variant, school_variants = school_name_matches_text(raw, school_name)
                    
                    if v and not school_ok:
                        expected_label = school_name or 'selected school'
                        fallback_hint = f" Tried: {', '.join(school_variants[:4])}" if school_variants else ''
                        v, msg = False, f"School name mismatch ({expected_label}).{fallback_hint}"
                    elif v:
                        school_suffix = f" using '{matched_variant}'" if matched_variant else ''
                        msg = f"School ID back verified{school_suffix} for school name"
                        
                    return {'doc': 'Identity Back', 'verified': v, 'message': msg, 'raw_text': raw, 'video_verified': v_video, 'video_message': msg_video}

                return None
            except Exception as worker_err:
                print(f"[OCR WORKER ERROR] {doc_type}: {str(worker_err)}", flush=True)
                return {'doc': doc_type, 'verified': False, 'message': f'Processing error: {str(worker_err)}'}

        # 3. Schedule Parallel Jobs
        jobs = []
        if enrollment_doc_param: jobs.append(('Enrollment', enrollment_doc_param, None))
        if grades_doc_param: jobs.append(('Grades', grades_doc_param, None))
        if indigency_doc_param:  # Only run Indigency if a doc was explicitly sent; no fallback guessing
            jobs.append(('Indigency', indigency_doc_param, applicant.get('indigency_doc')))
        if id_front_param:
            jobs.append(('SchoolID', id_front_param, applicant.get('id_img_front')))
        if id_back_param:
            jobs.append(('SchoolIDBack', id_back_param, applicant.get('id_img_back')))

        results = []
        overall_verified = True
        
        if jobs:
            pool = GreenPool(size=min(len(jobs), 5)) 
            
            def run_job(job_data):
                try:
                    # process_doc uses tpool.execute internally for blocking Tesseract tasks
                    return process_doc(*job_data)
                except Exception as e:
                    print(f"[OCR POOL ERROR] {job_data[0]}: {e}", flush=True)
                    return {'doc': job_data[0], 'verified': False, 'message': f'Pool error: {str(e)}'}

            # Use imap to run jobs in parallel and collect results
            job_results = list(pool.imap(run_job, jobs))
            
            for res in job_results:
                if res:
                    results.append(res)
                    if not res.get('verified', False): 
                        overall_verified = False


        if not results:
            return jsonify({'verified': False, 'message': 'No documents provided for verification'}), 400

        final_msg = " | ".join([f"{r['doc']}: {r['message']}" for r in results])
        return jsonify({'verified': overall_verified, 'message': final_msg, 'results': results})

    except Exception as e:
        traceback.print_exc()
        return jsonify({'verified': False, 'message': f'Server error: {str(e)}'}), 500
    finally:
        if 'conn' in locals():
            conn.close()


@student_api_bp.route('/applications/<int:scholarship_no>', methods=['DELETE'])
@token_required
def cancel_application(scholarship_no):
    """Cancel (delete) the current user's application for a given scholarship."""
    try:
        conn = get_db()
        cur = conn.cursor()

        # Verify the application exists and belongs to this applicant
        cur.execute(
            """
            SELECT 1 FROM applicant_status
            WHERE scholarship_no = %s AND applicant_no = %s
            """,
            (scholarship_no, request.user_no),
        )
        if not cur.fetchone():
            return jsonify({'message': 'Application not found or does not belong to you'}), 404

        # Remove the application
        cur.execute(
            """
            DELETE FROM applicant_status
            WHERE scholarship_no = %s AND applicant_no = %s
            """,
            (scholarship_no, request.user_no),
        )
        
        # We NO LONGER delete associated messages between applicant and provider 
        # so that the cancellation notice can be read by the admin.
        
        conn.commit()
        
        conn.commit()

        return jsonify({'message': 'Application cancelled successfully'})
    except Exception as exc:
        traceback.print_exc()
        return jsonify({'message': f'Error cancelling application: {str(exc)}'}), 500
    finally:
        if 'conn' in locals():
            conn.close()


@student_api_bp.route('/applications/my-applications', methods=['GET'])
@token_required
def get_my_applications():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT
                s.scholarship_name as name,
                s.req_no as scholarship_no,
                s.req_no,
                s.deadline,
                s.pro_no,
                CASE
                    WHEN ast.is_accepted = TRUE THEN 'Approved'
                    WHEN ast.is_accepted = FALSE THEN 'Rejected'
                    ELSE 'Pending'
                END as status,
                ast.status_updated
            FROM applicant_status ast
            JOIN scholarships s ON ast.scholarship_no = s.req_no
            WHERE ast.applicant_no = %s
            """,
            (request.user_no,),
        )
        rows = cur.fetchall()
        for row in rows:
            if row.get('deadline'):
                row['deadline'] = str(row['deadline'])
            if row.get('status_updated'):
                row['status_updated'] = str(row['status_updated'])
        return jsonify(rows)
    except Exception as exc:
        traceback.print_exc()
        return jsonify({'message': str(exc)}), 500
    finally:
        if 'conn' in locals():
            conn.close()


@student_api_bp.route('/applications/<int:req_no>/status', methods=['POST'])
def update_application_status(req_no):
    data = request.get_json() or {}
    applicant_no = data.get('applicant_no')
    status = data.get('status')

    try:
        conn = get_db()
        cur = conn.cursor()
        
        # If rejecting the application, delete associated messages first
        if status in [False, 0, 'false', 'False']:
            cur.execute(
                """
                SELECT pro_no FROM scholarships WHERE req_no = %s
                """,
                (req_no,),
            )
            scholarship_row = cur.fetchone()
            if scholarship_row:
                pro_no = scholarship_row['pro_no']
                # Delete all messages between applicant and provider
                cur.execute(
                    """
                    DELETE FROM message WHERE applicant_no = %s AND pro_no = %s
                    """,
                    (applicant_no, pro_no),
                )
        
        cur.execute(
            """
            UPDATE applicant_status
            SET is_accepted = %s
            WHERE scholarship_no = %s AND applicant_no = %s
            """,
            (status, req_no, applicant_no),
        )

        # If this application is being APPROVED, we automatically REJECT all other 
        # applications for the same applicant as they can only hold one scholarship.
        if status in [True, 1, 'true', 'True']:
            # Find which scholarships are being auto-declined to notify the student
            cur.execute(
                "SELECT s.scholarship_name, s.req_no FROM applicant_status ast JOIN scholarships s ON ast.scholarship_no = s.req_no WHERE ast.applicant_no = %s AND ast.scholarship_no != %s AND (ast.is_accepted IS NULL OR ast.is_accepted = TRUE)",
                (applicant_no, req_no)
            )
            declined_scholarships = cur.fetchall()
            
            cur.execute(
                """
                UPDATE applicant_status
                SET is_accepted = FALSE
                WHERE applicant_no = %s AND scholarship_no != %s
                """,
                (applicant_no, req_no),
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
        
        # Trigger Notification for the applicant
        status_label = "Accepted" if status in [True, 1, 'true', 'True'] else "Rejected"
        cur.execute("SELECT scholarship_name FROM scholarships WHERE req_no = %s", (req_no,))
        sch_row = cur.fetchone()
        sch_name = sch_row['scholarship_name'] if sch_row else f"Scholarship #{req_no}"
        
        try:
            create_notification(
                user_no=applicant_no,
                title=f"Application Result: {status_label}",
                message=f"Your application for {sch_name} has been {status_label.lower()}.",
                notif_type='result'
            )
        except Exception as e:
            print(f"[NOTIF ERROR] Failed to trigger result notification: {e}")

        return jsonify({'message': 'Status updated'})
    except Exception as exc:
        return jsonify({'message': str(exc)}), 500
    finally:
        if 'conn' in locals():
            conn.close()


@student_api_bp.route('/announcements', methods=['GET'])
def get_announcements():
    try:
        conn = get_db()
        cur = conn.cursor()
        try:
            primary_key_column, foreign_key_column = get_announcement_image_columns(cur)
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

        # Build the date expression based on what columns actually exist
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

        where_clause = ''
        if 'is_removed' in announcement_columns:
            where_clause = 'WHERE COALESCE(a.is_removed, FALSE) = FALSE'

        # Join announcements with scholarship_providers to get the name of the provider
        if primary_key_column and foreign_key_column:
            cur.execute(f"""
                SELECT a.ann_no, a.ann_title, a.ann_message, {date_col} AS ann_date, {date_col} AS time_added, COALESCE(sp.provider_name, 'Unknown Provider') AS provider_name,
                       ai.{primary_key_column} AS image_id
                FROM announcements a
                LEFT JOIN scholarship_providers sp ON a.pro_no = sp.pro_no
                LEFT JOIN announcement_images ai ON a.ann_no = ai.{foreign_key_column}
                {where_clause}
                ORDER BY {order_col}, ai.{primary_key_column}
            """)
        else:
            cur.execute(f"""
                SELECT a.ann_no, a.ann_title, a.ann_message, {date_col} AS ann_date, {date_col} AS time_added, COALESCE(sp.provider_name, 'Unknown Provider') AS provider_name,
                       NULL AS image_id
                FROM announcements a
                LEFT JOIN scholarship_providers sp ON a.pro_no = sp.pro_no
                {where_clause}
                ORDER BY {order_col}
            """)

        rows = cur.fetchall()

        announcements = {}
        for row in rows:
            ann_no = row['ann_no']
            ann_date = row.get('ann_date')
            if ann_date and hasattr(ann_date, 'date'):
                date_str = str(ann_date.date())
            elif ann_date:
                date_str = str(ann_date)
            else:
                date_str = 'Recent'
            if ann_no not in announcements:
                announcements[ann_no] = {
                    'ann_no': ann_no,
                    'ann_title': row['ann_title'],
                    'ann_message': row['ann_message'],
                    'created_at': date_str,
                    'time_added': row.get('time_added'),
                    'provider_name': row['provider_name'],
                    'announcementImages': []
                }

            if row.get('image_id') is not None:
                announcements[ann_no]['announcementImages'].append(
                    url_for(
                        'admin_api.get_announcement_image_by_index',
                        ann_no=ann_no,
                        idx=len(announcements[ann_no]['announcementImages']),
                        _external=True,
                    )
                )

        return jsonify(list(announcements.values()))
    except Exception as e:
        return jsonify({'message': f"Error fetching announcements: {str(e)}"}), 500
    finally:
        if 'conn' in locals():
            conn.close()


@student_api_bp.errorhandler(404)
def student_not_found(_error):
    return jsonify({'message': 'Resource not found'}), 404


@student_api_bp.errorhandler(500)
def student_server_error(_error):
    return jsonify({'message': 'Internal server error'}), 500

@student_api_bp.route('/verification/face-match', methods=['POST'])
@token_required
def face_match():
    """
    Standalone face verification (live photo vs ID image).
    """
    data = request.get_json() or {}
    face_image_data = data.get('face_image')
    id_image_data = data.get('id_image')

    if not face_image_data or not id_image_data:
        return jsonify({'verified': False, 'message': 'Missing face or ID image.'}), 400

    try:
        face_bytes = resolve_verification_image_bytes(face_image_data)
        id_bytes = resolve_verification_image_bytes(id_image_data)

        if not face_bytes or not id_bytes:
            return jsonify({'verified': False, 'message': 'Invalid image format. Must be base64 or a trusted Supabase storage URL.'}), 400

        # Face match can take 10-20s on first load due to model init
        # Use tpool.execute to avoid blocking the main Eventlet loop, 
        # which prevents timeouts and 'CORS issues' caused by dropped connections.
        verified, message, confidence = eventlet.tpool.execute(
            verify_face_with_id, face_bytes, id_bytes
        )
        return jsonify({
            'verified': verified,
            'message': message,
            'confidence': confidence
        })
    except ValueError as e:
        # Proper domain error (e.g. face too small, no face detected)
        return jsonify({'verified': False, 'message': str(e), 'confidence': 0.0}), 200
    except Exception as e:
        print(f"[FACE-MATCH] Unexpected Error: {str(e)}", flush=True)
        return jsonify({'verified': False, 'message': f'Internal service error: {str(e)}'}), 500


@student_api_bp.route('/verification/signature-match', methods=['POST'])
@token_required
def signature_match():
    """
    Signature verification — compares submitted signature with signatures on ID back.
    Extracts signature regions from ID back and matches against submitted signature.
    Returns confidence score and verification result.
    """
    data = request.get_json() or {}
    signature_data = data.get('signature_image')
    id_back_data = data.get('id_back_image')

    if not signature_data or not id_back_data:
        return jsonify({'verified': False, 'message': 'Missing signature or ID back image.', 'confidence': 0.0}), 400

    try:
        signature_bytes = resolve_verification_image_bytes(signature_data)
        id_back_bytes = resolve_verification_image_bytes(id_back_data)

        if not signature_bytes or not id_back_bytes:
            return jsonify({'verified': False, 'message': 'Invalid image format. Must be base64 or a trusted Supabase storage URL.', 'confidence': 0.0}), 400

        # Use new signature verification function
        # Pass request.user_no (from token) to enable local profile matching
        student_id = getattr(request, 'user_no', None)
        verified, message, confidence, sub_img, ext_img, matcher_sub_img, matcher_ref_img = verify_signature_against_id(signature_bytes, id_back_bytes, student_id=student_id)
        
        # Convert images to base64 for frontend display
        processed_submitted = None
        extracted_signature = None
        matcher_submitted = None
        matcher_reference = None
        
        if sub_img is not None:
             _, buffer = cv2.imencode('.png', sub_img)
             processed_submitted = f"data:image/png;base64,{base64.b64encode(buffer).decode('utf-8')}"
             
        if ext_img is not None:
             _, buffer = cv2.imencode('.png', ext_img)
             extracted_signature = f"data:image/png;base64,{base64.b64encode(buffer).decode('utf-8')}"

           if matcher_sub_img is not None:
              _, buffer = cv2.imencode('.png', matcher_sub_img)
              matcher_submitted = f"data:image/png;base64,{base64.b64encode(buffer).decode('utf-8')}"

           if matcher_ref_img is not None:
              _, buffer = cv2.imencode('.png', matcher_ref_img)
              matcher_reference = f"data:image/png;base64,{base64.b64encode(buffer).decode('utf-8')}"
        
        # Ensure all values are native Python types (not numpy types)
        return jsonify({
            'verified': bool(verified),
            'message': str(message),
            'confidence': float(confidence),
            'processed_submitted': processed_submitted,
              'extracted_signature': extracted_signature,
              'matcher_submitted': matcher_submitted,
              'matcher_reference': matcher_reference
        })
    except Exception as e:
        print(f"[SIGNATURE-MATCH] Error: {str(e)}", flush=True)
        import traceback
        traceback.print_exc()
        return jsonify({'verified': False, 'message': f'Internal verification error: {str(e)}', 'confidence': 0.0}), 500


@student_api_bp.route('/verification/signature-feedback', methods=['POST'])
@token_required
def signature_feedback():
    """
    Saves a confirmed real signature as a local profile for future matching.
    Or saves a fake signature to a local blacklist.
    """
    data = request.get_json() or {}
    signature_data = data.get('signature_image')
    feedback_type = data.get('type') # 'real' or 'fake'
    student_id = getattr(request, 'user_no', None)

    if not student_id:
        return jsonify({'success': False, 'message': 'Student ID not found in token.'}), 400

    try:
        signature_bytes = decode_base64(signature_data)
        if not signature_bytes:
            return jsonify({'success': False, 'message': 'Invalid signature image.'}), 400
        
        # Now passing feedback_type ('real' or 'fake')
        success = save_signature_profile(student_id, signature_bytes, profile_type=feedback_type)
        
        msg = f"Local signature profile updated. The system has now 'learned' this signature."
        if feedback_type == 'fake':
            msg = "Signature blacklisted. The system will now automatically penalize this specific drawing."
            
        return jsonify({
            'success': success,
            'message': msg if success else f'Failed to save {feedback_type} profile.'
        })
    except Exception as e:
        print(f"[SIGNATURE-FEEDBACK] Error: {str(e)}", flush=True)
        return jsonify({'success': False, 'message': str(e)}), 500


@student_api_bp.route('/verification/clear-knowledge', methods=['POST'])
@token_required
def clear_knowledge():
    """
    Deletes all local training data (profiles and blacklists) for the current student.
    """
    student_id = getattr(request, 'user_no', None)
    if not student_id:
        return jsonify({'success': False, 'message': 'Student ID not found in token.'}), 400

    from services.ocr_utils import clear_student_knowledge
    success = clear_student_knowledge(student_id)
    
    return jsonify({
        'success': success,
        'message': 'Local training data cleared successfully.' if success else 'Failed to clear data.'
    })


@student_api_bp.route('/videos/convert-and-upload', methods=['POST'])
@token_required
def upload_video():
    """
    Directly upload the video to Supabase while preserving its original format and MIME type.
    This bypasses slow/heavy server-side conversion, preventing 502 Bad Gateway and OOM crashes,
    while correctly serving the exact formats browsers recorded in (preventing Format errors).
    """
    try:
        current_user_id = request.user_no
        
        if 'video' not in request.files:
            return jsonify({'success': False, 'message': 'No video file provided'}), 400
        
        video_file = request.files['video']
        field_name = request.form.get('field_name', 'unknown')
        
        if not video_file or video_file.filename == '':
            return jsonify({'success': False, 'message': 'Empty video file'}), 400
        
        # Read file bytes into memory
        video_bytes = video_file.read()
        file_size = len(video_bytes)
        
        # Determine the accurate extension and MIME type to avoid browser format errors
        content_type = video_file.mimetype or 'video/mp4'
        original_ext = os.path.splitext(video_file.filename)[1].lower() if video_file.filename else ''
        
        ext = '.mp4'
        if 'webm' in content_type.lower() or original_ext == '.webm':
            ext = '.webm'
            content_type = 'video/webm'
        elif 'quicktime' in content_type.lower() or original_ext == '.mov':
            ext = '.mov'
            content_type = 'video/quicktime'
        elif original_ext:
            ext = original_ext
            
        print(f"[VIDEO-UPLOAD] Direct upload for User {current_user_id}: {field_name} "
              f"({file_size} bytes as {content_type}{ext})", flush=True)
              
        # OPTION A: Fix the Chrome MEDIA_ELEMENT_ERROR for mp4 local streams
        # We only run the faststart copier for mp4/mov formats (takes 0mb memory)
        # WebM handles streaming natively without container reconstruction.
        from services.video_converter import faststart_video_stream
        if ext in ['.mp4', '.mov']:
            video_bytes = faststart_video_stream(video_bytes, ext=ext)
            file_size = len(video_bytes)
            # Override extension and content_type because faststart_video_stream forces .mp4 output
            ext = '.mp4'
            content_type = 'video/mp4'

        try:
            from supabase import create_client
            
            supabase_url = os.environ.get('SUPABASE_URL')
            supabase_key = os.environ.get('SUPABASE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
            
            if not supabase_url or not supabase_key:
                return jsonify({
                    'success': False, 
                    'message': 'Server configuration error: Supabase credentials not configured'
                }), 500
            
            supabase = create_client(supabase_url, supabase_key)
            
            folder_map = {
                'mayorIndigency_video': 'indigency',
                'mayorCOE_video': 'coe',
                'mayorGrades_video': 'grades',
                'schoolIdFront_video': 'school_id',
                'schoolIdBack_video': 'school_id',
                'id_vid_url': 'id_verification',
                'face_video': 'id_verification'
            }
            
            folder = folder_map.get(field_name, 'others')
            file_name = f"{current_user_id}_{int(time.time())}{ext}"
            file_path = f"videos/{folder}/{file_name}"

            # --- OVERWRITE PREVIOUS VIDEO CLEANUP (non-blocking) ---
            # Run in background thread so it doesn't delay the upload response.
            db_column_map = {
                'mayorIndigency_video': 'indigency_vid_url',
                'mayorCOE_video': 'enrollment_certificate_vid_url',
                'mayorGrades_video': 'grades_vid_url',
                'schoolIdFront_video': 'schoolid_front_vid_url',
                'schoolIdBack_video': 'schoolid_back_vid_url',
                'face_video': 'id_vid_url'
            }
            db_col = db_column_map.get(field_name)
            if db_col:
                import threading
                def _cleanup_old_video(user_id, col, supa):
                    from services.db_service import get_db
                    from services.applicant_document_service import fetch_applicant_document_values
                    try:
                        conn = get_db()
                        cur = conn.cursor()
                        row = fetch_applicant_document_values(cur, user_id, [col])
                        if row and row[col]:
                            old_url = row[col]
                            if '/public/document_videos/' in old_url:
                                old_path = old_url.split('/public/document_videos/')[1].strip()
                                supa.storage.from_('document_videos').remove([old_path])
                                print(f"[VIDEO-UPLOAD] Deleted previous video from storage: {old_path}", flush=True)
                    except Exception as e:
                        print(f"[VIDEO-UPLOAD] Error cleaning up old video: {e}", flush=True)
                    finally:
                        try: conn.close()
                        except: pass
                threading.Thread(target=_cleanup_old_video, args=(current_user_id, db_col, supabase), daemon=True).start()
            # ----------------------------------------
            # Direct stream upload bypasses heavy memory buffers
            response = supabase.storage.from_('document_videos').upload(
                file_path,
                video_bytes,
                file_options={
                    'content-type': content_type,
                    'cache-control': '3600',
                    'upsert': 'true'
                }
            )
            
            public_url = supabase.storage.from_('document_videos').get_public_url(file_path)
            print(f"[VIDEO-UPLOAD] Successfully verified and uploaded: {public_url}", flush=True)
            
            return jsonify({
                'success': True,
                'message': 'Video uploaded successfully',
                'publicUrl': public_url,
                'originalSize': file_size,
                'convertedSize': file_size  # Kept for frontend compatibility
            })
            
        except Exception as upload_err:
            error_msg = str(upload_err)
            print(f"[VIDEO-UPLOAD] Supabase upload error: {error_msg}", flush=True)
            return jsonify({
                'success': False, 
                'message': f'Video upload to storage failed: {error_msg}'
            }), 500
    
    except Exception as e:
        error_msg = str(e)
        print(f"[VIDEO-CONVERT-UPLOAD] Error: {error_msg}", flush=True)
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False, 
            'message': f'Video processing failed: {error_msg}'
        }), 500

