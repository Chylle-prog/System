import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authAPI, applicantAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { GoogleLogin } from '@react-oauth/google';
import lipaBg from '../assets/lipa.jpg';



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
  const [showSuspensionModal, setShowSuspensionModal] = useState(false);
  const [profilePicture, setProfilePicture] = useState(null);
  const [isLoginLoading, setIsLoginLoading] = useState(false);
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState({ title: '', message: '' });
  const { setCurrentUserState, fetchProfile } = useAuth();
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    // Check for setup param in URL
    const isSetup = searchParams.get('setup') === 'true';
    if (isSetup) {
      setShowProfile(true);
    }

    // Show suspension notice if redirected from a locked session
    if (searchParams.get('suspended') === '1') {
      setShowSuspensionModal(true);
    }

    if (localStorage.getItem('accountSuspended') === 'true') {
      navigate('/suspended', { replace: true });
      return;
    }

    if (localStorage.getItem('authToken') && localStorage.getItem('currentUser')) {
      // If we're already authenticated, only auto-redirect if we're NOT here for setup
      if (!isSetup) {
        navigate('/portal', { replace: true });
        return;
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
          
          if (profile && !profile.town_city_municipality) {
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
      if (errorMsg.includes('not verified') || errorMsg.includes('verify') || errorMsg.includes('verification') || errorMsg.includes('requires_verification')) {
        setErrorMessage('Email not verified. Please check your email for the verification code.');
        localStorage.setItem('registrationEmail', email);
        setShowError(true);
        setIsLoginLoading(false);
        setShowLoadingOverlay(false);
        setTimeout(() => {
          navigate('/verify-email');
        }, 2000);
        return;
      }
      
      if (error.message.includes('does not exist')) {
        setErrorMessage('Email does not exist. Please register first.');
      } else if (error.message.includes('Incorrect password')) {
        setErrorMessage('Incorrect password.');
      } else if (error.message.includes('Invalid credentials')) {
        setErrorMessage('Invalid email or password.');
      } else if (error.message.toLowerCase().includes('suspended') || error.message.toLowerCase().includes('locked')) {
        localStorage.setItem('accountSuspended', 'true');
        navigate('/suspended', { replace: true });
        setShowError(false);
        setIsLoginLoading(false);
        setShowLoadingOverlay(false);
        return;
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
      
      // Check if email is available for applicant registration
      try {
        const emailCheckResponse = await authAPI.checkEmail(email);
        
        // If email is not available for applicant registration, reject it
        if (emailCheckResponse.available === false) {
          setShowLoadingOverlay(false);
          setErrorMessage('This email is already registered as an applicant. Please use a different email or sign in.');
          setShowError(true);
          return;
        }
        
        // Email is available for applicant registration
        // (whether or not it exists as an admin account)
      } catch (checkErr) {
        // If check fails, proceed with registration anyway
        console.warn('Email check failed, proceeding with registration:', checkErr);
      }
      
      setLoadingMessage({ title: 'Creating Account', message: 'Setting up your account...' });
      
      // Register user with backend directly
      await authAPI.register({
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
    const course = e.target.course?.value || '';
    const mobileNo = e.target.mobileNo?.value || '';
    const streetBrgy = e.target.streetBrgy?.value || '';
    const townCityMunicipality = e.target.townCityMunicipality?.value || '';
    const province = e.target.province?.value || '';
    const zipCode = e.target.zipCode?.value || '';

    // Validate required fields
    if (!firstName || !lastName || !birthdate || !school || !course || !mobileNo || !streetBrgy || !townCityMunicipality || !province || !zipCode) {
      setErrorMessage('Please fill in all required fields');
      setShowError(true);
      return;
    }

    try {
      setLoadingMessage({ title: 'Creating Profile', message: 'Saving your information and setting up your account...' });
      setShowLoadingOverlay(true);
      
      const email = localStorage.getItem('currentUser');

      // Use the exact names expected by the backend field_mapping
      const profilePayload = {
        firstName,
        middleName,
        lastName,
        dateOfBirth: birthdate,
        schoolName: school,
        course,
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
          
          // Clear registration states to ensure they don't pop up after Google login
          setShowRegistrationModal(false);
          setShowEmailAlreadyRegisteredOverlay(false);
          localStorage.removeItem('registrationEmail'); // Fix: Prevents manual verification redirect loop
          
          if (profile && !profile.town_city_municipality) {
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

  React.useEffect(() => {
    document.body.classList.add('login-bg');
    return () => document.body.classList.remove('login-bg');
  }, []);
  return (
    <>
      <style>{`
        body.login-bg {
          background: url(${lipaBg}) center/cover no-repeat fixed !important;
          min-height: 100vh;
        }
        .login-bg-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: linear-gradient(to bottom, rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.8));
          z-index: 0;
          pointer-events: none;
        }
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          background: url(${lipaBg}) center/cover no-repeat fixed;
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
          max-width: 500px;
          width: 95%;
          background: rgba(255, 255, 255, 0.12);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border-radius: 40px;
          padding: 1.5rem 2.5rem 2rem;
          box-shadow: 0 40px 80px rgba(0, 0, 0, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.3);
          transition: var(--transition);
          animation: cardFloat 0.8s ease-out;
          margin: 0 auto;
        }

        .profile-card {
          max-width: 720px;
          width: 100%;
          background: rgba(255, 255, 255, 0.12);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border-radius: 56px;
          padding: 3rem 3.5rem;
          box-shadow: 0 40px 80px rgba(0, 0, 0, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.3);
          animation: cardFloat 0.7s ease-out;
          margin: 0 auto;
        }

        .profile-card h2 {
          font-size: 2.22rem;
          font-weight: 800;
          color: white;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper select:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper select option {
          color: #222;
          background: #fff;
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
          color: rgba(255, 255, 255, 0.8);
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
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 18px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: var(--transition);
        }
        .profile-input-wrapper input::placeholder {
          color: rgba(255,255,255,0.7);
        }
        .profile-input-wrapper input:focus {
          outline: none;
          border-color: var(--primary);
          background: white;
          color: var(--primary);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }
        .profile-input-wrapper input:focus::placeholder {
          color: var(--primary);
        }

        .profile-input-wrapper select {
          width: 100%;
          padding: 1rem 1.2rem 1rem 2.8rem;
          border: 1px solid rgba(255, 255, 255, 0.3);