from project_config import get_db
import json

def check_schemas():
    conn = get_db(cursor_factory=None)
    cur = conn.cursor()
    
    results = {}
    for table in ['applicant_status', 'scholarship_providers', 'announcements']:
        cur.execute(f"SELECT column_name FROM information_schema.columns WHERE table_name = '{table}'")
        results[table] = [row[0] for row in cur.fetchall()]
    
    with open('schema_results.json', 'w') as f:
        json.dump(results, f, indent=2)
    
    conn.close()

if __name__ == "__main__":
    check_schemas()
