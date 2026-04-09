import base64
import os
import time
import traceback
import json
import requests
import urllib.request as urllib_request
from urllib import error as urllib_error
from email.mime.text import MIMEText
from datetime import datetime, timedelta
from functools import wraps

import jwt
from cryptography.fernet import Fernet
from flask import Blueprint, jsonify, request
from flask_bcrypt import Bcrypt

import cv2
import numpy as np
from services.auth_service import get_secret_key
from services.db_service import get_db
from services.video_converter import convert_video_to_mp4
from services.ocr_utils import (
    verify_id_with_ocr, verify_face_with_id, extract_school_year, 
    extract_school_year_from_text, is_current_school_year, 
    verify_signature_against_id, save_signature_profile, verify_video_content,
    _perform_text_matching
)
from services.notification_service import create_notification, fetch_google_access_token
from services.google_auth_service import verify_google_token
from concurrent.futures import ThreadPoolExecutor


student_api_bp = Blueprint('student_api', __name__, url_prefix='/api/student')
bcrypt = Bcrypt()
SECRET_KEY = get_secret_key()

def fetch_video_bytes_from_url(url):
    if not url: return None, "No URL provided"
    if not isinstance(url, str) or not url.startswith('http'):
        return None, f"Invalid URL: {url}"
        
    try:
        print(f"[VIDEO FETCH] Fetching video from: {url}", flush=True)
        # Use requests with a reasonable timeout and user-agent
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ISKOMATS-Verification-Bot/1.0'
        }
        
        url_to_fetch = url
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
            return content, None
        else:
            err_msg = f"HTTP {response.status_code}"
            print(f"[VIDEO FETCH] {err_msg} for {url_to_fetch}", flush=True)
            return None, err_msg
    except requests.exceptions.Timeout:
        return None, "Connection timeout"
    except Exception as e:
        return None, str(e)

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
# Use a different FRONTEND_URL for students if configured, otherwise fallback to applicant portal
STUDENT_FRONTEND_URL = os.environ.get('STUDENT_FRONTEND_URL', 'https://foregoing-giants.surge.sh').rstrip('/')
GMAIL_SENDER_EMAIL = os.environ.get('GMAIL_SENDER_EMAIL')
GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID')
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET')
GOOGLE_REFRESH_TOKEN = os.environ.get('GOOGLE_REFRESH_TOKEN')

# Database Migration: Ensure email table has verification columns
def ensure_verification_columns():
    try:
        conn = get_db()
        cur = conn.cursor()
        
        # Check if columns exist
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
            request.user_no = data.get('user_no')
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Token is invalid'}), 401

        return route_handler(*args, **kwargs)

    return decorated


