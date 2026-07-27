import React, { useState, useEffect, useMemo } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { authAPI } from '../services/api';
import lipaBg from '../assets/lipa.jpg';

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
    strength: {
      score: 0,
      label: "Weak",
      color: "#ef4444"
    }
  });

  const token = useMemo(() => routeToken || new URLSearchParams(window.location.search).get('token') || '', [routeToken]);

  useEffect(() => {
    // Add Font Awesome link
    const fontAwesomeLink = document.createElement('link');
    fontAwesomeLink.rel = 'stylesheet';
    fontAwesomeLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css';
    document.head.appendChild(fontAwesomeLink);

    const googleFontsLink = document.createElement('link');
    googleFontsLink.rel = 'stylesheet';
    googleFontsLink.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(googleFontsLink);

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

  const calculateStrength = (pass) => {
    let score = 0;
    if (pass.length > 8) score++;
    if (/[A-Z]/.test(pass)) score++;
    if (/[0-9]/.test(pass)) score++;
    if (/[^A-Za-z0-9]/.test(pass)) score++;

    const labels = ["Very Weak", "Weak", "Medium", "Strong", "Very Strong"];
    const colors = ["#ef4444", "#f97316", "#facc15", "#84cc16", "#22c55e"];

    return {
      score,
      label: labels[score],
      color: colors[score]
    };
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    const newFormData = {
      ...formData,
      [name]: value,
      error: "",
      success: false
    };

    if (name === 'newPassword') {
      newFormData.strength = calculateStrength(value);
    }

    setFormData(newFormData);
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
          background: url(${lipaBg}) center/cover no-repeat fixed;
          color: white;
          line-height: 1.5;
          min-height: 100vh;
          position: relative;
        }

        body::before {
          content: '';
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: linear-gradient(135deg, rgba(0, 0, 0, 0.8), rgba(79, 13, 0, 0.4), rgba(0, 0, 0, 0.9));
          z-index: -1;
        }

        @keyframes slideUp {
          from { transform: translateY(40px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }

        @keyframes checkPop {
          0% { transform: scale(0); }
          70% { transform: scale(1.2); }
          100% { transform: scale(1); }
        }

        .auth-card {
          animation: slideUp 0.8s cubic-bezier(0.16, 1, 0.3, 1);
          border: 1px solid rgba(255, 255, 255, 0.25);
          overflow: hidden;
          position: relative;
        }

        .auth-card::after {
          content: '';
          position: absolute;
          top: -50%;
          right: -50%;
          width: 200%;
          height: 200%;
          background: radial-gradient(circle, rgba(255,255,255,0.03) 0%, transparent 70%);
          pointer-events: none;
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
          max-width: 550px;
          width: 95%;
          background: rgba(255, 255, 255, 0.12);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border-radius: 40px;
          padding: 2rem 3rem 2.5rem;
          box-shadow: 0 40px 100px rgba(0, 0, 0, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.3);
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
          box-shadow: 0 40px 100px rgba(0, 0, 0, 0.6);
          background: rgba(255, 255, 255, 0.15);
        }

        .auth-header {
          margin-bottom: 1.5rem;
          text-align: center;
        }

        .auth-header h2 {
          font-size: 1.8rem;
          font-weight: 800;
          margin-bottom: 0.5rem;
          color: white;
          letter-spacing: -0.03em;
        }

        .auth-header p {
          color: rgba(255, 255, 255, 0.8);
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
          color: rgba(255, 255, 255, 0.8);
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

        .input-wrapper input,
        .input-wrapper select {
          width: 100%;
          padding: 0.85rem 1rem 0.85rem 2.8rem;
          background: rgba(255, 255, 255, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 12px;
          color: var(--text-dark);
          font-size: 0.95rem;
          font-family: 'Inter', sans-serif;
          font-weight: 500;
          transition: var(--transition);
        }

        .input-wrapper input::placeholder {
          color: rgba(18, 24, 38, 0.5);
        }

        .input-wrapper input:focus,
        .input-wrapper select:focus {
          outline: none;
          background: rgba(255, 255, 255, 0.6);
          border-color: white;
          box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.1);
          color: var(--text-dark);
        }

        .input-wrapper input:-webkit-autofill,
        .input-wrapper input:-webkit-autofill:hover,
        .input-wrapper input:-webkit-autofill:focus {
          -webkit-text-fill-color: var(--text-dark);
          -webkit-box-shadow: 0 0 0px 1000px rgba(255, 255, 255, 0.5) inset;
          transition: background-color 5000s ease-in-out 0s;
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

        .strength-meter {
          height: 6px;
          width: 100%;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 3px;
          margin-top: 0.8rem;
          margin-bottom: 0.5rem;
          overflow: hidden;
          position: relative;
        }

        .strength-bar {
          height: 100%;
          transition: width 0.5s ease, background-color 0.5s ease;
        }

        .strength-text {
          font-size: 0.75rem;
          font-weight: 600;
          display: flex;
          justify-content: space-between;
          color: rgba(255, 255, 255, 0.6);
        }

        .success-icon {
          text-align: center;
          margin-bottom: 1.5rem;
          animation: checkPop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }

        .success-content h3 {
          color: white;
          font-size: 1.4rem;
          margin-bottom: 0.5rem;
        }

        .success-content p {
          color: rgba(255, 255, 255, 0.8);
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
                  <i 
                    className={`fas ${formData.showPassword ? 'fa-eye-slash' : 'fa-eye'} toggle-password`}
                    onClick={() => setFormData({...formData, showPassword: !formData.showPassword})}
                    style={{ left: 'auto', right: '1.2rem', cursor: 'pointer', pointerEvents: 'auto', color: 'var(--primary)' }}
                  ></i>
                </div>
                
                {formData.newPassword && (
                  <div className="strength-container" style={{ marginTop: '0.5rem' }}>
                    <div className="strength-meter">
                      <div 
                        className="strength-bar" 
                        style={{ 
                          width: `${(formData.strength.score / 4) * 100}%`,
                          backgroundColor: formData.strength.color
                        }}
                      ></div>
                    </div>
                    <div className="strength-text">
                      <span>Password Strength</span>
                      <span style={{ color: formData.strength.color }}>{formData.strength.label}</span>
                    </div>
                  </div>
                )}
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
