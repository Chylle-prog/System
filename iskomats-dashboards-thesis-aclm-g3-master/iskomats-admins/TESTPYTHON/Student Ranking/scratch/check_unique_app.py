from services.db_service import get_db
import sys

def check_unique_application():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT a.attname
            FROM   pg_index i
            JOIN   pg_attribute a ON a.attrelid = i.indrelid
                                 AND a.attnum = ANY(i.indkey)
            WHERE  i.indrelid = 'applicant_status'::regclass
            AND    i.indisunique
            AND    (SELECT relname FROM pg_class WHERE oid = i.indexrelid) = 'unique_application';
        """)
        cols = [r['attname'] for r in cur.fetchall()]
        print(f"COLUMNS in index 'unique_application': {cols}")
        
    except Exception as e:
        print(f"ERROR: {e}")

if __name__ == "__main__":
    check_unique_application()
