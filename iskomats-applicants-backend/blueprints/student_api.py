import base64
from cryptography.fernet import Fernet
from collections import OrderedDict
import eventlet.tpool
from eventlet import GreenPool
import hashlib
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
from flask import Blueprint, jsonify, request, url_for

from flask_bcrypt import Bcrypt

import cv2
import numpy as np
from services.auth_service import get_secret_key
from services.db_service import get_db, get_db_startup
from project_config import get_supabase_client, get_storage_bucket, use_storage
from services.email_table_service import get_applicant_email_table, get_user_email_table
from services.applicant_document_service import (
    APPLICANT_DOCUMENT_COLUMNS,
    applicant_has_column,
    fetch_applicant_document_values,
    get_applicant_document_table,
    persist_applicant_document_values,
    normalize_supabase_url
)

from services.ocr_utils import (
    verify_face_with_id, 
    verify_signature_against_id, 
    save_signature_profile
)
from services.notification_service import create_notification, fetch_google_access_token, send_verification_email
from services.google_auth_service import verify_google_token
from concurrent.futures import ThreadPoolExecutor

def normalize_semester_label(value):
    if not value: return None
    v = str(value).lower().strip()
    if '1st' in v or 'first' in v or '1' in v: return '1st'
    if '2nd' in v or 'second' in v or '2' in v: return '2nd'
    if '3rd' in v or 'third' in v or '3' in v: return '3rd'
    return v

# --- SCHEMA MIGRATION ---
def ensure_applicant_verification_columns():
    try:
        conn = get_db_startup()
        cur = conn.cursor()
        applicant_email_table = get_applicant_email_table(cur)
        
        # Check if columns exist
        cur.execute(f"""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = %s AND column_name IN ('is_verified')
        """, (applicant_email_table,))
        existing = {row['column_name'] if isinstance(row, dict) else row[0] for row in cur.fetchall()}
        
        if 'is_verified' not in existing:
            print(f"[MIGRATION] Adding is_verified to {applicant_email_table}")
            cur.execute(f"ALTER TABLE {applicant_email_table} ADD COLUMN is_verified BOOLEAN DEFAULT FALSE")
            # For existing users, assume they are verified since they were promoted
            cur.execute(f"UPDATE {applicant_email_table} SET is_verified = TRUE")
            
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"[MIGRATION ERROR] Failed to ensure applicant verification columns: {e}")

# Run migration
try:
    ensure_applicant_verification_columns()
except Exception:
    pass


student_api_bp = Blueprint('student_api', __name__, url_prefix='/api/student')
bcrypt = Bcrypt()
SECRET_KEY = get_secret_key()

_announcement_image_columns = None
_applicant_status_created_at_checked = False
_video_fetch_cache = OrderedDict()
_video_fetch_cache_lock = threading.Lock()
_VIDEO_FETCH_CACHE_SIZE_LIMIT = 24
_VIDEO_FETCH_CACHE_TTL_SECONDS = 300
_verification_result_cache = OrderedDict()
_verification_result_cache_lock = threading.Lock()
_VERIFICATION_RESULT_CACHE_SIZE_LIMIT = 128
_VERIFICATION_RESULT_CACHE_TTL_SECONDS = 300
PENDING_REGISTRATION_EXPIRY_WINDOW = timedelta(hours=1)
def academic_year_matches_expected(found_year, expected_year):
    """Core AY matching logic"""
    if not expected_year: return True
    if not found_year: return False

    # Normalize found and expected to digit lists
    found_years = [int(y) for y in re.findall(r'20\d{2}', str(found_year))]
    # Handle both hyphen and Unicode dashes
    expected_str = str(expected_year).replace('–', '-').replace('—', '-')
    expected_years = [int(y) for y in re.findall(r'20\d{2}', expected_str)]

    if not found_years or not expected_years: return False

    # Check for direct year match (e.g. 2026 in 2026-2027)
    for f in found_years:
        if f in expected_years:
            return True
            
    # Range check
    if len(expected_years) >= 2:
        min_exp, max_exp = min(expected_years), max(expected_years)
        return any(min_exp <= y <= max_exp for y in found_years)
    
    # Target check
    latest_found = max(found_years)
    target_year = expected_years[0]
    return latest_found >= target_year

def academic_year_matches_latest_expected(found_year, expected_year):
    # Use the harmonized logic
    return academic_year_matches_expected(found_year, expected_year)


def build_academic_year_keywords(expected_year):
    keywords = ['School Year', 'Academic Year', 'A.Y.', 'S.Y.']
    years = re.findall(r'20\d{2}', str(expected_year or ''))

    if years:
        keywords.extend(years)
        if len(years) >= 2:
            start_year, end_year = years[0], years[1]
            keywords.extend([
                f'{start_year}-{end_year}',
                f'{start_year} - {end_year}',
                f'{start_year}–{end_year}',
                f'{start_year} – {end_year}',
            ])

    return list(dict.fromkeys(keyword for keyword in keywords if keyword))


def format_academic_period(expected_year, expected_semester=None):
    parts = []
    if expected_year:
        parts.append(str(expected_year).strip())

    normalized_semester = normalize_semester_label(expected_semester)
    if normalized_semester:
        parts.append(normalized_semester)

    return ' '.join(parts) if parts else 'current academic period'





def gpa_matches_text(raw_text, expected_gpa):
    # 1. Normalize expected GPA as a string to preserve precision
    expected_str = str(expected_gpa or '').strip()
    match_expected = re.search(r'\d+(?:\.\d+)?', expected_str)
    if not match_expected:
        return True, None, []
    
    expected_digits = match_expected.group(0).replace(',', '.') # e.g. "3.54"
    raw_text_str = str(raw_text or '')
    
    # Homoglyphs for number correction
    HOMOGLYPHS = {'s': '5', 'o': '0', 'z': '2', 'b': '8', 'i': '1', 'l': '1', 't': '7'}

    def clean_num(s):
        s = s.replace(' ', '').replace(',', '.').lower()
        for char, sub in HOMOGLYPHS.items():
            s = s.replace(char, sub)
        return s

    # 2. Extract all potential numbers from text
    # Support spaces like "3. 54"
    num_pattern = r'\b(\d+\s*[\.\,]\s*[a-zA-Z0-9]+|[a-zA-Z0-9]+)\b'
    
    candidates = []
    # a. Check labeled sections first (GPA, GWA, etc)
    gpa_patterns = [
        r'g\s*\.?\s*p\s*\.?\s*a\s*\.?\s*[:=]?\s*([a-zA-Z0-9]+\s*[\.\,]\s*[a-zA-Z0-9]+|[a-zA-Z0-9]+)',
        r'weighted\s*average\s*[:=]?\s*([a-zA-Z0-9]+\s*[\.\,]\s*[a-zA-Z0-9]+|[a-zA-Z0-9]+)',
        r'g\s*w\s*a\s*[:=]?\s*([a-zA-Z0-9]+\s*[\.\,]\s*[a-zA-Z0-9]+|[a-zA-Z0-9]+)',
        r'q\s*p\s*a\s*[:=]?\s*([a-zA-Z0-9]+\s*[\.\,]\s*[a-zA-Z0-9]+|[a-zA-Z0-9]+)',
        r'\b(?:avg|average|rating|weighted\s*avg|gwa|gpa)\s*[:=]?\s*([a-zA-Z0-9]+\s*[\.\,]\s*[a-zA-Z0-9]+|[a-zA-Z0-9]+)'
    ]
    for pattern in gpa_patterns:
        for m in re.finditer(pattern, raw_text_str, re.IGNORECASE):
            candidates.append(clean_num(m.group(1)))
            
    # b. Absolute fallback: all words that look like numbers
    for m in re.finditer(num_pattern, raw_text_str):
        c = clean_num(m.group(1))
        if c not in candidates:
            candidates.append(c)

    # 3. Apply the "Precision Match" rule
    # Rule: If applicant wrote 3.5, accept 3.54676 (startswith)
    # Rule: If applicant wrote 3.54, fail 3.45
    target_clean = clean_num(expected_digits)
    
    for c in candidates:
        if c.startswith(target_clean):
            return True, expected_digits, [c]
            
    # 4. Fallback for float matching (legacy support for percentage scales)
    try:
        expected_val = float(target_clean)
        for c in candidates:
            try:
                c_val = float(c)
                if abs(c_val - expected_val) < 0.001:
                    return True, expected_digits, [c]
            except: continue
    except: pass

    return False, None, candidates

def normalize_to_percent(val):
    """Converts point scales (1.0-5.0) to approx percentage (70-100)."""
    try:
        val = float(val)
    except:
        return val

    if 70.0 <= val <= 100.0: return val
    # 4.0 Scale (e.g. DLSL, US Schools) where 4.0 is 100%
    if 1.0 <= val <= 4.0:
        # Approx linear mapping: 4.0->99, 3.0->87, 2.0->80, 1.0->75
        return 75.0 + (val - 1.0) * 8.0
    # 5.0 Scale (e.g. UP, most PH public) where 1.0 is 100%, 3.0 is passing, 5.0 is failing
    if 1.0 <= val <= 5.0:
        # 1.0->99, 3.0->75, 5.0->50
        return 100.0 - (val - 1.0) * 12.5
    return val



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


def fetch_pending_registration(cursor, *, email=None, verification_code=None):
    if not email and not verification_code:
        return None, False

    if email:
        cursor.execute(
            '''
            SELECT pr_no, email_address, password_hash, verification_code, created_at
            FROM pending_registrations
            WHERE email_address ILIKE %s
            ''',
            (email,),
        )
    else:
        cursor.execute(
            '''
            SELECT pr_no, email_address, password_hash, verification_code, created_at
            FROM pending_registrations
            WHERE verification_code = %s
            ''',
            (verification_code,),
        )

    pending = cursor.fetchone()
    if not pending:
        return None, False

    created_at = pending.get('created_at')
    if created_at and created_at <= datetime.utcnow() - PENDING_REGISTRATION_EXPIRY_WINDOW:
        cursor.execute('DELETE FROM pending_registrations WHERE pr_no = %s', (pending['pr_no'],))
        return None, True

    return pending, False


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


def _hash_verification_source(value):
    if value is None:
        return None
    if hasattr(value, 'tobytes'):
        value = value.tobytes()
    elif isinstance(value, bytearray):
        value = bytes(value)

    if isinstance(value, bytes):
        return hashlib.md5(value).hexdigest()

    return str(value).strip()


def _cache_verification_result(cache_key, payload):
    now = time.time()
    with _verification_result_cache_lock:
        _verification_result_cache[cache_key] = {
            'payload': payload,
            'timestamp': now,
        }
        _verification_result_cache.move_to_end(cache_key)
        while len(_verification_result_cache) > _VERIFICATION_RESULT_CACHE_SIZE_LIMIT:
            _verification_result_cache.popitem(last=False)


def _get_cached_verification_result(cache_key):
    now = time.time()
    with _verification_result_cache_lock:
        cached = _verification_result_cache.get(cache_key)
        if not cached:
            return None
        if now - cached['timestamp'] > _VERIFICATION_RESULT_CACHE_TTL_SECONDS:
            _verification_result_cache.pop(cache_key, None)
            return None
        _verification_result_cache.move_to_end(cache_key)
        return cached['payload']


def prefetch_video_urls(urls, max_workers=4):
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
    
    # Normalize URL to current Supabase project if applicable
    url = normalize_supabase_url(url)
    
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


