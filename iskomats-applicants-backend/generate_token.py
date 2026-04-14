import os
from google_auth_oauthlib.flow import InstalledAppFlow

# Set your scopes (modify these based on what APIs you need)
# The application needs 'gmail.send' to send verification codes and password resets.
SCOPES = [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly'
]

def main():
    # Create the flow using your downloaded client secrets
    if not os.path.exists('client_secret.json'):
        print("Error: 'client_secret.json' not found in this directory.")
        print("Please download it from the Google Cloud Console (Credentials > OAuth 2.0 Client IDs).")
        return

    flow = InstalledAppFlow.from_client_secrets_file(
        'client_secret.json',  # The JSON file you downloaded earlier
        SCOPES
    )
    
    # Run the local server flow
    # This will open a browser window for authentication
    creds = flow.run_local_server(port=8080)
    
    # Print the refresh token for the user to copy into their .env file
    print("\n" + "="*30)
    print("=== YOUR REFRESH TOKEN ===")
    print("="*30)
    print(f"\n{creds.refresh_token}\n")
    print("="*30)
    print("Save this token securely in your .env file as GOOGLE_REFRESH_TOKEN!")

if __name__ == '__main__':
    main()
