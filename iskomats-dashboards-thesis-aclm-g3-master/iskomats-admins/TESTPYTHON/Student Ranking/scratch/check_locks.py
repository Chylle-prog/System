from services.db_service import get_db
import sys

def check_locks():
    try:
        conn = get_db()
        cur = conn.cursor()
        print("Checking for blocking PIDs...")
        cur.execute("""
            SELECT
                pid,
                now() - pg_stat_activity.query_start AS duration,
                query,
                state
            FROM pg_stat_activity
            WHERE (now() - pg_stat_activity.query_start) > interval '1 minute'
              AND state != 'idle'
              AND query NOT LIKE '%pg_stat_activity%'
        """)
        blocking = cur.fetchall()
        if blocking:
            for b in blocking:
                print(f"PID: {b['pid']}, DURATION: {b['duration']}, STATE: {b['state']}, QUERY: {b['query']}")
        else:
            print("No long-running non-idle queries found.")
            
        conn.close()
    except Exception as e:
        print(f"ERROR: {e}")

if __name__ == "__main__":
    check_locks()
