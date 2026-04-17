from services.db_service import get_db
import traceback

def check_schema():
    try:
        conn = get_db()
        cur = conn.cursor()
        
        query = "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name IN ('applicants', 'applicant_documents') ORDER BY table_name, column_name"
        
        cur.execute(query)
        results = cur.fetchall()
        
        print("\n--- FULL DATABASE SCHEMA CHECK ---")
        for row in results:
            print(f"Table: {row['table_name']:20} | Column: {row['column_name']:30} | Type: {row['data_type']}")
        print("------------------------------------\n")
        
        cur.close()
        conn.close()
    except Exception:
        traceback.print_exc()

if __name__ == "__main__":
    check_schema()
