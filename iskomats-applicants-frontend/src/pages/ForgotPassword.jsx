import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authAPI } from '../services/api';
import lipaBg from '../assets/lipa.jpg';
import Navbar from './Navbar';

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
          width: min(95%, 420px);
          background: rgba(255, 255, 255, 0.12);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border-radius: clamp(20px, 4vw, 48px);
          padding: clamp(1.25rem, 4vw, 2.8rem);
          box-shadow: 0 40px 80px rgba(0, 0, 0, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.3);
          transition: var(--transition);
          animation: cardFloat 0.8s ease-out;
          margin: 0 auto;
          box-sizing: border-box;
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
        @keyframes pulseGlow {
          0%, 100% { box-shadow: 0 0 25px rgba(220, 60, 20, 0.3), inset 0 0 15px rgba(255, 255, 255, 0.1); }
          50% { box-shadow: 0 0 45px rgba(255, 100, 50, 0.5), inset 0 0 25px rgba(255, 255, 255, 0.2); }
        }
        @keyframes subtleFloat {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-6px); }
        }
        .auth-wrapper {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem 1rem;
          min-height: calc(100vh - 80px);
        }
        .verify-card {
          width: 100%;
          max-width: 480px;
          background: rgba(26, 12, 10, 0.82);
          backdrop-filter: blur(28px);
          -webkit-backdrop-filter: blur(28px);
          border-radius: 28px;
          border: 1px solid rgba(255, 255, 255, 0.18);
          box-shadow: 0 30px 80px rgba(0, 0, 0, 0.7), 0 0 40px rgba(79, 13, 0, 0.25);
          overflow: hidden;
          position: relative;
          z-index: 10;
          animation: subtleFloat 6s ease-in-out infinite;
          margin: 0 auto;
        }
        .verify-card-header {
          padding: 36px 32px 20px;
          text-align: center;
          position: relative;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        .icon-badge {
          width: 72px;
          height: 72px;
          margin: 0 auto 18px;
          background: linear-gradient(135deg, #6e1302 0%, #3d0a00 100%);
          border-radius: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 30px;
          color: #ffffff;
          border: 1px solid rgba(255, 255, 255, 0.25);
          box-shadow: 0 12px 30px rgba(0, 0, 0, 0.4), inset 0 2px 4px rgba(255, 255, 255, 0.2);
          animation: pulseGlow 3s infinite ease-in-out;
        }
        .verify-title {
          color: #ffffff;
          font-size: 26px;
          font-weight: 800;
          letter-spacing: -0.5px;
          margin: 0 0 8px;
        }
        .verify-subtitle {
          color: rgba(255, 255, 255, 0.75);
          font-size: 14px;
          line-height: 1.5;
          margin: 0;
        }
        .verify-card-body {
          padding: 28px 32px 36px;
        }
        .form-group {
          margin-bottom: 20px;
        }
        .form-group label {
          display: block;
          color: rgba(255, 255, 255, 0.9);
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.5px;
          margin-bottom: 8px;
          text-transform: uppercase;
        }
        .input-wrapper {
          position: relative;
          width: 100%;
          display: flex;
          align-items: center;
        }
        .input-wrapper i {
          position: absolute;
          left: 16px;
          top: 50%;
          transform: translateY(-50%);
          color: rgba(255, 255, 255, 0.6);
          font-size: 16px;
          pointer-events: none;
          z-index: 2;
        }
        .input-wrapper input {
          width: 100%;
          box-sizing: border-box;
          padding: 14px 16px 14px 44px;
          background: rgba(255, 255, 255, 0.08);
          border: 1.5px solid rgba(255, 255, 255, 0.18);
          border-radius: 16px;
          color: #ffffff;
          font-size: 15px;
          font-weight: 500;
          transition: all 0.25s ease;
          outline: none;
        }
        .input-wrapper input:focus {
          background: rgba(255, 255, 255, 0.12);
          border-color: rgba(255, 255, 255, 0.4);
          box-shadow: 0 0 0 4px rgba(220, 60, 20, 0.2);
        }
        .btn-primary-action {
          width: 100%;
          padding: 14px 24px;
          background: linear-gradient(135deg, #7f1d1d 0%, #4c0519 100%);
          color: #ffffff;
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 30px;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.25s ease;
          box-shadow: 0 8px 24px rgba(127, 29, 29, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
        }
        .btn-primary-action:hover {
          transform: translateY(-2px);
          box-shadow: 0 12px 28px rgba(127, 29, 29, 0.6);
        }
        .btn-secondary-action {
          width: 100%;
          padding: 12px 24px;
          background: rgba(255, 255, 255, 0.08);
          color: #ffffff;
          border: 1px solid rgba(255, 255, 255, 0.25);
          border-radius: 30px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.25s ease;
          margin-top: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .btn-secondary-action:hover {
          background: rgba(255, 255, 255, 0.15);
        }
        .alert-error {
          padding: 12px 16px;
          background: rgba(239, 68, 68, 0.15);
          border: 1px solid rgba(239, 68, 68, 0.3);
          border-radius: 14px;
          color: #fca5a5;
          font-size: 13px;
          margin-bottom: 18px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .alert-success {
          padding: 12px 16px;
          background: rgba(16, 185, 129, 0.15);
          border: 1px solid rgba(16, 185, 129, 0.3);
          border-radius: 14px;
          color: #6ee7b7;
          font-size: 13px;
          margin-bottom: 18px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
      `}</style>

      <Navbar />

      <div className="auth-wrapper">
        <div className="verify-card">
          <div className="verify-card-header">
            <div className="icon-badge">
              <i className="fas fa-lock" />
            </div>
            <h2 className="verify-title">Forgot Password?</h2>
            <p className="verify-subtitle">
              {formData.isSubmitted 
                ? "Check your email for password reset instructions."
                : "Enter your registered email address to receive password reset instructions."
              }
            </p>
          </div>

          <div className="verify-card-body">
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
                  <div className="alert-error">
                    <i className="fas fa-exclamation-circle" />
                    <span>{formData.error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  className="btn-primary-action"
                  disabled={formData.isLoading}
                >
                  {formData.isLoading ? (
                    <span>Sending Reset Link...</span>
                  ) : (
                    <>
                      <span>Send Reset Link</span>
                      <i className="fas fa-paper-plane" />
                    </>
                  )}
                </button>

                <button 
                  type="button" 
                  onClick={handleBackToLogin}
                  className="btn-secondary-action"
                >
                  Back to Login
                </button>
              </form>
            ) : (
              <div style={{ textAlign: 'center' }}>
                <div className="alert-success">
                  <i className="fas fa-check-circle" />
                  <span>Password reset email has been sent!</span>
                </div>
                <p style={{ color: 'rgba(255, 255, 255, 0.85)', fontSize: '14px', lineHeight: '1.6', marginBottom: '20px' }}>
                  Please check your inbox at <strong>{formData.email}</strong> for instructions to reset your password.
                </p>
                <button
                  onClick={handleResendEmail}
                  disabled={formData.isLoading}
                  className="btn-primary-action"
                >
                  {formData.isLoading ? "Resending Email..." : "Resend Reset Link"}
                </button>
                <button 
                  type="button" 
                  onClick={handleBackToLogin}
                  className="btn-secondary-action"
                >
                  Back to Login
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default ForgotPassword;
