import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authAPI, applicantAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { GoogleLogin } from '@react-oauth/google';


const Login = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isLogin, setIsLogin] = useState(true);
  const [showProfile, setShowProfile] = useState(false);
  const [showRegistrationModal, setShowRegistrationModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showError, setShowError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [showEmailAlreadyRegisteredOverlay, setShowEmailAlreadyRegisteredOverlay] = useState(false);
  const [profilePicture, setProfilePicture] = useState(null);
  const [isLoginLoading, setIsLoginLoading] = useState(false);
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState({ title: '', message: '' });
  const { setCurrentUserState, fetchProfile } = useAuth();
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    // Check for setup param in URL
    if (searchParams.get('setup') === 'true') {
      setShowProfile(true);
    }

    if (localStorage.getItem('authToken') && localStorage.getItem('currentUser')) {
      // If we aren't explicitly in setup mode, check if we should be
      if (!searchParams.get('setup')) {
        applicantAPI.getProfile().then(profile => {
          if (profile && profile.first_name === 'User' && profile.last_name === 'Account') {
            setShowProfile(true);
          } else {
            navigate('/portal');
          }
        }).catch(() => {
          navigate('/portal');
        });
      }
    }

    // Add Font Awesome link
    const fontAwesomeLink = document.createElement('link');
    fontAwesomeLink.rel = 'stylesheet';
    fontAwesomeLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css';
    document.head.appendChild(fontAwesomeLink);

    // Add Google Fonts link
    const googleFontsLink = document.createElement('link');
    googleFontsLink.rel = 'preconnect';
    googleFontsLink.href = 'https://fonts.googleapis.com';
    document.head.appendChild(googleFontsLink);

    const googleFontsDisplay = document.createElement('link');
    googleFontsDisplay.rel = 'preconnect';
    googleFontsDisplay.href = 'https://fonts.gstatic.com';
    googleFontsDisplay.crossOrigin = 'anonymous';
    document.head.appendChild(googleFontsDisplay);

    const googleFontsSheet = document.createElement('link');
    googleFontsSheet.rel = 'stylesheet';
    googleFontsSheet.href = 'https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400;14..32,500;14..32,600;14..32,700;14..32,800&display=swap';
    document.head.appendChild(googleFontsSheet);

    return () => {
      document.head.removeChild(fontAwesomeLink);
      document.head.removeChild(googleFontsLink);
      document.head.removeChild(googleFontsDisplay);
      document.head.removeChild(googleFontsSheet);
    };
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    const email = e.target.email.value;
    const password = e.target.password.value;

    setIsLoginLoading(true);
    setLoadingMessage({ title: 'Logging in', message: 'Authenticating your account...' });
    setShowLoadingOverlay(true);
    try {
      // Call backend login API
      const response = await authAPI.login(email, password);

      setCurrentUser(email); // local state
      if (setCurrentUserState) setCurrentUserState(email); // global AuthContext state

      localStorage.setItem('currentUser', email);
      localStorage.setItem('authToken', response.token);
      localStorage.setItem('applicantNo', response.applicant_no);
      setShowError(false);

      // Navigate based on profile completion
      setTimeout(async () => {
        try {
          const profile = await fetchProfile(email);
          setShowLoadingOverlay(false);
          setIsLoginLoading(false);
          
          if (profile && profile.first_name === 'User' && profile.last_name === 'Account') {
            setShowProfile(true);
          } else {
            navigate('/portal');
          }
        } catch (err) {
          console.warn('Redirect check failed:', err);
          setShowLoadingOverlay(false);
          setIsLoginLoading(false);
          navigate('/portal'); // Fallback
        }
      }, 500);
    } catch (error) {
      // Handle specific error messages from backend
      let errorMsg = error.message || 'Login failed. Please try again.';
      
      // Check if it's an email verification error
      if (errorMsg.includes('not verified') || errorMsg.includes('verify') || errorMsg.includes('verification')) {
        setErrorMessage('Please verify your email first. Redirecting to verification page...');
        localStorage.setItem('registrationEmail', email);
        setShowError(true);
        setIsLoginLoading(false);
        setShowLoadingOverlay(false);
        setTimeout(() => {
          navigate('/verify-email');
        }, 2000);
        return;
      }
      
      if (error.message.includes('Email not found')) {
        setErrorMessage('Incorrect email.');
      } else if (error.message.includes('Incorrect password')) {
        setErrorMessage('Incorrect password.');
      } else {
        setErrorMessage(errorMsg);
      }
      setShowError(true);
      setIsLoginLoading(false);
      setShowLoadingOverlay(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    const email = e.target.email.value;
    const password = e.target.password.value;
    const confirmPassword = e.target.confirmPassword.value;

    // Validate password requirements
    if (password.length < 8) {
      setErrorMessage('Password must be at least 8 characters long.');
      setShowError(true);
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      setShowError(true);
      return;
    }

    try {
      setLoadingMessage({ title: 'Checking Email', message: 'Verifying email availability...' });
      setShowLoadingOverlay(true);
      
      // Check if email exists and what account type it is
      try {
        const emailCheckResponse = await authAPI.checkEmail(email);
        
        // If email exists and is an applicant account, reject it
        if (emailCheckResponse.exists && emailCheckResponse.account_type === 'applicant') {
          setShowLoadingOverlay(false);
          setErrorMessage('This email is already registered as an applicant. Please use a different email or sign in.');
          setShowError(true);
          return;
        }
        
        // If email exists as admin account, allow it but warn user
        if (emailCheckResponse.exists && emailCheckResponse.account_type === 'admin') {
          setLoadingMessage({ title: 'Creating Account', message: 'Setting up your account...' });
          // Allow to proceed - admin can register in applicant portal with different role
        }
      } catch (checkErr) {
        // If check fails, proceed with registration anyway
        console.warn('Email check failed, proceeding with registration:', checkErr);
      }
      
      setLoadingMessage({ title: 'Creating Account', message: 'Setting up your account...' });
      
      // Register user with backend directly
      const registerResponse = await authAPI.register({
        first_name: 'User',
        middle_name: '',
        last_name: 'Account',
        email,
        password
      });

      // Store email for next step (email verification)
      localStorage.setItem('registrationEmail', email);
      localStorage.setItem('registrationPassword', password);
      
      setShowLoadingOverlay(false);
      // Redirect to email verification
      navigate('/verify-email');
      e.target.reset();
    } catch (error) {
      setShowLoadingOverlay(false);
      const errorMsg = error.message || 'Registration failed. Please try again.';
      
      // Check if email is already registered
      if (errorMsg.includes('already registered')) {
        setShowEmailAlreadyRegisteredOverlay(true);
      } else {
        setErrorMessage(errorMsg);
        setShowError(true);
      }
    }
  };

  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    const firstName = e.target.firstName?.value || '';
    const middleName = e.target.middleName?.value || '';
    const lastName = e.target.lastName?.value || '';
    const birthdate = e.target.birthdate?.value || '';
    const school = e.target.school?.value || '';
    const mobileNo = e.target.mobileNo?.value || '';
    const streetBrgy = e.target.streetBrgy?.value || '';
    const townCityMunicipality = e.target.townCityMunicipality?.value || '';
    const province = e.target.province?.value || '';
    const zipCode = e.target.zipCode?.value || '';

    // Validate required fields
    if (!firstName || !lastName || !birthdate || !school || !mobileNo || !streetBrgy || !townCityMunicipality || !province || !zipCode) {
      setErrorMessage('Please fill in all required fields');
      setShowError(true);
      return;
    }

    try {
      setLoadingMessage({ title: 'Creating Profile', message: 'Saving your information and setting up your account...' });
      setShowLoadingOverlay(true);
      
      const email = localStorage.getItem('currentUser');

      // Use the exact camelCase keys that match Profile.jsx and the backend field_mapping.
      const profilePayload = {
        firstName,
        middleName,
        lastName,
        dateOfBirth: birthdate,
        schoolName: school,
        mobileNumber: mobileNo,
        streetBarangay: streetBrgy,
        townCity: townCityMunicipality,
        province,
        zipCode,
      };
      
      if (profilePicture) profilePayload.profile_picture = profilePicture;

      await applicantAPI.updateProfile(profilePayload);

      // Refresh global Auth state to ensure PrivateRoute recognizes the profile as complete
      if (email && fetchProfile) {
        await fetchProfile(email);
      }

      // Show success modal
      setShowSuccessModal(true);

      // Redirect to portal after delay
      setTimeout(() => {
        setShowLoadingOverlay(false);
        navigate('/portal');
      }, 2000);
    } catch (error) {
      setErrorMessage(error.message || 'Profile creation failed. Please try again.');
      setShowError(true);
      setShowLoadingOverlay(false);
    }
  };

  const handleProfilePictureUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      setProfilePicture(ev.target.result);
    };
    reader.readAsDataURL(file);
  };

  const closeRegistrationModal = () => {
    setShowRegistrationModal(false);
    navigate('/verify-email');
  };

  const toggleAuthForm = () => {
    setIsLogin(!isLogin);
    setShowError(false);
  };

  const handleGoogleSuccess = async (credentialResponse) => {
    const { credential } = credentialResponse;
    if (!credential) return;

    setIsLoginLoading(true);
    setLoadingMessage({ title: 'Google Login', message: 'Authenticating with Google...' });
    setShowLoadingOverlay(true);

    try {
      // 1. Call backend Google login API
      const response = await authAPI.googleLogin(credential);

      const email = response.email;
      setCurrentUser(email);
      if (setCurrentUserState) setCurrentUserState(email);

      localStorage.setItem('currentUser', email);
      localStorage.setItem('authToken', response.token);
      localStorage.setItem('applicantNo', response.applicant_no);
      setShowError(false);

      // 2. Navigate based on profile status
      setTimeout(async () => {
        try {
          const profile = await fetchProfile(email);
          setShowLoadingOverlay(false);
          setIsLoginLoading(false);
          
          if (profile && profile.first_name === 'User' && profile.last_name === 'Account') {
            setShowProfile(true);
          } else {
            navigate('/portal');
          }
        } catch (err) {
          console.warn('Redirect check failed:', err);
          setShowLoadingOverlay(false);
          setIsLoginLoading(false);
          navigate('/portal');
        }
      }, 500);
    } catch (error) {
      console.error('Google Login Error:', error);
      setErrorMessage(error.message || 'Google authentication failed.');
      setShowError(true);
      setShowLoadingOverlay(false);
      setIsLoginLoading(false);
    }
  };

  const handleGoogleError = () => {
    setErrorMessage('Google Sign-In was unsuccessful. Please try again.');
    setShowError(true);
  };

  const handleForgotPassword = (e) => {
    e.preventDefault();
    navigate('/forgot-password');
  };

  return (
    <>
      <style>{`
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          background: linear-gradient(145deg, #f3f7fc 0%, #fefaf8 100%);
          color: #121826;
          line-height: 1.5;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
        }

        :root {
          --primary: #4F0D00;
          --primary-light: #7b2f1a;
          --primary-gradient: linear-gradient(135deg, #4F0D00, #9b3e22);
          --accent-soft: #fff1ec;
          --gray-1: #f8fafd;
          --gray-2: #e9eef3;
          --gray-3: #b8c4d4;
          --text-dark: #121826;
          --text-soft: #2c3b4f;
          --white: #ffffff;
          --shadow-sm: 0 6px 16px rgba(0, 0, 0, 0.02), 0 2px 8px rgba(20, 20, 30, 0.02);
          --shadow-md: 0 16px 32px -12px rgba(79, 13, 0, 0.18), 0 6px 14px rgba(0, 10, 20, 0.02);
          --shadow-lg: 0 30px 50px -20px rgba(79, 13, 0, 0.3);
          --border-light: 1px solid rgba(79, 13, 0, 0.05);
          --transition: all 0.25s ease;
        }

        .navbar {
          background: rgba(79, 13, 0, 0.9);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          padding: 0.9rem 5%;
          display: flex;
          justify-content: space-between;
          align-items: center;
          position: sticky;
          top: 0;
          z-index: 100;
          border-bottom: 1px solid rgba(255, 255, 240, 0.15);
          box-shadow: 0 6px 20px rgba(0, 0, 0, 0.08);
        }

        .navbar-brand {
          font-size: 1.8rem;
          font-weight: 800;
          letter-spacing: -0.02em;
          background: linear-gradient(130deg, #fff, #ffd6cc);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          text-decoration: none;
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .navbar-brand img {
          height: 56px;
          margin-right: 16px;
          vertical-align: middle;
        }

        .navbar-nav {
          display: flex;
          gap: 2.5rem;
          align-items: center;
        }

        .navbar-nav a {
          color: rgba(255, 255, 255, 0.9);
          font-weight: 500;
          font-size: 0.95rem;
          text-decoration: none;
          transition: var(--transition);
          position: relative;
          padding: 0.25rem 0;
        }

        .navbar-nav a::after {
          content: '';
          position: absolute;
          bottom: -2px;
          left: 0;
          width: 0;
          height: 2px;
          background: linear-gradient(90deg, #ffb6a0, #ffe4db);
          transition: width 0.25s ease;
        }

        .navbar-nav a:hover::after {
          width: 100%;
        }

        .navbar-nav a:hover {
          color: white;
        }

        .auth-wrapper {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem 1.5rem;
          min-height: calc(100vh - 80px);
        }

        .auth-card {
          max-width: 480px;
          width: 100%;
          background: rgba(255, 255, 255, 0.75);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-radius: 48px;
          padding: 2.8rem 3rem 3.2rem;
          box-shadow: var(--shadow-lg);
          border: 1px solid rgba(255, 255, 255, 0.7);
          transition: var(--transition);
          animation: cardFloat 0.8s ease-out;
          margin: 0 auto;
        }

        .profile-card {
          max-width: 720px;
          width: 100%;
          background: rgba(255, 255, 255, 0.75);
          backdrop-filter: blur(20px);
          border-radius: 56px;
          padding: 3rem 3.5rem;
          box-shadow: var(--shadow-lg);
          border: 1px solid rgba(255, 255, 255, 0.8);
          animation: cardFloat 0.7s ease-out;
          margin: 0 auto;
        }

        .profile-card h2 {
          font-size: 2.22rem;
          font-weight: 800;
          background: var(--primary-gradient);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          text-align: center;
          margin-bottom: 2.2rem;
        }

        .profile-pic-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1.2rem;
          margin-bottom: 2.5rem;
        }

        .profile-pic-preview {
          width: 140px;
          height: 140px;
          border-radius: 50%;
          background: #fff5f2;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 4px solid #fff;
          box-shadow: 0 10px 25px rgba(79, 13, 0, 0.12);
          overflow: hidden;
          position: relative;
        }

        .profile-pic-preview img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .profile-pic-preview i {
          font-size: 3rem;
          color: #ffccbc;
        }

        .upload-photo-btn {
          background: #fff;
          border: 2px dashed #ffab91;
          padding: 0.6rem 1.4rem;
          border-radius: 30px;
          font-size: 0.9rem;
          font-weight: 600;
          color: var(--primary);
          cursor: pointer;
          transition: var(--transition);
          display: flex;
          align-items: center;
          gap: 0.6rem;
        }

        .upload-photo-btn:hover {
          background: #fff3f0;
          border-color: var(--primary);
          transform: scale(1.05);
        }

        .profile-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1.5rem;
        }

        @media (max-width: 600px) {
          .profile-grid {
            grid-template-columns: 1fr;
          }
        }

        .profile-form-group {
          margin-bottom: 1.2rem;
        }

        .profile-form-group label {
          display: block;
          font-weight: 700;
          font-size: 0.8rem;
          text-transform: uppercase;
          letter-spacing: 0.6px;
          color: var(--primary-light);
          margin-bottom: 0.5rem;
        }

        .profile-input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .profile-input-wrapper i {
          position: absolute;
          left: 1.2rem;
          color: var(--gray-3);
          font-size: 1rem;
        }

        .profile-input-wrapper input {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 2px solid transparent;
          border-radius: 18px;
          font-size: 0.95rem;
          background: var(--gray-1);
          transition: var(--transition);
        }

        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }

        .profile-input-wrapper input:focus + i {
          color: var(--primary);
        }


        @keyframes cardFloat {
          0% {
            opacity: 0;
            transform: translateY(30px);
          }

          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .auth-card:hover {
          box-shadow: 0 40px 60px -20px rgba(79, 13, 0, 0.3);
          background: rgba(255, 255, 255, 0.85);
        }

        .auth-header {
          text-align: center;
          margin-bottom: 2.2rem;
        }

        .auth-header h2 {
          font-weight: 800;
          font-size: 2.3rem;
          letter-spacing: -0.02em;
          background: var(--primary-gradient);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          margin-bottom: 0.5rem;
        }

        .auth-header p {
          color: var(--text-soft);
          font-size: 0.95rem;
          font-weight: 400;
        }

        .form-group {
          margin-bottom: 1.5rem;
        }

        .form-group label {
          display: block;
          font-weight: 600;
          font-size: 0.8rem;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--primary-light);
          margin-bottom: 0.4rem;
        }

        .input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .input-wrapper i {
          position: absolute;
          left: 1.2rem;
          color: var(--gray-3);
          font-size: 1rem;
          transition: var(--transition);
          pointer-events: none;
        }

        .input-wrapper input {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 2px solid transparent;
          border-radius: 30px;
          font-size: 0.95rem;
          background: var(--gray-1);
          transition: var(--transition);
          font-family: 'Inter', sans-serif;
          box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.02);
        }

        .input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08), inset 0 1px 3px #fff;
        }

        .input-wrapper input:focus+i {
          color: var(--primary);
        }

        .submit-btn {
          width: 100%;
          padding: 1rem;
          background: var(--primary-gradient);
          color: white;
          border: none;
          border-radius: 40px;
          font-weight: 700;
          font-size: 1.1rem;
          cursor: pointer;
          transition: var(--transition);
          box-shadow: 0 12px 24px -12px rgba(79, 13, 0, 0.5);
          background-size: 200% auto;
          margin-top: 0.8rem;
        }

        .submit-btn:hover {
          transform: translateY(-3px) scale(1.01);
          box-shadow: 0 20px 30px -12px #4F0D00;
          background-position: right center;
        }

        .submit-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
          box-shadow: 0 12px 24px -12px rgba(79, 13, 0, 0.3);
        }

        .submit-btn:disabled:hover {
          transform: none;
          box-shadow: 0 12px 24px -12px rgba(79, 13, 0, 0.3);
        }

        .toggle-auth {
          text-align: center;
          margin-top: 2rem;
          font-size: 0.95rem;
          color: var(--text-soft);
        }

        .toggle-auth a {
          color: var(--primary);
          font-weight: 700;
          cursor: pointer;
          text-decoration: none;
          border-bottom: 2px solid transparent;
          transition: var(--transition);
          padding-bottom: 1px;
        }

        .toggle-auth a:hover {
          border-bottom-color: var(--primary);
        }


        .modal-overlay {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(20, 30, 40, 0.5);
          backdrop-filter: blur(6px);
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }

        .modal-overlay.active {
          display: flex;
          animation: modalFade 0.3s;
        }

        @keyframes modalFade {
          from {
            opacity: 0;
          }

          to {
            opacity: 1;
          }
        }

        .modal-content {
          background: white;
          padding: 3rem 3.5rem;
          border-radius: 64px;
          max-width: 440px;
          text-align: center;
          box-shadow: var(--shadow-lg);
          transform: scale(0.9);
          animation: modalPop 0.3s forwards;
        }

        @keyframes modalPop {
          to {
            transform: scale(1);
          }
        }

        .modal-content h3 {
          font-size: 2.2rem;
          font-weight: 800;
          color: var(--primary);
          margin-bottom: 1rem;
        }

        .modal-content p {
          color: var(--text-soft);
        }

        .section {
          display: none;
          width: 100%;
        }

        .section.active {
          display: block;
        }

        .error-message {
          background: rgba(239, 68, 68, 0.1);
          border: 1.5px solid rgba(239, 68, 68, 0.3);
          border-radius: 20px;
          padding: 1rem 1.5rem;
          margin-bottom: 1.5rem;
          display: flex;
          align-items: center;
          gap: 0.8rem;
          color: #dc2626;
          font-size: 0.9rem;
          font-weight: 500;
          animation: errorShake 0.5s ease-in-out;
        }

        .error-message i {
          font-size: 1.1rem;
          color: #dc2626;
        }

        @keyframes errorShake {

          0%,
          100% {
            transform: translateX(0);
          }

          25% {
            transform: translateX(-5px);
          }

          75% {
            transform: translateX(5px);
          }
        }

        .social-signup {
          margin-top: 1.5rem;
        }

        .divider {
          display: flex;
          align-items: center;
          margin: 1.5rem 0 1rem 0;
          position: relative;
        }

        .divider::before,
        .divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background: var(--gray-2);
        }

        .divider span {
          padding: 0 1rem;
          color: var(--text-soft);
          font-size: 0.85rem;
          font-weight: 500;
        }

        .google-signup-btn {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0.875rem 1rem;
          background: white;
          border: 1px solid var(--gray-2);
          border-radius: 8px;
          font-size: 0.95rem;
          font-weight: 500;
          color: var(--text-dark);
          cursor: pointer;
          transition: all 0.2s;
          margin-top: 0.5rem;
        }

        .google-signup-btn:hover {
          background: var(--gray-1);
          border-color: var(--gray-3);
          transform: translateY(-1px);
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        .google-signup-btn:active {
          transform: translateY(0);
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
        }

        .forgot-password {
          text-align: center;
          margin-top: 1rem;
        }

        .forgot-password a:hover {
          text-decoration: underline !important;
        }

        .loading-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.75);
          backdrop-filter: blur(10px);
          display: none;
          justify-content: center;
          align-items: center;
          z-index: 9999;
          animation: fadeIn 0.3s ease;
        }

        .loading-overlay.active {
          display: flex;
        }

        .loading-modal {
          background: white;
          padding: 3.5rem;
          border-radius: 40px;
          text-align: center;
          box-shadow: 0 25px 50px rgba(0, 0, 0, 0.4);
          max-width: 450px;
          width: 90%;
          border: 1px solid rgba(255, 255, 255, 0.2);
        }

        .loading-spinner {
          width: 60px;
          height: 60px;
          border: 6px solid #ffe8e3;
          border-top: 6px solid var(--primary);
          border-radius: 50%;
          margin: 0 auto 1.8rem;
          animation: spin 1s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @media (max-width: 768px) {
          .navbar {
            flex-direction: column;
            padding: 1rem 5%;
            gap: 1rem;
          }
          
          .navbar-nav {
            flex-wrap: wrap;
            justify-content: center;
            gap: 1rem;
          }
          
          .auth-wrapper {
            padding: 2rem 5%;
            flex-direction: column;
          }
          
          .auth-card {
            padding: 2rem 1.5rem;
            max-width: 100%;
          }

          .profile-card {
            padding: 2rem 1.5rem;
            max-width: 100%;
          }
          
          .auth-header h2 {
            font-size: 1.8rem;
          }
          
          .auth-header p {
            font-size: 1rem;
          }
          
          .form-group label {
            font-size: 0.9rem;
          }
          
          .form-group input,
          .form-group select {
            padding: 0.8rem 1rem;
            font-size: 0.95rem;
          }
          
          .submit-btn {
            padding: 0.8rem;
            font-size: 0.95rem;
          }
          
          .toggle-btn {
            padding: 0.6rem 1.5rem;
            font-size: 0.9rem;
          }
        }

        @media (max-width: 480px) {
          .auth-wrapper {
            padding: 1rem 3%;
          }
          
          .auth-card {
            padding: 1.5rem;
            border-radius: 20px;
          }

          .profile-card {
            padding: 1.5rem;
            border-radius: 20px;
          }
          
          .auth-header h2 {
            font-size: 1.5rem;
          }
          
          .auth-header p {
            font-size: 0.9rem;
          }
          
          .form-group input,
          .form-group select {
            padding: 0.7rem 0.9rem;
            font-size: 0.9rem;
          }
          
          .submit-btn {
            padding: 0.7rem;
            font-size: 0.9rem;
          }
          
          .toggle-btn {
            padding: 0.5rem 1.2rem;
            font-size: 0.85rem;
          }
          
          .profile-form .form-row {
            flex-direction: column;
            gap: 0;
          }
          
          .photo-upload-area {
            padding: 1.5rem;
          }
          
          .photo-preview {
            width: 120px;
            height: 120px;
          }
        }
      `}</style>

      <nav className="navbar">
        <Link to="/" className="navbar-brand">
          <img src="/iskologo.png" alt="iskoMats" style={{ height: '56px', marginRight: '16px', verticalAlign: 'middle' }} />
          iskoMats
        </Link>
        <div className="navbar-nav">
          <Link to="/">Home</Link>
          <a href="/#about">About Us</a>
          <a href="/#contact">Contact Info</a>
        </div>
      </nav>

      <div className="auth-wrapper">
        {/* Auth section */}
        <section id="auth" className={`section ${!showProfile ? 'active' : ''}`}>
          <div className="auth-card">
            <div className="auth-header">
              <h2>{isLogin ? 'Welcome, Iskolar!' : 'Join iskoMats'}</h2>
              <p>{isLogin ? 'Sign in to continue your scholarship journey' : 'Create your account to get started'}</p>
            </div>

            {/* Login Error Message */}
            {showError && (
              <div className="error-message">
                <i className="fas fa-exclamation-triangle"></i>
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Login form */}
            {isLogin ? (
              <form onSubmit={handleLogin}>
                <div className="form-group">
                  <label>Email</label>
                  <div className="input-wrapper">
                    <i className="far fa-envelope"></i>
                    <input type="email" name="email" placeholder="name@university.edu.ph" required defaultValue={localStorage.getItem('currentUser') || ''} />
                  </div>
                </div>
                <div className="form-group">
                  <label>Password</label>
                  <div className="input-wrapper">
                    <i className="fas fa-lock"></i>
                    <input type="password" name="password" placeholder="••••••••" required />
                  </div>
                </div>
                <button type="submit" className="submit-btn" disabled={isLoginLoading}>
                  {isLoginLoading ? (
                    <>
                      <i className="fas fa-spinner fa-spin" style={{marginRight: '8px'}}></i>Loading...
                    </>
                  ) : (
                    <>Log in</>
                  )}
                </button>
                {/* Social Login Options */}
                <div className="social-signup">
                  <div className="divider">
                    <span>Or log in with</span>
                  </div>
                  <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'center' }}>
                    <GoogleLogin
                      onSuccess={handleGoogleSuccess}
                      onError={handleGoogleError}
                      theme="outline"
                      size="large"
                      width="100%"
                      shape="pill"
                      text="continue_with"
                    />
                  </div>
                </div>
               <div className="forgot-password">
                  <a href="#" onClick={handleForgotPassword} style={{ color: 'var(--primary)', textDecoration: 'none', fontSize: '0.9rem' }}>
                    Forgot password?
                  </a>
                </div>
              </form>
            ) : (
              <form onSubmit={handleRegister}>
                <div className="form-group">
                  <label>Email</label>
                  <div className="input-wrapper">
                    <i className="far fa-envelope"></i>
                    <input type="email" name="email" placeholder="name@university.edu.ph" required />
                  </div>
                </div>
                <div className="form-group">
                  <label>Password</label>
                  <div className="input-wrapper">
                    <i className="fas fa-lock"></i>
                    <input type="password" name="password" placeholder="Min. 8 characters" required />
                  </div>
                  <small style={{ color: 'var(--text-soft)', fontSize: '0.85rem', marginTop: '0.25rem', display: 'block' }}>
                    Password must be at least 8 characters long
                  </small>
                </div>
                <div className="form-group">
                  <label>Confirm password</label>
                  <div className="input-wrapper">
                    <i className="fas fa-lock"></i>
                    <input type="password" name="confirmPassword" placeholder="••••••••" required />
                  </div>
                </div>
                <button type="submit" className="submit-btn">Create account</button>

                {/* Social Sign-up Options */}
                <div className="social-signup">
                  <div className="divider">
                    <span>Or sign up with</span>
                  </div>
                  <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'center' }}>
                    <GoogleLogin
                      onSuccess={handleGoogleSuccess}
                      onError={handleGoogleError}
                      theme="outline"
                      size="large"
                      width="100%"
                      shape="pill"
                      text="signup_with"
                    />
                  </div>
                </div>
              </form>
            )}

            <div className="toggle-auth">
              <span>
                {isLogin ? "No account? " : "Already have an account? "}
                <a onClick={toggleAuthForm}>
                  {isLogin ? 'Register here' : 'Log in'}
                </a>
              </span>
            </div>
          </div>
        </section>

        {/* Profile section */}
        <section id="profile" className={`section ${showProfile ? 'active' : ''}`}>
          <div className="profile-card">
            <h2>Complete your Profile!</h2>
            
            {showError && (
              <div className="error-message">
                <i className="fas fa-exclamation-triangle"></i>
                <span>{errorMessage}</span>
              </div>
            )}

            <form onSubmit={handleProfileSubmit}>
              <div className="profile-pic-container">
                <div className="profile-pic-preview">
                  {profilePicture ? (
                    <img src={profilePicture} alt="Profile" />
                  ) : (
                    <i className="fas fa-camera"></i>
                  )}
                </div>
                <label className="upload-photo-btn">
                  <i className="fas fa-camera"></i>
                  upload photo
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleProfilePictureUpload}
                    hidden
                  />
                </label>
              </div>

              <div className="profile-grid">
                <div className="profile-form-group">
                  <label>First Name</label>
                  <div className="profile-input-wrapper">
                    <i className="far fa-user"></i>
                    <input type="text" name="firstName" placeholder="Enter First Name" required />
                  </div>
                </div>
                <div className="profile-form-group">
                  <label>Last Name</label>
                  <div className="profile-input-wrapper">
                    <input type="text" name="lastName" placeholder="Enter Last Name" required />
                  </div>
                </div>
              </div>

              <div className="profile-form-group">
                <label>Birthdate</label>
                <div className="profile-input-wrapper">
                  <i className="far fa-calendar-alt"></i>
                  <input type="date" name="birthdate" required />
                </div>
              </div>

              <div className="profile-form-group">
                <label>University / School</label>
                <div className="profile-input-wrapper">
                  <i className="fas fa-university"></i>
                  <select name="school" required style={{ width: '100%', padding: '12px 12px 12px 42px', border: '1px solid #ddd', borderRadius: '8px', background: 'white' }}>
                    <option value="">Select University / School</option>
                    <option value="De La Salle Lipa">De La Salle Lipa</option>
                    <option value="National University Lipa">National University Lipa</option>
                    <option value="Batangas State University">Batangas State University</option>
                    <option value="Kolehiyo ng Lungsod ng Lipa">Kolehiyo ng Lungsod ng Lipa</option>
                    <option value="Philippine State College of Aeronautics">Philippine State College of Aeronautics</option>
                    <option value="Lipa City Colleges">Lipa City Colleges</option>
                    <option value="University of Batangas">University of Batangas</option>
                    <option value="New Era University">New Era University</option>
                    <option value="Batangas College of Arts and Sciences">Batangas College of Arts and Sciences</option>
                    <option value="Royal British College">Royal British College</option>
                    <option value="STI Academic Center">STI Academic Center</option>
                    <option value="AMA Computer College">AMA Computer College</option>
                    <option value="ICT-ED">ICT-ED</option>
                  </select>
                </div>
              </div>

              <div className="profile-form-group">
                <label>Phone Number</label>
                <div className="profile-input-wrapper">
                  <i className="fas fa-phone-alt"></i>
                  <input type="tel" name="mobileNo" placeholder="+63 ..." required />
                </div>
              </div>

              <div className="profile-grid">
                <div className="profile-form-group">
                  <label>Street / Barangay</label>
                  <div className="profile-input-wrapper">
                    <input type="text" name="streetBrgy" placeholder="123 Main St" required />
                  </div>
                </div>
                <div className="profile-form-group">
                  <label>Town / City</label>
                  <div className="profile-input-wrapper">
                    <input type="text" name="townCityMunicipality" placeholder="Manila" required />
                  </div>
                </div>
              </div>

              <div className="profile-grid">
                <div className="profile-form-group">
                  <label>Province</label>
                  <div className="profile-input-wrapper">
                    <input type="text" name="province" placeholder="Metro Manila" required />
                  </div>
                </div>
                <div className="profile-form-group">
                  <label>Zip Code</label>
                  <div className="profile-input-wrapper">
                    <input type="text" name="zipCode" placeholder="1000" required />
                  </div>
                </div>
              </div>

              <button type="submit" className="submit-btn" style={{marginTop: '1.5rem'}}>
                Finish Setup →
              </button>
            </form>
          </div>
        </section>

      </div>

      {/* Registration Success Modal */}
      {showRegistrationModal && (
        <div className={`modal-overlay active`}>
          <div className="modal-content">
            <h3>✅ Registration Submitted!</h3>
            <p>Please complete your profile to finish registration.</p>
            <button className="submit-btn" onClick={closeRegistrationModal}>Continue</button>
          </div>
        </div>
      )}

      {/* Success modal */}
      {showSuccessModal && (
        <div className={`modal-overlay active`}>
          <div className="modal-content">
            <h3>✅ Profile Complete!</h3>
            <p>Redirecting to your portal...</p>
          </div>
        </div>
      )}

      {/* Loading overlay */}
      <div className={`loading-overlay ${showLoadingOverlay ? 'active' : ''}`}>
        <div className="loading-modal">
          <div className="loading-spinner"></div>
          <h3 style={{ color: 'var(--primary)', fontWeight: '800', fontSize: '1.8rem', marginBottom: '0.8rem' }}>
            {loadingMessage.title}
          </h3>
          <p style={{ color: 'var(--text-soft)', fontSize: '1rem' }}>
            {loadingMessage.message}
          </p>
        </div>
      </div>

      {/* Email Already Registered Overlay */}
      <div className={`loading-overlay ${showEmailAlreadyRegisteredOverlay ? 'active' : ''}`}>
        <div className="loading-modal">
          <div style={{ fontSize: '3rem', marginBottom: '1rem', color: 'var(--primary)' }}>⚠️</div>
          <h3 style={{ color: 'var(--primary)', fontWeight: '800', fontSize: '1.8rem', marginBottom: '0.8rem' }}>
            Email Already Registered
          </h3>
          <p style={{ color: 'var(--text-soft)', fontSize: '1rem', marginBottom: '1.5rem' }}>
            This email address is already registered. Please use a different email or try logging in with this email.
          </p>
          <button
            onClick={() => {
              setShowEmailAlreadyRegisteredOverlay(false);
              setIsLogin(true);
            }}
            style={{
              background: 'var(--primary-gradient)',
              color: 'white',
              border: 'none',
              padding: '0.75rem 1.5rem',
              borderRadius: '8px',
              fontSize: '1rem',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.3s ease'
            }}
            onMouseEnter={(e) => e.target.style.transform = 'translateY(-2px)'}
            onMouseLeave={(e) => e.target.style.transform = 'translateY(0)'}
          >
            Go to Login
          </button>
        </div>
      </div>
    </>
  );
};

export default Login;
