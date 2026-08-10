import sys
import os
from dotenv import load_dotenv

backend_dir = r"c:\Users\Chyle\OneDrive\Desktop\System\iskomats-applicants-backend"
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

load_dotenv(os.path.join(backend_dir, ".env"))

from project_config import get_db

def check_schema():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'applicants' ORDER BY ordinal_position")
    cols = cur.fetchall()
    print("APPLICANTS COLUMNS:")
    for c in cols:
        print(f"  {c['column_name']} ({c['data_type']})")
    
    cur.execute("SELECT applicant_no, first_name, last_name, school FROM applicants LIMIT 10")
    print("\nSAMPLE APPLICANT ROWS:")
    for row in cur.fetchall():
        print(dict(row))
    cur.close()
    conn.close()

if __name__ == "__main__":
    check_schema()
