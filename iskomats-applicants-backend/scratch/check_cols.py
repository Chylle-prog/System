import os
import psycopg2
from project_config import get_db_connection_kwargs

def check_applicants_columns():
    kwargs = get_db_connection_kwargs()
    try:
        conn = psycopg2.connect(**kwargs)
        cur = conn.cursor()
        cur.execute("""
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'applicants'
        """)
        rows = cur.fetchall()
        print("Columns in 'applicants':")
        for row in rows:
            print(f"- {row[0]} ({row[1]})")
        
        cur.execute("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_name LIKE 'applicant%'
        """)
        tables = cur.fetchall()
        print("\nTables like 'applicant%':")
        for t in tables:
            print(f"- {t[0]}")
            
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_applicants_columns()
