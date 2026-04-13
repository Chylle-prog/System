# Entry point for applicants backend

from blueprints.student_api import student_api_bp
from flask import Flask
from flask_caching import Cache
from flask_cors import CORS
import os
from flask import request


app = Flask(__name__)
app.config['CACHE_TYPE'] = 'SimpleCache'
cache = Cache(app)

# Setup CORS
origins = os.environ.get("CORS_ORIGINS", "").split(",")
origins = [o.strip() for o in origins if o.strip()]
if not origins:
    origins = [
        "https://iskomats-applicants.surge.sh",
        "https://iskomats-applicants.surge.sh/",
        "http://localhost:5173",
        "http://localhost:3000",
    ]

CORS(app, origins=origins, supports_credentials=True)

app.register_blueprint(student_api_bp, url_prefix='/api/student')

# --- CORS Preflight Fix ---

@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        response = app.make_default_response("")
        return apply_cors_headers(response), 200

@app.after_request
def add_cors_headers(response):
    return apply_cors_headers(response)

def apply_cors_headers(response):
    origin = request.headers.get('Origin')
    response.headers['Vary'] = 'Origin'
    if origin:
        # Check if origin is in our allowed list or matches surge.sh
        is_allowed = origin in origins or origin.endswith('.surge.sh') or origin.endswith('.surge.sh/')
        if is_allowed:
            response.headers['Access-Control-Allow-Origin'] = origin
            response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
            response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Requested-With, Accept'
            response.headers['Access-Control-Allow-Credentials'] = 'true'
            response.headers['Access-Control-Max-Age'] = '86400'
    return response

# Explicit OPTIONS handler for student API routes
@app.route('/api/student/<path:path>', methods=['OPTIONS'])
def student_options_handler(path):
    response = app.make_default_response("")
    return apply_cors_headers(response), 200

# --- Health Check Endpoints ---
@app.route('/_health', methods=['GET'])
@app.route('/health', methods=['GET'])
@app.route('/api/health', methods=['GET'])
def health_check():
    return 'ok', 200

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
