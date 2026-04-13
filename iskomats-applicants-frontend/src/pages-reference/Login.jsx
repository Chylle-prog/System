import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

const Login = () => {
  const navigate = useNavigate();
  const [isLogin, setIsLogin] = useState(true);
  const [showProfile, setShowProfile] = useState(false);
  const [showRegistrationModal, setShowRegistrationModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showError, setShowError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [profilePicture, setProfilePicture] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
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

  const handleLogin = (e) => {
    e.preventDefault();
    const email = e.target.email.value;
    const password = e.target.password.value;

    // Validate email domain
    if (!email.endsWith('.edu.ph')) {
      setErrorMessage('Only .edu.ph email addresses are allowed to login.');
      setShowError(true);
      return;
    }

    // Get accounts from localStorage
    const accounts = JSON.parse(localStorage.getItem('userAccounts')) || {};

    if (accounts[email] && accounts[email].password === password) {
      setCurrentUser(email);
      localStorage.setItem('currentUser', email);
      setShowError(false);

      // Check if user has profile
      const profiles = JSON.parse(localStorage.getItem('userProfiles')) || {};
      if (profiles[email]) {
        navigate('/portal');
      } else {
        setShowProfile(true);
      }
    } else {
      setErrorMessage('Invalid email or password.');
      setShowError(true);
    }
  };

  const handleRegister = (e) => {
    e.preventDefault();
    const email = e.target.email.value;
    const password = e.target.password.value;
    const confirmPassword = e.target.confirmPassword.value;

    // Validate email domain
    if (!email.endsWith('.edu.ph')) {
      setErrorMessage('Only .edu.ph email addresses are allowed to register.');
      setShowError(true);
      return;
    }

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

    // Get existing accounts
    const accounts = JSON.parse(localStorage.getItem('userAccounts')) || {};

    if (accounts[email]) {
      setErrorMessage('Email already registered.');
      setShowError(true);
      return;
    }

    // Save new account
    accounts[email] = {
      password: password,
      createdAt: new Date().toISOString(),
      profileComplete: false
    };
    localStorage.setItem('userAccounts', JSON.stringify(accounts));

    // Set currentUser for the profile creation step
    setCurrentUser(email);
    localStorage.setItem('currentUser', email);

    // Show registration success modal
    setShowRegistrationModal(true);
    e.target.reset();
  };

  const handleProfileSubmit = (e) => {
    e.preventDefault();
    const fullName = e.target.fullName.value;
    const birthdate = e.target.birthdate.value;
    const university = e.target.university.value;
    const phoneNumber = e.target.phoneNumber.value;
    const address = e.target.address.value;

    // Validate required fields
    if (!fullName || !birthdate || !university || !phoneNumber || !address) {
      setErrorMessage('Please fill in all required fields');
      setShowError(true);
      return;
    }

    const profileData = {
      fullName,
      birthdate,
      university,
      phoneNumber,
      address,
      profilePicture,
      createdAt: new Date().toISOString()
    };

    // Save profile data
    const profiles = JSON.parse(localStorage.getItem('userProfiles')) || {};
    profiles[currentUser] = profileData;
    localStorage.setItem('userProfiles', JSON.stringify(profiles));

    // Show success modal
    setShowSuccessModal(true);
    
    // Redirect to portal after delay
    setTimeout(() => {
      navigate('/portal');
    }, 2000);
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

  const handleGoogleSignUp = () => {
    // Placeholder for Google sign-up functionality
    alert('Google sign-up functionality will be implemented soon!');
  };

  const handleForgotPassword = () => {
    // Placeholder for forgot password functionality
    alert('Password reset functionality will be implemented soon!');
  };

  const closeRegistrationModal = () => {
    setShowRegistrationModal(false);
    setIsLogin(true); // Switch to login form
  };

  const toggleAuthForm = () => {
    setIsLogin(!isLogin);
    setShowError(false);
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
          flex-direction: column;
          align-items: center;
          margin-bottom: 2rem;
        }

        .profile-pic {
          width: 130px;
          height: 130px;
          border-radius: 50%;
          background: linear-gradient(145deg, #ffe8e3, #fff0eb);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 3rem;
          overflow: hidden;
          border: 3px solid white;
          box-shadow: var(--shadow-md);
          margin-bottom: 1.2rem;
          transition: var(--transition);
        }

        .profile-pic img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .file-input-wrapper {
          position: relative;
          width: 100%;
          display: flex;
          justify-content: center;
        }

        .file-input-wrapper input {
          opacity: 0;
          position: absolute;
          width: 100%;
          height: 100%;
          cursor: pointer;
          left: 0;
        }

        .file-label {
          display: inline-block;
          background: var(--gray-1);
          padding: 0.7rem 1.8rem;
          border-radius: 40px;
          font-weight: 600;
          color: var(--primary);
          border: 2px dashed var(--gray-3);
          transition: var(--transition);
          cursor: pointer;
        }

        .file-label:hover {
          background: white;
          border-color: var(--primary);
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
          <img src="/iskologo.png" alt="iskoMats" style={{height: '56px', marginRight: '16px', verticalAlign: 'middle'}} />
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
                <button type="submit" className="submit-btn">Log in</button>
                <div className="forgot-password">
                  <a href="#" onClick={handleForgotPassword} style={{color: 'var(--primary)', textDecoration: 'none', fontSize: '0.9rem'}}>
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
                  <small style={{color: 'var(--text-soft)', fontSize: '0.85rem', marginTop: '0.25rem', display: 'block'}}>
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
                    <svg width="18" height="18" viewBox="0 0 18 18" style={{marginRight: '8px'}}>
                      <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 1.98v2.54h3.14c-.72 2.31-2.6 3.98-5.28 3.98-3.21 0-5.91-2.75-5.91-6.26h-.01c0-3.41 2.72-6.26 5.91-6.26 1.44 0 2.68.56 3.51 1.36l2.68 2.06c1.51-1.37 2.48-3.38 2.48-5.59z" />
                      <path fill="#34A853" d="M8.98 17c2.16 0 4.02-.75 5.52-2.01l-2.68-2.06c-.75.56-1.67.75-3.51 1.36-3.51H8.98v3z" />
                      <path fill="#FBBC05" d="M8.98 8v3h5.91c-.18 1-.74 1.48-1.6 1.98V8z" />
                      <path fill="#EA4335" d="M0 0v18h8.98V8H0z" />
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
                <div className="profile-pic">
                  {profilePicture ? (
                    <img src={profilePicture} alt="profile" />
                  ) : (
                    <span>📸</span>
                  )}
                </div>
                <div className="file-input-wrapper">
                  <input type="file" accept="image/*" onChange={handleProfilePictureUpload} />
                  <span className="file-label">
                    <i className="fas fa-camera"></i> upload photo
                  </span>
                </div>
              </div>
              <div className="form-group">
                <label>Full name</label>
                <div className="input-wrapper">
                  <i className="fas fa-user"></i>
                  <input type="text" name="fullName" placeholder="Enter Full Name" required />
                </div>
              </div>
              <div className="form-group">
                <label>Birthdate</label>
                <div className="input-wrapper">
                  <i className="fas fa-calendar"></i>
                  <input type="date" name="birthdate" required />
                </div>
              </div>
              <div className="form-group">
                <label>University / school</label>
                <div className="input-wrapper">
                  <i className="fas fa-university"></i>
                  <input type="text" name="university" placeholder="University of Manila" required />
                </div>
              </div>
              <div className="form-group">
                <label>Phone number</label>
                <div className="input-wrapper">
                  <i className="fas fa-phone"></i>
                  <input type="tel" name="phoneNumber" placeholder="+63 ..." required />
                </div>
              </div>
              <div className="form-group">
                <label>Address</label>
                <div className="input-wrapper">
                  <i className="fas fa-map-pin"></i>
                  <input type="text" name="address" placeholder="City, Province" required />
                </div>
              </div>
              <button type="submit" className="submit-btn">Create profile →</button>
            </form>
          </div>
        </section>
      </div>

      {/* Registration Success Modal */}
      <div className={`modal-overlay ${showRegistrationModal ? 'active' : ''}`}>
        <div className="modal-content">
          <h3>✅ Registration Successful!</h3>
          <p>Please log in again to continue your iskoMats journey.</p>
          <button className="submit-btn" onClick={closeRegistrationModal}>Log In</button>
        </div>
      </div>

      {/* Success modal */}
      <div className={`modal-overlay ${showSuccessModal ? 'active' : ''}`}>
        <div className="modal-content">
          <h3>✅ Profile Complete!</h3>
          <p>Redirecting to your portal...</p>
        </div>
      </div>
    </>
  );
};

export default Login;
