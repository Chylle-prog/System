import warnings
with warnings.catch_warnings():
    warnings.filterwarnings('ignore', category=DeprecationWarning)
    # Eventlet is deprecated but we suppress the warning since it's fundamentally embedded in Flask-SocketIO's current setup.
    try:
        import eventlet
        eventlet.monkey_patch()
    except ImportError:
        pass
import os
import sys
import time

# Force unbuffered output for Render logs
sys.stdout.reconfigure(line_buffering=True)

# Performance Tuning: Limit Tesseract's internal threads so our Python parallelism works better
os.environ['OMP_THREAD_LIMIT'] = '1'
os.environ['TESSDATA_PREFIX'] = os.environ.get('TESSDATA_PREFIX', '/usr/share/tesseract-ocr/5/tessdata')

STARTUP_TIME = time.time()
print("[STARTUP] 1. eventlet monkey_patch complete. Loading modules...", flush=True)

# Deployment trigger: 2026-04-08 - CORS TIMEOUT FIX - Better error handling
from flask import Flask, jsonify, request
from flask_socketio import SocketIO
from werkzeug.middleware.proxy_fix import ProxyFix

print("[STARTUP] 2. Flask/SocketIO imported. Loading blueprints...", flush=True)
from blueprints import admin_bp, init_admin_socketio, register_admin_routes, student_api_bp

print("[STARTUP] 3. Blueprints imported. Loading services...", flush=True)
from services.auth_service import get_allowed_origins, get_secret_key, is_origin_allowed, split_allowed_origins
from services.db_service import get_db, get_db_display_config
from services.email_table_service import get_applicant_email_table, get_user_email_table

print("[STARTUP] 4. Services imported. Initializing Flask app...", flush=True)
app = Flask(__name__)
app.secret_key = get_secret_key()
app.config['PREFERRED_URL_SCHEME'] = 'https'
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1)

# Get origins and split into exact strings and regex patterns
all_allowed_origins = get_allowed_origins()
exact_allowed_origins, preview_origin_patterns = split_allowed_origins(all_allowed_origins)

# Note: We handle CORS manually in before_request and after_request to have full control
# Don't use CORS() extension - it can conflict with manual handlers

print(f"[STARTUP] Initializing SocketIO with {len(exact_allowed_origins)} exact origins...")
# Pass only string origins to SocketIO to avoid issues with regex objects
socketio = SocketIO(
    app, 
    cors_allowed_origins=exact_allowed_origins,
    engineio_logger=True,
    ping_timeout=120,
    ping_interval=30
)

print("[STARTUP] Registering blueprints...")
app.register_blueprint(admin_bp)
app.register_blueprint(student_api_bp, url_prefix='/api/student')

register_admin_routes(app)
init_admin_socketio(socketio)

# Track startup completion
APP_READY = False
APP_STARTUP_ERROR = None


@app.route('/')
def index():
    return jsonify({
        'service': 'iskomats-combined-backend',
        'status': 'ok',
        'frontend': 'react',
        'adminApi': '/api/admin',
        'studentApi': '/api/student',
        'startupTime': STARTUP_TIME,
        'uptime': time.time() - STARTUP_TIME
    }), 200


def apply_cors_headers(response, origin):
    """Internal helper to apply standard CORS headers to any response object."""
    if not origin:
       return response
       
    is_allowed = is_origin_allowed(origin, exact_allowed_origins, preview_origin_patterns)
    
    # We ALWAYS add Vary: Origin to ensure proper browser/CDN caching
    response.headers['Vary'] = 'Origin'
    
    if is_allowed:
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD'
        response.headers['Access-Control-Allow-Headers'] = request.headers.get(
            'Access-Control-Request-Headers',
            'Content-Type, Authorization, Accept, X-Requested-With, X-CSRF-Token'
        )
        response.headers['Access-Control-Allow-Credentials'] = 'true'
        response.headers['Access-Control-Max-Age'] = '86400'
    else:
        # If not allowed, we still want to log it
        if request.path not in ['/', '/_health', '/api/health']:
            print(f"[CORS] Denied: {request.method} {request.path} from {origin}", flush=True)

    return response


