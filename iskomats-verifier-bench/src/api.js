import axios from 'axios';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1']);
const LOCAL_BACKEND_ORIGIN = 'http://localhost:5001';
const PRODUCTION_BACKEND_ORIGIN = 'https://iskomats-backend.onrender.com';
const API_PREFIX = '/api';
const LEGACY_LOCAL_API_URL = 'http://localhost:5000/api';

const stripTrailingSlash = (value) => String(value || '').replace(/\/+$/, '');

const isLocalOrigin = (value) => {
  if (!value) {
    return false;
  }

  try {
    const { hostname } = new URL(value);
    return LOCAL_HOSTNAMES.has(hostname);
  } catch {
    return false;
  }
};

const normalizeApiBaseUrl = (value) => {
  const sanitized = stripTrailingSlash(value);
  if (!sanitized) {
    return `${PRODUCTION_BACKEND_ORIGIN}${API_PREFIX}`;
  }

  return sanitized.endsWith(API_PREFIX) ? sanitized : `${sanitized}${API_PREFIX}`;
};

const isLocalDevelopment = () => {
  if (import.meta.env.DEV) {
    return true;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  return LOCAL_HOSTNAMES.has(window.location.hostname);
};

const getDefaultBaseUrl = () => {
  const configuredApiUrl = import.meta.env.VITE_API_URL;

  if (configuredApiUrl && (isLocalDevelopment() || !isLocalOrigin(configuredApiUrl))) {
    return normalizeApiBaseUrl(configuredApiUrl);
  }

  const defaultOrigin = isLocalDevelopment() ? LOCAL_BACKEND_ORIGIN : PRODUCTION_BACKEND_ORIGIN;
  return normalizeApiBaseUrl(defaultOrigin);
};

export const getBaseUrl = () => {
  const storedApiUrl = localStorage.getItem('verifier_api_url');
  if (!storedApiUrl) {
    return getDefaultBaseUrl();
  }

  const normalizedStoredApiUrl = normalizeApiBaseUrl(storedApiUrl);
  if (normalizedStoredApiUrl === LEGACY_LOCAL_API_URL) {
    return getDefaultBaseUrl();
  }

  if (!isLocalDevelopment() && isLocalOrigin(normalizedStoredApiUrl)) {
    return getDefaultBaseUrl();
  }

  return normalizedStoredApiUrl;
};

const getAuthToken = () => {
  return localStorage.getItem('verifier_token') || '';
};

const api = axios.create({
  baseURL: getBaseUrl(),
});

api.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  config.baseURL = getBaseUrl(); // Dynamically update base URL
  return config;
});

export const describeRequestError = (error, fallbackPath) => {
  const baseUrl = getBaseUrl();
  const requestPath = error?.config?.url || fallbackPath || '';
  const requestUrl = requestPath.startsWith('http')
    ? requestPath
    : `${baseUrl}${requestPath.startsWith('/') ? requestPath : `/${requestPath}`}`;

  if (error?.response?.data) {
    return error.response.data;
  }

  if (error?.code === 'ERR_NETWORK' || error?.message === 'Network Error') {
    return {
      message: `Network Error: Could not reach ${requestUrl}. Check whether the backend is running, the API URL is correct, and the origin is allowed by CORS.`,
      endpoint: requestUrl,
      code: error?.code || 'ERR_NETWORK',
    };
  }

  return {
    message: error?.message || 'Request failed',
    endpoint: requestUrl,
  };
};

export const ocrCheck = async (params) => {
  const response = await api.post('/student/verification/ocr-check', params);
  return response.data;
};

export const faceMatch = async (faceImage, idImage) => {
  const response = await api.post('/student/verification/face-match', {
    face_image: faceImage,
    id_image: idImage,
  });
  return response.data;
};

export const signatureMatch = async (signatureImage, idBackImage) => {
  const response = await api.post('/student/verification/signature-match', {
    signature_image: signatureImage,
    id_back_image: idBackImage,
  });
  return response.data;
};

export default api;
