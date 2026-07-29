import sys
import os
import requests

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from project_config import get_db

def main():
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM applicant_documents WHERE applicant_no = 1")
        row = cursor.fetchone()
        
        for k, v in row.items():
            if isinstance(v, str) and v.startswith('http'):
                try:
                    resp = requests.get(v, timeout=5)
                    data = resp.content
                    is_enc = data.startswith(b'ENC:')
                    first_bytes = data[:20]
                    print(f"Field: {k}")
                    print(f"  URL: {v}")
                    print(f"  Status: {resp.status_code}, Length: {len(data)} bytes")
                    print(f"  Is Encrypted (ENC:): {is_enc}")
                    print(f"  First 20 bytes: {first_bytes}\n")
                except Exception as e:
                    print(f"Field: {k} ERROR: {e}\n")

if __name__ == '__main__':
    main()
