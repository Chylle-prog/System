import psycopg2
from project_config import get_db

def check_account():
    try:
        conn = get_db()
        cur = conn.cursor()
        
        # Check by email
        email = 'mwahahahahaha.lol@gmail.com'
        print(f"Checking for email: {email}")
        cur.execute("SELECT em_no, email_address, user_no, applicant_no FROM email WHERE email_address ILIKE %s", (email,))
        rows = cur.fetchall()
        print(f"Found {len(rows)} matching rows in 'email' table:")
        for row in rows:
            print(f"  Row: {row}")
            
        # Check by applicant_no
        print("\nChecking for applicant_no: 17")
        cur.execute("SELECT em_no, email_address, user_no, applicant_no FROM email WHERE applicant_no = 17")
        rows = cur.fetchall()
        print(f"Found {len(rows)} matching rows in 'email' table:")
        for row in rows:
            print(f"  Row: {row}")
            
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_account()
