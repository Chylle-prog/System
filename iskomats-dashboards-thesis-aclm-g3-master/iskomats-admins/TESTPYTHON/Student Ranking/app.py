import os
import sys

# Add current and project directories to sys.path for shared helpers
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(CURRENT_DIR)
if CURRENT_DIR not in sys.path:
    sys.path.append(CURRENT_DIR)
if PROJECT_DIR not in sys.path:
    sys.path.append(PROJECT_DIR)

from flask import Flask, render_template, request, redirect, url_for, flash, session
from flask_cors import CORS
from flask_bcrypt import Bcrypt
import psycopg2
import re
from datetime import datetime
from cryptography.fernet import Fernet
import base64
from utils import normalize_text, verify_id_with_ocr
from flask_socketio import SocketIO
from api_routes import api_bp, init_socketio
from project_config import get_db as base_get_db, get_db_display_config

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'development-key-replace-in-production')
bcrypt = Bcrypt(app)
socketio = SocketIO(app, cors_allowed_origins=["http://localhost:5173", "http://localhost:3000", "http://localhost:5174"])

# ─── Initialize SocketIO events ────────────────────────────────
init_socketio(socketio)

# ─── Enable CORS for React frontend ────────────────────────────
CORS(app, resources={r"/api/*": {"origins": ["http://localhost:5173", "http://localhost:3000"]}})

# ─── Register API Blueprint ────────────────────────────────────
app.register_blueprint(api_bp)

# ─── Decryption Setup ────────────────────────────────────────────
ENCRYPTION_KEY = os.environ.get('ENCRYPTION_KEY')
if not ENCRYPTION_KEY:
    raise ValueError("ENCRYPTION_KEY not set in environment variables")
if isinstance(ENCRYPTION_KEY, str):
    ENCRYPTION_KEY = ENCRYPTION_KEY.encode()
fernet = Fernet(ENCRYPTION_KEY)

def decrypt_data(encrypted_data):
    """Decrypt binary data from database"""
    if encrypted_data is None:
        return None
    try:
        # Convert memoryview or other types to bytes if needed
        if hasattr(encrypted_data, 'tobytes'):
            encrypted_data = encrypted_data.tobytes()
        elif not isinstance(encrypted_data, bytes):
            encrypted_data = bytes(encrypted_data)
        return fernet.decrypt(encrypted_data)
    except Exception as e:
        print(f"Decryption error: {e}")
        return None

def decrypt_to_base64(encrypted_data):
    """Decrypt and return as base64 string for HTML display"""
    decrypted = decrypt_data(encrypted_data)
    if decrypted:
        return base64.b64encode(decrypted).decode('utf-8')
    return None

def get_db():
    """Get database connection with error handling"""
    try:
        conn = base_get_db()
        db_config = get_db_display_config()
        print(f"Connected to {db_config['dbname']} at {db_config['host']}:{db_config['port']} ({db_config['sslmode']})")
        return conn
    except psycopg2.OperationalError as e:
        db_config = get_db_display_config()
        print(f"Database Connection Error: {str(e)}")
        print(f"  Config: {db_config['host']}:{db_config['port']}/{db_config['dbname']}")
        raise Exception(f"Cannot connect to database: {str(e)}")

