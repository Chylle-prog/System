#!/usr/bin/env python3
"""
Batch convert all WebM videos in Supabase to H.264 MP4 format.
Run this script to fix videos uploaded before the conversion pipeline was added.

Usage:
    # Run with environment variables set
    set SUPABASE_URL=your_url && set SUPABASE_KEY=your_key && set DB_HOST=host && set DB_USER=user && set DB_PASSWORD=pass && set DB_NAME=db && python batch_convert_videos.py
    
    OR edit the script and set values directly below
"""

import os
import sys
import time

# Configure these directly if not set as environment variables
SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_KEY = os.environ.get('SUPABASE_KEY', '')
DB_HOST = os.environ.get('DB_HOST', '')
DB_USER = os.environ.get('DB_USER', '')
DB_PASSWORD = os.environ.get('DB_PASSWORD', '')
DB_NAME = os.environ.get('DB_NAME', '')

print("[BATCH-CONVERT] Configuration:", flush=True)
print(f"  SUPABASE_URL: {SUPABASE_URL[:40] if SUPABASE_URL else 'NOT SET'}...", flush=True)
print(f"  DB_HOST: {DB_HOST if DB_HOST else 'NOT SET'}", flush=True)
print(f"  DB_NAME: {DB_NAME if DB_NAME else 'NOT SET'}", flush=True)

# Add the backend to path  
backend_path = os.path.join(os.path.dirname(__file__), 
                            'iskomats-dashboards-thesis-aclm-g3-master/iskomats-admins/TESTPYTHON/Student Ranking')
if os.path.exists(backend_path):
    sys.path.insert(0, backend_path)
    print(f"  Backend path: {backend_path}", flush=True)
else:
    print(f"  WARNING: Backend path not found: {backend_path}", flush=True)

try:
    from supabase import create_client
except ImportError:
    print("[BATCH-CONVERT] ERROR: supabase not installed. Run: pip install supabase", flush=True)
    sys.exit(1)

try:
    import mysql.connector
except ImportError:
    print("[BATCH-CONVERT] ERROR: mysql-connector-python not installed. Run: pip install mysql-connector-python", flush=True)
    sys.exit(1)

try:
    from services.video_converter import convert_video_to_mp4
except ImportError as e:
    print(f"[BATCH-CONVERT] ERROR: Could not import video_converter: {str(e)}", flush=True)
    print(f"[BATCH-CONVERT] Make sure backend path is correct and services/video_converter.py exists", flush=True)
    sys.exit(1)

