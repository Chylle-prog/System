import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from project_config import get_db

def check_columns():
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'applicants'")
            rows = cur.fetchall()
            for row in rows:
                # Handle both RealDictCursor and standard cursor
                if isinstance(row, dict):
                    print(row['column_name'])
                else:
                    print(row[0])
    except Exception as e:
        print(f"ErrorMsg: {e}")

if __name__ == "__main__":
    check_columns()
