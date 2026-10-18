import axios from 'axios';
import { io } from 'socket.io-client';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
export const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

export const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use((response) => response, (error) => {
  const token = localStorage.getItem('token');
  if (token && error.config?.headers?.Authorization === `Bearer ${token}`) {
    if (error.response?.status === 401) window.dispatchEvent(new Event('auth-expired'));
    else if (error.response?.status === 403) window.dispatchEvent(new Event('auth-refresh'));
  }
  return Promise.reject(error);
});

export const connectSocket = () => {
  const socket = io(API_URL, { auth: { token: localStorage.getItem('token') } });
  socket.on('roleChanged', () => window.dispatchEvent(new Event('auth-refresh')));
  socket.on('disconnect', (reason) => {
    if (reason === 'io server disconnect') window.dispatchEvent(new Event('auth-refresh'));
  });
  return socket;
};

export const responseError = (error, fallback) =>
  error.response?.data?.msg || fallback;

export const logout = () => {
  localStorage.removeItem('token');
  window.location.assign('/login');
};
