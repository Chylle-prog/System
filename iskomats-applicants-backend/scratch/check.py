from services.db_service import get_db
with get_db() as conn:
  cur = conn.cursor()
  cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'notifications'")
  print([r['column_name'] for r in cur.fetchall()])
