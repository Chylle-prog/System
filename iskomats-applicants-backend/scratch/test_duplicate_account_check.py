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

def test_duplicate_check_name_only():
    conn = get_db()
    cur = conn.cursor()

    # 1. Test Identity Construction & Normalization (First, Middle, Last Names only)
    id1 = build_duplicate_account_identity("Mikaela Ysabel", "L", "Lantafe")
    id2 = build_duplicate_account_identity("mikaela ysabel", "L.", "LANTAFE")
    id3 = build_duplicate_account_identity("Mikaela Ysabel", "M", "Lantafe")
    id4 = build_duplicate_account_identity("Mikaela", "Ysabel", "Lantafe")
    
    print("--- IDENTITY CONSTRUCTION & NORMALIZATION TEST ---")
    print("ID 1 (Mikaela Ysabel | L | Lantafe):", id1)
    print("ID 2 (mikaela ysabel | L. | LANTAFE):", id2)
    print("ID 3 (Mikaela Ysabel | M | Lantafe - Diff Middle):", id3)
    print("ID 4 (Mikaela | Ysabel | Lantafe - Diff First/Middle):", id4)

    assert id1['identity_key'] == id2['identity_key'], f"Expected keys to match, got {id1['identity_key']} vs {id2['identity_key']}"
    assert id1['identity_key'] != id3['identity_key'], "Different middle names should NOT collide!"
    assert id1['identity_key'] != id4['identity_key'], "Different first/middle split should NOT collide!"
    print("[SUCCESS] First, Middle, Last name identity normalization matched correctly!\n")

    # 2. Test DB Duplicate Matching on Applicants Table
    cur.execute("SELECT applicant_no, first_name, middle_name, last_name FROM applicants WHERE first_name IS NOT NULL AND last_name IS NOT NULL LIMIT 20")
    rows = cur.fetchall()
    print("--- TESTING DATABASE SAMPLE FOR FIRST, MIDDLE, LAST NAME DUPLICATE ACCOUNTS ---")
    found_duplicates = False
    for row in rows:
        ids, has_matches, identity = get_matching_duplicate_applicant_ids(cur, row)
        if len(ids) > 1:
            found_duplicates = True
            print(f"[DUPLICATE] Duplicate accounts found for identity '{identity['identity_key']}': applicant IDs {ids}")
            print(f"   Primary/Oldest account (unlocked): {min(ids)}")
            print(f"   Duplicate/Newer accounts (locked): {[i for i in ids if i > min(ids)]}")
        else:
            print(f"Applicant {row['applicant_no']} ({row['first_name']} {row.get('middle_name') or ''} {row['last_name']}): Unique account (ID {ids[0]})")

    if not found_duplicates and rows:
        print("\nNo natural duplicate accounts found in sample rows. Testing simulated duplicate creation...")
        sample = rows[0]
        # Simulate creating a newer duplicate account (e.g. ID 999999) with matching first, middle, last name
        fake_duplicate = {
            'applicant_no': 999999,
            'first_name': sample['first_name'],
            'middle_name': sample['middle_name'],
            'last_name': sample['last_name'],
        }
        ids, has_matches, identity = get_matching_duplicate_applicant_ids(cur, fake_duplicate)
        print(f"\nSimulated new applicant (ID 999999) with exact SAME FIRST, MIDDLE, LAST NAME as applicant {sample['applicant_no']} ({sample['first_name']} {sample.get('middle_name') or ''} {sample['last_name']}):")
        print(f"   Matching IDs found in DB: {ids}")
        is_locked = 999999 > min(ids)
        print(f"   Is new duplicate account locked? {is_locked} (Main account is ID {min(ids)})")
        assert is_locked == True, "New account with same first, middle, and last names MUST lock!"
        print("\n[SUCCESS] Exact First, Middle, and Last Name duplicate validation rule verified successfully!")

    cur.close()
    conn.close()

if __name__ == "__main__":
    test_duplicate_check_name_only()
