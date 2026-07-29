import sys
import os
import requests

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from project_config import get_db

def main():
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT enrollment_certificate_doc FROM applicant_documents WHERE applicant_no = 1")
        row = cursor.fetchone()
        url = row['enrollment_certificate_doc']
        print(f"Supabase COE URL stored in DB:\n  {url}\n")
        
        # Test direct HTTP request to Supabase URL
        resp = requests.get(url, timeout=10)
        print(f"Direct GET Status: {resp.status_code}")
        print(f"Content Length: {len(resp.content)} bytes")
        print(f"Content-Type: {resp.headers.get('Content-Type')}")
        print(f"First 50 bytes (Magic bytes): {resp.content[:50]}")

if __name__ == '__main__':
    main()
