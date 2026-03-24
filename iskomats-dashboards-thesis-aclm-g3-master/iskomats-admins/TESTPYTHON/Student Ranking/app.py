import os
import re
import sys

import psycopg2
from flask import Flask, request
from flask_cors import CORS
from flask_socketio import SocketIO

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(CURRENT_DIR)
if CURRENT_DIR not in sys.path:
    sys.path.append(CURRENT_DIR)
if PROJECT_DIR not in sys.path:
    sys.path.append(PROJECT_DIR)

from api_routes import api_bp, init_socketio
from project_config import get_db as base_get_db, get_db_display_config


def get_allowed_origins():
    configured = os.environ.get(
        'CORS_ORIGINS',
        'http://localhost:5173,http://localhost:3000,http://localhost:5174,https://cozy-kulfi-35f772.netlify.app,https://system-kjbv.onrender.com',
    )
    origins = [origin.strip() for origin in configured.split(',') if origin.strip()]
    preview_patterns = []

    for origin in origins:
        if origin.endswith('.netlify.app') and '--' not in origin:
            host = origin.removeprefix('https://').removeprefix('http://')
            preview_patterns.append(re.compile(rf"https://.*--{re.escape(host)}$"))

    return origins + preview_patterns


def split_allowed_origins(origins):
    exact_origins = []
    regex_origins = []

    for origin in origins:
        if hasattr(origin, 'match'):
            regex_origins.append(origin)
        else:
            exact_origins.append(origin)

    return exact_origins, regex_origins


def is_origin_allowed(origin, exact_origins, regex_origins):
    if not origin:
        return False

    if origin in exact_origins:
        return True

    return any(pattern.match(origin) for pattern in regex_origins)


def get_db():
    try:
        conn = base_get_db()
        db_config = get_db_display_config()
        print(
            f"Connected to {db_config['dbname']} at "
            f"{db_config['host']}:{db_config['port']} ({db_config['sslmode']})"
        )
        return conn
    except psycopg2.OperationalError as exc:
        db_config = get_db_display_config()
        print(f"Database Connection Error: {exc}")
        print(f"  Config: {db_config['host']}:{db_config['port']}/{db_config['dbname']}")
        raise Exception(f"Cannot connect to database: {exc}")


app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'development-key-replace-in-production')

allowed_origins = get_allowed_origins()
exact_allowed_origins, preview_origin_patterns = split_allowed_origins(allowed_origins)

CORS(app, resources={r"/api/*": {"origins": exact_allowed_origins}})

socketio = SocketIO(app, cors_allowed_origins=allowed_origins)
app.register_blueprint(api_bp)
init_socketio(socketio)


@app.after_request
def add_cors_headers(response):
    origin = request.headers.get('Origin')

    if request.path.startswith('/api/') and is_origin_allowed(origin, exact_allowed_origins, preview_origin_patterns):
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Headers'] = request.headers.get(
            'Access-Control-Request-Headers',
            'Content-Type, Authorization'
        )
        response.headers['Access-Control-Allow-Methods'] = 'DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT'
        response.headers['Vary'] = 'Origin'

    return response


@app.route('/')
def index():
    return {
        'service': 'iskomats-admin-api',
        'status': 'ok',
    }, 200


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


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '5001'))
    print(f"Starting Admin Backend on Port {port}...")
    socketio.run(app, debug=False, port=port, host='0.0.0.0')

