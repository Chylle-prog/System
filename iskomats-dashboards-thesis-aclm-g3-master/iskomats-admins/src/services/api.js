// src/services/api.js - Create this file to connect React to Python backend

import axios from 'axios';
import { API_BASE_URL } from './config';
import { clearAdminSession } from '../utils/admin-session';

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

  if (config.data instanceof FormData) {
    delete config.headers['Content-Type'];
  }

  return config;
});

// Handle 401 responses
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const isLoginRequest = error.config?.url?.includes('/auth/login');
    const isLoginPage = window.location.pathname === '/login' || window.location.pathname === '/';
    const errBody = error.response?.data || {};

    if (error.response?.status === 403 && errBody.suspended) {
      localStorage.setItem('accountSuspended', 'true');
      clearAdminSession({ preserveSuspended: true });

      if (window.location.pathname !== '/suspended') {
        window.location.href = '/suspended';
      }
    }

    if (error.response?.status === 401 && !isLoginRequest && !isLoginPage) {
      // Token expired or invalid
      clearAdminSession({ markSessionExpired: true });
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
  
  verifyEmail: (data) => {
    // Accept either object {email, verificationCode} or just token string
    if (typeof data === 'string') {
      return api.post('/admin/auth/verify-email', { token: data });
    }
    return api.post('/admin/auth/verify-email', data);
  },

  me: () =>
    api.get('/admin/auth/me'),
  
  /**
   * Check if email is available for registration
   * @param {string} email
   * @param {string} accountType - 'admin' or 'applicant' (defaults to 'admin')
   * @returns {Promise} - Response: {exists, available, account_type, message}
   */
  checkEmail: (email, accountType = 'admin') =>
    api.post('/admin/auth/check-email', { email, account_type: accountType }),
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
  acceptApplicant: (applicantId, scholarshipNo) =>
    api.post(`/admin/applicants/${applicantId}/accept`, { scholarshipNo }),
  
  declineApplicant: (applicantId, scholarshipNo) =>
    api.post(`/admin/applicants/${applicantId}/decline`, { scholarshipNo }),
  
  cancelApplicant: (applicantId, scholarshipNo) =>
    api.post(`/admin/applicants/${applicantId}/cancel`, { scholarshipNo }),
};

// ===== ANNOUNCEMENT ENDPOINTS =====

export const announcementAPI = {
  getAll: () =>
    api.get('/admin/announcements'),
  
  create: (announcementData) =>
    api.post('/admin/announcements', announcementData),
  
  update: (annNo, announcementData) =>
    api.put(`/admin/announcements/${annNo}`, announcementData),
  
  delete: (ann_no) =>
    api.delete(`/admin/announcements/${ann_no}`),
};

export default api;
