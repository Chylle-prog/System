# Entry point for applicants backend

from blueprints.student_api import student_api_bp
from flask import Flask
from flask_caching import Cache
from flask_cors import CORS
import os


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
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', ','.join(origins))
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

# Explicit OPTIONS handler for Google Auth endpoint
@app.route('/api/student/auth/google', methods=['OPTIONS'])
def options_handler():
    return '', 200

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
