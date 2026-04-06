// src/services/api.js - Create this file to connect React to Python backend

import axios from 'axios';
import { API_BASE_URL } from './config';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('authToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 responses
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const isLoginRequest = error.config?.url?.includes('/auth/login');
    const isLoginPage = window.location.pathname === '/login' || window.location.pathname === '/';

    if (error.response?.status === 401 && !isLoginRequest && !isLoginPage) {
      // Token expired or invalid
      localStorage.removeItem('authToken');
      localStorage.removeItem('isLoggedIn');
      localStorage.removeItem('userRole');
      localStorage.removeItem('userName');
      localStorage.removeItem('userFirstName');
      localStorage.setItem('session_expired', 'true');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// ===== AUTHENTICATION ENDPOINTS =====

export const authAPI = {
  login: (email, password) =>
    api.post('/admin/auth/login', { email, password }),
  
  register: (fullName, email, username, password, role) =>
    api.post('/admin/auth/register', { fullName, email, username, password, role }),
  
  logout: () =>
    api.post('/admin/auth/logout'),
  
  forgotPassword: (email) =>
    api.post('/admin/auth/forgot-password', { email }),
  
  resetPassword: (token, newPassword) =>
    api.post('/admin/auth/reset-password', { token, newPassword }),
  
  verifyEmail: (token) =>
    api.post('/admin/auth/verify-email', { token }),
  
  /**
   * Check if email is available and get account type
   * @param {string} email
   * @returns {Promise} - Response should have format: {data: {exists: boolean, account_type: 'applicant'|'admin'|null}}
   * - account_type 'admin' if user_no exists in users table
   * - account_type 'applicant' if applicant_no exists in applicants table
   * - account_type null if email doesn't exist
   */
  checkEmail: (email) =>
    api.post('/admin/auth/check-email', { email }),
};

// ===== ADMIN ENDPOINTS =====

export const adminAPI = {
  // Accounts
  getAllAccounts: (filters = {}) =>
    api.get('/admin/accounts', { params: filters }),
  
  createAccount: (accountData) =>
    api.post('/admin/accounts', accountData),
  
  updateAccount: (accountId, accountData) =>
    api.put(`/admin/accounts/${accountId}`, accountData),
  
  deleteAccount: (accountId) =>
    api.delete(`/admin/accounts/${accountId}`),
  
  lockAccount: (accountId, locked) =>
    api.put(`/admin/accounts/${accountId}/lock`, { locked }),
  
  // Reports
  generateReport: (reportData) =>
    api.post('/admin/reports', reportData),
  
  // Statistics
  getDashboardStats: () =>
    api.get('/admin/statistics'),
  
  getActivityLogs: (filters = {}) =>
    api.get('/admin/logs', { params: filters }),
};

// ===== SCHOLARSHIP ENDPOINTS =====

export const scholarshipAPI = {
  getByProgram: (program) =>
    api.get(`/admin/scholarships/${program}`),
  
  getApplicants: (program, filters = {}) =>
    api.get(`/admin/applicants/${program}`, { params: filters }),
  
  createApplicant: (program, applicantData) =>
    api.post(`/admin/applicants/${program}`, applicantData),
  
  updateApplicant: (program, applicantId, applicantData) =>
    api.put(`/admin/applicants/${program}/${applicantId}`, applicantData),
  
  deleteApplicant: (program, applicantId) =>
    api.delete(`/admin/applicants/${program}/${applicantId}`),
  
  getRankings: (program) =>
    api.get(`/admin/rankings/${program}`),
  
  submitRanking: (program, rankingData) =>
    api.post(`/admin/rankings/${program}/rank`, rankingData),
  
  getApplicantDetails: (applicantId) =>
    api.get(`/admin/applicants/${applicantId}`),

  createScholarship: (scholarshipData) =>
    api.post('/admin/scholarships', scholarshipData),
  
  updateScholarship: (reqNo, scholarshipData) =>
    api.put(`/admin/scholarships/${reqNo}`, scholarshipData),
  
  deleteScholarship: (reqNo) =>
    api.delete(`/admin/scholarships/${reqNo}`),
  
  getProviders: () =>
    api.get('/admin/providers'),

  // Applicant Status Management
  acceptApplicant: (applicantId) =>
    api.post(`/admin/applicants/${applicantId}/accept`),
  
  declineApplicant: (applicantId) =>
    api.post(`/admin/applicants/${applicantId}/decline`),
  
  cancelApplicant: (applicantId) =>
    api.post(`/admin/applicants/${applicantId}/cancel`),
};

// ===== ANNOUNCEMENT ENDPOINTS =====

export const announcementAPI = {
  getAll: () =>
    api.get('/student/announcements'), // Reuse student endpoint for data fetching
  
  create: (announcementData) =>
    api.post('/admin/announcements', announcementData),
  
  update: (annNo, announcementData) =>
    api.put(`/admin/announcements/${annNo}`, announcementData),
  
  delete: (ann_no) =>
    api.delete(`/admin/announcements/${ann_no}`),
};

export default api;
