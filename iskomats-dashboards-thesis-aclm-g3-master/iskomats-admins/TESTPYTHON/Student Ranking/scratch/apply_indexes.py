import os
from project_config import get_db

def add_indexes():
    conn = get_db()
    cursor = conn.cursor()
    try:
        # Critical Join/Filter Indexes
        indexes = [
            ("scholarships", "pro_no"),
            ("applicant_status", "applicant_no"),
            ("applicant_status", "scholarship_no"),
            ("applicant_email", "applicant_no"),
            ("user_email", "user_no"),
            ("announcements", "pro_no"),
            ("users", "pro_no"),
        ]
        
        for table, col in indexes:
            idx_name = f"idx_{table}_{col}"
            print(f"Adding index {idx_name} on {table}({col})...")
            try:
                # Need to use autocommit for CREATE INDEX (or just commit)
                conn.autocommit = True
                cursor.execute(f'CREATE INDEX IF NOT EXISTS "{idx_name}" ON "{table}" ("{col}")')
                conn.autocommit = False
            except Exception as e:
                print(f"  Error adding index: {e}")
        
        print("Indexes added successfully.")
        
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    add_indexes()
