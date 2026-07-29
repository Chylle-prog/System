import sys
import os

# Add parent dir to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from project_config import get_db

def inspect():
    with get_db() as conn:
        cur = conn.cursor()
        
        # 1. Active Scholarships
        cur.execute("SELECT req_no, scholarship_name, pro_no, slots, is_removed FROM scholarships WHERE COALESCE(is_removed, FALSE) = FALSE")
        scholarships = cur.fetchall()
        print("=== SCHOLARSHIPS ===")
        for s in scholarships:
            print(dict(s))
            
        # 2. Columns of applicants table
        cur.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'applicants'")
        print("\n=== APPLICANTS COLUMNS ===")
        for c in cur.fetchall():
            print(f"  {c['column_name']}: {c['data_type']}")

        # 3. Columns of applicant_emails table
        cur.execute("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name LIKE '%applicant%email%'")
        print("\n=== APPLICANT EMAILS COLUMNS ===")
        for c in cur.fetchall():
            print(f"  {c['table_name']} . {c['column_name']}: {c['data_type']}")

        # 4. Columns of applicant_status table
        cur.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'applicant_status'")
        print("\n=== APPLICANT STATUS COLUMNS ===")
        for c in cur.fetchall():
            print(f"  {c['column_name']}: {c['data_type']}")

        # 5. Columns of applicant_documents table
        cur.execute("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name LIKE '%applicant%doc%'")
        print("\n=== APPLICANT DOCUMENTS COLUMNS ===")
        for c in cur.fetchall():
            print(f"  {c['table_name']} . {c['column_name']}: {c['data_type']}")

if __name__ == '__main__':
    inspect()
