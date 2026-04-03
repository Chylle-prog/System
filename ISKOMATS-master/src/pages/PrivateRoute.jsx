import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const PrivateRoute = ({ children }) => {
  const { currentUser, userProfile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <div className="loading-spinner"></div>
      </div>
    );
  }

  if (currentUser) {
    // If user has the placeholder name, force them to complete profile setup
    // but only if they're not already on the setup page (to avoid infinite loop)
    const isSetupPage = location.pathname === '/profile-setup' || location.pathname === '/studentinfo';
    
    if (userProfile && userProfile.first_name === 'User' && userProfile.last_name === 'Account' && !isSetupPage) {
      return <Navigate to="/profile-setup" />;
    }
    return children;
  }

  return <Navigate to="/login" />;
};

export default PrivateRoute;