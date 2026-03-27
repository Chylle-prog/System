"""
Flask API Routes for ISKOMATS Scholarship System
Provides JSON endpoints for React frontend integration
"""

import sys
import os
from flask import Blueprint, request, jsonify
from flask_cors import CORS
from flask_bcrypt import Bcrypt
from functools import wraps
from flask_socketio import emit, join_room
import jwt
from datetime import datetime, timedelta
import psycopg2
import base64
from io import BytesIO
import traceback
from project_config import get_db

api_bp = Blueprint('api', __name__, url_prefix='/api')
bcrypt = Bcrypt()

# Encryption setup (must match main app)
from cryptography.fernet import Fernet
ENCRYPTION_KEY = os.environ.get('ENCRYPTION_KEY')
if ENCRYPTION_KEY:
    if isinstance(ENCRYPTION_KEY, str):
        ENCRYPTION_KEY = ENCRYPTION_KEY.encode()
    fernet = Fernet(ENCRYPTION_KEY)
else:
    fernet = None

def decrypt_data(encrypted_data):
    if not encrypted_data or not fernet:
        return None
    try:
        return fernet.decrypt(bytes(encrypted_data))
    except Exception as e:
        print(f"Decryption error: {e}")
        return None

# ─── Auth Middleware ────────────────────────────────────────────
SECRET_KEY = os.environ.get('SECRET_KEY')
if not SECRET_KEY:
    # Fallback for development if strictly necessary, but ideally raise error
    SECRET_KEY = 'development-key-replace-in-production'

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization')
        if not token:
            return jsonify({'message': 'Token is missing'}), 401
        try:
            if token.startswith('Bearer '):
                token = token[7:]
            data = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
            # In this system, user_no is the primary identifier
            request.user_no = data.get('user_no')
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Token is invalid'}), 401
        return f(*args, **kwargs)
    return decorated

# ─── Socket.io State ───────────────────────────────────────────
_socketio = None

