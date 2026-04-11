from services.db_service import get_db
conn = get_db()
cur = conn.cursor()
cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
tables = [row['table_name'] for row in cur.fetchall()]
print(f"TABLES: {tables}")
conn.close()
