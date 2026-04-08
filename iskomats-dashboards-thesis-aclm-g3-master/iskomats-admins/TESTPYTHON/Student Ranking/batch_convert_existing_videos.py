#!/usr/bin/env python3
"""
Batch convert all existing videos in Supabase from WebM/unsupported formats to H.264 MP4.
This script fixes videos uploaded before the conversion pipeline was added.

Usage:
    python batch_convert_existing_videos.py
"""

import os
import sys
import time
import requests
import io
from dotenv import load_dotenv

# Add parent directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

# Load environment variables
load_dotenv()

from services.db_service import get_db
from services.video_converter import convert_video_to_mp4

def fetch_video_from_supabase(url):
    """Fetch video bytes from Supabase URL."""
    if not url:
        return None
    
    try:
        headers = {'User-Agent': 'ISKOMATS-Video-Converter/1.0'}
        response = requests.get(url, headers=headers, timeout=30)
        
        if response.status_code == 200:
            return response.content
        else:
            print(f"  ❌ Failed to fetch: HTTP {response.status_code}")
            return None
    except Exception as e:
        print(f"  ❌ Error fetching: {str(e)}")
        return None

def upload_converted_video_to_supabase(converted_bytes, original_url, field_name):
    """Upload converted video back to Supabase, replacing the original."""
    try:
        from supabase import create_client
        
        supabase_url = os.environ.get('SUPABASE_URL')
        supabase_key = os.environ.get('SUPABASE_KEY')
        
        if not supabase_url or not supabase_key:
            print("  ❌ Missing Supabase credentials")
            return False
        
        supabase = create_client(supabase_url, supabase_key)
        
        # Extract path from URL (everything after /document_videos/)
        if '/document_videos/' not in original_url:
            print(f"  ❌ Invalid Supabase URL format")
            return False
        
        file_path = original_url.split('/document_videos/')[-1]
        
        print(f"  📤 Uploading converted video to: {file_path}")
        
        # Upload, replacing the original file
        response = supabase.storage.from_('document_videos').upload(
            file_path,
            converted_bytes,
            {
                'content-type': 'video/mp4',
                'cache-control': '3600',
                'upsert': 'true'  # Replace existing file
            }
        )
        
        print(f"  ✅ Successfully uploaded ({len(converted_bytes)} bytes)")
        return True
        
    except Exception as e:
        print(f"  ❌ Upload error: {str(e)}")
        return False

def main():
    """Main batch conversion function."""
    print("=" * 70)
    print("ISKOMATS VIDEO BATCH CONVERTER")
    print("Converting all existing videos from Supabase to H.264 MP4 format")
    print("=" * 70)
    print()
    
    try:
        # Connect to database
        db = get_db()
        cursor = db.cursor()
        
        # Query all video fields
        cursor.execute("""
            SELECT 
                applicant_no,
                id_vid_url,
                indigency_vid_url,
                grades_vid_url,
                enrollment_certificate_vid_url,
                schoolId_vid_url
            FROM applicants
            WHERE (
                id_vid_url IS NOT NULL OR 
                indigency_vid_url IS NOT NULL OR 
                grades_vid_url IS NOT NULL OR 
                enrollment_certificate_vid_url IS NOT NULL OR
                schoolId_vid_url IS NOT NULL
            )
        """)
        
        applicants = cursor.fetchall()
        db.close()
        
        if not applicants:
            print("✅ No videos found to convert")
            return
        
        total_videos = sum(
            1 for a in applicants 
            for url in [a.get('id_vid_url'), a.get('indigency_vid_url'), 
                       a.get('grades_vid_url'), a.get('enrollment_certificate_vid_url'),
                       a.get('schoolId_vid_url')]
            if url
        )
        
        print(f"📦 Found {len(applicants)} applicants with {total_videos} videos")
        print(f"Starting conversion... (this may take a while)")
        print()
        
        converted_count = 0
        failed_count = 0
        
        for idx, applicant in enumerate(applicants, 1):
            applicant_no = applicant['applicant_no']
            print(f"[{idx}/{len(applicants)}] Applicant #{applicant_no}")
            
            video_fields = {
                'id_vid_url': 'Face Video',
                'indigency_vid_url': 'Indigency Video',
                'grades_vid_url': 'Grades Video',
                'enrollment_certificate_vid_url': 'COE Video',
                'schoolId_vid_url': 'School ID Video'
            }
            
            for field, label in video_fields.items():
                url = applicant.get(field)
                
                if not url:
                    continue
                
                print(f"  📹 {label}")
                print(f"     Fetching from Supabase...")
                
                # Fetch original video
                video_bytes = fetch_video_from_supabase(url)
                if not video_bytes:
                    failed_count += 1
                    continue
                
                print(f"     Converting to H.264 MP4 ({len(video_bytes)} bytes)...")
                
                # Convert video
                converted_bytes = convert_video_to_mp4(video_bytes)
                
                if not converted_bytes or len(converted_bytes) == 0:
                    print(f"  ❌ Conversion failed")
                    failed_count += 1
                    continue
                
                # Upload converted video
                if upload_converted_video_to_supabase(converted_bytes, url, field):
                    converted_count += 1
                    print(f"     ✅ Conversion complete (saved {len(converted_bytes)} bytes)")
                else:
                    failed_count += 1
                
                # Small delay to avoid rate limiting
                time.sleep(1)
            
            print()
        
        print("=" * 70)
        print("BATCH CONVERSION COMPLETE")
        print("=" * 70)
        print(f"✅ Successfully converted: {converted_count} videos")
        print(f"❌ Failed: {failed_count} videos")
        print()
        print("Users may need to refresh their browser to see converted videos.")
        
    except Exception as e:
        print(f"❌ Fatal error: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    main()
