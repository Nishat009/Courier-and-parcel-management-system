import React, { Suspense } from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import Login from './components/Login';
import AuthProvider from './components/AuthProvider';
import { dashboardPath, useAuth } from './auth-context';
import { Brand, Icon } from './components/UI';
import { logout } from './api';

const AdminDashboard = React.lazy(() => import('./components/AdminDashboard'));
const MerchantApplication = React.lazy(() => import('./components/OperationsPortals').then((module) => ({ default: module.MerchantApplication })));
const MerchantPortal = React.lazy(() => import('./components/OperationsPortals').then((module) => ({ default: module.MerchantPortal })));
const RiderPortal = React.lazy(() => import('./components/OperationsPortals').then((module) => ({ default: module.RiderPortal })));
const OperationsPortal = React.lazy(() => import('./components/OperationsPortals').then((module) => ({ default: module.OperationsPortal })));
const AccountsPortal = React.lazy(() => import('./components/OperationsPortals').then((module) => ({ default: module.AccountsPortal })));
const PublicTracking = React.lazy(() => import('./components/OperationsPortals').then((module) => ({ default: module.PublicTracking })));
const AccountSecurity = React.lazy(() => import('./components/AccountSecurity'));

const LegacyAccountNotice = () => {
  const { user } = useAuth();
  return <main className="session-screen"><Brand /><section className="panel"><span className="auth-symbol"><Icon name="shield" size={25} /></span><h1>Legacy {user?.role} workspace retired</h1><p>Customer and agent workspaces have been retired. Historical parcel records remain in the administrator archive. Riders and operations staff use their branch-scoped workspaces.</p><div className="session-actions"><a className="button-primary" href="/track">Track a parcel</a><button className="button-secondary" onClick={logout}>Sign out</button></div></section></main>;
};

const ProtectedRoute = ({ children, role }) => {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (role && !(Array.isArray(role) ? role.includes(user.role) : user.role === role)) return <Navigate to={dashboardPath(user.role)} replace />;
  return children;
};

const PublicRoute = ({ children }) => {
  const { user } = useAuth();
  return user ? <Navigate to={dashboardPath(user.role)} replace /> : children;
};

const AppRoutes = () => {
  const { user, loading, error, refresh } = useAuth();
  if (loading || (error && !user)) return <main className="session-screen"><Brand /><section className="panel"><span className="auth-symbol"><Icon name="shield" size={25} /></span><h1>{loading ? 'Checking your session…' : 'Unable to connect'}</h1><p role={loading ? 'status' : 'alert'}>{loading ? 'Getting your workspace ready.' : error}</p>{!loading && <div className="session-actions"><button className="button-primary" onClick={refresh}>Try again</button><button className="button-secondary" onClick={logout}>Back to sign in</button></div>}</section></main>;
  return (
      <Suspense fallback={<main className="session-screen" role="status">Loading workspace…</main>}><Routes>
        <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
        <Route path="/merchant-apply" element={<PublicRoute><MerchantApplication /></PublicRoute>} />
        <Route path="/track" element={<PublicTracking />} />
        <Route path="/account/security" element={<ProtectedRoute><AccountSecurity /></ProtectedRoute>} />
        <Route path="/legacy-access" element={<ProtectedRoute role={['customer', 'agent']}><LegacyAccountNotice /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute role="admin"><AdminDashboard /></ProtectedRoute>} />
        <Route path="/merchant" element={<ProtectedRoute role="merchant"><MerchantPortal /></ProtectedRoute>} />
        <Route path="/rider" element={<ProtectedRoute role="rider"><RiderPortal /></ProtectedRoute>} />
        <Route path="/operations" element={<ProtectedRoute role={['operations', 'admin']}><OperationsPortal /></ProtectedRoute>} />
        <Route path="/accounts" element={<ProtectedRoute role={['accounts', 'admin']}><AccountsPortal /></ProtectedRoute>} />
        <Route path="/" element={<Navigate to={user ? dashboardPath(user.role) : '/login'} replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes></Suspense>
  );
};

const App = () => <Router><AuthProvider><AppRoutes /></AuthProvider></Router>;

export default App;
