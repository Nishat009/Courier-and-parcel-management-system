import { createContext, useContext } from 'react';

export const AuthContext = createContext(null);
export const dashboardPath = (role) => ({ admin: '/admin', customer: '/legacy-access', agent: '/legacy-access', merchant: '/merchant', rider: '/rider', operations: '/operations', accounts: '/accounts' }[role] || '/login');
export const useAuth = () => useContext(AuthContext);
