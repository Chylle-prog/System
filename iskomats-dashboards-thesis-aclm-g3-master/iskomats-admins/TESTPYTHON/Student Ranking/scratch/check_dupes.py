from services.db_service import get_db
from services.applicant_document_service import get_applicant_document_table
import sys

def check():
    try:
        conn = get_db()
        cur = conn.cursor()
        table = get_applicant_document_table(cur)
        print(f"CURRENT DOCUMENT TABLE: {table}")
        
        if table:
            # Check for duplicates
            cur.execute(f"SELECT applicant_no, COUNT(*) as cnt FROM {table} GROUP BY applicant_no HAVING COUNT(*) > 1")
            dupes = cur.fetchall()
            if dupes:
                print(f"FOUND DUPLICATES in {table}: {dupes}")
            else:
                print(f"No duplicates found in {table}.")
                
            # Check column existence
            cur.execute(f"SELECT column_name FROM information_schema.columns WHERE table_name = %s", (table,))
            columns = [r['column_name'] for r in cur.fetchall()]
            print(f"COLUMNS in {table}: {columns}")
            
            # Check constraints
            cur.execute(f"""
                SELECT conname, contype 
                FROM pg_constraint 
                WHERE conrelid = %s::regclass
            """, (table,))
            constraints = cur.fetchall()
            print(f"CONSTRAINTS on {table}: {constraints}")
            
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    check()
