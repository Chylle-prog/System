import React, { useState, useEffect, useMemo } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { authAPI } from '../services/api';

const ResetPassword = () => {
  const navigate = useNavigate();
  const { token: routeToken } = useParams();
  const [formData, setFormData] = useState({
    newPassword: "",
    confirmPassword: "",
    showPassword: false,
    showConfirmPassword: false,
    isLoading: false,
    error: "",
    success: false,
  });

  const token = useMemo(() => routeToken || new URLSearchParams(window.location.search).get('token') || '', [routeToken]);

  useEffect(() => {
    // Add Font Awesome link
    const fontAwesomeLink = document.createElement('link');
    fontAwesomeLink.rel = 'stylesheet';
    fontAwesomeLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css';
    document.head.appendChild(fontAwesomeLink);

    // Add Google Fonts link
    const googleFontsSheet = document.createElement('link');
    googleFontsSheet.rel = 'stylesheet';
    googleFontsSheet.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(googleFontsSheet);

    return () => {
      document.head.removeChild(fontAwesomeLink);
      document.head.removeChild(googleFontsSheet);
    };
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: value,
      error: "",
      success: false
    });
  };

  const togglePassword = (field) => {
    setFormData({
      ...formData,
      [field]: !formData[field]
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormData({ ...formData, isLoading: true, error: "", success: false });

    if (!token) {
      setFormData((previous) => ({
        ...previous,
        error: "Password reset link is invalid or missing",
        isLoading: false,
      }));
      return;
    }

    if (!formData.newPassword || !formData.confirmPassword) {
      setFormData({
        ...formData,
        error: "All fields are required",
        isLoading: false
      });
      return;
    }

    if (formData.newPassword !== formData.confirmPassword) {
      setFormData({
        ...formData,
        error: "Passwords do not match",
        isLoading: false
      });
      return;
    }

    try {
      await authAPI.resetPassword(token, formData.newPassword);
      setFormData((previous) => ({
        ...previous,
        isLoading: false,
        success: true,
        error: "",
      }));
    } catch (error) {
      setFormData((previous) => ({
        ...previous,
        isLoading: false,
        success: false,
        error: error.message || 'Failed to reset password',
      }));
    }
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
          cursor: pointer;
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
          margin-bottom: 2rem;
          text-align: center;
        }

        .auth-header h2 {
          font-size: 1.8rem;
          font-weight: 800;
          margin-bottom: 0.5rem;
          background: var(--primary-gradient);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          letter-spacing: -0.03em;
        }

        .auth-header p {
          color: var(--text-soft);
          font-size: 0.95rem;
          margin-bottom: 1.5rem;
        }

        .form-group {
          margin-bottom: 1.5rem;
        }

        .form-group label {
          display: block;
          font-weight: 600;
          font-size: 0.85rem;
          color: var(--text-dark);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 0.5rem;
        }

        .input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .input-wrapper i {
          position: absolute;
          left: 1rem;
          color: var(--primary);
          font-size: 1rem;
          pointer-events: none;
        }

        .toggle-btn {
          position: absolute;
          right: 0.75rem;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          color: var(--primary);
          cursor: pointer;
          font-size: 0.95rem;
          padding: 0.5rem;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 2rem;
          height: 2rem;
          z-index: 10;
          border-radius: 6px;
          transition: var(--transition);
        }

        .toggle-btn:hover {
          color: var(--primary-light);
          background: rgba(79, 13, 0, 0.05);
        }

        .toggle-btn:active {
          background: rgba(79, 13, 0, 0.1);
        }

        .input-wrapper input,
        .input-wrapper select {
          width: 100%;
          padding: 0.75rem 1rem 0.75rem 2.8rem;
          background: rgba(255, 255, 255, 0.4);
          border: 1px solid rgba(79, 13, 0, 0.08);
          border-radius: 12px;
          color: var(--text-dark);
          font-size: 0.95rem;
          font-family: 'Inter', sans-serif;
          transition: var(--transition);
        }

        .input-wrapper input::placeholder {
          color: rgba(44, 59, 79, 0.4);
        }

        .input-wrapper input:focus,
        .input-wrapper select:focus {
          outline: none;
          background: rgba(255, 255, 255, 0.6);
          border-color: var(--primary);
          box-shadow: 0 0 0 3px rgba(79, 13, 0, 0.08);
        }

        .error-box {
          background: rgba(239, 68, 68, 0.08);
          border: 1px solid rgba(239, 68, 68, 0.3);
          border-radius: 12px;
          padding: 0.75rem 1rem;
          margin-bottom: 1.5rem;
          color: #991b1b;
          font-size: 0.9rem;
          text-align: center;
        }

        .success-icon {
          text-align: center;
          margin-bottom: 1.5rem;
        }

        .success-icon i {
          font-size: 3rem;
          color: #16a34a;
        }

        .success-content h3 {
          color: var(--text-dark);
          font-size: 1.4rem;
          margin-bottom: 0.5rem;
        }

        .success-content p {
          color: var(--text-soft);
          font-size: 0.9rem;
          margin-bottom: 1rem;
        }

        .submit-btn {
          width: 100%;
          padding: 0.9rem;
          background: var(--primary-gradient);
          color: white;
          border: none;
          border-radius: 12px;
          font-weight: 700;
          font-size: 0.95rem;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.75rem;
          transition: var(--transition);
          box-shadow: var(--shadow-md);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          font-size: 0.9rem;
        }

        .submit-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: var(--shadow-lg);
          filter: brightness(1.08);
        }

        .submit-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .spinner {
          width: 18px;
          height: 18px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .continue-btn {
          width: 100%;
          padding: 0.9rem;
          background: var(--primary-gradient);
          color: white;
          border: none;
          border-radius: 12px;
          font-weight: 700;
          font-size: 0.9rem;
          cursor: pointer;
          transition: var(--transition);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 1rem;
        }

        .continue-btn:hover {
          transform: translateY(-2px);
          filter: brightness(1.08);
        }

        .footer {
          margin-top: 1.5rem;
          text-align: center;
          color: var(--text-soft);
          font-size: 0.9rem;
        }

        .footer button {
          background: none;
          border: none;
          color: var(--primary);
          cursor: pointer;
          font-weight: 700;
          margin-left: 0.5rem;
          transition: var(--transition);
        }

        .footer button:hover {
          color: var(--primary-light);
        }
      `}</style>

      <nav className="navbar">
        <a href="/" className="navbar-brand">
          <i className="fas fa-graduation-cap" style={{ fontSize: '2rem' }}></i>
          iskoMats
        </a>
        <div className="navbar-nav">
          <a href="/">Home</a>
          <a href="/">About Us</a>
          <a href="/">Contact Info</a>
        </div>
      </nav>

      <div className="auth-wrapper">
        <div className="auth-card">
          <div className="auth-header">
            <h2>Update Your Password</h2>
            <p>
              {formData.success 
                ? "Your password has been successfully reset"
                : "Create a new strong password for your account"
              }
            </p>
          </div>

          {!formData.success ? (
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>New Password</label>
                <div className="input-wrapper">
                  <i className="fas fa-lock"></i>
                  <input
                    type={formData.showPassword ? "text" : "password"}
                    name="newPassword"
                    value={formData.newPassword}
                    onChange={handleChange}
                    placeholder="Enter new password"
                    required
                    disabled={formData.isLoading}
                  />
                  <button
                    type="button"
                    className="toggle-btn"
                    onClick={() => togglePassword("showPassword")}
                  >
                    <i className={`fas ${formData.showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label>Confirm Password</label>
                <div className="input-wrapper">
                  <i className="fas fa-lock"></i>
                  <input
                    type={formData.showConfirmPassword ? "text" : "password"}
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    placeholder="Confirm new password"
                    required
                    disabled={formData.isLoading}
                  />
                  <button
                    type="button"
                    className="toggle-btn"
                    onClick={() => togglePassword("showConfirmPassword")}
                  >
                    <i className={`fas ${formData.showConfirmPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                  </button>
                </div>
              </div>

              {formData.error && (
                <div className="error-box">
                  {formData.error}
                </div>
              )}

              <button
                type="submit"
                className="submit-btn"
                disabled={formData.isLoading || !token}
              >
                {formData.isLoading ? (
                  <>
                    <div className="spinner"></div>
                    Updating...
                  </>
                ) : (
                  <>
                    <i className="fas fa-check"></i>
                    Update Password
                  </>
                )}
              </button>
            </form>
          ) : (
            <div style={{ textAlign: 'center' }}>
              <div className="success-icon">
                <i className="fas fa-check-circle"></i>
              </div>
              
              <div className="success-content">
                <h3>Password Reset Complete!</h3>
                <p>
                  Your password has been successfully updated. You can now sign in with your new password.
                </p>
              </div>

              <button
                onClick={() => navigate('/login')}
                className="continue-btn"
              >
                <i className="fas fa-sign-in-alt"></i>
                Return to Login
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default ResetPassword;
