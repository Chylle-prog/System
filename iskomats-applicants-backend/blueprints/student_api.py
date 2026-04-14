import os
import jwt
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify
from flask_bcrypt import Bcrypt
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

from services.db_service import get_db, get_db_startup
from services.email_table_service import get_applicant_email_table, get_user_email_table
from services.auth_service import get_secret_key

student_api_bp = Blueprint('student_api', __name__)
bcrypt = Bcrypt()
SECRET_KEY = get_secret_key()

# --- SCHEMA MIGRATION ---
import psycopg2

def ensure_applicant_verification_columns():
    try:
        conn = get_db_startup()
        cur = conn.cursor()

        # Ensure pending_registrations table exists
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS pending_registrations (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                first_name VARCHAR(100),
                last_name VARCHAR(100),
                middle_name VARCHAR(100),
                profile_picture TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        applicant_email_table = get_applicant_email_table(cur)

        # Check if columns exist
        cur.execute(f"""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = %s AND column_name IN ('is_verified', 'verification_code', 'is_locked', 'first_name', 'last_name', 'middle_name', 'profile_picture')
        """, (applicant_email_table,))
        existing = {row['column_name'] if isinstance(row, dict) else row[0] for row in cur.fetchall()}

        if 'is_verified' not in existing:
            cur.execute(f"ALTER TABLE {applicant_email_table} ADD COLUMN is_verified BOOLEAN DEFAULT FALSE")
            cur.execute(f"UPDATE {applicant_email_table} SET is_verified = TRUE")

        if 'verification_code' not in existing:
            cur.execute(f"ALTER TABLE {applicant_email_table} ADD COLUMN verification_code VARCHAR(100)")

        if 'is_locked' not in existing:
            cur.execute(f"ALTER TABLE {applicant_email_table} ADD COLUMN is_locked BOOLEAN DEFAULT FALSE")

        # Add profile columns if missing
        if 'first_name' not in existing:
            cur.execute(f"ALTER TABLE {applicant_email_table} ADD COLUMN first_name VARCHAR(100)")
        if 'last_name' not in existing:
            cur.execute(f"ALTER TABLE {applicant_email_table} ADD COLUMN last_name VARCHAR(100)")
        if 'middle_name' not in existing:
            cur.execute(f"ALTER TABLE {applicant_email_table} ADD COLUMN middle_name VARCHAR(100)")
        if 'profile_picture' not in existing:
            cur.execute(f"ALTER TABLE {applicant_email_table} ADD COLUMN profile_picture TEXT")

        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"[MIGRATION ERROR] Failed to ensure columns: {e}")

# Run simple migration on load
try:
    ensure_applicant_verification_columns()
except Exception:
    pass

# --- Authentication Endpoints ---

@student_api_bp.route('/auth/login', methods=['POST'])
def login():
    data = request.get_json() or {}
    email = data.get('email', '').strip()
    password = data.get('password', '')

    try:
        conn = get_db()
        cur = conn.cursor()
        applicant_email_table = get_applicant_email_table(cur)
        
        cur.execute(
            f"""
            SELECT app_em_no, applicant_no, password_hash, is_locked, is_verified, first_name, last_name, middle_name, profile_picture
            FROM {applicant_email_table}
            WHERE email_address ILIKE %s AND applicant_no IS NOT NULL
            """,
            (email,),
        )
        user = cur.fetchone()

        if not user:
            return jsonify({'message': 'Email does not exist. Please register first.'}), 401

        if not user.get('password_hash'):
            return jsonify({'message': 'This email is linked to a Google account. Use Google Sign-in.'}), 401

        if not bcrypt.check_password_hash(user['password_hash'], password):
            return jsonify({'message': 'Incorrect password'}), 401

        if user.get('is_locked'):
            return jsonify({'message': 'Account suspended. Contact administrator.', 'suspended': True}), 403
 
        payload = {
            'exp': datetime.utcnow() + timedelta(days=7),
            'iat': datetime.utcnow(),
            'user_no': user['applicant_no'],
        }
        token = jwt.encode(payload, SECRET_KEY, algorithm='HS256')

        return jsonify({
            'token': token,
            'email': email,
            'applicant_no': user['applicant_no'],
            'is_applicant': True,
            'first_name': user.get('first_name'),
            'last_name': user.get('last_name'),
            'middle_name': user.get('middle_name'),
            'profile_picture': user.get('profile_picture'),
        })
    except Exception as exc:
        return jsonify({'message': f'Server Error: {str(exc)}'}), 500
    finally:
        if 'conn' in locals():
            conn.close()

@student_api_bp.route('/auth/check-email', methods=['POST'])
def check_email():
    data = request.get_json() or {}
    email = data.get('email', '').strip()
    
    try:
        conn = get_db()
        cur = conn.cursor()
        applicant_email_table = get_applicant_email_table(cur)
        
        cur.execute(f"SELECT 1 FROM {applicant_email_table} WHERE email_address ILIKE %s", (email,))
        exists = cur.fetchone() is not None
        
        return jsonify({
            "available": not exists,
            "exists": exists,
            "message": "Email is already registered" if exists else "Email is available"
        })
    except Exception as exc:
        return jsonify({'message': str(exc)}), 500
    finally:
        if 'conn' in locals():
            conn.close()

