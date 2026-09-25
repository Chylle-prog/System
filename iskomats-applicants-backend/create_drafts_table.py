from project_config import get_db

def setup_supabase_drafts_and_status():
    print("[SUPABASE MIGRATION] Starting schema setup...")
    with get_db() as conn:
        cur = conn.cursor()
        
        # 1. Create application_drafts table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS application_drafts (
                draft_id SERIAL PRIMARY KEY,
                applicant_no INTEGER NOT NULL REFERENCES applicants(applicant_no) ON DELETE CASCADE,
                scholarship_no INTEGER NOT NULL REFERENCES scholarships(req_no) ON DELETE CASCADE,
                current_step INTEGER DEFAULT 1,
                draft_data JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                UNIQUE(applicant_no, scholarship_no)
            );
        """)
        print("[SUPABASE MIGRATION] Table 'application_drafts' ensured.")

        # Create indexes for fast lookup
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_application_drafts_user_scholarship 
            ON application_drafts(applicant_no, scholarship_no);
        """)
        print("[SUPABASE MIGRATION] Indexes for 'application_drafts' ensured.")

        # 2. Standardize is_accepted values in applicant_status
        # 'Pending' or NULL -> 'Submitted'
        cur.execute("""
            UPDATE applicant_status 
            SET is_accepted = 'Submitted' 
            WHERE is_accepted IS NULL OR is_accepted = 'Pending';
        """)
        print(f"[SUPABASE MIGRATION] Updated {cur.rowcount} pending/null rows to 'Submitted'.")

        # 'Accepted' -> 'Approved'
        cur.execute("""
            UPDATE applicant_status 
            SET is_accepted = 'Approved' 
            WHERE is_accepted = 'Accepted';
        """)
        print(f"[SUPABASE MIGRATION] Updated {cur.rowcount} 'Accepted' rows to 'Approved'.")

        conn.commit()
        print("[SUPABASE MIGRATION] Migration committed successfully!")

if __name__ == '__main__':
    setup_supabase_drafts_and_status()
