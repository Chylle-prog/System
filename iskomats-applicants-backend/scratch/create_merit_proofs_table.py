import os, sys
sys.path.insert(0, os.path.abspath('.'))
from dotenv import load_dotenv
load_dotenv()

from services.db_service import get_db

def create_table():
    with get_db() as conn:
        cur = conn.cursor()
        print("Creating merit_proofs table if not exists...")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS merit_proofs (
                merit_id SERIAL PRIMARY KEY,
                applicant_no INT NOT NULL REFERENCES applicants(applicant_no) ON DELETE CASCADE,
                merit_document TEXT NOT NULL,
                merit_title TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_merit_proofs_applicant_no ON merit_proofs(applicant_no);
        """)
        conn.commit()
        print("merit_proofs table created successfully!")

        # Verify table columns
        cur.execute("""
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'merit_proofs'
            ORDER BY ordinal_position;
        """)
        cols = cur.fetchall()
        print("\nTable schema for merit_proofs:")
        for c in cols:
            print(" ", c)

if __name__ == "__main__":
    create_table()
