import os
import sys
sys.path.append(os.getcwd())
from project_config import get_db

def check_schema():
    conn = get_db()
    cur = conn.cursor()
    
    # List all tables
    cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
    tables = [r['table_name'] if isinstance(r, dict) else r[0] for r in cur.fetchall()]
    print(f"Tables: {tables}")
    
    conn.close()

if __name__ == "__main__":
    check_schema()
