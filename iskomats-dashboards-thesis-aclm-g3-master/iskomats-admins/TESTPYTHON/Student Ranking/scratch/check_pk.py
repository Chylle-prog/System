from services.db_service import get_db
import sys

def check_pk():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT a.attname
            FROM   pg_index i
            JOIN   pg_attribute a ON a.attrelid = i.indrelid
                                 AND a.attnum = ANY(i.indkey)
            WHERE  i.indrelid = 'applicant_documents'::regclass
            AND    i.indisprimary;
        """)
        pk_cols = [r['attname'] for r in cur.fetchall()]
        print(f"PRIMARY KEY COLUMNS for applicant_documents: {pk_cols}")
        
    except Exception as e:
        print(f"ERROR: {e}")

if __name__ == "__main__":
    check_pk()
