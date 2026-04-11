from services.db_service import get_db
conn = get_db()
cur = conn.cursor()
cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'applicant_status'")
columns = [row['column_name'] for row in cur.fetchall()]
print(f"COLUMNS: {columns}")
conn.close()
