import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { authAPI, applicantAPI } from '../services/api';

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
  const [verificationState, setVerificationState] = useState("input"); // input, loading, success, error, auto-verifying

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

    // Check if there's a token in the URL (from email link)
    const token = searchParams.get('token');
    if (token) {
      setVerificationState("auto-verifying");
      handleAutoVerification(token);
    }
  }, [searchParams]);

  const handleAutoVerification = async (token) => {
    try {
      await authAPI.verifyEmail(token);
      
      // Try to save pending profile data if it exists
      const pendingProfileData = localStorage.getItem('pendingProfileData');
      if (pendingProfileData) {
        const password = localStorage.getItem('registrationPassword');
        const regEmail = localStorage.getItem('registrationEmail');
        
        try {
          // Login first to get token
          const loginResponse = await authAPI.login(regEmail, password);
          localStorage.setItem('authToken', loginResponse.token);
          localStorage.setItem('applicantNo', loginResponse.applicant_no);
          localStorage.setItem('currentUser', regEmail);
          
          // Update profile
          await applicantAPI.updateProfile(JSON.parse(pendingProfileData));
          localStorage.removeItem('pendingProfileData');
        } catch (profileError) {
          console.warn('Could not save profile after verification:', profileError);
        }
      }
      
      setVerificationState("success");
      setFormData({ ...formData, success: true });
      
      // Redirect to login after 2 seconds
      setTimeout(() => {
        localStorage.removeItem('registrationEmail');
        localStorage.removeItem('registrationPassword');
        navigate('/login');
      }, 2000);
    } catch (error) {
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

    try {
      await authAPI.verifyEmail(formData.verificationCode);
      
      // Try to save pending profile data if it exists
      const pendingProfileData = localStorage.getItem('pendingProfileData');
      if (pendingProfileData) {
        const password = localStorage.getItem('registrationPassword');
        const regEmail = localStorage.getItem('registrationEmail');
        
        try {
          // Login first to get token
          const loginResponse = await authAPI.login(regEmail, password);
          localStorage.setItem('authToken', loginResponse.token);
          localStorage.setItem('applicantNo', loginResponse.applicant_no);
          localStorage.setItem('currentUser', regEmail);
          
          // Update profile
          await applicantAPI.updateProfile(JSON.parse(pendingProfileData));
          localStorage.removeItem('pendingProfileData');
        } catch (profileError) {
          console.warn('Could not save profile after verification:', profileError);
        }
      }
      
      setVerificationState("success");
      setFormData({ ...formData, success: true, isLoading: false });
      
      // Redirect to login after 2 seconds
      setTimeout(() => {
        localStorage.removeItem('registrationEmail');
        localStorage.removeItem('registrationPassword');
        navigate('/login');
      }, 2000);
    } catch (error) {
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

  return (
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
          background: 'linear-gradient(to right, #5c3d2e, #8B4513)',
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
                borderTop: '4px solid #8B4513',
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
                  backgroundColor: '#6f4e37',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease'
                }}
                onMouseEnter={(e) => e.target.style.backgroundColor = '#5c3d2e'}
                onMouseLeave={(e) => e.target.style.backgroundColor = '#6f4e37'}
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
                    color: '#8B4513',
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
                    onFocus={(e) => e.target.style.borderColor = '#8B4513'}
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
                    backgroundColor: formData.isLoading ? '#ccc' : '#8B4513',
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
                    if (!formData.isLoading) e.target.style.backgroundColor = '#6f4e37';
                  }}
                  onMouseLeave={(e) => {
                    if (!formData.isLoading) e.target.style.backgroundColor = '#8B4513';
                  }}
                >
                  {formData.isLoading ? "Verifying..." : "Verify Email"}
                </button>
              </form>

              <div style={{ textAlign: 'center' }}>
                <button
                  onClick={handleBackToLogin}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#8B4513',
                    cursor: 'pointer',
                    fontSize: '14px',
                    textDecoration: 'underline',
                    transition: 'color 0.3s ease'
                  }}
                  onMouseEnter={(e) => e.target.style.color = '#5c3d2e'}
                  onMouseLeave={(e) => e.target.style.color = '#8B4513'}
                >
                  Back to Login
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default VerifyEmail;