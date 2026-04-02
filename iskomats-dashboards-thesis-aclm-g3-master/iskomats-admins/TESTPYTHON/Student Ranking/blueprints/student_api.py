import base64
import os
import time
import traceback
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
from services.ocr_utils import verify_id_with_ocr, verify_face_with_id, extract_school_year, verify_signature_against_id, save_signature_profile


student_api_bp = Blueprint('student_api', __name__, url_prefix='/api/student')
bcrypt = Bcrypt()
SECRET_KEY = get_secret_key()

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

def fetch_google_access_token():
    """Exchange the configured refresh token for a Gmail API access token."""
    from urllib import parse, request as urllib_request, error as urllib_error
    import json
    
    missing_settings = []
    if not GOOGLE_CLIENT_ID: missing_settings.append('GOOGLE_CLIENT_ID')
    if not GOOGLE_CLIENT_SECRET: missing_settings.append('GOOGLE_CLIENT_SECRET')
    if not GOOGLE_REFRESH_TOKEN: missing_settings.append('GOOGLE_REFRESH_TOKEN')

    if missing_settings:
        raise RuntimeError(f"Google Gmail API credentials are not configured. Missing: {', '.join(missing_settings)}")

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

    with urllib_request.urlopen(token_request, timeout=30) as response:
        payload = json.loads(response.read().decode('utf-8'))
    
    return payload.get('access_token')

def send_password_reset_email(receiver_email, reset_url):
    """Send a password reset email via the Gmail API."""
    from urllib import request as urllib_request
    import json
    
    if not GMAIL_SENDER_EMAIL:
        raise RuntimeError('Gmail sender email is not configured.')

    message = f"""Subject: Reset your ISKOMATS Student Password
To: {receiver_email}
From: {GMAIL_SENDER_EMAIL}
Content-Type: text/plain; charset="UTF-8"

Hello,

We received a request to reset your student password for ISKOMATS.

Use the link below to set a new password:
{reset_url}

This link will expire in {PASSWORD_RESET_EXPIRY_MINUTES} minutes.

If you did not request a password reset, you can ignore this email.
"""

    access_token = fetch_google_access_token()
    encoded_message = base64.urlsafe_b64encode(message.encode('utf-8')).decode('utf-8')
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


