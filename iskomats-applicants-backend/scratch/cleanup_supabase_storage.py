"""
Supabase Storage Orphan Cleanup Script
========================================
Deletes files in Supabase Storage buckets that have no matching applicant record
in the PostgreSQL database, freeing up storage space and reducing future egress.

Usage:
    python scratch/cleanup_supabase_storage.py --dry-run   # Preview only
    python scratch/cleanup_supabase_storage.py             # Actually delete
"""

import os
import sys
import argparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from project_config import get_supabase_client
from services.db_service import get_db

BUCKETS = {
    'document_images': [
        'profile_pictures', 'id_verification', 'face_verification',
        'grades', 'coe', 'indigency', 'signatures', 'others'
    ],
    'document_videos': [
        'videos/id_verification', 'videos/school_id', 'videos/grades',
        'videos/coe', 'videos/indigency', 'others'
    ]
}

def get_known_applicant_nos():
    """Fetch all known applicant_no values from the database."""
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT applicant_no::text FROM applicants")
            rows = cur.fetchall()
            # Handle both dict cursor (RealDictCursor) and tuple cursor
            result = set()
            for r in rows:
                if isinstance(r, dict):
                    result.add(str(r.get('applicant_no', '')))
                else:
                    result.add(str(r[0]))
            return result

def list_all_files(supa, bucket, folder):
    """Recursively list all files in a bucket folder."""
    files = []
    try:
        items = supa.storage.from_(bucket).list(folder)
        for item in items:
            if item.get('id'):  # It's a file
                files.append(f"{folder}/{item['name']}")
            else:  # It's a folder, recurse
                sub = list_all_files(supa, bucket, f"{folder}/{item['name']}")
                files.extend(sub)
    except Exception as e:
        print(f"  [WARN] Failed to list {bucket}/{folder}: {e}")
    return files

def extract_applicant_no_from_path(path):
    """
    Extract applicant_no from storage path.
    Paths are like:
      profile_pictures/12345-someuser.jpg
      videos/school_id/12345-someuser/schoolIdFront_video.webm
    """
    parts = path.split('/')
    # Last meaningful segment (filename or folder) usually starts with applicant_no
    for part in parts:
        if '-' in part:
            candidate = part.split('-')[0]
            if candidate.isdigit():
                return candidate
    return None

def run_cleanup(dry_run=True):
    supa = get_supabase_client()
    if not supa:
        print("[ERROR] Supabase client unavailable. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env")
        sys.exit(1)

    print("Fetching known applicant numbers from database...")
    known_nos = get_known_applicant_nos()
    print(f"  Found {len(known_nos)} applicants in DB.\n")

    total_listed = 0
    total_orphans = 0
    total_deleted = 0
    total_errors = 0

    for bucket, folders in BUCKETS.items():
        print(f"=== Bucket: {bucket} ===")
        for folder in folders:
            print(f"  Scanning: {folder}/")
            files = list_all_files(supa, bucket, folder)
            total_listed += len(files)

            for file_path in files:
                applicant_no = extract_applicant_no_from_path(file_path)
                if applicant_no and applicant_no not in known_nos:
                    total_orphans += 1
                    print(f"    [ORPHAN] {file_path}  (applicant_no={applicant_no} not in DB)")
                    if not dry_run:
                        try:
                            supa.storage.from_(bucket).remove([file_path])
                            print(f"    [DELETED] {file_path}")
                            total_deleted += 1
                        except Exception as e:
                            print(f"    [ERROR] Failed to delete {file_path}: {e}")
                            total_errors += 1

        print()

    print("=" * 60)
    print(f"Total files scanned : {total_listed}")
    print(f"Total orphans found : {total_orphans}")
    if dry_run:
        print(f"DRY RUN — no files were deleted. Re-run without --dry-run to delete.")
    else:
        print(f"Total files deleted : {total_deleted}")
        print(f"Total errors        : {total_errors}")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Clean up orphaned Supabase Storage files.')
    parser.add_argument('--dry-run', action='store_true', help='Preview deletions without actually deleting.')
    args = parser.parse_args()

    run_cleanup(dry_run=args.dry_run)
