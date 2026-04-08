import eventlet
eventlet.monkey_patch()
import os
import sys
import time

# Force unbuffered output for Render logs
sys.stdout.reconfigure(line_buffering=True)

STARTUP_TIME = time.time()
print("[STARTUP] 1. eventlet monkey_patch complete. Loading modules...", flush=True)

# Deployment trigger: 2026-04-08 - CORS TIMEOUT FIX - Better error handling
from flask import Flask, jsonify, request
from flask_socketio import SocketIO

print("[STARTUP] 2. Flask/SocketIO imported. Loading blueprints...", flush=True)
from blueprints import admin_bp, init_admin_socketio, register_admin_routes, student_api_bp

print("[STARTUP] 3. Blueprints imported. Loading services...", flush=True)
from services.auth_service import get_allowed_origins, get_secret_key, is_origin_allowed, split_allowed_origins
from services.db_service import get_db, get_db_display_config

print("[STARTUP] 4. Services imported. Initializing Flask app...", flush=True)
app = Flask(__name__)
app.secret_key = get_secret_key()

allowed_origins = get_allowed_origins()
exact_allowed_origins, preview_origin_patterns = split_allowed_origins(allowed_origins)

# Note: We handle CORS manually in before_request and after_request to have full control
# Don't use CORS() extension - it can conflict with manual handlers

print("[STARTUP] Initializing SocketIO with extended timeouts...")
socketio = SocketIO(
    app, 
    cors_allowed_origins=allowed_origins,
    engineio_logger=True,
    ping_timeout=120,
    ping_interval=30
)

print("[STARTUP] Registering blueprints...")
app.register_blueprint(admin_bp)
app.register_blueprint(student_api_bp)

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


@app.before_request
def handle_preflight():
    """Handle CORS preflight OPTIONS requests"""
    if request.method == 'OPTIONS':
        origin = request.headers.get('Origin')
        is_allowed = origin and is_origin_allowed(origin, exact_allowed_origins, preview_origin_patterns)
        
        # Log preflight requests for debugging
        print(f"[CORS] Preflight OPTIONS for: {request.path}", flush=True)
        print(f"       Origin: {origin}", flush=True)
        print(f"       Allowed: {is_allowed}", flush=True)

        response = jsonify({'status': 'ok'}) if is_allowed else jsonify({'status': 'blocked'})
        
        # ALWAYS add CORS headers to OPTIONS responses
        if origin:
            response.headers['Access-Control-Allow-Origin'] = origin
            response.headers['Vary'] = 'Origin'
        
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, PATCH, OPTIONS'
        
        # Allow requested headers or default comprehensive set
        requested_headers = request.headers.get('Access-Control-Request-Headers')
        if requested_headers:
            response.headers['Access-Control-Allow-Headers'] = requested_headers
        else:
            response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, Accept, X-Requested-With, X-CSRF-Token'
        
        response.headers['Access-Control-Max-Age'] = '86400'
        response.headers['Access-Control-Allow-Credentials'] = 'true'
        
        # Return 200 OK for all preflight requests (even denied ones)
        return response, 200
    return None


@app.after_request
def add_cors_headers(response):
    """Add CORS headers to all responses"""
    origin = request.headers.get('Origin')
    
    # Always add Vary: Origin header to ensure proper caching
    response.headers['Vary'] = 'Origin'
    
    # Add CORS headers if origin is allowed
    if origin and is_origin_allowed(origin, exact_allowed_origins, preview_origin_patterns):
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Methods'] = 'DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT'
        response.headers['Access-Control-Allow-Headers'] = request.headers.get(
            'Access-Control-Request-Headers',
            'Content-Type, Authorization, Accept, X-Requested-With, X-CSRF-Token'
        )
        response.headers['Access-Control-Allow-Credentials'] = 'true'
        response.headers['Access-Control-Max-Age'] = '86400'
    
    # Debug: Log responses with potential CORS issues
    if not response.headers.get('Access-Control-Allow-Origin') and request.method != 'OPTIONS':
        print(f"[CORS] WARNING: No CORS header for response to {request.method} {request.path}", flush=True)
        print(f"       Origin: {origin}", flush=True)

    return response


