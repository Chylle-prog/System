import sys
import os

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from project_config import get_db

def main():
    print("Checking database records for Applicant #1...")
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Check applicant_documents table
        cursor.execute("SELECT * FROM applicant_documents WHERE applicant_no = 1")
        doc_row = cursor.fetchone()
        print("\n--- APPLICANT_DOCUMENTS ROW FOR APPLICANT 1 ---")
        if doc_row:
            for k, v in doc_row.items():
                if isinstance(v, str) and len(v) > 100:
                    print(f"  {k}: [STRING len={len(v)}] {v[:80]}...")
                elif isinstance(v, bytes):
                    print(f"  {k}: [BYTES len={len(v)}]")
                else:
                    print(f"  {k}: {v}")
        else:
            print("  No row found in applicant_documents table for applicant_no = 1")

        # Check applicants table
        cursor.execute("SELECT * FROM applicants WHERE applicant_no = 1")
        app_row = cursor.fetchone()
        print("\n--- APPLICANTS ROW FOR APPLICANT 1 ---")
        if app_row:
            for k, v in app_row.items():
                if 'doc' in k or 'photo' in k or 'vid' in k or 'url' in k:
                    if isinstance(v, str) and len(v) > 100:
                        print(f"  {k}: [STRING len={len(v)}] {v[:80]}...")
                    else:
                        print(f"  {k}: {v}")
        else:
            print("  No row found in applicants table for applicant_no = 1")

if __name__ == '__main__':
    main()
