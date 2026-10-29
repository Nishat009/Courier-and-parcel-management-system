import axios from 'axios';
import { io } from 'socket.io-client';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export const api = axios.create({ baseURL: API_URL, withCredentials: true });

const pendingIdempotencyKeys = new Map();
const pendingIdempotencyStoragePrefix = 'courier_pending_idempotency:';
const readPendingIdempotencyKey = (scopeKey) => {
  try {
    const key = globalThis.sessionStorage?.getItem(`${pendingIdempotencyStoragePrefix}${scopeKey}`);
    return typeof key === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(key) ? key : null;
  } catch { return null; }
};
const writePendingIdempotencyKey = (scopeKey, key) => {
  try { globalThis.sessionStorage?.setItem(`${pendingIdempotencyStoragePrefix}${scopeKey}`, key); } catch { /* Keep the in-memory retry key when browser storage is unavailable. */ }
};
const removePendingIdempotencyKey = (scopeKey) => {
  pendingIdempotencyKeys.delete(scopeKey);
  try { globalThis.sessionStorage?.removeItem(`${pendingIdempotencyStoragePrefix}${scopeKey}`); } catch { /* Storage can be disabled by browser policy. */ }
};
const clearPendingIdempotencyKeys = () => {
  pendingIdempotencyKeys.clear();
  try {
    const storage = globalThis.sessionStorage;
    if (!storage) return;
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(pendingIdempotencyStoragePrefix)) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch { /* Storage can be disabled by browser policy. */ }
};
const idempotencyScopeKey = async (scope) => {
  const input = String(scope);
  if (globalThis.crypto?.subtle) {
    const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
  return `${(hash >>> 0).toString(16)}-${input.length}`;
};
export const runIdempotent = async (scope, request) => {
  const scopeKey = await idempotencyScopeKey(scope);
  const key = pendingIdempotencyKeys.get(scopeKey) || readPendingIdempotencyKey(scopeKey) || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  pendingIdempotencyKeys.set(scopeKey, key);
  writePendingIdempotencyKey(scopeKey, key);
  const result = await request(key);
  removePendingIdempotencyKey(scopeKey);
  return result;
};

api.interceptors.response.use((response) => response, (error) => {
  if (error.response?.status === 401) window.dispatchEvent(new Event('auth-expired'));
  else if (error.response?.status === 403) window.dispatchEvent(new Event('auth-refresh'));
  return Promise.reject(error);
});

export const connectSocket = () => {
  const socket = io(API_URL, { withCredentials: true });
  socket.on('roleChanged', () => window.dispatchEvent(new Event('auth-refresh')));
  socket.on('disconnect', (reason) => {
    if (reason === 'io server disconnect') window.dispatchEvent(new Event('auth-refresh'));
  });
  return socket;
};

export const responseError = (error, fallback) =>
  error.response?.data?.msg || fallback;

export const logout = async () => {
  try { await api.post('/api/auth/logout'); } finally { clearPendingIdempotencyKeys(); window.location.assign('/login'); }
};
