/**
 * API Routes Quick Reference / Cheat Sheet
 * 
 * Fast lookup guide for all available API endpoints
 * and how to use them in React components
 */

// ===== SETUP =====
// 1. Import the API service in your component:
import api, { 
  authAPI, 
  scholarshipAPI, 
  applicantAPI, 
  applicationAPI,
  verificationAPI 
} from '../services/api';

// 2. Ensure backend is running:
// cd TESTPYTHON && python Scholarship_ranking\&applying_site.py

// 3. Make sure .env has correct API_URL (default: http://localhost:5000/api)

// ===== AUTHENTICATION =====

// Login
api.auth.login(email, password)
  .then(res => {
    // res = {token, applicant_no, name, email}
    localStorage.setItem('authToken', res.token);
  })
  .catch(err => console.error(err));

// Register
api.auth.register({
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  password: 'secure123',
  middleName: 'M' // optional
})
  .then(res => {
    // res = {message, applicant_no, email}
  })
  .catch(err => console.error(err));

// Validate Token
api.auth.validateToken()
  .then(res => {
    // res = {valid: true, applicant_no, name}
  })
  .catch(err => console.error(err));

// Logout
api.auth.logout(); // Clears token from localStorage

// ===== SCHOLARSHIPS =====

// Get All Scholarships
api.scholarships.getAll()
  .then(scholarships => {
    // scholarships = [
    //   {req_no, name, minGpa, maxIncome, location, deadline},
    //   ...
    // ]
  })
  .catch(err => console.error(err));

// Get Single Scholarship
api.scholarships.getById(reqNo)
  .then(scholarship => {
    // scholarship = {req_no, name, minGpa, maxIncome, location, deadline, description, ...}
  })
  .catch(err => console.error(err));

// Get Ranked Scholarships (MOST USEFUL!)
api.scholarships.getRankings({
  gpa: 3.5,
  income: 500000,
  address: "Laguna, Philippines"
})
  .then(rankings => {
    // rankings = [
    //   {req_no, name, minGpa, maxIncome, location, deadline, score},
    //   ...
    // ]
    // Sorted by score (highest first)
  })
  .catch(err => console.error(err));

// Search Scholarships
api.scholarships.search(
  minGpa = 3.0,        // optional
  maxIncome = 1000000, // optional
  location = "Manila"  // optional
)
  .then(results => {
    // Similar to getAll() but filtered
  })
  .catch(err => console.error(err));

// ===== APPLICANT PROFILE =====

// Get Profile (REQUIRES AUTH)
api.applicant.getProfile()
  .then(profile => {
    // profile = {
    //   applicant_no,
    //   firstName, middleName, lastName,
    //   gpa, income, address,
    //   mother: {firstName, lastName},
    //   father: {firstName, lastName}
    // }
  })
  .catch(err => console.error(err));

// Update Profile (REQUIRES AUTH)
api.applicant.updateProfile({
  firstName: 'Jane',
  lastName: 'Smith',
  gpa: 3.8,
  income: 750000,
  address: "Cavite, Philippines"
  // ... other fields
})
  .then(res => {
    // res = {message: "Profile updated successfully"}
  })
  .catch(err => console.error(err));

// Upload ID Image (REQUIRES AUTH)
// Expects File object from input element
const fileInput = document.querySelector('input[type="file"]');
api.applicant.uploadIdImage(fileInput.files[0])
  .then(res => {
    // res = {message: "ID image uploaded successfully"}
  })
  .catch(err => console.error(err));

// Upload Face Image (REQUIRES AUTH)
api.applicant.uploadFaceImage(fileInput.files[0])
  .then(res => {
    // res = {message: "Face image uploaded successfully"}
  })
  .catch(err => console.error(err));

// ===== APPLICATIONS =====

// Submit Application (REQUIRES AUTH)
api.applications.submit(scholarshipId, applicationData = {})
  .then(res => {
    // res = {message, scholarship, applicant_no}
  })
  .catch(err => console.error(err));

// Get User's Applications (REQUIRES AUTH)
api.applications.getUserApplications()
  .then(apps => {
    // apps = [
    //   {req_no, name, deadline, status: "Pending"|"Accepted"|"Rejected"},
    //   ...
    // ]
  })
  .catch(err => console.error(err));

// Get Single Application (REQUIRES AUTH)
api.applications.getById(applicationId)
  .then(app => {
    // Application details
  })
  .catch(err => console.error(err));

// Cancel Application (REQUIRES AUTH)
api.applications.cancel(applicationId)
  .then(res => {
    // res = {message: "Application cancelled successfully"}
  })
  .catch(err => console.error(err));

