import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';

const FindScholarship = () => {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [showFormView, setShowFormView] = useState(true);
  const [showResultsView, setShowResultsView] = useState(false);
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(false);
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [cameraInitializing, setCameraInitializing] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [usingFrontCamera, setUsingFrontCamera] = useState(true);
  const [currentStream, setCurrentStream] = useState(null);
  const [cameraPermissionStatus, setCameraPermissionStatus] = useState('');
  const [scholarshipMatches, setScholarshipMatches] = useState([]);
  const [successBanner, setSuccessBanner] = useState('');
  const [incomeLevel, setIncomeLevel] = useState('');

  // Photo states
  const [photos, setPhotos] = useState({
    front: null,
    back: null,
    face: null
  });

  const [formData, setFormData] = useState({
    fullName: '',
    university: '',
    gpa: '',
    income: '',
    barangay: ''
  });

  const videoRef = useRef(null);
  const cameraTimeoutRef = useRef(null);

  // Barangay options
  const barangays = [
    'Adya', 'Anilao', 'Anilao-Labac', 'Antipolo del Norte', 'Antipolo del Sur',
    'Bagong Pook', 'Balintawak', 'Banaybanay', 'Bolbok', 'Bugtong na Pulo',
    'Bulacnin', 'Bulaklakan', 'Calamias', 'Cumba', 'Dagatan', 'Duhatan',
    'Halang', 'Inosluban', 'Kayumanggi', 'Latag', 'Lodlod', 'Lumbang',
    'Mabini', 'Malagonlong', 'Malitlit', 'Marauoy', 'Mataas na Lupa',
    'Munting Pulo', 'Pagolingin Bata', 'Pagolingin East', 'Pagolingin West',
    'Pangao', 'Pinagkawitan', 'Pinagtongulan', 'Plaridel',
    'Poblacion Barangay 1', 'Poblacion Barangay 2', 'Poblacion Barangay 3',
    'Poblacion Barangay 4', 'Poblacion Barangay 5', 'Poblacion Barangay 6',
    'Poblacion Barangay 7', 'Poblacion Barangay 8', 'Poblacion Barangay 9',
    'Poblacion Barangay 9-A', 'Poblacion Barangay 10', 'Poblacion Barangay 11',
    'Poblacion Barangay 12', 'Pusil', 'Quezon', 'Rizal', 'Sabang', 'Sampaguita',
    'San Benito', 'San Carlos', 'San Celestino', 'San Francisco', 'San Guillermo',
    'San Jose', 'San Lucas', 'San Salvador', 'San Sebastian', 'Santo Niño',
    'Santo Toribio', 'Sapac', 'Sico', 'Talisay', 'Tambo', 'Tangob',
    'Tanguay', 'Tibig', 'Tipacan'
  ];

  useEffect(() => {
    // Add Font Awesome link
    const fontAwesomeLink = document.createElement('link');
    fontAwesomeLink.rel = 'stylesheet';
    fontAwesomeLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css';
    document.head.appendChild(fontAwesomeLink);

    // Add Google Fonts link
    const googleFontsLink = document.createElement('link');
    googleFontsLink.rel = 'preconnect';
    googleFontsLink.href = 'https://fonts.googleapis.com';
    document.head.appendChild(googleFontsLink);

    const googleFontsDisplay = document.createElement('link');
    googleFontsDisplay.rel = 'preconnect';
    googleFontsDisplay.href = 'https://fonts.gstatic.com';
    googleFontsDisplay.crossOrigin = 'anonymous';
    document.head.appendChild(googleFontsDisplay);

    const googleFontsSheet = document.createElement('link');
    googleFontsSheet.rel = 'stylesheet';
    googleFontsSheet.href = 'https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400;14..32,500;14..32,600;14..32,700;14..32,800&display=swap';
    document.head.appendChild(googleFontsSheet);

    // Load user data
    const user = localStorage.getItem('currentUser');
    const profiles = JSON.parse(localStorage.getItem('userProfiles')) || {};

    if (!user) {
      navigate('/login');
      return;
    }

    setCurrentUser(user);
    setUserProfile(profiles[user] || null);

    // Pre-fill form data from profile
    if (profiles[user]) {
      const profile = profiles[user];
      setFormData(prev => ({
        ...prev,
        fullName: profile.fullName || '',
        university: profile.university || ''
      }));
    }

    // Check camera support on load
    checkCameraSupport();

    return () => {
      document.head.removeChild(fontAwesomeLink);
      document.head.removeChild(googleFontsLink);
      document.head.removeChild(googleFontsDisplay);
      document.head.removeChild(googleFontsSheet);

      // Clean up camera stream
      if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
      }
      if (cameraTimeoutRef.current) {
        clearTimeout(cameraTimeoutRef.current);
      }
    };
  }, [navigate]);

  const logout = () => {
    localStorage.removeItem('currentUser');
    navigate('/');
  };

  // Camera functions
  const checkCameraSupport = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      setCameraPermissionStatus('⚠️ Camera not supported in this browser');
      setTimeout(() => setCameraPermissionStatus(''), 3000);
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');

      if (videoDevices.length === 0) {
        setCameraPermissionStatus('⚠️ No camera found on this device');
      } else {
        setCameraPermissionStatus(`✅ Camera ready (${videoDevices.length} device${videoDevices.length > 1 ? 's' : ''} available)`);
        setTimeout(() => setCameraPermissionStatus(''), 3000);
      }
    } catch (err) {
      console.error('Camera check error:', err);
    }
  };

  const openCamera = async () => {
    setShowCameraModal(true);
    setCameraInitializing(true);
    setCameraError(null);
    setCameraReady(false);

    try {
      // Stop any existing stream
      if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
        setCurrentStream(null);
      }

      const constraints = {
        video: {
          facingMode: usingFrontCamera ? 'user' : 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      };

      // Add timeout to getUserMedia request
      const timeoutPromise = new Promise((_, reject) => {
        cameraTimeoutRef.current = setTimeout(() => reject(new Error('Camera access timeout')), 10000);
      });

      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia(constraints),
        timeoutPromise
      ]);

      // Clear timeout
      if (cameraTimeoutRef.current) {
        clearTimeout(cameraTimeoutRef.current);
      }

      setCurrentStream(stream);

      // Set video source
      if (videoRef.current) {
        videoRef.current.srcObject = stream;

        // Wait for video to be ready
        await new Promise((resolve, reject) => {
          videoRef.current.onloadedmetadata = () => {
            videoRef.current.play()
              .then(resolve)
              .catch(reject);
          };
          videoRef.current.onerror = () => reject(new Error('Video playback error'));
        });
      }

      setCameraInitializing(false);
      setCameraReady(true);

    } catch (err) {
      console.error('Camera error:', err);
      setCameraInitializing(false);
      setCameraReady(false);

      let errorMessage = 'Camera access failed';
      let errorDetails = 'Unknown error occurred';

      if (err.name === 'NotAllowedError' || err.message.includes('permission')) {
        errorMessage = 'Camera permission denied';
        errorDetails = 'Please allow camera access and try again';
      } else if (err.name === 'NotFoundError' || err.message.includes('not found')) {
        errorMessage = 'No camera found';
        errorDetails = 'Please connect a camera to your device';
      } else if (err.name === 'NotReadableError' || err.message.includes('busy')) {
        errorMessage = 'Camera is busy';
        errorDetails = 'Another app might be using the camera';
      } else if (err.message.includes('timeout')) {
        errorMessage = 'Camera access timeout';
        errorDetails = 'Please check your camera and try again';
      } else {
        errorDetails = err.message || 'Unknown error occurred';
      }

      setCameraError({ message: errorMessage, details: errorDetails });
    }
  };

  const closeCamera = () => {
    // Stop all tracks
    if (currentStream) {
      currentStream.getTracks().forEach(track => {
        track.stop();
      });
      setCurrentStream(null);
    }

    // Clear video source
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setShowCameraModal(false);
    setCameraInitializing(false);
    setCameraReady(false);
    setCameraError(null);
    setUsingFrontCamera(true);

    // Clear timeout
    if (cameraTimeoutRef.current) {
      clearTimeout(cameraTimeoutRef.current);
    }
  };

  const retryCamera = () => {
    if (currentStream) {
      currentStream.getTracks().forEach(track => {
        track.stop();
      });
      setCurrentStream(null);
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraInitializing(true);
    setCameraReady(false);
    setCameraError(null);

    setTimeout(() => {
      openCamera();
    }, 300);
  };

  const switchCamera = () => {
    setUsingFrontCamera(!usingFrontCamera);
    setCameraInitializing(true);
    setCameraReady(false);

    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop());
      setCurrentStream(null);
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setTimeout(() => {
      openCamera();
    }, 300);
  };

  const capturePhoto = () => {
    if (!videoRef.current || !currentStream) return;

    const video = videoRef.current;
    const canvas = document.createElement('canvas');

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');

    // If using front camera, flip the image horizontally
    if (usingFrontCamera) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Reset transform
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Convert to blob and create file
    canvas.toBlob((blob) => {
      const file = new File([blob], 'face-verification.jpg', { type: 'image/jpeg' });

      // Create a DataTransfer object to set the file input
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      // Set the file input
      const fileInput = document.getElementById('photoSearchFace');
      if (fileInput) {
        fileInput.files = dataTransfer.files;
      }

      // Show preview
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      handlePhotoChange('face', dataUrl);

      console.log('Photo captured and saved');
      closeCamera();
    }, 'image/jpeg', 0.9);
  };

  // Photo handling functions
  const openGallery = (type) => {
    const fileInput = document.getElementById(`photoSearch${type.charAt(0).toUpperCase() + type.slice(1)}`);
    if (fileInput) {
      fileInput.click();
    }
  };

  const handlePhotoChange = (type, dataUrl = null) => {
    if (dataUrl) {
      setPhotos(prev => ({ ...prev, [type]: dataUrl }));
    } else {
      const fileInput = document.getElementById(`photoSearch${type.charAt(0).toUpperCase() + type.slice(1)}`);
      const file = fileInput?.files[0];

      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          setPhotos(prev => ({ ...prev, [type]: e.target.result }));
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const removePhoto = (type) => {
    setPhotos(prev => ({ ...prev, [type]: null }));

    // Clear the file input
    const fileInput = document.getElementById(`photoSearch${type.charAt(0).toUpperCase() + type.slice(1)}`);
    if (fileInput) {
      fileInput.value = '';
    }
  };

  // Form handling
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));

    // Handle income level indicator
    if (name === 'income') {
      const raw = value.trim();
      if (raw === '') {
        setIncomeLevel('');
        return;
      }

      const numValue = parseInt(raw, 10);
      let level = '';
      let color = 'var(--text-soft)';

      if (numValue >= 0 && numValue <= 30000) {
        level = 'Low';
        color = 'var(--success)';
      } else if (numValue >= 30001 && numValue <= 100000) {
        level = 'Middle';
        color = 'var(--warning)';
      } else if (numValue >= 100001) {
        level = 'High';
        color = 'var(--danger)';
      }

      setIncomeLevel(level ? `Income level: ${level}` : '');
    }
  };

  const handleScholarshipSearch = (e) => {
    e.preventDefault();

    const gpa = parseFloat(formData.gpa);
    const income = parseInt(formData.income);

    // Check if face photo is uploaded
    if (!photos.face) {
      alert('Please upload or take a face verification photo before proceeding.');
      return;
    }

    // Show loading
    setShowLoadingOverlay(true);

    // Simulate processing delay
    setTimeout(() => {
      const matches = [];

      // Mayor Eric B. Africa Scholarship (gpa ≥ 3.5, income ≤ 60000)
      if (gpa >= 3.5 && income <= 60000) {
        matches.push({
          name: 'Mayor Eric B. Africa Scholarship',
          provider: 'City Government of Lipa',
          description: 'Supports students with a GPA of 3.5 and above who are residents of Lipa City.',
          gpaRequirement: '3.5+',
          incomeRequirement: '≤₱60,000/month',
          benefits: 'Full tuition coverage + monthly stipend'
        });
      }

      // Governor Vilma's Scholarship (gpa ≤ 3.5, income ≤ 20000)
      if (gpa <= 3.5 && income <= 20000) {
        matches.push({
          name: 'Governor Vilma\'s Scholarship',
          provider: 'Provincial Government',
          description: 'Prioritizes low-income families with passing grades to support deserving students.',
          gpaRequirement: '≤3.5',
          incomeRequirement: '≤₱20,000/month',
          benefits: 'Tuition assistance + educational support'
        });
      }

      // CHED Tulong Dunong (gpa ≤ 3.5, income ≤ 33333)
      if (gpa <= 3.5 && income <= 33333) {
        matches.push({
          name: 'CHED Tulong Dunong',
          provider: 'Commission on Higher Education',
          description: 'Government scholarship for deserving students from low-income families.',
          gpaRequirement: '≤3.5',
          incomeRequirement: '≤₱400,000/year',
          benefits: 'Full financial assistance + allowance'
        });
      }

      // Hide loading
      setShowLoadingOverlay(false);

      if (matches.length > 0) {
        setSuccessBanner(`Success! We found ${matches.length} personalized scholarship${matches.length > 1 ? 's' : ''} matching your criteria.`);
      } else {
        setSuccessBanner('No scholarships match your current qualifications. Try adjusting your criteria.');
      }

      setScholarshipMatches(matches);
      setShowFormView(false);
      setShowResultsView(true);

    }, 2000);
  };

  const switchToFormView = () => {
    setShowFormView(true);
    setShowResultsView(false);
  };

  const applyForScholarship = (scholarshipName) => {
    navigate(`/studentinfo?scholarship=${encodeURIComponent(scholarshipName)}`);
  };

  return (
    <>
      <style>{`
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          background-color: #f9fafc;
          color: #121826;
          line-height: 1.5;
        }

        :root {
          --primary: #4F0D00;
          --primary-light: #8b3a1f;
          --accent: #4F0D00;
          --accent-soft: #ffe8e3;
          --gray-1: #f4f6fa;
          --gray-2: #e2e8f0;
          --gray-3: #b0c0d0;
          --text-dark: #121826;
          --text-soft: #3f4a5c;
          --white: #ffffff;
          --success: #0f7b5a;
          --success-bg: #e1f7f0;
          --warning: #b65f22;
          --warning-bg: #ffefe3;
          --danger: #b13e3e;
          --danger-bg: #fee9e9;
          --shadow-sm: 0 4px 10px rgba(0, 0, 0, 0.02), 0 1px 3px rgba(0, 0, 0, 0.05);
          --shadow-md: 0 12px 30px rgba(0, 0, 0, 0.04), 0 4px 10px rgba(0, 20, 40, 0.03);
          --shadow-lg: 0 20px 40px -12px rgba(0, 40, 80, 0.2);
          --border-light: 1px solid rgba(0, 0, 0, 0.05);
        }

        .navbar {
          background: var(--primary);
          padding: 0.9rem 5%;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: var(--border-light);
          position: sticky;
          top: 0;
          z-index: 100;
          backdrop-filter: blur(8px);
          background-color: rgba(79, 13, 0, 0.95);
        }

        .navbar-brand {
          font-size: 1.65rem;
          font-weight: 800;
          letter-spacing: -0.02em;
          color: white;
          text-decoration: none;
        }

        .navbar-menu {
          display: flex;
          gap: 2.5rem;
          align-items: center;
        }

        .navbar-menu span {
          color: rgba(255, 255, 255, 0.9);
          font-weight: 500;
          font-size: 0.95rem;
        }

        .logout-btn {
          background: transparent;
          padding: 0.5rem 1.5rem;
          border-radius: 40px;
          border: 1.5px solid rgba(255, 255, 255, 0.3);
          color: white;
          font-weight: 600;
          font-size: 0.9rem;
          transition: all 0.2s;
          cursor: pointer;
        }

        .logout-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          border-color: rgba(255, 255, 255, 0.6);
          color: white;
        }

        .income-indicator {
          display: block;
          font-size: 0.85rem;
          font-weight: 600;
          margin-top: 0.5rem;
          padding-left: 0.5rem;
          transition: color 0.1s;
        }

        .form-group {
          margin-bottom: 1.5rem;
        }

        .form-group label {
          display: block;
          font-weight: 600;
          font-size: 0.85rem;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          color: var(--primary-light);
          margin-bottom: 0.4rem;
        }

        .form-group input,
        .form-group textarea,
        .form-group select {
          width: 100%;
          padding: 0.9rem 1.2rem;
          border: 1.5px solid var(--gray-2);
          border-radius: 18px;
          font-size: 0.95rem;
          transition: 0.15s;
          background: var(--gray-1);
          font-family: 'Inter', sans-serif;
        }

        .form-group input:focus,
        .form-group textarea:focus,
        .form-group select:focus {
          outline: none;
          border-color: var(--accent);
          background: var(--white);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }

        .submit-btn {
          width: 100%;
          padding: 1rem;
          background: var(--primary);
          color: white;
          border: none;
          border-radius: 40px;
          font-weight: 700;
          font-size: 1rem;
          cursor: pointer;
          transition: 0.15s;
          box-shadow: var(--shadow-sm);
        }

        .submit-btn:hover {
          background: #3d0a00;
          transform: scale(1.01);
        }

        .feedback-form {
          max-width: 600px;
          background: var(--white);
          padding: 2.5rem;
          border-radius: 38px;
          box-shadow: var(--shadow-sm);
          border: var(--border-light);
          margin: 2rem auto;
        }

        .back-button {
          background: none;
          border: 1.5px solid var(--gray-2);
          padding: 0.5rem 1.5rem;
          border-radius: 40px;
          font-weight: 600;
          color: var(--text-soft);
          margin-bottom: 2rem;
          cursor: pointer;
          transition: 0.1s;
          font-size: 0.9rem;
          text-decoration: none;
          display: inline-block;
        }

        .back-button:hover {
          background: #f1f5f9;
          border-color: var(--gray-3);
        }

        .results-view {
          max-width: 1400px;
          margin: 2rem auto;
          padding: 0 2rem;
          display: none;
        }

        .results-view.active {
          display: block;
        }

        .results-header {
          text-align: center;
          margin-bottom: 2.5rem;
        }

        .results-header h2 {
          color: var(--primary);
          font-size: 2.2rem;
          font-weight: 800;
          letter-spacing: -0.02em;
          margin-bottom: 1rem;
        }

        .results-header p {
          color: var(--text-soft);
          font-size: 1.1rem;
        }

        .back-to-form-btn {
          background: transparent;
          border: 2px solid var(--primary);
          color: var(--primary);
          padding: 0.6rem 2rem;
          border-radius: 40px;
          font-weight: 600;
          cursor: pointer;
          margin-bottom: 1.5rem;
          font-size: 1rem;
          transition: 0.2s;
        }

        .back-to-form-btn:hover {
          background: var(--accent-soft);
          border-color: var(--primary);
        }

        .scholarship-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
          gap: 2rem;
          justify-content: center;
          align-items: stretch;
          margin-top: 2rem;
        }

        .scholarship-card {
          background: var(--white);
          padding: 2.2rem 1.8rem;
          border-radius: 28px;
          box-shadow: var(--shadow-sm);
          border: var(--border-light);
          transition: all 0.3s;
          display: flex;
          flex-direction: column;
          height: 100%;
        }

        .scholarship-card:hover {
          box-shadow: var(--shadow-md);
          border-color: #ffe8e3;
          transform: translateY(-4px);
        }

        .scholarship-card h4 {
          font-size: 1.4rem;
          font-weight: 700;
          color: var(--primary);
          margin-bottom: 0.5rem;
          letter-spacing: -0.01em;
        }

        .scholarship-provider {
          font-size: 0.9rem;
          color: var(--text-soft);
          margin-bottom: 1rem;
          font-weight: 500;
        }

        .scholarship-card p {
          color: var(--text-soft);
          margin-bottom: 1.5rem;
          font-size: 0.95rem;
          line-height: 1.6;
          flex-grow: 1;
        }

        .scholarship-requirements {
          display: flex;
          gap: 0.8rem;
          flex-wrap: wrap;
          margin-bottom: 1.5rem;
        }

        .requirement-badge {
          background: #f0eae8;
          color: var(--primary);
          padding: 0.4rem 1.2rem;
          border-radius: 30px;
          font-size: 0.85rem;
          font-weight: 600;
          border: 1px solid rgba(79, 13, 0, 0.1);
        }

        .scholarship-benefits {
          background: #f0ebe4;
          color: var(--primary);
          padding: 0.9rem 1.2rem;
          border-radius: 16px;
          margin-bottom: 1.8rem;
          font-size: 0.95rem;
          font-weight: 600;
          text-align: left;
          border-left: 4px solid var(--primary);
        }

        .apply-btn {
          background: var(--primary);
          color: white;
          border: none;
          border-radius: 16px;
          padding: 1rem 1.5rem;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          width: 100%;
          margin-top: auto;
        }

        .apply-btn:hover {
          background: #3a0a00;
          transform: translateY(-2px);
          box-shadow: var(--shadow-sm);
        }

        .no-results {
          text-align: center;
          color: var(--text-soft);
          padding: 3rem;
          background: white;
          border-radius: 40px;
          box-shadow: var(--shadow-sm);
          max-width: 500px;
          margin: 2rem auto;
          font-size: 1.1rem;
          border: var(--border-light);
        }

        .success-banner {
          background: #f0ebe4;
          border: 1px solid var(--primary-light);
          color: var(--primary);
          padding: 1rem 1.5rem;
          border-radius: 40px;
          margin-bottom: 2rem;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 0.8rem;
          justify-content: center;
        }

        .success-banner::before {
          content: "✓";
          font-size: 1.2rem;
          font-weight: bold;
          color: var(--primary);
        }

        .loading-overlay {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.3);
          backdrop-filter: blur(4px);
          z-index: 1001;
          align-items: center;
          justify-content: center;
        }

        .loading-overlay.active {
          display: flex;
        }

        .loading-modal {
          background: white;
          padding: 3rem 2rem;
          border-radius: 24px;
          text-align: center;
          box-shadow: var(--shadow-lg);
          max-width: 300px;
        }

        .loading-spinner {
          width: 50px;
          height: 50px;
          margin: 0 auto 1.5rem;
          border: 4px solid var(--gray-2);
          border-top-color: var(--primary);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        .loading-modal h3 {
          font-size: 1.2rem;
          color: var(--primary);
          margin-bottom: 0.5rem;
          font-weight: 700;
        }

        .loading-modal p {
          color: var(--text-soft);
          font-size: 0.9rem;
        }

        .form-view.hidden {
          display: none;
        }

        .photo-upload-container {
          position: relative;
        }

        .photo-options {
          display: flex;
          gap: 1rem;
          margin-bottom: 1rem;
        }

        .photo-option-btn {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
          padding: 1.5rem;
          border: 2px dashed var(--gray-2);
          border-radius: 12px;
          background: var(--gray-1);
          color: var(--text-soft);
          cursor: pointer;
          transition: all 0.2s;
          font-size: 0.9rem;
        }

        .photo-option-btn:hover {
          border-color: var(--primary);
          background: var(--accent-soft);
          color: var(--primary);
          transform: translateY(-2px);
        }

        .photo-option-btn i {
          font-size: 1.5rem;
        }

        .photo-preview {
          position: relative;
          width: 100%;
          max-width: 300px;
          margin: 0 auto;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: var(--shadow-md);
        }

        .photo-preview img {
          width: 100%;
          height: auto;
          display: block;
        }

        .remove-photo-btn {
          position: absolute;
          top: 0.5rem;
          right: 0.5rem;
          background: rgba(0, 0, 0, 0.7);
          color: white;
          border: none;
          border-radius: 50%;
          width: 30px;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background 0.2s;
        }

        .remove-photo-btn:hover {
          background: rgba(0, 0, 0, 0.9);
        }

        .camera-modal {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.95);
          z-index: 2000;
          align-items: center;
          justify-content: center;
        }

        .camera-modal.active {
          display: flex;
        }

        .camera-container {
          background: var(--white);
          padding: 1.5rem;
          border-radius: 24px;
          max-width: 600px;
          width: 95%;
          max-height: 90vh;
          overflow-y: auto;
        }

        .camera-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
        }

        .camera-header h3 {
          color: var(--primary);
          font-size: 1.2rem;
        }

        .close-camera-btn {
          background: none;
          border: none;
          font-size: 1.5rem;
          cursor: pointer;
          color: var(--text-soft);
          padding: 0.5rem;
        }

        .close-camera-btn:hover {
          color: var(--primary);
        }

        #cameraFeed {
          width: 100%;
          border-radius: 12px;
          background: #000;
          margin-bottom: 1rem;
          min-height: 400px;
          object-fit: cover;
          transform: scaleX(-1);
        }

        .camera-controls {
          display: flex;
          gap: 1rem;
          justify-content: center;
          flex-wrap: wrap;
        }

        .capture-btn {
          background: var(--primary);
          color: white;
          border: none;
          border-radius: 40px;
          padding: 0.8rem 2rem;
          font-weight: 600;
          cursor: pointer;
          transition: 0.2s;
          flex: 1;
          min-width: 120px;
        }

        .capture-btn:hover {
          background: #3a0a00;
        }

        .switch-camera-btn {
          background: var(--gray-2);
          color: var(--text-dark);
          border: none;
          border-radius: 40px;
          padding: 0.8rem 2rem;
          font-weight: 600;
          cursor: pointer;
          transition: 0.2s;
          flex: 1;
          min-width: 120px;
        }

        .switch-camera-btn:hover {
          background: var(--gray-3);
        }

        .camera-error {
          color: var(--danger);
          text-align: center;
          padding: 2rem;
          background: var(--danger-bg);
          border-radius: 12px;
          margin-bottom: 1rem;
        }

        .camera-error i {
          font-size: 2rem;
          margin-bottom: 1rem;
        }

        .retry-btn {
          background: var(--primary);
          color: white;
          border: none;
          border-radius: 40px;
          padding: 0.5rem 1.5rem;
          margin-top: 1rem;
          cursor: pointer;
        }

        .camera-permission-status {
          margin: 1rem 0;
          padding: 0.75rem;
          background: var(--gray-1);
          border-radius: 8px;
          font-size: 0.9rem;
        }

        .face-verification-section {
          margin-top: 2rem;
          border-top: 2px solid var(--gray-2);
          padding-top: 1.5rem;
        }

        .face-verification-section h4 {
          color: var(--primary);
          margin-bottom: 1rem;
          font-size: 1.1rem;
        }

        @media (max-width: 1024px) {
          .feedback-form {
            max-width: 100%;
            padding: 2rem;
          }
          
          .scholarship-grid {
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 1.5rem;
          }
        }

        @media (max-width: 768px) {
          .navbar {
            flex-direction: column;
            padding: 1rem 5%;
            gap: 1rem;
          }
          
          .navbar-menu {
            flex-wrap: wrap;
            justify-content: center;
            gap: 1rem;
          }
          
          .feedback-form {
            padding: 1.5rem;
          }
          
          .form-group label {
            font-size: 0.8rem;
          }
          
          .form-group input,
          .form-group select {
            padding: 0.8rem 1rem;
            font-size: 0.9rem;
          }
          
          .photo-options {
            flex-direction: column;
          }

          .photo-option-btn {
            padding: 1rem;
          }
          
          .scholarship-grid {
            grid-template-columns: 1fr;
            gap: 1.5rem;
            padding: 0 1rem;
          }
          
          .scholarship-card {
            padding: 1.5rem;
          }
          
          .scholarship-card h4 {
            font-size: 1.2rem;
          }
          
          .scholarship-card p {
            font-size: 0.9rem;
          }
          
          .camera-container {
            width: 95%;
            max-height: 95vh;
            padding: 1rem;
          }
          
          .camera-header h3 {
            font-size: 1rem;
          }
          
          .camera-controls {
            flex-direction: column;
            gap: 0.5rem;
          }
          
          .capture-btn,
          .switch-camera-btn {
            min-width: auto;
          }
        }

        @media (max-width: 480px) {
          .navbar {
            padding: 0.8rem 3%;
          }
          
          .navbar-menu span {
            font-size: 0.85rem;
          }
          
          .feedback-form {
            padding: 1rem;
          }
          
          .form-group input,
          .form-group select {
            padding: 0.7rem 0.9rem;
            font-size: 0.85rem;
          }
          
          .scholarship-card {
            padding: 1rem;
          }
          
          .scholarship-card h4 {
            font-size: 1.1rem;
          }
          
          .scholarship-card p {
            font-size: 0.85rem;
          }
          
          .requirement-badge {
            font-size: 0.75rem;
            padding: 0.3rem 0.8rem;
          }
          
          .scholarship-benefits {
            font-size: 0.85rem;
            padding: 0.7rem 1rem;
          }
          
          .apply-btn {
            padding: 0.8rem;
            font-size: 0.9rem;
          }
          
          .results-header h2 {
            font-size: 1.8rem;
          }
          
          .results-header p {
            font-size: 1rem;
          }
          
          .back-to-form-btn {
            padding: 0.5rem 1.5rem;
            font-size: 0.9rem;
          }
          
          .camera-container {
            width: 98%;
            padding: 0.8rem;
          }
          
          .camera-header h3 {
            font-size: 0.9rem;
          }
          
          .capture-btn,
          .switch-camera-btn {
            padding: 0.6rem 1rem;
            font-size: 0.8rem;
          }
        }
      `}</style>

      <nav className="navbar">
        <Link to="/portal" className="navbar-brand">iskoMats</Link>
        <div className="navbar-menu">
          <span>{currentUser}</span>
          <button className="logout-btn" onClick={logout}>
            <i className="fas fa-sign-out-alt" style={{ marginRight: '6px' }}></i>Logout
          </button>
        </div>
      </nav>

      {/* FORM VIEW */}
      {showFormView && (
        <div className="form-view">
          <div style={{ maxWidth: '800px', margin: '0 auto', padding: '0 1rem' }}>
            <Link to="/portal" className="back-button">
              <i className="fas fa-arrow-left"></i> Back to Portal
            </Link>
            <h3 style={{ color: 'var(--primary)', fontSize: '1.8rem', fontWeight: '700', textAlign: 'center', marginBottom: '1rem' }}>
              Find Scholarships
            </h3>

            {/* Camera Status Indicator */}
            {cameraPermissionStatus && (
              <div className="camera-permission-status">
                <i className="fas fa-info-circle"></i>
                <span>{cameraPermissionStatus}</span>
              </div>
            )}

            <form onSubmit={handleScholarshipSearch} className="feedback-form">
              <div className="form-group">
                <label>Full Name</label>
                <input
                  type="text"
                  name="fullName"
                  value={formData.fullName}
                  onChange={handleInputChange}
                  placeholder="Enter your full name"
                  required
                />
              </div>
              <div className="form-group">
                <label>University</label>
                <input
                  type="text"
                  name="university"
                  value={formData.university}
                  onChange={handleInputChange}
                  placeholder="Enter your university"
                  required
                />
              </div>
              <div className="form-group">
                <label>GPA</label>
                <input
                  type="number"
                  name="gpa"
                  value={formData.gpa}
                  onChange={handleInputChange}
                  step="0.01"
                  min="0"
                  max="4"
                  placeholder="e.g., 3.5"
                  required
                />
              </div>

              {/* Income field with live indicator */}
              <div className="form-group">
                <label>Income (PHP/month)</label>
                <input
                  type="number"
                  name="income"
                  value={formData.income}
                  onChange={handleInputChange}
                  placeholder="e.g., 25000"
                  required
                />
                {incomeLevel && (
                  <span className="income-indicator" style={{ color: incomeLevel.includes('Low') ? 'var(--success)' : incomeLevel.includes('Middle') ? 'var(--warning)' : 'var(--danger)' }}>
                    {incomeLevel}
                  </span>
                )}
              </div>

              <div className="form-group">
                <label>Barangay</label>
                <select name="barangay" value={formData.barangay} onChange={handleInputChange} required>
                  <option value="">Select your barangay</option>
                  {barangays.map(barangay => (
                    <option key={barangay} value={barangay}>{barangay}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Updated School ID (Front and Back)</label>

                {/* Front ID Upload Box */}
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.5rem', display: 'block' }}>
                    Front of School ID
                  </label>
                  <div className="photo-upload-container">
                    <div className="photo-options" style={{ display: photos.front ? 'none' : 'flex' }}>
                      <button type="button" className="photo-option-btn" onClick={() => openGallery('front')}>
                        <i className="fas fa-images"></i>
                        <span>Choose from Gallery</span>
                      </button>
                    </div>
                    {photos.front && (
                      <div className="photo-preview">
                        <img src={photos.front} alt="Front ID Preview" />
                        <button type="button" className="remove-photo-btn" onClick={() => removePhoto('front')}>
                          <i className="fas fa-times"></i>
                        </button>
                      </div>
                    )}
                    <input
                      type="file"
                      id="photoSearchFront"
                      accept="image/*"
                      style={{ display: 'none' }}
                      required
                      onChange={() => handlePhotoChange('front')}
                    />
                  </div>
                </div>

                {/* Back ID Upload Box */}
                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.5rem', display: 'block' }}>
                    Back of School ID
                  </label>
                  <div className="photo-upload-container">
                    <div className="photo-options" style={{ display: photos.back ? 'none' : 'flex' }}>
                      <button type="button" className="photo-option-btn" onClick={() => openGallery('back')}>
                        <i className="fas fa-images"></i>
                        <span>Choose from Gallery</span>
                      </button>
                    </div>
                    {photos.back && (
                      <div className="photo-preview">
                        <img src={photos.back} alt="Back ID Preview" />
                        <button type="button" className="remove-photo-btn" onClick={() => removePhoto('back')}>
                          <i className="fas fa-times"></i>
                        </button>
                      </div>
                    )}
                    <input
                      type="file"
                      id="photoSearchBack"
                      accept="image/*"
                      style={{ display: 'none' }}
                      required
                      onChange={() => handlePhotoChange('back')}
                    />
                  </div>
                </div>
              </div>

              {/* Face Verification Section */}
              <div className="face-verification-section">
                <h4>
                  <i className="fas fa-camera" style={{ marginRight: '8px' }}></i>
                  Face Verification
                </h4>
                <p style={{ color: 'var(--text-soft)', fontSize: '0.9rem', marginBottom: '1rem' }}>
                  Take a clear photo of your face for identity verification
                </p>

                <div className="photo-upload-container">
                  <div className="photo-options" style={{ display: photos.face ? 'none' : 'flex' }}>
                    <button type="button" className="photo-option-btn" onClick={openCamera}>
                      <i className="fas fa-camera"></i>
                      <span>Open Camera</span>
                    </button>
                    <button type="button" className="photo-option-btn" onClick={() => openGallery('face')}>
                      <i className="fas fa-images"></i>
                      <span>Choose from Gallery</span>
                    </button>
                  </div>
                  {photos.face && (
                    <div className="photo-preview">
                      <img src={photos.face} alt="Face Preview" />
                      <button type="button" className="remove-photo-btn" onClick={() => removePhoto('face')}>
                        <i className="fas fa-times"></i>
                      </button>
                    </div>
                  )}
                  <input
                    type="file"
                    id="photoSearchFace"
                    accept="image/*"
                    style={{ display: 'none' }}
                    required
                    onChange={() => handlePhotoChange('face')}
                  />
                </div>
              </div>

              <button type="submit" className="submit-btn">Find Scholarships</button>
            </form>
          </div>
        </div>
      )}

      {/* Camera Modal */}
      <div className={`camera-modal ${showCameraModal ? 'active' : ''}`}>
        <div className="camera-container">
          <div className="camera-header">
            <h3>Take Face Verification Photo</h3>
            <button className="close-camera-btn" onClick={closeCamera}>
              <i className="fas fa-times"></i>
            </button>
          </div>

          {/* Camera Feed */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            style={{ display: cameraReady ? 'block' : 'none' }}
          />

          {/* Camera Controls */}
          <div className="camera-controls" style={{ display: cameraReady ? 'flex' : 'none' }}>
            <button className="capture-btn" onClick={capturePhoto}>
              <i className="fas fa-camera"></i> Capture
            </button>
            <button className="switch-camera-btn" onClick={switchCamera}>
              <i className="fas fa-sync-alt"></i> Switch Camera
            </button>
            <button className="switch-camera-btn" onClick={closeCamera} style={{ background: 'var(--gray-2)', color: 'var(--text-dark)' }}>
              <i className="fas fa-times"></i> Close
            </button>
          </div>

          {/* Loading/Initializing indicator */}
          {cameraInitializing && (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              <div className="loading-spinner" style={{ width: '40px', height: '40px' }}></div>
              <p style={{ marginTop: '1rem', color: 'var(--text-soft)' }}>Initializing camera...</p>
              <button className="retry-btn" onClick={closeCamera} style={{ background: 'var(--gray-2)', color: 'var(--text-dark)', marginTop: '1.5rem' }}>
                Cancel
              </button>
            </div>
          )}

          {/* Error Message */}
          {cameraError && (
            <div className="camera-error">
              <i className="fas fa-exclamation-triangle"></i>
              <p>{cameraError.message}</p>
              <div style={{ fontSize: '0.8rem', margin: '0.5rem 0', opacity: '0.8' }}>
                {cameraError.details}
              </div>
              <button className="retry-btn" onClick={retryCamera}>Retry Camera</button>
              <button className="retry-btn" onClick={closeCamera} style={{ background: 'var(--gray-2)', color: 'var(--text-dark)', marginLeft: '0.5rem' }}>
                Close
              </button>
            </div>
          )}
        </div>
      </div>

      {/* RESULTS VIEW */}
      {showResultsView && (
        <div className="results-view active">
          <div className="results-header">
            <h2>Your Scholarship Matches</h2>
            <p>Based on your profile, we've found these opportunities tailored for you.</p>
          </div>
          <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
            <button className="back-to-form-btn" onClick={switchToFormView}>
              <i className="fas fa-arrow-left" style={{ marginRight: '8px' }}></i>
              Back to search form
            </button>
          </div>
          {successBanner && (
            <div className="success-banner">
              {successBanner}
            </div>
          )}
          <div className="scholarship-grid">
            {scholarshipMatches.length > 0 ? (
              scholarshipMatches.map((match, index) => (
                <div key={index} className="scholarship-card">
                  <h4>{match.name}</h4>
                  <div className="scholarship-provider">Provided by: {match.provider}</div>
                  <p>{match.description}</p>
                  <div className="scholarship-requirements">
                    <div className="requirement-badge">GPA: {match.gpaRequirement}</div>
                    <div className="requirement-badge">Income: {match.incomeRequirement}</div>
                  </div>
                  <div className="scholarship-benefits">{match.benefits}</div>
                  <button className="apply-btn" onClick={() => applyForScholarship(match.name)}>
                    Apply for this Scholarship
                  </button>
                </div>
              ))
            ) : (
              <div className="no-results">
                <i className="fas fa-search" style={{ fontSize: '2rem', opacity: '0.5', marginBottom: '1rem' }}></i>
                <p>No matching scholarships found. Please review your information and try again with different criteria.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Loading overlay */}
      <div className={`loading-overlay ${showLoadingOverlay ? 'active' : ''}`}>
        <div className="loading-modal">
          <div className="loading-spinner"></div>
          <h3>Searching</h3>
          <p>Finding the best scholarships for you...</p>
        </div>
      </div>
    </>
  );
};

export default FindScholarship;
