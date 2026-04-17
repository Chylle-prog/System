import os
import json
from services.db_service import get_db

def check_recent_documents():
    try:
        conn = get_db()
        cur = conn.cursor()
        
        # Check both tables
        for table in ['applicant_documents', 'applicants']:
            print(f"\n--- RECENT DATA IN {table} ---")
            cols = ['grades_doc', 'signature_image_data', 'indigency_doc']
            # Filter cols that exist in table
            cur.execute(f"SELECT column_name FROM information_schema.columns WHERE table_name = '{table}'")
            existing = [r['column_name'] for r in cur.fetchall()]
            valid_cols = [c for c in cols if c in existing]
            
            if not valid_cols:
                print(f"No document columns in {table}")
                continue
                
            query = f"SELECT applicant_no, {', '.join(valid_cols)} FROM {table} ORDER BY applicant_no DESC LIMIT 3"
            cur.execute(query)
            rows = cur.fetchall()
            
            for row in rows:
                print(f"Applicant: {row['applicant_no']}")
                for col in valid_cols:
                    val = row[col]
                    if val is None:
                        status = "NULL"
                    elif isinstance(val, str):
                        status = f"STRING (URL?): {val[:60]}..."
                    elif isinstance(val, (bytes, bytearray, memoryview)):
                        status = f"BINARY (BYTEA): len={len(val)}"
                    else:
                        status = f"OTHER ({type(val)}): {str(val)[:30]}"
                    print(f"  - {col:25}: {status}")
        
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_recent_documents()
