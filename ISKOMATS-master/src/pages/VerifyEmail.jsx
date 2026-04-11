import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { authAPI, applicantAPI } from '../services/api';
import { useAuth } from "../contexts/AuthContext";

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

  useEffect(() => {
    // Check if there's an email in localStorage (from registration)
    const registrationEmail = localStorage.getItem('registrationEmail') || localStorage.getItem('currentUser');
    if (registrationEmail) {
      setEmail(registrationEmail);
    }

    // Safety: If the user is already authenticated and has a complete profile,
    // they shouldn't be here. Redirect them to the portal.
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
      if (response.token) {
        localStorage.setItem('authToken', response.token);
        localStorage.setItem('applicantNo', response.applicant_no || response.user_no);
        
        if (email) {
          localStorage.setItem('currentUser', email);
          setCurrentUserState(email);
          fetchProfile(email);
        }
      }

      setVerificationState("success");
      setFormData({ ...formData, success: true, isLoading: false });
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
    <>
      <style>{`
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
          border-top: 6px solid #4F0D00;
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
      `}</style>

      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f5f5f5',
        padding: '20px',
        fontFamily: 'Inter, sans-serif'
      }}>
      <div style={{
        width: '100%',
        maxWidth: '500px',
        backgroundColor: 'white',
        borderRadius: '12px',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          background: '#4F0D00',
          padding: '40px 30px',
          textAlign: 'center',
          color: 'white'
        }}>
          <div style={{
            width: '60px',
            height: '60px',
            backgroundColor: 'rgba(255, 255, 255, 0.2)',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
            fontSize: '28px'
          }}>
            {verificationState === "success" ? "✓" : verificationState === "error" ? "⚠" : "✉"}
          </div>

          <h1 style={{
            fontSize: '28px',
            fontWeight: 'bold',
            margin: '0 0 10px'
          }}>
            {verificationState === "success" ? "Email Verified!" : "Verify Your Email"}
          </h1>
          <p style={{
            fontSize: '14px',
            opacity: 0.9,
            margin: 0
          }}>
            {verificationState === "success" 
              ? "Your email has been verified successfully."
              : "Enter the verification code sent to your email"}
          </p>
        </div>

        {/* Content */}
        <div style={{ padding: '40px 30px' }}>
          {verificationState === "auto-verifying" && (
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: '40px',
                height: '40px',
                border: '4px solid #ddd',
                borderTop: '4px solid #4F0D00',
                borderRadius: '50%',
                margin: '0 auto 20px',
                animation: 'spin 1s linear infinite'
              }} />
              <p style={{ color: '#666' }}>Verifying your email...</p>
              <style>{`
                @keyframes spin {
                  to { transform: rotate(360deg); }
                }
              `}</style>
            </div>
          )}

          {verificationState === "success" && (
            <div style={{ textAlign: 'center' }}>
              <p style={{
                color: '#666',
                marginBottom: '30px',
                fontSize: '14px'
              }}>
                Your profile has been saved and you will be redirected to login in a few seconds...
              </p>
              <button
                onClick={handleBackToLogin}
                style={{
                  width: '100%',
                  padding: '12px 20px',
                  backgroundColor: '#4F0D00',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease'
                }}
                onMouseEnter={(e) => e.target.style.backgroundColor = '#3d0a00'}
                onMouseLeave={(e) => e.target.style.backgroundColor = '#4F0D00'}
              >
                Go to Login
              </button>
            </div>
          )}

          {(verificationState === "input" || verificationState === "error") && (
            <>
              {formData.error && (
                <div style={{
                  backgroundColor: '#fee',
                  color: '#c33',
                  padding: '12px',
                  borderRadius: '6px',
                  marginBottom: '20px',
                  fontSize: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}>
                  <span>⚠</span>
                  {formData.error}
                </div>
              )}

              <form onSubmit={handleSubmit} style={{ marginBottom: '30px' }}>
                <div style={{ marginBottom: '20px' }}>
                  <label style={{
                    display: 'block',
                    color: '#4F0D00',
                    fontSize: '14px',
                    fontWeight: '600',
                    marginBottom: '8px'
                  }}>
                    Verification Code
                  </label>
                  <input
                    type="text"
                    value={formData.verificationCode}
                    onChange={handleChange}
                    placeholder="Enter 6-digit code or token"
                    maxLength="50"
                    required
                    style={{
                      width: '100%',
                      padding: '12px 15px',
                      border: '2px solid #ddd',
                      borderRadius: '6px',
                      fontSize: '16px',
                      letterSpacing: '2px',
                      textAlign: 'center',
                      boxSizing: 'border-box',
                      transition: 'border-color 0.3s ease',
                      fontFamily: 'monospace'
                    }}
                    onFocus={(e) => e.target.style.borderColor = '#4F0D00'}
                    onBlur={(e) => e.target.style.borderColor = '#ddd'}
                  />
                  <p style={{
                    color: '#999',
                    fontSize: '12px',
                    marginTop: '8px',
                    margin: '8px 0 0'
                  }}>
                    Check your email for the verification code
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={formData.isLoading}
                  style={{
                    width: '100%',
                    padding: '12px 20px',
                    backgroundColor: formData.isLoading ? '#ccc' : '#4F0D00',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '16px',
                    fontWeight: 'bold',
                    cursor: formData.isLoading ? 'not-allowed' : 'pointer',
                    transition: 'all 0.3s ease',
                    opacity: formData.isLoading ? 0.6 : 1
                  }}
                  onMouseEnter={(e) => {
                    if (!formData.isLoading) e.target.style.backgroundColor = '#3d0a00';
                  }}
                  onMouseLeave={(e) => {
                    if (!formData.isLoading) e.target.style.backgroundColor = '#4F0D00';
                  }}
                >
                  {formData.isLoading ? "Verifying..." : "Verify Email"}
                </button>
              </form>

              {formData.success && (
                <div style={{
                  backgroundColor: '#ecfdf5',
                  color: '#047857',
                  padding: '12px',
                  borderRadius: '6px',
                  marginBottom: '20px',
                  fontSize: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}>
                  <span>✓</span>
                  Verification email has been resent to {email}
                </div>
              )}

              <div style={{ textAlign: 'center' }}>
                <button
                  type="button"
                  onClick={handleResendEmail}
                  disabled={formData.isLoading}
                  style={{
                    width: '100%',
                    padding: '12px 20px',
                    backgroundColor: 'transparent',
                    color: '#4F0D00',
                    border: '2px solid #4F0D00',
                    borderRadius: '6px',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    cursor: formData.isLoading ? 'not-allowed' : 'pointer',
                    transition: 'all 0.3s ease',
                    marginBottom: '15px',
                    opacity: formData.isLoading ? 0.6 : 1
                  }}
                  onMouseEnter={(e) => {
                    if (!formData.isLoading) {
                      e.target.style.backgroundColor = '#fff1ec';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!formData.isLoading) {
                      e.target.style.backgroundColor = 'transparent';
                    }
                  }}
                >
                  {formData.isLoading ? "Sending..." : "Resend Verification Email"}
                </button>
              </div>

              <div style={{ textAlign: 'center' }}>
                <button
                  onClick={handleBackToLogin}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#4F0D00',
                    cursor: 'pointer',
                    fontSize: '14px',
                    textDecoration: 'underline',
                    transition: 'color 0.3s ease'
                  }}
                  onMouseEnter={(e) => e.target.style.color = '#3d0a00'}
                  onMouseLeave={(e) => e.target.style.color = '#4F0D00'}
                >
                  Back to Login
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>

      {/* Loading overlay */}
      <div className={`loading-overlay ${showLoadingOverlay ? 'active' : ''}`}>
        <div className="loading-modal">
          <div className="loading-spinner"></div>
          <h3 style={{ color: '#4F0D00', fontWeight: '800', fontSize: '1.8rem', marginBottom: '0.8rem' }}>
            {loadingMessage.title}
          </h3>
          <p style={{ color: '#666', fontSize: '1rem' }}>
            {loadingMessage.message}
          </p>
        </div>
      </div>
    </>
  );
};

export default VerifyEmail;