import psycopg2
import os
from dotenv import load_dotenv

load_dotenv(r'c:\Users\Chyle\OneDrive\Desktop\System\iskomats-dashboards-thesis-aclm-g3-master\iskomats-admins\TESTPYTHON\Student Ranking\.env')

def migrate_database():
    conn = None
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
        
        # Add semester and year columns if they don't exist
        print("Checking/Adding missing columns to 'scholarships' table...")
        
        cur.execute("""
            ALTER TABLE scholarships 
            ADD COLUMN IF NOT EXISTS semester VARCHAR(50),
            ADD COLUMN IF NOT EXISTS year VARCHAR(50)
        """)
        
        conn.commit()
        print("Successfully added 'semester' and 'year' columns.")
        
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Migration Error: {e}")
        if conn:
            conn.rollback()
            conn.close()

if __name__ == "__main__":
    migrate_database()
