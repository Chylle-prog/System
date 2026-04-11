from services.db_service import get_db
import sys

def apply_fix():
    try:
        conn = get_db()
        cur = conn.cursor()
        
        table = 'applicant_documents'
        print(f"Applying unique constraint to {table}.applicant_no...")
        
        # 1. Clean up any accidental duplicates (though my previous check showed none)
        cur.execute(f"""
            DELETE FROM {table} a
            USING {table} b
            WHERE a.app_doc_no < b.app_doc_no
            AND a.applicant_no = b.applicant_no
        """)
        if cur.rowcount > 0:
            print(f"Removed {cur.rowcount} duplicate records.")
            
        # 2. Add the unique constraint
        cur.execute(f"ALTER TABLE {table} ADD CONSTRAINT {table}_applicant_no_key UNIQUE (applicant_no)")
        print("Successfully added UNIQUE constraint.")
        
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"ERROR: {e}")
        if 'conn' in locals():
            conn.rollback()

if __name__ == "__main__":
    apply_fix()
