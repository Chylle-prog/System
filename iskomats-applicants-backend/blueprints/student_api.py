from flask import Blueprint

student_api_bp = Blueprint('student_api', __name__)

# Example applicant-only endpoint
@student_api_bp.route('/ping')
def ping():
    return {'message': 'pong'}


# --- Applicant Profile Endpoint ---
@student_api_bp.route('/applicant/profile', methods=['GET', 'PUT'])
def applicant_profile():
    if request.method == 'GET':
        # Dummy profile data for testing
        return {
            "email": "test@applicant.com",
            "first_name": "Test",
            "last_name": "Applicant",
            "status": "active"
        }
    elif request.method == 'PUT':
        # Accept and echo back the updated profile data for testing
        data = request.get_json()
        # In a real app, save to DB here
        return {"message": "Profile updated successfully", "data": data}

# --- Applications Endpoint ---
@student_api_bp.route('/applications/my-applications', methods=['GET'])
def get_my_applications():
    # Dummy applications data for testing
    return {
        "applications": [
            {"id": 1, "scholarship": "Scholarship A", "status": "pending"},
            {"id": 2, "scholarship": "Scholarship B", "status": "approved"}
        ]
    }

# --- Announcements Endpoint ---
@student_api_bp.route('/announcements', methods=['GET'])
def get_announcements():
    # Dummy announcements data for testing
    return {
        "announcements": [
            {"id": 1, "title": "Welcome!", "content": "Welcome to the portal."}
        ]
    }

# --- Notifications Endpoint ---
@student_api_bp.route('/notifications', methods=['GET'])
def get_notifications():
    # Dummy notifications data for testing
    return {
        "notifications": [
            {"id": 1, "message": "Your application is being processed."}
        ]
    }

# --- Scholarships Endpoint ---
@student_api_bp.route('/scholarships/all', methods=['GET'])
def get_scholarships():
    # Dummy scholarships data for testing
    return {
        "scholarships": [
            {"id": 1, "name": "Scholarship A"},
            {"id": 2, "name": "Scholarship B"}
        ]
    }

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