def verify_video_reference(url):
    if not url:
        return False, "Mandatory supporting video is missing"
    if not isinstance(url, str) or not url.startswith('http'):
        return False, f"Invalid URL: {url}"

    normalized_url = url.strip()
    cached = _get_cached_video_fetch(normalized_url)
    if cached is not None:
        content, error = cached
        if content is not None:
            return True, "Supporting video linked"
        if error:
            return False, f"Video reference unavailable ({error})"

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ISKOMATS-Verification-Bot/1.0'
    }
    url_to_fetch = normalized_url
    supabase_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if supabase_key and 'supabase.co' in normalized_url:
        if '/object/public/' in normalized_url:
            url_to_fetch = normalized_url.replace('/object/public/', '/object/authenticated/')
        headers['apikey'] = supabase_key
        headers['Authorization'] = f"Bearer {supabase_key}"

    try:
        response = requests.head(url_to_fetch, headers=headers, timeout=5, allow_redirects=True)
        status_code = response.status_code
        if status_code == 405:
            response = requests.get(url_to_fetch, headers={**headers, 'Range': 'bytes=0-0'}, timeout=5, stream=True)
            status_code = response.status_code

        if 200 <= status_code < 400 or status_code == 206:
            return True, "Supporting video linked"
        return False, f"Video reference unavailable (HTTP {status_code})"
    except requests.exceptions.Timeout:
        return False, "Video reference timeout"
    except Exception as e:
        return False, str(e)


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


def upload_image_to_storage(image_data, applicant_no, field_name, is_update=False):
    """
    Uploads image data to Supabase storage and returns the public URL.
    """
    try:
        from project_config import use_storage, get_storage_bucket, get_supabase_client
        from services.db_service import get_db
        # db_bytes is defined as a module-level function in this file (student_api.py)

        if not image_data or not use_storage():
            return None

        # Clean folder mapping
        folder_map = {
            'signature_image_data': 'signatures',
            'grades_doc': 'grades',
            'enrollment_certificate_doc': 'coe',
            'indigency_doc': 'indigency',
            'id_img_front': 'id_verification',
            'id_img_back': 'id_verification',
            'profile_picture': 'profile_pictures',
        }

        folder = folder_map.get(field_name, 'others')

        bucket_name = get_storage_bucket()
        supabase = get_supabase_client()
        if not supabase:
            print(f"[STORAGE ERROR] Supabase client unavailable for {field_name}", flush=True)
            return None

        # Clean up old file if updating
        if is_update:
            try:
                from services.applicant_document_service import fetch_applicant_document_values
                with get_db() as conn:
                    with conn.cursor() as cur:
                        existing_results = fetch_applicant_document_values(cur, applicant_no, [field_name])
                        old_url = existing_results.get(field_name)
                        
                        if old_url and isinstance(old_url, str) and old_url.startswith('http'):
                            if f"{bucket_name}/" in old_url:
                                old_path = old_url.split(f"{bucket_name}/")[-1]
                                print(f"[STORAGE] Cleanup: Removing old file {old_path}", flush=True)
                                supabase.storage.from_(bucket_name).remove([old_path])
            except Exception as clean_err:
                print(f"[STORAGE WARNING] Cleanup failed for {field_name}: {clean_err}", flush=True)

        # Generate unique path: {folder}/{applicant_no}-{field_name}.jpg
        file_path = f"{folder}/{applicant_no}-{field_name}.jpg"
        mime_type = "image/jpeg"
        
        # Ensure we have bytes
        if isinstance(image_data, str) and image_data.startswith('http'):
            return image_data # Already a URL
            
        data_to_upload = db_bytes(image_data)
        if not data_to_upload:
            return None
            
        # Encrypt binary image data before uploading to Supabase Storage
        from services.crypto_utils import encrypt_data
        data_to_upload = encrypt_data(data_to_upload)
        mime_type = 'application/octet-stream'
        
        # Binary data upload
        try:
            print(f"[STORAGE] Uploading encrypted {len(data_to_upload)} bytes to bucket: '{bucket_name}', path: '{file_path}'", flush=True)
            # Use positional arguments for safety [path, file, options]
            supabase.storage.from_(bucket_name).upload(
                file_path,
                bytes(data_to_upload),
                {
                    'content-type': mime_type, 
                    'upsert': 'true',
                    'cache-control': '31536000'
                }
            )
        except Exception as upload_err:
            print(f"[STORAGE ERROR] SDK upload call failed for {field_name}: {upload_err}", flush=True)
            return None
        
        # Public URL structure
        public_url_obj = supabase.storage.from_(bucket_name).get_public_url(file_path)
        
        # Handle different SDK return types
        if hasattr(public_url_obj, 'public_url'):
            public_url = public_url_obj.public_url
        elif isinstance(public_url_obj, dict):
            public_url = public_url_obj.get('public_url')
        else:
            public_url = str(public_url_obj)
        
        if not public_url or not public_url.startswith('http'):
            print(f"[STORAGE ERROR] Invalid public URL returned for {field_name}: {public_url}", flush=True)
            return None

        print(f"[STORAGE] SUCCESS: {field_name} uploaded. URL: {public_url[:50]}...", flush=True)
        return public_url
    except Exception as e:
        print(f"[STORAGE ERROR] Upload failed for field {field_name}: {e}", flush=True)
        import traceback
        traceback.print_exc()
        return None


from services.crypto_utils import decrypt_if_encrypted

def resolve_verification_image_bytes(image_data):
    if not image_data:
        return None
    
    raw_bytes = None
    if isinstance(image_data, memoryview):
        raw_bytes = image_data.tobytes()
    elif isinstance(image_data, (bytes, bytearray)):
        raw_bytes = bytes(image_data)
    elif isinstance(image_data, str):
        normalized = image_data.strip()
        if not normalized:
            return None
            
        decoded = decode_base64(normalized)
        if decoded:
            raw_bytes = decoded
        elif normalized.startswith('http'):
            target_url = normalize_supabase_url(normalized)
            if is_trusted_storage_url(target_url):
                content, _error = fetch_video_bytes_from_url(target_url)
                raw_bytes = content

    if raw_bytes:
        # Decrypt if the frontend encrypted it before upload
        return decrypt_if_encrypted(raw_bytes)

    return None


def normalize_matching_text(value):
    return re.sub(r'[^a-z0-9]+', ' ', str(value or '').lower()).strip()




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


def normalize_identity_name(value):
    return normalize_matching_text(value)


def normalize_parent_full_name(value):
    cleaned = ' '.join(str(value or '').split())
    return cleaned or None


def build_restriction_identity(first_name=None, middle_name=None, last_name=None, father_name=None, mother_name=None):
    family_last_name = normalize_identity_name(last_name)
    father_name = normalize_identity_name(father_name)
    mother_name = normalize_identity_name(mother_name)

    if not family_last_name or not father_name or not mother_name:
        return None

    return {
        'family_last_name': family_last_name,
        'father_name': father_name,
        'mother_name': mother_name,
        'identity_key': '|'.join([family_last_name, father_name, mother_name]),
    }


def build_duplicate_account_identity(first_name=None, middle_name=None, last_name=None, barangay=None):
    applicant_full_name = normalize_identity_name(' '.join(filter(None, [first_name, middle_name, last_name])))
    barangay = normalize_identity_name(barangay)

    if not applicant_full_name or not barangay:
        return None

    return {
        'applicant_full_name': applicant_full_name,
        'barangay': barangay,
        'identity_key': '|'.join([applicant_full_name, barangay]),
    }


def build_restriction_identity_from_applicant(applicant, source_data=None):
    source_data = source_data or {}

    first_name = source_data.get('firstName') or source_data.get('first_name') or applicant.get('first_name')
    middle_name = source_data.get('middleName') or source_data.get('middle_name') or applicant.get('middle_name')
    last_name = source_data.get('lastName') or source_data.get('last_name') or applicant.get('last_name')

    if 'fatherName' in source_data or 'father_name' in source_data:
        father_name = normalize_parent_full_name(source_data.get('fatherName') or source_data.get('father_name'))
    else:
        father_name = normalize_parent_full_name(applicant.get('father_name'))

    if 'motherName' in source_data or 'mother_name' in source_data:
        mother_name = normalize_parent_full_name(source_data.get('motherName') or source_data.get('mother_name'))
    else:
        mother_name = normalize_parent_full_name(applicant.get('mother_name'))

    return build_restriction_identity(
        first_name=first_name,
        middle_name=middle_name,
        last_name=last_name,
        father_name=father_name,
        mother_name=mother_name,
    )


def build_duplicate_account_identity_from_applicant(applicant, source_data=None):
    source_data = source_data or {}

    first_name = source_data.get('firstName') or source_data.get('first_name') or applicant.get('first_name')
    middle_name = source_data.get('middleName') or source_data.get('middle_name') or applicant.get('middle_name')
    last_name = source_data.get('lastName') or source_data.get('last_name') or applicant.get('last_name')
    barangay = source_data.get('streetBarangay') or source_data.get('street_brgy') or applicant.get('street_brgy') or applicant.get('barangay')

    return build_duplicate_account_identity(
        first_name=first_name,
        middle_name=middle_name,
        last_name=last_name,
        barangay=barangay
    )


def get_matching_applicant_ids_by_identity(cursor, applicant, source_data=None):
    current_applicant_no = applicant['applicant_no']
    identity = build_restriction_identity_from_applicant(applicant, source_data=source_data)

    if not identity:
        return [current_applicant_no], False, None

    cursor.execute(
        """
        SELECT applicant_no, first_name, middle_name, last_name, father_name, mother_name
        FROM applicants
        """
    )
    rows = cursor.fetchall()

    matching_ids = {current_applicant_no}
    for row in rows:
        row_identity = build_restriction_identity_from_applicant(row)
        if row_identity and row_identity['identity_key'] == identity['identity_key']:
            matching_ids.add(row['applicant_no'])

    return sorted(matching_ids), True, identity


def get_matching_duplicate_applicant_ids(cursor, applicant, source_data=None):
    current_applicant_no = applicant['applicant_no']
    identity = build_duplicate_account_identity_from_applicant(applicant, source_data=source_data)

    if not identity:
        return [current_applicant_no], False, None

    cursor.execute(
        """
        SELECT applicant_no, first_name, middle_name, last_name, street_brgy as barangay
        FROM applicants
        """
    )
    rows = cursor.fetchall()

    matching_ids = {current_applicant_no}
    for row in rows:
        row_identity = build_duplicate_account_identity_from_applicant(row)
        if row_identity and row_identity['identity_key'] == identity['identity_key']:
            matching_ids.add(row['applicant_no'])

    return sorted(matching_ids), True, identity


def scholarship_is_active_record(record, today=None):
    today = today or datetime.now().date()
    if record.get('is_removed'):
        return False

    deadline = record.get('deadline')
    if deadline and deadline < today:
        return False

    return True


def get_identity_restriction_scope(cursor, applicant, source_data=None, today=None):
    today = today or datetime.now().date()
    applicant_ids, identity_ready, identity = get_matching_applicant_ids_by_identity(cursor, applicant, source_data=source_data)

    cursor.execute(
        """
        SELECT ast.applicant_no,
               ast.scholarship_no,
               ast.is_accepted,
               ast.created_at,
               s.scholarship_name,
               s.deadline,
               COALESCE(s.is_removed, FALSE) AS is_removed
        FROM applicant_status ast
        JOIN scholarships s ON s.req_no = ast.scholarship_no
        WHERE ast.applicant_no = ANY(%s)
        """,
        (applicant_ids,),
    )
    applications = cursor.fetchall()

    return {
        'applicant_ids': applicant_ids,
        'current_applicant_ids': [applicant['applicant_no']],
        'identity_ready': identity_ready,
        'identity': identity,
        'applications': applications,
        'today': today,
    }


