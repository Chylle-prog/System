import os

from flask import Flask, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO

from api_routes import api_bp, init_socketio
from project_config import get_db, get_db_display_config


app = Flask(__name__)

allowed_origins = [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
    'https://foregoing-giants.surge.sh',
]

CORS(
    app,
    resources={r'/api/*': {'origins': allowed_origins}},
    allow_headers=['Content-Type', 'Authorization', 'Access-Control-Allow-Origin'],
    methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    supports_credentials=True,
)

app.register_blueprint(api_bp)

socketio = SocketIO(app, cors_allowed_origins=allowed_origins)
init_socketio(socketio)

app.secret_key = os.environ.get('SECRET_KEY', 'development-key-replace-in-production')


@app.route('/')
def index():
    return jsonify({
        'service': 'iskomats-applicant-backend',
        'status': 'ok',
        'frontend': 'react',
        'api': '/api',
    }), 200


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
            'services': ['applicant-api'],
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
    port = int(os.environ.get('PORT', '5000'))
    print(f'Starting ISKOMATS applicant backend on port {port}...')
    socketio.run(app, debug=False, port=port, host='0.0.0.0')
