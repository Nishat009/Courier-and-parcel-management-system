import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, responseError } from '../api';
import { AuthLayout, Icon } from './UI';
import { dashboardPath, useAuth } from '../auth-context';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const { startSession } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await api.post('/api/auth/login', { email, password });
      startSession(res.data.token, res.data.user);
      navigate(dashboardPath(res.data.user.role), { replace: true });
    } catch (error) {
      setError(responseError(error, 'Unable to log in. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <span className="auth-symbol"><Icon name="box" size={25} /></span>
      <h2>Welcome back.</h2>
      <p className="auth-description">Sign in to your account and keep things moving.</p>
      <form onSubmit={handleSubmit} className="auth-form">
        <label>Email address
          <input type="email" autoComplete="email" placeholder="you@example.com" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>Password
          <input type="password" autoComplete="current-password" placeholder="Enter your password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p role="alert" className="alert">{error}</p>}
        <button type="submit" disabled={submitting} className="button-primary">
          <span>{submitting ? 'Signing in...' : 'Sign in'}</span><Icon name="arrow" size={18} />
        </button>
      </form>
      <p className="auth-switch">A fresh start for your deliveries. <Link to="/register">Join ParcelFlow</Link></p>
    </AuthLayout>
  );
};

export default Login;
