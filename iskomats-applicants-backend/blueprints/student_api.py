from flask import Blueprint

student_api_bp = Blueprint('student_api', __name__)

# Example applicant-only endpoint
@student_api_bp.route('/ping')
def ping():
    return {'message': 'pong'}

# Placeholder POST handler for Google OAuth

from flask import request, jsonify
import jwt
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
import os
from datetime import datetime, timedelta


# Google OAuth login endpoint
@student_api_bp.route('/auth/google', methods=['POST'])
def google_auth():
    data = request.get_json()
    id_token_str = data.get('idToken')
    if not id_token_str:
        return jsonify({"error": "Missing idToken"}), 400

    try:
        # Specify your Google Client ID here
        GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', 'YOUR_GOOGLE_CLIENT_ID')
        idinfo = id_token.verify_oauth2_token(
            id_token_str,
            google_requests.Request(),
            GOOGLE_CLIENT_ID
        )
        # idinfo contains user's Google account info
        email = idinfo.get('email')
        first_name = idinfo.get('given_name', '')
        last_name = idinfo.get('family_name', '')
        # You can add DB lookup/creation here
    except Exception as e:
        return jsonify({"error": f"Invalid Google ID token: {str(e)}"}), 401

    # Generate JWT token for the user
    jwt_secret = os.environ.get('JWT_SECRET', 'replace-this-in-production')
    payload = {
        'email': email,
        'first_name': first_name,
        'last_name': last_name,
        'iat': datetime.utcnow(),
        'exp': datetime.utcnow() + timedelta(days=7),
    }
    token = jwt.encode(payload, jwt_secret, algorithm='HS256')

    return jsonify({
        "token": token,
        "email": email,
        "first_name": first_name,
        "last_name": last_name,
        "status": "ok"
    })
