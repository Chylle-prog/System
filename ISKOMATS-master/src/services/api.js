/**
 * API Service for ISKOMATS Scholarship System
 * Provides functions to communicate with the Flask backend
 */

// API Base URL - change this if backend is on different server
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

// Helper function to get stored auth token
const getAuthToken = () => {
  return localStorage.getItem('authToken');
};

// Helper function to make API requests
const makeRequest = async (endpoint, options = {}) => {
  // Ensure we don't have double slashes
  const baseUrl = API_BASE_URL.endsWith('/') ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = `${baseUrl}${cleanEndpoint}`;
  
  const headers = {
    ...options.headers,
  };

  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  // Add auth token if available
  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    }).catch(err => {
      console.error(`Fetch Error [${endpoint}]:`, err);
      if (err.name === 'TypeError' && err.message === 'Failed to fetch') {
        throw new Error(`Network Error: Could not reach the server at ${url}. This might be a timeout or CORS issue.`);
      }
      throw err;
    });

    if (!response.ok) {
      // Handle 401 Unauthorized specifically
      if (response.status === 401) {
        // Clear auth data and redirect to login if unauthorized
        localStorage.removeItem('authToken');
        localStorage.removeItem('currentUser');
        if (typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
          window.location.href = '/login';
        }
      }

      let errorData;
      try {
        errorData = await response.json();
      } catch (e) {
        // If response is not JSON, or empty, provide a generic error
        throw new Error(`Server Error (${response.status}): ${response.statusText}`);
      }
      throw new Error(errorData.message || errorData.error || `Request failed with status ${response.status}`);
    }

    // Try to parse JSON, but allow for responses with no body (e.g., 204 No Content)
    try {
      return await response.json();
    } catch (e) {
      // If response is not JSON or empty, return a success object
      return { status: 'ok', message: 'Success (No JSON response)' };
    }
  } catch (error) {
    console.error(`API Error [${endpoint}]:`, error);
    throw error;
  }
};

/**
 * ===== AUTHENTICATION ENDPOINTS =====
 */

