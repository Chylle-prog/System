from services.db_service import get_db
from services.applicant_document_service import get_applicant_document_table
conn = get_db()
cur = conn.cursor()
table = get_applicant_document_table(cur)
if table:
    cur.execute(f"SELECT column_name FROM information_schema.columns WHERE table_name = '{table}'")
    columns = [row['column_name'] for row in cur.fetchall()]
    print(f"COLUMNS in {table}: {columns}")
else:
    print("NO APPLICANT DOCUMENT TABLE FOUND")
conn.close()
