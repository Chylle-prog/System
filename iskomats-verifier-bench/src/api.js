import axios from 'axios';

const getBaseUrl = () => {
  return localStorage.getItem('verifier_api_url') || 'http://localhost:5000/api';
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

export default api;
