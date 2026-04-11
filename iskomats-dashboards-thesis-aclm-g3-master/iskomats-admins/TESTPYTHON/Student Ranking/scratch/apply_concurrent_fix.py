from services.db_service import get_db
import sys

def apply_concurrent_fix():
    try:
        conn = get_db()
        # Create Index Concurrently requires autocommit to be True because it can't run inside a transaction block
        conn.autocommit = True
        cur = conn.cursor()
        
        table = 'applicant_documents'
        index_name = f"{table}_applicant_no_idx"
        constraint_name = f"{table}_applicant_no_key"
        
        print(f"Phase 1: Creating UNIQUE INDEX CONCURRENTLY on {table}(applicant_no)...")
        # This will not block other operations
        cur.execute(f"CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS {index_name} ON {table} (applicant_no)")
        print("Index created concurrently.")
        
        print(f"Phase 2: Adding UNIQUE CONSTRAINT using the index...")
        # This is high-speed as it just promotional
        cur.execute(f"""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '{constraint_name}') THEN
                    ALTER TABLE {table} ADD CONSTRAINT {constraint_name} UNIQUE USING INDEX {index_name};
                END IF;
            END $$;
        """)
        print("Constraint added successfully.")
        
        conn.close()
    except Exception as e:
        print(f"ERROR: {e}")

if __name__ == "__main__":
    apply_concurrent_fix()
