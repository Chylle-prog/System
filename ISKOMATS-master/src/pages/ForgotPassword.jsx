import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { authAPI } from '../services/api';

const ForgotPassword = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    email: "",
    isLoading: false,
    error: "",
    success: false,
    isSubmitted: false
  });

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

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
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
        error: error.message || 'Failed to send reset email',
      }));
    }
  };

  const handleResendEmail = () => {
    handleSubmit();
  };

  return (
    <div className="forgot-password-container">
      <style>{`
        .forgot-password-container {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          background: linear-gradient(135deg, #2c0800 0%, #4F0D00 50%, #7b2f1a 100%);
          font-family: 'Inter', sans-serif;
          position: relative;
          overflow: hidden;
        }

        .forgot-password-container::before {
          content: '';
          position: absolute;
          inset: 0;
          opacity: 0.1;
          pointer-events: none;
          background-image: 
            linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), 
            linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px);
          background-size: 50px 50px;
        }

        .forgot-pass-card {
          position: relative;
          width: 100%;
          max-width: 450px;
          background: rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-radius: 24px;
          padding: 40px;
          border: 1px solid rgba(255, 255, 255, 0.2);
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          animation: fadeIn 0.6s ease-out;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .header {
          text-align: center;
          margin-bottom: 30px;
        }

        .icon-circle {
          width: 70px;
          height: 70px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 20px;
          color: #ffb6a0;
          font-size: 30px;
        }

        .header h1 {
          color: white;
          font-size: 28px;
          font-weight: 800;
          margin-bottom: 10px;
          letter-spacing: -0.02em;
        }

        .header p {
          color: rgba(255, 255, 255, 0.7);
          font-size: 15px;
          line-height: 1.5;
        }

        .form-group {
          margin-bottom: 25px;
        }

        .form-group label {
          display: block;
          color: rgba(255, 255, 255, 0.9);
          font-weight: 600;
          font-size: 14px;
          margin-bottom: 8px;
        }

        .input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .input-wrapper i {
          position: absolute;
          left: 15px;
          color: #ffb6a0;
          font-size: 16px;
        }

        .input-wrapper input {
          width: 100%;
          padding: 12px 15px 12px 45px;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 12px;
          color: white;
          font-size: 16px;
          transition: all 0.3s;
        }

        .input-wrapper input:focus {
          outline: none;
          background: rgba(255, 255, 255, 0.15);
          border-color: white;
        }

        .error-box {
          background: rgba(239, 68, 68, 0.2);
          border: 1px solid rgba(239, 68, 68, 0.4);
          border-radius: 12px;
          padding: 12px;
          margin-bottom: 20px;
          color: #fecaca;
          font-size: 14px;
          text-align: center;
        }

        .submit-btn {
          width: 100%;
          padding: 14px;
          background: linear-gradient(135deg, #7b2f1a 0%, #4F0D00 100%);
          color: white;
          border: none;
          border-radius: 12px;
          font-weight: 700;
          font-size: 16px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          transition: all 0.3s;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
        }

        .submit-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.4);
          filter: brightness(1.1);
        }

        .submit-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .success-content {
          text-align: center;
          animation: fadeIn 0.6s ease-out;
        }

        .success-icon {
          color: #4ade80;
          font-size: 50px;
          margin-bottom: 20px;
        }

        .email-display {
          background: rgba(255, 255, 255, 0.1);
          padding: 12px;
          border-radius: 12px;
          margin: 20px 0;
          color: white;
          font-weight: 600;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .resend-btn {
          background: transparent;
          border: 1px solid rgba(255, 255, 255, 0.3);
          color: white;
          padding: 10px 20px;
          border-radius: 10px;
          font-weight: 600;
          cursor: pointer;
          transition: 0.3s;
          margin-top: 10px;
        }

        .resend-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          border-color: white;
        }

        .footer {
          margin-top: 30px;
          text-align: center;
          color: rgba(255, 255, 255, 0.6);
          font-size: 14px;
        }

        .footer a {
          color: #ffb6a0;
          text-decoration: none;
          font-weight: 700;
          margin-left: 5px;
        }

        .footer a:hover {
          color: white;
        }

        .spinner {
          width: 20px;
          height: 20px;
          border: 3px solid rgba(255, 255, 255, 0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div className="forgot-pass-card">
        <div className="header">
          <div className="icon-circle">
            <i className="fas fa-envelope"></i>
          </div>
          <h1>Forgot Password?</h1>
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
                <i className="fas fa-envelope"></i>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="Enter your registered email"
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
          <div className="success-content">
            <i className="fas fa-check-circle success-icon"></i>
            <h3 style={{ color: 'white', marginBottom: '10px' }}>Reset Link Sent!</h3>
            <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '14px' }}>
              We've sent a password reset link to:
            </p>
            <div className="email-display">
              {formData.email}
            </div>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px', marginBottom: '20px' }}>
              Wait a few minutes and check your inbox (including spam).
            </p>
            
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
          <Link to="/login">Sign In</Link>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
