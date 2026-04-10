import sys
import os
from dotenv import load_dotenv

# Load .env from backend root
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'))

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from project_config import get_db

def check_counts():
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute("SELECT COUNT(*) FROM applicants")
        applicants_count = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM email")
        emails_count = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM scholarship_providers")
        providers_count = cursor.fetchall() # Wait, fetchall for small table
        
        cursor.execute("SELECT COUNT(*) FROM applicant_status")
        status_count = cursor.fetchone()[0]
        
        print(f"Applicants: {applicants_count}")
        print(f"Emails: {emails_count}")
        print(f"Status rows: {status_count}")
        
        cursor.close()
        conn.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_counts()
