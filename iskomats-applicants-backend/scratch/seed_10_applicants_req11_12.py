import sys
import os
import random
from werkzeug.security import generate_password_hash

# Add parent dir to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from project_config import get_db

COR_DOC = "https://choqncwkxobwsouyotih.supabase.co/storage/v1/object/public/document_videos/videos/coe/TEST_COR.jpg"
COR_VID = "https://choqncwkxobwsouyotih.supabase.co/storage/v1/object/public/document_videos/videos/coe/COE_Vid.mp4"

GRADES_DOC = "https://choqncwkxobwsouyotih.supabase.co/storage/v1/object/public/document_videos/videos/grades/TEST_Grades.png"
GRADES_VID = "https://choqncwkxobwsouyotih.supabase.co/storage/v1/object/public/document_videos/videos/grades/grades_vid.mp4"

INDIGENCY_DOC = "https://choqncwkxobwsouyotih.supabase.co/storage/v1/object/public/document_videos/videos/indigency/TEST_Indigency.png"
INDIGENCY_VID = "https://choqncwkxobwsouyotih.supabase.co/storage/v1/object/public/document_videos/videos/indigency/indigency_vid_test.mp4"

FRONT_ID_DOC = "https://choqncwkxobwsouyotih.supabase.co/storage/v1/object/public/document_videos/videos/school_id/TEST_folder/TEST_FrontID.jpg"
BACK_ID_DOC = "https://choqncwkxobwsouyotih.supabase.co/storage/v1/object/public/document_videos/videos/school_id/TEST_folder/TEST_backID.jpg"
ID_VID = "https://choqncwkxobwsouyotih.supabase.co/storage/v1/object/public/document_videos/videos/school_id/TEST_folder/id_vid_test.mp4"

FIRST_NAMES_MALE = ["Gabriel", "Ethan", "Nathan", "Francis", "Daniel", "Kevin", "Justin", "Miggy", "Rafael", "Lucas"]
FIRST_NAMES_FEMALE = ["Sophia", "Camille", "Hannah", "Chloe", "Alyssa", "Denise", "Gwyneth", "Kaitlyn", "Erica", "Samantha"]
LAST_NAMES = ["Bautista", "Ocampo", "Garcia", "Mendoza", "Ramos", "Gonzales", "Castillo", "Torres", "Navarro", "Villanueva"]

COURSES = ["BS Computer Science", "BS Information Technology", "BS Business Administration", "BS Industrial Engineering", "BS Nursing"]
YEAR_LEVELS = ["1st Year", "2nd Year", "3rd Year", "4th Year"]

