import os
import sys

import psycopg2
from flask import Flask
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
    return [origin.strip() for origin in configured.split(',') if origin.strip()]


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
CORS(app, resources={r"/api/*": {"origins": allowed_origins}})

socketio = SocketIO(app, cors_allowed_origins=allowed_origins)
app.register_blueprint(api_bp)
init_socketio(socketio)


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

