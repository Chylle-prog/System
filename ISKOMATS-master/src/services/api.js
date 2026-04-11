/**
 * API Service for ISKOMATS Scholarship System
 * Provides functions to communicate with the Flask backend
 */

import { supabase } from '../supabaseClient';

// API Base URL - change this if backend is on different server
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, '');
let backendWarmupPromise = null;

const sanitizeStorageSegment = (value, fallback = 'anonymous') => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-');

  return normalized || fallback;
};

const resolveVideoUploadExtension = (file) => {
  const mimeType = String(file?.type || '').toLowerCase();
  const fileName = String(file?.name || '').toLowerCase();

  if (mimeType.includes('webm') || fileName.endsWith('.webm')) return '.webm';
  if (mimeType.includes('quicktime') || fileName.endsWith('.mov')) return '.mov';
  if (mimeType.includes('mp4') || fileName.endsWith('.mp4')) return '.mp4';
  if (fileName.includes('.')) return fileName.slice(fileName.lastIndexOf('.'));

  return '.mp4';
};

const shouldDirectUploadVideo = (file) => {
  const ext = resolveVideoUploadExtension(file);
  return ext === '.mp4' || ext === '.webm';
};

const uploadRequirementVideoDirect = async (fieldName, file) => {
  const folderMap = {
    mayorIndigency_video: 'indigency',
    mayorCOE_video: 'coe',
    mayorGrades_video: 'grades',
    schoolIdFront_video: 'school_id',
    schoolIdBack_video: 'school_id',
    id_vid_url: 'id_verification',
    face_video: 'id_verification',
  };

  const applicantNo = sanitizeStorageSegment(localStorage.getItem('applicantNo'), 'unknown-applicant');
  const currentUser = sanitizeStorageSegment(localStorage.getItem('currentUser'), 'unknown-user');
  const folder = folderMap[fieldName] || 'others';
  const ext = resolveVideoUploadExtension(file);
  const contentType = file?.type || (ext === '.webm' ? 'video/webm' : 'video/mp4');
  const objectPath = `videos/${folder}/${applicantNo}-${currentUser}/${fieldName}${ext}`;

  const uploadResult = await supabase.storage
    .from('document_videos')
    .upload(objectPath, file, {
      upsert: true,
      contentType,
      cacheControl: '60',
    });

  if (uploadResult.error) {
    throw uploadResult.error;
  }

  const { data } = supabase.storage.from('document_videos').getPublicUrl(objectPath);
  if (!data?.publicUrl) {
    throw new Error('Direct upload succeeded but no public URL was returned.');
  }

  return {
    success: true,
    publicUrl: data.publicUrl,
    originalSize: file.size,
    convertedSize: file.size,
    transport: 'supabase-direct',
  };
};