def seed():
    password_hash = generate_password_hash("password")
    
    with get_db() as conn:
        cur = conn.cursor()
        
        # Verify scholarships 11 and 12 exist
        cur.execute("SELECT req_no, scholarship_name FROM scholarships WHERE req_no IN (11, 12)")
        found_schs = {dict(s)['req_no']: dict(s)['scholarship_name'] for s in cur.fetchall()}
        print(f"Found requested scholarships: {found_schs}")
        
        if 11 not in found_schs or 12 not in found_schs:
            print(f"WARNING: Some scholarships not found in DB: 11 present={11 in found_schs}, 12 present={12 in found_schs}")
            print("Fetching all available active scholarships as fallback...")
            cur.execute("SELECT req_no, scholarship_name FROM scholarships WHERE COALESCE(is_removed, FALSE) = FALSE ORDER BY req_no")
            all_schs = [dict(s) for s in cur.fetchall()]
            print("Available scholarships in DB:", [(s['req_no'], s['scholarship_name']) for s in all_schs])
            
        # Assignments: 5 for req_no 11, 5 for req_no 12
        scholarship_assignments = [11] * 5 + [12] * 5
        statuses = ['Pending', 'Pending', 'Pending', 'Accepted', 'Rejected'] * 2
        
        # Check starting index to avoid email collision
        cur.execute("SELECT COUNT(*) as cnt FROM applicants")
        base_offset = cur.fetchone()['cnt'] + 1
        
        created_count = 0
        
        for idx in range(10):
            is_female = idx % 2 == 1
            first_name = FIRST_NAMES_FEMALE[idx % len(FIRST_NAMES_FEMALE)] if is_female else FIRST_NAMES_MALE[idx % len(FIRST_NAMES_MALE)]
            last_name = LAST_NAMES[idx % len(LAST_NAMES)]
            middle_name = LAST_NAMES[(idx + 3) % len(LAST_NAMES)]
            
            gpa = round(random.uniform(86.00, 98.00), 2)
            income = random.choice([110000, 140000, 160000, 190000, 210000, 240000])
            birth_year = random.choice([2003, 2004, 2005])
            birthdate = f"{birth_year}-{random.randint(1,12):02d}-{random.randint(1,28):02d}"
            sex = 'F' if is_female else 'M'
            course = COURSES[idx % len(COURSES)]
            year_lvl = YEAR_LEVELS[idx % len(YEAR_LEVELS)]
            school_id_no = 20240000 + base_offset + idx
            mobile_no = f"0917{base_offset+idx+500:07d}"
            email = f"dlsl.applicant{base_offset + idx:02d}@gmail.com"
            
            # Insert into applicants
            cur.execute("""
                INSERT INTO applicants (
                    first_name, last_name, middle_name, overall_gpa, financial_income_of_parents,
                    birthdate, sex, course, school, school_id_no, school_sector, year_lvl,
                    mobile_no, town_city_municipality, province, street_brgy, zip_code,
                    mother_status, father_status, mother_occupation, father_occupation,
                    mother_name, father_name, sibling_no, units, grades_year, profile_picture
                ) VALUES (
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, 'De La Salle Lipa', %s, 'Private', %s,
                    %s, 'Lipa City', 'Batangas', 'Brgy. Marawoy', '4217',
                    TRUE, TRUE, 'Housewife', 'Employee',
                    %s, %s, 2, 21, 2024, NULL
                ) RETURNING applicant_no
            """, (
                first_name, last_name, middle_name, gpa, income,
                birthdate, sex, course, school_id_no, year_lvl,
                mobile_no,
                f"Maria {middle_name}", f"Juan {last_name}"
            ))
            
            app_no = cur.fetchone()['applicant_no']
            
            # Insert into applicant_email
            cur.execute("""
                INSERT INTO applicant_email (
                    applicant_no, email_address, password_hash, is_verified, is_locked
                ) VALUES (%s, %s, %s, TRUE, FALSE)
            """, (app_no, email, password_hash))
            
            # Insert into applicant_status
            sch_no = scholarship_assignments[idx]
            status = statuses[idx]
            cur.execute("""
                INSERT INTO applicant_status (
                    applicant_no, scholarship_no, is_accepted, status_updated, created_at
                ) VALUES (%s, %s, %s, CURRENT_DATE, NOW())
            """, (app_no, sch_no, status))
            
            # Insert into applicant_documents
            cur.execute("""
                INSERT INTO applicant_documents (
                    applicant_no,
                    enrollment_certificate_doc, enrollment_certificate_vid_url,
                    grades_doc, grades_vid_url,
                    indigency_doc, indigency_vid_url,
                    id_img_front, id_img_back,
                    schoolid_front_vid_url, schoolid_back_vid_url, id_vid_url
                ) VALUES (
                    %s,
                    %s, %s,
                    %s, %s,
                    %s, %s,
                    %s, %s,
                    %s, %s, %s
                )
            """, (
                app_no,
                COR_DOC, COR_VID,
                GRADES_DOC, GRADES_VID,
                INDIGENCY_DOC, INDIGENCY_VID,
                FRONT_ID_DOC, BACK_ID_DOC,
                ID_VID, ID_VID, ID_VID
            ))
            
            created_count += 1
            print(f"Created applicant #{created_count}: ID {app_no} | {first_name} {last_name} | {email} | Sch: {sch_no} | Status: {status}")
            
        conn.commit()
        print(f"\nSUCCESSFULLY CREATED ALL 10 APPLICANTS FOR SCHOLARSHIPS 11 & 12!")

if __name__ == '__main__':
    seed()
