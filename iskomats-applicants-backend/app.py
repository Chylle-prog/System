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
if not any(origins):
    # fallback to default if env var is empty
    origins = [
        "https://iskomats-applicants.surge.sh",
        # add other allowed origins here if needed
    ]
CORS(app, origins=origins, supports_credentials=True)



app.register_blueprint(student_api_bp, url_prefix='/api/student')

# --- CORS Preflight Fix ---

# Only set Access-Control-Allow-Origin if not already set by flask-cors
@app.after_request
def after_request(response):
    origin = request.headers.get('Origin')
    if origin and origin in origins:
        response.headers['Access-Control-Allow-Origin'] = origin
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization'
    response.headers['Access-Control-Allow-Methods'] = 'GET,PUT,POST,DELETE,OPTIONS'
    return response

# Explicit OPTIONS handler for Google Auth endpoint
@app.route('/api/student/auth/google', methods=['OPTIONS'])
def options_handler():
    return '', 200

# --- Health Check Endpoint ---
@app.route('/_health', methods=['GET'])
def health_check():
    return 'ok', 200

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
