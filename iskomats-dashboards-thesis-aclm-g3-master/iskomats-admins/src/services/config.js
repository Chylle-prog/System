const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1']);
const LOCAL_BACKEND_ORIGIN = 'http://localhost:5001';
const PRODUCTION_BACKEND_ORIGIN = 'https://system-kjbv.onrender.com';

const stripTrailingSlash = (value) => value.replace(/\/+$/, '');

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
    return stripTrailingSlash(import.meta.env.VITE_API_URL);
  }

  return `${defaultBackendOrigin}/api`;
};

const resolveSocketUrl = () => {
  if (import.meta.env.VITE_SOCKET_URL) {
    return stripTrailingSlash(import.meta.env.VITE_SOCKET_URL);
  }

  return defaultBackendOrigin;
};

export const API_BASE_URL = resolveApiBaseUrl();
export const SOCKET_URL = resolveSocketUrl();