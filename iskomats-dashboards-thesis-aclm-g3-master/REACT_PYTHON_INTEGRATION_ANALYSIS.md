# React + Vite to Python Backend Integration Analysis

## Backend Overview

### Python Apps Available

1. **Scholarship_ranking&applying_site.py** - Applicant/Scholar Interface
   - Routes: /login, /logout, /register, /rank, /apply, /submit, /cancel_application
   - Functions: User authentication, scholarship ranking, application submission

2. **Student Ranking/app.py** - Admin Interface
   - Routes: /admin/login, /admin/logout, /provider/login, /provider/logout, /admin/scholarships, /admin/rank, /admin/decision
   - Functions: Admin dashboard, scholarship management, ranking display

---

## React Components and Their Connection Status

### ✅ COMPONENTS WITH DIRECT PYTHON BACKEND CONNECTION

#### 1. **Login (login.jsx)**
- **Purpose**: User authentication
- **Python Connection**: 
  - POST to `/login` (Scholarship_ranking&applying_site.py)
  - POST to `/admin/login` (Student Ranking/app.py)
- **Status**: CAN BE CONNECTED
- **Required API**:
  ```
  POST /api/auth/login
  Body: { email, password, role }
  Response: { success, token, userRole, userName }
  ```
- **Current Issue**: Currently has hardcoded test credentials, needs Flask backend integration

#### 2. **Register (register.jsx)**
- **Purpose**: User registration for scholarship applications
- **Python Connection**: 
  - POST to `/register` (Scholarship_ranking&applying_site.py)
- **Status**: CAN BE CONNECTED
- **Required API**:
  ```
  POST /api/auth/register
  Body: { fullName, email, username, password, role }
  Response: { success, message, userId }
  ```

#### 3. **dash-africa.jsx** - Africa Scholarship Dashboard
- **Purpose**: Manage Africa scholarship applicants/rankings
- **Python Connection**: Student Ranking/app.py
- **Status**: CAN BE CONNECTED
- **Required APIs**:
  ```
  GET /api/scholarships/africa - Fetch scholarship data
  GET /api/applicants/africa - Fetch applicants list
  POST /api/applicants/africa - Add new applicant
  PUT /api/applicants/africa/:id - Update applicant
  DELETE /api/applicants/africa/:id - Delete applicant
  GET /api/rankings/africa - Get ranking data
  POST /api/rankings/africa/rank - Rank applicants
  ```
- **Data Points**:
  - Applicants (with personal info, documents)
  - Rankings/Scores
  - Email communication
  - File uploads/documents

#### 4. **dash-vilma.jsx** - Vilma Scholarship Dashboard
- **Purpose**: Manage Vilma scholarship applicants/rankings
- **Python Connection**: Student Ranking/app.py
- **Status**: CAN BE CONNECTED
- **Required APIs**: Same as Africa (but filtered by program)

#### 5. **dash-tulong.jsx** - Tulong Scholarship Dashboard
- **Purpose**: Manage Tulong scholarship applicants/rankings
- **Python Connection**: Student Ranking/app.py
- **Status**: CAN BE CONNECTED
- **Required APIs**: Same as Africa (but filtered by program)

#### 6. **dash.jsx** - Main Admin Dashboard
- **Purpose**: Central admin control, account management, reporting
- **Python Connection**: Student Ranking/app.py
- **Status**: CAN BE CONNECTED
- **Required APIs**:
  ```
  GET /api/admin/accounts - List all accounts
  POST /api/admin/accounts - Create account
  PUT /api/admin/accounts/:id - Update account
  DELETE /api/admin/accounts/:id - Delete account
  GET /api/admin/reports - Generate reports
  POST /api/admin/reports - Create report
  GET /api/admin/statistics - Dashboard statistics
  GET /api/admin/logs - Activity logs
  ```
- **Features Using Backend**:
  - Account management
  - User role management
  - Report generation (Excel/PDF/CSV export)
  - Dashboard statistics