def describe_identity_subject(scope):
    if scope.get('identity_ready') and len(scope.get('applicant_ids') or []) > 1:
        return 'An applicant with the same last name and parent names'
    return 'You'


def get_scholarship_restriction(scope, scholarship_no):
    today = scope.get('today') or datetime.now().date()
    applications = scope.get('applications') or []
    current_applicant_ids = set(scope.get('current_applicant_ids') or [])
    self_related_rows = [
        row for row in applications
        if row['scholarship_no'] == scholarship_no and row['applicant_no'] in current_applicant_ids
    ]
    active_accepted_rows = [
        row for row in applications
        if row['applicant_no'] in current_applicant_ids and row['is_accepted'] == 'Accepted' and scholarship_is_active_record(row, today=today)
    ]
    subject = describe_identity_subject(scope)

    family_other_rows = [
        row for row in applications
        if row['scholarship_no'] == scholarship_no and row['applicant_no'] not in current_applicant_ids
    ]
    if family_other_rows:
        prior_row = min(
            family_other_rows,
            key=lambda row: (row.get('created_at') or datetime.max, row['applicant_no'])
        )
        status_label = 'applied for'
        reason = 'family-existing-same-scholarship'
        if prior_row['is_accepted'] == 'Accepted':
            status_label = 'already has an accepted application for'
            reason = 'family-accepted-same-scholarship'
        elif prior_row['is_accepted'] == 'Pending' or prior_row['is_accepted'] is None:
            status_label = 'has already applied for'
            reason = 'family-pending-same-scholarship'

        return {
            'already_applied': True,
            'blocked': True,
            'message': f"An applicant with the same last name and parent names {status_label} this scholarship.",
            'reason': reason,
            'auto_reject': True,
            'blocking_application': prior_row,
        }

    same_scholarship_row = next((row for row in self_related_rows if row['is_accepted'] == 'Accepted'), None)
    if same_scholarship_row:
        return {
            'already_applied': True,
            'blocked': True,
            'message': f"{subject} already has an accepted application for this scholarship.",
            'reason': 'identity-accepted-same-scholarship',
            'auto_reject': False,
            'blocking_application': same_scholarship_row,
        }

    same_scholarship_row = next((row for row in self_related_rows if row['is_accepted'] == 'Pending' or row['is_accepted'] is None), None)
    if same_scholarship_row:
        return {
            'already_applied': True,
            'blocked': True,
            'message': f"{subject} has already applied for this scholarship and is still pending review.",
            'reason': 'identity-pending-same-scholarship',
            'auto_reject': False,
            'blocking_application': same_scholarship_row,
        }

    active_accepted_row = next((row for row in active_accepted_rows), None)
    if active_accepted_row:
        scholarship_name = active_accepted_row.get('scholarship_name') or 'another scholarship'
        return {
            'already_applied': False,
            'blocked': True,
            'message': f"{subject} cannot apply for another scholarship while the accepted scholarship '{scholarship_name}' is still active.",
            'reason': 'identity-active-accepted-scholarship',
            'auto_reject': False,
            'blocking_application': active_accepted_row,
        }

    return {
        'already_applied': False,
        'blocked': False,
        'message': None,
        'reason': None,
        'auto_reject': False,
        'blocking_application': None,
    }


def build_student_name_keywords(first_name, middle_name, last_name):
    name_parts = [part.strip() for part in [first_name, middle_name, last_name] if str(part or '').strip()]
    keywords = set(name_parts)

    if len(name_parts) >= 2:
        keywords.add(' '.join(name_parts))
        keywords.add(f"{name_parts[0]} {name_parts[-1]}")

    return sorted((keyword for keyword in keywords if len(normalize_matching_text(keyword)) >= 2), key=len, reverse=True)



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

# Database Migration: Ensure document storage columns are correct type (TEXT)
def ensure_applicant_document_storage():
    try:
        conn = get_db_startup()  # Fast-fail: 3 retries × 0.5s to avoid 300s deploy stall
        cur = conn.cursor()

        # Create pending_registrations table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS pending_registrations (
                pr_no SERIAL PRIMARY KEY,
                email_address TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
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
        
        # --- CLOUD STORAGE MIGRATION: Convert BYTEA to TEXT and Ensure Columns Exist ---
        # Define columns by their intended primary location
        applicant_only_cols = ['profile_picture', 'merits_awards_received']
        
        document_table_cols = [
            'signature_image_data', 'schoolID_photo', 'id_img_front', 'id_img_back',
            'enrollment_certificate_doc', 'grades_doc', 'indigency_doc', 'id_pic',
            'id_vid_url', 'indigency_vid_url', 'grades_vid_url', 
            'enrollment_certificate_vid_url', 'schoolid_front_vid_url', 'schoolid_back_vid_url'
        ]
        
        all_cols_to_check = applicant_only_cols + document_table_cols
        
        # 1. Primary Table: applicants
        cur.execute("""
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'applicants' AND column_name IN %s
        """, (tuple(all_cols_to_check),))
        app_cols_info = {
            (row['column_name'] if isinstance(row, dict) else row[0]): (row['data_type'] if isinstance(row, dict) else row[1]) 
            for row in cur.fetchall()
        }
        
        for col in all_cols_to_check:
            if col in app_cols_info:
                d_type = app_cols_info[col].lower()
                if d_type == 'bytea':
                    print(f"[MIGRATION] EXECUTING: Converting {col} in applicants to TEXT", flush=True)
                    cur.execute(f"UPDATE applicants SET {col} = NULL WHERE {col} IS NOT NULL")
                    cur.execute(f"ALTER TABLE applicants ALTER COLUMN {col} TYPE TEXT")
            elif col in applicant_only_cols:
                # Add missing column to applicants
                print(f"[MIGRATION] Adding missing column {col} to applicants table", flush=True)
                col_type = "BOOLEAN" if "is_" in col else "TEXT"
                cur.execute(f"ALTER TABLE applicants ADD COLUMN {col} {col_type}")
        
        # 2. Auxiliary Table (ensure columns and correct type)
        doc_table = get_applicant_document_table(cur)
        if doc_table:
            print(f"[MIGRATION] Checking auxiliary table: {doc_table}", flush=True)
            cur.execute(f"""
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = '{doc_table}'
            """)
            existing_doc_table_info = {
                (row['column_name'] if isinstance(row, dict) else row[0]).lower(): (row['data_type'] if isinstance(row, dict) else row[1])
                for row in cur.fetchall()
            }
            
            # Only ensure columns that are relevant for the doc table
            for col in document_table_cols:
                col_lower = col.lower()
                if col_lower in existing_doc_table_info:
                    d_type = existing_doc_table_info[col_lower].lower()
                    if d_type == 'bytea':
                        print(f"[MIGRATION] EXECUTING: Converting {col} in {doc_table} to TEXT", flush=True)
                        cur.execute(f"UPDATE {doc_table} SET {col} = NULL WHERE {col} IS NOT NULL")
                        cur.execute(f"ALTER TABLE {doc_table} ALTER COLUMN {col} TYPE TEXT")
                else:
                    # Column missing in auxiliary table, add it as TEXT
                    print(f"[MIGRATION] Adding missing column {col} to {doc_table} as TEXT", flush=True)
                    cur.execute(f"ALTER TABLE {doc_table} ADD COLUMN {col} TEXT")
        
        print("[MIGRATION] Document column conversion completed.", flush=True)
            
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[MIGRATION ERROR] {e}", flush=True)

try:
    ensure_applicant_document_storage()
except Exception as e:
    print(f"[STARTUP ERROR] Applicant storage migration failed: {e}", flush=True)

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
                with get_db() as conn:
                    cur = conn.cursor()
                    applicant_email_table = get_applicant_email_table(cur)
                    cur.execute(f'SELECT is_locked FROM {applicant_email_table} WHERE applicant_no = %s', (applicant_no,))
                    lock_row = cur.fetchone()
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
    if not value:
        return None
        
    # Standardize to bytes (handles URLs and Base64)
    decoded = resolve_verification_image_bytes(value)

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

# send_verification_email removed in favor of services.notification_service version