const warmBackendConnection = async ({ force = false } = {}) => {
  if (force) {
    backendWarmupPromise = null;
  }

  if (!backendWarmupPromise) {
    backendWarmupPromise = fetch(`${API_ORIGIN}/_health`, {
      method: 'GET',
      cache: 'no-store',
    }).catch(() => undefined);
  }

  return backendWarmupPromise;
};

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

  const executeRequest = async () => {
    return fetch(url, {
      ...options,
      headers,
    }).catch(err => {
      console.error(`Fetch Error [${endpoint}]:`, err);
      if (err.name === 'TypeError' && err.message === 'Failed to fetch') {
        throw new Error(`Network Error: Could not reach the server at ${url}. This might be a timeout or CORS issue.`);
      }
      throw err;
    });
  };

  try {
    await warmBackendConnection();
    let response;

    try {
      response = await executeRequest();
    } catch (error) {
      const isNetworkError = error instanceof Error && error.message.startsWith('Network Error:');
      if (!isNetworkError) {
        throw error;
      }

      await warmBackendConnection({ force: true });
      response = await executeRequest();
    }

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

      // Handle 403 — account suspended mid-session
      if (response.status === 403) {
        let errBody;
        try { errBody = await response.json(); } catch (_) { errBody = {}; }
        if (errBody.suspended) {
          localStorage.setItem('accountSuspended', 'true');
          localStorage.removeItem('authToken');
          localStorage.removeItem('currentUser');
          localStorage.removeItem('applicantNo');
          if (typeof window !== 'undefined' && window.location.pathname !== '/suspended') {
            window.location.href = '/suspended';
          }
          throw new Error(errBody.message || 'Account has been suspended.');
        }
        throw new Error(errBody.message || errBody.error || `Request failed with status ${response.status}`);
      }

      let errorData;
      try {
        errorData = await response.json();
      } catch (e) {
        throw new Error(`Server Error (${response.status}): ${response.statusText}`);
      }
      throw new Error(errorData.message || errorData.error || `Request failed with status ${response.status}`);
    }
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
      localStorage.removeItem('accountSuspended');
      localStorage.setItem('authToken', response.token);
    }
    return response;
  },

  /**
   * Login user with Google OAuth
   * @param {string} idToken - Google ID token
   * @returns {Promise} - {token, email, first_name, last_name, applicant_no}
   */
  googleLogin: async (idToken) => {
    const response = await makeRequest('/student/auth/google', {
      method: 'POST',
      body: JSON.stringify({ idToken }),
    });
    if (response.token) {
      localStorage.removeItem('accountSuspended');
      localStorage.setItem('authToken', response.token);
    }
    return response;
  },

  /**
   * Check if email is available for applicant registration
   * @param {string} email
   * @returns {Promise} - {exists, available, account_type, message}
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
   * @param {string} email - Optional user email for precise lookup
   * @returns {Promise}
   */
  verifyEmail: async (token, email = null) => {
    return makeRequest('/student/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token, email }),
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
   * Fetch a single large document independently to avoid OOM
   * @param {string} fieldName 
   * @returns {Promise} - { fieldName, data }
   */
  getDocument: async (fieldName) => {
    return makeRequest(`/student/applicant/document/${fieldName}`, {
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
   * @param {string} idFront - Base64 encoded ID front image
   * @param {string} indigencyDoc - Base64 encoded Indigency document
   * @param {string} townCity - User's town/city for address verification
   * @param {string} enrollmentDoc - Base64 encoded Enrollment document
   * @param {string} gradesDoc - Base64 encoded Grades document
   * @param {string} firstName - User's current first name for verification
   * @param {string} lastName - User's current last name for verification
   * @returns {Promise}
   */
  ocrCheck: async (idFront = null, idBack = null, indigencyDoc = null, townCity = null, enrollmentDoc = null, grades_doc = null, firstName = null, lastName = null, middleName = null, schoolName = null, idNumber = null, yearLevel = null, gpa = null, course = null, videoUrl = null, scholarshipNo = null) => {
    const fData = new FormData();
    
    // Add document data (handling both base64 strings and potential Blob/Files)
    if (idFront) fData.append('id_front', idFront);
    if (idBack) fData.append('id_back', idBack);
    if (indigencyDoc) fData.append('indigency_doc', indigencyDoc);
    if (enrollmentDoc) fData.append('enrollment_doc', enrollmentDoc);
    if (grades_doc) fData.append('grades_doc', grades_doc);
    
    // Add metadata
    fData.append('town_city', townCity || '');
    fData.append('firstName', firstName || '');
    fData.append('lastName', lastName || '');
    fData.append('middleName', middleName || '');
    fData.append('schoolName', schoolName || '');
    fData.append('idNumber', idNumber || '');
    fData.append('yearLevel', yearLevel || '');
    fData.append('gpa', gpa || '');
    fData.append('course', course || '');
    if (videoUrl && typeof videoUrl === 'object') {
      fData.append('video_url', videoUrl.front || '');
      fData.append('video_url_back', videoUrl.back || '');
    } else {
      fData.append('video_url', videoUrl || '');
    }
    if (scholarshipNo) fData.append('scholarship_no', scholarshipNo);

    return makeRequest('/student/verification/ocr-check', {
      method: 'POST',
      body: fData,
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
   * Upload requirement video to database/storage (to Supabase)
   * @param {string} fieldName - Field name
   * @param {File} file - Video file
   * @param {function} onProgress - Progress callback (if supported)
   * @returns {Promise} - { publicUrl }
   */
  uploadRequirementVideo: async (fieldName, file, onProgress) => {
    try {
      console.log(`[VIDEO-UPLOAD] Uploading ${fieldName}: ${file.name}`, file.size, 'bytes');

      let response;

      if (shouldDirectUploadVideo(file)) {
        try {
          console.log('[VIDEO-UPLOAD] Using direct Supabase upload for faster transfer...');
          response = await uploadRequirementVideoDirect(fieldName, file);
        } catch (directUploadError) {
          console.warn('[VIDEO-UPLOAD] Direct upload failed, falling back to backend:', directUploadError);
        }
      }

      if (!response) {
        const formData = new FormData();
        formData.append('video', file);
        formData.append('field_name', fieldName);

        console.log('[VIDEO-UPLOAD] Sending to backend for upload fallback...');
        response = await makeRequest('/student/videos/convert-and-upload', {
          method: 'POST',
          body: formData
        });
      }

      if (!response.success) {
        throw new Error(response.message || 'Upload failed');
      }

      console.log('[VIDEO-UPLOAD] Backend returned public URL:', response.publicUrl);
      console.log('[VIDEO-UPLOAD] Original:', response.originalSize, 'bytes → Converted:', response.convertedSize, 'bytes');

      return { publicUrl: response.publicUrl };
    } catch (err) {
      console.error('[VIDEO-UPLOAD] Error:', err);
      throw err;
    }
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
 * ===== NOTIFICATION ENDPOINTS =====
 */
export const notificationAPI = {
  /**
   * Get all user notifications
   * @returns {Promise} - Array of notifications
   */
  getAll: async () => {
    return makeRequest('/student/notifications', {
      method: 'GET',
    });
  },

  /**
   * Mark a single notification as read
   * @param {number} notifId - Notification ID
   * @returns {Promise}
   */
  markAsRead: async (notifId) => {
    return makeRequest(`/student/notifications/read/${notifId}`, {
      method: 'POST',
    });
  },

  /**
   * Mark all notifications as read
   * @returns {Promise}
   */
  markAllAsRead: async () => {
    return makeRequest('/student/notifications/read-all', {
      method: 'POST',
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