def evaluate_scholarship_candidate(sch, app_no, name, address, gpa_str, income_str, id_image_data=None):
    import pandas as pd
    try:
        gpa = float(gpa_str)
        income = float(income_str)
    except (ValueError, TypeError):
        return False, -999, "Invalid", "Invalid GPA or income format"

    address_norm = normalize_text(address)

    id_verified = True
    id_reason = "No ID check performed"

    if id_image_data is not None:
        id_verified, id_status, _ = verify_id_with_ocr(id_image_data, name, address)
        id_reason = id_status
        if not id_verified:
            return False, -1, "Not Eligible", id_reason

    min_gpa = sch.get('gpa')
    max_income = sch.get('parent_finance')
    required_location = sch.get('location')

    if pd.isna(min_gpa): min_gpa = None
    if pd.isna(max_income): max_income = None
    if pd.isna(required_location): required_location = None

    if min_gpa is not None and gpa < min_gpa:
        return False, -1, "Not Eligible", f"GPA below minimum ({min_gpa})"

    if max_income is not None and income > max_income:
        return False, -1, "Not Eligible", f"Income exceeds limit (₱{max_income:,.0f})"

    if isinstance(required_location, str) and required_location.strip():
        loc_clean = normalize_text(required_location)
        if not any(word in address_norm for word in loc_clean.split()):
            return False, -1, "Not Eligible", f"Not in required location ({required_location})"

    score = 0
    explanation = []

    if min_gpa:
        diff = gpa - min_gpa
        score += min(60, diff * 12)
        explanation.append(f"+{int(min(60, diff*12))} (GPA above min)")
    else:
        if gpa >= 95:
            score += 50
            explanation.append("Very high GPA")
        elif gpa >= 85:
            score += 30
            explanation.append("Good GPA")

    if max_income:
        if income <= max_income * 0.4:
            score += 50; explanation.append("Very high need")
        elif income <= max_income * 0.7:
            score += 30; explanation.append("High need")
        elif income <= max_income:
            score += 15; explanation.append("Some need")
    else:
        if income <= 250000:
            score += 40
        elif income <= 500000:
            score += 20

    if required_location and required_location.strip():
        loc_clean = normalize_text(required_location)
        if loc_clean in address_norm:
            score += 100
            explanation.append("+100 (exact location match)")
        elif any(word in address_norm for word in loc_clean.split()):
            score += 40
            explanation.append("+40 (partial location match)")

    if score >= 140:
        category = "Top Priority – Full Scholarship"
    elif score >= 100:
        category = "Strong Candidate – High Partial"
    elif score >= 60:
        category = "Good Candidate – Partial"
    else:
        category = "Eligible but low priority"

    return True, round(score), category, "; ".join(explanation) or "Basic eligibility"


# ─── Admin protection ───────────────────────────────────────────────
@app.before_request
def protect_admin():
    if request.path.startswith('/admin') and not session.get('admin_logged_in', False) and 'pro_email' not in session:
        if request.path not in [url_for('landing'), url_for('provider_login'), url_for('provider_register'), url_for('admin_login')]:
            flash("Please log in first.", "error")
            return redirect(url_for('landing'))


# ─── ROOT ROUTE TO LOGIN ────────────────────────────────────────────
# ('/') 
@app.route('/')
def index():
    if 'pro_email' in session or 'admin_logged_in' in session:
        return redirect(url_for('admin_choose_scholarship'))
    return redirect(url_for('provider_login'))


# ─── PROVIDER LANDING PAGE ──────────────────────────────────────────
# ('/provider')
@app.route('/provider')
def landing():
    if 'pro_email' in session or 'admin_logged_in' in session:
        return redirect(url_for('admin_provider_select'))
    return render_template('provider_landing.html')


# ─── PROVIDER LOGIN ──────────────────────────────────────────────────
# ('/provider/login', methods=['GET', 'POST'])
@app.route('/provider/login', methods=['GET', 'POST'])
def provider_login():
    if request.method == 'POST':
        email = request.form.get('email', '').strip()
        password = request.form.get('password', '')

        if not email or not password:
            flash("Please enter email and password.", "error")
            return render_template('provider_login.html')

        try:
            conn = get_db()
            cur = conn.cursor()
            cur.execute("""
                SELECT e.password_hash, u.user_no, u.user_name, p.pro_no, p.provider_name
                FROM email e
                JOIN users u ON e.user_no = u.user_no
                JOIN scholarship_providers p ON u.pro_no = p.pro_no
                WHERE e.email_address ILIKE %s AND e.user_no IS NOT NULL
            """, (email,))
            user = cur.fetchone()
            cur.close()
            conn.close()

            if user and bcrypt.check_password_hash(user['password_hash'], password):
                session['pro_email'] = email
                session['user_no'] = user['user_no']
                session['user_name'] = user['user_name']
                session['selected_pro_no'] = user['pro_no']
                session['selected_provider'] = user['provider_name']
                flash("Logged in successfully.", "success")
                return redirect(url_for('admin_choose_scholarship'))
            else:
                flash("Invalid email or password.", "error")
        except Exception as e:
            flash(f"Login error: {str(e)}", "error")

    return render_template('provider_login.html')


