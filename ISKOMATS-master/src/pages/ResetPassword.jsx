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

  const validatePassword = (password) => {
    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    return {
      isValid: password.length >= minLength && hasUpperCase && hasLowerCase && hasNumbers && hasSpecialChar,
      errors: {
        length: password.length >= minLength,
        uppercase: hasUpperCase,
        lowercase: hasLowerCase,
        numbers: hasNumbers,
        special: hasSpecialChar
      }
    };
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

    const passwordValidation = validatePassword(formData.newPassword);
    if (!passwordValidation.isValid) {
      setFormData({
        ...formData,
        error: "Password does not meet requirements",
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

  const passwordValidation = validatePassword(formData.newPassword);

  return (
    <div className="reset-password-container">
      <style>{`
        .reset-password-container {
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

        .reset-password-container::before {
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

        .reset-pass-card {
          position: relative;
          width: 100%;
          max-width: 480px;
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
          margin-bottom: 25px;
        }

        .icon-circle {
          width: 60px;
          height: 60px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 15px;
          color: #ffb6a0;
          font-size: 24px;
        }

        .header h1 {
          color: white;
          font-size: 26px;
          font-weight: 800;
          margin-bottom: 8px;
        }

        .header p {
          color: rgba(255, 255, 255, 0.7);
          font-size: 14px;
        }

        .form-group {
          margin-bottom: 20px;
        }

        .form-group label {
          display: block;
          color: rgba(255, 255, 255, 0.9);
          font-weight: 600;
          font-size: 13px;
          margin-bottom: 6px;
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
          font-size: 15px;
        }

        .input-wrapper input {
          width: 100%;
          padding: 12px 45px 12px 45px;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 12px;
          color: white;
          font-size: 15px;
          transition: all 0.3s;
        }

        .input-wrapper input:focus {
          outline: none;
          background: rgba(255, 255, 255, 0.15);
          border-color: white;
        }

        .toggle-btn {
          position: absolute;
          right: 15px;
          background: none;
          border: none;
          color: #ffb6a0;
          cursor: pointer;
          font-size: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .requirements {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 12px;
          padding: 15px;
          margin-bottom: 20px;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .requirement-item {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 12px;
          margin-bottom: 6px;
          color: rgba(255, 255, 255, 0.5);
          transition: all 0.3s;
        }

        .requirement-item.met {
          color: #4ade80;
        }

        .requirement-item i {
          font-size: 10px;
          width: 16px;
          height: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.1);
        }

        .requirement-item.met i {
          background: rgba(74, 222, 128, 0.2);
        }

        .error-box {
          background: rgba(239, 68, 68, 0.2);
          border: 1px solid rgba(239, 68, 68, 0.4);
          border-radius: 12px;
          padding: 10px;
          margin-bottom: 20px;
          color: #fecaca;
          font-size: 13px;
          text-align: center;
        }

        .submit-btn {
          width: 100%;
          padding: 12px;
          background: linear-gradient(135deg, #7b2f1a 0%, #4F0D00 100%);
          color: white;
          border: none;
          border-radius: 12px;
          font-weight: 700;
          font-size: 15px;
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
          filter: brightness(1.1);
        }

        .submit-btn:disabled {
          opacity: 0.5;
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

        @keyframes spin { to { transform: rotate(360deg); } }

        .success-content {
          text-align: center;
          animation: fadeIn 0.6s ease-out;
        }

        .success-icon {
          color: #4ade80;
          font-size: 50px;
          margin-bottom: 20px;
        }

        .continue-btn {
          width: 100%;
          padding: 12px;
          background: white;
          color: #4F0D00;
          border: none;
          border-radius: 12px;
          font-weight: 700;
          font-size: 15px;
          cursor: pointer;
          transition: all 0.3s;
        }

        .continue-btn:hover { background: #fecaca; }

        .back-to-login {
          margin-top: 25px;
          text-align: center;
          color: rgba(255, 255, 255, 0.6);
          font-size: 13px;
        }

        .back-to-login Link {
          color: #ffb6a0;
          text-decoration: none;
          font-weight: 700;
        }
      `}</style>

      <div className="reset-pass-card">
        <div className="header">
          <div className="icon-circle">
            <i className="fas fa-shield-alt"></i>
          </div>
          <h1>Reset Password</h1>
          <p>
            {formData.success 
              ? "Password successfully updated!"
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

            <div className="requirements">
              <div className={`requirement-item ${passwordValidation.errors.length ? 'met' : ''}`}>
                <i className="fas fa-check"></i> At least 8 characters
              </div>
              <div className={`requirement-item ${passwordValidation.errors.uppercase ? 'met' : ''}`}>
                <i className="fas fa-check"></i> One uppercase letter
              </div>
              <div className={`requirement-item ${passwordValidation.errors.lowercase ? 'met' : ''}`}>
                <i className="fas fa-check"></i> One lowercase letter
              </div>
              <div className={`requirement-item ${passwordValidation.errors.numbers ? 'met' : ''}`}>
                <i className="fas fa-check"></i> One number
              </div>
              <div className={`requirement-item ${passwordValidation.errors.special ? 'met' : ''}`}>
                <i className="fas fa-check"></i> One special character
              </div>
            </div>

            {formData.error && (
              <div className="error-box">{formData.error}</div>
            )}

            <button
              type="submit"
              className="submit-btn"
              disabled={formData.isLoading || !passwordValidation.isValid || !token}
            >
              {formData.isLoading ? (
                <>
                  <div className="spinner"></div>
                  Resetting...
                </>
              ) : (
                <>
                  <i className="fas fa-shield-alt"></i>
                  Update Password
                </>
              )}
            </button>
          </form>
        ) : (
          <div className="success-content">
            <i className="fas fa-check-circle success-icon"></i>
            <h3 style={{ color: 'white', marginBottom: '15px' }}>Done!</h3>
            <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '14px', marginBottom: '30px' }}>
              Your password has been successfully reset. You can now use your new password to sign in.
            </p>
            <button
              onClick={() => navigate('/login')}
              className="continue-btn"
            >
              Continue to Login
            </button>
          </div>
        )}

        {!formData.success && (
          <div className="back-to-login">
            <Link to="/login" style={{ color: '#ffb6a0', textDecoration: 'none', fontWeight: 700 }}>
              <i className="fas fa-arrow-left" style={{ marginRight: '8px' }}></i>
              Back to Login
            </Link>
          </div>
        )}
      </div>
    </div>
  );
};

export default ResetPassword;
