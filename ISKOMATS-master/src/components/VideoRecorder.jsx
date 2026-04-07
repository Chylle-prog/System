import React, { useRef, useState, useEffect, useCallback } from 'react';

/**
 * VideoRecorder Component
 * Captures a short video from the camera and returns a Blob.
 * 
 * Props:
 * @param {Function} onRecordComplete - Callback when recording is finished, receives (blob, videoUrl)
 * @param {number} maxDuration - Maximum recording duration in seconds (default 5)
 * @param {string} label - Display label for the recorder
 */
const VideoRecorder = ({ onRecordComplete, maxDuration = 5, label = "Record Video" }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [stream, setStream] = useState(null);
  const [countdown, setCountdown] = useState(maxDuration);
  const [isCameraActive, setIsCameraActive] = useState(false);
  
  const videoRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);

  const startCamera = async () => {
    try {
      const userStream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment', width: 640, height: 480 }, 
        audio: false 
      });
      setStream(userStream);
      if (videoRef.current) {
        videoRef.current.srcObject = userStream;
      }
      setIsCameraActive(true);
    } catch (err) {
      console.error("Error accessing camera:", err);
      alert("Could not access camera. Please ensure permissions are granted.");
    }
  };

  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
      setIsCameraActive(false);
    }
  }, [stream]);

  const startRecording = () => {
    if (!stream) return;
    
    chunksRef.current = [];
    const options = { mimeType: 'video/webm;codecs=vp8,opus' };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options.mimeType = 'video/mp4'; // Fallback for Safari
    }
    
    try {
      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };
      
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: options.mimeType });
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        if (onRecordComplete) {
          onRecordComplete(blob, url);
        }
        stopCamera();
      };
      
      recorder.start();
      setIsRecording(true);
      setCountdown(maxDuration);
      
      // Start countdown timer
      timerRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            stopRecording();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      
    } catch (err) {
      console.error("Error starting recorder:", err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
  };

  const handleReset = () => {
    setPreviewUrl(null);
    if (onRecordComplete) onRecordComplete(null, null);
    startCamera();
  };

  useEffect(() => {
    return () => {
      stopCamera();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [stopCamera]);

  return (
    <div className="video-recorder-container" style={{
      width: '100%',
      background: '#f8f9fa',
      borderRadius: '16px',
      padding: '1rem',
      border: '1px dashed #dee2e6',
      textAlign: 'center'
    }}>
      {!isCameraActive && !previewUrl ? (
        <button type="button" onClick={startCamera} className="photo-option-btn" style={{ margin: '0 auto' }}>
          <i className="fas fa-video"></i> {label}
        </button>
      ) : (
        <div style={{ position: 'relative', width: '100%', maxWidth: '320px', margin: '0 auto' }}>
          {previewUrl ? (
            <video src={previewUrl} controls style={{ width: '100%', borderRadius: '12px' }} />
          ) : (
            <div style={{ position: 'relative' }}>
              <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', borderRadius: '12px', background: '#000' }} />
              {isRecording && (
                <div style={{
                  position: 'absolute',
                  top: '10px',
                  right: '10px',
                  background: 'rgba(255,0,0,0.8)',
                  color: 'white',
                  padding: '2px 8px',
                  borderRadius: '20px',
                  fontSize: '0.8rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  animation: 'pulse 1.5s infinite'
                }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'white' }}></div>
                  REC {countdown}s
                </div>
              )}
            </div>
          )}
          
          <div style={{ marginTop: '1rem', display: 'flex', gap: '10px', justifyContent: 'center' }}>
            {isCameraActive && !isRecording && (
              <>
                <button type="button" onClick={stopCamera} className="back-to-form-btn" style={{ padding: '0.5rem 1rem', fontSize: '0.8rem' }}>Cancel</button>
                <button type="button" onClick={startRecording} className="submit-btn" style={{ width: 'auto', padding: '0.5rem 1.5rem', height: 'auto', fontSize: '0.8rem', background: '#e74c3c' }}>
                  Start 5s Recording
                </button>
              </>
            )}
            
            {isRecording && (
              <button type="button" onClick={stopRecording} className="submit-btn" style={{ width: 'auto', padding: '0.5rem 1.5rem', height: 'auto', fontSize: '0.8rem', background: '#666' }}>
                Stop Early
              </button>
            )}
            
            {previewUrl && (
              <button type="button" onClick={handleReset} className="back-to-form-btn" style={{ padding: '0.5rem 1rem', fontSize: '0.8rem' }}>
                <i className="fas fa-redo"></i> Retake
              </button>
            )}
          </div>
        </div>
      )}
      
      <style>{`
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.5; }
          100% { opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default VideoRecorder;