# ─── PROVIDER REGISTRATION ───────────────────────────────────────────
# ('/provider/register', methods=['GET', 'POST'])
@app.route('/provider/register', methods=['GET', 'POST'])
def provider_register():
    if request.method == 'POST':
        provider_name = request.form.get('provider_name', '').strip()
        email = request.form.get('email', '').strip()
        password = request.form.get('password', '')
        password_confirm = request.form.get('password_confirm', '')

        if not provider_name or not email or not password or not password_confirm:
            flash("All fields are required.", "error")
            return render_template('provider_register.html')

        if not re.match(r"[^@]+@[^@]+\.[^@]+", email):
            flash("Invalid email address.", "error")
            return render_template('provider_register.html')

        if password != password_confirm:
            flash("Passwords do not match.", "error")
            return render_template('provider_register.html')

        if len(password) < 8:
            flash("Password must be at least 8 characters long.", "error")
            return render_template('provider_register.html')

        try:
            conn = get_db()
            cur = conn.cursor()

            # Check if email already used by provider/user
            cur.execute("""
                SELECT 1 FROM email 
                WHERE email_address ILIKE %s AND user_no IS NOT NULL
            """, (email,))
            if cur.fetchone():
                flash("This email is already registered to a provider.", "error")
                cur.close()
                conn.close()
                return render_template('provider_register.html')

            # Insert new provider (Organization)
            cur.execute("""
                INSERT INTO scholarship_providers (provider_name)
                VALUES (%s) RETURNING pro_no
            """, (provider_name,))
            pro_no = cur.fetchone()['pro_no']

            # Insert new user (Individual)
            cur.execute("""
                INSERT INTO users (pro_no, user_name)
                VALUES (%s, %s) RETURNING user_no
            """, (pro_no, provider_name))
            user_no = cur.fetchone()['user_no']

            # Hash password and store in email table
            password_hash = bcrypt.generate_password_hash(password).decode('utf-8')
            cur.execute("""
                INSERT INTO email (email_address, applicant_no, user_no, password_hash)
                VALUES (%s, NULL, %s, %s)
            """, (email, user_no, password_hash))

            conn.commit()
            cur.close()
            conn.close()

            flash("Provider account created successfully. Please log in.", "success")
            return redirect(url_for('provider_login'))

        except Exception as e:
            flash(f"Registration error: {str(e)}", "error")

    return render_template('provider_register.html')


