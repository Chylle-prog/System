import base64
import os
import re
from datetime import datetime
from functools import wraps

from cryptography.fernet import Fernet
from flask import flash, redirect, render_template, request, session, url_for
from flask_bcrypt import Bcrypt

from services.db_service import get_db
from services.ocr_utils import verify_id_with_ocr

from .student_api import student_api_bp


bcrypt = Bcrypt()
ENCRYPTION_KEY = os.environ.get('ENCRYPTION_KEY')
if ENCRYPTION_KEY and isinstance(ENCRYPTION_KEY, str):
    ENCRYPTION_KEY = ENCRYPTION_KEY.encode()
fernet = Fernet(ENCRYPTION_KEY) if ENCRYPTION_KEY else None


def encrypt_data(data):
    if data is None:
        return None
    if not fernet:
        return data
    try:
        return fernet.encrypt(data)
    except Exception as exc:
        print(f'Encryption error: {exc}')
        return None


def format_number(value):
    try:
        return '{:,}'.format(int(value))
    except (TypeError, ValueError):
        return value


def register_student_routes(app):
    bcrypt.init_app(app)
    app.jinja_env.filters['format_number'] = format_number

    def login_required(route_handler):
        @wraps(route_handler)
        def decorated_function(*args, **kwargs):
            if 'user_no' not in session:
                flash('Please log in to access this page.', 'error')
                return redirect(url_for('login'))
            return route_handler(*args, **kwargs)

        return decorated_function

    @app.route('/')
    def landing():
        if 'user_no' in session:
            return redirect(url_for('rank'))
        return render_template('landing.html')

    @app.route('/login', methods=['GET', 'POST'])
    def login():
        if request.method == 'POST':
            email = request.form.get('email', '').strip()
            password = request.form.get('password', '')

            if not email or not password:
                flash('Please enter email and password.', 'error')
                return redirect(url_for('login'))

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
                email_record = cur.fetchone()

                if not email_record:
                    cur.close()
                    conn.close()
                    flash('Incorrect email.', 'error')
                    return redirect(url_for('login'))

                if not email_record['password_hash'] or not bcrypt.check_password_hash(email_record['password_hash'], password):
                    cur.close()
                    conn.close()
                    flash('Incorrect password.', 'error')
                    return redirect(url_for('login'))

                applicant_no = email_record['applicant_no']
                user_no = email_record['user_no']

                if applicant_no:
                    cur.execute('SELECT applicant_no FROM applicants WHERE applicant_no = %s', (applicant_no,))
                    if not cur.fetchone():
                        cur.close()
                        conn.close()
                        flash('Applicant record not found.', 'error')
                        return redirect(url_for('login'))
                    session['applicant_no'] = applicant_no
                    session['user_no'] = applicant_no
                elif user_no:
                    session['user_no'] = user_no
                    session['applicant_no'] = None
                else:
                    cur.close()
                    conn.close()
                    flash('Account configuration error. Please contact support.', 'error')
                    return redirect(url_for('login'))

                cur.close()
                conn.close()
                flash('Login successful!', 'success')
                return redirect(url_for('rank'))
            except Exception as exc:
                flash(f'Error during login: {str(exc)}', 'error')

        return render_template('login.html')

    @app.route('/logout')
    def logout():
        session.pop('user_no', None)
        session.pop('applicant_no', None)
        flash('You have been logged out.', 'success')
        return redirect(url_for('landing'))

    @app.route('/register', methods=['GET', 'POST'])
    def register():
        if request.method == 'POST':
            first_name = request.form.get('first_name', '').strip()
            middle_name = request.form.get('middle_name', '').strip()
            last_name = request.form.get('last_name', '').strip()
            email = request.form.get('email', '').strip()
            password = request.form.get('password', '')
            password_confirm = request.form.get('password_confirm', '')

            if not all([first_name, last_name, email, password, password_confirm]):
                flash('First name, last name, email, and password are required.', 'error')
                return redirect(url_for('register'))

            if password != password_confirm:
                flash('Passwords do not match.', 'error')
                return redirect(url_for('register'))

            if not re.match(r'[^@]+@[^@]+\.[^@]+', email):
                flash('Please enter a valid email address.', 'error')
                return redirect(url_for('register'))

            if len(password) < 8:
                flash('Password must be at least 8 characters long.', 'error')
                return redirect(url_for('register'))

            try:
                conn = get_db()
                cur = conn.cursor()
                cur.execute(
                    """
                    SELECT applicant_no FROM email
                    WHERE email_address ILIKE %s
                    LIMIT 1
                    """,
                    (email,),
                )
                if cur.fetchone():
                    cur.close()
                    conn.close()
                    flash('This email is already registered.', 'error')
                    return redirect(url_for('register'))

                cur.execute(
                    """
                    INSERT INTO applicants (
                        first_name, middle_name, last_name,
                        overall_gpa, financial_income_of_parents,
                        id_img_front, signature_image_data
                    ) VALUES (%s, %s, %s, NULL, NULL, NULL, NULL)
                    RETURNING applicant_no
                    """,
                    (first_name, middle_name or None, last_name),
                )
                applicant_no = cur.fetchone()['applicant_no']

                password_hash = bcrypt.generate_password_hash(password).decode('utf-8')
                cur.execute(
                    """
                    INSERT INTO email (email_address, applicant_no, user_no, password_hash)
                    VALUES (%s, %s, NULL, %s)
                    RETURNING applicant_no
                    """,
                    (email, applicant_no, password_hash),
                )

                conn.commit()
                cur.close()
                conn.close()

                session['user_no'] = applicant_no
                session['applicant_no'] = applicant_no
                session['temp_registration'] = True

                flash('Account created! Now complete your application with GPA, income, address, and ID verification.', 'success')
                return redirect(url_for('rank'))
            except Exception as exc:
                flash(f'Database error: {str(exc)}', 'error')
                return redirect(url_for('register'))

        return render_template('initial_registration.html', req_no=None)

    @app.route('/rank', methods=['GET', 'POST'])
    @login_required
    def rank():
        results = None
        gpa = ''
        income = ''
        address = ''

        try:
            conn = get_db()
            cur = conn.cursor()
            cur.execute(
                """
                SELECT overall_gpa, financial_income_of_parents, street_brgy
                FROM applicants
                WHERE applicant_no = %s
                """,
                (session.get('applicant_no'),),
            )
            applicant_data = cur.fetchone()
            if applicant_data:
                gpa = applicant_data['overall_gpa'] or ''
                income = applicant_data['financial_income_of_parents'] or ''
                address = applicant_data['street_brgy'] or ''
            cur.close()
            conn.close()
        except Exception as exc:
            flash(f'Error fetching applicant data: {str(exc)}', 'error')

        if request.method == 'POST':
            try:
                new_gpa = float(request.form.get('gpa'))
                new_income = float(request.form.get('income'))
                new_address = request.form.get('address', '').strip()

                conn = get_db()
                cur = conn.cursor()
                cur.execute(
                    """
                    UPDATE applicants
                    SET overall_gpa = %s, financial_income_of_parents = %s, street_brgy = %s
                    WHERE applicant_no = %s
                    """,
                    (new_gpa, new_income, new_address, session.get('applicant_no')),
                )
                conn.commit()
                cur.close()
                conn.close()

                gpa = new_gpa
                income = new_income
                address = new_address
            except Exception as exc:
                flash(f'Error updating profile: {str(exc)}', 'error')

            try:
                conn = get_db()
                cur = conn.cursor()
                cur.execute(
                    """
                    SELECT req_no, scholarship_name, gpa, location, parent_finance, deadline
                    FROM scholarships
                    ORDER BY req_no
                    """
                )
                scholarships = cur.fetchall()

                today = datetime.now().date()
                ranked = []
                for scholarship in scholarships:
                    deadline = scholarship.get('deadline')
                    if deadline and deadline < today:
                        continue

                    score = 0
                    disqualified = False

                    min_gpa = scholarship['gpa']
                    if min_gpa is not None and gpa < min_gpa:
                        disqualified = True
                    elif min_gpa:
                        score += min(60, (gpa - min_gpa) * 12)

                    max_income = scholarship['parent_finance']
                    if max_income is not None and income > max_income:
                        disqualified = True
                    elif max_income:
                        score += min(50, (max_income - income) // 15000)

                    location = scholarship['location']
                    if location and location.strip():
                        location_clean = location.lower().strip()
                        addr_lower = address.lower()
                        if location_clean in addr_lower:
                            score += 100
                        elif any(word in addr_lower for word in location_clean.split()):
                            score += 40
                        else:
                            disqualified = True
                    else:
                        score += 10

                    if not disqualified:
                        ranked.append({
                            'req_no': scholarship['req_no'],
                            'name': scholarship['scholarship_name'],
                            'gpa': min_gpa,
                            'parent_finance': max_income,
                            'location': location,
                            'deadline': scholarship.get('deadline'),
                            'score': round(score),
                        })

                ranked.sort(key=lambda result: -result['score'])
                session['ranking_results'] = ranked
                session['last_search'] = {'gpa': gpa, 'income': income, 'address': address}

                if not ranked:
                    flash('No scholarships match your current profile.', 'error')
                else:
                    flash(f'Found {len(ranked)} matching scholarships — ranked by estimated fit.', 'success')

                cur.close()
                conn.close()
                return redirect(url_for('rank'))
            except Exception as exc:
                flash(f'Database error: {str(exc)}', 'error')

        if 'ranking_results' in session:
            results = session.pop('ranking_results', None)
            last = session.get('last_search', {})
        else:
            last = {}

        return render_template(
            'ranking.html',
            results=results,
            gpa=gpa or last.get('gpa', ''),
            income=income or last.get('income', ''),
            address=address or last.get('address', ''),
        )

    @app.route('/apply/<int:req_no>', methods=['GET'])
    def apply(req_no):
        if 'user_no' not in session:
            flash('Please log in to apply.', 'error')
            return redirect(url_for('login'))

        if session.get('temp_registration'):
            flash('Please complete your profile before applying.', 'info')

        data = session.get('last_search', {})
        return render_template('register.html', req_no=req_no, gpa=data.get('gpa', ''), income=data.get('income', ''))

    @app.route('/pre_register/<int:req_no>', methods=['GET', 'POST'])
    @login_required
    def pre_register(req_no):
        if request.method == 'POST':
            first_name = request.form.get('first_name', '').strip()
            middle_name = request.form.get('middle_name', '').strip()
            last_name = request.form.get('last_name', '').strip()
            address = request.form.get('address', '').strip()
            mother_fname = request.form.get('mother_fname', '').strip()
            mother_lname = request.form.get('mother_lname', '').strip()
            father_fname = request.form.get('father_fname', '').strip()
            father_lname = request.form.get('father_lname', '').strip()
            email = request.form.get('email', '').strip()
            password = request.form.get('password', '')
            password_confirm = request.form.get('password_confirm', '')

            if not all([first_name, last_name, address, email, password, password_confirm]):
                flash('First name, last name, address, email, and password are required.', 'error')
                return redirect(url_for('pre_register', req_no=req_no))

            if password != password_confirm:
                flash('Passwords do not match.', 'error')
                return redirect(url_for('pre_register', req_no=req_no))

            if not re.match(r'[^@]+@[^@]+\.[^@]+', email):
                flash('Please enter a valid email address.', 'error')
                return redirect(url_for('pre_register', req_no=req_no))

            try:
                conn = get_db()
                cur = conn.cursor()
                cur.execute(
                    """
                    SELECT em_no FROM email
                    WHERE email_address ILIKE %s
                    LIMIT 1
                    """,
                    (email,),
                )
                if cur.fetchone():
                    cur.close()
                    conn.close()
                    flash('This email is already registered.', 'error')
                    return redirect(url_for('pre_register', req_no=req_no))

                session['applicant_first_name'] = first_name
                session['applicant_middle_name'] = middle_name
                session['applicant_last_name'] = last_name
                session['applicant_address'] = address
                session['applicant_mother_fname'] = mother_fname
                session['applicant_mother_lname'] = mother_lname
                session['applicant_father_fname'] = father_fname
                session['applicant_father_lname'] = father_lname
                session['applicant_email'] = email
                session['applicant_password'] = password

                cur.close()
                conn.close()

                flash('Account information saved. Please proceed with application.', 'success')
                return redirect(url_for('apply', req_no=req_no))
            except Exception as exc:
                flash(f'Database error: {str(exc)}', 'error')
                return redirect(url_for('pre_register', req_no=req_no))

        return render_template('initial_registration.html', req_no=req_no)

    @app.route('/cancel_application', methods=['GET'])
    def cancel_application():
        session.pop('ranking_results', None)
        session.pop('last_search', None)
        session.pop('applicant_first_name', None)
        session.pop('applicant_last_name', None)
        session.pop('applicant_address', None)
        session.pop('applicant_email', None)
        session.pop('applicant_password', None)
        if session.get('user_no') == 'temp_registration':
            session.pop('user_no', None)
        return redirect(url_for('landing'))

    @app.route('/submit', methods=['POST'])
    def submit():
        try:
            applicant_no = session.get('applicant_no')
            gpa = float(request.form.get('overall_gpa'))
            income = float(request.form.get('financial_income_of_parents'))
            address = request.form.get('address', '').strip()
            mother_fname = request.form.get('mother_fname', '').strip()
            mother_lname = request.form.get('mother_lname', '').strip()
            father_fname = request.form.get('father_fname', '').strip()
            father_lname = request.form.get('father_lname', '').strip()
            req_no = int(request.form.get('req_no'))

            if not address:
                flash('Address is required.', 'error')
                return redirect(url_for('apply', req_no=req_no))

            id_file = request.files.get('id_image')
            if not id_file or not id_file.filename:
                flash('ID image is required.', 'error')
                return redirect(url_for('apply', req_no=req_no))

            live_base64 = request.form.get('live_photo')
            if not live_base64:
                flash('Live photo capture is required.', 'error')
                return redirect(url_for('apply', req_no=req_no))

            signature_base64 = request.form.get('signature_data')
            if not signature_base64:
                flash('Signature is required.', 'error')
                return redirect(url_for('apply', req_no=req_no))

            id_bytes = id_file.read()
            signature_bytes = base64.b64decode(signature_base64.split(',')[1])
            encrypted_signature = encrypt_data(signature_bytes)
            if not encrypted_signature:
                flash('Error encrypting signature data.', 'error')
                return redirect(url_for('apply', req_no=req_no))

            conn = get_db()
            cur = conn.cursor()
            cur.execute(
                """
                SELECT first_name, middle_name, last_name
                FROM applicants
                WHERE applicant_no = %s
                """,
                (applicant_no,),
            )
            applicant = cur.fetchone()
            if not applicant:
                flash('Applicant record not found.', 'error')
                return redirect(url_for('register'))

            full_name = f"{applicant['first_name']} {applicant['middle_name']} {applicant['last_name']}".replace('  ', ' ').strip()
            ocr_ok, ocr_status, _ = verify_id_with_ocr(id_bytes, full_name, address)
            if not ocr_ok:
                flash(ocr_status, 'error')
                return redirect(url_for('apply', req_no=req_no))

            cur.execute(
                """
                UPDATE applicants
                SET overall_gpa = %s,
                    financial_income_of_parents = %s,
                    street_brgy = %s,
                    mother_fname = %s,
                    mother_lname = %s,
                    father_fname = %s,
                    father_lname = %s,
                    id_img_front = %s,
                    signature_image_data = %s
                WHERE applicant_no = %s
                """,
                (
                    gpa,
                    income,
                    address,
                    mother_fname or None,
                    mother_lname or None,
                    father_fname or None,
                    father_lname or None,
                    id_bytes,
                    encrypted_signature,
                    applicant_no,
                ),
            )

            cur.execute(
                """
                INSERT INTO applicant_status (scholarship_no, applicant_no, is_accepted)
                VALUES (%s, %s, NULL)
                ON CONFLICT (scholarship_no, applicant_no) DO NOTHING
                """,
                (req_no, applicant_no),
            )

            cur.execute('SELECT scholarship_name FROM scholarships WHERE req_no = %s', (req_no,))
            sch_result = cur.fetchone()
            scholarship_name = sch_result['scholarship_name'] if sch_result else f'Scholarship #{req_no}'

            conn.commit()
            cur.close()
            conn.close()

            session.pop('temp_registration', None)
            flash(
                f'''Application submitted successfully!<br>Applicant Number: <strong>{applicant_no}</strong><br>For scholarship: {scholarship_name}''',
                'success',
            )
            return redirect(url_for('rank'))
        except Exception as exc:
            flash(f'Error during submission: {str(exc)}', 'error')
            req_no_fallback = request.form.get('req_no', '')
            return redirect(url_for('apply', req_no=req_no_fallback) if req_no_fallback else url_for('rank'))


__all__ = ['register_student_routes', 'student_api_bp']