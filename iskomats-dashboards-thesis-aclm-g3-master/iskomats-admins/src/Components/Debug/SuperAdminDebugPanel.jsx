import React, { useState, useRef } from 'react';
import { FaBug, FaCog, FaTrash, FaTimes, FaCheckCircle, FaExclamationCircle } from 'react-icons/fa';
import { adminAPI } from '../../services/api';

export default function SuperAdminDebugPanel() {
  const [showDebugMenu, setShowDebugMenu] = useState(false);
  const [email, setEmail] = useState('mikayla0888@gmail.com');
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [status, setStatus] = useState(null);
  const inputRef = useRef(null);

  const handleToggleEdit = () => {
    setIsEditing((prev) => {
      const nextState = !prev;
      if (nextState) {
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
          }
        }, 50);
      }
      return nextState;
    });
  };

  const handleDeleteApplicant = async () => {
    if (!email || !email.trim()) {
      setStatus({ type: 'error', message: 'Please enter a valid email address.' });
      return;
    }

    const trimmedEmail = email.trim();
    const confirmDelete = window.confirm(
      `Are you sure you want to delete the applicant tied to "${trimmedEmail}" from the applicants table?`
    );
    if (!confirmDelete) return;

    setIsDeleting(true);
    setStatus(null);

    try {
      const response = await adminAPI.deleteApplicantByEmail(trimmedEmail);
      if (response.data && response.data.success) {
        setStatus({
          type: 'success',
          message: response.data.message || `Applicant tied to ${trimmedEmail} deleted successfully.`
        });
      } else {
        setStatus({
          type: 'error',
          message: response.data?.message || 'Failed to delete applicant.'
        });
      }
    } catch (err) {
      console.error('[SUPER ADMIN DEBUG DELETE ERROR]', err);
      const errMsg = err.response?.data?.message || err.message || 'An error occurred during deletion.';
      setStatus({ type: 'error', message: errMsg });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      zIndex: 9999,
    }}>
      {!showDebugMenu ? (
        <button
          type="button"
          onClick={() => setShowDebugMenu(true)}
          style={{
            background: '#1e293b',
            color: '#38bdf8',
            border: '1px solid #334155',
            padding: '8px 14px',
            borderRadius: '20px',
            boxShadow: '0 8px 20px rgba(0,0,0,0.3)',
            fontSize: '0.75rem',
            fontWeight: '800',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'all 0.2s ease'
          }}
        >
          <FaBug />
          Debug Options
        </button>
      ) : (
        <div style={{
          background: '#1e293b',
          color: '#fff',
          padding: '14px 16px',
          borderRadius: '18px',
          boxShadow: '0 10px 25px rgba(0,0,0,0.35)',
          fontSize: '0.75rem',
          fontWeight: 'bold',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          border: '1px solid #334155',
          minWidth: '280px',
          maxWidth: '340px',
          animation: 'fadeIn 0.2s ease'
        }}>
          {/* Header */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid #334155',
            paddingBottom: '8px'
          }}>
            <span style={{
              color: '#38bdf8',
              fontSize: '0.8rem',
              fontWeight: '800',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <FaBug /> Debug Options
            </span>
            <button
              type="button"
              onClick={() => setShowDebugMenu(false)}
              style={{
                background: 'transparent',
                color: '#94a3b8',
                border: 'none',
                fontSize: '0.9rem',
                cursor: 'pointer',
                padding: '2px 6px',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              <FaTimes />
            </button>
          </div>

          {/* Email Input */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ color: '#94a3b8', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Target Applicant Email
            </label>
            <input
              ref={inputRef}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              readOnly={!isEditing}
              style={{
                background: isEditing ? '#0f172a' : '#1e293b',
                color: isEditing ? '#ffffff' : '#cbd5e1',
                border: isEditing ? '1px solid #38bdf8' : '1px solid #334155',
                borderRadius: '8px',
                padding: '8px 10px',
                fontSize: '0.8rem',
                outline: 'none',
                width: '100%',
                boxSizing: 'border-box',
                transition: 'all 0.2s ease',
                cursor: isEditing ? 'text' : 'not-allowed'
              }}
            />
          </div>

          {/* Controls: Delete button + Gear edit button */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              type="button"
              onClick={handleDeleteApplicant}
              disabled={isDeleting}
              style={{
                flex: 1,
                background: '#ef4444',
                color: '#ffffff',
                border: 'none',
                padding: '8px 12px',
                borderRadius: '8px',
                fontSize: '0.75rem',
                fontWeight: '700',
                cursor: isDeleting ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                opacity: isDeleting ? 0.6 : 1,
                transition: 'all 0.2s ease'
              }}
            >
              <FaTrash />
              {isDeleting ? 'Deleting...' : 'Delete Applicant'}
            </button>

            <button
              type="button"
              onClick={handleToggleEdit}
              title={isEditing ? 'Done Editing' : 'Edit Email'}
              style={{
                background: isEditing ? '#3b82f6' : '#334155',
                color: '#ffffff',
                border: 'none',
                padding: '8px 10px',
                borderRadius: '8px',
                fontSize: '0.85rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s ease'
              }}
            >
              <FaCog style={{ transform: isEditing ? 'rotate(90deg)' : 'none', transition: 'transform 0.3s ease' }} />
            </button>
          </div>

          {/* Status Message */}
          {status && (
            <div style={{
              background: status.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              border: `1px solid ${status.type === 'success' ? '#10b981' : '#ef4444'}`,
              color: status.type === 'success' ? '#34d399' : '#f87171',
              padding: '8px 10px',
              borderRadius: '8px',
              fontSize: '0.7rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '6px',
              wordBreak: 'break-word'
            }}>
              {status.type === 'success' ? <FaCheckCircle style={{ marginTop: '2px', flexShrink: 0 }} /> : <FaExclamationCircle style={{ marginTop: '2px', flexShrink: 0 }} />}
              <span>{status.message}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
