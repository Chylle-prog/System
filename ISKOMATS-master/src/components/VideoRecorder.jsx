import React, { useState } from 'react';

/**
 * VideoUploader Component (Repurposed from VideoRecorder)
 * Allows users to upload a video file and preview it.
 * 
 * Props:
 * @param {Function} onRecordComplete - Callback when file is selected, receives (file, videoUrl)
 * @param {string} label - Display label for the uploader
 */
const VideoRecorder = ({ onRecordComplete, label = "Upload Video" }) => {
  const [previewUrl, setPreviewUrl] = useState(null);
  const [fileName, setFileName] = useState('');

  const handleFileChange = (e) => {
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
      
      if (onRecordComplete) {
        onRecordComplete(file, url);
      }
    }
  };

  const handleReset = () => {
    setPreviewUrl(null);
    setFileName('');
    if (onRecordComplete) onRecordComplete(null, null);
  };

  return (
    <div className="video-uploader-container" style={{
      width: '100%',
      background: '#fff',
      borderRadius: '16px',
      padding: '1.2rem',
      border: '1px solid #e1e8f0',
      textAlign: 'center',
      boxShadow: '0 4px 15px rgba(0,0,0,0.03)',
      transition: 'all 0.3s ease'
    }}>
      {!previewUrl ? (
        <div style={{ padding: '1rem' }}>
          <label 
            htmlFor={`v-upload-${label.replace(/\s+/g, '-')}`}
            style={{ 
              cursor: 'pointer', 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center', 
              gap: '12px' 
            }}
          >
            <div style={{ 
              width: '60px', 
              height: '60px', 
              borderRadius: '50%', 
              background: '#f0f7ff', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              color: 'var(--primary)',
              fontSize: '1.5rem',
              border: '2px dashed #b3d7ff'
            }}>
              <i className="fas fa-cloud-upload-alt"></i>
            </div>
            <span style={{ fontSize: '0.9rem', fontWeight: '600', color: '#444' }}>{label}</span>
            <span style={{ fontSize: '0.75rem', color: '#888' }}>MP4, WebM or MOV (Max 50MB)</span>
            
            <input 
              id={`v-upload-${label.replace(/\s+/g, '-')}`}
              type="file" 
              accept="video/*" 
              onChange={handleFileChange} 
              style={{ display: 'none' }} 
            />
          </label>
        </div>
      ) : (
        <div style={{ position: 'relative', width: '100%', maxWidth: '250px', margin: '0 auto' }}>
          <video 
            src={previewUrl} 
            controls 
            style={{ 
              width: '100%', 
              borderRadius: '12px', 
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              background: '#000' 
            }} 
          />
          <div style={{ marginTop: '0.8rem', display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <span style={{ fontSize: '0.8rem', color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {fileName}
            </span>
            <button 
              type="button" 
              onClick={handleReset} 
              style={{ 
                background: 'transparent', 
                border: 'none', 
                color: '#e74c3c', 
                fontSize: '0.8rem', 
                cursor: 'pointer',
                fontWeight: '600',
                textDecoration: 'underline'
              }}
            >
              Change Video
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoRecorder;