export const authAPI = {
  /**
   * Login user with email and password
   * @param {string} email - User email
   * @param {string} password - User password
   * @returns {Promise} - {token, user, role}
   */
  login: async (email, password) => {
    const response = await makeRequest('/student/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (response.token) {
      localStorage.setItem('authToken', response.token);
    }
    return response;
  },

  /**
   * Check if email is available and get account type
   * @param {string} email
   * @returns {Promise} - {exists: boolean, account_type: 'applicant'|'admin'|null}
   * - account_type 'applicant' if applicant_no exists in database
   * - account_type 'admin' if user_no exists in admin table
   * - account_type null if email doesn't exist
   */
  checkEmail: async (email) => {
    return makeRequest('/student/auth/check-email', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  /**
   * Register new user
   * @param {object} userData - {firstName, lastName, email, password, middleName}
   * @returns {Promise}
   */
  register: async (userData) => {
    return makeRequest('/student/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
  },

  /**
   * Logout user
   */
  logout: () => {
    localStorage.removeItem('authToken');
  },

  /**
   * Validate token
   */
  validateToken: async () => {
    return makeRequest('/student/auth/validate', {
      method: 'GET',
    });
  },

  /**
   * Request password reset
   * @param {string} email
   */
  forgotPassword: async (email) => {
    return makeRequest('/student/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  /**
   * Reset password with token
   * @param {string} token
   * @param {string} newPassword
   */
  resetPassword: async (token, newPassword) => {
    return makeRequest('/student/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    });
  },

  /**
   * Verify email with verification code or token
   * @param {string} token - Verification code or token
   * @returns {Promise}
   */
  verifyEmail: async (token) => {
    return makeRequest('/student/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  },

  /**
   * Resend verification email
   * @param {string} email - User email
   * @returns {Promise}
   */
  resendVerificationEmail: async (email) => {
    return makeRequest('/student/auth/resend-verification-email', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },
};

/**
 * ===== SCHOLARSHIP ENDPOINTS =====
 */

export const scholarshipAPI = {
  /**
   * Get scholarship rankings based on user profile
   * @param {object} profile - {gpa, income, street_brgy, town_city_municipality, province, zip_code}
   * @returns {Promise} - Array of ranked scholarships
   */
  getRankings: async (profile) => {
    return makeRequest('/student/scholarships/rankings', {
      method: 'POST',
      body: JSON.stringify(profile),
    });
  },

  /**
   * Get all available scholarships
   * @returns {Promise} - Array of scholarships
   */
  getAll: async () => {
    return makeRequest('/student/scholarships/all', {
      method: 'GET',
    });
  },

  /**
   * Get single scholarship details
   * @param {number} reqNo - Scholarship ID
   * @returns {Promise}
   */
  getById: async (reqNo) => {
    return makeRequest(`/student/scholarships/${reqNo}`, {
      method: 'GET',
    });
  },

  /**
   * Get scholarships by criteria
   * @param {number} minGpa - Minimum GPA
   * @param {number} maxIncome - Maximum income
   * @param {string} location - Location filter
   * @returns {Promise}
   */
  search: async (minGpa, maxIncome, location) => {
    const params = new URLSearchParams({
      ...(minGpa !== undefined && { minGpa }),
      ...(maxIncome !== undefined && { maxIncome }),
      ...(location && { location }),
    });
    return makeRequest(`/student/scholarships/search?${params}`, {
      method: 'GET',
    });
  },
};

/**
 * ===== APPLICANT/PROFILE ENDPOINTS =====
 */

export const applicantAPI = {
  /**
   * Get current user's profile
   * @returns {Promise}
   */
  getProfile: async () => {
    return makeRequest('/student/applicant/profile', {
      method: 'GET',
    });
  },

  /**
   * Update applicant profile
   * @param {object} profileData - {gpa, income, firstName, lastName, etc}
   * @returns {Promise}
   */
  updateProfile: async (profileData) => {
    if (profileData instanceof FormData) {
      return makeRequest('/student/applicant/profile', {
        method: 'PUT',
        body: profileData,
      });
    }

    return makeRequest('/student/applicant/profile', {
      method: 'PUT',
      body: JSON.stringify(profileData),
    });
  },

  /**
   * Upload and verify ID image
   * @param {File} idImageFile - Image file for ID verification
   * @returns {Promise}
   */
  uploadIdImage: async (idImageFile) => {
    const formData = new FormData();
    formData.append('id_image', idImageFile);
    
    return makeRequest('/student/applicant/upload-id', {
      method: 'POST',
      body: formData,
      headers: {
        // Don't set Content-Type for FormData - browser will set it with boundary
      },
    });
  },

  /**
   * Upload and verify face/selfie
   * @param {File} faceImageFile - Image file for face verification
   * @returns {Promise}
   */
  uploadFaceImage: async (faceImageFile) => {
    const formData = new FormData();
    formData.append('face_image', faceImageFile);
    
    return makeRequest('/student/applicant/upload-face', {
      method: 'POST',
      body: formData,
      headers: {
        // Don't set Content-Type for FormData
      },
    });
  },

  /**
   * Get applicant's documents/images
   * @returns {Promise}
   */
  getDocuments: async () => {
    return makeRequest('/student/applicant/documents', {
      method: 'GET',
    });
  },

  /**
   * Upload front and back ID images for OCR verification
   * @param {File} frontFile  - Front side of the ID
   * @param {File} backFile   - Back side of the ID
   * @returns {Promise}
   */
  uploadIdFrontBack: async (frontFile, backFile) => {
    const formData = new FormData();
    formData.append('id_front', frontFile);
    formData.append('id_back',  backFile);

    const url   = `${API_BASE_URL}/student/applicant/upload-id-front-back`;
    const token = getAuthToken();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(url, { method: 'POST', headers, body: formData });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || `Upload error: ${response.status}`);
    return data;
  },
  submitExtendedProfile: async (formData) => {
    const url = `${API_BASE_URL}/student/applicant/extended-profile`;
    const token = getAuthToken();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(url, { method: 'POST', headers, body: formData });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || `Upload error: ${response.status}`);
    return data;
  },

  /**
   * Run OCR on the applicant's stored id_img_front / id_img_back and verify name.
   * Call this AFTER uploadIdFrontBack() has stored the images.
   * @returns {Promise} - {verified, status, front_status, back_status, extracted_text}
   */
  ocrCheck: async (idFront = null, indigencyDoc = null, townCity = null, enrollmentDoc = null, gradesDoc = null) => {
    return makeRequest('/student/verification/ocr-check', {
      method: 'POST',
      body: JSON.stringify({
        id_front: idFront,
        indigency_doc: indigencyDoc,
        enrollment_doc: enrollmentDoc,
        grades_doc: gradesDoc,
        town_city: townCity
      }),
    });
  },

  /**
   * Verify face match with ID
   * @param {string} faceBase64 - Base64 encoded face image
   * @param {string} idBase64 - Base64 encoded ID image
   * @returns {Promise}
   */
  verifyFaceAgainstId: async (faceBase64, idBase64) => {
    return makeRequest('/student/verification/face-match', {
      method: 'POST',
      body: JSON.stringify({ face_image: faceBase64, id_image: idBase64 }),
    });
  },

  /**
   * Verify signature match with ID back
   * @param {string} signatureBase64 - Base64 encoded signature image
   * @param {string} idBackBase64 - Base64 encoded ID back image
   * @returns {Promise}
   */
  verifySignatureAgainstIdBack: async (signatureBase64, idBackBase64) => {
    return makeRequest('/student/verification/signature-match', {
      method: 'POST',
      body: JSON.stringify({ signature_image: signatureBase64, id_back_image: idBackBase64 }),
    });
  },
};


/**
 * ===== APPLICATION ENDPOINTS =====
 */

export const applicationAPI = {
  /**
   * Submit application for a scholarship
   * @param {number} reqNo - Scholarship ID
   * @param {object} applicationData - Application details
   * @param {boolean} [skipVerification=false] - Optional flag to skip verification steps
   * @returns {Promise}
   */
  submit: async (reqNo, applicationData, skipVerification = false) => {
    if (applicationData instanceof FormData) {
      if (!applicationData.has('req_no')) {
        applicationData.append('req_no', reqNo);
      }
      if (skipVerification) {
        applicationData.append('skipVerification', 'true');
      }
      return makeRequest('/student/applications/submit', {
        method: 'POST',
        body: applicationData,
      });
    }
    return makeRequest('/student/applications/submit', {
      method: 'POST',
      body: JSON.stringify({ 
        req_no: reqNo, 
        skipVerification: skipVerification,
        ...applicationData 
      }),
    });
  },

  /**
   * Get user's applications
   * @returns {Promise} - Array of user's applications
   */
  getUserApplications: async () => {
    return makeRequest('/student/applications/my-applications', {
      method: 'GET',
    });
  },

  /**
   * Get application details
   * @param {number} applicationId - Application ID
   * @returns {Promise}
   */
  getById: async (applicationId) => {
    return makeRequest(`/student/applications/${applicationId}`, {
      method: 'GET',
    });
  },

  /**
   * Cancel an application
   * @param {number} applicationId - Application ID
   * @returns {Promise}
   */
  cancel: async (applicationId) => {
    return makeRequest(`/student/applications/${applicationId}`, {
      method: 'DELETE',
    });
  },

  /**
   * Update application status (for admin)
   * @param {number} applicationId - Application ID
   * @param {string} status - New status
   * @returns {Promise}
   */
  updateStatus: async (applicationId, status) => {
    return makeRequest(`/applications/${applicationId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
  },
};

/**
 * ===== VERIFICATION ENDPOINTS =====
 */

export const verificationAPI = {
  /**
   * Verify ID using OCR
   * @param {string} base64ImageData - Base64 encoded image
   * @returns {Promise} - {verified, message, confidence}
   */
  verifyId: async (base64ImageData) => {
    return makeRequest('/verification/verify-id', {
      method: 'POST',
      body: JSON.stringify({ image_data: base64ImageData }),
    });
  },

  /**
   * Verify face match with ID
   * @param {string} faceBase64 - Base64 encoded face image
   * @param {string} idBase64 - Base64 encoded ID image
   * @returns {Promise}
   */
  verifyFaceAgainstId: async (faceBase64, idBase64) => {
    return makeRequest('/student/verification/face-match', {
      method: 'POST',
      body: JSON.stringify({ face_image: faceBase64, id_image: idBase64 }),
    });
  },

  /**
   * Verify signature match with ID back
   * @param {string} signatureBase64 - Base64 encoded signature image
   * @param {string} idBackBase64 - Base64 encoded ID back image
   * @returns {Promise}
   */
  verifySignatureAgainstIdBack: async (signatureBase64, idBackBase64) => {
    return makeRequest('/student/verification/signature-match', {
      method: 'POST',
      body: JSON.stringify({ signature_image: signatureBase64, id_back_image: idBackBase64 }),
    });
  },

  /**
   * Get verification status
   * @returns {Promise}
   */
  getStatus: async () => {
    return makeRequest('/verification/status', {
      method: 'GET',
    });
  },
};

/**
 * ===== ANNOUNCEMENT ENDPOINTS =====
 */
export const announcementAPI = {
  /**
   * Get latest announcements
   * @returns {Promise} - Array of announcements
   */
  getAll: async () => {
    return makeRequest('/student/announcements', {
      method: 'GET',
    });
  },
};

/**
 * ===== EXPORT ALL API SERVICES =====
 */
export default {
  auth: authAPI,
  scholarships: scholarshipAPI,
  applicant: applicantAPI,
  applications: applicationAPI,
  verification: verificationAPI,
  announcements: announcementAPI,
};
