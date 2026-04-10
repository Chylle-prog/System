import sys
from pathlib import Path
import json

# Add project root to path
project_root = Path(r'c:\Users\Chyle\OneDrive\Desktop\System\iskomats-dashboards-thesis-aclm-g3-master\iskomats-admins\TESTPYTHON\Student Ranking')
sys.path.append(str(project_root))

try:
    from services.db_service import get_db
    conn = get_db()
    cur = conn.cursor()
    
    tables = ['scholarships', 'announcements', 'announcement_images']
    schema = {}
    
    for table in tables:
        cur.execute(f"""
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = '{table}'
        """)
        schema[table] = [dict(col) for col in cur.fetchall()]
    
    print(json.dumps(schema, indent=2))
    conn.close()
except Exception as e:
    print(f"ERROR: {e}")
