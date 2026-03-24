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
    api.post('/auth/login', { email, password }),
  
  register: (fullName, email, username, password, role) =>
    api.post('/auth/register', { fullName, email, username, password, role }),
  
  logout: () =>
    api.post('/auth/logout'),
  
  forgotPassword: (email) =>
    api.post('/auth/forgot-password', { email }),
  
  resetPassword: (token, newPassword) =>
    api.post('/auth/reset-password', { token, newPassword }),
  
  verifyEmail: (token) =>
    api.post('/auth/verify-email', { token }),
  
  checkEmail: (email) =>
    api.post('/auth/check-email', { email }),
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
    api.put(`/accounts/${accountId}/lock`, { locked }),
  
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
    api.get(`/scholarships/${program}`),
  
  getApplicants: (program, filters = {}) =>
    api.get(`/applicants/${program}`, { params: filters }),
  
  createApplicant: (program, applicantData) =>
    api.post(`/applicants/${program}`, applicantData),
  
  updateApplicant: (program, applicantId, applicantData) =>
    api.put(`/applicants/${program}/${applicantId}`, applicantData),
  
  deleteApplicant: (program, applicantId) =>
    api.delete(`/applicants/${program}/${applicantId}`),
  
  getRankings: (program) =>
    api.get(`/rankings/${program}`),
  
  submitRanking: (program, rankingData) =>
    api.post(`/rankings/${program}/rank`, rankingData),
  
  getApplicantDetails: (applicantId) =>
    api.get(`/applicants/${applicantId}`),

  createScholarship: (scholarshipData) =>
    api.post('/scholarships', scholarshipData),
  
  updateScholarship: (reqNo, scholarshipData) =>
    api.put(`/scholarships/${reqNo}`, scholarshipData),
  
  deleteScholarship: (reqNo) =>
    api.delete(`/scholarships/${reqNo}`),
};

export default api;
