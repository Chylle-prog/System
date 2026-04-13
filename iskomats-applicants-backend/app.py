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
# Use a simple, reliable manual handler
ALLOWED_ORIGIN = "https://iskomats-applicants.surge.sh"

app.register_blueprint(student_api_bp, url_prefix='/api/student')

# --- CORS Engine ---

def apply_cors_headers(response):
    origin = request.headers.get('Origin')
    
    # Always allow the primary applicant origin
    # We also allow localhost for development
    target_origin = None
    if origin:
        if "iskomats-applicants.surge.sh" in origin:
            target_origin = origin
        elif "localhost" in origin:
            target_origin = origin
        elif "foregoing-giants.surge.sh" in origin:
            target_origin = origin

    if target_origin:
        response.headers['Access-Control-Allow-Origin'] = target_origin
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS, PATCH'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Requested-With, Accept, Origin'
        response.headers['Access-Control-Allow-Credentials'] = 'true'
        response.headers['Access-Control-Max-Age'] = '86400'
        
    # Always add Vary: Origin for CDN/Proxy compatibility
    response.headers['Vary'] = 'Origin'
    return response

@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        # Create a simple 200 OK response for all preflights under /api
        response = app.make_default_response("")
        return apply_cors_headers(response), 200

@app.after_request
def add_cors_headers(response):
    # Ensure every response gets the headers if valid origin
    return apply_cors_headers(response)

# Explicit OPTIONS handlers for student API routes
@app.route('/api/student/<path:path>', methods=['OPTIONS'])
def student_options_catchall(path):
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