def decode_base64(data_uri):
    if not data_uri or not isinstance(data_uri, str) or ',' not in data_uri:
        return None
    try:
        return base64.b64decode(data_uri.split(',')[1])
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
        # Only allow applicant logins - must have applicant_no
        cur.execute(
            """
            SELECT em_no, applicant_no, password_hash, is_verified
            FROM email
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

        if not user.get('is_verified'):
            return jsonify({'message': 'Email not verified. Please verify your email first.'}), 401

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
        
        # 1. Check if email ALREADY exists as an APPLICANT (applicant_no is not NULL)
        # Admin emails (user_no only) are allowed to register as applicant
        cur.execute('SELECT em_no FROM email WHERE email_address ILIKE %s AND applicant_no IS NOT NULL LIMIT 1', (email,))
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
        
        # 1. Look up in pending_registrations
        if email:
            cur.execute('SELECT * FROM pending_registrations WHERE email_address ILIKE %s', (email,))
        else:
            cur.execute('SELECT * FROM pending_registrations WHERE verification_code = %s', (token,))
            
        pending = cur.fetchone()

        if not pending:
            # Check if already verified as applicant
            if email:
                cur.execute('SELECT em_no FROM email WHERE email_address ILIKE %s AND applicant_no IS NOT NULL', (email,))
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

        # Insert into email
        cur.execute(
            """
            INSERT INTO email (email_address, applicant_no, password_hash, is_verified)
            VALUES (%s, %s, %s, TRUE)
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
        
        # 1. Check if email exists in permanent table (already verified)
        cur.execute('SELECT is_verified FROM email WHERE email_address ILIKE %s', (email,))
        user = cur.fetchone()
        if user and user.get('is_verified'):
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
        
        # Check if email exists and get account type
        cur.execute('''
            SELECT applicant_no, user_no 
            FROM email 
            WHERE email_address ILIKE %s
        ''', (email,))
        result = cur.fetchone()
        
        if result:
            applicant_no = result.get('applicant_no') if hasattr(result, 'get') else result[0]
            user_no = result.get('user_no') if hasattr(result, 'get') else result[1]
            
            # For applicant registration: only reject if email already has an applicant account
            if applicant_no:
                return jsonify({
                    'exists': True,
                    'account_type': 'applicant',
                    'available': False,
                    'message': 'Email already registered as applicant'
                })
            else:
                # Email may exist as admin, but that's OK for applicant registration
                return jsonify({
                    'exists': True,
                    'account_type': 'admin' if user_no else None,
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
        cur.execute(
            """
            SELECT e.applicant_no, e.email_address, a.first_name, a.last_name
            FROM email e
            JOIN applicants a ON e.applicant_no = a.applicant_no
            WHERE e.email_address ILIKE %s
            LIMIT 1
            """,
            (email,),
        )
        user = cur.fetchone()
        
        # 3. Handle Existing vs. New user
        if user:
            # For existing users, always force is_verified=TRUE since Google login IS a verification
            cur.execute("UPDATE email SET is_verified = TRUE WHERE email_address ILIKE %s", (email,))
            
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
                """
                INSERT INTO email (applicant_no, email_address, is_verified)
                VALUES (%s, %s, TRUE)
                RETURNING em_no
                """,
                (applicant_no, email),
            )
            em_no = cur.fetchone()['em_no']
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
        
        # Check if email exists as an applicant
        cur.execute(
            """
            SELECT e.applicant_no, e.email_address, a.first_name, a.last_name
            FROM email e
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
                """
                SELECT e.user_no
                FROM email e
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
            reset_url = f"{STUDENT_FRONTEND_URL}/reset-password/{reset_token}"
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
        password_hash = bcrypt.generate_password_hash(new_password).decode('utf-8')

        conn = get_db()
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE email
            SET password_hash = %s
            WHERE applicant_no = %s AND email_address ILIKE %s
            RETURNING em_no
            """,
            (password_hash, payload['user_no'], payload['email']),
        )
        updated = cur.fetchone()
        conn.commit()
        
        if not updated:
            return jsonify({'message': 'Invalid or expired token'}), 400

        return jsonify({'message': 'Password reset successfully'}), 200
    except jwt.ExpiredSignatureError:
        return jsonify({'message': 'Reset link has expired'}), 400
    except jwt.InvalidTokenError:
        return jsonify({'message': 'Invalid reset link'}), 400
    except Exception as exc:
        traceback.print_exc()
        return jsonify({'message': f'Error resetting password: {str(exc)}'}), 500
    finally:
        if 'conn' in locals():
            conn.close()


@student_api_bp.route('/scholarships', methods=['GET'])
@student_api_bp.route('/scholarships/all', methods=['GET'])
def get_all_scholarships():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('SELECT * FROM scholarships ORDER BY scholarship_name')
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
        cur.execute('SELECT * FROM scholarships WHERE req_no = %s', (req_no,))
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
        
        cur.execute("SELECT * FROM scholarships")
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
                if loc_clean in address:
                    score += 100
                elif any(word in address for word in loc_clean.split()):
                    score += 40
                else:
                    reasons.append(f"Location does not match requirement '{loc}'")
            else:
                score += 10

            item = {
                'req_no': sch['req_no'],
                'name': sch['scholarship_name'],
                'minGpa': min_gpa,
                'maxIncome': max_inc,
                'location': loc,
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
        cur.execute('SELECT * FROM applicants WHERE applicant_no = %s', (request.user_no,))
        applicant = cur.fetchone()
        if not applicant:
            return jsonify({'message': 'Not found'}), 404

        for key, value in list(applicant.items()):
            if isinstance(value, (bytes, memoryview)):
                if key == 'profile_picture':
                    applicant[key] = f"data:image/jpeg;base64,{base64.b64encode(bytes(value)).decode('utf-8')}"
                elif key == 'signature_image_data':
                    # Decrypt signature if encrypted
                    sig_bytes = decode_signature(value)
                    applicant['signature_image_data'] = f"data:image/png;base64,{base64.b64encode(sig_bytes).decode('utf-8')}"
                    applicant['has_signature'] = True
                elif key == 'id_img_front':
                    applicant['id_img_front'] = f"data:image/jpeg;base64,{base64.b64encode(bytes(value)).decode('utf-8')}"
                    applicant['has_id'] = True
                elif key == 'id_img_back':
                    applicant['id_img_back'] = f"data:image/jpeg;base64,{base64.b64encode(bytes(value)).decode('utf-8')}"
                elif key == 'enrollment_certificate_doc':
                    applicant['enrollment_certificate_doc'] = f"data:image/jpeg;base64,{base64.b64encode(bytes(value)).decode('utf-8')}"
                    applicant['has_mayorCOE_photo'] = True
                elif key == 'grades_doc':
                    applicant['grades_doc'] = f"data:image/jpeg;base64,{base64.b64encode(bytes(value)).decode('utf-8')}"
                    applicant['has_mayorGrades_photo'] = True
                elif key == 'indigency_doc':
                    applicant['indigency_doc'] = f"data:image/jpeg;base64,{base64.b64encode(bytes(value)).decode('utf-8')}"
                    applicant['has_mayorIndigency_photo'] = True
                elif key == 'id_pic':
                    applicant['id_pic'] = f"data:image/jpeg;base64,{base64.b64encode(bytes(value)).decode('utf-8')}"
                    applicant['has_mayorValidID_photo'] = True
                else:
                    # Generic mapping for other blob fields if any
                    applicant[f'has_{key}'] = True
                    del applicant[key]
            elif isinstance(value, datetime):
                applicant[key] = value.isoformat()
            elif key == 'birthdate' and value:
                applicant[key] = str(value)

        # Ensure account flags are present for frontend synchronization
        applicant['email_verified'] = applicant.get('is_verified', False)
        # Google users are verified upon fast-registration
        if applicant.get('google_id'):
            applicant['email_verified'] = True

        return jsonify(applicant)
    except Exception as exc:
        return jsonify({'message': str(exc)}), 500
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
            'province': 'province', 'zipCode': 'zip_code', 'sex': 'sex',
            'citizenship': 'citizenship', 'schoolIdNumber': 'school_id_no',
            'schoolName': 'school', 'schoolAddress': 'school_address',
            'schoolSector': 'school_sector', 'mobileNumber': 'mobile_no',
            'yearLevel': 'year_lvl', 'fatherPhoneNumber': 'father_phone_no',
            'motherPhoneNumber': 'mother_phone_no', 'fatherOccupation': 'father_occupation',
            'motherOccupation': 'mother_occupation', 'parentsGrossIncome': 'financial_income_of_parents',
            'gpa': 'overall_gpa', 'numberOfSiblings': 'sibling_no', 'course': 'course',
            'id_vid_url': 'id_vid_url',
            'face_video': 'id_vid_url',
            'mayorIndigency_video': 'indigency_vid_url',
            'mayorGrades_video': 'grades_vid_url',
            'mayorCOE_video': 'enrollment_certificate_vid_url',
            'schoolId_video': 'schoolId_vid_url',
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
                add_update(db_col, blob_bytes)
                continue

            if field_key in data and data[field_key]:
                blob_bytes = decode_base64(data[field_key])
                if blob_bytes is not None:
                    if field_key == 'signature_data' and blob_bytes and fernet:
                        blob_bytes = fernet.encrypt(blob_bytes)
                    add_update(db_col, blob_bytes)

        if not updates:
            return jsonify({'message': 'No changes provided'}), 200

        params.append(request.user_no)
        sql = f"UPDATE applicants SET {', '.join(updates)} WHERE applicant_no = %s"
        cur.execute(sql, tuple(params))
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
        
        # Migration: Ensure created_at column exists in applicant_status
        cur.execute("""
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                             WHERE table_name='applicant_status' AND column_name='created_at') THEN 
                    ALTER TABLE applicant_status ADD COLUMN created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
                END IF;
            END $$;
        """)
        conn.commit()
        
        # Get applicant data
        cur.execute('SELECT * FROM applicants WHERE applicant_no = %s', (current_user_id,))
        applicant = cur.fetchone()
        if not applicant:
            return jsonify({'message': 'Applicant profile not found'}), 404

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

        # ── OCR & FACE VERIFICATION (PARALLEL) ────────────────────────────────
        ocr_ok = True
        ocr_status = "Verification skipped"
        face_ok = True
        face_status = "Verification skipped"
        
        if not skip_verify:
            try:
                from concurrent.futures import ThreadPoolExecutor
                verification_tasks = {}
                # Limit to 1 worker to keep peak RAM usage safe on 512MB Render instances
                # (Prevents running 2+ Tesseract binaries at the exact same time, which freezes the server)
                with ThreadPoolExecutor(max_workers=1) as executor:
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

                    # 2. Face Verification
                    if face_photo_bytes and id_front_bytes:
                        print("[SUBMIT] Scheduling Face verification...")
                        verification_tasks['face'] = executor.submit(
                            verify_face_with_id, face_photo_bytes, id_front_bytes
                        )

                    # 3. Video OCR Validations
                    video_requirements = {
                        'mayorIndigency_video': ['Indigency', 'Barangay'],
                        'mayorGrades_video': ['Grades', 'Evaluation', 'Academic'],
                        'mayorCOE_video': ['Enrollment', 'Certificate', 'Enrolled']
                    }
                    for field, keywords in video_requirements.items():
                        v_bytes = None
                        video_file = request.files.get(field)
                        if video_file:
                            print(f"[SUBMIT] Processing uploaded Video for {field}...")
                            v_bytes = video_file.read()
                            video_file.seek(0)
                        else:
                            # Try getting URL from form data
                            video_url = form_data.get(field)
                            if isinstance(video_url, str) and video_url.startswith('http'):
                                print(f"[SUBMIT] Processing video URL for {field}...")
                                v_bytes, _ = fetch_video_bytes_from_url(video_url)
                        
                        if v_bytes:
                            print(f"[SUBMIT] Scheduling Video scanning for {field}...")
                            # For Indigency, pass the town/city for address verification
                            expected_addr = None
                            if field == 'mayorIndigency_video':
                                expected_addr = form_data.get('townCity') or applicant.get('town_city_municipality', '')
                            
                            verification_tasks[f'video_{field}'] = executor.submit(
                                verify_video_content, v_bytes, keywords, expected_addr
                            )

                    # --- GATHER RESULTS ---
                    if 'ocr' in verification_tasks:
                        ocr_ok, ocr_status, _, _ = verification_tasks['ocr'].result()
                        print(f"[SUBMIT] OCR Result: {ocr_status}")
                    
                    if 'face' in verification_tasks:
                        face_ok, face_status, _ = verification_tasks['face'].result()
                        print(f"[SUBMIT] Face Result: {face_status}")
                        if not face_ok:
                            return jsonify({'message': f'Face Verification Failed: {face_status}', 'face_status': face_status}), 400
                    elif not skip_verify:
                         return jsonify({'message': 'Missing verification documents: Face photo or ID front missing'}), 400

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
                    'face_status': f"Error: {str(ai_err)}"
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
            'id_vid_url': 'id_vid_url',
            'face_video': 'id_vid_url',
            'mayorIndigency_video': 'indigency_vid_url',
            'mayorGrades_video': 'grades_vid_url',
            'mayorCOE_video': 'enrollment_certificate_vid_url',
            'schoolId_video': 'schoolId_vid_url',
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
                updates.append(f'{column_name} = %s')
                params.append(value)

        if updates:
            sql = f"UPDATE applicants SET {', '.join(updates)} WHERE applicant_no = %s"
            params.append(current_user_id)
            cur.execute(sql, tuple(params))

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
            'ocr_status': ocr_status,
            'face_status': face_status
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
        data = request.get_json(silent=True) or {}

        # 1. Get applicant record from DB
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT applicant_no, first_name, middle_name, last_name, town_city_municipality, id_img_front, id_img_back, indigency_doc, id_vid_url, indigency_vid_url, enrollment_certificate_vid_url, grades_vid_url FROM applicants WHERE applicant_no = %s", (request.user_no,))
        applicant = cur.fetchone()

        if not applicant:
            return jsonify({'verified': False, 'message': 'Applicant profile not found'}), 404

        # 2. Resolve parameters
        id_front_param = data.get('id_front') or data.get('idFront')
        id_back_param = data.get('id_back') or data.get('idBack')
        indigency_doc_param = data.get('indigency_doc') or data.get('indigencyDoc')
        enrollment_doc_param = data.get('enrollment_doc') or data.get('enrollmentDoc')
        grades_doc_param = data.get('grades_doc') or data.get('gradesDoc')

        first_name = str(data.get('first_name') or data.get('firstName') or applicant.get('first_name', '')).strip()
        middle_name = str(data.get('middle_name') or data.get('middleName') or applicant.get('middle_name', '')).strip()
        last_name = str(data.get('last_name') or data.get('lastName') or applicant.get('last_name', '')).strip()
        
        # Construct full expected name for OCR matching
        # Include middle name only if it's more than a single character or placeholder
        full_expected_name = f"{first_name} {last_name}"
        if middle_name and len(middle_name) > 1:
            full_expected_name = f"{first_name} {middle_name} {last_name}"
        town_city = str(data.get('town_city') or data.get('townCity') or applicant.get('town_city_municipality', '')).strip()
        school_name = str(data.get('school_name') or data.get('schoolName') or '').strip()
        course = str(data.get('course') or '').strip()
        expected_gpa = str(data.get('gpa') or data.get('expectedGPA') or '').strip()
        expected_year = str(data.get('expected_year') or data.get('expectedYear') or data.get('yearLevel') or '').strip()
        expected_id_no = str(data.get('id_number') or data.get('idNumber') or '').strip()

        def get_bytes(param, db_val):
            return decode_base64(param) or db_bytes(db_val)
        
        # Now uses global fetch_video_bytes_from_url

        # ── Worker Function for Parallel Processing ──
        def process_doc(doc_type, doc_param, db_val):
            try:
                # Use standard doc bytes for provided parameters, fallback to DB only for Indigency/ID
                doc_bytes = decode_base64(doc_param) if doc_param else (db_bytes(db_val) if db_val else None)
                
                if doc_type == 'Indigency':
                    print(f"[INDIGENCY DECODE] doc_param present: {bool(doc_param)}, param is string: {isinstance(doc_param, str)}, param length: {len(doc_param) if isinstance(doc_param, str) else 'N/A'}", flush=True)
                    print(f"[INDIGENCY DECODE] has comma: {',' in doc_param if isinstance(doc_param, str) else 'N/A'}, doc_bytes obtained: {doc_bytes is not None}", flush=True)
                    if doc_bytes is None:
                        print(f"[INDIGENCY DECODE] WARNING: doc_bytes is None! db_val present: {bool(db_val)}", flush=True)
                        if not doc_param and not db_val:
                            print(f"[INDIGENCY DECODE] CRITICAL: No data source available", flush=True)
                
                if not doc_bytes: 
                    if doc_type == 'Indigency':
                        print(f"[INDIGENCY] Early return due to missing doc_bytes", flush=True)
                    return None

                # 1. Main OCR Verification (Identity)
                # Determine video URL for this document type (Prioritize request payload)
                frontend_video_url = data.get('video_url')
                vid_url_map = {
                    'Indigency': frontend_video_url or applicant.get('indigency_vid_url'),
                    'SchoolID': applicant.get('id_vid_url'),
                    'Enrollment': frontend_video_url or applicant.get('enrollment_certificate_vid_url'),
                    'Grades': frontend_video_url or applicant.get('grades_vid_url')
                }
                vid_url = vid_url_map.get(doc_type)
                # Define keywords for each document type
                # Indigency can be detected as 'Certificate' + other indicators
                doc_keywords = {
                    'Indigency': ['Indigency', 'Certificate', 'Indigent', 'Pauper'],
                    'Enrollment': ['Enrollment', 'Certificate', 'Registration', 'Course', 'Semester', 'College'],  # More flexible for different cert formats
                    'Grades': ['Grades', 'Transcript', 'Evaluation', 'GPA', 'Rating', 'Final', 'Subject', 'Grade'],  # Include "Final", "Subject", "Grade" for student transcripts
                    'SchoolID': ['School', 'ID', 'Identification', 'Card']
                }

                # 1.a Video Content Verification (if URL present)
                v_video, msg_video = True, "Not provided"
                if vid_url:
                    vid_bytes, fetch_err = fetch_video_bytes_from_url(vid_url)
                    if vid_bytes:
                        v_video, msg_video = verify_video_content(
                            video_bytes=vid_bytes,
                            keywords=doc_keywords.get(doc_type),
                            expected_address=None  # Address matching in videos is unreliable and slow; keywords alone are sufficient
                        )
                    else:
                        msg_video = f"Video file unreachable ({fetch_err})"
                        v_video = False
                else:
                    # Video is now mandatory for these specific documents
                    if doc_type in ['Indigency', 'Enrollment', 'Grades']:
                        v_video = False
                        msg_video = "Mandatory supporting video is missing"
                
                # If video verification fails, the entire document verification fails
                if not v_video:
                    return {'doc': doc_type, 'verified': False, 'message': f"Video verification failed: {msg_video}", 'video_verified': False, 'video_message': msg_video}
                
                # 1.b OCR Extraction from document image
                v, msg, raw, _ = verify_id_with_ocr(doc_bytes, first_name, middle_name, last_name, town_city)
                raw_lower = raw.lower() if raw else ""
                
                # If primary OCR extraction failed, return error
                if not v:
                    return {'doc': doc_type, 'verified': False, 'message': msg, 'raw_text': raw, 'video_verified': v_video, 'video_message': msg_video}
                
                # Double-check keywords
                if doc_type in doc_keywords and doc_type != 'SchoolID': # SchoolID keywords are verified in video/header logic
                    _, _, found_kw, _ = _perform_text_matching(raw, None, None, None, doc_keywords[doc_type], is_indigency=True)
                    if not found_kw:
                        return {'doc': doc_type, 'verified': False, 'message': f"Document type mismatch: Required '{doc_keywords[doc_type][0]}' not detected.", 'raw_text': raw}

                # 2. Document-Specific Logic (REUSING 'raw' text)
                if doc_type == 'Enrollment':
                    year_label = extract_school_year_from_text(raw)
                    v_year = int(expected_year) if expected_year and str(expected_year).isdigit() else 2026
                    year_ok = is_current_school_year(year_label, current_year=v_year)
                    school_ok = True if not school_name else (school_name.lower() in raw_lower)
                    if school_name and not school_ok:
                        school_parts = [p.strip() for p in school_name.lower().split() if len(p.strip()) > 3]
                        school_ok = any(p in raw_lower for p in school_parts) if school_parts else True

                    if v:
                        if not year_ok: v, msg = False, f"Outdated A.Y. ({year_label or 'None'})"
                        elif not school_ok: v, msg = False, f"School mismatch ({school_name})"
                        else: msg = f"Verified: A.Y. {year_label}" + (f" | {school_name}" if school_name else "")
                    
                    return {'doc': 'Enrollment', 'verified': v, 'message': msg, 'raw_text': raw, 'school_year': year_label, 'video_verified': v_video, 'video_message': msg_video}

                elif doc_type == 'Grades':
                    year_label = extract_school_year_from_text(raw)
                    v_year = int(expected_year) if expected_year and str(expected_year).isdigit() else 2026
                    year_ok = is_current_school_year(year_label, current_year=v_year)
                    school_ok = True if not school_name else (school_name.lower() in raw_lower)
                    if school_name and not school_ok:
                        school_parts = [p.strip() for p in school_name.lower().split() if len(p.strip()) > 3]
                        school_ok = any(p in raw_lower for p in school_parts) if school_parts else True

                    if v:
                        if not year_ok: v, msg = False, f"Outdated A.Y. ({year_label or 'None'})"
                        elif not school_ok: v, msg = False, f"School mismatch ({school_name})"
                        else: msg = f"Verified: A.Y. {year_label}" + (f" | {school_name}" if school_name else "")
                    
                    return {'doc': 'Grades', 'verified': v, 'message': msg, 'raw_text': raw, 'school_year': year_label, 'video_verified': v_video, 'video_message': msg_video}

                elif doc_type == 'Indigency':
                    return {'doc': 'Indigency', 'verified': v, 'message': msg, 'raw_text': raw, 'video_verified': v_video, 'video_message': msg_video}

                elif doc_type == 'SchoolID':
                    raw_lower = raw.lower()
                    school_ok = True if not school_name else (school_name.lower() in raw_lower)
                    if school_name and not school_ok:
                        school_parts = [p.strip() for p in school_name.lower().split() if len(p.strip()) > 3]
                        school_ok = any(p in raw_lower for p in school_parts) if school_parts else True

                    id_no_ok = True if not expected_id_no else (expected_id_no.lower() in raw_lower)
                    # For ID front, we only check School Name and ID Number (Year Level is on the back)

                    # Fallback overriding: If name match failed, but ID number explicitly matches, allow verification
                    if not v and raw_lower.strip() and expected_id_no and len(expected_id_no) >= 3 and id_no_ok:
                        v = True

                    if v:
                        if not school_ok: v, msg = False, f"School name mismatch ({school_name})"
                        elif not id_no_ok: v, msg = False, f"ID number mismatch ({expected_id_no})"
                        else: msg = "School ID (front) details verified successfully"

                    return {'doc': 'Identity Front', 'verified': v, 'message': msg, 'raw_text': raw, 'video_verified': v_video, 'video_message': msg_video}

                elif doc_type == 'SchoolIDBack':
                    # Verify academic year validity from the sticker or text on ID back
                    year_label = extract_school_year_from_text(raw)
                    # Use 2026 as the target year as specifically requested for current verification
                    year_ok = is_current_school_year(year_label, current_year=2026)
                    
                    if v and not year_ok:
                        v, msg = False, f"ID validity expired or Year Mismatch. Found: '{year_label or 'None'}'. Expected current SY (2026)."
                    elif v:
                        msg = f"ID validity verified for Academic Year: {year_label}"
                        
                    return {'doc': 'Identity Back', 'verified': v, 'message': msg, 'raw_text': raw, 'school_year': year_label}

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
            # max_workers=1: individual scan buttons send only one doc at a time.
            # Enforcing this prevents OOM crashes on Render's 512MB free-tier RAM.
            with ThreadPoolExecutor(max_workers=1) as executor:
                future_results = [executor.submit(process_doc, *job) for job in jobs]
                for future in future_results:
                    res = future.result()
                    if res:
                        results.append(res)
                        if not res.get('verified', False): overall_verified = False

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
            cur.execute(
                """
                UPDATE applicant_status
                SET is_accepted = FALSE
                WHERE applicant_no = %s AND scholarship_no != %s
                """,
                (applicant_no, req_no),
            )

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

        # Check if 'status_updated' column exists in the announcements table
        cur.execute("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'announcements' AND column_name = 'status_updated'
        """)
        has_status_updated = cur.fetchone() is not None

        # Check if 'time_added' column exists 
        cur.execute("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'announcements' AND column_name = 'time_added'
        """)
        has_time_added = cur.fetchone() is not None

        # Build the date expression based on what columns actually exist
        if has_time_added:
            date_col = 'a.time_added'
            order_col = 'a.time_added DESC'
        elif has_status_updated:
            date_col = 'a.status_updated'
            order_col = 'a.status_updated DESC'
        elif has_ann_date:
            date_col = 'a.ann_date'
            order_col = 'a.ann_date DESC'
        else:
            date_col = 'NULL'
            order_col = 'a.ann_no DESC'

        # Join announcements with scholarship_providers to get the name of the provider
        cur.execute(f"""
            SELECT a.ann_no, a.ann_title, a.ann_message, {date_col} AS ann_date, {date_col} AS time_added, COALESCE(sp.provider_name, 'Unknown Provider') AS provider_name
            FROM announcements a
            LEFT JOIN scholarship_providers sp ON a.pro_no = sp.pro_no
            ORDER BY {order_col}
        """)

        rows = cur.fetchall()

        announcements = []
        for row in rows:
            ann_date = row.get('ann_date')
            if ann_date and hasattr(ann_date, 'date'):
                date_str = str(ann_date.date())
            elif ann_date:
                date_str = str(ann_date)
            else:
                date_str = 'Recent'
            announcements.append({
                'ann_no': row['ann_no'],
                'ann_title': row['ann_title'],
                'ann_message': row['ann_message'],
                'created_at': date_str,
                'provider_name': row['provider_name']
            })

        return jsonify(announcements)
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
        # Check if the images are base64 strings
        face_bytes = decode_base64(face_image_data) if isinstance(face_image_data, str) and face_image_data.startswith('data:') else None
        id_bytes = decode_base64(id_image_data) if isinstance(id_image_data, str) and id_image_data.startswith('data:') else None

        if not face_bytes or not id_bytes:
            return jsonify({'verified': False, 'message': 'Invalid image format. Must be base64 data URI.'}), 400

        # Run face verification using UniFace/ONNX (via ocr_utils)
        verified, message, confidence = verify_face_with_id(face_bytes, id_bytes)
        
        return jsonify({
            'verified': verified,
            'message': message,
            'confidence': confidence
        })
    except Exception as e:
        print(f"[FACE-MATCH] Error: {str(e)}", flush=True)
        traceback.print_exc()
        return jsonify({'verified': False, 'message': f'Internal verification error: {str(e)}'}), 500


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
        # Check if the images are base64 strings
        signature_bytes = decode_base64(signature_data) if isinstance(signature_data, str) and signature_data.startswith('data:') else None
        id_back_bytes = decode_base64(id_back_data) if isinstance(id_back_data, str) and id_back_data.startswith('data:') else None

        if not signature_bytes or not id_back_bytes:
            return jsonify({'verified': False, 'message': 'Invalid image format. Must be base64 data URI.', 'confidence': 0.0}), 400

        # Use new signature verification function
        # Pass request.user_no (from token) to enable local profile matching
        student_id = getattr(request, 'user_no', None)
        verified, message, confidence, sub_img, ext_img = verify_signature_against_id(signature_bytes, id_back_bytes, student_id=student_id)
        
        # Convert images to base64 for frontend display
        processed_submitted = None
        extracted_signature = None
        
        if sub_img is not None:
             _, buffer = cv2.imencode('.png', sub_img)
             processed_submitted = f"data:image/png;base64,{base64.b64encode(buffer).decode('utf-8')}"
             
        if ext_img is not None:
             _, buffer = cv2.imencode('.png', ext_img)
             extracted_signature = f"data:image/png;base64,{base64.b64encode(buffer).decode('utf-8')}"
        
        # Ensure all values are native Python types (not numpy types)
        return jsonify({
            'verified': bool(verified),
            'message': str(message),
            'confidence': float(confidence),
            'processed_submitted': processed_submitted,
            'extracted_signature': extracted_signature
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
def convert_and_upload_video():
    """
    Convert WebM video to H.264 MP4 format for universal browser compatibility,
    then upload to Supabase.
    
    This endpoint ensures all videos are stored in a universally supported format.
    
    Expected form data:
    - video: The video file to upload
    - field_name: The name of the field (e.g., 'schoolId_video', 'mayorIndigency_video')
    """
    try:
        current_user_id = request.user_no
        
        if 'video' not in request.files:
            return jsonify({'success': False, 'message': 'No video file provided'}), 400
        
        video_file = request.files['video']
        field_name = request.form.get('field_name', 'unknown')
        
        if not video_file or video_file.filename == '':
            return jsonify({'success': False, 'message': 'Empty video file'}), 400
        
        print(f"[VIDEO-CONVERT-UPLOAD] User {current_user_id}: Received {field_name}: {video_file.filename} ({video_file.content_length} bytes)", flush=True)
        
        # Read video bytes
        video_bytes = video_file.read()
        
        # Convert to H.264 MP4
        print(f"[VIDEO-CONVERT-UPLOAD] Converting {field_name} to H.264 MP4...", flush=True)
        converted_bytes = convert_video_to_mp4(video_bytes)
        
        # If conversion failed, use original
        if not converted_bytes or len(converted_bytes) == 0:
            print(f"[VIDEO-CONVERT-UPLOAD] Conversion failed, using original bytes", flush=True)
            converted_bytes = video_bytes
        
        # Upload to Supabase
        try:
            from supabase import create_client
            
            # Get Supabase credentials - try both possible key names
            supabase_url = os.environ.get('SUPABASE_URL')
            supabase_key = os.environ.get('SUPABASE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
            
            # Validate credentials
            if not supabase_url:
                print(f"[VIDEO-CONVERT-UPLOAD] ERROR: SUPABASE_URL not configured", flush=True)
                return jsonify({
                    'success': False, 
                    'message': 'Server configuration error: Supabase URL not configured'
                }), 500
            
            if not supabase_key:
                print(f"[VIDEO-CONVERT-UPLOAD] ERROR: SUPABASE_KEY or SUPABASE_SERVICE_ROLE_KEY not configured", flush=True)
                return jsonify({
                    'success': False, 
                    'message': 'Server configuration error: Supabase credentials not configured'
                }), 500
            
            print(f"[VIDEO-CONVERT-UPLOAD] Connecting to Supabase at {supabase_url}", flush=True)
            supabase = create_client(supabase_url, supabase_key)
            
            # Map field names to folders
            folder_map = {
                'mayorIndigency_video': 'indigency',
                'mayorCOE_video': 'coe',
                'mayorGrades_video': 'grades',
                'schoolId_video': 'school_id',
                'id_vid_url': 'id_verification',
                'face_video': 'id_verification'
            }
            
            folder = folder_map.get(field_name, 'others')
            file_name = f"{current_user_id}_{int(time.time())}.mp4"
            file_path = f"videos/{folder}/{file_name}"
            
            print(f"[VIDEO-CONVERT-UPLOAD] Uploading to Supabase: {file_path} ({len(converted_bytes)} bytes)", flush=True)
            
            response = supabase.storage.from_('document_videos').upload(
                file_path,
                converted_bytes,
                file_options={
                    'content-type': 'video/mp4',
                    'cache-control': '3600',
                    'upsert': 'true'
                }
            )
            
            # Get public URL
            public_url = supabase.storage.from_('document_videos').get_public_url(file_path)
            
            print(f"[VIDEO-CONVERT-UPLOAD] Successfully uploaded: {public_url}", flush=True)
            
            return jsonify({
                'success': True,
                'message': 'Video uploaded successfully',
                'publicUrl': public_url,
                'originalSize': len(video_bytes),
                'convertedSize': len(converted_bytes)
            })
        
        except Exception as upload_err:
            error_msg = str(upload_err)
            print(f"[VIDEO-CONVERT-UPLOAD] Supabase upload error: {error_msg}", flush=True)
            import traceback
            traceback.print_exc()
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