def init_socketio(socketio_instance):
    global _socketio
    _socketio = socketio_instance
    
    @_socketio.on('connect')
    def handle_connect():
        print("Socket client connected")

    @_socketio.on('login')
    def handle_login(data):
        token = data.get('token')
        if not token:
            emit('error', {'message': 'Token missing'})
            return
        
        try:
            # Decode token to get user/applicant identity
            decoded = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
            user_id = decoded.get('user_no')
            
            # Determine if this is an applicant or a provider/admin
            conn = get_db()
            cur = conn.cursor()
            
            # Check if it's an applicant
            cur.execute("SELECT applicant_no, first_name FROM applicants WHERE applicant_no = %s", (user_id,))
            applicant = cur.fetchone()
            
            rooms = []
            if applicant:
                # Find all rooms (scholarships) this applicant is in
                cur.execute("""
                    SELECT ast.scholarship_no as room, s.scholarship_name as provider_name
                    FROM applicant_status ast
                    JOIN scholarships s ON ast.scholarship_no = s.req_no
                    WHERE ast.applicant_no = %s
                """, (user_id,))
                user_rooms = cur.fetchall()
                for r in user_rooms:
                    join_room(str(r['room']))
                    rooms.append({'room': str(r['room']), 'provider_name': r['provider_name']})
            else:
                # Check if it's a provider
                cur.execute("SELECT pro_no, provider_name FROM scholarship_providers WHERE pro_no = %s", (user_id,))
                provider = cur.fetchone()
                if provider:
                    # Find all rooms for this provider
                    cur.execute("SELECT req_no as room FROM scholarships WHERE provider_no = %s", (user_id,))
                    provider_rooms = cur.fetchall()
                    for r in provider_rooms:
                        join_room(str(r['room']))
                        rooms.append({'room': str(r['room']), 'provider_name': provider['provider_name']})
            
            cur.close()
            conn.close()
            
            emit('logged_in', {
                'status': 'success',
                'user_id': user_id,
                'rooms': rooms
            })
            print(f"User {user_id} logged in and joined {len(rooms)} rooms")
            
        except Exception as e:
            print(f"Socket login error: {e}")
            emit('error', {'message': str(e)})

    @_socketio.on('message')
    def handle_message(data):
        room = str(data.get('room'))
        msg_text = data.get('message')
        username = data.get('username')
        sender_id = data.get('sender_id')  # ID of who is sending
        
        if room and msg_text and sender_id:
            try:
                # Save message to DB
                conn = get_db()
                cur = conn.cursor()
                
                # Determine the sender's actual name from the database
                actual_username = username
                applicant_no = None
                pro_no = None
                
                # Check if sender is an applicant
                cur.execute("SELECT first_name FROM applicants WHERE applicant_no = %s", (sender_id,))
                app_row = cur.fetchone()
                if app_row:
                    actual_username = app_row['first_name']
                    applicant_no = sender_id
                else:
                    # Check if sender is a provider
                    cur.execute("SELECT provider_name FROM scholarship_providers WHERE pro_no = %s", (sender_id,))
                    prov_row = cur.fetchone()
                    if prov_row:
                        actual_username = prov_row['provider_name']
                        pro_no = sender_id
                
                cur.execute("""
                    INSERT INTO message (room, message, applicant_no, pro_no, timestamp)
                    VALUES (%s, %s, %s, %s, %s)
                """, (room, msg_text, applicant_no, pro_no, datetime.now()))
                
                conn.commit()
                cur.close()
                conn.close()

                # Emit to all in room with the resolved username
                emit('message', {
                    'room': room,
                    'message': msg_text,
                    'username': actual_username,
                    'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                }, room=room)
                
            except Exception as e:
                print(f"Error saving/sending message: {e}")
                emit('error', {'message': 'Failed to send message'})

    @_socketio.on('load_history')
    def handle_load_history(data):
        room = str(data.get('room'))
        if room:
            try:
                conn = get_db()
                cur = conn.cursor()
                cur.execute("""
                    SELECT message, applicant_no, pro_no, timestamp 
                    FROM message 
                    WHERE room = %s 
                    ORDER BY timestamp ASC
                """, (room,))
                history = cur.fetchall()
                cur.close()
                conn.close()
                
                formatted_history = []
                for h in history:
                    sender = h['applicant_no'] if h['applicant_no'] else h['pro_no']
                    formatted_history.append({
                        'room': room,
                        'message': h['message'],
                        'username': sender,
                        'timestamp': h['timestamp'].strftime('%Y-%m-%d %H:%M:%S')
                    })
                
                # Send history back to the specific client
                for msg in formatted_history:
                    emit('message', msg)
                    
            except Exception as e:
                print(f"Error loading history: {e}")

    @_socketio.on('start_chat')
    def handle_start_chat(data):
        # Implementation for starting a new chat if needed
        pass


# ─── AUTH ENDPOINTS ──────────────────────────────────────────────

@api_bp.route('/auth/login', methods=['POST'])
def api_login():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Missing JSON data'}), 400
        
    email = data.get('email', '').strip()
    password = data.get('password', '')

    try:
        conn = get_db()
        cur = conn.cursor()
        
        cur.execute("""
            SELECT em_no, user_no, applicant_no, password_hash 
            FROM email 
            WHERE email_address ILIKE %s
        """, (email,))
        
        user = cur.fetchone()
        
        if not user or not bcrypt.check_password_hash(user['password_hash'], password):
            return jsonify({'message': 'Invalid credentials'}), 401
            
        # Determine payload
        payload = {
            'exp': datetime.utcnow() + timedelta(days=7),
            'iat': datetime.utcnow(),
            # Use user_no or applicant_no
            'user_no': user['applicant_no'] if user['applicant_no'] else user['user_no']
        }
        
        token = jwt.encode(payload, SECRET_KEY, algorithm="HS256")
        
        return jsonify({
            'token': token,
            'user_no': payload['user_no'],
            'applicant_no': user['applicant_no'],
            'is_applicant': bool(user['applicant_no'])
        })
        
    except Exception as e:
        return jsonify({'message': f'Error: {str(e)}'}), 500
    finally:
        if 'conn' in locals():
            conn.close()

@api_bp.route('/auth/register', methods=['POST'])
def api_register():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Missing JSON data'}), 400
        
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

        # Check if email already exists
        cur.execute("SELECT applicant_no FROM email WHERE email_address ILIKE %s LIMIT 1", (email,))
        if cur.fetchone():
            return jsonify({'message': 'Email already registered'}), 400

        # Create applicant
        cur.execute("""
            INSERT INTO applicants (first_name, middle_name, last_name)
            VALUES (%s, %s, %s)
            RETURNING applicant_no
        """, (first_name, middle_name or None, last_name))
        applicant_no = cur.fetchone()['applicant_no']

        # Create email/auth record
        password_hash = bcrypt.generate_password_hash(password).decode('utf-8')
        cur.execute("""
            INSERT INTO email (email_address, applicant_no, password_hash)
            VALUES (%s, %s, %s)
        """, (email, applicant_no, password_hash))
        
        conn.commit()
        
        # Generate token for immediate login
        payload = {
            'exp': datetime.utcnow() + timedelta(days=7),
            'iat': datetime.utcnow(),
            'user_no': applicant_no
        }
        token = jwt.encode(payload, SECRET_KEY, algorithm="HS256")

        return jsonify({
            'message': 'Registration successful',
            'token': token,
            'user_no': applicant_no,
            'is_applicant': True
        }), 201

    except Exception as e:
        return jsonify({'message': f'Error: {str(e)}'}), 500
    finally:
        if 'conn' in locals():
            conn.close()

@api_bp.route('/auth/check-email', methods=['POST'])
def api_check_email():
    data = request.get_json()
    email = data.get('email', '').strip()
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM email WHERE email_address ILIKE %s", (email,))
        exists = cur.fetchone()
        return jsonify({'available': not exists})
    except Exception as e:
        return jsonify({'message': str(e)}), 500
    finally:
        if 'conn' in locals():
            conn.close()

@api_bp.route('/auth/validate', methods=['GET'])
@token_required
def api_validate_token():
    return jsonify({'message': 'Token is valid', 'user_no': request.user_no})

# ─── SCHOLARSHIP ENDPOINTS ────────────────────────────────────────

@api_bp.route('/scholarships', methods=['GET'])
def get_scholarships():
    """Returns all scholarships - used by scholarshipAPI.getAll()"""

@api_bp.route('/scholarships/all', methods=['GET'])
def get_all_scholarships():
    """Returns all scholarships - used by scholarshipAPI.getAll()"""
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT * FROM scholarships ORDER BY scholarship_name")
        rows = cur.fetchall()
        return jsonify(rows)
    except Exception as e:
        return jsonify({'message': str(e)}), 500
    finally:
        if 'conn' in locals():
            conn.close()

@api_bp.route('/scholarships/<int:req_no>', methods=['GET'])
def get_scholarship_by_id(req_no):
    """Returns details for a single scholarship"""
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT * FROM scholarships WHERE req_no = %s", (req_no,))
        row = cur.fetchone()
        if not row:
            return jsonify({'message': 'Scholarship not found'}), 404
        return jsonify(row)
    except Exception as e:
        return jsonify({'message': str(e)}), 500
    finally:
        if 'conn' in locals():
            conn.close()

@api_bp.route('/scholarships/rankings', methods=['POST'])
def get_rankings():
    data = request.get_json()
    gpa = float(data.get('gpa', 0))
    income = float(data.get('income', 0))
    address = data.get('address', '').lower().strip()

    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT * FROM scholarships")
        scholarships = cur.fetchall()

        today = datetime.now().date()
        ranked = []

        for sch in scholarships:
            deadline = sch.get('deadline')
            if deadline and deadline < today:
                continue

            score = 0
            disqualified = False

            # GPA
            min_gpa = sch['gpa']
            if min_gpa is not None and gpa < min_gpa:
                disqualified = True
            elif min_gpa:
                score += min(60, (gpa - min_gpa) * 12)

            # Income
            max_inc = sch['parent_finance']
            if max_inc is not None and income > max_inc:
                disqualified = True
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
                    disqualified = True
            else:
                score += 10

            if not disqualified:
                ranked.append({
                    'req_no': sch['req_no'],
                    'name': sch['scholarship_name'],
                    'gpa': min_gpa,
                    'parent_finance': max_inc,
                    'location': loc,
                    'deadline': sch.get('deadline'),
                    'score': round(score)
                })

        ranked.sort(key=lambda x: -x['score'])
        return jsonify(ranked)

    except Exception as e:
        return jsonify({'message': str(e)}), 500
    finally:
        if 'conn' in locals():
            conn.close()

# ─── APPLICANT ENDPOINTS ─────────────────────────────────────────

@api_bp.route('/applicant/profile', methods=['GET'])
@token_required
def get_profile():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT * FROM applicants WHERE applicant_no = %s", (request.user_no,))
        applicant = cur.fetchone()
        if not applicant:
            return jsonify({'message': 'Not found'}), 404
            
        # Don't send binary data over JSON (memoryview is not serializable)
        for key, value in list(applicant.items()):
            if isinstance(value, (bytes, memoryview)):
                # Handle images that the frontend needs by converting to base64
                if key == 'profile_picture':
                    # Convert to data URI for frontend if it's an image
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
                # Ensure dates are serializable
                applicant[key] = value.isoformat()
            elif key == 'birthdate' and value:
                # Ensure DATE objects are strings
                applicant[key] = str(value)

        return jsonify(applicant)
    except Exception as e:
        return jsonify({'message': str(e)}), 500
    finally:
        if 'conn' in locals():
            conn.close()

@api_bp.route('/applicant/profile', methods=['PUT'])
@token_required
def update_profile():
    data = request.get_json(silent=True) or request.form.to_dict(flat=True)
    files_data = request.files
    try:
        conn = get_db()
        cur = conn.cursor()

        def add_update(db_col, value):
            updates.append(f"{db_col} = %s")
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
        
        # Map frontend field names to backend column names
        field_mapping = {
            'lastName': 'last_name', 'firstName': 'first_name', 'middleName': 'middle_name',
            'maidenName': 'maiden_name', 'dateOfBirth': 'birthdate', 'placeOfBirth': 'birth_place',
            'streetBarangay': 'street_brgy', 'townCity': 'town_city_municipality',
            'province': 'province', 'zipCode': 'zip_code', 'sex': 'sex',
            'citizenship': 'citizenship', 'schoolIdNumber': 'school_id_no',
            'schoolName': 'school', 'schoolAddress': 'school_address',
            'schoolSector': 'school_sector', 'mobileNumber': 'mobile_no',
            'yearLevel': 'year_lvl',
            'fatherPhoneNumber': 'father_phone_no', 'motherPhoneNumber': 'mother_phone_no',
            'fatherOccupation': 'father_occupation', 'motherOccupation': 'mother_occupation',
            'parentsGrossIncome': 'financial_income_of_parents', 'gpa': 'overall_gpa',
            'numberOfSiblings': 'sibling_no', 'course': 'course'
        }
        
        updates = []
        params = []
        
        # Handle regular text fields
        for frontend_key, db_col in field_mapping.items():
            if frontend_key in data:
                add_update(db_col, data[frontend_key])

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
        
        # Handle explicitly named DB columns if they are sent directly
        allowed_db_cols = ['first_name', 'middle_name', 'last_name', 'birthdate', 'school', 'mobile_no',
                          'overall_gpa', 'financial_income_of_parents', 'street_brgy', 
                          'town_city_municipality', 'province', 'zip_code', 'course', 'year_lvl']
        for col in allowed_db_cols:
            if col in data and col not in [v for k,v in field_mapping.items() if k in data]:
                add_update(col, data[col])

        # Special handling for binary/image fields (sent as base64 or multipart files)
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
            'signature_data': 'signature_image_data'
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
                try:
                    b64_data = data[field_key]
                    if isinstance(b64_data, str) and ',' in b64_data:
                        b64_data = b64_data.split(',')[1]
                    
                    if isinstance(b64_data, str):
                        blob_bytes = base64.b64decode(b64_data)
                        if field_key == 'signature_data' and blob_bytes and fernet:
                            blob_bytes = fernet.encrypt(blob_bytes)
                        add_update(db_col, blob_bytes)
                except Exception as e:
                    print(f"Error decoding binary field {field_key}: {e}")
        
        if not updates:
            return jsonify({'message': 'No changes provided'}), 200 # Success but nothing to do
            
        params.append(request.user_no)
        sql = f"UPDATE applicants SET {', '.join(updates)} WHERE applicant_no = %s"
        cur.execute(sql, tuple(params))
        conn.commit()
        
        return jsonify({'message': 'Progress saved successfully'})
    except Exception as e:
        return jsonify({'message': str(e)}), 500
    finally:
        if 'conn' in locals():
            conn.close()

@api_bp.route('/student/verification/ocr-check', methods=['POST'])
@token_required
def ocr_check():
    """Manual trigger for OCR verification (early check)."""
    try:
        data = request.get_json(silent=True) or {}
        
        # 1. Get Applicant info and current documents
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT * FROM applicants WHERE applicant_no = %s", (request.user_no,))
        applicant = cur.fetchone()
        
        if not applicant:
            return jsonify({'message': 'Applicant not found'}), 404
            
        def db_bytes(value):
            if isinstance(value, memoryview):
                return value.tobytes()
            return value

        def decode_base64(data_uri):
            if not data_uri or not isinstance(data_uri, str) or ',' not in data_uri:
                return None
            try:
                return base64.b64decode(data_uri.split(',')[1])
            except Exception:
                return None

        # Use provided images or fallback to DB
        id_front_bytes = decode_base64(data.get('id_front')) or db_bytes(applicant.get('id_img_front'))
        indigency_doc_bytes = decode_base64(data.get('indigency_doc')) or db_bytes(applicant.get('indigency_doc'))
        
        if not id_front_bytes:
            return jsonify({'message': 'Front of School ID is missing', 'verified': False}), 200
            
        town_city = applicant.get('town_city_municipality', '')
        # If town_city is provided, indigency is usually required for address verification
        if town_city and not indigency_doc_bytes:
            return jsonify({'message': 'Certificate of Indigency is missing for address verification', 'verified': False}), 200

        from ocr_utils import verify_id_with_ocr
        ocr_ok, ocr_status, _ = verify_id_with_ocr(
            id_front_bytes,
            first_name=applicant.get('first_name', ''),
            last_name=applicant.get('last_name', ''),
            town_city_municipality=town_city,
            address_image_data=indigency_doc_bytes
        )
        
        return jsonify({
            'verified': ocr_ok,
            'message': ocr_status
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({'message': f"OCR Error: {str(e)}", 'verified': False}), 500
    finally:
        if 'conn' in locals():
            conn.close()

# ─── APPLICATION SUBMISSION ────────────────────────────────

@api_bp.route('/applications/submit', methods=['POST'])
@token_required
def submit_application():
    try:
        # 1. Parse Data (handle both form fields and files)
        form_data = request.form
        files_data = request.files
        
        req_no = form_data.get('req_no')
        if not req_no:
            return jsonify({'message': 'Requirement number (req_no) is missing'}), 400
            
        try:
            req_no = int(req_no)
        except ValueError:
            return jsonify({'message': 'Invalid req_no format'}), 400

        # 2. Get Applicant Info
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT * FROM applicants WHERE applicant_no = %s", (request.user_no,))
        applicant = cur.fetchone()
        
        full_name = f"{applicant['first_name']} {applicant['middle_name'] or ''} {applicant['last_name']}".strip().replace('  ', ' ')
        address = f"{applicant['street_brgy'] or ''} {applicant['town_city_municipality'] or ''} {applicant['province'] or ''}".strip()

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

        # 3. Handle Binary Data (Photos & Documents)
        # Helper to decode base64
        def decode_base64(data_uri):
            if not data_uri or not isinstance(data_uri, str) or ',' not in data_uri:
                return None
            try:
                return base64.b64decode(data_uri.split(',')[1])
            except Exception:
                return None

        # Process Identity Verification Photos (Base64 from form_data)
        id_front_bytes = decode_base64(form_data.get('id_front')) or db_bytes(applicant.get('id_img_front'))
        id_back_bytes = decode_base64(form_data.get('id_back')) or db_bytes(applicant.get('id_img_back'))
        face_photo_bytes = decode_base64(form_data.get('face_photo'))
        profile_pic_bytes = decode_base64(form_data.get('profile_picture')) or db_bytes(applicant.get('profile_picture'))
        sig_data = form_data.get('signature_data')
        sig_bytes = decode_signature(sig_data) or decode_signature(applicant.get('signature_image_data'))

        # Process Documentary Requirements (Handle both File uploads and Base64 strings)
        doc_keys = [
            'mayorCOE_photo', 'mayorGrades_photo', 'mayorIndigency_photo', 'mayorValidID_photo'
        ]

        doc_column_map = {
            'mayorCOE_photo': 'enrollment_certificate_doc',
            'mayorGrades_photo': 'grades_doc',
            'mayorIndigency_photo': 'indigency_doc',
            'mayorValidID_photo': 'id_pic'
        }
        
        doc_bytes = {}
        for key in doc_keys:
            # Check for traditional file upload
            f = files_data.get(key)
            if f:
                doc_bytes[key] = f.read()
            else:
                # Check for Base64 encoded string in form_data (from compression)
                b64 = form_data.get(key)
                if b64:
                    doc_bytes[key] = decode_base64(b64)
                else:
                    doc_bytes[key] = db_bytes(applicant.get(doc_column_map[key]))

        # 4. OCR Verification (on id_front)
        skip_verification = form_data.get('skipVerification') == 'true' or form_data.get('skipVerification') == True
        
        if not skip_verification:
            if not id_front_bytes:
                return jsonify({'message': 'Front of School ID is required for verification'}), 400

            indigency_doc_bytes = doc_bytes.get('mayorIndigency_photo')
            town_city = applicant.get('town_city_municipality', '')
            if town_city and not indigency_doc_bytes:
                return jsonify({'message': 'Certificate of Indigency is required for address verification'}), 400
                
            from ocr_utils import verify_id_with_ocr, verify_face_with_id
            ocr_ok, ocr_status, _ = verify_id_with_ocr(
                id_front_bytes,
                first_name=applicant.get('first_name', ''),
                last_name=applicant.get('last_name', ''),
                town_city_municipality=town_city,
                address_image_data=indigency_doc_bytes
            )
            
            # NOTE: We might still allow submission even if OCR fails, 
            # but the user requested refactoring verification into this flow.
            # If OCR is strictly required, we block here.
            if not ocr_ok:
                return jsonify({'message': f"Identity verification failed: {ocr_status}"}), 400
        else:
            print(f"Skipping OCR verification for applicant {request.user_no} as requested by frontend.")
        
        # 4b. Face Verification (compare face_photo with id_img_front)
        if face_photo_bytes and id_front_bytes:
            face_ok, face_status, face_confidence = verify_face_with_id(face_photo_bytes, id_front_bytes)
            if not face_ok:
                return jsonify({'message': f"Face verification failed: {face_status}"}), 400

        # 5. Update Database (Applicants Table)
        updates = []
        params = []

        # Map Form Fields to mapped columns in applicants table
        field_mapping = {
            'lastName': 'last_name',
            'firstName': 'first_name',
            'middleName': 'middle_name',
            'dateOfBirth': 'birthdate',
            'streetBarangay': 'street_brgy',
            'townCity': 'town_city_municipality',
            'province': 'province',
            'zipCode': 'zip_code',
            'sex': 'sex',
            'citizenship': 'citizenship',
            'schoolIdNumber': 'school_id_no',
            'schoolName': 'school',
            'schoolAddress': 'school_address',
            'schoolSector': 'school_sector',
            'mobileNumber': 'mobile_no',
            'yearLevel': 'year_lvl',
            'parentsGrossIncome': 'financial_income_of_parents',
            'course': 'course'
        }

        for form_key, db_col in field_mapping.items():
            if form_key in form_data:
                updates.append(f"{db_col} = %s")
                params.append(form_data[form_key])

        # Add binary updates
        binary_map = {
            'id_img_front': id_front_bytes,
            'id_img_back': id_back_bytes,
            'profile_picture': profile_pic_bytes,
            'signature_image_data': fernet.encrypt(sig_bytes) if fernet and sig_bytes else sig_bytes
        }
        # Documents
        binary_map.update({
            'enrollment_certificate_doc': doc_bytes['mayorCOE_photo'],
            'grades_doc': doc_bytes['mayorGrades_photo'],
            'indigency_doc': doc_bytes['mayorIndigency_photo'],
            'id_pic': doc_bytes['mayorValidID_photo'] or db_bytes(applicant.get('id_pic')) or face_photo_bytes
        })

        for col, val in binary_map.items():
            if val is not None:
                updates.append(f"{col} = %s")
                params.append(val)

        if updates:
            sql = f"UPDATE applicants SET {', '.join(updates)} WHERE applicant_no = %s"
            params.append(request.user_no)
            cur.execute(sql, tuple(params))

        # 6. Record the application using ON CONFLICT for atomicity.
        cur.execute(
            """
            INSERT INTO applicant_status (scholarship_no, applicant_no, is_accepted)
            VALUES (%s, %s, NULL)
            ON CONFLICT (scholarship_no, applicant_no) DO NOTHING
            """,
            (req_no, request.user_no)
        )
        
        conn.commit()
        return jsonify({'message': 'Application submitted and verified successfully'})

    except Exception as e:
        traceback.print_exc()
        return jsonify({'message': f"Submission error: {str(e)}"}), 500
    finally:
        if 'conn' in locals():
            conn.close()

@api_bp.route('/applications/my-applications', methods=['GET'])
@token_required
def get_my_applications():
    """Returns applications for the logged-in user"""
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT 
                s.scholarship_name as name,
                s.req_no as scholarship_no,
                s.req_no,
                s.deadline,
                CASE 
                    WHEN ast.is_accepted = TRUE THEN 'Approved'
                    WHEN ast.is_accepted = FALSE THEN 'Rejected'
                    ELSE 'Pending'
                END as status,
                ast.status_updated as created_at 
            FROM applicant_status ast
            JOIN scholarships s ON ast.scholarship_no = s.req_no
            WHERE ast.applicant_no = %s
        """, (request.user_no,))
        rows = cur.fetchall()
        
        # Convert any date objects to strings for JSON serialization
        for row in rows:
            if row.get('deadline'):
                row['deadline'] = str(row['deadline'])
            if row.get('created_at'):
                row['created_at'] = str(row['created_at'])
                
        return jsonify(rows)
    except Exception as e:
        traceback.print_exc()
        return jsonify({'message': str(e)}), 500
    finally:
        if 'conn' in locals():
            conn.close()

# ─── PROVIDER / DASHBOARD ENDPOINTS ────────────────────────

# End of Application Endpoints

@api_bp.route('/applications/<int:req_no>/status', methods=['POST'])
def update_status(req_no):
    # This would be used by Admin to accept/reject
    data = request.get_json()
    applicant_no = data.get('applicant_no')
    status = data.get('status') # True, False, or None
    
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            UPDATE applicant_status 
            SET is_accepted = %s 
            WHERE scholarship_no = %s AND applicant_no = %s
        """, (status, req_no, applicant_no))
        conn.commit()
        return jsonify({'message': 'Status updated'})
    except Exception as e:
        return jsonify({'message': str(e)}), 500
    finally:
        if 'conn' in locals():
            conn.close()

# ─── ERROR HANDLERS ────────────────────────────────────────

@api_bp.errorhandler(404)
def not_found(e):
    return jsonify({'message': 'Resource not found'}), 404

@api_bp.errorhandler(500)
def server_error(e):
    return jsonify({'message': 'Internal server error'}), 500