def batch_convert_videos():
    """Convert all WebM videos to MP4 format."""
    
    print("\n[BATCH-CONVERT] Starting batch video conversion...", flush=True)
    print("[BATCH-CONVERT] This will convert all WebM videos in Supabase to H.264 MP4 format", flush=True)
    
    # Check configuration
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("[BATCH-CONVERT] ERROR: SUPABASE_URL and SUPABASE_KEY not configured", flush=True)
        print("[BATCH-CONVERT] Set environment variables or edit script configuration at top", flush=True)
        return False
    
    if not DB_HOST or not DB_USER or not DB_PASSWORD or not DB_NAME:
        print("[BATCH-CONVERT] ERROR: Database configuration incomplete", flush=True)
        print("[BATCH-CONVERT] Required: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME", flush=True)
        return False
    
    # Initialize Supabase
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        print("[BATCH-CONVERT] ✓ Connected to Supabase", flush=True)
    except Exception as e:
        print(f"[BATCH-CONVERT] ERROR: Could not connect to Supabase: {str(e)}", flush=True)
        return False
    
    # Connect to database
    try:
        db = mysql.connector.connect(
            host=DB_HOST,
            user=DB_USER,
            password=DB_PASSWORD,
            database=DB_NAME
        )
        cursor = db.cursor()
        print("[BATCH-CONVERT] ✓ Connected to database", flush=True)
    except Exception as e:
        print(f"[BATCH-CONVERT] ERROR: Could not connect to database: {str(e)}", flush=True)
        return False
    
    # Fetch all user records with video URLs
    try:
        cursor.execute("""
            SELECT applicant_no, id_vid_url, indigency_vid_url, grades_vid_url, 
                   enrollment_certificate_vid_url, schoolId_vid_url
            FROM users 
            WHERE (id_vid_url IS NOT NULL 
                   OR indigency_vid_url IS NOT NULL 
                   OR grades_vid_url IS NOT NULL 
                   OR enrollment_certificate_vid_url IS NOT NULL
                   OR schoolId_vid_url IS NOT NULL)
        """)
        
        records = cursor.fetchall()
        converted_count = 0
        error_count = 0
        skipped_count = 0
        
        field_mapping = {
            1: ('id_vid_url', 'face_video', 'id_verification'),
            2: ('indigency_vid_url', 'mayorIndigency_video', 'indigency'),
            3: ('grades_vid_url', 'mayorGrades_video', 'grades'),
            4: ('enrollment_certificate_vid_url', 'mayorCOE_video', 'coe'),
            5: ('schoolId_vid_url', 'schoolId_video', 'school_id')
        }
        
        print(f"[BATCH-CONVERT] Found {len(records)} records with videos", flush=True)
        
        for record in records:
            applicant_no = record[0]
            
            for field_index, (db_field, field_name, folder) in field_mapping.items():
                video_url = record[field_index]
                
                if not video_url:
                    continue
                
                try:
                    # Skip if already converted or MP4
                    if 'converted' in video_url or ('.mp4' in video_url and 'webm' not in video_url):
                        print(f"[BATCH-CONVERT] ⊘ Skipping {db_field} for {applicant_no} (already converted/MP4)", flush=True)
                        skipped_count += 1
                        continue
                    
                    print(f"[BATCH-CONVERT] ⧖ Converting {db_field} for {applicant_no}...", flush=True)
                    
                    # Extract file path from URL
                    if '/document_videos/' not in video_url:
                        print(f"[BATCH-CONVERT] ✗ Invalid URL format: {video_url[:80]}...", flush=True)
                        error_count += 1
                        continue
                    
                    file_path = video_url.split('/document_videos/')[1]
                    
                    # Download from Supabase
                    response = supabase.storage.from_('document_videos').download(file_path)
                    
                    if not response or len(response) == 0:
                        print(f"[BATCH-CONVERT] ✗ Failed to download {db_field} for {applicant_no}", flush=True)
                        error_count += 1
                        continue
                    
                    print(f"[BATCH-CONVERT]   Downloaded: {len(response)} bytes", flush=True)
                    
                    # Convert to MP4
                    converted_bytes = convert_video_to_mp4(response)
                    
                    if not converted_bytes or len(converted_bytes) == 0:
                        print(f"[BATCH-CONVERT] ✗ Conversion failed for {db_field}, using original", flush=True)
                        converted_bytes = response
                    else:
                        print(f"[BATCH-CONVERT]   Converted: {len(response)} → {len(converted_bytes)} bytes", flush=True)
                    
                    # Upload converted version
                    new_file_name = f"{applicant_no}_converted_{int(time.time())}.mp4"
                    new_file_path = f"videos/{folder}/{new_file_name}"
                    
                    supabase.storage.from_('document_videos').upload(
                        new_file_path,
                        converted_bytes,
                        {
                            'content-type': 'video/mp4',
                            'cache-control': '3600',
                            'upsert': 'true'
                        }
                    )
                    
                    new_url = supabase.storage.from_('document_videos').get_public_url(new_file_path)
                    
                    # Update database
                    update_query = f"UPDATE users SET {db_field} = %s WHERE applicant_no = %s"
                    cursor.execute(update_query, (new_url, applicant_no))
                    db.commit()
                    
                    print(f"[BATCH-CONVERT] ✓ Converted {db_field} for {applicant_no}", flush=True)
                    converted_count += 1
                    
                except Exception as video_err:
                    print(f"[BATCH-CONVERT] ✗ Error converting {db_field} for {applicant_no}: {str(video_err)}", flush=True)
                    error_count += 1
                    continue
        
        cursor.close()
        db.close()
        
        print("\n" + "="*60, flush=True)
        print(f"[BATCH-CONVERT] COMPLETED", flush=True)
        print(f"  ✓ Converted: {converted_count} videos", flush=True)
        print(f"  ⊘ Skipped: {skipped_count} videos (already converted)", flush=True)
        print(f"  ✗ Errors: {error_count} videos", flush=True)
        print("="*60, flush=True)
        
        return True
        
    except Exception as e:
        print(f"[BATCH-CONVERT] ERROR: {str(e)}", flush=True)
        import traceback
        traceback.print_exc()
        return False

if __name__ == '__main__':
    success = batch_convert_videos()
    sys.exit(0 if success else 1)
