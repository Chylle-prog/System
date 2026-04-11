from services.db_service import get_db
import sys

def check_count():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) as cnt FROM applicant_documents")
        row = cur.fetchone()
        print(f"ROW COUNT in applicant_documents: {row['cnt']}")
        conn.close()
    except Exception as e:
        print(f"ERROR: {e}")

if __name__ == "__main__":
    check_count()
