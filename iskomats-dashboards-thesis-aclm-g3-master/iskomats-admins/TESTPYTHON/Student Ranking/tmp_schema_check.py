from services.db_service import get_db
import sys

def check_schema():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'email'")
        columns = [row[0] for row in cur.fetchall()]
        print(f"COLUMNS: {columns}")
        conn.close()
    except Exception as e:
        print(f"ERROR: {e}")

if __name__ == "__main__":
    check_schema()
