const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1']);
const LOCAL_BACKEND_ORIGIN = 'http://localhost:5001';
const PRODUCTION_BACKEND_ORIGIN = 'https://system-kjbv.onrender.com';
const API_PREFIX = '/api';

const stripTrailingSlash = (value) => value.replace(/\/+$/, '');
const ensureLeadingSlash = (value) => (value.startsWith('/') ? value : `/${value}`);

const normalizeApiBaseUrl = (value) => {
  const sanitized = stripTrailingSlash(value);

  if (sanitized.endsWith(API_PREFIX)) {
    return sanitized;
  }

  return `${sanitized}${API_PREFIX}`;
};

const normalizeSocketUrl = (value) => {
  const sanitized = stripTrailingSlash(value);

  if (sanitized.endsWith(API_PREFIX)) {
    return sanitized.slice(0, -API_PREFIX.length);
  }

  return sanitized;
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

const defaultBackendOrigin = isLocalDevelopment()
  ? LOCAL_BACKEND_ORIGIN
  : PRODUCTION_BACKEND_ORIGIN;

const resolveApiBaseUrl = () => {
  if (import.meta.env.VITE_API_URL) {
    return normalizeApiBaseUrl(import.meta.env.VITE_API_URL);
  }

  return normalizeApiBaseUrl(defaultBackendOrigin);
};

const resolveSocketUrl = () => {
  if (import.meta.env.VITE_SOCKET_URL) {
    return normalizeSocketUrl(import.meta.env.VITE_SOCKET_URL);
  }

  return normalizeSocketUrl(defaultBackendOrigin);
};

export const API_BASE_URL = resolveApiBaseUrl();
export const SOCKET_URL = resolveSocketUrl();