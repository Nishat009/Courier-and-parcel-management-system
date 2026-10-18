import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, responseError } from '../api';
import { AuthLayout, Icon } from './UI';
import { useAuth } from '../auth-context';

const Register = () => {
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const { startSession } = useAuth();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const response = await api.post('/api/auth/register', form);
      startSession(response.data.token, response.data.user);
      navigate('/customer', { replace: true });
    } catch (error) {
      setError(responseError(error, 'Unable to create your account. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout register>
      <span className="auth-symbol"><Icon name="plus" size={25} /></span>
      <h2>Make room for simpler.</h2>
      <p className="auth-description">Create your customer account. Your next delivery starts here.</p>
      <form onSubmit={handleSubmit} className="auth-form">
        <label>Full name
          <input required autoComplete="name" placeholder="Your full name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </label>
        <label>Email address
          <input required type="email" autoComplete="email" placeholder="you@example.com" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        </label>
        <label>Password
          <input required type="password" minLength={8} autoComplete="new-password" placeholder="Create a password" aria-describedby="password-hint" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
          <p id="password-hint" className="field-hint">Use at least 8 characters.</p>
        </label>
        {error && <p role="alert" className="alert">{error}</p>}
        <button type="submit" disabled={submitting} className="button-primary">
          <span>{submitting ? 'Creating account...' : 'Create account'}</span><Icon name="arrow" size={18} />
        </button>
      </form>
      <p className="auth-switch">Already part of the journey? <Link to="/login">Sign in</Link></p>
    </AuthLayout>
  );
};

export default Register;
