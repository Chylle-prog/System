import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authAPI, applicantAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';


const Login = () => {
  const navigate = useNavigate();
  const [isLogin, setIsLogin] = useState(true);
  const [showProfile, setShowProfile] = useState(false);
  const [showRegistrationModal, setShowRegistrationModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showError, setShowError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [profilePicture, setProfilePicture] = useState(null);
  const { setCurrentUserState } = useAuth();
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    if (localStorage.getItem('authToken') && localStorage.getItem('currentUser')) {
      navigate('/portal');
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

    try {
      // Call backend login API
      const response = await authAPI.login(email, password);

      setCurrentUser(email); // local state
      if (setCurrentUserState) setCurrentUserState(email); // global AuthContext state

      localStorage.setItem('currentUser', email);
      localStorage.setItem('authToken', response.token);
      localStorage.setItem('applicantNo', response.applicant_no);
      setShowError(false);

      // Navigate to portal
      navigate('/portal');
    } catch (error) {
      // Handle specific error messages from backend
      if (error.message.includes('Email not found')) {
        setErrorMessage('Incorrect email.');
      } else if (error.message.includes('Incorrect password')) {
        setErrorMessage('Incorrect password.');
      } else {
        setErrorMessage(error.message || 'Login failed. Please try again.');
      }
      setShowError(true);
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
      // Check if email already exists
      const checkResponse = await authAPI.checkEmail(email);
      if (checkResponse.exists) {
        setErrorMessage('This email is already registered.');
        setShowError(true);
        return;
      }

      // Store credentials temporarily for profile completion
      setCurrentUser(email);
      localStorage.setItem('registrationEmail', email);
      localStorage.setItem('registrationPassword', password);
      setShowRegistrationModal(true);
      e.target.reset();
    } catch (error) {
      setErrorMessage(error.message || 'Registration failed. Please try again.');
      setShowError(true);
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
    const overallGpa = e.target.overallGpa?.value || '';
    const financialIncomeOfParents = e.target.financialIncomeOfParents?.value || '';

    // Validate required fields
    if (!firstName || !lastName || !birthdate || !school || !mobileNo || !streetBrgy || !townCityMunicipality || !province || !zipCode) {
      setErrorMessage('Please fill in all required fields');
      setShowError(true);
      return;
    }

    try {
      // Get registration credentials from localStorage
      const email = localStorage.getItem('registrationEmail');
      const password = localStorage.getItem('registrationPassword');

      let authToken = '';
      let applicantNo = '';

      try {
        // Register user with backend
        const registerResponse = await authAPI.register({
          firstName,
          middleName,
          lastName,
          email,
          password
        });

        // Log in user to get token
        const loginResponse = await authAPI.login(email, password);
        authToken = loginResponse.token;
        applicantNo = loginResponse.applicant_no;
      } catch (regError) {
        // If already registered, just try to login
        if (regError.message.includes('already registered')) {
          const loginResponse = await authAPI.login(email, password);
          authToken = loginResponse.token;
          applicantNo = loginResponse.applicant_no;
        } else {
          throw regError;
        }
      }

      setCurrentUser(email); // local state
      if (setCurrentUserState) setCurrentUserState(email); // global AuthContext state

      localStorage.setItem('currentUser', email);
      localStorage.setItem('authToken', authToken);
      localStorage.setItem('applicantNo', applicantNo);

      // Now that we have a token, save the rest of the profile data
      await applicantAPI.updateProfile({
        birthdate,
        school,
        mobile_no: mobileNo,
        street_brgy: streetBrgy,
        town_city_municipality: townCityMunicipality,
        province,
        zip_code: zipCode,
        overall_gpa: overallGpa ? parseFloat(overallGpa) : null,
        financial_income_of_parents: financialIncomeOfParents ? parseInt(financialIncomeOfParents) : null,
        profile_picture: profilePicture
      });

      // Clear temporary registration data
      localStorage.removeItem('registrationEmail');
      localStorage.removeItem('registrationPassword');

      // Show success modal
      setShowSuccessModal(true);

      // Redirect to portal after delay
      setTimeout(() => {
        navigate('/portal');
      }, 2000);
    } catch (error) {
      setErrorMessage(error.message || 'Profile creation failed. Please try again.');
      setShowError(true);
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
    setShowProfile(true); // Switch to profile completion form
  };

  const toggleAuthForm = () => {
    setIsLogin(!isLogin);
    setShowError(false);
  };

  const handleGoogleSignUp = () => {
    // Placeholder for Google sign-up functionality
    alert('Google sign-up functionality will be implemented soon!');
  };

  const handleForgotPassword = (e) => {
    e.preventDefault();
    // Placeholder for forgot password functionality
    alert('Password reset functionality will be implemented soon!');
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
          font-size: 2.2rem;
          font-weight: 800;
          background: var(--primary-gradient);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          text-align: center;
          margin-bottom: 2rem;
        }

        .profile-picture-upload {
          display: flex;
          align-items: center;
          gap: 2rem;
          margin-bottom: 2rem;
        }

        .profile-pic {
          width: 100px;
          height: 100px;
          border-radius: 50%;
          background: var(--gray-1);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 2.5rem;
          color: var(--text-soft);
          border: 3px solid var(--gray-2);
          position: relative;
          overflow: hidden;
        }

        .profile-form-group {
          margin-bottom: 1.5rem;
        }

        .profile-form-group label {
          display: block;
          font-weight: 600;
          font-size: 0.85rem;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          color: var(--primary-light);
          margin-bottom: 0.4rem;
        }

        .profile-form-group input, .profile-form-group textarea, .profile-form-group select {
          width: 100%;
          padding: 0.9rem 1.2rem;
          border: 1.5px solid var(--gray-2);
          border-radius: 18px;
          font-size: 0.95rem;
          transition: 0.15s;
          background: var(--gray-1);
          font-family: 'Inter', sans-serif;
        }

        .profile-form-group input:focus, .profile-form-group textarea:focus, .profile-form-group select:focus {
          outline: none;
          border-color: var(--primary);
          background: var(--white);
          box-shadow: 0 0 0 4px rgba(79,13,0,0.08);
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
                <button type="submit" className="submit-btn">Log in</button>
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
                  <button type="button" className="google-signup-btn" onClick={handleGoogleSignUp}>
                    <svg width="18" height="18" viewBox="0 0 18 18" style={{ marginRight: '8px' }}>
                      <path fill="#4285F4" d="M17.64 9.2c0-.63-.06-1.25-.16-1.84H9v3.47h4.84c-.21 1.12-.83 2.07-1.79 2.71v2.24h2.91c1.71-1.58 2.68-3.91 2.68-6.58z" />
                      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.24c-.8.54-1.84.85-3.05.85-2.33 0-4.32-1.58-5.02-3.71H.95v2.33C2.43 15.93 5.47 18 9 18z" />
                      <path fill="#FBBC05" d="M3.98 10.72c-.18-.54-.28-1.12-.28-1.72s.1-1.18.28-1.72V4.95H.95C.35 6.16 0 7.54 0 9s.35 2.84.95 4.05l3.03-2.33z" />
                      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47 1.18 11.43 0 9 0 5.47 0 2.43 2.07.95 5.07L3.98 7.4c.7-2.13 2.69-3.82 5.02-3.82z" />
                    </svg>
                    Sign up with Google
                  </button>
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
            <form onSubmit={handleProfileSubmit}>
              <div className="profile-picture-upload">
                <div
                  className="profile-pic"
                  dangerouslySetInnerHTML={{ __html: profilePicture ? `<img src="${profilePicture}" alt="profile" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">` : '<span>👤</span>' }}
                />
                <div className="profile-form-group">
                  <label>Profile picture</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleProfilePictureUpload}
                  />
                </div>
              </div>
              <div className="profile-form-group">
                <label>First name</label>
                <input
                  type="text"
                  name="firstName"
                  placeholder="e.g., Maria"
                  required
                />
              </div>
              <div className="profile-form-group">
                <label>Middle name</label>
                <input
                  type="text"
                  name="middleName"
                  placeholder="e.g., Dela Cruz"
                />
              </div>
              <div className="profile-form-group">
                <label>Last name</label>
                <input
                  type="text"
                  name="lastName"
                  placeholder="e.g., Santos"
                  required
                />
              </div>
              <div className="profile-form-group">
                <label>Birthdate</label>
                <input
                  type="date"
                  name="birthdate"
                  required
                />
              </div>
              <div className="profile-form-group">
                <label>University / School</label>
                <input
                  type="text"
                  name="school"
                  placeholder="University of Manila"
                  required
                />
              </div>
              <div className="profile-form-group">
                <label>Phone number</label>
                <input
                  type="tel"
                  name="mobileNo"
                  placeholder="+63 ..."
                  required
                />
              </div>
              <div className="profile-form-group">
                <label>Street / Barangay</label>
                <input
                  type="text"
                  name="streetBrgy"
                  placeholder="e.g., 123 Main St, Brgy. Nayong Kanluran"
                  required
                />
              </div>
              <div className="profile-form-group">
                <label>Town / City / Municipality</label>
                <input
                  type="text"
                  name="townCityMunicipality"
                  placeholder="e.g., Manila"
                  required
                />
              </div>
              <div className="profile-form-group">
                <label>Province</label>
                <input
                  type="text"
                  name="province"
                  placeholder="e.g., Metro Manila"
                  required
                />
              </div>
              <div className="profile-form-group">
                <label>Zip Code</label>
                <input
                  type="text"
                  name="zipCode"
                  placeholder="e.g., 1000"
                  required
                />
              </div>
              <button type="submit" className="submit-btn" style={{ marginTop: '0.8rem' }}>Create Profile →</button>
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
    </>
  );
};

export default Login;
