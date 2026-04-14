import json
import urllib.request
import urllib.parse
import webbrowser
import http.server
import socketserver
from urllib.parse import urlparse, parse_qs
import os

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
    
    # 1. Get Client Credentials
    client_id = input("\nEnter your GOOGLE_CLIENT_ID: ").strip()
    client_secret = input("Enter your GOOGLE_CLIENT_SECRET: ").strip()
    scopes = "https://www.googleapis.com/auth/gmail.send"
    
    # 2. Try to find an available port for the redirect listener
    ports_to_try = [8080, 8081, 8888]
    httpd = None
    actual_port = None
    
    for port in ports_to_try:
        try:
            # Allow reuse of the address to prevent WinError 10048 (port already in use)
            socketserver.TCPServer.allow_reuse_address = True
            httpd = socketserver.TCPServer(("", port), AuthorizationHandler)
            actual_port = port
            break
        except OSError:
            continue
            
    if not httpd:
        print("\n❌ Error: Could not bind to any of the ports (8080, 8081, 8888).")
        print("Please close any programs that might be using these ports and try again.")
        return

    redirect_uri = f"http://localhost:{actual_port}/"
    if actual_port != 8080:
        print(f"\n⚠️  Port 8080 was busy. Using port {actual_port} instead.")
        print(f"IMPORTANT: Ensure '{redirect_uri}' is added to your Google Redirect URIs!")

    # 3. Generate the authorization URL
    auth_params = {
        'client_id': client_id,
        'redirect_uri': redirect_uri,
        'response_type': 'code',
        'scope': scopes,
        'access_type': 'offline',
        'prompt': 'consent'
    }
    
    auth_url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(auth_params)
    
    print(f"\n1. Visit the following URL in your browser and authorize the app:")
    print(f"\n{auth_url}\n")
    
    # Attempt to open browser automatically
    try:
        webbrowser.open(auth_url)
    except:
        pass
        
    print(f"2. Waiting for browser redirect to {redirect_uri}...")
    
    # Run the server to intercept the code
    with httpd:
        while intercepted_code is None:
            httpd.handle_request()
    
    print(f"\n✅ Authorization code intercepted: {intercepted_code[:10]}...")
    
    # 4. Exchange authorization code for refresh token
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
