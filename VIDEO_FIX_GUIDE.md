# Video Format Error Resolution - Complete Guide

## Problem Summary

Your existing videos are failing to play with **MediaError code 4: "Format error"** because they're stored in WebM format (output from MediaRecorder API) which has limited browser support.

**Console Errors:**
```
Video error for Record Grades Video: MediaError {code: 4, message: 'MEDIA_ELEMENT_ERROR: Format error'}
Video error for Record COE Video: MediaError {code: 4, message: 'MEDIA_ELEMENT_ERROR: Format error'}
Video error for Record Indigency Video: MediaError {code: 4, message: 'MEDIA_ELEMENT_ERROR: Format error'}
Video error for Record Face Video: MediaError {code: 4, message: 'MEDIA_ELEMENT_ERROR: Format error'}
```

## Solution Implemented

### 1. Backend Video Conversion Endpoint ✅
**Location:** `student_api.py` (lines 2138-2213)
**Endpoint:** `POST /api/student/videos/convert-and-upload`
**Does:** Converts WebM → H.264 MP4 before storing in Supabase
**Status:** Code created, needs deployment on render.com

### 2. Frontend API Updated ✅
**Location:** `api.js` (lines 443-468)
**Change:** `uploadRequirementVideo()` now calls backend conversion endpoint
**Status:** Deployed to surge.sh

### 3. Video Conversion Service ✅
**Location:** `services/video_converter.py`
**Does:** Uses ffmpeg to transcode WebM to H.264 MP4
**Status:** Created and imported

## Two-Part Fix Required

### PART 1: Fix Existing WebM Videos (CRITICAL)

Your 4 existing videos are in WebM format and need conversion:
- `id_vid_url` → stored in `id_verification` folder
- `indigency_vid_url` → stored in `indigency` folder
- `grades_vid_url` → stored in `grades` folder
- `enrollment_certificate_vid_url` → stored in `coe` folder

**Option A: Run Batch Conversion Script** (Recommended for immediate fix)

```powershell
# Navigate to workspace root
cd 'c:\Users\Chyle\OneDrive\Desktop\System'

# Set environment variables (Windows PowerShell)
$env:SUPABASE_URL = 'your_supabase_url'
$env:SUPABASE_KEY = 'your_supabase_key'
$env:DB_HOST = 'your_database_host'
$env:DB_USER = 'your_database_user'
$env:DB_PASSWORD = 'your_database_password'
$env:DB_NAME = 'iskomats'

# Run the batch conversion script
python batch_convert_videos.py
```

**Option B: Use Backend Endpoint** (After deploying to render.com)

Once the backend is deployed with the new endpoints, call:
```
POST /api/student/batch-convert-videos
```

### PART 2: Deploy Updated Backend

The new endpoints need to be deployed on render.com:

**Files Changed:**
- `iskomats-dashboards-thesis-aclm-g3-master/iskomats-admins/TESTPYTHON/Student Ranking/blueprints/student_api.py`
  - Added: `POST /api/student/videos/convert-and-upload` (lines 2138-2213)
  - Added: `POST /api/student/batch-convert-videos` (lines 2216-2330)

**Deployment Steps:**
1. Push changes to your render.com repository
2. Render will auto-deploy
3. Verify endpoints are live: `https://iskomats-backend.onrender.com/api/student/videos/convert-and-upload`

## How It Works (After Fix)

### Current Flow (Broken)
```
VideoRecorder (WebM blob)
    ↓
Frontend (direct Supabase upload)
    ↓
Supabase (stores WebM)
    ↓
Browser: ❌ MediaError code 4 - Format not supported
```

### New Flow (Fixed)
```
VideoRecorder (WebM blob)
    ↓
Frontend → Backend endpoint
    ↓
Backend (convert WebM → H.264 MP4)
    ↓
Supabase (stores MP4)
    ↓
Browser: ✅ Video plays (H.264 is universal)
```

## Technical Details

### Conversion Command
```bash
ffmpeg -i input.webm -c:v libx264 -preset fast -crf 23 -c:a aac -movflags +faststart output.mp4
```

**Settings:**
- **Codec:** H.264 (libx264) - 100% browser support
- **Quality:** CRF 23 - good balance of quality/size
- **Audio:** AAC codec
- **Streaming:** faststart flag for web playback

### Video Path Mapping
```
Field Name                  Folder              Example URL
────────────────────────────────────────────────────────────
id_vid_url                  /videos/id_verification/
indigency_vid_url           /videos/indigency/
grades_vid_url              /videos/grades/
enrollment_certificate_vid  /videos/coe/
schoolid_front_vid_url      /videos/school_id/
schoolid_back_vid_url       /videos/school_id/
```

## Testing After Fix

1. **Test Existing Videos:** 
   - Run batch conversion script
   - Refresh portal: https://foregoing-giants.surge.sh/
   - Check if videos play without error

2. **Test New Video Upload:**
   - Record a new video in StudentInfo
   - Check console for "[VIDEO-CONVERT-UPLOAD]" messages
   - Verify video plays without format error

3. **Verify Storage:**
   - Check Supabase storage
   - New videos should be `.mp4` files
   - Old videos should be renamed with `_converted` suffix

## Environment Variables Needed

For batch_convert_videos.py script:
```
SUPABASE_URL     - Your Supabase project URL
SUPABASE_KEY     - Your Supabase service role key
DB_HOST          - Database hostname
DB_USER          - Database username
DB_PASSWORD      - Database password
DB_NAME          - Database name (iskomats)
```

## Dependencies

- **Backend:** ffmpeg system binary (checked at runtime)
- **Frontend:** No new dependencies (works with existing setup)
- **Database:** MySQL/MariaDB (for storing URLs)

## Fallback Behavior

If ffmpeg is not available on deployment:
- Video conversion fails gracefully
- Original WebM video is stored (old behavior)
- User can still download but playback may fail
- **Recommendation:** Ensure ffmpeg is installed on render.com deployment

## Files Created/Modified

### Created:
- `batch_convert_videos.py` - Standalone conversion script
- `services/video_converter.py` - Ffmpeg integration module

### Modified:
- `student_api.py` - Added 2 new endpoints
- `api.js` - Updated uploadRequirementVideo()

## Next Steps

1. **Immediate:** Run `batch_convert_videos.py` to fix existing videos
2. **Short-term:** Deploy backend to render.com with new endpoints
3. **Verify:** Test video upload and playback in portal
4. **Monitor:** Check console for conversion logging during uploads

## Troubleshooting

### "Video Format Not Supported" still appears
→ Run batch conversion script to fix existing videos
→ Ensure backend is deployed with new endpoints

### Batch script fails to import video_converter
→ Make sure you're running from the workspace root directory
→ Verify `services/video_converter.py` exists in backend

### ffmpeg not found
→ Install ffmpeg on your system (required for conversion)
→ Or deploy to render.com with ffmpeg available

### Database connection fails
→ Verify environment variables are set correctly
→ Check database hostname, credentials, and network access

## Success Indicators

✅ Batch script shows: "Converted: X videos, Errors: 0"
✅ Fresh page load shows videos without format errors
✅ New recordings play immediately after upload
✅ Console shows "[VIDEO-CONVERT-UPLOAD] Successfully uploaded"
✅ Supabase storage shows .mp4 files instead of .webm
