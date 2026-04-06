import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const PrivateRoute = ({ children }) => {
  const { currentUser, userProfile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="global-loader">
        <div className="loader-spinner"></div>
      </div>
    );
  }

  if (currentUser) {
    // If user has an incomplete profile, force them to complete setup
    // but only if they're not already on the setup page/modal (to avoid infinite loop)
    const isSetupQuery = new URLSearchParams(location.search).get('setup') === 'true';
    const isSetupPath = location.pathname === '/profile-setup' || location.pathname === '/studentinfo';
    const isLoginPage = location.pathname === '/login';
    
    // We are on a setup page if the path matches OR if we are on login with the setup flag
    const isSetupPage = isSetupPath || (isLoginPage && isSetupQuery);
    
    if (userProfile && !userProfile.town_city_municipality && !isSetupPage) {
      return <Navigate to="/login?setup=true" />;
    }
    return children;
  }

  return <Navigate to="/login" />;
};

export default PrivateRoute;