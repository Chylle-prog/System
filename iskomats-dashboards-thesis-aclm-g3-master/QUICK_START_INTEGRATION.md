# Quick Start: Connect React to Python

## What the Analysis Found

### ✅ React Components WITH Python Backend
- **login.jsx** - Has `/login` endpoint (needs conversion to API)
- **register.jsx** - Has `/register` endpoint (needs conversion to API)
- **dash.jsx** - Admin dashboard (has routing, needs data APIs)
- **dash-africa.jsx** - Africa scholarship program (needs applicant/ranking APIs)
- **dash-vilma.jsx** - Vilma scholarship program (needs applicant/ranking APIs)
- **dash-tulong.jsx** - Tulong scholarship program (needs applicant/ranking APIs)

### ❌ React Components WITHOUT Python Backend
1. **access-denied.jsx** → UI only, needs NO backend
2. **forget-pass.jsx** → Password reset NOT implemented in Python
3. **reset-pass.jsx** → Password reset NOT implemented in Python
4. **verify-email.jsx** → Email verification NOT implemented in Python

---

## Implementation Steps

### Step 1: Install Required Python Packages
```bash
cd iskomats-admins/TESTPYTHON
pip install flask-cors pyjwt
```

### Step 2: Update Python Main App
In your main Flask app file (Scholarship_ranking&applying_site.py or Student Ranking/app.py):

```python
from flask_cors import CORS
from api_routes import api_bp  # New file we created

# Add CORS support
CORS(app)

# Register API blueprint
app.register_blueprint(api_bp)

# Keep old HTML routes for backward compatibility
# New React will use /api/* endpoints
```

### Step 3: Update React to Use APIs
Replace hardcoded data in React components:

#### Example: Update login.jsx
**Before (hardcoded):**
```jsx
const handleSubmit = (e) => {
  // Hardcoded test credentials
  if (formData.email === "admin@iskomats.com") {
    localStorage.setItem('authToken', 'test-token');
    // ...
  }
}
```

**After (uses API):**
```jsx
import { authAPI } from '../../services/api';

const handleSubmit = async (e) => {
  setFormData({ ...formData, isLoading: true });
  try {
    const response = await authAPI.login(
      formData.email, 
      formData.password, 
      formData.role
    );
    localStorage.setItem('authToken', response.data.token);
    localStorage.setItem('userRole', response.data.userRole);
    localStorage.setItem('userName', response.data.userName);
    navigate(`/dash-${response.data.userRole}`);
  } catch (error) {
    setFormData({ ...formData, error: error.response?.data?.message });
  }
};
```

### Step 4: Run Both Servers

**Terminal 1 - Python Backend:**
```bash
cd iskomats-admins/TESTPYTHON
python app.py  # or appropriate file
# Runs on http://localhost:5000
```

**Terminal 2 - React Frontend:**
```bash
cd iskomats-admins
npm run dev
# Runs on http://localhost:5173
```

### Step 5: Test Connection
Open browser developer console (F12) → Network tab
- When you login, you should see a `/api/auth/login` POST request
- Should get back a token in response

---

## Files Created/Modified

### Created Files:
1. **src/services/api.js** - API client for all backend calls
2. **TESTPYTHON/api_routes.py** - REST API endpoints (blueprint)

### Modified Files:
1. **login.jsx** - Use authAPI instead of hardcoded credentials
2. **register.jsx** - Use authAPI instead of hardcoded data
3. **dash.jsx** - Use adminAPI instead of hardcoded accounts
4. **dash-africa.jsx** - Use scholarshipAPI instead of hardcoded applicants
5. **dash-vilma.jsx** - Use scholarshipAPI instead of hardcoded applicants
6. **dash-tulong.jsx** - Use scholarshipAPI instead of hardcoded applicants

### Python Main App File - Add These Lines:
```python
from flask_cors import CORS
from api_routes import api_bp

CORS(app)  # Enable CORS
app.register_blueprint(api_bp)  # Add API routes
```

---

## Environment Variables