@student_api_bp.route('/auth/login', methods=['POST'])
def student_login():
    data = request.get_json() or {}
    email = data.get('email', '').strip()
    password = data.get('password', '')

    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT em_no, user_no, applicant_no, password_hash
            FROM email
            WHERE email_address ILIKE %s
            """,
            (email,),
        )
        user = cur.fetchone()

        if not user or not bcrypt.check_password_hash(user['password_hash'], password):
            return jsonify({'message': 'Invalid credentials'}), 401

        payload = {
            'exp': datetime.utcnow() + timedelta(days=7),
            'iat': datetime.utcnow(),
            'user_no': user['applicant_no'] if user['applicant_no'] else user['user_no'],
        }
        token = jwt.encode(payload, SECRET_KEY, algorithm='HS256')

        return jsonify({
            'token': token,
            'user_no': payload['user_no'],
            'applicant_no': user['applicant_no'],
            'is_applicant': bool(user['applicant_no']),
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
        cur.execute('SELECT applicant_no FROM email WHERE email_address ILIKE %s LIMIT 1', (email,))
        if cur.fetchone():
            return jsonify({'message': 'Email already registered'}), 400

        cur.execute(
            """
            INSERT INTO applicants (first_name, middle_name, last_name)
            VALUES (%s, %s, %s)
            RETURNING applicant_no
            """,
            (first_name, middle_name or None, last_name),
        )
        applicant_no = cur.fetchone()['applicant_no']

        password_hash = bcrypt.generate_password_hash(password).decode('utf-8')
        cur.execute(
            """
            INSERT INTO email (email_address, applicant_no, password_hash)
            VALUES (%s, %s, %s)
            """,
            (email, applicant_no, password_hash),
        )
        conn.commit()

        payload = {
            'exp': datetime.utcnow() + timedelta(days=7),
            'iat': datetime.utcnow(),
            'user_no': applicant_no,
        }
        token = jwt.encode(payload, SECRET_KEY, algorithm='HS256')

        return jsonify({
            'message': 'Registration successful',
            'token': token,
            'user_no': applicant_no,
            'is_applicant': True,
        }), 201
    except Exception as exc:
        return jsonify({'message': f'Error: {str(exc)}'}), 500
    finally:
        if 'conn' in locals():
            conn.close()


@student_api_bp.route('/auth/check-email', methods=['POST'])
def student_check_email():
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
            applicant_no, user_no = result
            # Determine account type based on which field is populated
            account_type = None
            if applicant_no:
                account_type = 'applicant'
            elif user_no:
                account_type = 'admin'
            
            return jsonify({
                'exists': True,
                'account_type': account_type,
                'available': False
            })
        else:
            return jsonify({
                'exists': False,
                'account_type': None,
                'available': True
            })
    except Exception as exc:
        return jsonify({'message': str(exc)}), 500
    finally:
        if 'conn' in locals():
            conn.close()


@student_api_bp.route('/auth/validate', methods=['GET'])
@token_required
def validate_student_token():
    return jsonify({'message': 'Token is valid', 'user_no': request.user_no})


@student_api_bp.route('/auth/forgot-password', methods=['POST'])
def student_forgot_password():
    """Request password reset for student"""
    data = request.get_json() or {}
    email = data.get('email', '').strip()
    
    if not email:
        return jsonify({'message': 'Email is required'}), 400

    try:
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
        
        if user:
            reset_token = generate_password_reset_token(user['applicant_no'], user['email_address'])
            reset_url = f"{STUDENT_FRONTEND_URL}/reset-password/{reset_token}"
            print(f"[PASSWORD RESET] Sending reset email to {user['email_address']}", flush=True)
            print(f"[PASSWORD RESET] Using portal URL: {STUDENT_FRONTEND_URL}", flush=True)
            send_password_reset_email(user['email_address'], reset_url)

        return jsonify({'message': 'If an account exists with this email, a reset link has been sent.'}), 200
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
                    applicant[f'has_{key}'] = True
                    del applicant[key]
            elif isinstance(value, datetime):
                applicant[key] = value.isoformat()
            elif key == 'birthdate' and value:
                applicant[key] = str(value)

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
            'mayorIndigency_video': 'indigency_vid_url',
            'mayorGrades_video': 'grades_vid_url',
            'mayorCOE_video': 'enrollment_certificate_vid_url',
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

        # ── OCR & FACE VERIFICATION ───────────────────────────────────────────
        ocr_ok = True
        ocr_status = "Verification skipped"
        face_ok = True
        face_status = "Verification skipped"
        
        if not skip_verify:
            try:
                if not id_front_bytes:
                    print("[SUBMIT] Warning: Front of School ID is missing, skipping OCR.")
                else:
                    indigency_doc_bytes = doc_bytes.get('mayorIndigency_photo')
                    # Use the most recent value from the form if available
                    town_city = form_data.get('townCity') or applicant.get('town_city_municipality', '')
                    
                    print("[SUBMIT] Starting OCR verification...")
                    ocr_start = time.time()
                    ocr_ok, ocr_status, _, _ = verify_id_with_ocr(
                        image_bytes=id_front_bytes,
                        expected_name=f"{applicant.get('first_name', '')} {applicant.get('last_name', '')}",
                        expected_address=town_city
                    )
                    print(f"[SUBMIT] OCR finished in {time.time() - ocr_start:.2f}s: {ocr_status}")

                # 2. Face Verification
                if face_photo_bytes and id_front_bytes:
                    print("[SUBMIT] Starting Face verification...")
                    face_start = time.time()
                    face_ok, face_status, _ = verify_face_with_id(face_photo_bytes, id_front_bytes)
                    print(f"[SUBMIT] Face verification finished in {time.time() - face_start:.2f}s: {face_status}")
                    
                    if not face_ok:
                        print(f"[SUBMIT] ❌ Face Verification Failed: {face_status}")
                        return jsonify({
                            'message': f'Face Verification Failed: {face_status}',
                            'face_status': face_status
                        }), 400
                else:
                    face_status = "Face photo or ID front missing"
                    print(f"[SUBMIT] ❌ Face verification skipped/missing: {face_status}")
                    return jsonify({'message': f'Missing verification documents: {face_status}'}), 400

            except Exception as ai_err:
                print(f"[SUBMIT] AI Verification Exception: {str(ai_err)}")
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
            'mayorIndigency_video': 'indigency_vid_url',
            'mayorGrades_video': 'grades_vid_url',
            'mayorCOE_video': 'enrollment_certificate_vid_url',
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
    """OCR verification endpoint — supports multi-document authentication:

    1. Address/Indigency: verifies town_city + keywords ["indigency"]
    2. Enrollment (COE): verifies keywords ["enrollment", "registration"]
    3. Grades: verifies keywords ["grades", "transcript", "rating"]
    4. School ID: verifies Name Match.
    """
    try:
        data = request.get_json(silent=True) or {}

        # 1. Get applicant record from DB
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT applicant_no, first_name, last_name, town_city_municipality, id_img_front, indigency_doc FROM applicants WHERE applicant_no = %s", (request.user_no,))
        applicant = cur.fetchone()

        if not applicant:
            return jsonify({'verified': False, 'message': 'Applicant profile not found'}), 404

        # 2. Resolve parameters
        id_front_param = data.get('id_front') or data.get('idFront')
        indigency_doc_param = data.get('indigency_doc') or data.get('indigencyDoc')
        enrollment_doc_param = data.get('enrollment_doc') or data.get('enrollmentDoc')
        grades_doc_param = data.get('grades_doc') or data.get('gradesDoc')

        # Request-provided names take precedence over DB values (supports verifier bench testing)
        first_name = data.get('first_name') or applicant.get('first_name', '')
        last_name = data.get('last_name') or applicant.get('last_name', '')
        town_city = data.get('town_city') or data.get('townCity') or applicant.get('town_city_municipality', '')

        # Helper to get bytes
        def get_bytes(param, db_val):
            return decode_base64(param) or db_bytes(db_val)

        # Process documents based on what is provided in the request
        results = []
        overall_verified = True

        # ── Certificate of Enrollment (COE) ───────────────────────────────────
        if enrollment_doc_param:
            doc_bytes = decode_base64(enrollment_doc_param)
            if doc_bytes:
                v, msg, raw, _ = verify_id_with_ocr(
                    image_bytes=doc_bytes,
                    expected_name=f"{first_name} {last_name}",
                    expected_address=None
                )
                # Verify document-specific keywords
                keywords = ["enrollment", "registration", "admission", "matriculation", "cor", "coe", "form"]
                kw_found = any(kw in raw.lower() for kw in keywords)
                if v and not kw_found:
                    v = False
                    msg = "Please retry to upload again"
                results.append({'doc': 'Enrollment', 'verified': v, 'message': msg, 'raw_text': raw})
                if not v: overall_verified = False

        # ── Certified True Copy of Grades ─────────────────────────────────────
        if grades_doc_param:
            doc_bytes = decode_base64(grades_doc_param)
            if doc_bytes:
                v, msg, raw, _ = verify_id_with_ocr(
                    image_bytes=doc_bytes,
                    expected_name=f"{first_name} {last_name}",
                    expected_address=None
                )
                # Verify document-specific keywords
                keywords = ["grades", "transcript", "evaluation", "rating", "scholastic", "record"]
                kw_found = any(kw in raw.lower() for kw in keywords)
                if v and not kw_found:
                    v = False
                    msg = "Please retry to upload again"
                
                # Additionally verify the school year / semester is current
                import re
                year_match = re.search(r'20\d{2}-20\d{2}', raw)
                year_label = year_match.group(0) if year_match else None
                year_ok = year_label is not None
                year_msg = f"School year: {year_label}" if year_ok else "No school year found in document"
                
                if v and not year_ok:
                    v = False
                    msg = f"{msg} | {year_msg}"
                elif v and year_ok:
                    msg = f"{msg} | {year_msg}"
                    
                results.append({'doc': 'Grades', 'verified': v, 'message': msg, 'raw_text': raw,
                                'school_year': year_label if year_label else None})
                if not v: overall_verified = False

        # ── Certificate of Indigency / Address ────────────────────────────────
        if indigency_doc_param or (not enrollment_doc_param and not grades_doc_param and not id_front_param):
            # If no other docs, try to fall back to stored indigency or check address
            doc_bytes = get_bytes(indigency_doc_param, applicant.get('indigency_doc'))
            if doc_bytes:
                v, msg, raw, _ = verify_id_with_ocr(
                    image_bytes=doc_bytes,
                    expected_name=f"{first_name} {last_name}",
                    expected_address=town_city
                )
                # Verify document-specific keywords
                keywords = ["indigency", "barangay", "residency", "social", "welfare", "indigent"]
                kw_found = any(kw in raw.lower() for kw in keywords)
                if v and not kw_found:
                    v = False
                    msg = "Please retry to upload again"
                results.append({'doc': 'Indigency', 'verified': v, 'message': msg, 'raw_text': raw})
                if not v: overall_verified = False

        # ── School ID / Name Match ───────────────────────────────────────────
        if id_front_param:
            doc_bytes = get_bytes(id_front_param, applicant.get('id_img_front'))
            if doc_bytes:
                v, msg, raw, _ = verify_id_with_ocr(
                    image_bytes=doc_bytes,
                    expected_name=f"{first_name} {last_name}",
                    expected_address=None
                )
                results.append({'doc': 'Identity', 'verified': v, 'message': msg, 'raw_text': raw})
                if not v: overall_verified = False

        # Consolidate messages
        if not results:
            return jsonify({'verified': False, 'message': 'No documents provided for verification'}), 400

        final_msg = " | ".join([f"{r['doc']}: {r['message']}" for r in results])
        return jsonify({'verified': overall_verified, 'message': final_msg, 'details': results})


    except Exception as e:
        traceback.print_exc()
        return jsonify({'verified': False, 'message': f'Server error during verification: {str(e)}'}), 500
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
                ast.created_at
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
            if row.get('created_at'):
                row['created_at'] = str(row['created_at'])
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

        # Check if 'ann_date' column exists (alternative date column name)
        cur.execute("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'announcements' AND column_name = 'ann_date'
        """)
        has_ann_date = cur.fetchone() is not None

        # Build the date expression based on what columns actually exist
        if has_status_updated:
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
            SELECT a.ann_no, a.ann_title, a.ann_message, {date_col} AS ann_date, COALESCE(sp.provider_name, 'Unknown Provider') AS pro_name
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
                'provider_name': row['pro_name']
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
