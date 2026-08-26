import json
import urllib.request
import urllib.parse
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import os
import sys
from dotenv import load_dotenv

backend_env = r'c:\Users\Chyle\OneDrive\Desktop\System\iskomats-applicants-backend\.env'
load_dotenv(backend_env)

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', '').strip()
CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET', '').strip()
PORT = 8080
REDIRECT_URI = f"http://localhost:{PORT}/"
SCOPES = "https://www.googleapis.com/auth/gmail.send"

intercepted_code = None

class AuthorizationHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        global intercepted_code
        query_components = parse_qs(urlparse(self.path).query)
        if 'code' in query_components:
            intercepted_code = query_components['code'][0]
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            self.wfile.write(b"""
                <html>
                <body style="font-family: system-ui, sans-serif; text-align: center; padding: 60px; background: #0f172a; color: white;">
                    <h1 style="color: #10b981; font-size: 2.2rem;">Authorization Complete!</h1>
                    <p style="font-size: 1.1rem; color: #cbd5e1;">Google OAuth has authorized <b>iskomats@gmail.com</b> successfully.</p>
                    <p style="color: #94a3b8;">You can close this window now. The new token is being saved to your environment.</p>
                </body>
                </html>
            """)
        else:
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            self.wfile.write(b"<html><body><h1>Waiting for Google authorization...</h1></body></html>")

    def log_message(self, format, *args):
        pass

def main():
    print("=" * 65, flush=True)
    print("      GOOGLE GMAIL OAUTH REFRESH TOKEN GENERATOR", flush=True)
    print("=" * 65, flush=True)
    print(f"\nTarget Account: iskomats@gmail.com", flush=True)
    print(f"Client ID: {CLIENT_ID[:20]}...", flush=True)
    print(f"Redirect URI: {REDIRECT_URI}\n", flush=True)

    auth_params = {
        'client_id': CLIENT_ID,
        'redirect_uri': REDIRECT_URI,
        'response_type': 'code',
        'scope': SCOPES,
        'access_type': 'offline',
        'prompt': 'consent',
        'login_hint': 'iskomats@gmail.com'
    }
    
    auth_url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(auth_params)
    
    server = HTTPServer(('localhost', PORT), AuthorizationHandler)
    server.timeout = 180

    print("1. Listening on port 8080 for authorization...", flush=True)
    print("\n2. OPEN THIS LINK IN YOUR BROWSER AND LOG IN AS iskomats@gmail.com:\n", flush=True)
    print("-" * 65, flush=True)
    print(auth_url, flush=True)
    print("-" * 65, flush=True)

    try:
        webbrowser.open(auth_url)
    except:
        pass

    print("\nWaiting for browser redirect...", flush=True)
    while intercepted_code is None:
        server.handle_request()

    print(f"\n[SUCCESS] Authorization code received: {intercepted_code[:12]}...", flush=True)

    print("\n3. Exchanging code for refresh token...", flush=True)
    token_params = {
        'code': intercepted_code,
        'client_id': CLIENT_ID,
        'client_secret': CLIENT_SECRET,
        'redirect_uri': REDIRECT_URI,
        'grant_type': 'authorization_code'
    }

    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=urllib.parse.urlencode(token_params).encode('utf-8'),
        headers={'Content-Type': 'application/x-www-form-urlencoded'},
        method='POST'
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            payload = json.loads(resp.read().decode('utf-8'))
            refresh_token = payload.get('refresh_token')

            if refresh_token:
                print("\n" + "=" * 65, flush=True)
                print(">>> YOUR NEW GOOGLE_REFRESH_TOKEN IS: <<<", flush=True)
                print("=" * 65, flush=True)
                print(f"\n{refresh_token}\n", flush=True)
                print("=" * 65, flush=True)

                env_files = [
                    r'c:\Users\Chyle\OneDrive\Desktop\System\iskomats-applicants-backend\.env',
                    r'c:\Users\Chyle\OneDrive\Desktop\System\iskomats-dashboards-thesis-aclm-g3-master\iskomats-admins\TESTPYTHON\Student Ranking\.env'
                ]
                for ep in env_files:
                    if os.path.exists(ep):
                        with open(ep, 'r', encoding='utf-8') as f:
                            lines = f.readlines()
                        updated = False
                        for i, l in enumerate(lines):
                            if l.startswith('GOOGLE_REFRESH_TOKEN='):
                                lines[i] = f'GOOGLE_REFRESH_TOKEN={refresh_token}\n'
                                updated = True
                                break
                        if not updated:
                            lines.append(f'GOOGLE_REFRESH_TOKEN={refresh_token}\n')
                        with open(ep, 'w', encoding='utf-8') as f:
                            f.writelines(lines)
                        print(f"Updated: {ep}", flush=True)

                print("\n[IMPORTANT] Also paste this GOOGLE_REFRESH_TOKEN into your Render Dashboard environment variables!", flush=True)
            else:
                print(f"\n[WARN] No refresh_token in response: {payload}", flush=True)
    except Exception as e:
        print(f"\n[ERROR] Exchange error: {e}", flush=True)
        if hasattr(e, 'read'):
            print(f"Details: {e.read().decode('utf-8')}", flush=True)

if __name__ == '__main__':
    main()
