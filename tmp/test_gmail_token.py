import os
import json
import base64
from urllib import parse, request as urllib_request, error as urllib_error
from dotenv import load_dotenv

# Load .env from the Student Ranking directory
env_path = r'c:\Users\Chyle\OneDrive\Desktop\System\iskomats-dashboards-thesis-aclm-g3-master\iskomats-admins\TESTPYTHON\Student Ranking\.env'
load_dotenv(env_path)

GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID')
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET')
GOOGLE_REFRESH_TOKEN = os.environ.get('GOOGLE_REFRESH_TOKEN')

print(f"Testing Gmail Token for Client ID: {GOOGLE_CLIENT_ID}")

def fetch_google_access_token():
    token_request_body = parse.urlencode({
        'client_id': GOOGLE_CLIENT_ID,
        'client_secret': GOOGLE_CLIENT_SECRET,
        'refresh_token': GOOGLE_REFRESH_TOKEN,
        'grant_type': 'refresh_token',
    }).encode('utf-8')

    token_request = urllib_request.Request(
        'https://oauth2.googleapis.com/token',
        data=token_request_body,
        headers={'Content-Type': 'application/x-www-form-urlencoded'},
        method='POST',
    )

    try:
        with urllib_request.urlopen(token_request, timeout=30) as response:
            payload = json.loads(response.read().decode('utf-8'))
            print("✅ Successfully fetched access token!")
            return True
    except urllib_error.HTTPError as exc:
        response_body = exc.read().decode('utf-8', errors='replace')
        print(f"❌ Google token exchange failed: {response_body}")
        return False
    except Exception as exc:
        print(f"❌ Error: {str(exc)}")
        return False

if __name__ == "__main__":
    fetch_google_access_token()