---

### ❌ COMPONENTS WITHOUT PYTHON BACKEND CONNECTION

#### 1. **Access Denied (access-denied.jsx)**
- **Purpose**: Show when user lacks permissions
- **Issue**: This is a UI-only component
- **Why No Connection**: It's a static error page
- **Connection Needed**: NO (purely frontend)

#### 2. **Forget Password (forget-pass.jsx)**
- **Purpose**: Password recovery flow
- **Issue**: NOT IMPLEMENTED in Python backend
- **Why No Connection**: The Python apps don't have password reset functionality
- **Connection Needed**: YES - Create POST `/api/auth/forgot-password` endpoint
- **Required**: Email service integration

#### 3. **Reset Password (reset-pass.jsx)**
- **Purpose**: Actually reset the password
- **Issue**: NOT IMPLEMENTED in Python backend
- **Why No Connection**: The Python apps don't have password reset functionality
- **Connection Needed**: YES - Create POST `/api/auth/reset-password` endpoint

#### 4. **Verify Email (verify-email.jsx)**
- **Purpose**: Email verification during registration
- **Issue**: NOT IMPLEMENTED in Python backend
- **Why No Connection**: The Python apps don't have email verification flow
- **Connection Needed**: YES - Create POST `/api/auth/verify-email` endpoint
- **Required**: Email service integration

---

## Summary Table

| Component | Has Backend? | Status | Issue |
|-----------|-------------|--------|-------|
| login.jsx | ✅ | Needs API creation | Hardcoded credentials |
| register.jsx | ✅ | Needs API creation | Missing backend route |
| dash.jsx | ✅ | Needs API creation | All data hardcoded |
| dash-africa.jsx | ✅ | Needs API creation | All data hardcoded |
| dash-vilma.jsx | ✅ | Needs API creation | All data hardcoded |
| dash-tulong.jsx | ✅ | Needs API creation | All data hardcoded |
| access-denied.jsx | ❌ | Complete | No backend needed |
| forget-pass.jsx | ❌ | Missing | Needs new endpoint |
| reset-pass.jsx | ❌ | Missing | Needs new endpoint |
| verify-email.jsx | ❌ | Missing | Needs new endpoint |

---

## Implementation Steps

### Phase 1: Setup Backend API Server
1. Create Flask API routes (separate from HTML template routes)
2. Add CORS support for React frontend
3. Create `/api/` endpoint structure

### Phase 2: Authentication
1. Create `/api/auth/login`, `/api/auth/register` endpoints
2. Implement JWT token management
3. Add password hashing (bcrypt already in use)

### Phase 3: Dashboard APIs
1. Create `/api/scholarships/` endpoints
2. Create `/api/applicants/` endpoints
3. Create `/api/rankings/` endpoints
4. Create `/api/accounts/` endpoints (for admin)

### Phase 4: Missing Features
1. Add password reset functionality
2. Add email verification
3. Add email notification service

---

## Database Schema Notes
- PostgreSQL is used (psycopg2 in Python code)
- Images are encrypted and stored as binary data
- OCR + DeepFace used for ID verification
- Fuzzy matching for text validation

---

## Key Files to Modify/Create

### Frontend
- `src/services/api.js` - API client (needs creation)
- `src/utils/auth.js` - Auth utility (needs creation)
- All dashboard components - replace hardcoded data with API calls

### Backend
- Create `api_routes.py` - New API endpoints
- Modify `Scholarship_ranking&applying_site.py` - Add to API structure
- Modify `Student Ranking/app.py` - Add to API structure
- Create `.env` file with API configuration

---

## Important Notes

1. **CORS must be enabled** - React (localhost:5173) needs to call Python (localhost:5000)
2. **JWT tokens** - Use for session management instead of cookies
3. **Data validation** - Sanitize all inputs before database operations
4. **Error handling** - Return proper HTTP status codes and error messages
5. **Image handling** - Base64 encode/decode for image transfers via JSON

