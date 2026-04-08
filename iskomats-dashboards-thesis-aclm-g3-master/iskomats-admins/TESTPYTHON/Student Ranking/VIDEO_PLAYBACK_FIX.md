# VIDEO PLAYBACK ERROR - ROOT CAUSE & SOLUTIONS

**Status:** Videos in Supabase are stored in **unsupported format** (likely WebM) causing MediaError code 4

**Console Error:** `MediaError {code: 4, message: 'MEDIA_ELEMENT_ERROR: Format error'}`

---

## 🔍 Root Cause Analysis

### The Problem
Videos are failing to play in the browser with MediaError code 4, which means:
- Videos are NOT in H.264 MP4 format (the only universally supported format for HTML5 video)
- They're likely WebM, MOV, or another format that the browser can't decode
- The VideoRecorder component properly handles this with a download fallback, but the videos should be playable

### Why This Happened
The conversion pipeline exists in the code (`convert_video_to_mp4`) but:
1. Old videos were uploaded **before** the conversion was implemented
2. New uploads need to use the conversion endpoint (in step 3)
3. Existing videos in Supabase are still in their original unsupported format

---

## ✅ Solutions

### Solution 1: Batch Convert ALL Existing Videos (Complete Fix)
This is the **recommended solution** that fixes all videos at once.

#### Prerequisites
- FFmpeg must be installed on your server: `ffmpeg -version`
- Python environment with dependencies: `pip install requests python-dotenv supabase`
- `.env` file with Supabase credentials

#### Steps
```bash
# Navigate to the Student Ranking directory
cd "C:\Users\Chyle\OneDrive\Desktop\System\iskomats-dashboards-thesis-aclm-g3-master\iskomats-admins\TESTPYTHON\Student Ranking"

# Run the batch converter
python batch_convert_existing_videos.py
```

**What it does:**
- Fetches all videos from Supabase
- Converts each to H.264 MP4 using FFmpeg
- Uploads the converted versions back, replacing originals
- Takes ~1-2 minutes per video depending on length

**Result:** Videos will play immediately after conversion (users may need to refresh)

---

### Solution 2: API Endpoint for Single/New Videos (For Future Uploads)
New videos uploaded through the form should already use this.

**Endpoint:** `POST /api/student/convert-and-upload-video`
**Status:** Already implemented in `student_api.py` lines 2142-2210

**How it works:**
1. Frontend sends video file
2. Backend converts to H.264 MP4
3. Uploads to Supabase
4. Returns public URL

**Ensure this is used when uploading new videos.**

---

### Solution 3: Immediate Workaround (For Users)
The VideoRecorder component already has a fallback UI:

**Current Behavior:**
- Video fails to play → Shows error message with download link
- Users can download the video to view locally

**CSS/UI Enhancement (VideoRecorder.jsx currently shows):**
```jsx
{videoError ? (
    // Error state: show download link instead
    <div style={{...}}>
      <p>Video Format Not Supported</p>
      <a href={previewUrl} download>
        <i className="fas fa-download"></i>
        Download Video
      </a>
    </div>
)
```

This is **already implemented** (lines 120-164) but better messaging could help users understand videos will work once converted.

---

## 🛠️ Implementation Steps

### Step 1: Verify FFmpeg Installation
```bash
# Windows PowerShell
ffmpeg -version

# If not installed, install via chocolatey:
choco install ffmpeg -y
# Or download from: https://ffmpeg.org/download.html
```

### Step 2: Ensure Environment Variables
Check `.env` file in Student Ranking directory:
```
SUPABASE_URL=https://cgslnbnqzxevrzbjdyru.supabase.co
SUPABASE_KEY=your_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_key_here
```

### Step 3: Run Batch Conversion
```bash
python batch_convert_existing_videos.py
```

### Step 4: Verify Conversion
- Check database logging output
- Test video playback on student portal
- Videos should play without errors

---

## 📋 Video Specifications (After Conversion)

All videos will be converted to:
- **Format:** MP4
- **Video Codec:** H.264 (libx264)
- **Audio Codec:** AAC
- **Bitrate:** Variable (quality level 23)
- **Features:** Optimized for streaming (+faststart flag)

This format is:
- ✅ Supported in all modern browsers
- ✅ Supported on mobile devices
- ✅ Optimized for web delivery
- ✅ Compression gives smaller file sizes than WebM

---

## 🔧 Troubleshooting

### Issue: FFmpeg Not Found
```
[VIDEO CONVERT] ffmpeg not available, returning original video bytes
```
**Solution:** Install FFmpeg on the server
```bash
# Windows
choco install ffmpeg -y

# Linux
sudo apt-get install ffmpeg -y

# macOS
brew install ffmpeg
```

### Issue: Conversion Still Fails After Batch Processing
**Possible Causes:**
1. Videos are corrupted
2. FFmpeg lacks required codecs
3. Insufficient disk space
4. Supabase upload permissions

**Debug Steps:**
- Check server disk space: `df -h` (Linux) or `Get-Volume` (PowerShell)
- Test FFmpeg manually: `ffmpeg -i input.webm output.mp4`
- Check Supabase bucket permissions
- Look for error logs in console output

### Issue: Some Videos Convert But Others Don't
- This is expected if original videos are corrupted
- The script continues to process remaining videos
- Failed videos will show in the final report

---

## 📊 Monitoring Conversion Progress

The batch script provides real-time feedback:
```
[1/5] Applicant #123
  📹 Face Video
     Fetching from Supabase...
     Converting to H.264 MP4 (1204556 bytes)...
  📤 Uploading converted video to: videos/id_verification/user@email_1234567890.mp4
  ✅ Successfully uploaded (1050234 bytes)
```

---

## 🎯 Future Prevention

### For New Video Uploads
Ensure the `convert-and-upload-video` endpoint is used in the frontend form submission:

```javascript
// In StudentInfo.jsx or wherever videos are submitted
const uploadVideo = async (file, fieldName) => {
  const formData = new FormData();
  formData.append('video', file);
  formData.append('field_name', fieldName);
  
  const response = await fetch(
    'https://your-backend.com/api/student/convert-and-upload-video',
    { method: 'POST', body: formData }
  );
  
  return response.json();
};
```

---

## 📝 Summary

| Issue | Solution | Status |
|-------|----------|--------|
| Existing videos unplayable | Run batch converter | 🔴 Needs Action |
| New uploads not converted | Use conversion endpoint | 🟢 Implemented |
| User visibility | Error handling in UI | 🟢 Implemented |
| Server support | FFmpeg installation | ⚠️ Verify |

**Recommended Action:** Run the batch conversion script immediately to fix all existing videos.

---

**Script Location:** `batch_convert_existing_videos.py` in Student Ranking directory

**Estimated Runtime:** 1-2 minutes per video (test with 1-3 videos first)

**Result:** All videos playable in all modern browsers after conversion ✅
