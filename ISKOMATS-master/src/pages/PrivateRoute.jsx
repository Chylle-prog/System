import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const PrivateRoute = ({ children }) => {
  const { currentUser, loading } = useAuth();

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <div className="loading-spinner"></div>
    </div>;
  }

  if (currentUser) {
    // If user has the placeholder name, force them to complete profile setup
    if (userProfile && userProfile.first_name === 'User' && userProfile.last_name === 'Account') {
      return <Navigate to="/profile-setup" />;
    }
    return children;
  }

  return <Navigate to="/login" />;
};

export default PrivateRoute;