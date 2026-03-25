import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import PrivateRoute from './pages/PrivateRoute';
import Homepage from './pages/Homepage';
import Login from './pages/Login';
import Portal from './pages/Portal';
import FindScholarship from './pages/FindScholarship';
import Profile from './pages/Profile';
import StudentInfo from './pages/StudentInfo';

function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Homepage />} />
          <Route path="/login" element={<Login />} />
          <Route path="/portal" element={
            <PrivateRoute>
              <Portal />
            </PrivateRoute>
          } />
          <Route path="/findscholarship" element={
            <PrivateRoute>
              <FindScholarship />
            </PrivateRoute>
          } />
          <Route path="/profile" element={
            <PrivateRoute>
              <Profile />
            </PrivateRoute>
          } />
          <Route path="/studentinfo" element={
            <PrivateRoute>
              <StudentInfo />
            </PrivateRoute>
          } />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </AuthProvider>
    </Router>
  );
}

export default App;