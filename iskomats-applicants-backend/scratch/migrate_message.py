import os
from project_config import get_db_connection_kwargs
import psycopg2

def migrate_message_table():
    kwargs = get_db_connection_kwargs()
    conn = psycopg2.connect(**kwargs)
    cur = conn.cursor()
    
    # Check existing columns
    cur.execute("""
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'message'
    """)
    columns = [row[0] for row in cur.fetchall()]
    print(f"Current columns in 'message': {columns}")
    
    # Add sender_id if missing
    if 'sender_id' not in columns:
        print("Adding sender_id column...")
        cur.execute("ALTER TABLE message ADD COLUMN sender_id INTEGER")
        
    # Add is_student_sender if missing
    if 'is_student_sender' not in columns:
        print("Adding is_student_sender column...")
        cur.execute("ALTER TABLE message ADD COLUMN is_student_sender BOOLEAN")
        
    conn.commit()
    print("Migration complete.")
    cur.close()
    conn.close()

if __name__ == "__main__":
    migrate_message_table()
