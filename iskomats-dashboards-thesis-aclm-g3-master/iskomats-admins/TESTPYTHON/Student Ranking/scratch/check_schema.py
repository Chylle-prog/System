from app import get_db
try:
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'announcement_images'")
    for row in cur.fetchall():
        print(row)
    conn.close()
except Exception as e:
    print(f"Error: {e}")
