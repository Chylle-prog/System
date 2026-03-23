import sys
import os
from flask import Blueprint, request, jsonify, send_file
from flask_cors import CORS
from flask_bcrypt import Bcrypt
from functools import wraps
from flask_socketio import emit, join_room
import jwt
from datetime import datetime, timedelta
import psycopg2
import base64
from cryptography.fernet import Fernet
from io import BytesIO
import traceback

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_DIR not in sys.path:
    sys.path.append(PROJECT_DIR)

from project_config import get_db

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

def get_applicant_media_metadata(applicant_no, column_name, has_data, name="document"):
    """Return the media metadata with a URL instead of embedded base64 data for performance."""
    if not has_data:
        return []
    return [{
        'src': f'/api/applicant-image/{applicant_no}/{column_name}',
        'type': 'image/jpeg',
        'name': f"{name} (Lazy Loaded)"
    }]

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

api_bp = Blueprint('api', __name__, url_prefix='/api')
bcrypt = Bcrypt()

# ===== JWT CONFIG =====
SECRET_KEY = os.environ.get('SECRET_KEY')
TOKEN_EXPIRY = 24  # hours

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

def bytes_to_data_url(byte_data, mime='image/jpeg'):
    """Convert binary data to base64 data URL."""
    if not byte_data:
        return None
    try:
        if hasattr(byte_data, 'tobytes'):
            byte_data = byte_data.tobytes()
        b64 = base64.b64encode(byte_data).decode('utf-8')
        return f'data:{mime};base64,{b64}'
    except Exception:
        return None

# ===== DECORATORS =====

def token_required(f):
    """Require valid JWT token"""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        
        # Check for token in Authorization header
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            try:
                token = auth_header.split(" ")[1]
            except IndexError:
                return jsonify({'message': 'Invalid token format'}), 401
        
        if not token:
            return jsonify({'message': 'Token is missing'}), 401
        
        try:
            data = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
            current_user = data['user_id']
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid token'}), 401
        
        return f(current_user, *args, **kwargs)
    
    return decorated

def generate_token(user_id, role):
    """Generate JWT token"""
    payload = {
        'user_id': user_id,
        'role': role,
        'iat': datetime.utcnow(),
        'exp': datetime.utcnow() + timedelta(hours=TOKEN_EXPIRY)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm='HS256')

# ===== CHAT SOCKET EVENTS =====

