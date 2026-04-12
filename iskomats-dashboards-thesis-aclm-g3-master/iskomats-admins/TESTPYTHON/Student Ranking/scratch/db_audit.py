import os
import psycopg2
from project_config import get_db

def check_counts():
    conn = get_db()
    cursor = conn.cursor()
    try:
        def get_val(query):
            cursor.execute(query)
            row = cursor.fetchone()
            if not row: return 0
            if hasattr(row, 'get'): 
                vals = list(row.values())
                return vals[0] if vals else 0
            return row[0]

        print(f"Total applicants: {get_val('SELECT COUNT(*) FROM applicants')}")
        print(f"Total applicant_status: {get_val('SELECT COUNT(*) FROM applicant_status')}")
        print(f"Total scholarships: {get_val('SELECT COUNT(*) FROM scholarships')}")
        
        try:
            print(f"Total applicant_documents: {get_val('SELECT COUNT(*) FROM applicant_documents')}")
        except:
            print("applicant_documents table not found")
        
        cursor.execute("SELECT provider_name, COUNT(*) as cnt FROM scholarship_providers GROUP BY provider_name")
        rows = cursor.fetchall()
        print(f"Programs: {rows}")

        # Check for missing indexes
        cursor.execute("""
            SELECT
                t.relname AS table_name,
                a.attname AS column_name
            FROM
                pg_class t
                JOIN pg_namespace n ON n.oid = t.relnamespace
                JOIN pg_attribute a ON a.attrelid = t.oid
                JOIN pg_type b ON a.atttypid = b.oid
            WHERE
                t.relkind = 'r'
                AND n.nspname = 'public'
                AND a.attnum > 0
                AND NOT a.attisdropped
                AND (a.attname LIKE '%_no' OR a.attname = 'applicant_no')
                AND NOT EXISTS (
                    SELECT 1
                    FROM pg_index i
                    WHERE i.indrelid = t.oid
                    AND a.attnum = ANY(i.indkey)
                );
        """)
        print("Potential missing indexes on ID columns:")
        for row in cursor.fetchall():
            print(f"  - {row}")
        
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    check_counts()