@app.before_request
def handle_preflight():
    """Handle CORS preflight OPTIONS requests early."""
    if request.method == 'OPTIONS':
        origin = request.headers.get('Origin')

        is_allowed = is_origin_allowed(origin, exact_allowed_origins, preview_origin_patterns)
        print(f"[CORS PREFLIGHT] Path: {request.path}, Origin: {origin}, Allowed: {is_allowed}", flush=True)

        # Always return a normal preflight response.
        # apply_cors_headers will attach Access-Control-Allow-Origin only for allowed origins.
        response = jsonify({'status': 'ok'})
        return apply_cors_headers(response, origin), 200
    return None


@app.after_request
def add_cors_headers(response):
    """Add CORS headers to all outgoing responses that didn't come from handle_preflight."""
    # If the response already has the header (e.g. from handle_preflight or error handler), don't duplicate
    if 'Access-Control-Allow-Origin' in response.headers:
        return response
        
    return apply_cors_headers(response, request.headers.get('Origin'))


@app.errorhandler(401)
def handle_401(e):
    response = jsonify({'error': 'Unauthorized', 'message': str(e), 'status': 401})
    response.status_code = 401
    return apply_cors_headers(response, request.headers.get('Origin'))


@app.errorhandler(403)
def handle_403(e):
    response = jsonify({'error': 'Forbidden', 'message': str(e), 'status': 403})
    response.status_code = 403
    return apply_cors_headers(response, request.headers.get('Origin'))


@app.errorhandler(404)
def handle_404(e):
    origin = request.headers.get('Origin')
    print(f"[ERROR 404] {request.path} (Origin: {origin})", flush=True)
    response = jsonify({'error': 'Not found', 'status': 404})
    response.status_code = 404
    return apply_cors_headers(response, origin)


@app.errorhandler(500)
def handle_500(e):
    print(f"[ERROR 500] {str(e)}", flush=True)
    response = jsonify({'error': 'Internal server error', 'status': 500})
    response.status_code = 500
    return apply_cors_headers(response, request.headers.get('Origin'))


@app.errorhandler(413)
def handle_413(e):
    response = jsonify({
        'error': 'Payload Too Large',
        'message': 'The uploaded images may be too large. Please try with smaller files.',
        'status': 413
    })
    response.status_code = 413
    return apply_cors_headers(response, request.headers.get('Origin'))


@app.errorhandler(Exception)
def handle_exception(e):
    """Catch-all exception handler with CORS support"""
    from werkzeug.exceptions import HTTPException
    
    origin = request.headers.get('Origin')
    
    if isinstance(e, HTTPException):
        resp = e.get_response()
        return apply_cors_headers(resp, origin)

    # Handle non-HTTP exceptions
    print(f"[EXCEPTION] {str(e)}", flush=True)
    response = jsonify({
        'error': 'Unexpected Error',
        'message': str(e)[:200],
        'status': 500
    })
    response.status_code = 500
    return apply_cors_headers(response, origin)
def health_check():
    try:
        conn = get_db()
        cur = conn.cursor()
        user_email_table = get_user_email_table(cur)
        applicant_email_table = get_applicant_email_table(cur)
        cur.execute(
            f'''
            SELECT (
                (SELECT COUNT(*) FROM {user_email_table}) +
                (SELECT COUNT(*) FROM {applicant_email_table})
            ) AS count
            '''
        )
        count = cur.fetchone()['count']
        cur.close()
        conn.close()
        return {
            'status': 'healthy',
            'database': 'connected',
            'email_table_records': count,
            'services': ['student-api', 'admin-api'],
        }, 200
    except Exception as exc:
        db_config = get_db_display_config()
        return {
            'status': 'unhealthy',
            'error': str(exc),
            'config': {
                'host': db_config['host'],
                'port': db_config['port'],
                'dbname': db_config['dbname'],
                'schema': db_config['schema'],
                'sslmode': db_config['sslmode'],
            },
        }, 500


