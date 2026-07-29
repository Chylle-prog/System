import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from project_config import get_db

def check():
    with get_db() as conn:
        cur = conn.cursor()
        
        cur.execute("""
            SELECT s.req_no, s.scholarship_name, s.slots,
                   COUNT(ast.stat_no) AS total_applications,
                   COUNT(CASE WHEN ast.is_accepted = 'Accepted' THEN 1 END) AS db_accepted,
                   COUNT(CASE WHEN ast.is_accepted = 'Pending' OR ast.is_accepted IS NULL THEN 1 END) AS db_pending,
                   COUNT(CASE WHEN ast.is_accepted IN ('Rejected', 'Declined') THEN 1 END) AS db_declined,
                   COUNT(CASE WHEN ast.is_accepted = 'Cancelled' THEN 1 END) AS db_cancelled
            FROM scholarships s
            LEFT JOIN applicant_status ast ON s.req_no = ast.scholarship_no
            WHERE COALESCE(s.is_removed, FALSE) = FALSE
            GROUP BY s.req_no, s.scholarship_name, s.slots
            ORDER BY s.req_no
        """)
        
        rows = cur.fetchall()
        print("=== DATABASE SCHOLARSHIP STATUS COUNTS ===")
        for r in rows:
            print(dict(r))

if __name__ == '__main__':
    check()
