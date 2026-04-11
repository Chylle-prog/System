from services.db_service import get_db
import sys

def kill_and_fix():
    try:
        conn = get_db()
        # No autocommit here, we want to be fast
        cur = conn.cursor()
        
        # 1. Try to kill the specific long-running PIDs if they are still there
        # We use pg_terminate_backend
        print("Killing identified old PIDs...")
        cur.execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid IN (1788230, 1788714)")
        
        # 2. Apply the fix
        table = 'applicant_documents'
        print(f"Applying UNIQUE constraint to {table}.applicant_no...")
        cur.execute(f"ALTER TABLE {table} ADD CONSTRAINT {table}_applicant_no_key UNIQUE (applicant_no)")
        
        conn.commit()
        print("Fix applied successfully.")
        conn.close()
    except Exception as e:
        print(f"ERROR: {e}")
        if 'conn' in locals():
            conn.rollback()

if __name__ == "__main__":
    kill_and_fix()
