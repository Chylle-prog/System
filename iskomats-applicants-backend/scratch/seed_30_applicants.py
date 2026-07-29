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

FIRST_NAMES_MALE = ["Juan", "Carlo", "Mark", "Gabriel", "Angelo", "Christian", "Josh", "Ethan", "Nathan", "Francis", "Daniel", "Kevin", "Justin", "Miggy", "Rafael"]
FIRST_NAMES_FEMALE = ["Maria", "Angela", "Patricia", "Bea", "Samantha", "Nicole", "Julia", "Sophia", "Camille", "Hannah", "Chloe", "Alyssa", "Denise", "Kaitlyn", "Gwyneth"]
LAST_NAMES = ["Santos", "Reyes", "Cruz", "Bautista", "Ocampo", "Garcia", "Mendoza", "Ramos", "Gonzales", "Castillo", "Torres", "Navarro", "Villanueva", "Rizal", "Del Rosario", "Aquino", "Mercado", "Soriano", "Perez", "Tolentino", "Manalo", "Dimaculangan", "Macatangay", "Katigbak", "De Castro", "Recto", "Vergara", "Hernandez", "Agbayani", "Malabanan"]

COURSES = ["BS Computer Science", "BS Information Technology", "BS Business Administration", "BS Industrial Engineering", "BS Nursing", "BS Accountancy"]
YEAR_LEVELS = ["1st Year", "2nd Year", "3rd Year", "4th Year"]

def seed():
    password_hash = generate_password_hash("password")
    
    with get_db() as conn:
        cur = conn.cursor()
        
        # 1. Fetch active scholarships
        cur.execute("SELECT req_no, scholarship_name FROM scholarships WHERE COALESCE(is_removed, FALSE) = FALSE ORDER BY req_no")
        scholarships = [dict(s) for s in cur.fetchall()]
        print(f"Found {len(scholarships)} active scholarships: {[s['req_no'] for s in scholarships]}")
        
        if not scholarships:
            print("ERROR: No active scholarships found!")
            return
            
        # Distribute 30 applicants across scholarships evenly
        # 30 applicants: 6 per scholarship if 5 scholarships
        scholarship_assignments = []
        for i in range(30):
            sch = scholarships[i % len(scholarships)]
            scholarship_assignments.append(sch['req_no'])
            
        # Status distribution: 20 Pending, 5 Accepted, 5 Rejected
        statuses = ['Pending'] * 20 + ['Accepted'] * 5 + ['Rejected'] * 5
        random.seed(42)
        random.shuffle(statuses)
        
        created_count = 0
        
        for idx in range(30):
            is_female = idx % 2 == 1
            first_name = FIRST_NAMES_FEMALE[idx % len(FIRST_NAMES_FEMALE)] if is_female else FIRST_NAMES_MALE[idx % len(FIRST_NAMES_MALE)]
            last_name = LAST_NAMES[idx]
            middle_name = LAST_NAMES[(idx + 5) % len(LAST_NAMES)]
            
            gpa = round(random.uniform(1.15, 2.25), 2)
            income = random.choice([120000, 150000, 180000, 200000, 220000, 250000, 280000])
            birth_year = random.choice([2003, 2004, 2005])
            birthdate = f"{birth_year}-{random.randint(1,12):02d}-{random.randint(1,28):02d}"
            sex = 'F' if is_female else 'M'
            course = COURSES[idx % len(COURSES)]
            year_lvl = YEAR_LEVELS[idx % len(YEAR_LEVELS)]
            school_id_no = 20240000 + idx + 1
            mobile_no = f"0917{idx+100:07d}"
            email = f"dlsl.applicant{idx+1:02d}@gmail.com"
            
            # A. Insert into applicants
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
            
            # B. Insert into applicant_email
            cur.execute("""
                INSERT INTO applicant_email (
                    applicant_no, email_address, password_hash, is_verified, is_locked
                ) VALUES (%s, %s, %s, TRUE, FALSE)
            """, (app_no, email, password_hash))
            
            # C. Insert into applicant_status
            sch_no = scholarship_assignments[idx]
            status = statuses[idx]
            cur.execute("""
                INSERT INTO applicant_status (
                    applicant_no, scholarship_no, is_accepted, status_updated, created_at
                ) VALUES (%s, %s, %s, CURRENT_DATE, NOW())
            """, (app_no, sch_no, status))
            
            # D. Insert into applicant_documents
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
        print(f"\nSUCCESSFULLY CREATED ALL {created_count} APPLICANTS IN SUPABASE DATABASE!")

if __name__ == '__main__':
    seed()
