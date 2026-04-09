import psycopg2
import os
from dotenv import load_dotenv

load_dotenv(r'c:\Users\Chyle\OneDrive\Desktop\System\iskomats-dashboards-thesis-aclm-g3-master\iskomats-admins\TESTPYTHON\Student Ranking\.env')

def check_columns():
    try:
        conn = psycopg2.connect(
            dbname=os.getenv('DB_NAME'),
            user=os.getenv('DB_USER'),
            password=os.getenv('DB_PASSWORD'),
            host=os.getenv('DB_HOST'),
            port=os.getenv('DB_PORT'),
            sslmode=os.getenv('DB_SSLMODE', 'require')
        )
        cur = conn.cursor()
        
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'scholarships' ORDER BY ordinal_position")
        columns = cur.fetchall()
        
        print("Columns in 'scholarships' table:")
        for col in columns:
            print(f"- {col[0]}")
            
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_columns()
