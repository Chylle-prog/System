import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from project_config import get_db

def main():
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Check which table has enrollment_certificate_doc
        cursor.execute("""
            SELECT table_name, column_name 
            FROM information_schema.columns 
            WHERE column_name = 'enrollment_certificate_doc'
            AND table_schema = 'public'
        """)
        rows = cursor.fetchall()
        print("Tables with enrollment_certificate_doc:", rows)
        
        # Fetch the profile row as the API does for applicant 1
        cursor.execute("SELECT * FROM applicants LIMIT 0")
        applicant_cols = [desc[0] for desc in cursor.description]
        print("\napplicants table columns:")
        for c in applicant_cols:
            print(" ", c)
        print("\nenrollment_certificate_doc in applicants?", 'enrollment_certificate_doc' in applicant_cols)
        
        # Check what the profile API actually returns for has_mayorCOE_photo
        blob_fields = ['profile_picture', 'signature_image_data', 'id_img_front', 'id_img_back', 
                       'enrollment_certificate_doc', 'grades_doc', 'indigency_doc', 'id_pic']
        flag_map = {
            'enrollment_certificate_doc': 'has_mayorCOE_photo',
            'grades_doc': 'has_mayorGrades_photo',
            'indigency_doc': 'has_mayorIndigency_photo',
        }
        select_parts = []
        for col in applicant_cols:
            if col in blob_fields:
                flag_name = flag_map.get(col, f"has_{col}")
                select_parts.append(f'("{col}" IS NOT NULL) as {flag_name}')
            else:
                select_parts.append(f'"{col}"')
        
        query = f"SELECT {', '.join(select_parts)} FROM applicants WHERE applicant_no = 1"
        cursor.execute(query)
        row = cursor.fetchone()
        print("\nProfile API result for has_mayorCOE_photo:", row.get('has_mayorCOE_photo'))
        print("Profile API result for has_mayorGrades_photo:", row.get('has_mayorGrades_photo'))
        print("Profile API result for has_mayorIndigency_photo:", row.get('has_mayorIndigency_photo'))

if __name__ == '__main__':
    main()