@student_api_bp.route('/notifications', methods=['GET'])
@token_required
def get_notifications():
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT notif_id as id, title, message, type, is_read as read, created_at
                FROM notifications
                WHERE user_no = %s AND (expires_at IS NULL OR expires_at > NOW())
                ORDER BY created_at DESC
                LIMIT 50
            """, (request.user_no,))
            rows = cur.fetchall()
            
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
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("""
                UPDATE notifications 
                SET is_read = TRUE 
                WHERE notif_id = %s AND user_no = %s
            """, (notif_id, request.user_no))
            conn.commit()
            return jsonify({'message': 'Success'}), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500


@student_api_bp.route('/notifications/read-all', methods=['POST'])
@token_required
def mark_all_notifications_read():
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("""
                UPDATE notifications 
                SET is_read = TRUE 
                WHERE user_no = %s
            """, (request.user_no,))
            conn.commit()
            return jsonify({'message': 'Success'}), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500


@student_api_bp.route('/auth/login', methods=['POST'])
def student_login():
    data = request.get_json() or {}
    email = data.get('email', '').strip()
    password = data.get('password', '')

    try:
        with get_db() as conn:
            cur = conn.cursor()
            applicant_email_table = get_applicant_email_table(cur)
            # Only allow applicant logins - must have applicant_no
            cur.execute(
                f"""
                SELECT app_em_no, applicant_no, password_hash, is_locked, is_verified
                FROM {applicant_email_table}
                WHERE email_address ILIKE %s AND applicant_no IS NOT NULL
                """,
                (email,),
            )
            user = cur.fetchone()

            # If email not found in permanent email table, check if it exists in pending registrations
            if not user:
                pending_reg, pending_expired = fetch_pending_registration(cur, email=email)
                if pending_expired:
                    conn.commit()
                    return jsonify({'message': 'This session has expired', 'session_expired': True}), 401
                if pending_reg:
                    return jsonify({'message': 'Email not verified. Please check your email and enter the verification code to complete registration.', 'requires_verification': True}), 401
                else:
                    return jsonify({'message': 'Email does not exist. Please register first.'}), 401

            if not user.get('password_hash'):
                return jsonify({'message': 'This email is linked to an existing Google account. Please use "Sign in with Google" to access your account.'}), 401

            if not bcrypt.check_password_hash(user['password_hash'], password):
                return jsonify({'message': 'Incorrect password'}), 401

            if not user.get('is_verified', True):
                # Regenerate verification code if they are in permanent table but not verified
                verification_code = generate_verification_code()
                cur.execute(f"UPDATE {applicant_email_table} SET verification_code = %s WHERE app_em_no = %s", (verification_code, user['app_em_no']))
                conn.commit()
                
                try:
                    send_verification_email(email, verification_code)
                except Exception as e:
                    print(f"[EMAIL ERROR] Failed to resend verification email during login: {e}")

                return jsonify({
                    'message': 'Email not verified. A new verification code has been sent to your email.', 
                    'requires_verification': True,
                    'email': email
                }), 401

            if user.get('is_locked'):
                return jsonify({'message': 'Account has been suspended. Please contact the administrator.', 'suspended': True}), 403
 
        payload = {
            'exp': datetime.utcnow() + timedelta(hours=24),
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


@student_api_bp.route('/auth/register', methods=['POST'])
def student_register():
    data = request.get_json() or {}
    email = data.get('email', '').strip()
    password = data.get('password', '')

    if not all([email, password]):
        return jsonify({'message': 'Missing required fields'}), 400

    try:
        with get_db() as conn:
            cur = conn.cursor()
            applicant_email_table = get_applicant_email_table(cur)
            
            # 1. Check if email ALREADY exists as an APPLICANT
            cur.execute(f'SELECT app_em_no, is_verified FROM {applicant_email_table} WHERE email_address ILIKE %s AND applicant_no IS NOT NULL LIMIT 1', (email,))
            existing_user = cur.fetchone()
            
            if existing_user:
                if existing_user.get('is_verified', True):
                    return jsonify({'message': 'Email already registered as applicant and verified. Please sign in.'}), 400
                else:
                    # Handle unverified existing account: Update and resend code
                    verification_code = generate_verification_code()
                    password_hash = bcrypt.generate_password_hash(password).decode('utf-8')
                    cur.execute(
                        f"UPDATE {applicant_email_table} SET password_hash = %s, verification_code = %s WHERE app_em_no = %s",
                        (password_hash, verification_code, existing_user['app_em_no'])
                    )
                    conn.commit()
                    
                    try:
                        send_verification_email(email, verification_code)
                    except Exception as e:
                        print(f"[EMAIL ERROR] Failed to resend verification email during re-registration: {e}")
                        return jsonify({'message': f'Failed to send verification email: {str(e)}'}), 500
                        
                    return jsonify({
                        'message': 'Account already exists but was not verified. A new verification code has been sent.',
                        'is_applicant': True,
                        'requires_verification': True,
                        'email': email
                    }), 201

            # 2. Generate verification code
            verification_code = generate_verification_code()
            password_hash = bcrypt.generate_password_hash(password).decode('utf-8')

            # 3. Store in pending_registrations table (Upsert allowed for re-registration)
            cur.execute(
                """
                INSERT INTO pending_registrations (email_address, password_hash, verification_code)
                VALUES (%s, %s, %s)
                ON CONFLICT (email_address) DO UPDATE SET
                    password_hash = EXCLUDED.password_hash,
                    verification_code = EXCLUDED.verification_code,
                    created_at = NOW()
                """,
                (email, password_hash, verification_code),
            )
            conn.commit()

        # 4. Send verification email (outside lock usually fine, but definitely after commit)
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


@student_api_bp.route('/auth/verify-email', methods=['POST'])
def student_verify_email():
    data = request.get_json() or {}
    email = data.get('email', '').strip()
    token = data.get('token', '').strip()

    if not token:
        return jsonify({'message': 'Verification code is required'}), 400

    try:
        with get_db() as conn:
            cur = conn.cursor()
            applicant_email_table = get_applicant_email_table(cur)
            
            # 1. Look up in pending_registrations
            pending, pending_expired = fetch_pending_registration(
                cur,
                email=email if email else None,
                verification_code=token if not email else None,
            )

            # 1b. If not in pending, check if they are an unverified permanent user
            if not pending and email:
                cur.execute(
                    f"SELECT app_em_no as pr_no, email_address, password_hash FROM {applicant_email_table} WHERE email_address ILIKE %s AND is_verified = FALSE",
                    (email,)
                )
                pending = cur.fetchone()
                if pending:
                    # Mock pr_no for compatibility with the cleanup logic below
                    pending['is_permanent_unverified'] = True

            if pending_expired:
                conn.commit()
                return jsonify({'message': 'This session has expired', 'session_expired': True}), 410

            if not pending:
                # Check if already verified as applicant
                if email:
                    cur.execute(f'SELECT app_em_no FROM {applicant_email_table} WHERE email_address ILIKE %s AND applicant_no IS NOT NULL', (email,))
                    if cur.fetchone():
                        return jsonify({'message': 'Email already verified. Please sign in.'}), 200
                return jsonify({'message': 'Invalid verification code or link has expired'}), 400

            if pending['verification_code'] != token:
                return jsonify({'message': 'Incorrect verification code'}), 400

            if not pending.get('is_permanent_unverified'):
                # 2. Promote to permanent tables
                # Insert a blank applicant profile. Profile setup fills the identity fields after verification.
                cur.execute(
                    """
                    INSERT INTO applicants (first_name, middle_name, last_name)
                    VALUES (%s, %s, %s)
                    RETURNING applicant_no
                    """,
                    ('', None, ''),
                )
                applicant_no = cur.fetchone()['applicant_no']

                # Insert into applicant auth table
                cur.execute(
                    f"""
                    INSERT INTO {applicant_email_table} (email_address, applicant_no, password_hash, is_verified)
                    VALUES (%s, %s, %s, TRUE)
                    """,
                    (pending['email_address'], applicant_no, pending['password_hash']),
                )

                # 3. Cleanup pending registration
                cur.execute('DELETE FROM pending_registrations WHERE pr_no = %s', (pending['pr_no'],))
            else:
                # Already in permanent table, just mark as verified
                cur.execute(f"SELECT applicant_no FROM {applicant_email_table} WHERE email_address ILIKE %s", (email,))
                applicant_no = cur.fetchone()['applicant_no']
                cur.execute(
                    f"UPDATE {applicant_email_table} SET is_verified = TRUE WHERE email_address ILIKE %s",
                    (email,)
                )

            conn.commit()

        # 4. Generate session token
        payload = {
            'exp': datetime.utcnow() + timedelta(hours=24),
            'iat': datetime.utcnow(),
            'user_no': applicant_no,
        }
        session_token = jwt.encode(payload, SECRET_KEY, algorithm='HS256')

        return jsonify({
            'message': 'Email verified successfully',
            'token': session_token,
            'applicant_no': applicant_no,
            'user_no': applicant_no,
            'is_applicant': True
        }), 200
    except Exception as exc:
        return jsonify({'message': f'Error: {str(exc)}'}), 500


@student_api_bp.route('/auth/resend-verification-email', methods=['POST'])
def student_resend_verification_email():
    data = request.get_json() or {}
    email = data.get('email', '').strip()

    if not email:
        return jsonify({'message': 'Email is required'}), 400

    try:
        with get_db() as conn:
            cur = conn.cursor()
            applicant_email_table = get_applicant_email_table(cur)
            
            # 1. Check if email exists in permanent table (already verified)
            cur.execute(f'SELECT app_em_no FROM {applicant_email_table} WHERE email_address ILIKE %s', (email,))
            user = cur.fetchone()
            if user:
                return jsonify({'message': 'Email already verified. Please sign in.'}), 400

            # 2. Check if email exists in pending registrations
            pending, pending_expired = fetch_pending_registration(cur, email=email)

            if pending_expired:
                conn.commit()
                return jsonify({'message': 'This session has expired', 'session_expired': True}), 410

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
        with get_db() as conn:
            cur = conn.cursor()
            applicant_email_table = get_applicant_email_table(cur)
            user_email_table = get_user_email_table(cur)
            
            cur.execute(f'SELECT applicant_no, is_verified FROM {applicant_email_table} WHERE email_address ILIKE %s LIMIT 1', (email,))
            applicant_result = cur.fetchone()
            if applicant_result:
                is_verified = applicant_result.get('is_verified', True)
                if not is_verified:
                    return jsonify({
                        'exists': True,
                        'account_type': 'applicant',
                        'available': True, # Allow re-registration for unverified accounts
                        'is_verified': False,
                        'message': 'Email exists but is not verified. You can re-register to receive a new code.'
                    })
                
                return jsonify({
                    'exists': True,
                    'account_type': 'applicant',
                    'available': False,
                    'is_verified': True,
                    'message': 'Email already registered and verified'
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
        with get_db() as conn:
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
                    INSERT INTO {applicant_email_table} (applicant_no, email_address, is_verified)
                    VALUES (%s, %s, TRUE)
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
            'exp': datetime.utcnow() + timedelta(hours=24)
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
        with get_db() as conn:
            cur = conn.cursor()
            applicant_email_table = get_applicant_email_table(cur)
            user_email_table = get_user_email_table(cur)
            
            # Check if email exists as an applicant
            cur.execute(
                f"""
                SELECT e.applicant_no, e.email_address, a.first_name, a.last_name, e.password_hash
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
                # Block reset for Google accounts
                if not user.get('password_hash'):
                    return jsonify({'message': 'This account uses Google authentication. Please sign in using the "Sign in with Google" button instead.'}), 400
                
                # 3. Generate Link - Dynamic based on request origin
                # Priority: Origin header -> Referer header -> Config/Fallback
                req_origin = request.headers.get('Origin')
                if not req_origin and request.headers.get('Referer'):
                    try:
                        from urllib.parse import urlparse
                        parsed = urlparse(request.headers.get('Referer'))
                        req_origin = f"{parsed.scheme}://{parsed.netloc}"
                    except:
                        pass
                
                frontend_base_url = (req_origin or STUDENT_FRONTEND_URL).rstrip('/')
                reset_token = generate_password_reset_token(user['applicant_no'], user['email_address'])
                reset_url = f"{frontend_base_url}/reset-password?token={reset_token}"
                
                print(f"[PASSWORD RESET] Request from origin: {req_origin or 'Unknown'}", flush=True)
                print(f"[PASSWORD RESET] Generated URL: {reset_url}", flush=True)
                print(f"[PASSWORD RESET] Sending reset email to {user['email_address']}", flush=True)
                
                try:
                    send_password_reset_email(user['email_address'], reset_url)
                    return jsonify({'message': 'A reset link has been sent to your email.'}), 200
                except Exception as email_err:
                    print(f"[PASSWORD RESET ERROR] Gmail API failure: {str(email_err)}", flush=True)
                    return jsonify({
                        'message': 'Failed to send email. There might be a temporary issue with our email service.',
                        'debug_link': reset_url if os.environ.get('FLASK_ENV') == 'development' else None
                    }), 500
            else:
                print(f"[PASSWORD RESET] No applicant account found for email: {email}")
                return jsonify({'message': 'Email not found in our records.'}), 404
    except Exception as exc:
        traceback.print_exc()
        return jsonify({'message': f'Failed to send reset email: {str(exc)}'}), 500


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

        with get_db() as conn:
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
                return jsonify({'message': 'No matching account found. The link might be for a different user.'}), 404

            # Update password and verify account
            cur.execute(
                f"UPDATE {applicant_email_table} SET password_hash = %s, is_verified = TRUE WHERE applicant_no = %s AND TRIM(email_address) ILIKE %s",
                (hashed_password, user_no, email)
            )
            conn.commit()
            
            affected = cur.rowcount
            print(f"[AUTH SUCCESS] Rows updated: {affected}", flush=True)
            
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


@student_api_bp.route('/scholarships', methods=['GET'])
@student_api_bp.route('/scholarships/all', methods=['GET'])

# --- Optimized Scholarships Endpoint ---
@student_api_bp.route('/scholarships', methods=['GET'])
def get_all_scholarships():
    start = time.time()
    limit = int(request.args.get('limit', 50))
    offset = int(request.args.get('offset', 0))
    # Optimization: Bypass invalid global 'cache' reference that causes 500
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute('SELECT req_no, scholarship_name, deadline, gpa, parent_finance, location, "desc" as description, semester, year FROM scholarships WHERE COALESCE(is_removed, FALSE) = FALSE ORDER BY scholarship_name LIMIT %s OFFSET %s', (limit, offset))
            rows = cur.fetchall()
            print(f"[PERF] /scholarships took {time.time() - start:.3f}s (limit={limit}, offset={offset})")
            return jsonify(rows)
    except Exception as exc:
        return jsonify({'message': str(exc)}), 500


