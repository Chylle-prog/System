import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authAPI, applicantAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { GoogleLogin } from '@react-oauth/google';
import lipaBg from '../assets/lipa.jpg';
import Navbar from './Navbar';



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
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
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

    if (!agreedToTerms) {
      setErrorMessage('You must agree to the Terms of Service to create an account.');
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
          border-radius: clamp(20px, 4vw, 40px);
          padding: clamp(1.25rem, 4vw, 2.5rem);
          box-shadow: 0 40px 80px rgba(0, 0, 0, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.3);
          transition: var(--transition);
          animation: cardFloat 0.8s ease-out;
          margin: 0 auto;
        }

        .profile-card {
          max-width: 760px;
          width: 92%;
          max-height: calc(100vh - 80px);
          overflow-y: auto;
          background: rgba(255, 255, 255, 0.12);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border-radius: 28px;
          padding: 1.5rem 2rem;
          box-shadow: 0 30px 60px rgba(0, 0, 0, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.25);
          animation: cardFloat 0.7s ease-out;
          margin: 0 auto;
        }

        .profile-card::-webkit-scrollbar {
          width: 6px;
        }
        .profile-card::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 10px;
        }
        .profile-card::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.25);
          border-radius: 10px;
        }

        .profile-card h2 {
          font-size: 1.6rem;
          font-weight: 800;
          color: white;
          text-align: center;
          margin-bottom: 1rem;
          text-shadow: 0 2px 10px rgba(0,0,0,0.3);
        }

        .profile-pic-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.6rem;
          margin-bottom: 1rem;
        }

        .profile-pic-preview {
          width: 80px;
          height: 80px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.2);
          display: flex;
          align-items: center;
          justify-content: center;
          border: 3px solid rgba(255, 255, 255, 0.8);
          box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
          overflow: hidden;
          position: relative;
          flex-shrink: 0;
        }

        .profile-pic-preview img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .profile-pic-preview i {
          font-size: 1.8rem;
          color: rgba(255, 255, 255, 0.8);
        }

        .upload-photo-btn {
          background: rgba(255, 255, 255, 0.18);
          border: 1.5px dashed rgba(255, 255, 255, 0.5);
          padding: 0.4rem 1rem;
          border-radius: 30px;
          font-size: 0.82rem;
          font-weight: 600;
          color: white;
          cursor: pointer;
          transition: var(--transition);
          display: flex;
          align-items: center;
          gap: 0.4rem;
          backdrop-filter: blur(8px);
        }

        .upload-photo-btn:hover {
          background: rgba(255, 255, 255, 0.3);
          border-color: white;
          transform: translateY(-1px);
        }

        .profile-grid-3 {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 0.75rem;
        }

        .profile-grid-2 {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 0.75rem;
        }

        @media (max-width: 580px) {
          .profile-grid-3 {
            grid-template-columns: repeat(3, 1fr);
            gap: 0.4rem;
          }
          .profile-grid-2 {
            grid-template-columns: repeat(2, 1fr);
            gap: 0.4rem;
          }
          .profile-card {
            padding: 1.25rem 0.85rem;
            width: 96%;
          }
        }

        .profile-form-group {
          margin-bottom: 0.8rem;
        }

        .profile-form-group label {
          display: block;
          font-weight: 700;
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: rgba(255, 255, 255, 0.9);
          margin-bottom: 0.3rem;
        }

        .profile-input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .profile-input-wrapper i {
          position: absolute;
          left: 0.9rem;
          color: rgba(255, 255, 255, 0.75);
          font-size: 0.9rem;
          pointer-events: none;
          z-index: 2;
        }

        .profile-input-wrapper input, .profile-input-wrapper select {
          width: 100%;
          padding: 0.7rem 0.9rem 0.7rem 2.5rem;
          border: 1px solid rgba(255, 255, 255, 0.25);
          border-radius: 14px;
          font-size: 0.9rem;
          background: rgba(255, 255, 255, 0.15);
          color: white;
          transition: var(--transition);
          appearance: none;
        }

        .profile-input-wrapper select option {
          background: #230b06;
          color: white;
        }

        .profile-input-wrapper input::placeholder {
          color: rgba(255, 255, 255, 0.5);
        }

        .profile-input-wrapper input:focus, .profile-input-wrapper select:focus {
          outline: none;
          border-color: rgba(255, 255, 255, 0.6);
          background: rgba(255, 255, 255, 0.25);
          color: white;
          box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.15);
        }

        .profile-input-wrapper input[readonly], 
        .profile-input-wrapper input.readonly-field {
          background: rgba(0, 0, 0, 0.25) !important;
          border: 1px solid rgba(255, 255, 255, 0.2) !important;
          color: rgba(255, 255, 255, 0.9) !important;
          cursor: not-allowed !important;
          font-weight: 600;
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
          box-shadow: 0 40px 100px rgba(0, 0, 0, 0.6);
          background: rgba(255, 255, 255, 0.15);
        }

        .auth-header {
          text-align: center;
          margin-bottom: 1.2rem;
        }

        .auth-header h2 {
          font-weight: 800;
          font-size: 2rem;
          letter-spacing: -0.02em;
          color: white;
          margin-bottom: 0.5rem;
        }

        .auth-header p {
          color: rgba(255, 255, 255, 0.8);
          font-size: 0.95rem;
          font-weight: 400;
        }

        .form-group {
          margin-bottom: 1.2rem;
        }

        .form-group label {
          display: block;
          font-weight: 600;
          font-size: 0.8rem;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: rgba(255, 255, 255, 0.7);
          margin-bottom: 0.4rem;
        }

        .profile-input-wrapper, .input-wrapper {
          position: relative;
          width: 100%;
          display: flex;
          align-items: center;
        }

        .profile-input-wrapper i, .input-wrapper i {
          position: absolute;
          left: 1.1rem;
          top: 50%;
          transform: translateY(-50%);
          width: 20px;
          height: 20px;
          color: rgba(18, 24, 38, 0.65);
          font-size: 0.95rem;
          line-height: 1;
          transition: var(--transition);
          pointer-events: none;
          z-index: 2;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0;
          padding: 0;
        }

        .input-wrapper input {
          width: 100%;
          box-sizing: border-box;
          padding: 0.85rem 1.2rem 0.85rem 2.75rem;
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 30px;
          font-size: 0.95rem;
          background: rgba(255, 255, 255, 0.4);
          color: var(--text-dark);
          transition: var(--transition);
          font-family: 'Inter', sans-serif;
          font-weight: 500;
        }

        .input-wrapper input::placeholder {
          color: rgba(18, 24, 38, 0.5);
        }

        .input-wrapper input:focus {
          outline: none;
          border-color: white;
          background: rgba(255, 255, 255, 0.6);
          box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.1);
          color: var(--text-dark);
        }

        /* Prevent white-on-white text during Chrome autofill */
        .input-wrapper input:-webkit-autofill,
        .input-wrapper input:-webkit-autofill:hover,
        .input-wrapper input:-webkit-autofill:focus {
          -webkit-text-fill-color: var(--text-dark);
          -webkit-box-shadow: 0 0 0px 1000px rgba(255, 255, 255, 0.5) inset;
          transition: background-color 5000s ease-in-out 0s;
        }

        .input-wrapper input:focus+i {
          color: white;
        }

        .submit-btn {
          width: 100%;
          padding: 0.8rem;
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
          margin-top: 0.5rem;
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
          color: rgba(255, 255, 255, 0.8);
        }

        .toggle-auth a {
          color: white;
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
          background: rgba(220, 38, 38, 0.35);
          border: 1px solid rgba(248, 113, 113, 0.5);
          border-radius: 14px;
          padding: 0.75rem 1rem;
          margin-bottom: 1rem;
          display: flex;
          align-items: center;
          gap: 0.75rem;
          color: #fee2e2;
          font-size: 0.88rem;
          font-weight: 600;
          backdrop-filter: blur(8px);
          animation: errorShake 0.5s ease-in-out;
        }

        .error-message i {
          font-size: 1.1rem;
          color: #fca5a5;
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
          margin-top: 1rem;
        }

        .divider {
          display: flex;
          align-items: center;
          margin: 1rem 0 0.75rem 0;
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
            padding: 0.85rem 3%;
            min-height: calc(100vh - 60px);
          }
          
          .auth-card, .profile-card {
            padding: 1.25rem 1.1rem !important;
            border-radius: 20px !important;
            max-width: 95% !important;
            width: 100% !important;
            box-sizing: border-box !important;
          }

          .auth-header {
            margin-bottom: 0.85rem !important;
          }

          .auth-header h2 {
            font-size: 1.35rem !important;
            margin-bottom: 0.2rem !important;
          }
          
          .auth-header p {
            font-size: 0.82rem !important;
            line-height: 1.35 !important;
          }

          .form-group {
            margin-bottom: 0.85rem !important;
          }

          .form-group label {
            font-size: 0.72rem !important;
            margin-bottom: 0.25rem !important;
          }
          
          .profile-input-wrapper i, .input-wrapper i {
            left: 0.9rem !important;
            width: 18px !important;
            height: 18px !important;
            font-size: 0.88rem !important;
          }

          .input-wrapper input,
          .profile-input-wrapper input,
          .profile-input-wrapper select {
            padding: 0.65rem 0.9rem 0.65rem 2.5rem !important;
            font-size: 0.85rem !important;
            border-radius: 24px !important;
          }
          
          .submit-btn {
            padding: 0.65rem !important;
            font-size: 0.88rem !important;
            border-radius: 24px !important;
            margin-top: 0.4rem !important;
          }

          .or-divider {
            margin: 0.85rem 0 !important;
            font-size: 0.78rem !important;
          }
          
          .toggle-btn {
            padding: 0.45rem 1rem !important;
            font-size: 0.82rem !important;
          }
          
          .profile-form .form-row {
            flex-direction: column;
            gap: 0;
          }
          
          .photo-upload-area {
            padding: 1.2rem;
          }
          
          .photo-preview {
            width: 100px;
            height: 100px;
          }
        }
      `}</style>

      <div className="login-bg-overlay" />
      <Navbar />

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
                    <input type="email" name="email" placeholder="name@university.edu.ph" required />
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
                  <a href="#" onClick={handleForgotPassword} style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: '0.9rem' }}>
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
                <div style={{ margin: '1.25rem 0 1.5rem 0', display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  <input
                    type="checkbox"
                    id="termsCheckbox"
                    checked={agreedToTerms}
                    onChange={(e) => setAgreedToTerms(e.target.checked)}
                    required
                    style={{
                      width: '18px',
                      height: '18px',
                      cursor: 'pointer',
                      accentColor: '#991b1b',
                      borderRadius: '4px'
                    }}
                  />
                  <label htmlFor="termsCheckbox" style={{ fontSize: '0.88rem', color: 'rgba(255, 255, 255, 0.85)', cursor: 'pointer', margin: 0, userSelect: 'none' }}>
                    I agree to the{' '}
                    <a
                      href="#terms"
                      onClick={(e) => {
                        e.preventDefault();
                        setShowTermsModal(true);
                      }}
                      style={{ color: '#60a5fa', textDecoration: 'underline', fontWeight: 600 }}
                    >
                      Terms of Service
                    </a>
                  </label>
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

              <div className="profile-grid-3">
                <div className="profile-form-group">
                  <label>First Name</label>
                  <div className="profile-input-wrapper">
                    <i className="far fa-user"></i>
                    <input type="text" name="firstName" placeholder="Enter First Name" required />
                  </div>
                </div>
                <div className="profile-form-group">
                  <label>Middle Name</label>
                  <div className="profile-input-wrapper">
                    <i className="far fa-user"></i>
                    <input type="text" name="middleName" placeholder="Enter Middle Name" />
                  </div>
                </div>
                <div className="profile-form-group">
                  <label>Last Name</label>
                  <div className="profile-input-wrapper">
                    <i className="far fa-user"></i>
                    <input type="text" name="lastName" placeholder="Enter Last Name" required />
                  </div>
                </div>
              </div>

              <div className="profile-grid-2">
                <div className="profile-form-group">
                  <label>Birthdate</label>
                  <div className="profile-input-wrapper">
                    <i className="far fa-calendar-alt"></i>
                    <input type="date" name="birthdate" required />
                  </div>
                </div>
                <div className="profile-form-group">
                  <label>Phone Number</label>
                  <div className="profile-input-wrapper">
                    <i className="fas fa-phone-alt"></i>
                    <input type="tel" name="mobileNo" placeholder="+63 ..." required />
                  </div>
                </div>
              </div>

              <div className="profile-grid-2">
                <div className="profile-form-group">
                  <label>University / School</label>
                  <div className="profile-input-wrapper">
                    <i className="fas fa-university"></i>
                    <select name="school" required>
                      <option value="" disabled selected>Select University / School</option>
                      <option value="DLSL/De La Salle Lipa">DLSL/De La Salle Lipa</option>
                      <option value="NU/National University Lipa">NU/National University Lipa</option>
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
                  <label>Course / Program</label>
                  <div className="profile-input-wrapper">
                    <i className="fas fa-graduation-cap"></i>
                    <input type="text" name="course" placeholder="e.g. BS Computer Science" required />
                  </div>
                </div>
              </div>

              <div className="profile-form-group">
                <label>Street & Barangay</label>
                <div className="profile-input-wrapper">
                  <i className="fas fa-map-marker-alt"></i>
                  <input type="text" name="streetBrgy" placeholder="Enter Street & Barangay" required />
                </div>
              </div>

              <div className="profile-grid-3">
                <div className="profile-form-group">
                  <label>Town / City</label>
                  <div className="profile-input-wrapper">
                    <i className="fas fa-city"></i>
                    <input type="text" name="townCityMunicipality" value="Lipa City" readOnly className="readonly-field" />
                  </div>
                </div>
                <div className="profile-form-group">
                  <label>Province</label>
                  <div className="profile-input-wrapper">
                    <i className="fas fa-map"></i>
                    <input type="text" name="province" value="Batangas" readOnly className="readonly-field" />
                  </div>
                </div>
                <div className="profile-form-group">
                  <label>Zip Code</label>
                  <div className="profile-input-wrapper">
                    <i className="fas fa-mail-bulk"></i>
                    <input type="text" name="zipCode" value="4217" readOnly className="readonly-field" />
                  </div>
                </div>
              </div>

              <button type="submit" className="submit-btn" style={{marginTop: '1.25rem'}}>
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

      {/* Account Suspended Modal */}
      {showSuspensionModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
        }}>
          <div style={{
            background: '#fff', borderRadius: '28px', padding: '2.5rem', maxWidth: '420px',
            width: '90%', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.2)'
          }}>
            <div style={{
              width: '72px', height: '72px', borderRadius: '50%',
              background: '#fee2e2', display: 'flex', alignItems: 'center',
              justifyContent: 'center', margin: '0 auto 1.5rem', fontSize: '2rem', color: '#dc2626'
            }}>
              <i className="fas fa-ban"></i>
            </div>
            <h2 style={{ fontSize: '1.4rem', fontWeight: '800', color: '#991b1b', marginBottom: '0.75rem' }}>
              Account Suspended
            </h2>
            <p style={{ color: '#555', fontSize: '0.95rem', lineHeight: '1.6', marginBottom: '1.5rem' }}>
              Your account has been suspended by the administrator.<br />
              Please contact the Mayor's Scholarship Office for assistance.
            </p>
            <button
              onClick={() => setShowSuspensionModal(false)}
              style={{
                background: '#991b1b', color: 'white', border: 'none', borderRadius: '40px',
                padding: '0.75rem 2.5rem', fontWeight: '700', fontSize: '0.95rem', cursor: 'pointer'
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
      {/* Terms of Service Overlay Modal */}
      {showTermsModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 99999,
          padding: '1rem'
        }}>
          <div style={{
            background: '#1e293b',
            color: '#f8fafc',
            borderRadius: '24px',
            maxWidth: '520px',
            width: '92%',
            padding: '2rem',
            boxShadow: '0 25px 60px rgba(0, 0, 0, 0.5)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            position: 'relative'
          }}>
            <div style={{
              display: 'flex',
              justify: 'space-between',
              alignItems: 'center',
              marginBottom: '1.25rem',
              paddingBottom: '1rem',
              borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
            }}>
              <h3 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: '#ffffff' }}>
                Terms of Service
              </h3>
              <button
                type="button"
                onClick={() => setShowTermsModal(false)}
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: 'none',
                  color: '#94a3b8',
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.1rem',
                  cursor: 'pointer'
                }}
              >
                <i className="fas fa-times"></i>
              </button>
            </div>

            <div style={{
              maxHeight: '300px',
              overflowY: 'auto',
              paddingRight: '0.5rem',
              fontSize: '0.98rem',
              lineHeight: '1.6',
              color: '#cbd5e1'
            }}>
              <p style={{ margin: 0 }}>Add terms of services here.</p>
            </div>

            <div style={{
              marginTop: '1.5rem',
              paddingTop: '1rem',
              borderTop: '1px solid rgba(255, 255, 255, 0.1)',
              display: 'flex',
              justify: 'flex-end'
            }}>
              <button
                type="button"
                onClick={() => {
                  setAgreedToTerms(true);
                  setShowTermsModal(false);
                }}
                style={{
                  background: '#991b1b',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '30px',
                  padding: '0.65rem 1.6rem',
                  fontSize: '0.95rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                I Agree
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Login;
