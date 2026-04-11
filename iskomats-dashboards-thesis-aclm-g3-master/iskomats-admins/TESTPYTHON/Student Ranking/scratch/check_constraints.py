from services.db_service import get_db
import sys

def check_constraints():
    try:
        conn = get_db()
        cur = conn.cursor()
        
        tables = ['applicant_documents', 'applicant_document']
        for table in tables:
            print(f"\n--- CHECKING TABLE: {table} ---")
            cur.execute("""
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables 
                    WHERE table_name = %s
                )
            """, (table,))
            if not cur.fetchone()[0]:
                print("Table does not exist.")
                continue
                
            print("Table exists. Checking unique/primary key constraints on applicant_no...")
            cur.execute("""
                SELECT conname, contype
                FROM pg_constraint c
                JOIN pg_namespace n ON n.oid = c.connamespace
                JOIN pg_class t ON t.oid = c.conrelid
                WHERE t.relname = %s
                AND c.conkey @> (
                    SELECT array_agg(attnum)
                    FROM pg_attribute
                    WHERE attrelid = t.oid
                    AND attname = 'applicant_no'
                )
            """, (table,))
            constraints = cur.fetchall()
            if not constraints:
                print("NO UNIQUE OR PRIMARY KEY CONSTRAINT FOUND ON applicant_no!")
            else:
                for con in constraints:
                    print(f"FOUND CONSTRAINT: {con[0]} (Type: {con[1]})")
                    
        conn.close()
    except Exception as e:
        print(f"ERROR: {e}")

if __name__ == "__main__":
    check_constraints()
