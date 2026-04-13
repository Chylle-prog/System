import React from 'react';
import { useNavigate } from 'react-router-dom';

const Suspended = () => {
  const navigate = useNavigate();

  const handleReturnToLogin = () => {
    localStorage.removeItem('accountSuspended');
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('applicantNo');
    navigate('/login', { replace: true });
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #2b0a12 0%, #5c0f1f 45%, #14060a 100%)',
      padding: '24px'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '640px',
        background: 'rgba(255,255,255,0.08)',
        border: '1px solid rgba(255,255,255,0.18)',
        backdropFilter: 'blur(18px)',
        borderRadius: '28px',
        padding: '40px 32px',
        color: '#fff',
        textAlign: 'center',
        boxShadow: '0 24px 80px rgba(0,0,0,0.35)'
      }}>
        <div style={{
          width: '72px',
          height: '72px',
          margin: '0 auto 20px',
          borderRadius: '20px',
          background: '#dc2626',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '34px',
          fontWeight: 800
        }}>
          !
        </div>
        <h1 style={{ margin: '0 0 14px', fontSize: '38px', fontWeight: 900 }}>Account Suspended</h1>
        <p style={{ margin: '0 auto', maxWidth: '480px', lineHeight: 1.7, color: 'rgba(255,255,255,0.88)' }}>
          Your applicant account has been suspended. You cannot use the scholarship portal while this status is active.
          Please contact the administrator for assistance.
        </p>
        <button
          type="button"
          onClick={handleReturnToLogin}
          style={{
            marginTop: '28px',
            border: 'none',
            borderRadius: '14px',
            background: '#fff',
            color: '#7f1d1d',
            padding: '14px 20px',
            fontWeight: 800,
            cursor: 'pointer'
          }}
        >
          Return To Sign In
        </button>
      </div>
    </div>
  );
};

export default Suspended;