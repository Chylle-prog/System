import { BrowserRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import Dash from './Pages/Dash/dash.jsx'
import ProviderDashboard from './Pages/Dash/provider-dashboard'
import { PROVIDER_DASHBOARD_ROUTE, isProviderDashboardRole } from './Pages/Dash/provider-dashboard-config'
import Navbar from './Components/Navbar/navbar'
import AccessDenied from './Pages/Auth/AccessDenied/access-denied'
import ForgetPass from './Pages/Auth/Forget Pass/forget-pass'
import Login from './Pages/Auth/Login/login'
import Register from './Pages/Auth/Register/register'
import ResetPass from './Pages/Auth/Reset Pass/reset-pass'
import Suspended from './Pages/Auth/Suspended/suspended'
import VerifyEmail from './Pages/Auth/VerifyE/verify-email'
import { authAPI } from './services/api'

// Protected Route Component
const ProtectedRoute = ({ children, requiredRole }) => {
  const userRole = localStorage.getItem('userRole');
  const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';

  if (!isLoggedIn) {
    return <Navigate to="/login" replace />;
  }

  // If requiredRole is specified, check if user has that role
  if (requiredRole === 'provider' && !isProviderDashboardRole(userRole)) {
    return <AccessDenied message="You don't have access to the scholarship provider dashboard." />;
  }

  if (requiredRole && requiredRole !== 'provider' && userRole !== requiredRole) {
    return <AccessDenied message={`You don't have access to the ${requiredRole} scholarship dashboard.`} />;
  }

  // For main dashboard, if user has any specific role, redirect them to their specific dashboard
  if (!requiredRole && isProviderDashboardRole(userRole)) {
    return <Navigate to={PROVIDER_DASHBOARD_ROUTE} replace />;
  }

  return children;
};

function AppContent() {
  const location = useLocation();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userRole, setUserRole] = useState('');
  const isVerifyingSessionRef = useRef(false);
  const lastSessionCheckRef = useRef(0);
  const isSuspended = localStorage.getItem('accountSuspended') === 'true';

  if (isSuspended && location.pathname !== '/suspended') {
    return <Navigate to="/suspended" replace />;
  }

  // Routes that should show navbar
  const dashboardRoutes = ['/dash', PROVIDER_DASHBOARD_ROUTE, '/dash-africa', '/dash-vilma', '/dash-tulong'];
  const showNavbar = dashboardRoutes.includes(location.pathname);

  // Check authentication status on mount and route change
  useEffect(() => {
    const loggedIn = localStorage.getItem('isLoggedIn') === 'true';
    const role = localStorage.getItem('userRole') || '';
    setIsLoggedIn(loggedIn);
    setUserRole(role);
  }, [location.pathname]);

  useEffect(() => {
    if (!isLoggedIn || location.pathname === '/login' || location.pathname === '/suspended') {
      return undefined;
    }

    const verifySession = async ({ force = false } = {}) => {
      if (document.visibilityState === 'hidden') {
        return;
      }

      if (isVerifyingSessionRef.current) {
        return;
      }

      const now = Date.now();
      if (!force && now - lastSessionCheckRef.current < 10000) {
        return;
      }

      isVerifyingSessionRef.current = true;
      try {
        await authAPI.me();
        lastSessionCheckRef.current = Date.now();
      } catch {
        // Interceptors handle suspension and expired session redirects.
      } finally {
        isVerifyingSessionRef.current = false;
      }
    };

    verifySession({ force: true });

    const intervalId = window.setInterval(verifySession, 60000);
    const handleFocus = () => verifySession({ force: true });
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        verifySession({ force: true });
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isLoggedIn, location.pathname]);

  return (
    <>
      {showNavbar && <Navbar />}
      <Routes>
        <Route path='/' element={<Navigate to="/login" replace />} />
        <Route path='/login' element={<Login />} />
        <Route path='/register' element={<Register />} />
        <Route path='/suspended' element={<Suspended />} />
        <Route path='/forget-password' element={<ForgetPass />} />
        <Route path='/reset-password' element={<ResetPass />} />
        <Route path='/reset-password/:token' element={<ResetPass />} />
        <Route path='/verify-email' element={<VerifyEmail />} />
        <Route path='/verify-email/:token' element={<VerifyEmail />} />
        <Route path='/dash' element={
          <ProtectedRoute>
            <Dash />
          </ProtectedRoute>
        } />
        <Route path={PROVIDER_DASHBOARD_ROUTE} element={
          <ProtectedRoute requiredRole="provider">
            <ProviderDashboard />
          </ProtectedRoute>
        } />
        <Route path='/dash-africa' element={
          <ProtectedRoute requiredRole="provider">
            <Navigate to={PROVIDER_DASHBOARD_ROUTE} replace />
          </ProtectedRoute>
        } />
        <Route path='/dash-vilma' element={
          <ProtectedRoute requiredRole="provider">
            <Navigate to={PROVIDER_DASHBOARD_ROUTE} replace />
          </ProtectedRoute>
        } />
        <Route path='/dash-tulong' element={
          <ProtectedRoute requiredRole="provider">
            <Navigate to={PROVIDER_DASHBOARD_ROUTE} replace />
          </ProtectedRoute>
        } />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  )
}

export default App
