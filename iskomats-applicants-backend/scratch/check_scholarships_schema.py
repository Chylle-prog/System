import os
from project_config import get_db_connection_kwargs
import psycopg2

def check_scholarships_schema():
    kwargs = get_db_connection_kwargs()
    conn = psycopg2.connect(**kwargs)
    cur = conn.cursor()
    cur.execute("""
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'scholarships'
    """)
    for row in cur.fetchall():
        print(f"Column: {row[0]}, Type: {row[1]}")
    cur.close()
    conn.close()

if __name__ == "__main__":
    check_scholarships_schema()
