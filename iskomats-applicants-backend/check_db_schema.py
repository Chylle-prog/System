
import psycopg2
from psycopg2.extras import RealDictCursor
import os
from dotenv import load_dotenv

load_dotenv('.env')

def get_db_connection_kwargs():
    sslmode = os.environ.get('DB_SSLMODE', 'require').strip() or 'require'
    connect_timeout = int(os.environ.get('DB_CONNECT_TIMEOUT', '10'))

    connection_kwargs = {
        'dbname': os.environ.get('DB_NAME'),
        'user': os.environ.get('DB_USER'),
        'password': os.environ.get('DB_PASSWORD'),
        'host': os.environ.get('DB_HOST'),
        'port': os.environ.get('DB_PORT', '5432'),
        'sslmode': sslmode,
        'connect_timeout': connect_timeout,
    }
    return connection_kwargs

def check_notifications_schema():
    try:
        kwargs = get_db_connection_kwargs()
        conn = psycopg2.connect(**kwargs)
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        print("Checking notifications table schema...")
        cur.execute("""
            SELECT column_name, data_type, column_default
            FROM information_schema.columns
            WHERE table_name = 'notifications'
            ORDER BY ordinal_position
        """)
        columns = cur.fetchall()
        for col in columns:
            print(f"Column: {col['column_name']}, Type: {col['data_type']}, Default: {col['column_default']}")
            
        user_id = 101
        print(f"\nChecking notifications for user {user_id}...")
        cur.execute("SELECT notif_id, title, message, is_read, created_at, expires_at FROM notifications WHERE user_no = %s", (user_id,))
        rows = cur.fetchall()
        if not rows:
            print("No notifications found.")
        for row in rows:
            print(f"ID: {row['notif_id']}, Title: {row['title']}, Read: {row['is_read']}, Expires: {row['expires_at']}")
        
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_notifications_schema()
