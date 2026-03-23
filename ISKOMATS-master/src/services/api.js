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
  const url = `${API_BASE_URL}${endpoint}`;
  
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
    });

    const data = await response.json();

    if (!response.ok) {
      if (response.status === 401) {
        // Clear auth data and redirect to login if unauthorized
        localStorage.removeItem('authToken');
        localStorage.removeItem('currentUser');
        if (typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
          window.location.href = '/login';
        }
      }
      throw new Error(data.message || `API Error: ${response.status}`);
    }

    return data;
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
    const response = await makeRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (response.token) {
      localStorage.setItem('authToken', response.token);
    }
    return response;
  },

  /**
   * Check if email is available
   * @param {string} email
   * @returns {Promise}
   */
  checkEmail: async (email) => {
    return makeRequest('/auth/check-email', {
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
    return makeRequest('/auth/register', {
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
    return makeRequest('/auth/validate', {
      method: 'GET',
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
    return makeRequest('/scholarships/rankings', {
      method: 'POST',
      body: JSON.stringify(profile),
    });
  },

  /**
   * Get all available scholarships
   * @returns {Promise} - Array of scholarships
   */
  getAll: async () => {
    return makeRequest('/scholarships/all', {
      method: 'GET',
    });
  },

  /**
   * Get single scholarship details
   * @param {number} reqNo - Scholarship ID
   * @returns {Promise}
   */
  getById: async (reqNo) => {
    return makeRequest(`/scholarships/${reqNo}`, {
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
    return makeRequest(`/scholarships/search?${params}`, {
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
    return makeRequest('/applicant/profile', {
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
      return makeRequest('/applicant/profile', {
        method: 'PUT',
        body: profileData,
      });
    }

    return makeRequest('/applicant/profile', {
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
    
    return makeRequest('/applicant/upload-id', {
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
    
    return makeRequest('/applicant/upload-face', {
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
    return makeRequest('/applicant/documents', {
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

    const url   = `${API_BASE_URL}/applicant/upload-id-front-back`;
    const token = getAuthToken();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(url, { method: 'POST', headers, body: formData });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || `Upload error: ${response.status}`);
    return data;
  },
  submitExtendedProfile: async (formData) => {
    const url = `${API_BASE_URL}/applicant/extended-profile`;
    const token = getAuthToken();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(url, { method: 'POST', headers, body: formData });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || `Upload error: ${response.status}`);
    return data;
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
   * @returns {Promise}
   */
  submit: async (reqNo, applicationData) => {
    if (applicationData instanceof FormData) {
      // If it's FormData, the req_no might already be in there, 
      // but let's ensure it's set if not
      if (!applicationData.has('req_no')) {
        applicationData.append('req_no', reqNo);
      }
      return makeRequest('/applications/submit', {
        method: 'POST',
        body: applicationData,
      });
    }
    return makeRequest('/applications/submit', {
      method: 'POST',
      body: JSON.stringify({ req_no: reqNo, ...applicationData }),
    });
  },

  /**
   * Get user's applications
   * @returns {Promise} - Array of user's applications
   */
  getUserApplications: async () => {
    return makeRequest('/applications/my-applications', {
      method: 'GET',
    });
  },

  /**
   * Get application details
   * @param {number} applicationId - Application ID
   * @returns {Promise}
   */
  getById: async (applicationId) => {
    return makeRequest(`/applications/${applicationId}`, {
      method: 'GET',
    });
  },

  /**
   * Cancel an application
   * @param {number} applicationId - Application ID
   * @returns {Promise}
   */
  cancel: async (applicationId) => {
    return makeRequest(`/applications/${applicationId}`, {
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
    return makeRequest('/verification/face-match', {
      method: 'POST',
      body: JSON.stringify({ face_image: faceBase64, id_image: idBase64 }),
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

  /**
   * Run OCR on the applicant's stored id_img_front / id_img_back and verify name.
   * Call this AFTER uploadIdFrontBack() has stored the images.
   * @returns {Promise} - {verified, status, front_status, back_status, extracted_text}
   */
  ocrCheck: async () => {
    return makeRequest('/verification/ocr-check', {
      method: 'POST',
      body: JSON.stringify({}),
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
};
