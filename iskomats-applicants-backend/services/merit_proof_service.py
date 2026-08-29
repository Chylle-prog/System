import os
from services.db_service import get_db

def ensure_merit_proofs_table(conn=None):
    """Creates the merit_proofs table if it does not exist and ensures snapshot isolation columns."""
    def _execute(cur):
        cur.execute("""
            CREATE TABLE IF NOT EXISTS merit_proofs (
                merit_id SERIAL PRIMARY KEY,
                applicant_no INT NOT NULL REFERENCES applicants(applicant_no) ON DELETE CASCADE,
                merit_document TEXT NOT NULL,
                merit_title TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_merit_proofs_applicant_no ON merit_proofs(applicant_no);

            -- Snapshot isolation columns
            ALTER TABLE merit_proofs ADD COLUMN IF NOT EXISTS scholarship_no INT;
            ALTER TABLE merit_proofs ADD COLUMN IF NOT EXISTS app_doc_no INT;
            CREATE INDEX IF NOT EXISTS idx_merit_proofs_scholarship_no ON merit_proofs(scholarship_no);
            CREATE INDEX IF NOT EXISTS idx_merit_proofs_app_doc_no ON merit_proofs(app_doc_no);
        """)

    if conn:
        _execute(conn.cursor())
    else:
        with get_db() as c:
            _execute(c.cursor())
            c.commit()

def fetch_merit_proofs_for_applicant(cur, applicant_no, scholarship_no=None, app_doc_no=None):
    """Returns list of merit proof dicts for an applicant, optionally scoped to an application snapshot."""
    query = """
        SELECT merit_id, applicant_no, merit_document, merit_title, scholarship_no, app_doc_no, created_at
        FROM merit_proofs
        WHERE applicant_no = %s
    """
    params = [applicant_no]
    if app_doc_no is not None:
        query += " AND app_doc_no = %s"
        params.append(app_doc_no)
    elif scholarship_no is not None:
        query += " AND scholarship_no = %s"
        params.append(scholarship_no)

    query += " ORDER BY merit_id ASC"
    cur.execute(query, tuple(params))
    rows = cur.fetchall()
    results = []
    for r in rows:
        results.append({
            'merit_id': r.get('merit_id') if isinstance(r, dict) else r[0],
            'applicant_no': r.get('applicant_no') if isinstance(r, dict) else r[1],
            'merit_document': r.get('merit_document') if isinstance(r, dict) else r[2],
            'merit_title': r.get('merit_title') if isinstance(r, dict) else r[3],
            'scholarship_no': r.get('scholarship_no') if isinstance(r, dict) else r[4],
            'app_doc_no': r.get('app_doc_no') if isinstance(r, dict) else r[5],
            'created_at': (r.get('created_at') if isinstance(r, dict) else r[6]).isoformat() if (r.get('created_at') if isinstance(r, dict) else r[6]) else None
        })
    return results

def save_merit_proofs(cur, applicant_no, merit_entries, scholarship_no=None, app_doc_no=None):
    """
    Saves/replaces merit proof entries for an applicant into merit_proofs table,
    properly scoped to the application snapshot so other applications are never affected.
    """
    if merit_entries is None:
        return

    # Delete existing entries for this specific snapshot/scholarship to maintain isolation
    if app_doc_no is not None:
        cur.execute("DELETE FROM merit_proofs WHERE app_doc_no = %s", (app_doc_no,))
    elif scholarship_no is not None:
        cur.execute("DELETE FROM merit_proofs WHERE applicant_no = %s AND scholarship_no = %s", (applicant_no, scholarship_no))
    else:
        cur.execute("DELETE FROM merit_proofs WHERE applicant_no = %s AND app_doc_no IS NULL AND scholarship_no IS NULL", (applicant_no,))

    for entry in merit_entries:
        doc_url = entry.get('document') or entry.get('merit_document') or entry.get('photo') or entry.get('url')
        title = entry.get('title') or entry.get('merit_title') or ''

        if not doc_url or not isinstance(doc_url, str) or not doc_url.strip():
            continue

        cur.execute("""
            INSERT INTO merit_proofs (applicant_no, merit_document, merit_title, scholarship_no, app_doc_no)
            VALUES (%s, %s, %s, %s, %s)
        """, (applicant_no, doc_url.strip(), title.strip() if title else None, scholarship_no, app_doc_no))
