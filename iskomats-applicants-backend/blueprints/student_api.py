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
def ensure_applicant_verification_columns():
    try:
        conn = get_db_startup()
        cur = conn.cursor()
        applicant_email_table = get_applicant_email_table(cur)
        
        # Check if columns exist
        cur.execute(f"""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = %s AND column_name IN ('is_verified', 'verification_code', 'is_locked')
        """, (applicant_email_table,))
        existing = {row['column_name'] if isinstance(row, dict) else row[0] for row in cur.fetchall()}
        
        if 'is_verified' not in existing:
            cur.execute(f"ALTER TABLE {applicant_email_table} ADD COLUMN is_verified BOOLEAN DEFAULT FALSE")
            cur.execute(f"UPDATE {applicant_email_table} SET is_verified = TRUE")
        
        if 'verification_code' not in existing:
            cur.execute(f"ALTER TABLE {applicant_email_table} ADD COLUMN verification_code VARCHAR(100)")
            
        if 'is_locked' not in existing:
            cur.execute(f"ALTER TABLE {applicant_email_table} ADD COLUMN is_locked BOOLEAN DEFAULT FALSE")
            
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
            SELECT app_em_no, applicant_no, password_hash, is_locked, is_verified
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
        
        # Check if already exists
        cur.execute(f"SELECT 1 FROM {applicant_email_table} WHERE email_address ILIKE %s", (email,))
        if cur.fetchone():
            return jsonify({'message': 'Email already registered'}), 400
            
        password_hash = bcrypt.generate_password_hash(password).decode('utf-8')
        
        # Simple registration for mockup/sync purposes
        # In the full system, this would involve verification codes
        cur.execute(
            f"INSERT INTO {applicant_email_table} (email_address, password_hash, is_verified) VALUES (%s, %s, %s) RETURNING app_em_no",
            (email, password_hash, True)
        )
        conn.commit()
        
        return jsonify({"status": "ok", "message": "Registration successful. You can now log in."})
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

@student_api_bp.route('/applicant/profile', methods=['GET', 'PUT'])
def applicant_profile():
    # In a real app, this would use the JWT token to identify the user
    return jsonify({"message": "Profile integration pending migrations"})

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
