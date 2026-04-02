import eventlet
eventlet.monkey_patch()
import os
import sys

# Force unbuffered output for Render logs
sys.stdout.reconfigure(line_buffering=True)

print("[STARTUP] 1. eventlet monkey_patch complete. Loading modules...", flush=True)

# Deployment trigger: 2026-04-01 - Force redeploy for STUDENT_FRONTEND_URL
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

print("[STARTUP] Initializing SocketIO...")
socketio = SocketIO(app, cors_allowed_origins=allowed_origins)

print("[STARTUP] Registering blueprints...")
app.register_blueprint(admin_bp)
app.register_blueprint(student_api_bp)

register_admin_routes(app)
init_admin_socketio(socketio)


@app.route('/')
def index():
    return jsonify({
        'service': 'iskomats-combined-backend',
        'status': 'ok',
        'frontend': 'react',
        'adminApi': '/api/admin',
        'studentApi': '/api/student',
    }), 200


@app.before_request
def handle_preflight():
    if request.method == 'OPTIONS':
        origin = request.headers.get('Origin')
        is_allowed = origin and is_origin_allowed(origin, exact_allowed_origins, preview_origin_patterns)
        
        # Log preflight requests for debugging
        print(f"[CORS] Preflight OPTIONS for: {request.path}")
        print(f"       Origin: {origin}")
        print(f"       Allowed: {is_allowed}", flush=True)

        if is_allowed:
            response = jsonify({'status': 'ok'})
            response.headers['Access-Control-Allow-Origin'] = origin
            response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, PATCH, OPTIONS'
            # Allow any headers the browser requested
            requested_headers = request.headers.get('Access-Control-Request-Headers')
            if requested_headers:
                response.headers['Access-Control-Allow-Headers'] = requested_headers
            else:
                response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, Accept, X-Requested-With'
            response.headers['Access-Control-Max-Age'] = '86400'
            response.headers['Access-Control-Allow-Credentials'] = 'true'
            return response, 200
        else:
            # Rejection - still add CORS headers if origin exists so browser shows 403 instead of "No header"
            response = jsonify({'error': 'CORS policy: origin not allowed', 'requested_origin': origin})
            if origin:
                response.headers['Access-Control-Allow-Origin'] = origin
                response.headers['Vary'] = 'Origin'
            response.status_code = 403
            return response, 403
    return None


@app.after_request
def add_cors_headers(response):
    origin = request.headers.get('Origin')
    
    if origin and is_origin_allowed(origin, exact_allowed_origins, preview_origin_patterns):
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Methods'] = 'DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT'
        response.headers['Access-Control-Allow-Headers'] = request.headers.get(
            'Access-Control-Request-Headers',
            'Content-Type, Authorization, Accept, X-Requested-With'
        )
        response.headers['Access-Control-Allow-Credentials'] = 'true'
        response.headers['Vary'] = 'Origin'

    return response


@app.errorhandler(401)
def handle_401(e):
    origin = request.headers.get('Origin')
    response = jsonify({'error': 'Unauthorized', 'message': str(e)})
    response.status_code = 401
    if origin and is_origin_allowed(origin, exact_allowed_origins, preview_origin_patterns):
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Vary'] = 'Origin'
        response.headers['Access-Control-Allow-Credentials'] = 'true'
    return response


@app.errorhandler(403)
def handle_403(e):
    origin = request.headers.get('Origin')
    response = jsonify({'error': 'Forbidden', 'message': str(e)})
    response.status_code = 403
    if origin and is_origin_allowed(origin, exact_allowed_origins, preview_origin_patterns):
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Vary'] = 'Origin'
        response.headers['Access-Control-Allow-Credentials'] = 'true'
    return response


@app.errorhandler(404)
def handle_404(e):
    origin = request.headers.get('Origin')
    response = jsonify({'error': 'Not found', 'path': request.path})
    response.status_code = 404
    if origin and is_origin_allowed(origin, exact_allowed_origins, preview_origin_patterns):
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Vary'] = 'Origin'
        response.headers['Access-Control-Allow-Credentials'] = 'true'
    return response


@app.errorhandler(500)
def handle_500(e):
    origin = request.headers.get('Origin')
    response = jsonify({'error': 'Internal server error'})
    response.status_code = 500
    if origin and is_origin_allowed(origin, exact_allowed_origins, preview_origin_patterns):
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Vary'] = 'Origin'
        response.headers['Access-Control-Allow-Credentials'] = 'true'
    return response


@app.errorhandler(413)
def handle_413(e):
    origin = request.headers.get('Origin')
    response = jsonify({'error': 'Payload Too Large', 'message': 'The uploaded images may be too large. Please try again with smaller files.'})
    response.status_code = 413
    if origin and is_origin_allowed(origin, exact_allowed_origins, preview_origin_patterns):
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Vary'] = 'Origin'
        response.headers['Access-Control-Allow-Credentials'] = 'true'
    return response


@app.errorhandler(Exception)
def handle_exception(e):
    # Pass through HTTP errors
    from werkzeug.exceptions import HTTPException
    if isinstance(e, HTTPException):
        origin = request.headers.get('Origin')
        resp = e.get_response()
        if origin and is_origin_allowed(origin, exact_allowed_origins, preview_origin_patterns):
            resp.headers['Access-Control-Allow-Origin'] = origin
            resp.headers['Vary'] = 'Origin'
            resp.headers['Access-Control-Allow-Credentials'] = 'true'
        return resp

    # Handle non-HTTP exceptions
    origin = request.headers.get('Origin')
    response = jsonify({'error': 'Unexpected Error', 'message': str(e)})
    response.status_code = 500
    if origin and is_origin_allowed(origin, exact_allowed_origins, preview_origin_patterns):
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Vary'] = 'Origin'
        response.headers['Access-Control-Allow-Credentials'] = 'true'
    return response
def health_check():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('SELECT COUNT(*) FROM email;')
        count = cur.fetchone()[0]
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
    }), 200


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '5003'))
    print(f'Starting combined ISKOMATS backend on port {port}...')
    socketio.run(app, debug=False, port=port, host='0.0.0.0')

