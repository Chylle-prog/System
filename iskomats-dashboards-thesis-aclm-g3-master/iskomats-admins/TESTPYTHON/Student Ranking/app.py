import os

from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO

from blueprints import admin_bp, init_admin_socketio, register_admin_routes, student_api_bp
from services.auth_service import get_allowed_origins, get_secret_key, is_origin_allowed, split_allowed_origins
from services.db_service import get_db, get_db_display_config


app = Flask(__name__)
app.secret_key = get_secret_key()

allowed_origins = get_allowed_origins()
exact_allowed_origins, preview_origin_patterns = split_allowed_origins(allowed_origins)

# Simplified CORS configuration - use manual handlers for more control
CORS(app, resources={r"/api/*": {"origins": exact_allowed_origins, "supports_credentials": True}}, allow_headers=['Content-Type', 'Authorization'])

socketio = SocketIO(app, cors_allowed_origins=allowed_origins)

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
        if is_origin_allowed(origin, exact_allowed_origins, preview_origin_patterns):
            response = jsonify({'status': 'ok'})
            response.headers['Access-Control-Allow-Origin'] = origin
            response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, PATCH, OPTIONS'
            response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, Accept'
            response.headers['Access-Control-Max-Age'] = '86400'
            response.headers['Access-Control-Allow-Credentials'] = 'true'
            return response, 200
    return None


@app.after_request
def add_cors_headers(response):
    origin = request.headers.get('Origin')
    
    # Always add CORS headers for API endpoints if origin is allowed
    if is_origin_allowed(origin, exact_allowed_origins, preview_origin_patterns):
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Methods'] = 'DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT'
        response.headers['Access-Control-Allow-Headers'] = request.headers.get(
            'Access-Control-Request-Headers',
            'Content-Type, Authorization, Accept'
        )
        response.headers['Access-Control-Allow-Credentials'] = 'true'
        response.headers['Vary'] = 'Origin'

    return response


@app.route('/api/health')
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