@app.route('/api/cors-test', methods=['GET', 'OPTIONS'])
def cors_test():
    """Simple endpoint to test CORS configuration"""
    return jsonify({'message': 'CORS test successful', 'origin': request.headers.get('Origin')}), 200


@app.route('/api/debug/cors', methods=['GET', 'OPTIONS'])
def debug_cors():
    """Debug endpoint - shows configured CORS origins"""
    return jsonify({
        'message': 'CORS debug info',
        'request_origin': request.headers.get('Origin'),
        'allowed_exact_origins': exact_allowed_origins,
        'allowed_regex_patterns': [str(p.pattern) for p in preview_origin_patterns]
    }), 200


@app.route('/_status')
def status():
    return jsonify({
        'service': 'iskomats-combined-backend',
        'status': 'ok',
        'studentPortal': '/',
        'adminApi': '/api/admin',
        'studentApi': '/api/student',
        'uptime': time.time() - STARTUP_TIME
    }), 200


@app.route('/_health', methods=['GET', 'OPTIONS'])
def health():
    """Simple health check endpoint (no dependencies)"""
    return jsonify({
        'status': 'healthy',
        'version': '1.0',
        'timestamp': time.time(),
        'uptime': time.time() - STARTUP_TIME
    }), 200


@app.route('/api/health', methods=['GET', 'OPTIONS'])
@app.route('/api/student/health', methods=['GET', 'OPTIONS'])
def api_health():
    """Detailed health check with database verification"""
    health_info = {
        'status': 'healthy',
        'timestamp': time.time(),
        'uptime': time.time() - STARTUP_TIME,
        'components': {
            'api': 'ready',
            'cors': 'enabled',
            'socketio': 'enabled'
        }
    }
    
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('SELECT 1;')
        cur.close()
        conn.close()
        health_info['components']['database'] = 'connected'
    except Exception as e:
        health_info['status'] = 'degraded'
        health_info['components']['database'] = f'error: {str(e)[:100]}'
    
    status_code = 200 if health_info['status'] == 'healthy' else 503
    return jsonify(health_info), status_code


if __name__ == '__main__':
    try:
        # Debug environment
        for env_key in ['PORT', 'RENDER', 'RENDER_SERVICE_NAME', 'RENDER_INSTANCE_ID']:
            if env_key in os.environ:
                print(f"[DEBUG] {env_key}={os.environ[env_key]}", flush=True)
                
        port_env = os.environ.get('PORT')
        if not port_env:
            print("[WARNING] PORT environment variable not found. Defaulting to 10000.", flush=True)
        else:
            print(f"[INFO] PORT environment variable found: {port_env}", flush=True)
            
        port = int(os.environ.get('PORT', '10000'))
        host = os.environ.get('HOST', '0.0.0.0')
        print(f"\n{'='*60}", flush=True)
        print(f"[STARTUP] Starting ISKOMATS Backend on {host}:{port}", flush=True)
        print(f"[STARTUP] Startup time: {time.time() - STARTUP_TIME:.2f}s", flush=True)
        print(f"[STARTUP] Environment: {os.environ.get('ENVIRONMENT', 'development')}", flush=True)
        print(f"[STARTUP] CORS Origins configured: {len(exact_allowed_origins)} exact + {len(preview_origin_patterns)} patterns", flush=True)
        print(f"[STARTUP] Allowed origins: {exact_allowed_origins[:3]}...", flush=True)
        print(f"{'='*60}\n", flush=True)
        
        APP_READY = True
        print(f"[STARTUP] App initialization complete. Listening on {host}:{port}", flush=True)
        
        socketio.run(app, 
                    debug=False, 
                    port=port, 
                    host=host,
                    allow_unsafe_werkzeug=True)
    except Exception as startup_error:
        APP_STARTUP_ERROR = str(startup_error)
        print(f"[STARTUP ERROR] {APP_STARTUP_ERROR}", flush=True)
        sys.exit(1)

