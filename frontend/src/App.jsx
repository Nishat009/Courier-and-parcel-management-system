import React from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import Login from './components/Login';
import Register from './components/Register';
import CustomerDashboard from './components/CustomDashboard';
import AgentDashboard from './components/AgentDashboard';
import AdminDashboard from './components/AdminDashboard';
import AuthProvider from './components/AuthProvider';
import { dashboardPath, useAuth } from './auth-context';
import { Brand, Icon } from './components/UI';
import { logout } from './api';

const ProtectedRoute = ({ children, role }) => {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to={dashboardPath(user.role)} replace />;
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
      <Routes>
        <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
        <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
        <Route path="/customer" element={<ProtectedRoute role="customer"><CustomerDashboard /></ProtectedRoute>} />
        <Route path="/agent" element={<ProtectedRoute role="agent"><AgentDashboard /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute role="admin"><AdminDashboard /></ProtectedRoute>} />
        <Route path="/" element={<Navigate to={user ? dashboardPath(user.role) : '/login'} replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
  );
};

const App = () => <Router><AuthProvider><AppRoutes /></AuthProvider></Router>;

export default App;
