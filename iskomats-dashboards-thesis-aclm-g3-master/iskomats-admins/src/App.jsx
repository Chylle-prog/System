import { BrowserRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import Dash from './Pages/Dash/dash.jsx'
import DashAfrica from './Pages/Dash/dash-africa'
import DashVilma from './Pages/Dash/dash-vilma'
import DashTulong from './Pages/Dash/dash-tulong'
import Navbar from './Components/Navbar/navbar'
import AccessDenied from './Pages/Auth/AccessDenied/access-denied'
import ForgetPass from './Pages/Auth/Forget Pass/forget-pass'
import Login from './Pages/Auth/Login/login'
import Register from './Pages/Auth/Register/register'
import ResetPass from './Pages/Auth/Reset Pass/reset-pass'
import VerifyEmail from './Pages/Auth/VerifyE/verify-email'

// Protected Route Component
const ProtectedRoute = ({ children, requiredRole }) => {
  const userRole = localStorage.getItem('userRole');
  const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';

  if (!isLoggedIn) {
    return <Navigate to="/login" replace />;
  }

  // If requiredRole is specified, check if user has that role
  if (requiredRole && userRole !== requiredRole) {
    return <AccessDenied message={`You don't have access to the ${requiredRole} scholarship dashboard.`} />;
  }

  // For main dashboard, if user has any specific role, redirect them to their specific dashboard
  if (!requiredRole && userRole && userRole !== '' && userRole !== 'main') {
    switch (userRole) {
      case 'africa':
        return <Navigate to="/dash-africa" replace />;
      case 'vilma':
        return <Navigate to="/dash-vilma" replace />;
      case 'tulong':
        return <Navigate to="/dash-tulong" replace />;
      default:
        // If user has 'main' role or no specific role, allow access to main dashboard
        return children;
    }
  }

  return children;
};

function AppContent() {
  const location = useLocation();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userRole, setUserRole] = useState('');

  // Routes that should show navbar
  const dashboardRoutes = ['/dash', '/dash-africa', '/dash-vilma', '/dash-tulong'];
  const showNavbar = dashboardRoutes.includes(location.pathname);

  // Check authentication status on mount and route change
  useEffect(() => {
    const loggedIn = localStorage.getItem('isLoggedIn') === 'true';
    const role = localStorage.getItem('userRole') || '';
    setIsLoggedIn(loggedIn);
    setUserRole(role);
  }, [location.pathname]);

  return (
    <>
      {showNavbar && <Navbar />}
      <Routes>
        <Route path='/' element={<Navigate to="/login" replace />} />
        <Route path='/login' element={<Login />} />
        <Route path='/register' element={<Register />} />
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
        <Route path='/dash-africa' element={
          <ProtectedRoute requiredRole="africa">
            <DashAfrica />
          </ProtectedRoute>
        } />
        <Route path='/dash-vilma' element={
          <ProtectedRoute requiredRole="vilma">
            <DashVilma />
          </ProtectedRoute>
        } />
        <Route path='/dash-tulong' element={
          <ProtectedRoute requiredRole="tulong">
            <DashTulong />
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
