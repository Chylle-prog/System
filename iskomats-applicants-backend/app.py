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
CORS(app, origins=origins)


app.register_blueprint(student_api_bp, url_prefix='/api/student')

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
