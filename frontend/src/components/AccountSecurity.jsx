import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, responseError } from '../api';
import { dashboardPath, useAuth } from '../auth-context';
import { AuthLayout, Icon } from './UI';

const AccountSecurity = () => {
  const { user } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (form.newPassword !== form.confirmPassword) {
      setError('The new password and confirmation do not match.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/api/auth/password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setSuccess('Password changed. Other signed-in sessions have been revoked.');
    } catch (requestError) {
      setError(responseError(requestError, 'Unable to change your password.'));
    } finally {
      setSaving(false);
    }
  };

  return <AuthLayout>
    <Link to={dashboardPath(user?.role)} className="auth-switch">← Back to workspace</Link>
    <span className="auth-symbol"><Icon name="shield" size={25} /></span>
    <h2>Account security</h2>
    <p className="auth-description">Change the password for {user?.email}. Other active sessions will be signed out.</p>
    <form onSubmit={submit} className="auth-form">
      <label>Current password<input required type="password" autoComplete="current-password" value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} /></label>
      <label>New password<input required type="password" minLength={12} maxLength={72} autoComplete="new-password" value={form.newPassword} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} /><small className="field-hint">Use at least 12 characters.</small></label>
      <label>Confirm new password<input required type="password" minLength={12} maxLength={72} autoComplete="new-password" value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} /></label>
      {error && <p role="alert" className="alert">{error}</p>}
      {success && <p role="status" className="success-message"><Icon name="check" size={17} />{success}</p>}
      <button type="submit" disabled={saving} className="button-primary">{saving ? 'Updating password…' : 'Change password'}</button>
    </form>
  </AuthLayout>;
};

export default AccountSecurity;
