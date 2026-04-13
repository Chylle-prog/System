import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authAPI } from '../services/api';
import lipaBg from '../assets/lipa.jpg';

const ForgotPassword = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    email: "",
    isLoading: false,
    error: "",
    success: false,
    isSubmitted: false
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: value,
      error: "",
      success: false
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormData({ ...formData, isLoading: true, error: "", success: false });

    // Basic validation
    if (!formData.email) {
      setFormData({
        ...formData,
        error: "Email is required",
        isLoading: false
      });
      return;
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      setFormData({
        ...formData,
        error: "Please enter a valid email address",
        isLoading: false
      });
      return;
    }

    try {
      // Check if email exists before sending reset email
      const emailCheckResponse = await authAPI.checkEmail(formData.email.trim());
      console.log('Check Email Response:', emailCheckResponse);
      // available: false means email exists (not available), available: true means email doesn't exist
      if (emailCheckResponse.available !== false) {
        setFormData({
          ...formData,
          isLoading: false,
          error: "No account found with this email address",
        });
        return;
      }

      await authAPI.forgotPassword(formData.email.trim());
      setFormData((previous) => ({
        ...previous,
        isLoading: false,
        success: true,
        isSubmitted: true,
        error: "",
      }));
    } catch (error) {
      setFormData((previous) => ({
        ...previous,
        isLoading: false,
        success: false,
        error: error.response?.data?.message || error.message || 'Failed to send reset email',
      }));
    }
  };

  const handleBackToLogin = () => {
    navigate('/login');
  };

  const handleResendEmail = () => {
    handleSubmit({ preventDefault: () => {} });
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
          background: linear-gradient(to bottom, rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.8));
          z-index: -1;
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
          max-width: 420px;
          width: 100%;
          background: rgba(255, 255, 255, 0.12);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border-radius: 48px;
          padding: 2.22rem 2.8rem 2.8rem;
          box-shadow: 0 40px 80px rgba(0, 0, 0, 0.5);
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
          margin-bottom: 2rem;
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

        /* Prevent white-on-white text during Chrome autofill */
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

        .success-icon {
          text-align: center;
          margin-bottom: 1.5rem;
        }

        .success-icon i {
          font-size: 3rem;
          color: #16a34a;
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

        .email-display {
          background: rgba(79, 13, 0, 0.05);
          padding: 1rem;
          border-radius: 12px;
          margin: 1rem 0;
          color: var(--primary);
          font-weight: 600;
          border: 1px solid rgba(79, 13, 0, 0.08);
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

        .resend-btn {
          width: 100%;
          margin-top: 0.75rem;
          padding: 0.9rem;
          background: transparent;
          border: 1.5px solid var(--primary);
          color: var(--primary);
          border-radius: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: var(--transition);
          font-size: 0.9rem;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .resend-btn:hover {
          background: var(--accent-soft);
        }

        .footer {
          margin-top: 1.5rem;
          text-align: center;
          color: rgba(255, 255, 255, 0.8);
          font-size: 0.9rem;
        }

        .footer button {
          background: none;
          border: none;
          color: white;
          cursor: pointer;
          font-weight: 700;
          margin-left: 0.5rem;
          transition: var(--transition);
          text-decoration: underline;
        }

        .footer button:hover {
          color: var(--primary-light);
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
            <h2>Forgot Password?</h2>
            <p>
              {formData.isSubmitted 
                ? "Check your email for reset instructions"
                : "Enter your email address and we'll send you a link to reset your password"
              }
            </p>
          </div>

          {!formData.isSubmitted ? (
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Email Address</label>
                <div className="input-wrapper">
                  <i className="far fa-envelope"></i>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    placeholder="name@university.edu.ph"
                    required
                    disabled={formData.isLoading}
                  />
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
                disabled={formData.isLoading}
              >
                {formData.isLoading ? (
                  <>
                    <div className="spinner"></div>
                    Sending...
                  </>
                ) : (
                  <>
                    <i className="fas fa-paper-plane"></i>
                    Send Reset Link
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
                <h3>Reset Link Sent!</h3>
                <p>
                  We've sent a password reset link to:
                </p>
                <div className="email-display">
                  {formData.email}
                </div>
                <p style={{ color: 'var(--text-soft)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                  Please check your email and follow the instructions to reset your password. 
                  If you don't receive the email within a few minutes, please check your spam folder.
                </p>
              </div>

              <button
                onClick={handleResendEmail}
                disabled={formData.isLoading}
                className="resend-btn"
              >
                {formData.isLoading ? "Resending..." : "Resend Email"}
              </button>
            </div>
          )}

          <div className="footer">
            Remember your password?
            <button onClick={handleBackToLogin}>Sign In</button>
          </div>
        </div>
      </div>
    </>
  );
};

export default ForgotPassword;