# ─── Provider Selection ─────────────────────────────────────────────
# ('/admin', methods=['GET', 'POST'])
# ('/', methods=['GET', 'POST'])
@app.route('/admin', methods=['GET', 'POST'])
def admin_provider_select():
    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT pro_no, provider_name 
                    FROM scholarship_providers 
                    ORDER BY provider_name
                """)
                providers = cur.fetchall()  # list of dicts
    except Exception as e:
        flash(f"Database error: {str(e)}", "error")
        providers = []

    if request.method == 'POST':
        selected_pro_no = request.form.get('pro_no', type=int)
        selected_name = None

        for p in providers:
            if p['pro_no'] == selected_pro_no:
                selected_name = p['provider_name']
                break

        if selected_pro_no and selected_name:
            session['selected_pro_no'] = selected_pro_no
            session['selected_provider'] = selected_name   # for display convenience
            session.pop('admin_logged_in', None)
            flash(f"Now viewing scholarships from: {selected_name}", "success")
            return redirect(url_for('admin_choose_scholarship'))
        else:
            flash("Please select a valid provider.", "error")

    return render_template('admin_provider_select.html', providers=providers)


# ─── Create new scholarship ─────────────────────────────────────────
# ('/admin/scholarships/new', methods=['GET', 'POST'])
@app.route('/admin/scholarships/new', methods=['GET', 'POST'])
def admin_scholarship_new():
    is_full_admin = session.get('admin_logged_in', False)
    selected_pro_no = session.get('selected_pro_no')

    if not is_full_admin and not selected_pro_no:
        flash("Please select a provider first.", "error")
        return redirect(url_for('admin_provider_select'))

    form_data = {
        'scholarship_name': '',
        'gpa': '',
        'parent_finance': '',
        'location': '',
        'slots': '',
        'deadline': '',
        'pro_no': selected_pro_no if not is_full_admin else None
    }

    if request.method == 'POST':
        try:
            scholarship_name = request.form.get('scholarship_name', '').strip()
            gpa_str          = request.form.get('gpa', '').strip()
            parent_finance_str = request.form.get('parent_finance', '').strip()
            location         = request.form.get('location', '').strip()
            slots_str        = request.form.get('slots', '').strip()
            deadline_str     = request.form.get('deadline', '').strip()

            # Determine pro_no
            if is_full_admin:
                pro_no = request.form.get('pro_no', type=int)
            else:
                pro_no = selected_pro_no

            if not pro_no:
                flash("Provider is required.", "error")
                return render_template('admin_scholarship_new.html', 
                                     form_data=request.form, 
                                     is_full_admin=is_full_admin,
                                     selected_pro_no=selected_pro_no)

            if not scholarship_name:
                flash("Scholarship name is required.", "error")
                return render_template('admin_scholarship_new.html', form_data=request.form, is_full_admin=is_full_admin)

            if not deadline_str:
                flash("Application deadline is required.", "error")
                return render_template('admin_scholarship_new.html', form_data=request.form, is_full_admin=is_full_admin)

            try:
                deadline = datetime.strptime(deadline_str, '%Y-%m-%d').date()
            except ValueError:
                flash("Invalid deadline format. Use YYYY-MM-DD.", "error")
                return render_template('admin_scholarship_new.html', form_data=request.form, is_full_admin=is_full_admin)

            gpa = None
            if gpa_str.strip():
                try:
                    gpa = float(gpa_str)
                except ValueError:
                    flash("Invalid GPA format.", "error")
                    return render_template('admin_scholarship_new.html', form_data=request.form, is_full_admin=is_full_admin)

            parent_finance = None
            if parent_finance_str.strip():
                try:
                    parent_finance = float(parent_finance_str)
                except ValueError:
                    flash("Invalid income limit format.", "error")
                    return render_template('admin_scholarship_new.html', form_data=request.form, is_full_admin=is_full_admin)

            slots = None
            if slots_str.strip():
                try:
                    slots = int(slots_str)
                    if slots < 1:
                        slots = None
                except ValueError:
                    flash("Invalid slots number.", "error")
                    return render_template('admin_scholarship_new.html', form_data=request.form, is_full_admin=is_full_admin)

            with get_db() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        INSERT INTO scholarships 
                        (scholarship_name, gpa, parent_finance, location, pro_no, slots, deadline)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        RETURNING req_no
                    """, (scholarship_name, gpa, parent_finance, location or None, pro_no, slots, deadline))
                    
                    new_id = cur.fetchone()['req_no']
                    conn.commit()

            flash(f"Scholarship '{scholarship_name}' created (ID: {new_id})", "success")
            return redirect(url_for('admin_choose_scholarship'))

        except Exception as e:
            flash(f"Error creating scholarship: {str(e)}", "error")

    return render_template('admin_scholarship_new.html', 
                          form_data=form_data, 
                          is_full_admin=is_full_admin,
                          selected_pro_no=selected_pro_no)


# ─── Full Admin Login ───────────────────────────────────────────────
# ('/admin/login', methods=['GET', 'POST'])
@app.route('/admin/login', methods=['GET', 'POST'])
def admin_login():
    if request.method == 'POST':
        password = request.form.get('password', '')
        if password == os.environ.get('ADMIN_PASSWORD'):
            session['admin_logged_in'] = True
            session.pop('selected_pro_no', None)
            session.pop('selected_provider', None)
            flash("Logged in as full administrator.", "success")
            return redirect(url_for('admin_choose_scholarship'))
        flash("Invalid password.", "error")
    return render_template('admin_login.html')


# ('/admin/logout')
@app.route('/admin/logout')
def admin_logout():
    session.pop('admin_logged_in', None)
    session.pop('selected_pro_no', None)
    session.pop('selected_provider', None)
    session.pop('pro_email', None)
    flash("Logged out.", "success")
    return redirect(url_for('landing'))


# ('/provider/logout')
def provider_logout():
    session.clear()
    flash("Logged out.", "success")
    return redirect(url_for('landing'))


# ─── HEALTH CHECK ROUTE ────────────────────────────────────────────────
# ('/api/health') - Check database connection@app.route('/api/health')def health_check():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM email;")
        count = cur.fetchone()[0]
        cur.close()
        conn.close()
        return {
            "status": "healthy",
            "database": "connected",
            "email_table_records": count
        }, 200
    except Exception as e:
        db_config = get_db_display_config()
        return {
            "status": "unhealthy",
            "error": str(e),
            "config": {
                "host": db_config['host'],
                "port": db_config['port'],
                "dbname": db_config['dbname'],
                "schema": db_config['schema'],
                "sslmode": db_config['sslmode']
            }
        }, 500


