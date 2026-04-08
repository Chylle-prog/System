# BACKEND ENVIRONMENT CONFIGURATION GUIDE

## Problem
Video upload failing with: **"supabase_key is required"**

This means the backend server doesn't have Supabase credentials configured.

---

## ✅ Solution: Configure Environment Variables

### Step 1: Locate the `.env` File
```
Student Ranking/.env
```

or create it if it doesn't exist in the Student Ranking directory.

### Step 2: Add Supabase Credentials

Add or update these variables in your `.env` file:

```env
# ===== SUPABASE CONFIGURATION =====
SUPABASE_URL=https://cgslnbnqzxevrzbjdyru.supabase.co
SUPABASE_KEY=YOUR_SUPABASE_ANON_KEY_HERE
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY_HERE

# Or use just one key (system will try both):
# SUPABASE_KEY=your_key_here
```

### Step 3: Find Your Supabase Keys

1. Go to **Supabase Dashboard**: https://supabase.com
2. Select your project: **iskomats-application**
3. Go to **Settings → API**
4. Copy:
   - **"Public API Key"** → Use as `SUPABASE_KEY`
   - **"Service Role Key"** → Use as `SUPABASE_SERVICE_ROLE_KEY`

**DO NOT commit these keys to version control!** Keep `.env` in `.gitignore`

---

## 🔍 Verify Configuration

### Check 1: File Exists
```powershell
Test-Path "Student Ranking/.env"
```
Should return `True`

### Check 2: Keys Are Set
```powershell
$env = Get-Content "Student Ranking/.env" | ConvertFrom-StringData
$env['SUPABASE_URL']
$env['SUPABASE_KEY']
```
Should show your Supabase URL and key

### Check 3: Backend Loads Correctly
Check server logs when starting:
```
[VIDEO-CONVERT-UPLOAD] Connecting to Supabase at https://cgslnbnqzxevrzbjdyru.supabase.co
```
(This message should appear when uploading a video)

---

## 📋 Required Environment Variables

| Variable | Example | Required | Source |
|----------|---------|----------|--------|
| `SUPABASE_URL` | `https://cgslnbnqzxevrzbjdyru.supabase.co` | ✅ | Supabase Dashboard |
| `SUPABASE_KEY` | `eyJhbGciOiJIUzI1NiIs...` | ⚠️ * | Supabase → Settings → API → Public API |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGciOiJIUzI1NiIs...` | ⚠️ * | Supabase → Settings → API → Service Role |

*Either `SUPABASE_KEY` or `SUPABASE_SERVICE_ROLE_KEY` is required (system will use whichever is available)

---

## 🛠️ Common Issues

### ❌ "supabase_key is required"
**Cause:** Neither `SUPABASE_KEY` nor `SUPABASE_SERVICE_ROLE_KEY` is set

**Fix:**
1. Check `.env` file exists
2. Add at least one Supabase key
3. Restart the backend server

### ❌ "SUPABASE_URL not configured"
**Cause:** `SUPABASE_URL` is missing

**Fix:**
1. Get URL from Supabase Dashboard
2. Add to `.env`: `SUPABASE_URL=https://your-project.supabase.co`

### ❌ "Invalid supabase_url"
**Cause:** URL format is wrong

**Fix:** Should be: `https://PROJECT_ID.supabase.co` (includes protocol and no trailing slash)

### ❌ Still not working after adding `.env`?
**Solution:**
1. Restart the backend server completely (stop and start)
2. Check server logs for error messages
3. Verify `.env` file is in the correct directory
4. Ensure `.env` keys don't have extra spaces: `SUPABASE_URL = https://...` ❌ remove spaces

---

## 🚀 Complete `.env` Template

```env
# ===== SUPABASE CONFIGURATION =====
SUPABASE_URL=https://cgslnbnqzxevrzbjdyru.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# ===== DATABASE CONFIGURATION =====
DB_HOST=your_db_host
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=your_password

# ===== EMAIL CONFIGURATION =====
GMAIL_SENDER_EMAIL=your-email@gmail.com
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REFRESH_TOKEN=your_refresh_token

# ===== JWT & ENCRYPTION =====
ENCRYPTION_KEY=your_encryption_key_here
SECRET_KEY=your_secret_key_here

# ===== FRONTEND URLS =====
STUDENT_FRONTEND_URL=https://foregoing-giants.surge.sh
```

---

## 📝 After Configuration

1. **Restart Backend Server**
   - Stop the current process (Ctrl+C)
   - Start fresh: `python app.py` or your start command

2. **Test Video Upload**
   - Go to Student Portal → Step 3
   - Upload a test video
   - Should complete successfully ✅

3. **Check Console Logs**
   ```
   [VIDEO-CONVERT-UPLOAD] Connecting to Supabase at https://cgslnbnqzxevrzbjdyru.supabase.co
   [VIDEO-CONVERT-UPLOAD] Uploading to Supabase: videos/school_id/...
   [VIDEO-CONVERT-UPLOAD] Successfully uploaded: https://...
   ```

---

## 🔐 Security Notes

⚠️ **IMPORTANT:**
- Never commit `.env` to version control
- Never share `SUPABASE_SERVICE_ROLE_KEY` publicly
- Rotate keys if exposed
- Use `.gitignore` entry: `*.env`
- Use environment variables on production servers (not `.env` files)

---

## 📞 Support

If video upload still fails after configuration:

1. Check backend console logs for error message
2. Verify Supabase project is active (not deleted/suspended)
3. Check Supabase bucket permissions: `document_videos` bucket must be writable
4. Ensure FFmpeg is installed: `ffmpeg -version`

---

**Status:** ✅ Configuration complete once `.env` is set up with Supabase keys
