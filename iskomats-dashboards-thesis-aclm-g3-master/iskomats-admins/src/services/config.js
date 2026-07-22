const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1']);
const LOCAL_BACKEND_ORIGIN = 'http://localhost:5001';
const PRODUCTION_BACKEND_ORIGIN = 'https://iskomats-backend.onrender.com';
const API_PREFIX = '/api';

const stripTrailingSlash = (value) => value.replace(/\/+$/, '');
const ensureLeadingSlash = (value) => (value.startsWith('/') ? value : `/${value}`);

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

const sanitizeOriginUrl = (rawUrl, fallback = 'https://iskomats-backend.onrender.com') => {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return fallback;
  }
  let str = rawUrl.trim();
  if (!str) return fallback;

  str = str.replace(/\/(api|socket\.io).*$/i, '').replace(/\/+$/, '');
  str = str.replace(/(\/|\b)(https?)+$/i, '').replace(/\/+$/, '');
  str = str.replace(/^(https?:\/\/+|https?:?\/+)/i, '');
  str = str.replace(/(\/|\b)(https?)+$/i, '').replace(/\/+$/, '');

  if (!str) return fallback;

  const isLocal = str.startsWith('localhost') || str.startsWith('127.0.0.1');
  const protocol = isLocal ? 'http://' : 'https://';
  return `${protocol}${str}`;
};

const normalizeApiBaseUrl = (value) => {
  const origin = sanitizeOriginUrl(value, PRODUCTION_BACKEND_ORIGIN);
  return `${origin}${API_PREFIX}`;
};

const normalizeSocketUrl = (value) => {
  return sanitizeOriginUrl(value, PRODUCTION_BACKEND_ORIGIN);
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
  const configuredApiUrl = import.meta.env.VITE_API_URL;

  if (configuredApiUrl && (isLocalDevelopment() || !isLocalOrigin(configuredApiUrl))) {
    return normalizeApiBaseUrl(configuredApiUrl);
  }

  return normalizeApiBaseUrl(defaultBackendOrigin);
};

const resolveSocketUrl = () => {
  const configuredSocketUrl = import.meta.env.VITE_SOCKET_URL;

  if (configuredSocketUrl && (isLocalDevelopment() || !isLocalOrigin(configuredSocketUrl))) {
    return normalizeSocketUrl(configuredSocketUrl);
  }

  return normalizeSocketUrl(defaultBackendOrigin);
};

export const API_BASE_URL = resolveApiBaseUrl();
export const SOCKET_URL = resolveSocketUrl();