# ─── List scholarships ──────────────────────────────────────────────
# ('/admin/scholarships')
@app.route('/admin/scholarships')
def admin_choose_scholarship():
    is_full_admin = session.get('admin_logged_in', False)
    selected_pro_no = session.get('selected_pro_no')

    if not is_full_admin and not selected_pro_no:
        return redirect(url_for('landing'))

    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                query = """
                    SELECT s.req_no, s.scholarship_name, s.gpa, s.location, 
                           s.parent_finance, s.slots, s.deadline,
                           p.provider_name, s.pro_no
                    FROM scholarships s
                    LEFT JOIN scholarship_providers p ON s.pro_no = p.pro_no
                """
                params = ()
                if not is_full_admin:
                    query += " WHERE s.pro_no = %s"
                    params = (selected_pro_no,)

                query += " ORDER BY s.req_no"
                cur.execute(query, params)
                scholarships = cur.fetchall()
    except Exception as e:
        flash(f"Database error: {str(e)}", "error")
        return redirect(url_for('landing'))

    return render_template('admin_scholarships.html',
                          scholarships=scholarships,
                          provider=session.get('selected_provider'),
                          is_full_admin=is_full_admin)


# ─── Rank applicants for one scholarship ────────────────────────────
# ('/admin/rank/<int:req_no>')
@app.route('/admin/rank/<int:req_no>')
def admin_rank_applicants(req_no):
    is_full_admin = session.get('admin_logged_in', False)
    selected_pro_no = session.get('selected_pro_no')

    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                # Get scholarship details
                cur.execute("""
                    SELECT s.req_no, s.scholarship_name, s.gpa, s.location, 
                           s.parent_finance, s.pro_no, p.provider_name,
                           s.slots, s.deadline
                    FROM scholarships s
                    LEFT JOIN scholarship_providers p ON s.pro_no = p.pro_no
                    WHERE s.req_no = %s
                """, (req_no,))
                sch_row = cur.fetchone()
                if not sch_row:
                    flash("Scholarship not found.", "error")
                    return redirect(url_for('admin_choose_scholarship'))

                # Check access permission
                if not is_full_admin and sch_row['pro_no'] != selected_pro_no:
                    flash("You do not have access to this scholarship.", "error")
                    return redirect(url_for('admin_choose_scholarship'))

                selected_sch = dict(sch_row)

                # Get ONLY applicants who applied for THIS scholarship
                cur.execute("""
                    SELECT 
                        a.applicant_no, a.first_name, a.middle_name, a.last_name, 
                        a.street_brgy, a.town_city_municipality, a.province, a.zip_code,
                        a.mother_fname, a.mother_lname, a.father_fname, a.father_lname,
                        a.overall_gpa, a.financial_income_of_parents, a.id_img_front,
                        a.signature_image_data,
                        s.is_accepted, s.stat_no
                    FROM applicants a
                    INNER JOIN applicant_status s ON a.applicant_no = s.applicant_no
                    WHERE s.scholarship_no = %s
                    ORDER BY a.applicant_no
                """, (req_no,))
                applicant_rows = cur.fetchall()

                results = []

                for row in applicant_rows:
                    app_no = str(row['applicant_no'])
                    first_name = str(row['first_name'] or '').strip()
                    middle_name = str(row['middle_name'] or '').strip()
                    last_name = str(row['last_name'] or '').strip()
                    name = f"{first_name} {middle_name} {last_name}".replace('  ', ' ').strip()
                    
                    addr_parts = [
                        str(row['street_brgy'] or '').strip(),
                        str(row['town_city_municipality'] or '').strip(),
                        str(row['province'] or '').strip(),
                        str(row['zip_code'] or '').strip()
                    ]
                    address = ", ".join(p for p in addr_parts if p)

                    gpa_str = str(row['overall_gpa'] or '').strip()
                    income_str = str(row['financial_income_of_parents'] or '').strip()
                    id_image_data = row['id_img_front']
                    
                    # Decrypt signature if needed
                    signature_base64 = None
                    if row['signature_image_data']:
                        signature_base64 = decrypt_to_base64(row['signature_image_data'])

                    # Check if already accepted for ANY scholarship (except this one if already processed)
                    if row['is_accepted'] is True:
                        continue

                    # Check if already processed (rejected) for this scholarship
                    if row['is_accepted'] is False:
                        continue

                    # Evaluate candidate (is_accepted is NULL - pending)
                    eligible, score, category, reason = evaluate_scholarship_candidate(
                        selected_sch, app_no, name, address, gpa_str, income_str
                    )

                    results.append({
                        'app_no': app_no,
                        'name': name,
                        'last_name': last_name.lower().strip(),
                        'gpa': gpa_str,
                        'income': income_str,
                        'address': address,
                        'eligible': eligible,
                        'score': score,
                        'category': category,
                        'reason': reason,
                        'signature': signature_base64  # Include decrypted signature if needed
                    })

                # Family already has this scholarship
                families_with_this = set()
                for r in results:
                    cur.execute(
                        """
                        SELECT 1 FROM applicant_status
                        WHERE applicant_no = %s AND scholarship_no = %s AND is_accepted = true
                        LIMIT 1
                        """,
                        (r['app_no'], req_no)
                    )
                    if cur.fetchone():
                        families_with_this.add(r['last_name'])

                for r in results:
                    if r['last_name'] in families_with_this and "already has a scholarship grant" not in r['reason'] and "Previously rejected" not in r['reason']:
                        r['eligible'] = False
                        r['score'] = -1000
                        r['reason'] = (r['reason'] + "; " if r['reason'] else "") + "Family member already receiving this scholarship"

                # Sort
                sorted_results = sorted(results, key=lambda x: (-x['eligible'], -x['score']))

                # Optional: one per family
                used_last_names = set()
                for r in sorted_results:
                    if r['eligible']:
                        ln = r['last_name']
                        if ln in used_last_names:
                            r['eligible'] = False
                            r['score'] = -1000
                            r['reason'] = (r['reason'] + "; " if r['reason'] else "") + "Only one award per family this round"
                        else:
                            used_last_names.add(ln)

                eligible_count = sum(1 for r in sorted_results if r['eligible'])

    except Exception as e:
        flash(f"Error loading data: {str(e)}", "error")
        return redirect(url_for('admin_choose_scholarship'))

    return render_template('admin_ranking.html',
                          scholarship=selected_sch,
                          results=sorted_results,
                          eligible_count=eligible_count)


