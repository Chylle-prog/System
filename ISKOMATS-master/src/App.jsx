import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import PrivateRoute from './pages/PrivateRoute';

// Static imports for lightweight pages
import Homepage from './pages/Homepage';
import Login from './pages/Login';
import VerifyEmail from './pages/VerifyEmail';
import ProfileSetup from './pages/ProfileSetup';
import ApplicantForgotPassword from './pages/ApplicantForgotPassword';

// Dynamic imports for heavy pages (route-based code splitting)
const Portal = lazy(() => import('./pages/Portal'));
const FindScholarship = lazy(() => import('./pages/FindScholarship'));
const Profile = lazy(() => import('./pages/Profile'));
const StudentInfo = lazy(() => import('./pages/StudentInfo'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));

// Loading fallback for lazy routes - returns null to show nothing during load
const LoadingFallback = () => null;

function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Homepage />} />
          <Route path="/login" element={<Login />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/profile-setup" element={<ProfileSetup />} />
          <Route path="/forgot-password" element={
            <ApplicantForgotPassword />
          } />
          <Route path="/reset-password/:token" element={
            <Suspense fallback={<LoadingFallback />}>
              <ResetPassword />
            </Suspense>
          } />
          <Route path="/portal" element={
            <PrivateRoute>
              <Suspense fallback={<LoadingFallback />}>
                <Portal />
              </Suspense>
            </PrivateRoute>
          } />
          <Route path="/findscholarship" element={
            <PrivateRoute>
              <Suspense fallback={<LoadingFallback />}>
                <FindScholarship />
              </Suspense>
            </PrivateRoute>
          } />
          <Route path="/profile" element={
            <PrivateRoute>
              <Suspense fallback={<LoadingFallback />}>
                <Profile />
              </Suspense>
            </PrivateRoute>
          } />
          <Route path="/studentinfo" element={
            <PrivateRoute>
              <Suspense fallback={<LoadingFallback />}>
                <StudentInfo />
              </Suspense>
            </PrivateRoute>
          } />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </AuthProvider>
    </Router>
  );
}

export default App;