// ===== VERIFICATION =====

// Verify ID with OCR (REQUIRES AUTH)
api.verification.verifyId(base64ImageData)
  .then(res => {
    // res = {verified: true/false, message, confidence}
  })
  .catch(err => console.error(err));

// Verify Face Against ID (REQUIRES AUTH)
api.verification.verifyFaceAgainstId(faceBase64, idBase64)
  .then(res => {
    // res = {verified: true/false, confidence}
  })
  .catch(err => console.error(err));

// Get Verification Status (REQUIRES AUTH)
api.verification.getStatus()
  .then(status => {
    // Verification status details
  })
  .catch(err => console.error(err));

// ===== REACT PATTERNS =====

// Pattern 1: useEffect with loading state
import { useEffect, useState } from 'react';

export function MyComponent() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await api.scholarships.getAll();
        setData(result);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []); // Empty dependency array = run once on mount

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;
  if (!data) return null;

  return (
    <div>
      {/* Render data */}
    </div>
  );
}

// Pattern 2: Form submission
const handleSubmit = async (e) => {
  e.preventDefault();
  
  try {
    setLoading(true);
    const response = await api.auth.login(email, password);
    localStorage.setItem('authToken', response.token);
    // Redirect to dashboard
    navigate('/portal');
  } catch (error) {
    setError(error.message);
  } finally {
    setLoading(false);
  }
};

// Pattern 3: Protected route check
useEffect(() => {
  const checkAuth = async () => {
    try {
      await api.auth.validateToken();
      setIsAuthenticated(true);
    } catch (error) {
      setIsAuthenticated(false);
      navigate('/login');
    }
  };

  checkAuth();
}, [navigate]);

// ===== ERROR HANDLING =====

// Common error scenarios:

// 401 Unauthorized - User not logged in or token expired
try {
  await api.applicant.getProfile();
} catch (error) {
  if (error.message.includes('401')) {
    localStorage.removeItem('authToken');
    navigate('/login');
  }
}

// 404 Not Found - Resource doesn't exist
try {
  await api.scholarships.getById(999); // Invalid ID
} catch (error) {
  if (error.message.includes('404')) {
    console.log('Scholarship not found');
  }
}

// 409 Conflict - Already applied for this scholarship
try {
  await api.applications.submit(scholarshipId);
} catch (error) {
  if (error.message.includes('409')) {
    console.log('Already applied');
  }
}

// ===== DEBUGGING =====

// Enable detailed logging
const makeRequest = async (endpoint, options = {}) => {
  console.log(`API Request: ${options.method || 'GET'} ${endpoint}`);
  console.log('Headers:', options.headers);
  console.log('Body:', options.body);
  // ... rest of function
};

// Check token in localStorage
console.log(localStorage.getItem('authToken'));

// Test auth status
api.auth.validateToken()
  .then(res => console.log('Auth valid:', res))
  .catch(err => console.error('Auth failed:', err));

// Test API connectivity
fetch('http://localhost:5000/api/scholarships/all')
  .then(res => res.json())
  .then(data => console.log('API working:', data))
  .catch(err => console.error('API error:', err));

// ===== COMMON TASKS =====

// Task: Display scholarship list
async function displayScholarships() {
  try {
    const scholarships = await api.scholarships.getAll();
    const html = scholarships
      .map(s => `<div>${s.name} - GPA: ${s.minGpa}</div>`)
      .join('');
    document.getElementById('list').innerHTML = html;
  } catch (error) {
    console.error(error);
  }
}

// Task: Get personalized recommendations
async function getRecommendations(gpa, income, address) {
  try {
    const rankings = await api.scholarships.getRankings({gpa, income, address});
    return rankings.slice(0, 5); // Top 5
  } catch (error) {
    console.error(error);
    return [];
  }
}

// Task: Create user account and log in
async function registerAndLogin(firstName, lastName, email, password) {
  try {
    // Register
    await api.auth.register({firstName, lastName, email, password});
    
    // Login
    const response = await api.auth.login(email, password);
    localStorage.setItem('authToken', response.token);
    
    return response;
  } catch (error) {
    console.error(error);
  }
}

// Task: Submit application and track it
async function applyAndTrack(scholarshipId) {
  try {
    // Submit application
    await api.applications.submit(scholarshipId, {});
    
    // Get all user applications
    const apps = await api.applications.getUserApplications();
    const myApp = apps.find(a => a.req_no === scholarshipId);
    
    return myApp;
  } catch (error) {
    console.error(error);
  }
}