@student_api_bp.route('/auth/register', methods=['POST'])
def register():
    data = request.get_json() or {}
    email = data.get('email', '').strip()
    password = data.get('password', '')
    
    if not email or not password:
        return jsonify({'message': 'Email and password are required'}), 400

    try:
        conn = get_db()
        cur = conn.cursor()
        applicant_email_table = get_applicant_email_table(cur)

        # Check if already exists in applicant_email or pending_registrations
        cur.execute(f"SELECT 1 FROM {applicant_email_table} WHERE email_address ILIKE %s", (email,))
        if cur.fetchone():
            return jsonify({'message': 'Email already registered'}), 400
        cur.execute(f"SELECT 1 FROM pending_registrations WHERE email ILIKE %s", (email,))
        if cur.fetchone():
            return jsonify({'message': 'Registration already pending for this email'}), 400

        password_hash = bcrypt.generate_password_hash(password).decode('utf-8')

        # Accept profile fields if provided
        first_name = data.get('first_name', None)
        last_name = data.get('last_name', None)
        middle_name = data.get('middle_name', None)
        profile_picture = data.get('profile_picture', None)

        cur.execute(
            """
            INSERT INTO pending_registrations (email, password_hash, first_name, last_name, middle_name, profile_picture)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (email, password_hash, first_name, last_name, middle_name, profile_picture)
        )
        conn.commit()

        # Send registration email
        try:
            from services.email_service import send_registration_email
            send_registration_email(email, first_name)
        except Exception as e:
            print(f"[EMAIL ERROR] Could not send registration email: {e}")

        return jsonify({"status": "ok", "message": "Registration submitted. Please complete your profile to finish registration."})
    except Exception as exc:
        return jsonify({'message': str(exc)}), 500
    finally:
        if 'conn' in locals():
            conn.close()

# --- Google OAuth Endpoints ---

@student_api_bp.route('/auth/google', methods=['POST'])
def google_auth():
    data = request.get_json()
    id_token_str = data.get('idToken')
    if not id_token_str:
        return jsonify({"error": "Missing idToken"}), 400

    try:
        GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID')
        idinfo = id_token.verify_oauth2_token(
            id_token_str,
            google_requests.Request(),
            GOOGLE_CLIENT_ID
        )
        email = idinfo.get('email')
        
        conn = get_db()
        cur = conn.cursor()
        applicant_email_table = get_applicant_email_table(cur)
        
        cur.execute(f"SELECT applicant_no FROM {applicant_email_table} WHERE email_address ILIKE %s", (email,))
        user = cur.fetchone()
        
        if not user:
             # Auto-register Google users if they don't exist? (Based on main backend logic)
             return jsonify({'message': 'Google account not registered as an applicant.'}), 401

        payload = {
            'exp': datetime.utcnow() + timedelta(days=7),
            'iat': datetime.utcnow(),
            'user_no': user['applicant_no'],
        }
        token = jwt.encode(payload, SECRET_KEY, algorithm='HS256')

        return jsonify({
            "token": token,
            "email": email,
            "applicant_no": user['applicant_no'],
            "status": "ok"
        })
    except Exception as e:
        return jsonify({"error": f"Google auth failed: {str(e)}"}), 401
    finally:
        if 'conn' in locals():
            conn.close()

# --- Placeholder Routes for common portal features ---

from flask import g
import jwt
def get_jwt_identity():
    auth_header = request.headers.get('Authorization', None)
    if not auth_header or not auth_header.startswith('Bearer '):
        return None
    token = auth_header.split(' ')[1]
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
        return payload.get('user_no')
    except Exception:
        return None

@student_api_bp.route('/applicant/profile', methods=['GET', 'PUT'])
def applicant_profile():
    user_no = get_jwt_identity()
    if not user_no:
        return jsonify({'message': 'Unauthorized'}), 401

    try:
        conn = get_db()
        cur = conn.cursor()
        applicant_email_table = get_applicant_email_table(cur)

        if request.method == 'GET':
            cur.execute(f"SELECT email_address, first_name, last_name, middle_name, profile_picture FROM {applicant_email_table} WHERE applicant_no = %s", (user_no,))
            profile = cur.fetchone()
            if not profile:
                return jsonify({'message': 'Profile not found'}), 404
            return jsonify(profile)

        elif request.method == 'PUT':
            data = request.get_json() or {}
            first_name = data.get('first_name')
            last_name = data.get('last_name')
            middle_name = data.get('middle_name')
            profile_picture = data.get('profile_picture')
            cur.execute(
                f"UPDATE {applicant_email_table} SET first_name=%s, last_name=%s, middle_name=%s, profile_picture=%s WHERE applicant_no=%s",
                (first_name, last_name, middle_name, profile_picture, user_no)
            )
            conn.commit()
            return jsonify({'status': 'ok', 'message': 'Profile updated'})
    except Exception as exc:
        return jsonify({'message': str(exc)}), 500
    finally:
        if 'conn' in locals():
            conn.close()

@student_api_bp.route('/scholarships/all', methods=['GET'])
def get_scholarships():
    try:
        conn = get_db()
        cur = conn.cursor()
        # requirements column does not exist, using desc as description
        cur.execute('SELECT req_no, scholarship_name, deadline, gpa, parent_finance, location, "desc" as description, semester, year FROM scholarships WHERE COALESCE(is_removed, FALSE) = FALSE ORDER BY scholarship_name')
        rows = cur.fetchall()
        return jsonify(rows)
    except Exception as e:
        print(f"[ERROR] get_scholarships failed: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        if 'conn' in locals():
            conn.close()

@student_api_bp.route('/applications/my-applications', methods=['GET'])
def get_my_applications():
    return jsonify({"applications": []})