Create `.env` file in TESTPYTHON folder:
```
FLASK_ENV=your_flask_env
FLASK_DEBUG=your_flask_debug_value
SECRET_KEY=your_secret_key_here
DB_NAME=your_database_name
DB_USER=your_database_user
DB_PASSWORD=your_database_password
DB_HOST=your_database_host
DB_PORT=your_database_port
ENCRYPTION_KEY=your_encryption_key_here
```

Create `.env` file in iskomats-admins folder:
```
VITE_API_URL=your_backend_api_url
VITE_SOCKET_URL=your_backend_socket_url
```

---

## Components Status Summary

| Component | Backend | Issue | Status |
|-----------|---------|-------|--------|
| login.jsx | ✅ YES | Uses hardcoded credentials | 🔧 NEEDS API |
| register.jsx | ✅ YES | Hardcoded submission | 🔧 NEEDS API |
| dash.jsx | ✅ YES | Hardcoded account list | 🔧 NEEDS API |
| dash-africa.jsx | ✅ YES | Hardcoded applicants | 🔧 NEEDS API |
| dash-vilma.jsx | ✅ YES | Hardcoded applicants | 🔧 NEEDS API |
| dash-tulong.jsx | ✅ YES | Hardcoded applicants | 🔧 NEEDS API |
| access-denied.jsx | ❌ NO | UI page only | ✅ COMPLETE |
| forget-pass.jsx | ❌ NO | NOT IN PYTHON | ⚠️ MISSING |
| reset-pass.jsx | ❌ NO | NOT IN PYTHON | ⚠️ MISSING |
| verify-email.jsx | ❌ NO | NOT IN PYTHON | ⚠️ MISSING |

---

## What Still Needs to Be Built

### Priority 1 (Critical - API Endpoints)
- [ ] Implement `/api/admin/accounts` endpoint (full CRUD)
- [ ] Implement `/api/applicants/{program}` endpoints
- [ ] Implement `/api/rankings/{program}` endpoints
- [ ] Implement `/api/admin/statistics` endpoint
- [ ] Implement `/api/admin/reports` endpoint

### Priority 2 (Important - Features)
- [ ] Password reset flow (`/api/auth/forgot-password`, `/api/auth/reset-password`)
- [ ] Email verification (`/api/auth/verify-email`)
- [ ] File upload for ID verification (OCR)
- [ ] Document management (Excel/PDF export)

### Priority 3 (Nice to Have)
- [ ] Email notifications
- [ ] Activity logging
- [ ] Two-factor authentication
- [ ] Advanced analytics/reporting

---

## Testing the Connection

### 1. Test Login API
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d {\"email\":\"admin@example.com\",\"password\":\"password123\",\"role\":\"admin\"}
```

### 2. Expected Response
```json
{
  "success": true,
  "token": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "userRole": "admin",
  "userName": "John Doe",
  "userFirstName": "John"
}
```

### 3. Use Token for Protected Routes
```bash
curl http://localhost:5000/api/admin/accounts \
  -H "Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGc..."
```

---

## Troubleshooting

### CORS Error: "Access-Control-Allow-Origin"
- Make sure `CORS(app)` is added to main Flask app
- Check that Flask is running on port 5000
- Check that React is on different port (5173)

### JWT Token Errors
- Ensure SECRET_KEY is set in .env
- Token must be prefixed with "Bearer " in Authorization header
- Token expires after 24 hours by default

### Database Connection Error
- Check PostgreSQL is running
- Verify DB credentials in .env match your database
- Check DB_HOST is correct (usually 'localhost' or '127.0.0.1')

### API Not Found (404)
- Ensure api_routes.py blueprint is registered
- URL should be `/api/endpoint`, not just `/endpoint`
- Restart Flask server after adding new routes

---

## Next Steps

1. Install required Python packages
2. Create `.env` files
3. Start Python backend
4. Test API endpoints with curl
5. Start React frontend
6. Modify login.jsx to use authAPI
7. Test React ↔ Python connection
8. Gradually migrate other components

---

## Resource Files

- Full Analysis: `REACT_PYTHON_INTEGRATION_ANALYSIS.md`
- API Client: `src/services/api.js`
- API Routes: `TESTPYTHON/api_routes.py`