def initialize_auto_chat_rooms():
    """Create initial chat rooms for all pending/accepted applicants and their providers"""
    conn = None
    cursor = None
    try:
        conn = get_db()
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
    
    # Run once on initialization
    initialize_auto_chat_rooms()

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
                    """, (pro_no,))
                    relevant_pairs = cursor.fetchall()
                    rooms = [f"{p['applicant_no']}+{p['pro_no']}" for p in relevant_pairs]
                else:
                    # Super admin - can see all rooms with messages
                    cursor.execute("SELECT DISTINCT room FROM message WHERE room IS NOT NULL")
                    rooms = [row['room'] for row in cursor.fetchall()]
            else:
                # Student (Scholar) room format: applicant_id+pro_no
                # Find all scholarships student applied to
                cursor.execute("""
                    SELECT DISTINCT ast.applicant_no, s.pro_no 
                    FROM applicant_status ast
                    JOIN scholarships s ON ast.scholarship_no = s.req_no
                    WHERE ast.applicant_no = %s
                """, (user_id,))
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
            cursor.execute("""
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
                ORDER BY m.timestamp ASC 
                LIMIT 100
            """, (app_no, pro_no))
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
            
            # Determine the sender's actual name from the database
            actual_username = username
            
            # Check if sender is the applicant
            cursor.execute("SELECT first_name FROM applicants WHERE applicant_no = %s", (sender_id,))
            app_row = cursor.fetchone()
            if app_row:
                actual_username = app_row['first_name']
            else:
                # Check if sender is a provider/admin
                cursor.execute("SELECT user_name FROM users WHERE user_no = %s", (sender_id,))
                user_row = cursor.fetchone()
                if user_row:
                    actual_username = user_row['user_name']
            
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
        except Exception as e:
            print(f"Error saving message: {e}")

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
        
        # Query user from database based on email table joining with user and scholarship_providers
        cursor.execute('''
            SELECT e.password_hash, e.applicant_no, e.user_no, e.is_locked, u.user_name, u.pro_no, p.provider_name
            FROM email e
            LEFT JOIN users u ON e.user_no = u.user_no
            LEFT JOIN scholarship_providers p ON u.pro_no = p.pro_no
            WHERE e.email_address ILIKE %s
        ''', (data['email'],))
        user = cursor.fetchone()
        cursor.close()
        conn.close()
        
        if not user or user['applicant_no'] is not None or user['user_no'] is None:
            # Users with applicant_no are applicants, disregarding them entirely
            return jsonify({'message': "Email not found"}), 404
        
        if not bcrypt.check_password_hash(user['password_hash'], data['password']):
            return jsonify({'message': 'Incorrect password'}), 401
        
        # Check if account is locked
        if user.get('is_locked'):
            return jsonify({'message': 'Account is locked. Please contact administrator.'}), 403
        
        # Normalize role for frontend routing
        prov_name = (user['provider_name'] or '').strip()
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
        
        user_name = user['user_name'] or prov_name
        
        # Generate JWT token
        token = generate_token(user['user_no'], normalized_role)
        
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
    """Check if email is already registered"""
    data = request.get_json()
    if not data or not data.get('email'):
        return jsonify({'message': 'Email is required'}), 400
    
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT 1 FROM email WHERE email_address ILIKE %s", (data['email'],))
        exists = cursor.fetchone() is not None
        cursor.close()
        conn.close()
        
        return jsonify({
            'exists': exists,
            'message': 'Email already registered' if exists else 'Email available'
        }), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500

@api_bp.route('/auth/register', methods=['POST'])
def register():
    """Register endpoint - create new user"""
    data = request.get_json()
    
    required_fields = ['fullName', 'email', 'username', 'password', 'role']
    if not all(key in data for key in required_fields):
        return jsonify({'message': 'Missing required fields'}), 400
    
    try:
        # Hash password
        password_hash = bcrypt.generate_password_hash(data['password']).decode('utf-8')
        
        conn = get_db()
        cursor = conn.cursor()
        
        # 1. Find or create scholarship provider
        cursor.execute("SELECT pro_no FROM scholarship_providers WHERE provider_name ILIKE %s", (data['role'],))
        provider = cursor.fetchone()
        
        if not provider:
            cursor.execute("INSERT INTO scholarship_providers (provider_name) VALUES (%s) RETURNING pro_no", (data['role'],))
            pro_no = cursor.fetchone()['pro_no']
        else:
            pro_no = provider['pro_no']
            
        # 2. Insert into users table
        cursor.execute(
            "INSERT INTO users (pro_no, user_name) VALUES (%s, %s) RETURNING user_no",
            (pro_no, data['fullName'])
        )
        user_no = cursor.fetchone()['user_no']
        
        # 3. Insert into email table
        cursor.execute(
            "INSERT INTO email (email_address, password_hash, user_no) VALUES (%s, %s, %s) RETURNING em_no",
            (data['email'], password_hash, user_no)
        )
        em_no = cursor.fetchone()['em_no']
        
        conn.commit()
        cursor.close()
        conn.close()
        
        return jsonify({
            'success': True,
            'message': 'User registered successfully',
            'userId': em_no
        }), 201
    
    except psycopg2.IntegrityError:
        return jsonify({'message': 'Email already exists'}), 409
    except Exception as e:
        return jsonify({'message': f'Error: {str(e)}'}), 500

@api_bp.route('/auth/logout', methods=['POST'])
@token_required
def logout(current_user):
    """Logout endpoint - invalidate token (frontend should delete token)"""
    return jsonify({'message': 'Logged out successfully'}), 200

@api_bp.route('/auth/forgot-password', methods=['POST'])
def forgot_password():
    """Request password reset"""
    data = request.get_json()
    
    if not data or not data.get('email'):
        return jsonify({'message': 'Email is required'}), 400
    
    # TODO: Implement email sending with reset token
    return jsonify({'message': 'Password reset link sent to email'}), 200

@api_bp.route('/auth/reset-password', methods=['POST'])
def reset_password():
    """Reset password with token"""
    data = request.get_json()
    
    if not data or not data.get('token') or not data.get('newPassword'):
        return jsonify({'message': 'Token and new password are required'}), 400
    
    # TODO: Verify token and update password
    return jsonify({'message': 'Password reset successfully'}), 200

@api_bp.route('/auth/verify-email', methods=['POST'])
def verify_email():
    """Verify email with token"""
    data = request.get_json()
    
    if not data or not data.get('token'):
        return jsonify({'message': 'Verification token is required'}), 400
    
    # TODO: Verify token and mark email as verified
    return jsonify({'message': 'Email verified successfully'}), 200

# ===== ADMIN ENDPOINTS =====

@api_bp.route('/admin/accounts', methods=['GET'])
@token_required
def get_accounts(current_user):
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
            WHERE 1=1
        '''
        params = []
        
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

@api_bp.route('/admin/accounts', methods=['POST'])
@token_required
def create_account(current_user):
    """Create new user account"""
    data = request.get_json()
    
    required_fields = ['email', 'password', 'role', 'firstName', 'lastName']
    if not all(key in data for key in required_fields):
        return jsonify({'message': 'Missing required fields'}), 400
    
    try:
        password_hash = bcrypt.generate_password_hash(data['password']).decode('utf-8')
        
        conn = get_db()
        cursor = conn.cursor()
        
        role = data.get('role', 'scholar').lower()
        
        # 1. Find or create scholarship provider based on 'scholarship' field or 'role'
        provider_name = data.get('scholarship', data.get('role', 'All'))
        cursor.execute("SELECT pro_no FROM scholarship_providers WHERE provider_name ILIKE %s", (provider_name,))
        provider = cursor.fetchone()
        
        if not provider:
            cursor.execute("INSERT INTO scholarship_providers (provider_name) VALUES (%s) RETURNING pro_no", (provider_name,))
            pro_no = cursor.fetchone()['pro_no']
        else:
            pro_no = provider['pro_no']
            
        full_name = f"{data['firstName']} {data['lastName']}"
        account_id = None
        
        if role == 'admin':
            # 2a. Insert into users table
            cursor.execute(
                "INSERT INTO users (pro_no, user_name) VALUES (%s, %s) RETURNING user_no",
                (pro_no, full_name)
            )
            user_no = cursor.fetchone()['user_no']
            
            # 3a. Insert into email table
            cursor.execute(
                "INSERT INTO email (email_address, password_hash, user_no) VALUES (%s, %s, %s) RETURNING em_no",
                (data['email'], password_hash, user_no)
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
                (data['email'], password_hash, applicant_no)
            )
            account_id = cursor.fetchone()['em_no']
        
        conn.commit()
        cursor.close()
        conn.close()
        
        return jsonify({'success': True, 'account': {'id': account_id, 'email': data['email'], 'name': full_name}}), 201
    
    except Exception as e:
        return jsonify({'message': f'Error: {str(e)}'}), 500
    
    except Exception as e:
        return jsonify({'message': f'Error: {str(e)}'}), 500

@api_bp.route('/admin/accounts/<int:account_id>', methods=['PUT'])
@token_required
def update_account(current_user, account_id):
    """Update user account"""
    data = request.get_json()
    
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Get user_no or applicant_no from email table
        cursor.execute("SELECT user_no, applicant_no FROM email WHERE em_no = %s", (account_id,))
        email_record = cursor.fetchone()
        
        if not email_record:
            return jsonify({'message': 'Account not found'}), 404
            
        if email_record['user_no']:
            # Update user table
            if 'name' in data or 'firstName' in data or 'lastName' in data:
                name = data.get('name') or f"{data.get('firstName', '')} {data.get('lastName', '')}".strip()
                if name:
                    cursor.execute("UPDATE users SET user_name = %s WHERE user_no = %s", (name, email_record['user_no']))
                    
        # Update email table
        if 'email' in data:
            cursor.execute("UPDATE email SET email_address = %s WHERE em_no = %s", (data['email'], account_id))
            
        conn.commit()
        cursor.close()
        conn.close()
        
        return jsonify({'success': True, 'message': 'Account updated'}), 200
    
    except Exception as e:
        return jsonify({'message': f'Error: {str(e)}'}), 500

@api_bp.route('/admin/accounts/<int:account_id>', methods=['DELETE'])
@token_required
def delete_account(current_user, account_id):
    """Delete user account"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
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
        
        return jsonify({'success': True, 'message': 'Account deleted'}), 200
    
    except Exception as e:
        return jsonify({'message': f'Error: {str(e)}'}), 500

