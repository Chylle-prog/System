import React from 'react';

const TermsModal = ({ isOpen, onAccept, onReject }) => {
  if (!isOpen) return null;

  return (
    <div 
      className="terms-modal-overlay"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        background: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 999999,
        padding: '1rem',
        boxSizing: 'border-box'
      }}
    >
      <style>{`
        .terms-modal-footer {
          margin-top: 1.25rem;
          padding-top: 1rem;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          display: flex;
          flex-direction: row;
          justify-content: flex-end;
          align-items: center;
          gap: 0.85rem;
          width: 100%;
          box-sizing: border-box;
        }

        .terms-btn-secondary {
          background: transparent;
          color: #cbd5e1;
          border: 1px solid rgba(255, 255, 255, 0.25);
          border-radius: 30px;
          padding: 0.65rem 1.4rem;
          font-size: 0.9rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          text-align: center;
        }

        .terms-btn-secondary:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #ffffff;
          border-color: rgba(255, 255, 255, 0.4);
        }

        .terms-btn-primary {
          background: linear-gradient(135deg, #16a34a, #15803d);
          color: #ffffff;
          border: none;
          border-radius: 30px;
          padding: 0.65rem 1.8rem;
          font-size: 0.9rem;
          font-weight: 700;
          cursor: pointer;
          box-shadow: 0 4px 16px rgba(22, 163, 74, 0.4);
          transition: all 0.2s ease;
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          text-align: center;
        }

        .terms-btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(22, 163, 74, 0.55);
        }

        .terms-list {
          margin: 0.5rem 0 0.75rem 1.25rem;
          padding: 0;
          list-style-type: disc;
        }

        .terms-list li {
          margin-bottom: 0.25rem;
          color: #cbd5e1;
        }

        @media (max-width: 480px) {
          .terms-modal-footer {
            flex-direction: column-reverse;
            gap: 0.65rem;
          }

          .terms-btn-secondary,
          .terms-btn-primary {
            width: 100%;
            padding: 0.75rem 1rem;
            white-space: normal;
          }
        }
      `}</style>

      <div 
        className="terms-modal-card"
        style={{
          background: '#1e293b',
          color: '#f8fafc',
          borderRadius: '24px',
          maxWidth: '580px',
          width: '100%',
          maxHeight: 'calc(100vh - 2rem)',
          display: 'flex',
          flexDirection: 'column',
          padding: 'clamp(1.25rem, 4vw, 2rem)',
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.1)',
          position: 'relative',
          animation: 'fadeInUp 0.3s ease-out',
          boxSizing: 'border-box'
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1.25rem',
          paddingBottom: '1rem',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          width: '100%'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              width: '42px',
              height: '42px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #991b1b, #dc2626)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.2rem',
              color: 'white',
              boxShadow: '0 4px 14px rgba(153, 27, 27, 0.4)',
              flexShrink: 0
            }}>
              <i className="fas fa-file-contract"></i>
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 'clamp(1.05rem, 3.5vw, 1.25rem)', fontWeight: 800, color: '#ffffff', lineHeight: 1.2 }}>
                Terms & Conditions
              </h3>
              <p style={{ margin: '0.2rem 0 0 0', fontSize: 'clamp(0.72rem, 2.5vw, 0.82rem)', color: '#94a3b8', fontWeight: 500 }}>
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
              transition: 'all 0.2s ease',
              flexShrink: 0,
              marginLeft: '0.5rem'
            }}
            title="Reject & Close"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.18)';
              e.currentTarget.style.color = '#ffffff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
              e.currentTarget.style.color = '#94a3b8';
            }}
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* Scrollable Body */}
        <div style={{
          flex: '1 1 auto',
          overflowY: 'auto',
          paddingRight: '0.5rem',
          fontSize: 'clamp(0.85rem, 2.5vw, 0.9rem)',
          lineHeight: '1.65',
          color: '#cbd5e1'
        }}>
          <p style={{ marginTop: 0, marginBottom: '1rem', fontWeight: 500 }}>
            Welcome to <strong style={{ color: '#ffffff' }}>iskoMats</strong>. Before proceeding to log in or apply for scholarships, please review and agree to our Terms and Conditions.
          </p>

          {/* Section 1 */}
          <h4 style={{ color: '#f8fafc', margin: '1.1rem 0 0.3rem 0', fontSize: '0.95rem', fontWeight: 700 }}>1. Purpose of the System</h4>
          <p style={{ margin: 0 }}>
            iskoMats is a scholarship management system designed to help students discover scholarship opportunities, submit applications, and allow scholarship providers to manage and review applications efficiently.
          </p>

          {/* Section 2 */}
          <h4 style={{ color: '#f8fafc', margin: '1.1rem 0 0.3rem 0', fontSize: '0.95rem', fontWeight: 700 }}>2. Eligibility</h4>
          <p style={{ margin: 0 }}>
            You agree that you are eligible to use the system and that all information you provide is accurate, complete, and up to date.
          </p>

          {/* Section 3 */}
          <h4 style={{ color: '#f8fafc', margin: '1.1rem 0 0.3rem 0', fontSize: '0.95rem', fontWeight: 700 }}>3. User Account</h4>
          <p style={{ margin: 0 }}>
            You are responsible for maintaining the confidentiality of your account credentials. Any activity conducted using your account is your responsibility.
          </p>

          {/* Section 4 */}
          <h4 style={{ color: '#f8fafc', margin: '1.1rem 0 0.3rem 0', fontSize: '0.95rem', fontWeight: 700 }}>4. Submission of Information and Documents</h4>
          <p style={{ margin: 0 }}>
            You agree to submit only authentic, complete, and unaltered information and documents. Providing false, misleading, or fraudulent information may result in the rejection of your application or suspension of your account.
          </p>

          {/* Section 5 */}
          <h4 style={{ color: '#f8fafc', margin: '1.1rem 0 0.3rem 0', fontSize: '0.95rem', fontWeight: 700 }}>5. Data Privacy</h4>
          <p style={{ margin: '0 0 0.4rem 0' }}>
            By using iskoMats, you voluntarily consent to the collection, use, storage, and processing of your personal information, including but not limited to:
          </p>
          <ul className="terms-list">
            <li>Full name</li>
            <li>Email address</li>
            <li>Student information</li>
            <li>Scholarship application details</li>
            <li>Uploaded documents</li>
            <li>Information required for scholarship verification</li>
          </ul>
          <p style={{ margin: '0.6rem 0 0.4rem 0' }}>
            Your personal information will be used only for:
          </p>
          <ul className="terms-list">
            <li>Account registration and authentication</li>
            <li>Scholarship application processing</li>
            <li>Eligibility verification</li>
            <li>Communication regarding your application</li>
            <li>System administration and maintenance</li>
          </ul>
          <p style={{ margin: '0.6rem 0 0 0' }}>
            Your personal information will only be accessed by authorized scholarship administrators and system administrators when necessary for scholarship-related purposes and as permitted by law.
          </p>

          {/* Section 6 */}
          <h4 style={{ color: '#f8fafc', margin: '1.1rem 0 0.3rem 0', fontSize: '0.95rem', fontWeight: 700 }}>6. User Responsibilities</h4>
          <p style={{ margin: '0 0 0.4rem 0' }}>
            You agree not to:
          </p>
          <ul className="terms-list">
            <li>Use another person's identity or documents.</li>
            <li>Share your account credentials with others.</li>
            <li>Attempt to gain unauthorized access to the system.</li>
            <li>Upload malicious files or harmful content.</li>
            <li>Use the system for unlawful purposes.</li>
          </ul>

          {/* Section 7 */}
          <h4 style={{ color: '#f8fafc', margin: '1.1rem 0 0.3rem 0', fontSize: '0.95rem', fontWeight: 700 }}>7. Scholarship Decisions</h4>
          <p style={{ margin: 0 }}>
            iskoMats serves only as a platform for scholarship application and management. The final approval, rejection, or selection of scholarship applicants remains solely with the scholarship provider.
          </p>

          {/* Section 8 */}
          <h4 style={{ color: '#f8fafc', margin: '1.1rem 0 0.3rem 0', fontSize: '0.95rem', fontWeight: 700 }}>8. Changes to the Terms</h4>
          <p style={{ margin: 0 }}>
            iskoMats reserves the right to update or modify these Terms and Conditions at any time. Continued use of the system after any changes constitutes your acceptance of the revised terms.
          </p>

          {/* Section 9 */}
          <h4 style={{ color: '#f8fafc', margin: '1.1rem 0 0.3rem 0', fontSize: '0.95rem', fontWeight: 700 }}>9. Contact</h4>
          <p style={{ margin: 0 }}>
            If you have questions regarding these Terms and Conditions or your personal data, please contact the iskoMats administrator.
          </p>

          <div style={{ 
            marginTop: '1.25rem', 
            padding: '1rem', 
            background: 'rgba(255, 255, 255, 0.05)', 
            borderRadius: '14px', 
            border: '1px solid rgba(255, 255, 255, 0.1)' 
          }}>
            <h4 style={{ color: '#f8fafc', margin: '0 0 0.35rem 0', fontSize: '0.92rem', fontWeight: 700 }}>Consent Statement</h4>
            <p style={{ margin: 0, fontSize: '0.82rem', color: '#94a3b8', lineHeight: '1.5' }}>
              By clicking <strong style={{ color: '#ffffff' }}>Accept & Continue</strong>, I confirm that I have read, understood, and agree to the Terms & Conditions and Data Privacy Agreement of iskoMats.
            </p>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="terms-modal-footer">
          <button
            type="button"
            className="terms-btn-secondary"
            onClick={onReject}
          >
            Reject & Return
          </button>
          <button
            type="button"
            className="terms-btn-primary"
            onClick={onAccept}
          >
            Accept & Continue →
          </button>
        </div>
      </div>
    </div>
  );
};

export default TermsModal;
