from services.db_service import get_db
import sys

def check_all_constraints():
    try:
        conn = get_db()
        cur = conn.cursor()
        
        tables = ['pending_registrations', 'applicant_status', 'applicant_documents']
        for table in tables:
            print(f"\n--- TABLE: {table} ---")
            cur.execute("""
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables 
                    WHERE table_name = %s
                )
            """, (table,))
            if not cur.fetchone()['exists']:
                print("Table does not exist.")
                continue
                
            cur.execute(f"""
                SELECT conname, contype 
                FROM pg_constraint 
                WHERE conrelid = %s::regclass
            """, (table,))
            constraints = cur.fetchall()
            for con in constraints:
                print(f"CONSTRAINT: {con['conname']} (Type: {con['contype']})")
                
            # List indices too
            cur.execute(f"SELECT indexname FROM pg_indexes WHERE tablename = %s", (table,))
            indices = cur.fetchall()
            for idx in indices:
                print(f"INDEX: {idx['indexname']}")
                    
        conn.close()
    except Exception as e:
        print(f"ERROR: {e}")

if __name__ == "__main__":
    check_all_constraints()
