import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AuthContext } from '../auth-context';
import { api, responseError } from '../api';

export default function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current;
    const token = localStorage.getItem('token');
    if (!token) {
      setUser(null);
      setError('');
      setLoading(false);
      return;
    }
    try {
      const response = await api.get('/api/auth/me');
      if (currentRequest !== requestId.current) return;
      setUser(response.data.user);
      setError('');
    } catch (requestError) {
      if (currentRequest !== requestId.current) return;
      if (requestError.response?.status === 401) {
        localStorage.removeItem('token');
        setUser(null);
        setError('');
      } else {
        setError(responseError(requestError, 'Unable to check your session. Please try again.'));
      }
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, []);

  const startSession = useCallback((token, account) => {
    ++requestId.current;
    localStorage.setItem('token', token);
    setUser(account);
    setError('');
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const handleStorage = (event) => {
      if (event.key === 'token' || event.key === null) refresh();
    };
    const expire = () => {
      ++requestId.current;
      localStorage.removeItem('token');
      setUser(null);
      setError('');
      setLoading(false);
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', handleStorage);
    window.addEventListener('auth-refresh', refresh);
    window.addEventListener('auth-expired', expire);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('auth-refresh', refresh);
      window.removeEventListener('auth-expired', expire);
    };
  }, [refresh]);

  const value = useMemo(() => ({ user, loading, error, refresh, startSession }), [user, loading, error, refresh, startSession]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