@api_bp.route('/accounts/<int:account_id>/lock', methods=['PUT'])
@token_required
def toggle_account_lock(current_user, account_id):
    """Lock or unlock a user account"""
    data = request.get_json()
    if not data or 'locked' not in data:
        return jsonify({'message': 'Missing locked field'}), 400
    
    try:
        conn = get_db()
        cursor = conn.cursor()
        
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
        return jsonify({'success': True, 'message': f'Account {status}'}), 200
    
    except Exception as e:
        return jsonify({'message': f'Error: {str(e)}'}), 500

@api_bp.route('/admin/statistics', methods=['GET'])
@token_required
def get_statistics(current_user):
    """Get dashboard statistics"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Get total users
        cursor.execute('SELECT COUNT(*) as total FROM email')
        total_users = cursor.fetchone()['total']
        
        # Get users by role
        cursor.execute('''
            SELECT CASE WHEN user_no IS NOT NULL THEN 'admin' ELSE 'scholar' END as role, 
                   COUNT(*) as count 
            FROM email GROUP BY CASE WHEN user_no IS NOT NULL THEN 'admin' ELSE 'scholar' END
        ''')
        by_role = cursor.fetchall()
        
        # Get total applications
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

@api_bp.route('/admin/logs', methods=['GET'])
@token_required
def get_activity_logs(current_user):
    """Get dashboard activity logs from live database tables."""
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
        event_date_expr = 'COALESCE(ast.status_updated, NOW())' if has_status_updated else 'NOW()'

        logs = []

        cursor.execute(
            f'''
            SELECT
                ast.stat_no AS id,
                COALESCE(a.first_name || ' ' || a.last_name, 'Unknown Applicant') AS user_name,
                CASE
                    WHEN ast.is_accepted IS TRUE THEN 'Application Accepted'
                    WHEN ast.is_accepted IS FALSE THEN 'Application Rejected'
                    ELSE 'Application Submitted'
                END AS activity,
                CASE
                    WHEN ast.is_accepted IS TRUE THEN 'success'
                    WHEN ast.is_accepted IS FALSE THEN 'failed'
                    ELSE 'pending'
                END AS status,
                COALESCE(s.scholarship_name, p.provider_name, 'Unassigned') AS scholarship,
                {event_date_expr} AS event_date
            FROM applicant_status ast
            LEFT JOIN applicants a ON ast.applicant_no = a.applicant_no
            LEFT JOIN scholarships s ON ast.scholarship_no = s.req_no
            LEFT JOIN scholarship_providers p ON s.pro_no = p.pro_no
            ORDER BY {event_date_expr} DESC, ast.stat_no DESC
            LIMIT 250
            '''
        )

        for row in cursor.fetchall():
            logs.append({
                'id': f"status-{row['id']}",
                'user': row['user_name'],
                'activity': row['activity'],
                'status': row['status'],
                'scholarship': row['scholarship'],
                'date': row['event_date'].strftime('%Y-%m-%d %H:%M') if row['event_date'] else None,
            })

        cursor.execute(
            '''
            SELECT
                m.m_id AS id,
                m.username,
                m.message,
                m.timestamp,
                split_part(m.room, '+', 2)::int AS provider_no,
                p.provider_name
            FROM message m
            LEFT JOIN scholarship_providers p ON p.pro_no = split_part(m.room, '+', 2)::int
            WHERE m.timestamp IS NOT NULL
            ORDER BY m.timestamp DESC, m.m_id DESC
            LIMIT 100
            '''
        )

        for row in cursor.fetchall():
            preview = (row['message'] or '').strip()
            if len(preview) > 60:
                preview = preview[:57] + '...'
            logs.append({
                'id': f"message-{row['id']}",
                'user': row['username'] or 'Unknown User',
                'activity': f"Message Sent{': ' + preview if preview else ''}",
                'status': 'success',
                'scholarship': row['provider_name'] or (f"Provider #{row['provider_no']}" if row['provider_no'] else 'Direct Message'),
                'date': row['timestamp'].strftime('%Y-%m-%d %H:%M') if row['timestamp'] else None,
            })

        def matches_filters(log):
            program = filters.get('program')
            action = filters.get('action')
            search = (filters.get('search') or '').strip().lower()

            if program and program != 'All' and log['scholarship'] != program:
                return False

            if action and action != 'All' and action.lower() not in (log['activity'] or '').lower():
                return False

            if search:
                haystack = ' '.join([
                    str(log.get('user') or ''),
                    str(log.get('activity') or ''),
                    str(log.get('scholarship') or ''),
                ]).lower()
                if search not in haystack:
                    return False

            return True

        filtered_logs = [log for log in logs if matches_filters(log)]

        filtered_logs.sort(key=lambda log: log.get('date') or '', reverse=True)

        cursor.close()
        conn.close()

        return jsonify({'success': True, 'logs': filtered_logs}), 200

    except Exception as e:
        return jsonify({'message': f'Error: {str(e)}'}), 500

@api_bp.route('/scholarships/<program>', methods=['GET'])
def get_scholarship_by_program(program):
    """Get scholarship data for a program (provider) - returns metadata and base64-encoded images"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Query scholarships with image data
        query = '''
            SELECT s.req_no as id, s.req_no as "reqNo", s.scholarship_name as "scholarshipName", 
                   s.gpa as "minGpa", s.location, s.parent_finance as "parentFinance",
                   s.slots, s.deadline, s.pro_no as "proNo", p.provider_name as "providerName",
                   s."desc" as description, s.date_created as "dateCreated", si.sch_img_no as image_id
            FROM scholarships s
            LEFT JOIN scholarship_providers p ON s.pro_no = p.pro_no
            LEFT JOIN scholarship_images si ON s.req_no = si.req_no
            WHERE p.provider_name ILIKE %s OR (s.pro_no IS NULL AND %s != 'all')
            ORDER BY s.req_no, si.sch_img_no
        '''
        
        cursor.execute(query, (f"%{program}%", program))
        rows = cursor.fetchall()
        cursor.close()
        conn.close()
        
        if not rows:
            return jsonify({'success': True, 'scholarships': []}), 200
        
        # Group images by scholarship - return absolute URLs
        scholarships_dict = {}
        for row in rows:
            row_dict = dict(row)
            req_no = row_dict['reqNo']
            image_id = row_dict.pop('image_id', None)
            
            # Initialize scholarship if not seen before
            if req_no not in scholarships_dict:
                scholarships_dict[req_no] = row_dict
                scholarships_dict[req_no]['scholarshipImages'] = []
            
            # Add image URL if present
            if image_id:
                # Create absolute URL to the image endpoint dynamically
                base_url = request.host_url.rstrip('/')
                image_url = f"{base_url}/api/scholarship-image/{req_no}/{len(scholarships_dict[req_no]['scholarshipImages'])}"
                scholarships_dict[req_no]['scholarshipImages'].append(image_url)
        
        result = list(scholarships_dict.values())
        return jsonify({'success': True, 'scholarships': result}), 200
    
    except Exception as e:
        print(f"[SCHOLARSHIP API] Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'message': f'Error: {str(e)}'}), 500


@api_bp.route('/applicants/<program>', methods=['GET'])
def get_applicants(program):
    """Get applicants for a program"""
    try:
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
                   s.is_accepted, p.provider_name as program,
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
                    (a.signature_image_data IS NOT NULL) as "has_signature"
            FROM public.applicants a
            INNER JOIN public.applicant_status s ON a.applicant_no = s.applicant_no
            INNER JOIN public.scholarships esc ON s.scholarship_no = esc.req_no
            INNER JOIN public.scholarship_providers p ON esc.pro_no = p.pro_no
            LEFT JOIN public.email e ON a.applicant_no = e.applicant_no
            WHERE 1=1
        '''
        params = []
        
        if program.lower() != 'all':
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
        
        # Convert rows to plain dicts and provide URLs for binary data
        result = []
        for row in applicants:
            a = dict(row)
            app_no = a['id'] # 'id' is aliased from 'applicant_no'

            # Manage signature as a lazy-loaded URL too
            if a.get('has_signature'):
                a['signature'] = f'/api/applicant-image/{app_no}/signature_image_data'
            else:
                a['signature'] = None
            
            # Ensure income is float (might be Decimal from DB)
            if a.get('income') is not None:
                try:
                    a['income'] = float(a['income'])
                except (ValueError, TypeError):
                    pass
            
            # Convert document blobs to media arrays (Optimized: use URLs)
            a['indigencyFiles'] = get_applicant_media_metadata(app_no, 'indigency_doc', a.get('has_indigency_doc'), "Indigency Proof")
            a['certificateFiles'] = get_applicant_media_metadata(app_no, 'enrollment_certificate_doc', a.get('has_enrollment_certificate_doc'), "Enrollment Certificate")
            a['gradesFiles'] = get_applicant_media_metadata(app_no, 'grades_doc', a.get('has_grades_doc'), "Grades / Transcript")
            
            # Combine all ID images into idFiles (Optimized: use URLs)
            id_files = []
            if a.get('has_schoolID_photo'): 
                id_files.extend(get_applicant_media_metadata(app_no, 'schoolID_photo', True, "School ID"))
            if a.get('has_id_img_front'): 
                id_files.extend(get_applicant_media_metadata(app_no, 'id_img_front', True, "ID Front"))
            if a.get('has_id_img_back'): 
                id_files.extend(get_applicant_media_metadata(app_no, 'id_img_back', True, "ID Back"))
            if a.get('has_id_pic'): 
                id_files.extend(get_applicant_media_metadata(app_no, 'id_pic', True, "ID Photo"))
            if a.get('has_profile_picture'): 
                id_files.extend(get_applicant_media_metadata(app_no, 'profile_picture', True, "Profile Picture"))
            
            a['idFiles'] = id_files
            
            result.append(a)
        
        return jsonify({'success': True, 'applicants': result}), 200
    
    except Exception as e:
        return jsonify({'message': f'Error: {str(e)}'}), 500

@api_bp.route('/applicants/<program>', methods=['POST'])
@token_required
def create_applicant(current_user, program):
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
def get_rankings(program):
    """Get rankings for a program"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute(
            'SELECT * FROM rankings WHERE program = %s ORDER BY rank ASC',
            (program.lower(),)
        )
        rankings = cursor.fetchall()
        cursor.close()
        conn.close()
        
        return jsonify({'success': True, 'rankings': rankings}), 200
    
    except Exception as e:
        return jsonify({'message': f'Error: {str(e)}'}), 500

@api_bp.route('/rankings/<program>/rank', methods=['POST'])
@token_required
def submit_ranking(current_user, program):
    """Submit ranking/scoring for applicants"""
    # TODO: Implement ranking logic using existing scoring functions
    return jsonify({'success': True, 'message': 'Rankings submitted'}), 200

@api_bp.route('/scholarships', methods=['POST'])
@token_required
def create_scholarship(current_user):
    """Create new scholarship post"""
    data = request.get_json()
    
    required_fields = ['scholarshipName', 'minGpa', 'slots', 'deadline', 'parentFinance', 'location']
    if not all(key in data for key in required_fields):
        return jsonify({'message': 'Missing required fields'}), 400
    
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # 1. Get pro_no for current_user (user_no)
        cursor.execute("SELECT pro_no FROM users WHERE user_no = %s", (current_user,))
        user_record = cursor.fetchone()
        
        if not user_record or not user_record['pro_no']:
            return jsonify({'message': 'User not associated with a scholarship provider'}), 403
            
        pro_no = user_record['pro_no']
        
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
            pro_no,
            data['slots'],
            data['deadline'],
            data.get('description', ''),
            data.get('semester', ''),
            data.get('year', '')
        ))
        
        new_scholarship = cursor.fetchone()
        req_no = new_scholarship['req_no']
        
        # 3. Handle scholarship images
        if 'scholarshipImages' in data and isinstance(data['scholarshipImages'], list):
            for i, img_data in enumerate(data['scholarshipImages']):
                url = img_data.get('url') if isinstance(img_data, dict) else img_data
                img_bytes = base64_to_bytes(url)
                if img_bytes:
                    print(f"[SCHOLARSHIP CREATE] Image {i}: Decoded {len(img_bytes)} bytes")
                    # Encrypt image before storing
                    encrypted = _fernet.encrypt(img_bytes) if _fernet else img_bytes
                    cursor.execute(
                        "INSERT INTO scholarship_images (req_no, img) VALUES (%s, %s)",
                        (req_no, encrypted)
                    )
                else:
                    print(f"[SCHOLARSHIP CREATE] Skipping image {i}: invalid base64 or URL")
        
        conn.commit()
        cursor.close()
        conn.close()
        
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
def update_scholarship(current_user, req_no):
    """Update scholarship post"""
    data = request.get_json()
    
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # 1. Get user's provider info
        cursor.execute("""
            SELECT u.pro_no, p.provider_name 
            FROM users u 
            LEFT JOIN scholarship_providers p ON u.pro_no = p.pro_no 
            WHERE u.user_no = %s
        """, (current_user,))
        user_row = cursor.fetchone()
        if not user_row:
            return jsonify({'message': 'User not found'}), 404
        
        user_pro_no = user_row['pro_no']
        is_admin = user_row['provider_name'] and 'admin' in user_row['provider_name'].lower()
        
        # 2. Check scholarship ownership
        cursor.execute("SELECT pro_no FROM scholarships WHERE req_no = %s", (req_no,))
        sch_row = cursor.fetchone()
        if not sch_row:
            return jsonify({'message': 'Scholarship not found'}), 404
            
        # Allow update if user is Admin OR pro_no matches OR if existing scholarship has NO pro_no
        if not is_admin and sch_row['pro_no'] is not None and user_pro_no is not None and sch_row['pro_no'] != user_pro_no:
            return jsonify({'message': 'Unauthorized'}), 401

        # 3. Handle orphaned scholarships
        if not is_admin and sch_row['pro_no'] is None and user_pro_no is not None:
            cursor.execute("UPDATE scholarships SET pro_no = %s WHERE req_no = %s", (user_pro_no, req_no))
             
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
            'semester': 'semester',
            'year': 'year'
        }
        
        for json_key, db_col in field_map.items():
            if json_key in data:
                update_fields.append(f"{db_col} = %s")
                params.append(data[json_key])

        if update_fields:
            params.append(req_no)
            query = f"UPDATE scholarships SET {', '.join(update_fields)} WHERE req_no = %s"
            cursor.execute(query, params)
        
        # 5. Handle scholarship images - Smart Update
        if 'scholarshipImages' in data and isinstance(data['scholarshipImages'], list):
            # Fetch current images to potentially keep them
            cursor.execute("SELECT img FROM scholarship_images WHERE req_no = %s ORDER BY sch_img_no", (req_no,))
            existing_rows = cursor.fetchall()
            existing_images = [row['img'] for row in existing_rows]
            
            new_image_data_list = []
            
            for i, img_data in enumerate(data['scholarshipImages']):
                url = img_data.get('url') if isinstance(img_data, dict) else img_data
                
                if url.startswith('data:'):
                    # This is a NEW image being uploaded as base64
                    img_bytes = base64_to_bytes(url)
                    if img_bytes:
                        encrypted = _fernet.encrypt(img_bytes) if _fernet else img_bytes
                        new_image_data_list.append(encrypted)
                        print(f"[SCHOLARSHIP UPDATE] Image {i}: Using new base64 data")
                elif '/api/scholarship-image/' in url:
                    # This is an EXISTING image URL
                    # Extract index from URL: /api/scholarship-image/{req_no}/{idx}
                    try:
                        idx_str = url.split('/')[-1]
                        idx = int(idx_str)
                        if 0 <= idx < len(existing_images):
                            # Keep the existing encrypted bytes as is
                            new_image_data_list.append(existing_images[idx])
                            print(f"[SCHOLARSHIP UPDATE] Image {i}: Keeping existing image at index {idx}")
                        else:
                            print(f"[SCHOLARSHIP UPDATE] Image {i}: Existing index {idx} out of range")
                    except Exception as e:
                        print(f"[SCHOLARSHIP UPDATE] Image {i}: Failed to parse existing URL: {e}")
                else:
                    print(f"[SCHOLARSHIP UPDATE] Image {i}: Skipping unrecognized URL: {url[:50]}...")
            
            # Now replace everything in the table
            cursor.execute("DELETE FROM scholarship_images WHERE req_no = %s", (req_no,))
            for encrypted_img in new_image_data_list:
                cursor.execute(
                    "INSERT INTO scholarship_images (req_no, img) VALUES (%s, %s)",
                    (req_no, encrypted_img)
                )
            print(f"[SCHOLARSHIP UPDATE] Processed {len(new_image_data_list)} images for scholarship {req_no}")
        
        conn.commit()
        cursor.close()
        conn.close()
        
        return jsonify({'success': True, 'message': 'Scholarship updated'}), 200
    
    except Exception as e:
        print(f"[SCHOLARSHIP UPDATE] Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'message': f'Error: {str(e)}'}), 500

@api_bp.route('/scholarships/<int:req_no>', methods=['DELETE'])
@token_required
def delete_scholarship(current_user, req_no):
    """Delete scholarship post"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # 1. Get user's provider info
        cursor.execute("""
            SELECT u.pro_no, p.provider_name 
            FROM users u 
            LEFT JOIN scholarship_providers p ON u.pro_no = p.pro_no 
            WHERE u.user_no = %s
        """, (current_user,))
        user_row = cursor.fetchone()
        if not user_row:
            return jsonify({'message': 'User not found'}), 404
        
        user_pro_no = user_row['pro_no']
        is_admin = user_row['provider_name'] and 'admin' in user_row['provider_name'].lower()
        
        # 2. Check scholarship ownership
        cursor.execute("SELECT pro_no FROM scholarships WHERE req_no = %s", (req_no,))
        sch_row = cursor.fetchone()
        if not sch_row:
            return jsonify({'message': 'Scholarship not found'}), 404
            
        # Allow delete if user is Admin OR pro_no matches OR if existing scholarship has NO pro_no
        if not is_admin and sch_row['pro_no'] is not None and user_pro_no is not None and sch_row['pro_no'] != user_pro_no:
            return jsonify({'message': 'Unauthorized'}), 401
            
        # 3. Delete entries in applicant_status first (foreign key)
        cursor.execute("DELETE FROM applicant_status WHERE scholarship_no = %s", (req_no,))
        
        # 3. Delete scholarship
        cursor.execute("DELETE FROM scholarships WHERE req_no = %s", (req_no,))
        
        conn.commit()
        cursor.close()
        conn.close()
        
        return jsonify({'success': True, 'message': 'Scholarship deleted'}), 200
        
    except Exception as e:
        return jsonify({'message': f'Error: {str(e)}'}), 500


@api_bp.route('/scholarship-image/<int:sch_img_no>', methods=['GET'])
def get_scholarship_image(sch_img_no):
    """Get scholarship image as binary file (not data URL)"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Get image from database
        cursor.execute("SELECT img FROM scholarship_images WHERE sch_img_no = %s", (sch_img_no,))
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
            print(f"[IMAGE ENDPOINT] Failed to decrypt image {sch_img_no}: {decrypt_error}")
            return jsonify({'message': 'Failed to decrypt image'}), 500
        
        # Detect image type from magic bytes
        if decrypted_img[:4] == b'\x89PNG':
            mime_type = 'image/png'
        elif decrypted_img[:2] == b'\xff\xd8':
            mime_type = 'image/jpeg'
        elif decrypted_img[:4] == b'GIF8':
            mime_type = 'image/gif'
        else:
            mime_type = 'application/octet-stream'
        
        # Return as binary file
        return send_file(
            BytesIO(decrypted_img),
            mimetype=mime_type,
            as_attachment=False,
            download_name=f'scholarship_image_{sch_img_no}.png'
        )
        
    except Exception as e:
        print(f"[IMAGE ENDPOINT] Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'message': f'Error: {str(e)}'}), 500


@api_bp.route('/scholarship-image/<int:req_no>/<int:idx>', methods=['GET'])
def get_scholarship_image_by_index(req_no, idx):
    """Get scholarship image by scholarship req_no and index"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Get image at the specified index for this scholarship
        cursor.execute("""
            SELECT sch_img_no, img 
            FROM scholarship_images 
            WHERE req_no = %s 
            ORDER BY sch_img_no 
            OFFSET %s LIMIT 1
        """, (req_no, idx))
        row = cursor.fetchone()
        cursor.close()
        conn.close()
        
        if not row or not row['img']:
            # Return 404 if image doesn't exist
            return jsonify({'message': f'Image not found for scholarship {req_no} at index {idx}'}), 404
        
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
            print(f"[IMAGE ENDPOINT] Failed to decrypt image for scholarship {req_no}: {decrypt_error}")
            return jsonify({'message': 'Failed to decrypt image'}), 500
        
        # Detect image type from magic bytes
        if decrypted_img[:4] == b'\x89PNG':
            mime_type = 'image/png'
        elif decrypted_img[:2] == b'\xff\xd8':
            mime_type = 'image/jpeg'
        elif decrypted_img[:4] == b'GIF8':
            mime_type = 'image/gif'
        else:
            mime_type = 'application/octet-stream'
        
        # Return as binary file
        return send_file(
            BytesIO(decrypted_img),
            mimetype=mime_type,
            as_attachment=False,
            download_name=f'scholarship_{req_no}_image_{idx}.png'
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
        if data[:4] == b'\x89PNG':
            mime_type = 'image/png'
        elif data[:2] == b'\xff\xd8':
            mime_type = 'image/jpeg'
        elif data[:4] == b'GIF8':
            mime_type = 'image/gif'
        elif data[:4] == b'%PDF':
            mime_type = 'application/pdf'
        else:
            mime_type = 'application/octet-stream'
        
        return send_file(
            BytesIO(data),
            mimetype=mime_type,
            as_attachment=False,
            download_name=f'applicant_{applicant_no}_{column_name}.png'
        )
        
    except Exception as e:
        print(f"[APPLICANT IMAGE] Error: {str(e)}")
        return jsonify({'message': f'Error: {str(e)}'}), 500

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
