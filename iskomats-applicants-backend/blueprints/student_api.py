from flask import Blueprint

student_api_bp = Blueprint('student_api', __name__)

# Example applicant-only endpoint
@student_api_bp.route('/ping')
def ping():
    return {'message': 'pong'}
