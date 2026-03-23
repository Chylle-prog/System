/**
 * INTEGRATION GUIDE - Using API Routes in React Components
 * 
 * This file shows examples of how to use the api.js service
 * in your React components to connect with the Flask backend.
 */

// ===== EXAMPLE 1: Using Scholarship API in FindScholarship.jsx =====

// Import at the top of your component:
import api, { scholarshipAPI } from '../services/api';

// Example: Get scholarship rankings
const handleGetRankings = async (gpa, income, address) => {
  try {
    setShowLoadingOverlay(true);
    const rankings = await scholarshipAPI.getRankings({
      gpa: parseFloat(gpa),
      income: parseFloat(income),
      address: address
    });
    
    setScholarshipMatches(rankings);
    setShowResultsView(true);
    
  } catch (error) {
    console.error('Error getting rankings:', error);
    setSuccessBanner('Error: ' + error.message);
  } finally {
    setShowLoadingOverlay(false);
  }
};

// Example: Get all scholarships
const loadAllScholarships = async () => {
  try {
    const scholarships = await scholarshipAPI.getAll();
    setAllScholarships(scholarships);
  } catch (error) {
    console.error('Error loading scholarships:', error);
  }
};

// ===== EXAMPLE 2: Using Applicant API =====

// Get current user's profile
const loadUserProfile = async () => {
  try {
    const profile = await api.applicant.getProfile();
    setUserProfile(profile);
  } catch (error) {
    console.error('Error loading profile:', error);
  }
};

// Update profile
const handleProfileUpdate = async (updatedData) => {
  try {
    await api.applicant.updateProfile({
      firstName: updatedData.firstName,
      lastName: updatedData.lastName,
      gpa: parseFloat(updatedData.gpa),
      income: parseFloat(updatedData.income),
      address: updatedData.address
    });
    alert('Profile updated successfully');
  } catch (error) {
    alert('Error updating profile: ' + error.message);
  }
};

// Upload ID image
const handleIdImageUpload = async (file) => {
  try {
    await api.applicant.uploadIdImage(file);
    alert('ID image uploaded successfully');
  } catch (error) {
    alert('Error uploading ID: ' + error.message);
  }
};

// ===== EXAMPLE 3: Using Application API =====

// Submit application
const handleSubmitApplication = async (scholarshipId) => {
  try {
    const result = await api.applications.submit(scholarshipId, {
      // any additional data needed
    });
    alert(`Application submitted for: ${result.scholarship}`);
  } catch (error) {
    alert('Error submitting application: ' + error.message);
  }
};

// Get user's applications
const loadUserApplications = async () => {
  try {
    const applications = await api.applications.getUserApplications();
    setUserApplications(applications);
  } catch (error) {
    console.error('Error loading applications:', error);
  }
};

// Cancel application
const handleCancelApplication = async (scholarshipId) => {
  try {
    await api.applications.cancel(scholarshipId);
    alert('Application cancelled');
    loadUserApplications(); // Refresh list
  } catch (error) {
    alert('Error cancelling application: ' + error.message);
  }
};

// ===== EXAMPLE 4: Using Authentication API =====

// In Login.jsx
const handleLogin = async (email, password) => {
  try {
    const response = await api.auth.login(email, password);
    
    // Store user info
    localStorage.setItem('currentUser', response.email);
    localStorage.setItem('applicantNo', response.applicant_no);
    
    // Redirect to dashboard
    navigate('/portal');
  } catch (error) {
    setErrorMessage('Login failed: ' + error.message);
  }
};

// In Register.jsx
const handleRegister = async (formData) => {
  try {
    const response = await api.auth.register({
      firstName: formData.firstName,
      lastName: formData.lastName,
      email: formData.email,
      password: formData.password,
      middleName: formData.middleName || ''
    });
    
    alert('Registration successful! Please log in.');
    navigate('/login');
  } catch (error) {
    setErrorMessage('Registration failed: ' + error.message);
  }
};

// Logout
const handleLogout = () => {
  api.auth.logout();
  localStorage.removeItem('currentUser');
  localStorage.removeItem('applicantNo');
  navigate('/');
};

// Validate token on app load
const checkAuthStatus = async () => {
  try {
    const result = await api.auth.validateToken();
    setIsAuthenticated(result.valid);
  } catch (error) {
    setIsAuthenticated(false);
    localStorage.removeItem('authToken');
  }
};

// ===== USAGE IN useEffect =====

// Example hook for a component
useEffect(() => {
  const initializeComponent = async () => {
    try {
      // Check if user is authenticated
      if (localStorage.getItem('authToken')) {
        // Load user profile
        const profile = await api.applicant.getProfile();
        setUserProfile(profile);
        
        // Load user's applications
        const apps = await api.applications.getUserApplications();
        setUserApplications(apps);
      }
    } catch (error) {
      console.error('Initialization error:', error);
      // Redirect to login if token is invalid
      if (error.message.includes('401')) {
        navigate('/login');
      }
    }
  };
  
  initializeComponent();
}, [navigate]);

// ===== INTEGRATION STEPS =====
/*

1. ENVIRONMENT SETUP:
   - Set API_BASE_URL in api.js or create a .env file with REACT_APP_API_URL
   - Make sure Flask backend is running on http://localhost:5000

2. IMPORT API SERVICE:
   import api from '../services/api';
   // or import specific APIs:
   import { scholarshipAPI, authAPI } from '../services/api';

3. USE IN COMPONENTS:
   - Call API methods in event handlers or useEffect
   - Handle loading states and errors
   - Store results in component state

4. AUTH FLOW:
   - User logs in → token stored in localStorage
   - Token automatically added to all API requests
   - Protected routes check token on load

5. ERROR HANDLING:
   - All API calls are wrapped in try-catch
   - Specific error messages from backend
   - 401 errors should trigger logout

6. CORS:
   - Backend already has CORS enabled
   - Make sure frontend URL is allowed in Flask CORS config

*/

export {
  handleGetRankings,
  loadAllScholarships,
  loadUserProfile,
  handleProfileUpdate,
  handleIdImageUpload,
  handleSubmitApplication,
  loadUserApplications,
  handleCancelApplication,
  handleLogin,
  handleRegister,
  handleLogout,
  checkAuthStatus
};