@student_api_bp.route('/scholarships/<int:req_no>', methods=['GET'])
def get_scholarship_by_id(req_no):
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute('SELECT * FROM scholarships WHERE req_no = %s AND COALESCE(is_removed, FALSE) = FALSE', (req_no,))
            row = cur.fetchone()
            if not row:
                return jsonify({'message': 'Scholarship not found'}), 404
            return jsonify(row)
    except Exception as exc:
        return jsonify({'message': str(exc)}), 500


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
        with get_db() as conn:
            cur = conn.cursor()
            today = datetime.now().date()
            
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
            
            restriction_scope = None
            if user_no:
                cur.execute(
                    """
                    SELECT applicant_no, first_name, middle_name, last_name, father_name, mother_name
                    FROM applicants
                    WHERE applicant_no = %s
                    """,
                    (user_no,),
                )
                applicant = cur.fetchone()
                if applicant:
                    restriction_scope = get_identity_restriction_scope(cur, applicant, today=today)
            
            cur.execute("""
                SELECT s.*, p.provider_name,
                       COUNT(ast.applicant_no) FILTER (WHERE ast.is_accepted = 'Accepted') AS accepted_count
                FROM scholarships s
                LEFT JOIN scholarship_providers p ON s.pro_no = p.pro_no
                LEFT JOIN applicant_status ast ON ast.scholarship_no = s.req_no
                WHERE COALESCE(s.is_removed, FALSE) = FALSE
                GROUP BY s.req_no, p.provider_name
                ORDER BY s.scholarship_name ASC
            """)
            scholarships = cur.fetchall()

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

            restriction = {
                'already_applied': False,
                'blocked': False,
                'message': None,
                'reason': None,
            }
            if restriction_scope:
                restriction = get_scholarship_restriction(restriction_scope, sch['req_no'])
                if restriction['blocked'] and restriction['message']:
                    reasons.append(restriction['message'])

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
                'alreadyApplied': restriction['already_applied'],
                'restrictionBlocked': restriction['blocked'],
                'restrictionMessage': restriction['message'],
                'restrictionReason': restriction['reason'],
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


@student_api_bp.route('/applicant/profile', methods=['GET'])
@token_required
def get_profile():
    try:
        with get_db() as conn:
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

            duplicate_ids, _, _ = get_matching_duplicate_applicant_ids(cur, applicant)
            # Oldest Account Wins: Only restrict if the current user_no is NOT the smallest ID for this identity
            applicant['duplicate_applicant_exists'] = request.user_no > min(duplicate_ids)
            applicant['portal_lock_message'] = 'This is a duplicate account. Please use your original login.' if applicant['duplicate_applicant_exists'] else None

            # Calculate sibling-blocked scholarships for the portal
            sibling_blocked_ids = []
            restriction_scope = get_identity_restriction_scope(cur, applicant)
            if restriction_scope and restriction_scope.get('applications'):
                # Check all existing scholarship IDs to see which ones are family-taken
                cur.execute("SELECT req_no FROM scholarships WHERE is_removed = FALSE")
                all_sch_ids = [row['req_no'] for row in cur.fetchall()]
                for sid in all_sch_ids:
                    res = get_scholarship_restriction(restriction_scope, sid)
                    if res['blocked'] and res['reason'] in ['family-existing-same-scholarship', 'family-accepted-same-scholarship', 'family-pending-same-scholarship']:
                        sibling_blocked_ids.append(sid)
            
            applicant['sibling_blocked_scholarships'] = sibling_blocked_ids

            media_document_fields = [
                *blob_fields,
                'id_vid_url',
                'indigency_vid_url',
                'grades_vid_url',
                'enrollment_certificate_vid_url',
                'schoolid_front_vid_url',
                'schoolid_back_vid_url',
                'indigency_verified',
                'enrollment_verified',
                'grades_verified',
                'id_verified',
                'face_verified',
                'signature_verified',
            ]
            document_values = fetch_applicant_document_values(cur, request.user_no, media_document_fields)

            # 2. Add lazy-load URLs for the frontend to fetch binary data on-demand
            # This ensures the browser can still access the data without bloating the initial profile load
            for key in blob_fields:
                flag_name = flag_map.get(key, f"has_{key}")
                if key != 'profile_picture':
                    applicant[flag_name] = document_values.get(key) is not None
                else:
                    # Specialized check for profile picture
                    applicant['has_profile_picture'] = (
                        document_values.get('profile_picture') is not None or 
                        applicant.get('has_profile_picture') # fallback for pre-loaded apps column
                    )

                if applicant.get(flag_name):
                    # Under encryption, we always route via the backend proxy get_applicant_document_raw 
                    # to ensure the backend decrypts it before serving to the client.
                    applicant[key] = url_for('student_api.get_applicant_document_raw', field_name=key, _external=True)
                else:
                    applicant[key] = None

            for key in (
                'id_vid_url',
                'indigency_vid_url',
                'grades_vid_url',
                'enrollment_certificate_vid_url',
                'schoolid_front_vid_url',
                'schoolid_back_vid_url',
            ):
                val = document_values.get(key) or applicant.get(key)
                if isinstance(val, str) and val.startswith('http'):
                    # Route videos through the backend proxy raw endpoint for decryption too
                    applicant[key] = url_for('student_api.get_applicant_document_raw', field_name=key, _external=True)
                else:
                    applicant[key] = val

            # 3. Handle specific profile picture logic for the frontend
            if applicant.get('profile_picture'):
                 applicant['profile_picture'] = applicant['profile_picture']

            # 4. Clean up other types
            for key, value in list(applicant.items()):
                if isinstance(value, (datetime)):
                    applicant[key] = value.isoformat()
                elif key == 'birthdate' and value:
                    applicant[key] = str(value)

            # 5. Email verification status
            applicant['email_verified'] = applicant.get('is_verified', False)
            if applicant.get('google_id'):
                applicant['email_verified'] = True

            return jsonify(applicant)
    except Exception as exc:
        print(f"[PROFILE ERROR] {exc}", flush=True)
        return jsonify({'message': str(exc)}), 500


@student_api_bp.route('/applicant/document/<string:field_name>', methods=['GET'])
@token_required
def get_applicant_document(field_name):
    """
    Focused endpoint to fetch a single large binary field (ID, Photo, etc.)
    This prevents memory exhaustion by avoiding loading ALL images at once in /profile.
    """
    allowed_fields = [
        'profile_picture', 'signature_image_data', 'id_img_front', 'id_img_back',
        'enrollment_certificate_doc', 'grades_doc', 'indigency_doc', 'id_pic',
        'id_vid_url', 'indigency_vid_url', 'grades_vid_url', 'enrollment_certificate_vid_url',
        'schoolid_front_vid_url', 'schoolid_back_vid_url'
    ]
    
    if field_name not in allowed_fields:
        return jsonify({'message': 'Invalid field name'}), 400
        
    try:
        with get_db() as conn:
            cur = conn.cursor()
            row = fetch_applicant_document_values(cur, request.user_no, [field_name])
            
            if not row or not row[field_name]:
                return jsonify({'message': 'Document not found'}), 404
                
            value = row[field_name]
            
            # Handle decryption for signature if needed
            if field_name == 'signature_image_data':
                value = decode_signature(value)
            
            # Determine mime type
            mime_type = 'image/jpeg'
            if field_name == 'signature_image_data':
                mime_type = 'image/png'
            elif 'vid_url' in field_name:
                mime_type = 'video/mp4'
            
            # Handle both binary data (BLOBs) and URL strings (from Storage)
            if isinstance(value, str) and value.startswith('http'):
                import requests
                from services.crypto_service import decrypt_if_encrypted
                normalized_url = normalize_supabase_url(value)
                try:
                    resp = requests.get(normalized_url, timeout=30)
                    if resp.status_code == 200:
                        value = decrypt_if_encrypted(resp.content)
                    else:
                        value = value.encode('utf-8')
                except Exception as e:
                    print(f"[DOCUMENT JSON] Proxy download error for {field_name}: {e}", flush=True)
                    value = value.encode('utf-8')
            elif isinstance(value, str):
                if value.startswith('data:'):
                    return jsonify({
                        'fieldName': field_name,
                        'data': value
                    })
                value = value.encode('utf-8')
            elif hasattr(value, 'tobytes'):
                value = value.tobytes()
            else:
                value = bytes(value)
                
            # Decrypt if the database value itself is encrypted binary
            from services.crypto_service import decrypt_if_encrypted
            value = decrypt_if_encrypted(value)
            
            # Optimize: Detect correct mime type if it was decrypted
            if value.startswith(b'\x89PNG'):
                mime_type = 'image/png'
            elif value.startswith(b'ftyp') or value.startswith(b'\x00\x00\x00\x18ftyp'):
                mime_type = 'video/mp4'
                
            # Optimization: Return as Base64 string so frontend can easily use it in data URI
            try:
                encoded = base64.b64encode(value).decode('utf-8')
                return jsonify({
                    'fieldName': field_name,
                    'data': f"data:{mime_type};base64,{encoded}"
                })
            except Exception as e:
                print(f"[RECOVERY] Failed to encode document {field_name}: {e}", flush=True)
                return jsonify({'message': 'Error processing document data'}), 500
    except Exception as e:
        print(f"[DOCUMENT] Error fetching {field_name}: {e}", flush=True)
        return jsonify({'message': str(e)}), 500

@student_api_bp.route('/applicant/document/raw/<string:field_name>', methods=['GET'])
@token_required
def get_applicant_document_raw(field_name):
    """Returns raw bytes with correct Content-Type for direct <img> usage."""
    allowed_fields = [
        'profile_picture', 'signature_image_data', 'id_img_front', 'id_img_back',
        'enrollment_certificate_doc', 'grades_doc', 'indigency_doc', 'id_pic',
        'id_vid_url', 'indigency_vid_url', 'grades_vid_url', 'enrollment_certificate_vid_url',
        'schoolid_front_vid_url', 'schoolid_back_vid_url'
    ]
    if field_name not in allowed_fields:
        return "Invalid field", 400
    try:
        with get_db() as conn:
            cur = conn.cursor()
            row = fetch_applicant_document_values(cur, request.user_no, [field_name])
            if not row or not row[field_name]:
                return "Not found", 404
            
            value = row[field_name]
            if field_name == 'signature_image_data':
                value = decode_signature(value)
            
            if isinstance(value, str) and value.startswith('http'):
                import requests
                from services.crypto_service import decrypt_if_encrypted
                normalized_url = normalize_supabase_url(value)
                try:
                    resp = requests.get(normalized_url, timeout=30)
                    if resp.status_code == 200:
                        value = decrypt_if_encrypted(resp.content)
                    else:
                        from flask import redirect
                        return redirect(normalized_url)
                except Exception as e:
                    print(f"[DOCUMENT RAW] Proxy download error for {field_name}: {e}", flush=True)
                    from flask import redirect
                    return redirect(normalized_url)
            elif isinstance(value, str):
                value = value.encode('utf-8')
            elif hasattr(value, 'tobytes'):
                value = value.tobytes()
            else:
                value = bytes(value)

            # Ensure we decrypt binary data
            from services.crypto_service import decrypt_if_encrypted
            value = decrypt_if_encrypted(value)

            mime_type = 'image/jpeg'
            if field_name == 'signature_image_data' or value.startswith(b'\x89PNG'):
                mime_type = 'image/png'
            elif 'vid_url' in field_name or value.startswith(b'ftyp') or value.startswith(b'\x00\x00\x00\x18ftyp'):
                mime_type = 'video/mp4'
                
            from flask import make_response
            response = make_response(value)
            response.headers.set('Content-Type', mime_type)
            # Add browser caching to reduce egress (1 hour)
            response.headers.set('Cache-Control', 'public, max-age=3600')
            return response
    except Exception as e:
        print(f"[DOCUMENT RAW] Error: {e}", flush=True)
        return "Internal Error", 500

