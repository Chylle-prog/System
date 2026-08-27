import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { authAPI, applicantAPI } from '../services/api';
import { useAuth } from "../contexts/AuthContext";
import lipaBg from '../assets/lipa.jpg';
import Navbar from './Navbar';

const VerifyEmail = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [formData, setFormData] = useState({
    verificationCode: "",
    error: "",
    success: false,
    isLoading: false,
  });
  const [email, setEmail] = useState("");
  const { setCurrentUserState, fetchProfile } = useAuth();
  const [verificationState, setVerificationState] = useState("input"); // input, loading, success, error, auto-verifying
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState({ title: '', message: '' });

  const handleExpiredSession = () => {
    localStorage.removeItem('registrationEmail');
    localStorage.removeItem('registrationPassword');
  };


  useEffect(() => {
    // Check if there's an email in localStorage (from registration)
    const registrationEmail = localStorage.getItem('registrationEmail') || localStorage.getItem('currentUser');
    if (registrationEmail) {
      setEmail(registrationEmail);
    }

    const fallbackCode = localStorage.getItem('registrationFallbackCode');
    if (fallbackCode) {
      setFormData(prev => ({ ...prev, verificationCode: fallbackCode }));
    }

    // Safety: If the user is already authenticated and has a complete profile,
    // redirect them to the portal.
    const authToken = localStorage.getItem('authToken');
    if (authToken && fetchProfile) {
      fetchProfile(registrationEmail).then(profile => {
        if (profile && profile.town_city_municipality) {
          console.log('[VERIFY] User already verified and has profile, redirecting to portal');
          navigate('/portal');
        }
      });
    }

    // Check if there's a token in the URL (from email link)
    const token = searchParams.get('token');
    if (token) {
      setVerificationState("auto-verifying");
      handleAutoVerification(token);
    }
  }, [searchParams, fetchProfile, navigate]);

  const handleAutoVerification = async (token) => {
    setLoadingMessage({ title: 'Auto-Verifying', message: 'Checking your verification token...' });
    setShowLoadingOverlay(true);
    try {
      const response = await authAPI.verifyEmail(token);
      
      // Update global auth state
      if (response.token) {
        localStorage.setItem('authToken', response.token);
        localStorage.setItem('applicantNo', response.applicant_no || response.user_no);
        
        // Find email from state or storage
        const verifiedEmail = email || localStorage.getItem('registrationEmail');
        if (verifiedEmail) {
          localStorage.setItem('currentUser', verifiedEmail);
          setCurrentUserState(verifiedEmail);
          fetchProfile(verifiedEmail);
        }
      }

      setVerificationState("success");
      setFormData({ ...formData, success: true });
      setShowLoadingOverlay(false);
      
      // Redirect to profile setup after 2 seconds
      setTimeout(() => {
        navigate('/login?setup=true');
      }, 2000);
    } catch (error) {
      if (error?.message === 'This session has expired') {
        handleExpiredSession();
      }
      setShowLoadingOverlay(false);
      setVerificationState("error");
      setFormData({
        ...formData,
        error: error.message || "Verification link is invalid or expired. Please try again.",
      });
    }
  };

  const handleChange = (e) => {
    setFormData({
      ...formData,
      verificationCode: e.target.value.toUpperCase(),
      error: "",
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.verificationCode.trim()) {
      setFormData({
        ...formData,
        error: "Please enter the verification code",
      });
      return;
    }

    setFormData({ ...formData, isLoading: true, error: "" });
    setVerificationState("loading");
    setLoadingMessage({ title: 'Verifying Code', message: 'Authenticating your account...' });
    setShowLoadingOverlay(true);

    try {
      const response = await authAPI.verifyEmail(formData.verificationCode, email);
      
      // Update global auth state
      if (response && response.token) {
        localStorage.setItem('authToken', response.token);
        localStorage.setItem('applicantNo', response.applicant_no || response.user_no || 'APP-2026-001');
      }
      
      const activeEmail = email || localStorage.getItem('registrationEmail') || '';
      if (activeEmail) {
        localStorage.setItem('currentUser', activeEmail);
        if (setCurrentUserState) setCurrentUserState(activeEmail);
        if (fetchProfile) fetchProfile(activeEmail);
      }

      setVerificationState("success");
      setFormData({ ...formData, success: true, isLoading: false });
      setShowLoadingOverlay(false);
      
      // Redirect to profile setup after 1.5 seconds
      setTimeout(() => {
        navigate('/login?setup=true');
      }, 1500);
    } catch (error) {
      if (error?.message === 'This session has expired') {
        handleExpiredSession();
      }
      setShowLoadingOverlay(false);
      setVerificationState("error");
      setFormData({
        ...formData,
        error: error.message || "Invalid verification code. Please try again.",
        isLoading: false,
      });
    }
  };

  const handleBackToLogin = () => {
    localStorage.removeItem('registrationEmail');
    localStorage.removeItem('registrationPassword');
    navigate('/login');
  };

  const handleResendEmail = async () => {
    if (!email) {
      setFormData({
        ...formData,
        error: "Email address is required",
      });
      return;
    }

    setFormData({ ...formData, isLoading: true, error: "" });
    setLoadingMessage({ title: 'Resending Email', message: 'Sending a new verification code...' });
    setShowLoadingOverlay(true);

    try {
      await authAPI.resendVerificationEmail(email);
      setShowLoadingOverlay(false);
      setFormData({
        ...formData,
        isLoading: false,
        success: true,
        error: "",
      });
      // Reset success message after 3 seconds
      setTimeout(() => {
        setFormData((prev) => ({ ...prev, success: false }));
      }, 3000);
    } catch (error) {
      if (error?.message === 'This session has expired') {
        handleExpiredSession();
      }
      setShowLoadingOverlay(false);
      setFormData({
        ...formData,
        isLoading: false,
        error: error.message || "Failed to resend verification email",
      });
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      width: '100%',
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      background: `linear-gradient(135deg, rgba(2, 20, 12, 0.92) 0%, rgba(5, 45, 28, 0.88) 50%, rgba(2, 15, 10, 0.95) 100%), url(${lipaBg}) center/cover no-repeat fixed`,
      fontFamily: "'Plus Jakarta Sans', 'Inter', sans-serif",
      boxSizing: 'border-box',
      overflowX: 'hidden'
    }}>
      <Navbar />
      <style>{`
        @keyframes pulseGlowGreen {
          0%, 100% { box-shadow: 0 0 25px rgba(16, 185, 129, 0.4), inset 0 0 15px rgba(255, 255, 255, 0.2); }
          50% { box-shadow: 0 0 45px rgba(52, 211, 153, 0.7), inset 0 0 25px rgba(255, 255, 255, 0.3); }
        }
        @keyframes subtleFloat {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-6px); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
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
          max-width: 410px;
          background: rgba(4, 28, 18, 0.85);
          backdrop-filter: blur(28px);
          -webkit-backdrop-filter: blur(28px);
          border-radius: 24px;
          border: 1px solid rgba(52, 211, 153, 0.25);
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.7), 0 0 50px rgba(16, 185, 129, 0.35);
          overflow: hidden;
          position: relative;
          z-index: 10;
          animation: subtleFloat 6s ease-in-out infinite;
          transition: all 0.3s ease;
          margin: 0 auto;
        }
        .verify-card-header {
          padding: 24px 24px 16px;
          text-align: center;
          position: relative;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .icon-badge {
          width: 60px;
          height: 60px;
          margin: 0 auto 12px;
          background: linear-gradient(135deg, #059669 0%, #044e3a 100%);
          border-radius: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 26px;
          color: #ffffff;
          border: 1px solid rgba(52, 211, 153, 0.4);
          box-shadow: 0 10px 24px rgba(4, 78, 58, 0.5), inset 0 2px 4px rgba(255, 255, 255, 0.3);
          animation: pulseGlowGreen 3s infinite ease-in-out;
        }
        .verify-title {
          color: #ffffff;
          font-size: 22px;
          font-weight: 800;
          letter-spacing: -0.5px;
          margin: 0 0 6px;
        }
        .verify-subtitle {
          color: rgba(255, 255, 255, 0.75);
          font-size: 13px;
          line-height: 1.45;
          margin: 0;
        }
        .verify-card-body {
          padding: 20px 24px 24px;
        }
        .code-input {
          width: 100%;
          padding: 10px 14px;
          background: rgba(255, 255, 255, 0.08) !important;
          border: 1.5px solid rgba(255, 255, 255, 0.18) !important;
          border-radius: 12px !important;
          color: #ffffff !important;
          font-size: 18px !important;
          font-weight: 700 !important;
          letter-spacing: 4px !important;
          text-align: center !important;
          box-sizing: border-box;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
          outline: none !important;
          box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
        }
        .code-input::placeholder {
          color: rgba(255, 255, 255, 0.3) !important;
          letter-spacing: 2px !important;
          font-weight: 500 !important;
          font-size: 14px !important;
        }
        .code-input:focus {
          background: rgba(255, 255, 255, 0.15) !important;
          border-color: #059669 !important;
          box-shadow: 0 0 20px rgba(52, 211, 153, 0.3), inset 0 2px 4px rgba(0, 0, 0, 0.2) !important;
        }
        .btn-primary-action {
          width: 100%;
          padding: 11px 20px;
          background: linear-gradient(135deg, #059669 0%, #044e3a 100%);
          color: #ffffff;
          border: 1px solid rgba(52, 211, 153, 0.3);
          border-radius: 30px;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.3s ease;
          box-shadow: 0 8px 20px rgba(4, 78, 58, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }
        .btn-primary-action:hover:not(:disabled) {
          background: linear-gradient(135deg, #10b981 0%, #059669 100%);
          transform: translateY(-2px);
          box-shadow: 0 12px 26px rgba(16, 185, 129, 0.5);
        }
        .btn-primary-action:active:not(:disabled) {
          transform: translateY(0);
        }
        .btn-secondary-action {
          width: 100%;
          padding: 9px 16px;
          background: rgba(255, 255, 255, 0.06);
          color: rgba(255, 255, 255, 0.9);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 30px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          margin-bottom: 8px;
        }
        .btn-secondary-action:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.12);
          border-color: rgba(255, 255, 255, 0.4);
          color: #ffffff;
        }
        .btn-link-action {
          background: none;
          border: none;
          color: rgba(255, 255, 255, 0.7);
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          text-decoration: underline;
          transition: color 0.3s ease;
        }
        .btn-link-action:hover {
          color: #ffffff;
        }
        .alert-error {
          background: rgba(220, 38, 38, 0.2);
          border: 1px solid rgba(239, 68, 68, 0.4);
          color: #fca5a5;
          padding: 14px 18px;
          border-radius: 12px;
          margin-bottom: 24px;
          font-size: 14px;
          display: flex;
          align-items: center;
          gap: 12px;
          backdrop-filter: blur(8px);
        }
        .alert-success {
          background: rgba(16, 185, 129, 0.2);
          border: 1px solid rgba(52, 211, 153, 0.4);
          color: #6ee7b7;
          padding: 14px 18px;
          border-radius: 12px;
          margin-bottom: 24px;
          font-size: 14px;
          display: flex;
          align-items: center;
          gap: 12px;
          backdrop-filter: blur(8px);
        }
        .loading-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(10, 2, 1, 0.85);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          display: none;
          justify-content: center;
          align-items: center;
          z-index: 99999;
        }
        .loading-overlay.active {
          display: flex;
        }
        .loading-modal-card {
          background: rgba(30, 14, 12, 0.95);
          border: 1px solid rgba(255, 255, 255, 0.2);
          padding: 40px;
          border-radius: 28px;
          text-align: center;
          box-shadow: 0 30px 70px rgba(0, 0, 0, 0.8);
          max-width: 400px;
          width: 85%;
        }
        .spinner-ring {
          width: 54px;
          height: 54px;
          border: 5px solid rgba(255, 255, 255, 0.1);
          border-top: 5px solid #ff6b4a;
          border-radius: 50%;
          margin: 0 auto 20px;
          animation: spin 0.9s cubic-bezier(0.5, 0.1, 0.5, 0.9) infinite;
        }
      `}</style>

      {/* Main Glassmorphic Card */}
      <div className="auth-wrapper">
        <div className="verify-card">
          {/* Header */}
          <div className="verify-card-header">
            <div className="icon-badge">
              {verificationState === "success" ? (
                <i className="fas fa-check-circle" style={{ color: '#34d399' }} />
              ) : verificationState === "error" ? (
                <i className="fas fa-exclamation-triangle" style={{ color: '#fca5a5' }} />
              ) : (
                <i className="fas fa-envelope-open-text" />
              )}
            </div>

            <h1 className="verify-title">
              {verificationState === "success" ? "Email Verified!" : "Verify Your Email"}
            </h1>
            <p className="verify-subtitle">
              {verificationState === "success" 
                ? "Your account email has been successfully authenticated."
                : email 
                  ? `Enter the verification code sent to ${email}`
                  : "Enter the verification code sent to your registered email address"}
            </p>
          </div>

          {/* Card Body Content */}
          <div className="verify-card-body">
            {/* Auto-verifying State */}
            {verificationState === "auto-verifying" && (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div className="spinner-ring" />
                <p style={{ color: 'rgba(255, 255, 255, 0.85)', fontSize: '15px', fontWeight: '500' }}>
                  Verifying your email token...
                </p>
              </div>
            )}

            {/* Success State */}
            {verificationState === "success" && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ color: 'rgba(255, 255, 255, 0.85)', marginBottom: '28px', fontSize: '15px', lineHeight: '1.6' }}>
                  Your profile setup is ready. You will be redirected to complete your account configuration in a moment.
                </p>
                <button
                  onClick={handleBackToLogin}
                  className="btn-primary-action"
                >
                  <span>Proceed to Login</span>
                  <i className="fas fa-arrow-right" />
                </button>
              </div>
            )}

            {/* Input / Error / Loading States */}
            {(verificationState === "input" || verificationState === "error" || verificationState === "loading") && (
              <>
                {formData.error && (
                  <div className="alert-error">
                    <i className="fas fa-exclamation-circle" style={{ fontSize: '18px' }} />
                    <span>{formData.error}</span>
                  </div>
                )}

                {formData.success && (
                  <div className="alert-success">
                    <i className="fas fa-check-circle" style={{ fontSize: '18px' }} />
                    <span>Verification code has been resent to your email!</span>
                  </div>
                )}

                <form onSubmit={handleSubmit} style={{ marginBottom: '28px' }}>
                  <div style={{ marginBottom: '24px' }}>
                    <label style={{
                      display: 'block',
                      color: 'rgba(255, 255, 255, 0.9)',
                      fontSize: '13px',
                      fontWeight: '700',
                      letterSpacing: '0.5px',
                      marginBottom: '10px',
                      textTransform: 'uppercase'
                    }}>
                      Enter 6–Digit Verification Code
                    </label>
                    <input
                      type="text"
                      maxLength="6"
                      value={formData.verificationCode}
                      onChange={(e) => setFormData({ ...formData, verificationCode: e.target.value.replace(/[^0-9]/g, '') })}
                      placeholder="E.G. 123456"
                      className="code-input"
                      disabled={formData.isLoading}
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    className="btn-primary-action"
                    disabled={formData.isLoading}
                  >
                    {formData.isLoading ? (
                      <span>Verifying...</span>
                    ) : (
                      <>
                        <span>Verify Code</span>
                        <i className="fas fa-shield-alt" />
                      </>
                    )}
                  </button>
                </form>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <button
                    type="button"
                    onClick={handleResendEmail}
                    className="btn-secondary-action"
                    disabled={formData.isLoading}
                  >
                    {formData.isLoading ? "Sending..." : "Resend Verification Code"}
                  </button>

                  <button
                    onClick={handleBackToLogin}
                    className="btn-link-action"
                  >
                    Back to Login
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Loading Modal Overlay */}
      <div className={`loading-overlay ${showLoadingOverlay ? 'active' : ''}`}>
        <div className="loading-modal-card">
          <div className="spinner-ring" />
          <h3 style={{ color: '#ffffff', fontWeight: '800', fontSize: '1.4rem', marginBottom: '8px' }}>
            {loadingMessage.title}
          </h3>
          <p style={{ color: 'rgba(255, 255, 255, 0.75)', fontSize: '0.95rem', margin: 0 }}>
            {loadingMessage.message}
          </p>
        </div>
      </div>
    </div>
  );
};

export default VerifyEmail;