# ─── Accept / Reject ────────────────────────────────────────────────
# ('/admin/decision/<int:req_no>', methods=['POST'])
def admin_decision(req_no):
    is_full_admin = session.get('admin_logged_in', False)
    selected_pro_no = session.get('selected_pro_no')

    action = request.form.get('action')
    app_no = request.form.get('app_no')

    if action not in ['accept', 'reject']:
        flash("Invalid action.", "error")
        return redirect(url_for('admin_rank_applicants', req_no=req_no))

    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT pro_no FROM scholarships WHERE req_no = %s", (req_no,))
                sch = cur.fetchone()
                if not sch:
                    flash("Scholarship not found.", "error")
                    return redirect(url_for('admin_choose_scholarship'))

                if not is_full_admin and sch['pro_no'] != selected_pro_no:
                    flash("No access to this scholarship.", "error")
                    return redirect(url_for('admin_choose_scholarship'))

                cur.execute("""
                    SELECT 1 FROM applicant_status
                    WHERE applicant_no = %s AND scholarship_no = %s AND is_accepted IS NULL
                """, (app_no, req_no))
                if not cur.fetchone():
                    flash("Invalid or non-pending application.", "error")
                    return redirect(url_for('admin_rank_applicants', req_no=req_no))

                if action == 'accept':
                    cur.execute("""
                        UPDATE applicant_status
                        SET is_accepted = true
                        WHERE applicant_no = %s AND scholarship_no = %s
                    """, (app_no, req_no))
                    flash(f"Applicant {app_no} accepted.", "success")
                else:
                    cur.execute("""
                        UPDATE applicant_status
                        SET is_accepted = false
                        WHERE applicant_no = %s AND scholarship_no = %s
                    """, (app_no, req_no))
                    flash(f"Applicant {app_no} rejected.", "success")

                conn.commit()
    except Exception as e:
        flash(f"Database error: {str(e)}", "error")

    return redirect(url_for('admin_rank_applicants', req_no=req_no))


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '5001'))
    print(f"Starting Admin Backend on Port {port}...")
    socketio.run(app, debug=False, port=port, host='0.0.0.0')

