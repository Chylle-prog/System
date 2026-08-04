import React from 'react';

const TermsModal = ({ isOpen, onAccept, onReject }) => {
  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      background: 'rgba(15, 23, 42, 0.85)',
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 999999,
      padding: '1.25rem'
    }}>
      <div style={{
        background: '#1e293b',
        color: '#f8fafc',
        borderRadius: '24px',
        maxWidth: '560px',
        width: '100%',
        padding: '2rem',
        boxShadow: '0 25px 60px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.1)',
        position: 'relative',
        animation: 'fadeInUp 0.3s ease-out'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justify: 'space-between',
          alignItems: 'center',
          marginBottom: '1.25rem',
          paddingBottom: '1rem',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #991b1b, #dc2626)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.2rem',
              color: 'white',
              boxShadow: '0 4px 12px rgba(153, 27, 27, 0.3)'
            }}>
              <i className="fas fa-file-contract"></i>
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#ffffff' }}>
                Terms & Conditions
              </h3>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#94a3b8', fontWeight: 500 }}>
                Data Privacy & User Agreement
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onReject}
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: 'none',
              color: '#94a3b8',
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.1rem',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            title="Reject & Close"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* Scrollable Body */}
        <div style={{
          maxHeight: '380px',
          overflowY: 'auto',
          paddingRight: '0.75rem',
          fontSize: '0.88rem',
          lineHeight: '1.65',
          color: '#cbd5e1'
        }}>
          <p style={{ marginTop: 0, marginBottom: '1rem', fontWeight: 500 }}>
            Welcome to <strong>iskoMats</strong>. Before proceeding to log in or apply for scholarships, please review and agree to our Terms and Conditions and consent to personal data processing under the <strong>Data Privacy Act of 2012 (Republic Act No. 10173)</strong>.
          </p>

          <h4 style={{ color: '#f8fafc', margin: '1rem 0 0.25rem 0', fontSize: '0.95rem' }}>1. Purpose of the System</h4>
          <p style={{ margin: 0 }}>
            iskoMats is an official scholarship management system designed to help students discover scholarship opportunities, submit applications, and allow authorized scholarship providers to manage and review applications efficiently.
          </p>

          <h4 style={{ color: '#f8fafc', margin: '1rem 0 0.25rem 0', fontSize: '0.95rem' }}>2. User Eligibility & Authenticity</h4>
          <p style={{ margin: 0 }}>
            You agree that all information and documents you submit are authentic, accurate, complete, and up to date. Submitting false, forged, or digitally altered documents will result in immediate disqualification and account suspension.
          </p>

          <h4 style={{ color: '#f8fafc', margin: '1rem 0 0.25rem 0', fontSize: '0.95rem' }}>3. Data Privacy & Consent</h4>
          <p style={{ margin: '0 0 0.5rem 0' }}>
            By continuing, you voluntarily consent to the collection, processing, verification, and storage of your personal data, including your name, contact details, academic records, and uploaded documents solely for scholarship evaluation purposes.
          </p>

          <h4 style={{ color: '#f8fafc', margin: '1rem 0 0.25rem 0', fontSize: '0.95rem' }}>4. Account Security</h4>
          <p style={{ margin: 0 }}>
            You are responsible for maintaining the confidentiality of your credentials. You agree not to share your account or use another student's identity.
          </p>

          <div style={{ marginTop: '1.25rem', padding: '1rem', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '14px', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
            <h4 style={{ color: '#f8fafc', margin: '0 0 0.35rem 0', fontSize: '0.92rem' }}>Consent Statement</h4>
            <p style={{ margin: 0, fontSize: '0.82rem', color: '#94a3b8', lineHeight: '1.5' }}>
              By clicking <strong>Accept & Continue</strong>, I confirm that I have read, understood, and agree to the Terms & Conditions and Data Privacy Agreement of iskoMats.
            </p>
          </div>
        </div>

        {/* Footer Actions: REJECT & ACCEPT */}
        <div style={{
          marginTop: '1.5rem',
          paddingTop: '1rem',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          justify: 'flex-end',
          gap: '0.85rem'
        }}>
          <button
            type="button"
            onClick={onReject}
            style={{
              background: 'transparent',
              color: '#94a3b8',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '30px',
              padding: '0.65rem 1.4rem',
              fontSize: '0.9rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
          >
            Reject & Return
          </button>
          <button
            type="button"
            onClick={onAccept}
            style={{
              background: 'linear-gradient(135deg, #16a34a, #15803d)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '30px',
              padding: '0.65rem 1.8rem',
              fontSize: '0.9rem',
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(22, 163, 74, 0.35)',
              transition: 'all 0.2s ease'
            }}
          >
            Accept & Continue →
          </button>
        </div>
      </div>
    </div>
  );
};

export default TermsModal;
