import os
from services.db_service import get_db

def ensure_merit_proofs_table(conn=None):
    """Creates the merit_proofs table if it does not exist."""
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
        """)

    if conn:
        _execute(conn.cursor())
    else:
        with get_db() as c:
            _execute(c.cursor())
            c.commit()

def fetch_merit_proofs_for_applicant(cur, applicant_no):
    """Returns list of merit proof dicts for an applicant."""
    cur.execute("""
        SELECT merit_id, applicant_no, merit_document, merit_title, created_at
        FROM merit_proofs
        WHERE applicant_no = %s
        ORDER BY merit_id ASC
    """, (applicant_no,))
    rows = cur.fetchall()
    results = []
    for r in rows:
        results.append({
            'merit_id': r.get('merit_id') if isinstance(r, dict) else r[0],
            'applicant_no': r.get('applicant_no') if isinstance(r, dict) else r[1],
            'merit_document': r.get('merit_document') if isinstance(r, dict) else r[2],
            'merit_title': r.get('merit_title') if isinstance(r, dict) else r[3],
            'created_at': (r.get('created_at') if isinstance(r, dict) else r[4]).isoformat() if (r.get('created_at') if isinstance(r, dict) else r[4]) else None
        })
    return results

def save_merit_proofs(cur, applicant_no, merit_entries):
    """
    Saves/replaces merit proof entries for an applicant into merit_proofs table.
    merit_entries: list of dicts: [{'title': '...', 'document': 'url_or_bytes', ...}]
    """
    if merit_entries is None:
        return

    # Delete existing to maintain clean 1NF state
    cur.execute("DELETE FROM merit_proofs WHERE applicant_no = %s", (applicant_no,))

    for entry in merit_entries:
        doc_url = entry.get('document') or entry.get('merit_document') or entry.get('photo') or entry.get('url')
        title = entry.get('title') or entry.get('merit_title') or ''

        if not doc_url or not isinstance(doc_url, str) or not doc_url.strip():
            continue

        cur.execute("""
            INSERT INTO merit_proofs (applicant_no, merit_document, merit_title)
            VALUES (%s, %s, %s)
        """, (applicant_no, doc_url.strip(), title.strip() if title else None))
