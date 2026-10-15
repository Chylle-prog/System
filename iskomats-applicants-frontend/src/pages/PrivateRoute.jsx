import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const PrivateRoute = ({ children }) => {
  const { currentUser, userProfile, loading } = useAuth();
  const location = useLocation();

  React.useEffect(() => {
    if (currentUser) {
      let currentSessionId = sessionStorage.getItem('appSessionId');
      if (!currentSessionId) {
        currentSessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        sessionStorage.setItem('appSessionId', currentSessionId);
        sessionStorage.setItem('appSessionUser', currentUser);
      }

      const stateSessionId = window.history.state?.appSessionId;
      const stateSessionUser = window.history.state?.appSessionUser;

      // If this history entry belongs to a previous/different user session, route to portal
      if (
        (stateSessionId && stateSessionId !== currentSessionId) ||
        (stateSessionUser && stateSessionUser.toLowerCase() !== currentUser.toLowerCase())
      ) {
        window.history.replaceState({
          ...window.history.state,
          appSessionId: currentSessionId,
          appSessionUser: currentUser
        }, '');
        window.location.replace('/portal');
        return;
      }

      // Tag the current history entry
      if (!stateSessionId || !stateSessionUser) {
        window.history.replaceState({
          ...window.history.state,
          appSessionId: currentSessionId,
          appSessionUser: currentUser
        }, '');
      }
    }
  }, [location.pathname, location.search, currentUser]);

  if (localStorage.getItem('accountSuspended') === 'true') {
    return <Navigate to="/suspended" replace />;
  }

  const storedToken = localStorage.getItem('authToken');
  const storedUser = localStorage.getItem('currentUser');
  if (!storedToken || !storedUser) {
    return <Navigate to="/login" replace />;
  }

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
      return <Navigate to="/login?setup=true" replace />;
    }
    return children;
  }

  return <Navigate to="/login" replace />;
};

export default PrivateRoute;