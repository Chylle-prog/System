# BATCH VIDEO CONVERSION - QUICK START

## Problem
Videos in the student portal show a playback error: "Video Format Not Supported"

**Root cause:** Videos in Supabase are in WebM format (unsupported by browsers)

---

## Solution
Run the batch converter to convert all existing videos to H.264 MP4 format (browser-compatible)

---

## Quick Start (5 Steps)

### 1️⃣ Install FFmpeg (One-time Setup)
```powershell
# Windows - using Chocolatey
choco install ffmpeg -y

# Verify installation
ffmpeg -version
```
⚠️ **Must be installed on the server** - This is the tool that converts videos

---

### 2️⃣ Verify Supabase Credentials
Open: `Student Ranking\.env`

Confirm these variables exist:
```
SUPABASE_URL=https://cgslnbnqzxevrzbjdyru.supabase.co
SUPABASE_KEY=your_service_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

---

### 3️⃣ Run the Batch Converter
```powershell
cd "C:\Users\Chyle\OneDrive\Desktop\System\iskomats-dashboards-thesis-aclm-g3-master\iskomats-admins\TESTPYTHON\Student Ranking"

python batch_convert_existing_videos.py
```

---

### 4️⃣ Wait for Completion
Console output will show:
```
[1/5] Applicant #123
  📹 Face Video
     Fetching from Supabase...
     Converting to H.264 MP4...
     Uploading converted video...
  ✅ Successfully uploaded

BATCH CONVERSION COMPLETE
✅ Successfully converted: 5 videos
❌ Failed: 0 videos
```

---

### 5️⃣ Verify Success
- Test video playback on portal
- Videos should now play immediately ✅
- Users may need to refresh browser cache

---

## Timing

| Action | Time |
|--------|------|
| Per video conversion | 1-3 minutes |
| Upload to Supabase | 30 seconds - 2 minutes |
| Total for 5 videos | ~10-20 minutes |
| Total for 20 videos | ~1 hour |

**Pro Tip:** Run at off-peak hours if heavy system load concerns you

---

## Troubleshooting

### ❌ "ffmpeg not found"
FFmpeg is not installed:
```powershell
# Install FFmpeg
choco install ffmpeg -y

# Restart terminal and try again
```

### ❌ "SUPABASE_URL not found"
Missing `.env` file or missing credentials:
```powershell
# Create .env file with:
SUPABASE_URL=https://cgslnbnqzxevrzbjdyru.supabase.co
SUPABASE_KEY=your_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### ❌ "Connection timeout"
Network issue or Supabase down:
- Check internet connection
- Verify Supabase status: https://supabase.com/status
- Try again after 5 minutes

### ❌ Some videos failed to convert
This is normal if original video is corrupted:
- Script continues processing remaining videos
- Check the final report for failed video count
- Failed videos can be re-uploaded

---

## Result

After running the script:

**Before:**
```
❌ Video Format Not Supported
⚠️  Cannot play in browser
📥 Download alternative
```

**After:**
```
✅ Video plays immediately
🎬 Full browser support
📱 Mobile compatible
```

---

## Files Created/Modified

- ✅ **New:** `batch_convert_existing_videos.py` - The conversion script
- ✅ **Updated:** `VideoRecorder.jsx` - Better error messaging
- ✅ **New:** `VIDEO_PLAYBACK_FIX.md` - Detailed documentation
- ✅ **Existing:** `student_api.py` - Conversion pipeline (lines 2142-2210)

---

## Next Steps

After conversion completes:

1. ✅ Test with a few videos first (optional)
2. ✅ Run full batch conversion
3. ✅ Users refresh their browser
4. ✅ All videos should play

**Questions?** See `VIDEO_PLAYBACK_FIX.md` for detailed explanations

---

**Need to run again?** No problem! The script is safe to run multiple times. Re-converts any videos that haven't been updated.
