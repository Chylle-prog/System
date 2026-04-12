# Entry point for applicants backend
from blueprints.student_api import student_api_bp
from flask import Flask
from flask_caching import Cache

app = Flask(__name__)
app.config['CACHE_TYPE'] = 'SimpleCache'
cache = Cache(app)

app.register_blueprint(student_api_bp, url_prefix='/api/student')

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
