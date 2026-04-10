import React, { useState, useEffect, useRef } from 'react';

/**
 * VideoUploader Component (Repurposed from VideoRecorder)
 * Allows users to upload a video file and preview it.
 * 
 * Props:
 * @param {Function} onRecordComplete - Callback when file is selected, receives (file, videoUrl)
 * @param {string} label - Display label for the uploader
 * @param {string} initialVideoUrl - Existing video URL to show as preview
 * @param {boolean} isUploading - Whether the video is currently uploading
 */
const VideoRecorder = ({ onRecordComplete, label = "Upload Video", initialVideoUrl, isUploading = false, containerStyle = {}, disabled = false, hideButton = false }) => {
  const [previewUrl, setPreviewUrl] = useState(null);
  const [fileName, setFileName] = useState('');
  const [videoError, setVideoError] = useState(null);
  const fileInputRef = useRef(null);

  // Sync with initialVideoUrl if provided (for loading from DB)
  useEffect(() => {
    console.log('VideoRecorder useEffect triggered:', {
      initialVideoUrl,
      currentPreviewUrl: previewUrl,
      label
    });
    
    if (initialVideoUrl) {
      console.log(`Setting preview URL for ${label}:`, initialVideoUrl);
      setPreviewUrl(initialVideoUrl);
      setFileName('Existing saved video');
      setVideoError(null);
    } else if (!previewUrl || !previewUrl.startsWith('blob:')) {
      setPreviewUrl(null);
      setFileName('');
      setVideoError(null);
    }
  }, [initialVideoUrl]);

  const openFilePicker = () => {
    if (disabled) return;
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e) => {
    if (disabled) return;
    const file = e.target.files[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith('video/')) {
        alert("Please select a valid video file.");
        return;
      }

      setFileName(file.name);
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      setVideoError(null);
      
      if (onRecordComplete) {
        onRecordComplete(file, url);
      }
    }
  };

  const handleReset = () => {
    if (disabled) return;
    setPreviewUrl(null);
    setFileName('');
    setVideoError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (onRecordComplete) onRecordComplete(null, null);
  };

  const getStatus = () => {
    if (!previewUrl) return null;
    if (previewUrl.startsWith('blob:')) return { label: 'New video selected', color: '#166534', background: '#ecfdf5', border: '#bbf7d0' };
    return { label: 'Saved video loaded', color: '#1d4ed8', background: '#eff6ff', border: '#bfdbfe' };
  };

  const status = getStatus();

  return (
    <div className="video-uploader-container" style={{
      width: '100%',
      background: '#fff',
      borderRadius: '16px',
      padding: '1.2rem',
      border: '1px solid #e1e8f0',
      textAlign: 'center',
      boxShadow: '0 4px 15px rgba(0,0,0,0.03)',
      transition: 'all 0.3s ease',
      position: 'relative',
      overflow: 'hidden',
      ...containerStyle
    }}>
      {isUploading && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(255,255,255,0.8)',
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(2px)'
        }}>
          <div className="loading-spinner" style={{ width: '30px', height: '30px', border: '3px solid #f3f3f3', borderTop: '3px solid var(--primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', marginBottom: '10px' }}></div>
          <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--primary)' }}>Uploading...</span>
        </div>
      )}

      {/* Persistent Button regardless of state */}
      {!hideButton && (
        <div style={{ marginBottom: '1rem', textAlign: 'left' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', color: '#334155', marginBottom: '8px' }}>{label}</label>
          <input 
            ref={fileInputRef}
            id={`v-upload-${label.replace(/\s+/g, '-')}`}
            type="file" 
            accept="video/*" 
            onChange={handleFileChange} 
            style={{ display: 'none' }} 
            disabled={disabled}
          />
          <label
            htmlFor={disabled ? undefined : `v-upload-${label.replace(/\s+/g, '-')}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '10px',
              padding: '0.8rem 1rem',
              borderRadius: '14px',
              border: '1px solid #cbd5e1',
              background: '#fff',
              color: '#0f172a',
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontSize: '0.85rem',
              fontWeight: '700',
              boxShadow: '0 4px 12px rgba(15, 23, 42, 0.05)',
              opacity: disabled ? 0.6 : 1
            }}
          >
            <i className="fas fa-video" style={{ color: 'var(--primary)' }}></i>
            {previewUrl ? 'Replace Video' : 'Choose Video'}
          </label>

          {fileName && (
            <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#64748b', fontWeight: '600', wordBreak: 'break-word' }}>
              {fileName}
            </div>
          )}
          
          {status && (
            <div
              style={{
                marginTop: '0.65rem',
                padding: '0.7rem 0.85rem',
                borderRadius: '12px',
                border: `1px solid ${status.border}`,
                background: status.background,
                color: status.color,
                fontSize: '0.78rem',
                fontWeight: '700',
                textAlign: 'center'
              }}
            >
              {status.label}
            </div>
          )}
        </div>
      )}

      {!previewUrl ? (
        <div style={{ padding: '0.5rem' }}>
          <div style={{ fontSize: '0.75rem', color: '#888' }}>Capture or select a required video for verification.</div>
        </div>
      ) : (
        <div style={{ position: 'relative', width: '100%', margin: '0 auto' }}>
          {videoError ? (
            <div style={{
              padding: '1rem',
              textAlign: 'center',
              background: '#fff5f5',
              borderRadius: '12px',
              border: '2px solid #feb2b2',
              color: '#c53030'
            }}>
              <p style={{ fontSize: '0.8rem', fontWeight: '600', marginBottom: '0.5rem' }}>Format Not Playable</p>
              <a href={previewUrl} download style={{ display: 'block', fontSize: '0.75rem', color: '#c53030', marginBottom: '0.5rem' }}>Download to View</a>
            </div>
          ) : (
            <>
              <video 
                src={previewUrl} 
                controls 
                onError={() => setVideoError('Video preview failed')}
                style={{ 
                  width: '100%', 
                  borderRadius: '12px', 
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  background: '#000' 
                }} 
              />
              {!hideButton && (
                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.85rem' }}>
                  <button
                    type="button"
                    onClick={openFilePicker}
                    disabled={disabled}
                    style={{
                      flex: 1,
                      border: '1px solid #cbd5e1',
                      background: '#fff',
                      color: '#0f172a',
                      borderRadius: '12px',
                      padding: '0.75rem 0.9rem',
                      fontSize: '0.8rem',
                      fontWeight: '700',
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      opacity: disabled ? 0.6 : 1
                    }}
                  >
                    <i className="fas fa-arrows-rotate" style={{ marginRight: '8px', color: 'var(--primary)' }}></i>
                    Replace Video
                  </button>
                  <button
                    type="button"
                    onClick={handleReset}
                    disabled={disabled}
                    style={{
                      border: '1px solid #fecaca',
                      background: '#fff5f5',
                      color: '#b91c1c',
                      borderRadius: '12px',
                      padding: '0.75rem 0.9rem',
                      fontSize: '0.8rem',
                      fontWeight: '700',
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      opacity: disabled ? 0.6 : 1
                    }}
                  >
                    <i className="fas fa-trash" style={{ marginRight: '8px' }}></i>
                    Remove
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default VideoRecorder;