@student_api_bp.route('/applicant/profile', methods=['PUT'])
@token_required
def update_profile():
    data = request.get_json(silent=True) or request.form.to_dict(flat=True)
    files_data = request.files

    try:
        with get_db() as conn:
            cur = conn.cursor()
            updates = []
            params = []
            document_updates = {}
            has_profile_picture_column = applicant_has_column(cur, 'profile_picture')

            def add_update(column_name, value):
                updates.append(f'{column_name} = %s')
                params.append(value)

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
                'meritsAwardsReceived': 'merits_awards_received',
                'grades_year': 'grades_year'
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
                    # Integer columns — coerce safely
                    if db_col in ('school_id_no', 'semester', 'grades_sem', 'grades_year'):
                        try:
                            if isinstance(value, str):
                                # Handle "1st", "2nd" etc for semesters
                                if '1' in value: value = 1
                                elif '2' in value: value = 2
                                # Handle "2024-2025" for year (take first year)
                                elif '-' in value: value = value.split('-')[0]
                                
                            value = int(value) if value not in (None, '', 'null') else None
                        except (ValueError, TypeError):
                            value = None
                    add_update(db_col, value)

            for frontend_key, db_col in document_field_mapping.items():
                if frontend_key in data:
                    document_updates[db_col] = data[frontend_key]

            if 'fatherName' in data:
                add_update('father_name', normalize_parent_full_name(data.get('fatherName')))

            if 'motherName' in data:
                add_update('mother_name', normalize_parent_full_name(data.get('motherName')))

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
                'id_pic': 'id_pic',  # legacy mapping
                'face_photo': 'id_pic', # mapping from step 4
                'signature_data': 'signature_image_data',
                'schoolID_photo': 'school_id',
                'id_front': 'id_img_front',
                'id_back': 'id_img_back',
                'indigency_doc': 'indigency_doc',
                'grades_doc': 'grades_doc',
                'enrollment_certificate_doc': 'enrollment_certificate_doc',
            }

            for field_key, db_col in binary_fields.items():
                blob_bytes = None
                raw_val = None
                
                uploaded_file = files_data.get(field_key)
                if uploaded_file:
                    blob_bytes = uploaded_file.read()
                elif field_key in data and data[field_key]:
                    raw_val = data[field_key]
                elif field_key in request.form and request.form[field_key]:
                    raw_val = request.form[field_key]
                
                if raw_val:
                    # If it's already a URL, we don't need to decode or upload
                    if isinstance(raw_val, str) and (raw_val.startswith('http') or raw_val.startswith('https')):
                        print(f"[UPDATE PROFILE] Field {field_key} is already a URL. Saving directly.", flush=True)
                        if db_col == 'profile_picture' and has_profile_picture_column:
                            add_update(db_col, raw_val)
                        else:
                            document_updates[db_col] = raw_val
                        continue
                    else:
                        blob_bytes = decode_base64(raw_val)
                
                if blob_bytes:
                    print(f"[UPDATE PROFILE] Field {field_key} -> {db_col}: {len(blob_bytes)} bytes detected. Cloud? {use_storage()}", flush=True)
                    try:
                        url = upload_image_to_storage(blob_bytes, request.user_no, db_col, is_update=True)
                        if url:
                            print(f"[UPDATE PROFILE] SUCCESS: {db_col} uploaded to {url[:50]}...", flush=True)
                            if db_col == 'profile_picture' and has_profile_picture_column:
                                add_update(db_col, url)
                            else:
                                document_updates[db_col] = url
                        else:
                            # Cloud upload failed
                            print(f"[UPDATE PROFILE] ERROR: upload_image_to_storage failed for {db_col}. Persistence aborted to prevent BYTEA corruption.", flush=True)
                            raise ValueError(f"Cloud upload failed for {field_key}. The server might be experiencing connectivity issues. Please try again.")
                    except Exception as storage_err:
                        print(f"[UPDATE PROFILE] CRITICAL STORAGE ERROR for {db_col}: {storage_err}", flush=True)
                        raise ValueError(f"Storage System Error: {str(storage_err)}")

            if not updates and not document_updates:
                return jsonify({'message': 'No changes provided'}), 200

            if updates:
                params.append(request.user_no)
                sql = f"UPDATE applicants SET {', '.join(updates)} WHERE applicant_no = %s"
                cur.execute(sql, tuple(params))
            if document_updates:
                persist_applicant_document_values(cur, request.user_no, document_updates)

            # Preventive Duplicate Check:
            # We fetch the potentially updated applicant and check if they've become a duplicate.
            # "Oldest Wins": If the current account is NOT the oldest for this identity, we reject the save.
            cur.execute("SELECT * FROM applicants WHERE applicant_no = %s", (request.user_no,))
            potential_duplicate = cur.fetchone()
            if potential_duplicate:
                duplicate_ids, _, _ = get_matching_duplicate_applicant_ids(cur, potential_duplicate)
                if len(duplicate_ids) > 1 and request.user_no > min(duplicate_ids):
                    main_id = min(duplicate_ids)
                    # Correctly fetch email from the auth table, not the applicant data table
                    app_email_table = get_applicant_email_table(cur)
                    cur.execute(f"SELECT email_address FROM {app_email_table} WHERE applicant_no = %s", (main_id,))
                    main_email_row = cur.fetchone()
                    main_email = main_email_row['email_address'] if main_email_row else "your original account"
                    
                    conn.rollback()
                    print(f"[CONFLICT] User {request.user_no} attempted to create/update to a duplicate identity of {main_id} ({main_email})", flush=True)
                    return jsonify({
                        'message': 'Alternate Account detected',
                        'error': f'Please use your main account: {main_email}'
                    }), 409

            conn.commit()

            return jsonify({'message': 'Progress saved successfully'})
    except Exception as exc:
        return jsonify({'message': str(exc)}), 500


