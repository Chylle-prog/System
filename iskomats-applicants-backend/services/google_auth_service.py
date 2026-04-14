from google.oauth2 import id_token
from google.auth.transport import requests
import os

def verify_google_token(token):
    """
    Verifies a Google ID Token.
    Returns the user information if valid, raises an exception otherwise.
    """
    CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID')
    if not CLIENT_ID:
        raise Exception("GOOGLE_CLIENT_ID not configured on server")
        
    try:
        # Verify the ID token using the official Google library
        idinfo = id_token.verify_oauth2_token(token, requests.Request(), CLIENT_ID)
        
        # Verify the issuer if it's from Google
        if idinfo['iss'] not in ['accounts.google.com', 'https://accounts.google.com']:
            raise ValueError('Wrong issuer.')
            
        # Success: Return the user profile information
        return {
            'email': idinfo.get('email'),
            'first_name': idinfo.get('given_name', 'Student'),
            'last_name': idinfo.get('family_name', 'User'),
            'profile_picture': idinfo.get('picture'),
            'email_verified': idinfo.get('email_verified', False)
        }
    except Exception as e:
        print(f"[GOOGLE AUTH] Validation failed: {str(e)}")
        raise e
