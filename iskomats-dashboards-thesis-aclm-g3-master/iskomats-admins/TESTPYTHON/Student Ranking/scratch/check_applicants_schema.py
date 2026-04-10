import sys
import os
from pathlib import Path

# Add the directory containing project_config to sys.path
sys.path.append(r'c:\Users\Chyle\OneDrive\Desktop\System\iskomats-dashboards-thesis-aclm-g3-master\iskomats-admins\TESTPYTHON\Student Ranking')

from project_config import get_db

def check_applicants_table():
    try:
        conn = get_db()
        cur = conn.cursor()
        
        # Get column names
        cur.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'applicants';")
        columns = cur.fetchall()
        
        print("Columns in 'applicants' table:")
        for col in columns:
            print(f"- {col['column_name']} ({col['data_type']})")
            
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_applicants_table()
