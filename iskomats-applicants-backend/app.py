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
# Using Flask-CORS for standard handling, but we'll also use an after_request for safety
CORS(app, 
     resources={r"/api/*": {"origins": [
         "https://iskomats-applicants.surge.sh",
         "https://iskomats-admin.surge.sh",
         "https://foregoing-giants.surge.sh",
         "http://localhost:5173",
         "http://localhost:3000"
     ]}},
     supports_credentials=True,
     expose_headers=["Content-Type", "Authorization"],
     allow_headers=["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin"],
     methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"])

app.register_blueprint(student_api_bp, url_prefix='/api/student')

# --- CORS Safety Net ---

@app.after_request
def add_cors_headers(response):
    origin = request.headers.get('Origin')
    if origin:
        # If origin is one of our trusted patterns, ensure headers are present
        if "surge.sh" in origin or "localhost" in origin:
            response.headers['Access-Control-Allow-Origin'] = origin
            response.headers['Access-Control-Allow-Credentials'] = 'true'
            # Prevent duplication of headers if flask-cors already added them
            if 'Access-Control-Allow-Methods' not in response.headers:
                response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS, PATCH'
            if 'Access-Control-Allow-Headers' not in response.headers:
                response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Requested-With, Accept, Origin'
    
    response.headers['Vary'] = 'Origin'
    return response

# Explicitly handle OPTIONS for ALL routes to ensure preflights never 404
@app.route('/', defaults={'path': ''}, methods=['OPTIONS'])
@app.route('/<path:path>', methods=['OPTIONS'])
def global_options_handler(path):
    response = app.make_default_response("")
    return add_cors_headers(response), 200

# --- Health Check Endpoints ---
@app.route('/_health', methods=['GET'])
@app.route('/health', methods=['GET'])
@app.route('/api/health', methods=['GET'])
def health_check():
    return 'ok', 200

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
