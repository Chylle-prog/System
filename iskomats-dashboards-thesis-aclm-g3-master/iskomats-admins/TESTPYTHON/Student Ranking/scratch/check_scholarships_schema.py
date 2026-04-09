import os
import sys
from pathlib import Path
import json

# Add project root to path
sys.path.append(str(Path(__file__).resolve().parent.parent))

from services.db_service import get_db

def check_scholarships_schema():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'scholarships'
        """)
        columns = cur.fetchall()
        print(json.dumps([dict(col) for col in columns], indent=2))
        conn.close()
    except Exception as e:
        print(f"ERROR: {e}")

if __name__ == "__main__":
    check_scholarships_schema()