@app.errorhandler(401)
def handle_401(e):
    origin = request.headers.get('Origin')
    response = jsonify({'error': 'Unauthorized', 'message': str(e), 'status': 401})
    response.status_code = 401
    if origin:
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Vary'] = 'Origin'
        response.headers['Access-Control-Allow-Credentials'] = 'true'
    return response


@app.errorhandler(403)
def handle_403(e):
    origin = request.headers.get('Origin')
    response = jsonify({'error': 'Forbidden', 'message': str(e), 'status': 403})
    response.status_code = 403
    if origin:
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Vary'] = 'Origin'
        response.headers['Access-Control-Allow-Credentials'] = 'true'
    return response


@app.errorhandler(404)
def handle_404(e):
    origin = request.headers.get('Origin')
    response = jsonify({'error': 'Not found', 'path': request.path, 'status': 404})
    response.status_code = 404
    if origin:
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Vary'] = 'Origin'
        response.headers['Access-Control-Allow-Credentials'] = 'true'
    return response


@app.errorhandler(500)
def handle_500(e):
    origin = request.headers.get('Origin')
    print(f"[ERROR 500] {str(e)}", flush=True)
    response = jsonify({'error': 'Internal server error', 'status': 500})
    response.status_code = 500
    if origin:
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Vary'] = 'Origin'
        response.headers['Access-Control-Allow-Credentials'] = 'true'
    return response


@app.errorhandler(413)
def handle_413(e):
    origin = request.headers.get('Origin')
    response = jsonify({
        'error': 'Payload Too Large',
        'message': 'The uploaded images may be too large. Please try with smaller files.',
        'status': 413
    })
    response.status_code = 413
    if origin:
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Vary'] = 'Origin'
        response.headers['Access-Control-Allow-Credentials'] = 'true'
    return response


@app.errorhandler(Exception)
def handle_exception(e):
    """Catch-all exception handler with CORS support"""
    from werkzeug.exceptions import HTTPException
    
    origin = request.headers.get('Origin')
    
    if isinstance(e, HTTPException):
        resp = e.get_response()
        if origin:
            resp.headers['Access-Control-Allow-Origin'] = origin
            resp.headers['Vary'] = 'Origin'
            resp.headers['Access-Control-Allow-Credentials'] = 'true'
        return resp

    # Handle non-HTTP exceptions
    print(f"[EXCEPTION] {str(e)}", flush=True)
    response = jsonify({
        'error': 'Unexpected Error',
        'message': str(e)[:200],
        'status': 500
    })
    response.status_code = 500
    if origin:
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Vary'] = 'Origin'
        response.headers['Access-Control-Allow-Credentials'] = 'true'
    return response
def health_check():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('SELECT COUNT(*) as count FROM email;')
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
        port = int(os.environ.get('PORT', '5003'))
        print(f"\n{'='*60}", flush=True)
        print(f"[STARTUP] Starting ISKOMATS Backend on port {port}", flush=True)
        print(f"[STARTUP] Startup time: {time.time() - STARTUP_TIME:.2f}s", flush=True)
        print(f"[STARTUP] Environment: {os.environ.get('ENVIRONMENT', 'development')}", flush=True)
        print(f"[STARTUP] CORS Origins configured: {len(exact_allowed_origins)} exact + {len(preview_origin_patterns)} patterns", flush=True)
        print(f"[STARTUP] Allowed origins: {exact_allowed_origins[:3]}...", flush=True)
        print(f"{'='*60}\n", flush=True)
        
        APP_READY = True
        print("[STARTUP] App initialization complete. Accepting requests.", flush=True)
        
        socketio.run(app, 
                    debug=False, 
                    port=port, 
                    host='0.0.0.0',
                    allow_unsafe_werkzeug=True)
    except Exception as startup_error:
        APP_STARTUP_ERROR = str(startup_error)
        print(f"[STARTUP ERROR] {APP_STARTUP_ERROR}", flush=True)
        sys.exit(1)