@student_api_bp.route('/applications/check-sibling', methods=['POST'])
@token_required
def check_sibling_restriction():
    """
    Performs a 'pre-flight' sibling check based on parent names provided in the form.
    """
    data = request.get_json() or {}
    scholarship_id = data.get('scholarship_id') or data.get('scholarship_no')
    
    if not scholarship_id:
        return jsonify({'success': False, 'message': 'Missing scholarship ID'}), 400

    try:
        with get_db() as conn:
            cur = conn.cursor()
            # Fetch current student data to help with identity building
            cur.execute("SELECT * FROM applicants WHERE applicant_no = %s", (request.user_no,))
            applicant = cur.fetchone()
            
            if not applicant:
                return jsonify({'success': False, 'message': 'Applicant not found'}), 404

            # Use the names provided in the form for the check (source_data)
            # We translate frontend keys to backend keys if needed
            source_data = {
                'first_name': data.get('firstName'),
                'last_name': data.get('lastName'),
                'father_name': data.get('fatherName'),
                'mother_name': data.get('motherName')
            }
            
            restriction_scope = get_identity_restriction_scope(cur, applicant, source_data=source_data)
            restriction = get_scholarship_restriction(restriction_scope, scholarship_id)
            
            return jsonify({
                'success': True,
                'blocked': restriction['blocked'],
                'message': restriction['message'] if restriction['blocked'] else None,
                'reason': restriction['reason'] if restriction['blocked'] else None
            })
    except Exception as e:
        print(f"[RESTR-CHECK] Error: {str(e)}", flush=True)
        return jsonify({'success': False, 'message': str(e)}), 500

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
        request_payload = request.get_json(silent=True) or request.form.to_dict(flat=True)
        
        # Priority data source: 
        # 1. request.files (binary)
        # 2. request.form (base64 strings or fields)
        # 3. request.json (json fields)
        def get_unified_val(key):
            if key in form_data: return form_data[key]
            if request_payload and key in request_payload: return request_payload[key]
            return None

        # Re-map skip_verify and req_no
        if request.is_json:
            req_no = request.json.get('req_no')
            skip_verify = str(request.json.get('skip_verification', 'false')).lower() == 'true'
        else:
            req_no = get_unified_val('req_no')
            skip_v = get_unified_val('skipVerification') or get_unified_val('skip_verification')
            skip_verify = str(skip_v).lower() == 'true' if skip_v is not None else False
        
        print(f"[SUBMIT] Processing application for User {current_user_id}, Req {req_no} (skip_verify={skip_verify})")

        if not req_no:
            return jsonify({'message': 'Requirement number (req_no) is missing'}), 400
        req_no = int(req_no)

        with get_db() as conn:
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
                    'schoolID_photo',
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
        
            # In this system, req_no (passed from frontend) is the primary scholarship identifier
            scholarship_id = req_no
        
            # Verify the scholarship exists and check GPA requirement
            cur.execute('SELECT scholarship_name, gpa FROM scholarships WHERE req_no = %s', (scholarship_id,))
            scholarship = cur.fetchone()
            if not scholarship:
                return jsonify({'message': 'Scholarship not found'}), 404
            
            min_gpa_required = scholarship.get('gpa')
            applicant_gpa = get_unified_val('gpa') or applicant.get('overall_gpa')
        
            if min_gpa_required and applicant_gpa:
                try:
                    student_gpa_val = float(applicant_gpa)
                    # Normalize if mismatch in scales (Scholarship usually uses 0-100, student might use 1.0-5.0)
                    if min_gpa_required > 10 and student_gpa_val < 10:
                        student_gpa_val = normalize_to_percent(student_gpa_val)
                
                    if student_gpa_val < float(min_gpa_required):
                        return jsonify({
                            'message': f"Your GPA ({applicant_gpa}) does not meet the minimum requirement of {min_gpa_required} for {scholarship['scholarship_name']}."
                        }), 400
                except (ValueError, TypeError):
                    pass

            preliminary_identity = build_restriction_identity_from_applicant(applicant, source_data=request_payload)
            if preliminary_identity:
                cur.execute(
                    'SELECT pg_advisory_xact_lock(hashtext(%s), %s)',
                    (preliminary_identity['identity_key'], scholarship_id),
                )

            restriction_scope = get_identity_restriction_scope(cur, applicant, source_data=request_payload)
            restriction = get_scholarship_restriction(restriction_scope, scholarship_id)
            if restriction['blocked']:
                if restriction['auto_reject']:
                    cur.execute(
                        """
                        INSERT INTO applicant_status (scholarship_no, applicant_no, is_accepted, created_at)
                        VALUES (%s, %s, 'Rejected', NOW())
                        ON CONFLICT (scholarship_no, applicant_no)
                        DO UPDATE SET is_accepted = 'Rejected', created_at = applicant_status.created_at
                        """,
                        (scholarship_id, current_user_id),
                    )
                    conn.commit()
                response_payload = {
                    'message': restriction['message'],
                    'restriction_reason': restriction['reason'],
                }
                if restriction['auto_reject']:
                    response_payload['status'] = 'Rejected'
                return jsonify(response_payload), 409

            # ── Data Preparation ──────────────────────────────────────────────────
            def get_doc_bytes(key, db_field):
                # Try file upload first
                if key in files_data:
                    return files_data[key].read()
                # Try base64 from form or json
                val = get_unified_val(key)
                if val and isinstance(val, str) and not val.startswith('http') and (val.startswith('data:') or len(val) > 100):
                    return decode_base64(val)
                # Try existing database value
                existing = applicant.get(db_field)
                if existing and not isinstance(existing, str):
                    return db_bytes(existing)
                return None

            id_front_bytes = get_doc_bytes('id_front', 'id_img_front') or get_doc_bytes('schoolID_photo', 'schoolID_photo')
            id_back_bytes = get_doc_bytes('id_back', 'id_img_back')
            face_photo_bytes = get_doc_bytes('face_photo', 'face_photo')
        
            profile_pic_bytes = None
            profile_pic_url = None
        
            if has_profile_picture_column:
                raw_url = get_unified_val('profile_picture') or get_unified_val('profilePicture')
                if isinstance(raw_url, str) and (raw_url.startswith('http') or raw_url.startswith('https')):
                    profile_pic_url = raw_url
                else:
                    profile_pic_bytes = get_doc_bytes('profile_picture', 'profile_picture')
        
            signature_bytes = get_doc_bytes('signature_data', 'signature_image_data')

            doc_keys = ['mayorCOE_photo', 'mayorGrades_photo', 'mayorIndigency_photo', 'mayorValidID_photo', 'schoolID_photo']
            doc_column_map = {
                'mayorCOE_photo': 'enrollment_certificate_doc',
                'mayorGrades_photo': 'grades_doc',
                'mayorIndigency_photo': 'indigency_doc',
                'mayorValidID_photo': 'id_pic',
                'schoolID_photo': 'schoolID_photo',
            }

            doc_bytes = {}
            for k in doc_keys:
                doc_bytes[k] = get_doc_bytes(k, doc_column_map[k])

            # ── OCR & VIDEO VERIFICATION (PARALLEL) ───────────────────────────────
            ocr_ok = True
            ocr_status = "Verification skipped"
        
            if False:  # Bypassed client-side OCR check on submit
                try:
                    from concurrent.futures import ThreadPoolExecutor
                    verification_tasks = {}
                    # Expand worker pool to allow true simultaneous background downloading and validation
                    with ThreadPoolExecutor(max_workers=10) as executor:
                        # 1. OCR Identity Check
                        if id_front_bytes:
                            town_city = form_data.get('townCity') or applicant.get('town_city_municipality', '')
                            full_name = f"{applicant.get('first_name', '')} {applicant.get('last_name', '')}"
                            from services.verification_client import call_fastapi_verify_id
                            print(f"[SUBMIT] Scheduling FASTAPI OCR for {full_name}...")
                            verification_tasks['ocr'] = executor.submit(
                                call_fastapi_verify_id, 
                                image_bytes=id_front_bytes,
                                first_name=applicant.get('first_name', ''),
                                middle_name=applicant.get('middle_name', ''),
                                last_name=applicant.get('last_name', ''),
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

            def add_update(column_name, value):
                updates.append(f'{column_name} = %s')
                params.append(value)

            field_mapping = {
                'lastName': 'last_name', 'firstName': 'first_name', 'middleName': 'middle_name',
                'dateOfBirth': 'birthdate', 'streetBarangay': 'street_brgy', 'townCity': 'town_city_municipality',
                'province': 'province', 'zipCode': 'zip_code', 'sex': 'sex', 'citizenship': 'citizenship',
                'schoolIdNumber': 'school_id_no', 'schoolName': 'school', 'schoolAddress': 'school_address',
                'schoolSector': 'school_sector', 'mobileNumber': 'mobile_no', 'yearLevel': 'year_lvl',
                'parentsGrossIncome': 'financial_income_of_parents', 'course': 'course',
                'fatherPhoneNumber': 'father_phone_no', 'motherPhoneNumber': 'mother_phone_no',
                'fatherOccupation': 'father_occupation', 'motherOccupation': 'mother_occupation',
                'meritsAwardsReceived': 'merits_awards_received',
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
                if form_key in request_payload:
                    value = request_payload[form_key]
                    # school_id_no is an INTEGER column — coerce safely
                    if db_col == 'school_id_no':
                        try:
                            value = int(value) if value not in (None, '', 'null') else None
                        except (ValueError, TypeError):
                            value = None
                    add_update(db_col, value)

            if 'fatherName' in request_payload:
                add_update('father_name', normalize_parent_full_name(request_payload.get('fatherName')))

            if 'motherName' in request_payload:
                add_update('mother_name', normalize_parent_full_name(request_payload.get('motherName')))

            if 'fatherStatus' in request_payload:
                father_status = parse_parent_status(request_payload.get('fatherStatus'))
                if father_status is not None:
                    add_update('father_status', father_status)

            if 'motherStatus' in request_payload:
                mother_status = parse_parent_status(request_payload.get('motherStatus'))
                if mother_status is not None:
                    add_update('mother_status', mother_status)

            document_updates = {}
            for form_key, db_col in document_field_mapping.items():
                if form_key in request_payload:
                    document_updates[db_col] = request_payload[form_key]

            binary_map = {
                'id_img_front': id_front_bytes,
                'id_img_back': id_back_bytes,
                'profile_picture': profile_pic_bytes,
                'signature_image_data': signature_bytes,
                'enrollment_certificate_doc': doc_bytes['mayorCOE_photo'],
                'grades_doc': doc_bytes['mayorGrades_photo'],
                'indigency_doc': doc_bytes['mayorIndigency_photo'],
                'id_pic': doc_bytes['mayorValidID_photo'] or face_photo_bytes,
                'schoolID_photo': doc_bytes['schoolID_photo'],
            }

            for column_name, value in binary_map.items():
                # If we already have a URL (from profile_pic_url etc), use it directly
                if column_name == 'profile_picture' and profile_pic_url:
                    if has_profile_picture_column:
                        updates.append(f'{column_name} = %s')
                        params.append(profile_pic_url)
                    else:
                        document_updates[column_name] = profile_pic_url
                    continue

                if value is not None:
                    print(f"[SUBMIT] Processing {column_name}: {len(value) if isinstance(value, (bytes, bytearray)) else 'scalar'} data. Cloud? {use_storage()}", flush=True)
                    try:
                        url = upload_image_to_storage(value, current_user_id, column_name, is_update=False)
                        if url:
                            print(f"[SUBMIT] SUCCESS: {column_name} uploaded to {url[:50]}...", flush=True)
                            if column_name == 'profile_picture' and has_profile_picture_column:
                                updates.append(f'{column_name} = %s')
                                params.append(url)
                            else:
                                document_updates[column_name] = url
                        else:
                            print(f"[SUBMIT] ERROR: Cloud upload failed for {column_name}. Refusing BYTEA fallback.", flush=True)
                            raise ValueError(f"Failed to upload {column_name} to cloud storage.")
                    except Exception as e:
                        print(f"[SUBMIT] CRITICAL STORAGE ERROR for {column_name}: {e}", flush=True)
                        raise ValueError(f"Storage System Error: {str(e)}")

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
                VALUES (%s, %s, 'Pending', NOW())
                ON CONFLICT (scholarship_no, applicant_no) 
                DO UPDATE SET created_at = EXCLUDED.created_at, is_accepted = 'Pending'
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
            try: conn.rollback()
            except: pass
        return jsonify({'message': f'Submission error: {str(exc)}'}), 500
    finally:
        if 'conn' in locals():
            conn.close()


@student_api_bp.route('/verification-status', methods=['GET'])
@token_required
def get_verification_status():
    """Returns current verification status for all documents."""
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cols = [
                'indigency_verified', 'enrollment_verified', 'grades_verified', 
                'id_verified', 'face_verified', 'signature_verified'
            ]
            row = fetch_applicant_document_values(cur, request.user_no, cols)
            return jsonify({
                'success': True,
                'verified': row
            })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@student_api_bp.route('/verification/ocr-check', methods=['POST'])
@token_required
def ocr_check():
    """Lightweight client-side OCR persistence endpoint."""
    try:
        if request.is_json:
            data = request.json
        else:
            data = request.form.to_dict()

        target_doc = data.get('target_doc') or data.get('targetDoc')
        verified = str(data.get('verified', 'false')).lower() == 'true'
        message = data.get('message', '')
        results = data.get('results', [])

        # Parse results if it was sent as a JSON string in form-data
        if isinstance(results, str):
            try:
                import json
                results = json.loads(results)
            except Exception:
                results = []

        with get_db() as conn:
            cur = conn.cursor()
            verification_updates = {}
            
            # If bulk results are passed from frontend
            if results:
                for res in results:
                    dtype = res.get('doc')
                    is_verified = res.get('verified', False)
                    if dtype == 'Indigency': verification_updates['indigency_verified'] = is_verified
                    elif dtype == 'Enrollment': verification_updates['enrollment_verified'] = is_verified
                    elif dtype == 'Grades': verification_updates['grades_verified'] = is_verified
                    elif dtype == 'SchoolID': verification_updates['id_verified'] = is_verified
            # Otherwise, fall back to single target_doc value
            elif target_doc:
                target_doc_norm = str(target_doc).lower()
                if any(k in target_doc_norm for k in ['grade', 'mayorgrade']):
                    verification_updates['grades_verified'] = verified
                elif any(k in target_doc_norm for k in ['enrollment', 'coe', 'mayorcoe']):
                    verification_updates['enrollment_verified'] = verified
                elif any(k in target_doc_norm for k in ['indigency', 'mayorindigency']):
                    verification_updates['indigency_verified'] = verified
                elif any(k in target_doc_norm for k in ['idfront', 'schoolidfront', 'schoolid']):
                    verification_updates['id_verified'] = verified
            
            if verification_updates:
                persist_applicant_document_values(cur, request.user_no, verification_updates)
                conn.commit()

        return jsonify({
            'verified': verified,
            'message': message or 'Verification persisted successfully',
            'results': results or [{'doc': target_doc, 'verified': verified, 'message': message}]
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({'verified': False, 'message': f'Server error: {str(e)}'}), 500


@student_api_bp.route('/applications/<int:scholarship_no>', methods=['DELETE'])
@token_required
def cancel_application(scholarship_no):
    """Cancel (delete) the current user's application for a given scholarship."""
    try:
        with get_db() as conn:
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

            # Mark the application as Cancelled
            cur.execute(
                """
                UPDATE applicant_status
                SET is_accepted = 'Cancelled', status_updated = CURRENT_DATE
                WHERE scholarship_no = %s AND applicant_no = %s
                """,
                (scholarship_no, request.user_no),
            )
            
            # We NO LONGER delete associated messages between applicant and provider 
            # so that the cancellation notice can be read by the admin.
            
            conn.commit()

            return jsonify({'message': 'Application cancelled successfully'})
    except Exception as exc:
        traceback.print_exc()
        return jsonify({'message': f'Error cancelling application: {str(exc)}'}), 500


@student_api_bp.route('/applications/my-applications', methods=['GET'])
@token_required
def get_my_applications():
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT
                    CASE 
                        WHEN s.req_no IS NULL OR COALESCE(s.is_removed, FALSE) = TRUE 
                        THEN COALESCE(s.scholarship_name, 'Unknown Scholarship') || ' (Deleted)'
                        ELSE s.scholarship_name 
                    END as name,
                    ast.scholarship_no,
                    s.req_no,
                    s.deadline,
                    s.pro_no,
                    CASE
                        WHEN ast.is_accepted = 'Accepted' THEN 'Accepted'
                        WHEN ast.is_accepted = 'Rejected' THEN 'Rejected'
                        WHEN ast.is_accepted = 'Cancelled' THEN 'Cancelled'
                        ELSE 'Pending'
                    END as status,
                    ast.status_updated
                FROM applicant_status ast
                LEFT JOIN scholarships s ON ast.scholarship_no = s.req_no
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


@student_api_bp.route('/applications/<int:req_no>/status', methods=['POST'])
def update_application_status(req_no):
    data = request.get_json() or {}
    applicant_no = data.get('applicant_no')
    status = data.get('status')

    try:
        with get_db() as conn:
            cur = conn.cursor()
            
            # Get Provider Info for Automated Response
            cur.execute("""
                SELECT s.pro_no, sp.provider_name, s.scholarship_name 
                FROM scholarships s 
                JOIN scholarship_providers sp ON s.pro_no = sp.pro_no 
                WHERE s.req_no = %s
            """, (req_no,))
            prov_row = cur.fetchone()
            if not prov_row:
                return jsonify({'message': 'Scholarship not found'}), 404
                
            pro_no = prov_row['pro_no']
            pro_name = prov_row['provider_name']
            sch_name = prov_row['scholarship_name']
            
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
                    """
                    SELECT s.scholarship_name, s.req_no, s.pro_no, sp.provider_name 
                    FROM applicant_status ast 
                    JOIN scholarships s ON ast.scholarship_no = s.req_no 
                    JOIN scholarship_providers sp ON s.pro_no = sp.pro_no
                    WHERE ast.applicant_no = %s 
                    AND ast.scholarship_no != %s 
                    AND (ast.is_accepted = 'Pending' OR ast.is_accepted IS NULL OR ast.is_accepted = 'Accepted')
                    """,
                    (applicant_no, req_no)
                )
                declined_scholarships = cur.fetchall()
                
                cur.execute(
                    """
                    UPDATE applicant_status
                    SET is_accepted = 'Cancelled'
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
                        
                        # Also send a chat message for the auto-declined scholarship
                        cur.execute("""
                            INSERT INTO message (applicant_no, pro_no, room, username, message, timestamp)
                            VALUES (%s, %s, %s, %s, %s, NOW())
                        """, (
                            applicant_no, 
                            ds['pro_no'], 
                            f"{applicant_no}+{ds['pro_no']}", 
                            ds['provider_name'], 
                            f"System: Your application for {ds['scholarship_name']} has been closed because you were accepted into another scholarship."
                        ))
                    except: pass

            # Trigger Notification for the applicant
            is_acc = status in [True, 1, 'true', 'True']
            status_label = "Accepted" if is_acc else "Rejected"
            
            try:
                create_notification(
                    user_no=applicant_no,
                    title=f"Application Result: {status_label}",
                    message=f"Your application for {sch_name} has been {status_label.lower()}.",
                    notif_type='result'
                )
                
                # Send the Automated Chat Message
                if is_acc:
                    automessage = f"Congratulations! We are pleased to inform you that your application for {sch_name} has been {status_label.lower()}."
                else:
                    automessage = f"Thank you for your interest in {sch_name}. We regret to inform you that your application has been {status_label.lower()}."
                    
                cur.execute("""
                    INSERT INTO message (applicant_no, pro_no, room, username, message, timestamp)
                    VALUES (%s, %s, %s, %s, %s, NOW())
                """, (applicant_no, pro_no, f"{applicant_no}+{pro_no}", pro_name, automessage))
                
            except Exception as e:
                print(f"[RESULT ERROR] Failed to send notification/chat: {e}")

            conn.commit()

            return jsonify({'message': 'Status updated'})
    except Exception as exc:
        return jsonify({'message': str(exc)}), 500


@student_api_bp.route('/announcements', methods=['GET'])
def get_announcements():
    try:
        with get_db() as conn:
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
                           ai.{primary_key_column} AS image_id, ai.img AS announcement_image_data
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
                    img_data_val = row.get('announcement_image_data')
                    
                    # Check for cloud URL directly in result set
                    if isinstance(img_data_val, str) and img_data_val.startswith('http'):
                        image_url = normalize_supabase_url(img_data_val)
                    else:
                        image_url = url_for(
                            'admin_api.get_announcement_image_by_index',
                            ann_no=ann_no,
                            idx=len(announcements[ann_no]['announcementImages']),
                            _external=True,
                        )
                    
                    announcements[ann_no]['announcementImages'].append(image_url)

            return jsonify(list(announcements.values()))
    except Exception as e:
        return jsonify({'message': f"Error fetching announcements: {str(e)}"}), 500


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
        from services.verification_client import call_fastapi_verify_face
        verified, message, confidence = call_fastapi_verify_face(id_bytes, face_bytes)
        
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
        # Scale confidence to 0-100 to match Verifier Bench UI expectations
        return jsonify({
            'verified': bool(verified),
            'message': str(message),
            'confidence': float(confidence) * 100.0,
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
        
        # RL Logic: Translate user choice + system result into truth
        was_verified = data.get('was_verified', False)
        user_choice = data.get('decision', 'agree') # 'agree' or 'disagree'
        
        # Map to final profile type
        if user_choice == 'agree':
            profile_type = 'real' if was_verified else 'fake'
        else:
            profile_type = 'fake' if was_verified else 'real'
            
        success = save_signature_profile(student_id, signature_bytes, profile_type=profile_type)
        
        if user_choice == 'agree':
            msg = f"System logic reinforced. Result confirmed as {profile_type}."
        else:
            msg = f"System logic corrected. Drawing re-classified as {profile_type}."
            
        return jsonify({
            'success': success,
            'message': msg if success else f'Failed to update {profile_type} profile.'
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
        # Encryption removed

        try:
            from supabase import create_client
            
            supabase_url = os.environ.get('SUPABASE_URL')
            supabase_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_KEY')
            
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
                'face_video': 'id_verification',
                'id_vid_url': 'id_verification'
            }
            
            folder = folder_map.get(field_name, 'others')
            # For videos, we use the dedicated document_videos bucket as seen in your setup
            bucket_name = 'document_videos'
            file_name = f"{current_user_id}_{int(time.time())}{ext}"
            file_path = f"videos/{folder}/{file_name}"

            # --- OVERWRITE PREVIOUS VIDEO CLEANUP (non-blocking) ---
            db_column_map = {
                'mayorIndigency_video': 'indigency_vid_url',
                'mayorCOE_video': 'enrollment_certificate_vid_url',
                'mayorGrades_video': 'grades_vid_url',
                'schoolIdFront_video': 'schoolid_front_vid_url',
                'schoolIdBack_video': 'schoolid_back_vid_url',
                'face_video': 'id_vid_url',
                'id_vid_url': 'id_vid_url'
            }
            db_col = db_column_map.get(field_name)
            if db_col:
                import threading
                def _cleanup_old_video(user_id, col, supa):
                    from services.db_service import get_db
                    from services.applicant_document_service import fetch_applicant_document_values
                    try:
                        with get_db() as conn:
                            cur = conn.cursor()
                            row = fetch_applicant_document_values(cur, user_id, [col])
                            if row and row[col]:
                                old_url = row[col]
                                # Identify bucket and path from the public URL
                                if '/storage/v1/object/public/' in old_url:
                                    url_parts = old_url.split('/public/')
                                    if len(url_parts) > 1:
                                        bucket_and_path = url_parts[1].split('/', 1)
                                        if len(bucket_and_path) > 1:
                                            target_bucket = bucket_and_path[0]
                                            old_path = bucket_and_path[1].strip()
                                            supa.storage.from_(target_bucket).remove([old_path])
                                            print(f"[VIDEO-UPLOAD] Deleted previous video from {target_bucket}: {old_path}", flush=True)
                    except Exception as e:
                        print(f"[VIDEO-CLEANUP] Warning: {e}", flush=True)

                threading.Thread(target=_cleanup_old_video, args=(current_user_id, db_col, supabase), daemon=True).start()

            # Encrypt binary video data before uploading to Supabase Storage
            from services.crypto_utils import encrypt_data
            video_bytes = encrypt_data(video_bytes)
            content_type = 'application/octet-stream'

            # Upload binary data to Supabase (using the dedicated videos bucket)
            try:
                print(f"[VIDEO-UPLOAD] Bucket: '{bucket_name}' | Path: '{file_path}' (Encrypted)", flush=True)
                supabase.storage.from_(bucket_name).upload(
                    file_path,
                    video_bytes,
                    {
                        'content-type': content_type, 
                        'cache-control': '31536000', 
                        'upsert': 'true'
                    }
                )
            except Exception as e:
                print(f"[VIDEO-UPLOAD ERROR] SDK failed: {e}", flush=True)
                raise
            
            public_url = supabase.storage.from_(bucket_name).get_public_url(file_path)
            # Standardize output URL to string
            if hasattr(public_url, 'public_url'): 
                public_url = public_url.public_url
            
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


# ─── TEMPORARY TEST ENDPOINTS FOR ENCRYPTION & STORAGE ──────────────────
@student_api_bp.route('/test/upload-image', methods=['POST'])
@token_required
def test_upload_image():
    """
    Test endpoint to upload an image to 'document_images' bucket under 'test-uploads/'.
    Encrypts the image using encrypt_data before uploading.
    """
    try:
        if 'image' not in request.files:
            return jsonify({'success': False, 'message': 'No image file provided'}), 400
        
        file = request.files['image']
        if file.filename == '':
            return jsonify({'success': False, 'message': 'Empty image file'}), 400
            
        file_bytes = file.read()
        
        # Encrypt binary image data using encrypt_data
        from services.crypto_utils import encrypt_data
        encrypted_bytes = encrypt_data(file_bytes)
        
        from project_config import get_supabase_client
        supabase = get_supabase_client()
        if not supabase:
            return jsonify({'success': False, 'message': 'Supabase client unavailable'}), 500
            
        bucket_name = 'document_images'
        file_path = f"test-uploads/backend-image-{int(time.time())}.jpg"
        
        supabase.storage.from_(bucket_name).upload(
            file_path,
            bytes(encrypted_bytes),
            {
                'content-type': 'application/octet-stream',
                'upsert': 'true',
                'cache-control': '31536000'
            }
        )
        
        public_url_obj = supabase.storage.from_(bucket_name).get_public_url(file_path)
        public_url = public_url_obj.public_url if hasattr(public_url_obj, 'public_url') else str(public_url_obj)
        
        return jsonify({
            'success': True,
            'message': 'Test image uploaded successfully (Encrypted)',
            'publicUrl': public_url
        })
    except Exception as e:
        print(f"[TEST IMAGE UPLOAD] Error: {e}", flush=True)
        return jsonify({'success': False, 'message': str(e)}), 500

@student_api_bp.route('/test/upload-video', methods=['POST'])
@token_required
def test_upload_video():
    """
    Test endpoint to upload a video to 'document_videos' bucket under 'test-uploads/'.
    Encrypts the video using encrypt_data before uploading.
    """
    try:
        if 'video' not in request.files:
            return jsonify({'success': False, 'message': 'No video file provided'}), 400
        
        file = request.files['video']
        if file.filename == '':
            return jsonify({'success': False, 'message': 'Empty video file'}), 400
            
        file_bytes = file.read()
        
        # Encrypt binary video data using encrypt_data
        from services.crypto_utils import encrypt_data
        encrypted_bytes = encrypt_data(file_bytes)
        
        from project_config import get_supabase_client
        supabase = get_supabase_client()
        if not supabase:
            return jsonify({'success': False, 'message': 'Supabase client unavailable'}), 500
            
        bucket_name = 'document_videos'
        file_path = f"test-uploads/backend-video-{int(time.time())}.mp4"
        
        supabase.storage.from_(bucket_name).upload(
            file_path,
            bytes(encrypted_bytes),
            {
                'content-type': 'application/octet-stream',
                'upsert': 'true',
                'cache-control': '31536000'
            }
        )
        
        public_url_obj = supabase.storage.from_(bucket_name).get_public_url(file_path)
        public_url = public_url_obj.public_url if hasattr(public_url_obj, 'public_url') else str(public_url_obj)
        
        return jsonify({
            'success': True,
            'message': 'Test video uploaded successfully (Encrypted)',
            'publicUrl': public_url
        })
    except Exception as e:
        print(f"[TEST VIDEO UPLOAD] Error: {e}", flush=True)
        return jsonify({'success': False, 'message': str(e)}), 500

