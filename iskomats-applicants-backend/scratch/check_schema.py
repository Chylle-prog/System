from services.db_service import get_db
import json

def check_schema():
    conn = get_db()
    cur = conn.cursor()
    
    # List all tables
    cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
    tables = [r['table_name'] for r in cur.fetchall()]
    print("Tables:", tables)
    
    # Search for verification columns across all tables
    print("\nSearching for verification-related columns...")
    cur.execute("""
        SELECT table_name, column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND (column_name LIKE '%verify%' OR column_name LIKE '%verified%' OR column_name LIKE '%status%')
    """)
    results = cur.fetchall()
    for row in results:
        print(f"Table: {row['table_name']}, Column: {row['column_name']}")

    # Check specific tables
    for table in ['applicants', 'applicant_status', 'applicant_email', 'applicant_documents']:
        if table in tables:
            print(f"\nSchema for {table}:")
            cur.execute(f"SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '{table}'")
            print(json.dumps(cur.fetchall(), indent=2))
    
    conn.close()

if __name__ == '__main__':
    check_schema()
