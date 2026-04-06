import json
import urllib.request
import urllib.parse
import webbrowser
import http.server
import socketserver
from urllib.parse import urlparse, parse_qs

# Global variable to store intercepted auth code
intercepted_code = None

class AuthorizationHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        global intercepted_code
        self.send_response(200)
        self.send_header('Content-Type', 'text/html')
        self.end_headers()
        
        query_components = parse_qs(urlparse(self.path).query)
        if 'code' in query_components:
            intercepted_code = query_components['code'][0]
            self.wfile.write(b"<html><body><h1>Authorization Successful!</h1><p>You can close this tab and return to your terminal.</p></body></html>")
        else:
            self.wfile.write(b"<html><body><h1>Authorization Failed!</h1><p>Check the terminal for details.</p></body></html>")

    def log_message(self, format, *args):
        # Suppress logging to keep terminal clean
        return

def main():
    print("\n--- Google OAuth 2.0 Refresh Token Generator ---")
    print("This script will help you generate a fresh GOOGLE_REFRESH_TOKEN.")
    
    client_id = input("\nEnter your GOOGLE_CLIENT_ID: ").strip()
    client_secret = input("Enter your GOOGLE_CLIENT_SECRET: ").strip()
    
    # Scopes and Redirect URI
    scopes = "https://www.googleapis.com/auth/gmail.send"
    redirect_uri = "http://localhost:8080/"
    
    # 1. Generate the authorization URL
    auth_params = {
        'client_id': client_id,
        'redirect_uri': redirect_uri,
        'response_type': 'code',
        'scope': scopes,
        'access_type': 'offline',
        'prompt': 'consent'
    }
    
    auth_url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(auth_params)
    
    print("\n1. Visit the following URL in your browser and authorize the app:")
    print(f"\n{auth_url}\n")
    
    # Attempt to open browser automatically
    try:
        webbrowser.open(auth_url)
    except:
        pass
        
    print("2. Waiting for browser redirect to http://localhost:8080/...")
    
    # 2. Start a temporary local server to intercept the code
    with socketserver.TCPServer(("", 8080), AuthorizationHandler) as httpd:
        while intercepted_code is None:
            httpd.handle_request()
    
    print(f"\n✅ Authorization code intercepted: {intercepted_code[:10]}...")
    
    # 3. Exchange authorization code for refresh token
    token_params = {
        'code': intercepted_code,
        'client_id': client_id,
        'client_secret': client_secret,
        'redirect_uri': redirect_uri,
        'grant_type': 'authorization_code'
    }
    
    print("\n3. Exchanging code for tokens...")
    
    token_request_body = urllib.parse.urlencode(token_params).encode('utf-8')
    token_request = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=token_request_body,
        headers={'Content-Type': 'application/x-www-form-urlencoded'},
        method='POST'
    )
    
    try:
        with urllib.request.urlopen(token_request, timeout=30) as response:
            payload = json.loads(response.read().decode('utf-8'))
            
        refresh_token = payload.get('refresh_token')
        
        if refresh_token:
            print("\n✅ SUCCESS! Your NEW GOOGLE_REFRESH_TOKEN is:")
            print("-" * 60)
            print(refresh_token)
            print("-" * 60)
            print("\nCopy this value and update it in your Render Environment Variables.")
        else:
            print("\n❌ Error: Refresh token not found. This can happen if you didn't grant the proper scopes.")
            print(f"Response: {payload}")
            
    except Exception as e:
        print(f"\n❌ Error during token exchange: {e}")
        try:
            if hasattr(e, 'read'):
                print(f"Server response: {e.read().decode('utf-8')}")
        except:
            pass

if __name__ == "__main__":
    main()
