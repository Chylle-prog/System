from services.db_service import get_db
import traceback

def check_schema():
    try:
        conn = get_db()
        cur = conn.cursor()
        
        doc_cols = [
            'id_img_front', 'id_img_back', 'enrollment_certificate_doc',
            'grades_doc', 'indigency_doc', 'id_pic', 'signature_image_data',
            'profile_picture'
        ]
        
        query = "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name IN ('applicants', 'applicant_documents', 'applicant_document') AND column_name IN %s ORDER BY table_name, column_name"
        
        cur.execute(query, (tuple(doc_cols),))
        results = cur.fetchall()
        
        print("\n--- DOCUMENT COLUMNS SCHEMA CHECK ---")
        for row in results:
            print(f"Table: {row['table_name']:20} | Column: {row['column_name']:30} | Type: {row['data_type']}")
        print("------------------------------------\n")
        
        # Also check if any of these columns exist in applicants but are BYTEA
        cur.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'applicants' AND data_type = 'bytea'")
        bytea_cols = cur.fetchall()
        print("\n--- BYTEA COLUMNS IN applicants ---")
        for row in bytea_cols:
            print(f"Column: {row['column_name']:30} | Type: {row['data_type']}")
            
        cur.close()
        conn.close()
    except Exception:
        traceback.print_exc()

if __name__ == "__main__":
    check_schema()
