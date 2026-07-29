import requests
import sys

def main():
    # Test the live Render backend proxy endpoint
    # We'll need a valid token - try without one first to see the error
    base_url = "https://iskomats-backend.onrender.com/api/student"
    
    print("Testing Render backend availability...")
    try:
        resp = requests.get(f"{base_url}/applicant/document/raw/enrollment_certificate_doc", 
                          timeout=15)
        print(f"Status without token: {resp.status_code}")
    except Exception as e:
        print(f"Connection error: {e}")

if __name__ == '__main__':
    main()
