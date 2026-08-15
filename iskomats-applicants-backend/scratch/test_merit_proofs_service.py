import os, sys
sys.path.insert(0, os.path.abspath('.'))
from dotenv import load_dotenv
load_dotenv()

from services.db_service import get_db
from services.merit_proof_service import (
    ensure_merit_proofs_table,
    fetch_merit_proofs_for_applicant,
    save_merit_proofs
)

def test():
    with get_db() as conn:
        cur = conn.cursor()
        # Find an applicant to test with
        cur.execute("SELECT applicant_no FROM applicants LIMIT 1")
        row = cur.fetchone()
        if not row:
            print("No applicant found to test.")
            return
        
        applicant_no = row['applicant_no'] if isinstance(row, dict) else row[0]
        print(f"Testing merit_proofs for applicant_no: {applicant_no}")

        # Test saving
        test_entries = [
            {'title': 'Valedictorian', 'document': 'https://supabase.co/storage/v1/object/public/document_images/merit_documents/test1.jpg'},
            {'title': "Dean's Lister", 'document': 'https://supabase.co/storage/v1/object/public/document_images/merit_documents/test2.jpg'}
        ]
        save_merit_proofs(cur, applicant_no, test_entries)
        conn.commit()

        # Test fetching
        fetched = fetch_merit_proofs_for_applicant(cur, applicant_no)
        print("Fetched merit_proofs:")
        for f in fetched:
            print(" ", f)
        
        # Clean up test rows
        cur.execute("DELETE FROM merit_proofs WHERE applicant_no = %s", (applicant_no,))
        conn.commit()
        print("Test cleanup complete. Everything passed!")

if __name__ == "__main__":
    test()
