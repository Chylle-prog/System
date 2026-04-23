import psycopg2
from psycopg2.extras import RealDictCursor
import os
from dotenv import load_dotenv

# Use absolute path to .env
env_path = 'c:/Users/Chyle/OneDrive/Desktop/System/iskomats-applicants-backend/.env'
load_dotenv(env_path)

def get_db_connection_kwargs():
    sslmode = os.environ.get('DB_SSLMODE', 'require').strip() or 'require'
    connect_timeout = int(os.environ.get('DB_CONNECT_TIMEOUT', '10'))

    connection_kwargs = {
        'dbname': os.environ.get('DB_NAME'),
        'user': os.environ.get('DB_USER'),
        'password': os.environ.get('DB_PASSWORD'),
        'host': os.environ.get('DB_HOST'),
        'port': os.environ.get('DB_PORT', '5432'),
        'sslmode': sslmode,
        'connect_timeout': connect_timeout,
    }
    return connection_kwargs

def add_verification_columns():
    try:
        kwargs = get_db_connection_kwargs()
        conn = psycopg2.connect(**kwargs)
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        # Check columns in applicant_documents
        cur.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'applicant_documents'
        """)
        existing_cols = [row['column_name'] for row in cur.fetchall()]
        print(f"Existing columns in applicant_documents: {existing_cols}")
        
        cols_to_add = {
            'indigency_verified': 'BOOLEAN DEFAULT FALSE',
            'enrollment_verified': 'BOOLEAN DEFAULT FALSE',
            'grades_verified': 'BOOLEAN DEFAULT FALSE',
            'id_verified': 'BOOLEAN DEFAULT FALSE',
            'face_verified': 'BOOLEAN DEFAULT FALSE',
            'signature_verified': 'BOOLEAN DEFAULT FALSE'
        }
        
        for col, dtype in cols_to_add.items():
            if col not in existing_cols:
                print(f"Adding column {col} ({dtype})...")
                cur.execute(f"ALTER TABLE applicant_documents ADD COLUMN {col} {dtype}")
            else:
                print(f"Column {col} already exists.")
        
        conn.commit()
        print("Database update complete.")
        
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    add_verification_columns()
