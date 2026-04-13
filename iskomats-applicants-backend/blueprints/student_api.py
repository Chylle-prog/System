from flask import Blueprint

student_api_bp = Blueprint('student_api', __name__)

# Example applicant-only endpoint
@student_api_bp.route('/ping')
def ping():
    return {'message': 'pong'}

# Placeholder POST handler for Google OAuth
from flask import request, jsonify

@student_api_bp.route('/auth/google', methods=['POST'])
def google_auth():
    # Placeholder logic for Google OAuth
    return jsonify({"status": "ok", "message": "Google OAuth endpoint reached."})
