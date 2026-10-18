import { createContext, useContext } from 'react';

export const AuthContext = createContext(null);
export const dashboardPath = (role) => ({ admin: '/admin', customer: '/customer', agent: '/agent' }[role] || '/login');
export const useAuth = () => useContext(AuthContext);
