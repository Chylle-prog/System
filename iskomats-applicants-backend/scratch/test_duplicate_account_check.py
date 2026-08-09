import sys
import os
from dotenv import load_dotenv

backend_dir = r"c:\Users\Chyle\OneDrive\Desktop\System\iskomats-applicants-backend"
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

load_dotenv(os.path.join(backend_dir, ".env"))

from project_config import get_db
from blueprints.student_api import (
    build_duplicate_account_identity,
    build_duplicate_account_identity_from_applicant,
    get_matching_duplicate_applicant_ids
)

def test_duplicate_check_school():
    conn = get_db()
    cur = conn.cursor()

    # 1. Test Identity Construction & Normalization (Full Name + School)
    id1 = build_duplicate_account_identity("Mikaela Ysabel", "L", "Lantafe", "De La Salle Lipa")
    id2 = build_duplicate_account_identity("mikaela ysabel", "L.", "LANTAFE", "de la salle lipa")
    id3 = build_duplicate_account_identity("Mikaela Ysabel", "L", "Lantafe", "Batangas State University")
    
    print("--- IDENTITY CONSTRUCTION & NORMALIZATION TEST ---")
    print("ID 1 (Same Name + Same School):", id1)
    print("ID 2 (Same Name + Same School):", id2)
    print("ID 3 (Same Name + Diff School):", id3)

    assert id1['identity_key'] == id2['identity_key'], f"Expected keys to match, got {id1['identity_key']} vs {id2['identity_key']}"
    assert id1['identity_key'] != id3['identity_key'], "Different schools should NOT collide!"
    print("[SUCCESS] Full Name + School identity normalization matched correctly!\n")

    # 2. Test DB Duplicate Matching on Applicants Table
    cur.execute("SELECT applicant_no, first_name, middle_name, last_name, school FROM applicants WHERE school IS NOT NULL AND school != '' LIMIT 20")
    rows = cur.fetchall()
    print("--- TESTING DATABASE SAMPLE FOR FULL NAME + SCHOOL DUPLICATE ACCOUNTS ---")
    found_duplicates = False
    for row in rows:
        ids, has_matches, identity = get_matching_duplicate_applicant_ids(cur, row)
        if len(ids) > 1:
            found_duplicates = True
            print(f"[DUPLICATE] Duplicate accounts found for identity '{identity['identity_key']}': applicant IDs {ids}")
            print(f"   Primary/Oldest account (unlocked): {min(ids)}")
            print(f"   Duplicate/Newer accounts (locked): {[i for i in ids if i > min(ids)]}")
        else:
            print(f"Applicant {row['applicant_no']} ({row['first_name']} {row['last_name']} @ {row['school']}): Unique account (ID {ids[0]})")

    if not found_duplicates and rows:
        print("\nNo natural duplicate accounts found in sample rows. Testing simulated duplicate creation...")
        sample = rows[0]
        # Simulate creating a newer duplicate account (e.g. ID 999999) with matching full name & school
        fake_duplicate = {
            'applicant_no': 999999,
            'first_name': sample['first_name'],
            'middle_name': sample['middle_name'],
            'last_name': sample['last_name'],
            'school': sample['school']
        }
        ids, has_matches, identity = get_matching_duplicate_applicant_ids(cur, fake_duplicate)
        print(f"\nSimulated new applicant (ID 999999) with exact SAME FULL NAME & SCHOOL as applicant {sample['applicant_no']} ({sample['first_name']} {sample['last_name']} @ {sample['school']}):")
        print(f"   Matching IDs found in DB: {ids}")
        is_locked = 999999 > min(ids)
        print(f"   Is new duplicate account locked? {is_locked} (Main account is ID {min(ids)})")
        assert is_locked == True, "New account with same full name & school MUST fail / lock!"
        print("\n[SUCCESS] Exact FULL name + School duplicate validation rule verified successfully!")

    cur.close()
    conn.close()

if __name__ == "__main__":
    test_duplicate_check_school()
