from services.db_service import get_db
import sys

def check_schema():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT column_name, data_type, character_maximum_length 
            FROM information_schema.columns 
            WHERE table_name = 'email'
        """)
        columns = cur.fetchall()
        for col in columns:
            print(f"COLUMN: {col[0]}, TYPE: {col[1]}, MAX_LEN: {col[2]}")
        
        # Also check pending_registrations
        print("\n--- PENDING REGISTRATIONS ---")
        cur.execute("""
            SELECT column_name, data_type, character_maximum_length 
            FROM information_schema.columns 
            WHERE table_name = 'pending_registrations'
        """)
        columns = cur.fetchall()
        for col in columns:
            print(f"COLUMN: {col[0]}, TYPE: {col[1]}, MAX_LEN: {col[2]}")
        conn.close()
    except Exception as e:
        print(f"ERROR: {e}")

if __name__ == "__main__":
    check_schema()
