import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import SignaturePad from '../components/SignaturePad';

const StudentInfo = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [showSubmissionModal, setShowSubmissionModal] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [promptMessage, setPromptMessage] = useState('');
  const [idPicturePreview, setIdPicturePreview] = useState(null);
  const [signaturePreview, setSignaturePreview] = useState(null);
  const [drawnSignature, setDrawnSignature] = useState(null);
  const [hasOtherAssistance, setHasOtherAssistance] = useState('');
  const [scholarshipName, setScholarshipName] = useState('Scholarship Application');

  const idPictureInputRef = useRef(null);
  const signatureInputRef = useRef(null);

  const [formData, setFormData] = useState({
    // Personal Information
    lastName: '',
    firstName: '',
    middleName: '',
    maidenName: '',
    dateOfBirth: '',
    placeOfBirth: '',
    streetBarangay: '',
    townCity: '',
    province: '',
    zipCode: '',
    sex: '',
    citizenship: '',
    schoolIdNumber: '',
    schoolName: '',
    schoolAddress: '',
    schoolSector: '',
    mobileNumber: '',
    yearLevel: '',
    emailAddress: '',
    disability: '',
    
    // Family Background
    fatherStatus: '',
    fatherName: '',
    fatherOccupation: '',
    fatherAddress: '',
    motherStatus: '',
    motherName: '',
    motherOccupation: '',
    motherAddress: '',
    parentsGrossIncome: '',
    numberOfSiblings: '',
    hasOtherAssistance: '',
    assistance1: '',
    assistance2: '',
    
    // Documentary Requirements
    mayorCOE_photo: null,
    mayorCOE_video: null,
    mayorGrades_photo: null,
    mayorGrades_video: null,
    mayorIndigency_photo: null,
    mayorIndigency_video: null,
    mayorValidID_photo: null,
    mayorValidID_video: null,
    
    // Certification
    privacyConsent: false,
    dataCertifyConsent: false,
    applicantSignatureName: '',
    dateAccomplished: ''
  });

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

    // Get scholarship name from URL params
    const scholarship = searchParams.get('scholarship');
    if (scholarship) {
      setScholarshipName(scholarship);
    }

    // Pre-fill profile data
    if (profiles[user]) {
      const profile = profiles[user];
      setFormData(prev => ({
        ...prev,
        firstName: profile.firstName || profile.fullName?.split(' ')[0] || '',
        emailAddress: profile.email || user,
        schoolName: profile.university || '',
        mobileNumber: profile.phoneNumber || ''
      }));
    }

    return () => {
      document.head.removeChild(fontAwesomeLink);
      document.head.removeChild(googleFontsLink);
      document.head.removeChild(googleFontsDisplay);
      document.head.removeChild(googleFontsSheet);
    };
  }, [navigate, searchParams]);

  const logout = () => {
    localStorage.removeItem('currentUser');
    navigate('/');
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked, files } = e.target;
    
    if (type === 'checkbox') {
      setFormData(prev => ({
        ...prev,
        [name]: checked
      }));
    } else if (type === 'file') {
      setFormData(prev => ({
        ...prev,
        [name]: files[0] || null
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: value
      }));

      // Handle assistance fields toggle
      if (name === 'hasOtherAssistance') {
        setHasOtherAssistance(value);
        if (value !== 'Yes') {
          setFormData(prev => ({
            ...prev,
            assistance1: '',
            assistance2: ''
          }));
        }
      }
    }
  };

  const handleIdPictureUpload = (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setIdPicturePreview(ev.target.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSignatureUpload = (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setSignaturePreview(ev.target.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const showPromptMessage = (message, duration = 3000) => {
    setPromptMessage(message);
    setShowPrompt(true);
    setTimeout(() => {
      setShowPrompt(false);
    }, duration);
  };

  const handleApplicationSubmit = (e) => {
    e.preventDefault();

    // Validate required fields
    const form = e.target;
    const requiredFields = form.querySelectorAll('[required]');
    let isMissing = false;

    requiredFields.forEach(field => {
      if (field.type === 'checkbox' && !field.checked) {
        isMissing = true;
        field.parentElement.style.color = '#e74c3c';
      } else if (!field.value.trim()) {
        isMissing = true;
        field.style.borderColor = '#e74c3c';
      }
    });

    // Check if either signature is uploaded or drawn
    if (!signaturePreview && !drawnSignature) {
      showPromptMessage('⚠️ Please either upload a signature photo or draw your signature.');
      return;
    }

    if (isMissing) {
      showPromptMessage('⚠️ Please fill in all required fields and accept the policies.');
      return;
    }

    // Save application
    let userApplications = JSON.parse(localStorage.getItem('userApplications')) || {};
    if (!userApplications[currentUser]) {
      userApplications[currentUser] = [];
    }

    userApplications[currentUser].push({
      name: scholarshipName,
      dateApplied: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      status: 'Pending'
    });

    localStorage.setItem('userApplications', JSON.stringify(userApplications));

    // Show submission modal
    setShowSubmissionModal(true);
    
    // Redirect after 3 seconds
    setTimeout(() => {
      navigate('/portal');
    }, 3000);
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
          --border: #e2e8f0;
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

        .form-group {
          margin-bottom: 1.5rem;
        }

        .form-group label {
          display: block;
          font-weight: 600;
          font-size: 0.85rem;
          margin-bottom: 0.5rem;
          color: #444;
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
          background: var(--primary);
          color: white;
          border: none;
          border-radius: 8px;
          font-weight: 700;
          font-size: 1rem;
          cursor: pointer;
          transition: all 0.2s;
          box-shadow: 0 4px 12px rgba(79, 13, 0, 0.2);
        }

        .submit-btn:hover {
          background: #3a0a00;
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(79, 13, 0, 0.3);
        }

        .back-to-form-btn {
          color: var(--text-soft);
          border: none;
          cursor: pointer;
          font-size: 0.95rem;
          font-weight: 500;
          transition: color 0.2s;
        }

        .back-to-form-btn:hover {
          color: var(--primary);
        }

        .submission-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.4);
          backdrop-filter: blur(8px);
          display: none;
          justify-content: center;
          align-items: center;
          z-index: 1000;
          animation: fadeIn 0.3s ease-out;
        }

        .submission-modal-overlay.active {
          display: flex;
        }

        .submission-modal {
          background: white;
          padding: 2.5rem;
          border-radius: 30px;
          max-width: 500px;
          width: 90%;
          text-align: center;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.15);
          transform: translateY(20px);
          animation: slideUp 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
        }

        .success-icon-wrapper {
          width: 80px;
          height: 80px;
          background: #e6f7ec;
          color: #28a745;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 2.5rem;
          margin: 0 auto 1.5rem;
          animation: scaleIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) 0.1s both;
        }

        .submission-modal h2 {
          color: var(--primary);
          font-size: 1.8rem;
          margin-bottom: 1rem;
          font-weight: 800;
        }

        .submission-modal p {
          color: var(--text-soft);
          font-size: 1rem;
          line-height: 1.6;
          margin-bottom: 2rem;
        }

        .redirect-status {
          font-size: 0.85rem;
          color: #999;
          font-weight: 500;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }

        .loader-dots {
          display: inline-flex;
          gap: 4px;
        }

        .dot {
          width: 4px;
          height: 4px;
          background: #cbd5e0;
          border-radius: 50%;
          animation: dotLoading 1.4s infinite;
        }

        .dot:nth-child(2) {
          animation-delay: 0.2s;
        }

        .dot:nth-child(3) {
          animation-delay: 0.4s;
        }

        .small-prompt {
          position: fixed;
          bottom: 20px;
          right: 20px;
          background: #333;
          color: white;
          padding: 10px 20px;
          border-radius: 30px;
          font-size: 0.9rem;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
          z-index: 1001;
          opacity: 0;
          transition: opacity 0.3s;
          pointer-events: none;
        }

        .small-prompt.show {
          opacity: 1;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes slideUp {
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }

        @keyframes scaleIn {
          from { transform: scale(0); }
          to { transform: scale(1); }
        }

        @keyframes dotLoading {
          0%, 80%, 100% { opacity: 0; }
          40% { opacity: 1; }
        }

        @media (max-width: 1024px) {
          .form-container {
            padding: 2rem;
            gap: 2rem;
          }
          
          .form-section {
            padding: 1.5rem;
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
          
          .form-container {
            padding: 1.5rem;
            gap: 1.5rem;
          }
          
          .form-header {
            margin-bottom: 1.5rem;
          }
          
          .form-header h2 {
            font-size: 1.6rem;
          }
          
          .form-header p {
            font-size: 0.9rem;
          }
          
          .form-section {
            padding: 1.5rem;
          }
          
          .form-section h3 {
            font-size: 1.1rem;
            flex-direction: column;
            text-align: center;
            gap: 0.5rem;
          }
          
          .form-row {
            grid-template-columns: 1fr;
            gap: 1rem;
          }
          
          .form-group label {
            font-size: 0.8rem;
          }
          
          .form-group input,
          .form-group select,
          .form-group textarea {
            padding: 0.8rem 1rem;
            font-size: 0.9rem;
          }
          
          .photo-upload-area {
            padding: 1rem;
            text-align: center;
          }
          
          .photo-preview {
            width: 120px;
            height: 120px;
          }
          
          .signature-upload-area {
            flex-direction: column;
            text-align: center;
            gap: 1rem;
          }
          
          .signature-preview-box {
            width: 150px;
            height: 80px;
          }
          
          .submission-modal {
            padding: 2rem;
            max-width: 400px;
          }
          
          .submission-modal h2 {
            font-size: 1.5rem;
          }
          
          .submission-modal p {
            font-size: 0.9rem;
          }
        }

        @media (max-width: 480px) {
          .navbar {
            padding: 0.8rem 3%;
          }
          
          .navbar-menu span {
            font-size: 0.85rem;
          }
          
          .form-container {
            padding: 1rem;
            gap: 1rem;
          }
          
          .form-header {
            margin-bottom: 1rem;
          }
          
          .form-header h2 {
            font-size: 1.4rem;
          }
          
          .form-header p {
            font-size: 0.85rem;
          }
          
          .form-section {
            padding: 1rem;
          }
          
          .form-section h3 {
            font-size: 1rem;
          }
          
          .form-group input,
          .form-group select,
          .form-group textarea {
            padding: 0.7rem 0.9rem;
            font-size: 0.85rem;
          }
          
          .photo-preview {
            width: 100px;
            height: 100px;
          }
          
          .signature-preview-box {
            width: 120px;
            height: 60px;
          }
          
          .submission-modal {
            padding: 1.5rem;
            max-width: 320px;
          }
          
          .submission-modal h2 {
            font-size: 1.3rem;
          }
          
          .submission-modal p {
            font-size: 0.85rem;
          }
          
          .success-icon-wrapper {
            width: 60px;
            height: 60px;
            font-size: 2rem;
          }
        }
      `}</style>

      <nav className="navbar">
        <Link to="/portal" className="navbar-brand">iskoMats</Link>
        <div className="navbar-menu">
          <span>{currentUser}</span>
          <button className="logout-btn" onClick={logout}>
            <i className="fas fa-sign-out-alt" style={{marginRight: '6px'}}></i>Logout
          </button>
        </div>
      </nav>

      {/* Small prompt element */}
      <div className={`small-prompt ${showPrompt ? 'show' : ''}`}>
        {promptMessage}
      </div>

      <div style={{maxWidth: '800px', margin: '2rem auto', padding: '0', background: 'transparent', borderRadius: '24px'}}>
        <form onSubmit={handleApplicationSubmit} style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', columnGap: '2rem'}}>

          {/* Unified Scholarship Application Form */}
          <div style={{gridColumn: '1 / -1', marginTop: '2rem', padding: '2.5rem', background: '#fffefe', borderRadius: '24px', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)'}}>
            <div style={{textAlign: 'center', marginBottom: '2.5rem'}}>
              <img src="/iskologo.png" alt="Logo" style={{height: '60px', marginBottom: '1rem', filter: 'grayscale(1) contrast(1.2)'}} />
              <h2 style={{color: 'var(--primary)', fontSize: '1.6rem', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '1px'}}>
                {scholarshipName}
              </h2>
              <p style={{color: 'var(--text-soft)', fontSize: '0.95rem'}}>
                Please provide accurate and complete information below to apply for your chosen scholarship.
              </p>
            </div>

            {/* 1. Personal Information */}
            <div style={{marginBottom: '3rem'}}>
              <h3 style={{marginBottom: '1.5rem', fontSize: '1.2rem', color: 'var(--primary)', fontWeight: '700', borderBottom: '2px solid var(--accent-soft)', paddingBottom: '0.5rem', display: 'flex', alignItems: 'center'}}>
                <i className="fas fa-user" style={{marginRight: '12px', fontSize: '1.1rem'}}></i>1. Personal Information
              </h3>

              {/* 2x2 ID Picture */}
              <div style={{marginBottom: '2rem', textAlign: 'center'}}>
                <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                  2x2 ID Picture <span style={{color: '#e74c3c'}}>*</span>
                </label>
                <div style={{border: '2px dashed #ccc', borderRadius: '12px', height: '150px', width: '150px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'white', position: 'relative', overflow: 'hidden'}}>
                  <input type="file" accept="image/*" required onChange={handleIdPictureUpload} style={{position: 'absolute', width: '100%', height: '100%', opacity: '0', cursor: 'pointer', zIndex: '2'}} />
                  <div style={{textAlign: 'center', color: '#999', fontSize: '0.85rem', pointerEvents: 'none'}}>
                    {idPicturePreview ? (
                      <img src={idPicturePreview} style={{width: '100%', height: '100%', objectFit: 'cover', borderRadius: '10px'}} alt="ID Preview" />
                    ) : (
                      <>
                        <i className="fas fa-camera" style={{fontSize: '2rem', marginBottom: '0.5rem', display: 'block'}}></i>
                        <span>Upload 2x2 ID Picture</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Name Fields */}
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '1.2rem', marginBottom: '1.2rem'}}>
                <div className="form-group">
                  <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                    Last Name <span style={{color: '#e74c3c'}}>*</span>
                  </label>
                  <input type="text" name="lastName" value={formData.lastName} onChange={handleInputChange} placeholder="Last Name" required />
                </div>
                <div className="form-group">
                  <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                    First Name <span style={{color: '#e74c3c'}}>*</span>
                  </label>
                  <input type="text" name="firstName" value={formData.firstName} onChange={handleInputChange} placeholder="First Name" required />
                </div>
                <div className="form-group">
                  <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                    Middle Name <span style={{color: '#e74c3c'}}>*</span>
                  </label>
                  <input type="text" name="middleName" value={formData.middleName} onChange={handleInputChange} placeholder="Middle Name" required />
                </div>
                <div className="form-group">
                  <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                    Maiden Name (for married women)
                  </label>
                  <input type="text" name="maidenName" value={formData.maidenName} onChange={handleInputChange} placeholder="Maiden Name (optional)" />
                </div>
              </div>

              {/* Date of Birth */}
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.2rem', marginBottom: '1.2rem'}}>
                <div className="form-group">
                  <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                    Date of Birth (mm/dd/yyyy) <span style={{color: '#e74c3c'}}>*</span>
                  </label>
                  <input type="date" name="dateOfBirth" value={formData.dateOfBirth} onChange={handleInputChange} required />
                </div>
                <div className="form-group">
                  <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                    Place of Birth <span style={{color: '#e74c3c'}}>*</span>
                  </label>
                  <input type="text" name="placeOfBirth" value={formData.placeOfBirth} onChange={handleInputChange} placeholder="Place of Birth" required />
                </div>
              </div>

              {/* Permanent Address */}
              <div style={{marginBottom: '1.2rem'}}>
                <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                  Permanent Address <span style={{color: '#e74c3c'}}>*</span>
                </label>
                <div style={{display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '1.2rem'}}>
                  <div className="form-group">
                    <input type="text" name="streetBarangay" value={formData.streetBarangay} onChange={handleInputChange} placeholder="Street & Barangay" required />
                  </div>
                  <div className="form-group">
                    <input type="text" name="townCity" value={formData.townCity} onChange={handleInputChange} placeholder="Town/City/Municipality" required />
                  </div>
                  <div className="form-group">
                    <input type="text" name="province" value={formData.province} onChange={handleInputChange} placeholder="Province" required />
                  </div>
                  <div className="form-group">
                    <input type="text" name="zipCode" value={formData.zipCode} onChange={handleInputChange} placeholder="Zip Code" required />
                  </div>
                </div>
              </div>

              {/* Sex and Place of Birth */}
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.2rem', marginBottom: '1.2rem'}}>
                <div className="form-group">
                  <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                    Sex <span style={{color: '#e74c3c'}}>*</span>
                  </label>
                  <select name="sex" value={formData.sex} onChange={handleInputChange} required>
                    <option value="">Select sex</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </select>
                </div>
                <div className="form-group">
                  <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                    Citizenship <span style={{color: '#e74c3c'}}>*</span>
                  </label>
                  <input type="text" name="citizenship" value={formData.citizenship} onChange={handleInputChange} placeholder="Citizenship" required />
                </div>
              </div>

              {/* School Information */}
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.2rem', marginBottom: '1.2rem'}}>
                <div className="form-group">
                  <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                    School ID Number <span style={{color: '#e74c3c'}}>*</span>
                  </label>
                  <input type="text" name="schoolIdNumber" value={formData.schoolIdNumber} onChange={handleInputChange} placeholder="School ID Number" required />
                </div>
                <div className="form-group">
                  <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                    Name of School Attended <span style={{color: '#e74c3c'}}>*</span>
                  </label>
                  <input type="text" name="schoolName" value={formData.schoolName} onChange={handleInputChange} placeholder="School Name" required />
                </div>
                <div className="form-group">
                  <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                    School Address <span style={{color: '#e74c3c'}}>*</span>
                  </label>
                  <input type="text" name="schoolAddress" value={formData.schoolAddress} onChange={handleInputChange} placeholder="School Address" required />
                </div>
              </div>

              {/* School Sector and Year Level */}
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.2rem', marginBottom: '1.2rem'}}>
                <div className="form-group">
                  <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                    School Sector <span style={{color: '#e74c3c'}}>*</span>
                  </label>
                  <select name="schoolSector" value={formData.schoolSector} onChange={handleInputChange} required>
                    <option value="">Select school sector</option>
                    <option value="Public">Public</option>
                    <option value="Private">Private</option>
                  </select>
                </div>
                <div className="form-group">
                  <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                    Mobile Number <span style={{color: '#e74c3c'}}>*</span>
                  </label>
                  <input type="tel" name="mobileNumber" value={formData.mobileNumber} onChange={handleInputChange} placeholder="+63 XXX XXX XXXX" required />
                </div>
                <div className="form-group">
                  <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                    Year Level <span style={{color: '#e74c3c'}}>*</span>
                  </label>
                  <select name="yearLevel" value={formData.yearLevel} onChange={handleInputChange} required>
                    <option value="">Select year level</option>
                    <option>1st Year</option>
                    <option>2nd Year</option>
                    <option>3rd Year</option>
                    <option>4th Year</option>
                    <option>5th Year</option>
                  </select>
                </div>
              </div>

              {/* Email Address and Disability */}
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.2rem', marginBottom: '1.2rem'}}>
                <div className="form-group">
                  <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                    E-mail Address <span style={{color: '#e74c3c'}}>*</span>
                  </label>
                  <input type="email" name="emailAddress" value={formData.emailAddress} onChange={handleInputChange} placeholder="email@example.com" required style={{width: '100%', padding: '0.9rem 1.2rem', border: '1.5px solid var(--gray-2)', borderRadius: '18px', fontSize: '0.95rem', background: 'var(--gray-1)'}} />
                </div>
                <div className="form-group">
                  <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                    Type of Disability (if applicable)
                  </label>
                  <input type="text" name="disability" value={formData.disability} onChange={handleInputChange} placeholder="N/A if none" />
                </div>
              </div>
            </div>

            {/* 2. Family Background */}
            <div style={{marginBottom: '3rem'}}>
              <h3 style={{marginBottom: '1.5rem', fontSize: '1.2rem', color: 'var(--primary)', fontWeight: '700', borderBottom: '2px solid var(--accent-soft)', paddingBottom: '0.5rem', display: 'flex', alignItems: 'center'}}>
                <i className="fas fa-users" style={{marginRight: '12px', fontSize: '1.1rem'}}></i>2. Family Background
              </h3>

              {/* Father Information */}
              <div style={{marginBottom: '2rem'}}>
                <h4 style={{fontSize: '1rem', color: '#333', fontWeight: '600', marginBottom: '1rem', borderLeft: '3px solid var(--primary)', paddingLeft: '10px'}}>
                  Father
                </h4>
                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.2rem', marginBottom: '1rem'}}>
                  <div className="form-group">
                    <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                      Status (Living / Deceased) <span style={{color: '#e74c3c'}}>*</span>
                    </label>
                    <select name="fatherStatus" value={formData.fatherStatus} onChange={handleInputChange} required>
                      <option value="">Select status</option>
                      <option value="Living">Living</option>
                      <option value="Deceased">Deceased</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                      Name <span style={{color: '#e74c3c'}}>*</span>
                    </label>
                    <input type="text" name="fatherName" value={formData.fatherName} onChange={handleInputChange} placeholder="Father's Full Name" required />
                  </div>
                  <div className="form-group">
                    <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                      Occupation <span style={{color: '#e74c3c'}}>*</span>
                    </label>
                    <input type="text" name="fatherOccupation" value={formData.fatherOccupation} onChange={handleInputChange} placeholder="Father's Occupation" required />
                  </div>
                </div>
                <div className="form-group">
                  <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                    Address <span style={{color: '#e74c3c'}}>*</span>
                  </label>
                  <input type="text" name="fatherAddress" value={formData.fatherAddress} onChange={handleInputChange} placeholder="Father's Address" required style={{width: '100%', padding: '0.9rem 1.2rem', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '0.9rem'}} />
                </div>
              </div>

              {/* Mother Information */}
              <div style={{marginBottom: '2rem'}}>
                <h4 style={{fontSize: '1rem', color: '#333', fontWeight: '600', marginBottom: '1rem', borderLeft: '3px solid var(--primary)', paddingLeft: '10px'}}>
                  Mother
                </h4>
                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.2rem', marginBottom: '1rem'}}>
                  <div className="form-group">
                    <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                      Status (Living / Deceased) <span style={{color: '#e74c3c'}}>*</span>
                    </label>
                    <select name="motherStatus" value={formData.motherStatus} onChange={handleInputChange} required>
                      <option value="">Select status</option>
                      <option value="Living">Living</option>
                      <option value="Deceased">Deceased</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                      Name <span style={{color: '#e74c3c'}}>*</span>
                    </label>
                    <input type="text" name="motherName" value={formData.motherName} onChange={handleInputChange} placeholder="Mother's Full Name" required />
                  </div>
                  <div className="form-group">
                    <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                      Occupation <span style={{color: '#e74c3c'}}>*</span>
                    </label>
                    <input type="text" name="motherOccupation" value={formData.motherOccupation} onChange={handleInputChange} placeholder="Mother's Occupation" required />
                  </div>
                </div>
                <div className="form-group">
                  <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                    Address <span style={{color: '#e74c3c'}}>*</span>
                  </label>
                  <input type="text" name="motherAddress" value={formData.motherAddress} onChange={handleInputChange} placeholder="Mother's Address" required style={{width: '100%', padding: '0.9rem 1.2rem', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '0.9rem'}} />
                </div>
              </div>

              {/* Other Information */}
              <div style={{marginBottom: '2rem'}}>
                <h4 style={{fontSize: '1rem', color: '#333', fontWeight: '600', marginBottom: '1rem', borderLeft: '3px solid var(--primary)', paddingLeft: '10px'}}>
                  Other Information
                </h4>
                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.2rem', marginBottom: '1rem'}}>
                  <div className="form-group">
                    <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                      Total Parents' Gross Income <span style={{color: '#e74c3c'}}>*</span>
                    </label>
                    <input type="text" name="parentsGrossIncome" value={formData.parentsGrossIncome} onChange={handleInputChange} placeholder="Enter total gross income" required />
                  </div>
                  <div className="form-group">
                    <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                      Number of Siblings in the Family <span style={{color: '#e74c3c'}}>*</span>
                    </label>
                    <input type="number" name="numberOfSiblings" value={formData.numberOfSiblings} onChange={handleInputChange} placeholder="Number of siblings" required min="0" />
                  </div>
                </div>
              </div>

              {/* Educational Financial Assistance */}
              <div>
                <h4 style={{fontSize: '1rem', color: '#333', fontWeight: '600', marginBottom: '1rem', borderLeft: '3px solid var(--primary)', paddingLeft: '10px'}}>
                  Are you enjoying other educational financial assistance? <span style={{color: '#e74c3c'}}>*</span>
                </h4>
                <div style={{display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1.2rem', marginBottom: '1rem'}}>
                  <div className="form-group">
                    <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                      Yes / No <span style={{color: '#e74c3c'}}>*</span>
                    </label>
                    <select name="hasOtherAssistance" value={formData.hasOtherAssistance} onChange={handleInputChange} required>
                      <option value="">Select option</option>
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                      If yes, specify:
                    </label>
                    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem'}}>
                      <input type="text" name="assistance1" value={formData.assistance1} onChange={handleInputChange} placeholder="Assistance 1" disabled={hasOtherAssistance !== 'Yes'} />
                      <input type="text" name="assistance2" value={formData.assistance2} onChange={handleInputChange} placeholder="Assistance 2" disabled={hasOtherAssistance !== 'Yes'} />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 3. Documentary Requirements */}
            <div>
              <h3 style={{marginBottom: '1.5rem', fontSize: '1.2rem', color: 'var(--primary)', fontWeight: '700', borderBottom: '2px solid var(--accent-soft)', paddingBottom: '0.5rem', display: 'flex', alignItems: 'center'}}>
                <i className="fas fa-file-invoice" style={{marginRight: '12px', fontSize: '1.1rem'}}></i>3. Documentary Requirements
              </h3>
              <p style={{color: 'var(--text-soft)', fontSize: '0.85rem', marginBottom: '2rem', background: 'var(--warning-bg)', padding: '0.8rem 1.2rem', borderRadius: '12px', borderLeft: '4px solid var(--warning)'}}>
                <i className="fas fa-info-circle" style={{marginRight: '8px'}}></i>Please upload <strong>BOTH</strong> photo and video captures for each requirement for verification.
              </p>

              {/* Requirements Grid */}
              <div style={{display: 'flex', flexDirection: 'column', gap: '2rem'}}>

                {/* COE */}
                <div style={{background: '#fdfdfd', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--gray-2)'}}>
                  <h4 style={{fontSize: '1rem', color: '#333', fontWeight: '700', marginBottom: '1.2rem', borderLeft: '3px solid var(--primary)', paddingLeft: '10px'}}>
                    Certificate of Enrollment for Current A.Y
                  </h4>
                  <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem'}}>
                    <div className="form-group">
                      <label style={{display: 'block', fontSize: '0.8rem', marginBottom: '0.5rem', color: '#666', fontWeight: '600'}}>
                        Photo (.png/jpg)
                      </label>
                      <input type="file" name="mayorCOE_photo" accept="image/*" onChange={handleInputChange} required />
                    </div>
                    <div className="form-group">
                      <label style={{display: 'block', fontSize: '0.8rem', marginBottom: '0.5rem', color: '#666', fontWeight: '600'}}>
                        Video (.mp4/mov)
                      </label>
                      <input type="file" name="mayorCOE_video" accept="video/*" onChange={handleInputChange} required />
                    </div>
                  </div>
                </div>

                {/* Grades */}
                <div style={{background: '#fdfdfd', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--gray-2)'}}>
                  <h4 style={{fontSize: '1rem', color: '#333', fontWeight: '700', marginBottom: '1.2rem', borderLeft: '3px solid var(--primary)', paddingLeft: '10px'}}>
                    Certified true copy of grades last semester
                  </h4>
                  <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem'}}>
                    <div className="form-group">
                      <label style={{display: 'block', fontSize: '0.8rem', marginBottom: '0.5rem', color: '#666', fontWeight: '600'}}>
                        Photo (.png/jpg)
                      </label>
                      <input type="file" name="mayorGrades_photo" accept="image/*" onChange={handleInputChange} required />
                    </div>
                    <div className="form-group">
                      <label style={{display: 'block', fontSize: '0.8rem', marginBottom: '0.5rem', color: '#666', fontWeight: '600'}}>
                        Video (.mp4/mov)
                      </label>
                      <input type="file" name="mayorGrades_video" accept="video/*" onChange={handleInputChange} required />
                    </div>
                  </div>
                </div>

                {/* Indigency */}
                <div style={{background: '#fdfdfd', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--gray-2)'}}>
                  <h4 style={{fontSize: '1rem', color: '#333', fontWeight: '700', marginBottom: '1.2rem', borderLeft: '3px solid var(--primary)', paddingLeft: '10px'}}>
                    Certificate of Indigency
                  </h4>
                  <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem'}}>
                    <div className="form-group">
                      <label style={{display: 'block', fontSize: '0.8rem', marginBottom: '0.5rem', color: '#666', fontWeight: '600'}}>
                        Photo (.png/jpg)
                      </label>
                      <input type="file" name="mayorIndigency_photo" accept="image/*" onChange={handleInputChange} required />
                    </div>
                    <div className="form-group">
                      <label style={{display: 'block', fontSize: '0.8rem', marginBottom: '0.5rem', color: '#666', fontWeight: '600'}}>
                        Video (.mp4/mov)
                      </label>
                      <input type="file" name="mayorIndigency_video" accept="video/*" onChange={handleInputChange} required />
                    </div>
                  </div>
                </div>

                {/* Valid ID */}
                <div style={{background: '#fdfdfd', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--gray-2)'}}>
                  <h4 style={{fontSize: '1rem', color: '#333', fontWeight: '700', marginBottom: '1.2rem', borderLeft: '3px solid var(--primary)', paddingLeft: '10px'}}>
                    Valid ID
                  </h4>
                  <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem'}}>
                    <div className="form-group">
                      <label style={{display: 'block', fontSize: '0.8rem', marginBottom: '0.5rem', color: '#666', fontWeight: '600'}}>
                        Photo (.png/jpg)
                      </label>
                      <input type="file" name="mayorValidID_photo" accept="image/*" onChange={handleInputChange} required />
                    </div>
                    <div className="form-group">
                      <label style={{display: 'block', fontSize: '0.8rem', marginBottom: '0.5rem', color: '#666', fontWeight: '600'}}>
                        Video (.mp4/mov)
                      </label>
                      <input type="file" name="mayorValidID_video" accept="video/*" onChange={handleInputChange} required />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 4. Privacy Notice & Consent */}
            <div style={{marginBottom: '3rem'}}>
              <h3 style={{marginBottom: '1.5rem', fontSize: '1.2rem', color: 'var(--primary)', fontWeight: '700', borderBottom: '2px solid var(--accent-soft)', paddingBottom: '0.5rem', display: 'flex', alignItems: 'center'}}>
                <i className="fas fa-shield-alt" style={{marginRight: '12px', fontSize: '1.1rem'}}></i>4. Privacy Notice & Consent
              </h3>

              <div style={{background: '#f8f9ff', padding: '1.5rem', borderRadius: '18px', border: '1px solid var(--border)', marginBottom: '1.5rem'}}>
                <p style={{margin: '0 0 1rem 0', fontSize: '0.9rem', color: '#333', lineHeight: '1.6'}}></p>
                <div className="form-group">
                  <label style={{display: 'flex', alignItems: 'flex-start', fontSize: '0.9rem', color: '#333', cursor: 'pointer'}}>
                    <input type="checkbox" name="privacyConsent" checked={formData.privacyConsent} onChange={handleInputChange} required style={{marginRight: '10px', marginTop: '4px', width: 'auto'}} />
                    <span>I consent to the collection and processing of my personal information as stated in the Privacy Notice</span>
                  </label>
                </div>
              </div>

              <div style={{background: '#f8f9ff', padding: '1.5rem', borderRadius: '18px', border: '1px solid var(--border)'}}>
                <p style={{margin: '0 0 1rem 0', fontSize: '0.9rem', color: '#333', lineHeight: '1.6'}}>
                  <strong>Applicant Consent:</strong> I certify that all information provided is true and correct. I understand that any false statement or submission of fraudulent documents will result in the disqualification of my application.
                </p>
                <div className="form-group">
                  <label style={{display: 'flex', alignItems: 'flex-start', fontSize: '0.9rem', color: '#333', cursor: 'pointer'}}>
                    <input type="checkbox" name="dataCertifyConsent" checked={formData.dataCertifyConsent} onChange={handleInputChange} required style={{marginRight: '10px', marginTop: '4px', width: 'auto'}} />
                    <span>I certify that all provided information is true and correct and I agree to the terms</span>
                  </label>
                </div>
              </div>
            </div>

            {/* 5. Certification & Signature */}
            <div style={{marginBottom: '2rem'}}>
              <h3 style={{marginBottom: '1.5rem', fontSize: '1.2rem', color: 'var(--primary)', fontWeight: '700', borderBottom: '2px solid var(--accent-soft)', paddingBottom: '0.5rem', display: 'flex', alignItems: 'center'}}>
                <i className="fas fa-signature" style={{marginRight: '12px', fontSize: '1.1rem'}}></i>5. Certification
              </h3>

              {/* Signature Photo Upload */}
              <div style={{marginBottom: '2rem'}}>
                <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.8rem', color: '#444', fontWeight: '600'}}>
                  Upload Signature Photo
                </label>
                <div style={{display: 'flex', alignItems: 'flex-start', gap: '2rem', flexWrap: 'wrap'}}>
                  <div style={{border: '2px dashed #ccc', borderRadius: '12px', height: '100px', width: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'white', position: 'relative'}}>
                    <input type="file" accept="image/*" onChange={handleSignatureUpload} style={{position: 'absolute', width: '100%', height: '100%', opacity: '0', cursor: 'pointer'}} />
                    <div style={{textAlign: 'center', color: '#999', fontSize: '0.8rem'}}>
                      {signaturePreview ? (
                        <img src={signaturePreview} style={{maxWidth: '100%', maxHeight: '80px', objectFit: 'contain'}} alt="Signature Preview" />
                      ) : (
                        <>
                          <i className="fas fa-pen-nib" style={{fontSize: '1.5rem', marginBottom: '0.3rem', display: 'block'}}></i>
                          <span>Signature Preview</span>
                        </>
                      )}
                    </div>
                  </div>
                  
                  {/* Signature Pad */}
                  <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
                    <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600', textAlign: 'center'}}>
                      OR Draw Your Signature
                    </label>
                    <SignaturePad 
                      onSignatureChange={setDrawnSignature}
                      width={200}
                      height={100}
                    />
                  </div>
                  
                  <div style={{flex: '1', minWidth: '200px'}}>
                    <p style={{margin: '0', fontSize: '0.8rem', color: '#666', fontStyle: 'italic'}}>
                      Please upload a clear photo of your signature on a white background OR draw your signature using the pad above.
                    </p>
                  </div>
                </div>
              </div>

              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem'}}>
                <div className="form-group">
                  <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                    Full Printed Name of Applicant <span style={{color: '#e74c3c'}}>*</span>
                  </label>
                  <input type="text" name="applicantSignatureName" value={formData.applicantSignatureName} onChange={handleInputChange} placeholder="Signature over Printed Name" required />
                </div>
                <div className="form-group">
                  <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                    Date Accomplished <span style={{color: '#e74c3c'}}>*</span>
                  </label>
                  <input type="date" name="dateAccomplished" value={formData.dateAccomplished} onChange={handleInputChange} required />
                </div>
              </div>
            </div>
          </div>

          {/* Submit Section */}
          <div style={{gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)'}}>
            <button type="button" className="back-to-form-btn" onClick={() => navigate('/findscholarship')} style={{margin: '0', padding: '0', background: 'transparent'}}>
              <i className="fas fa-arrow-left" style={{marginRight: '8px'}}></i>Back
            </button>
            <button type="submit" className="submit-btn" style={{margin: '0', width: 'auto', padding: '1rem 3.5rem', borderRadius: '40px'}}>
              Submit Application
            </button>
          </div>
        </form>
      </div>

      {/* Submission Modal */}
      <div className={`submission-modal-overlay ${showSubmissionModal ? 'active' : ''}`}>
        <div className="submission-modal">
          <div className="success-icon-wrapper">
            <i className="fas fa-check-circle"></i>
          </div>
          <h2>Application Submitted!</h2>
          <p>Wait for updates and announcements in your email to check if you've been accepted!</p>
          <div className="redirect-status">
            Redirecting to your portal
            <div className="loader-dots">
              <div className="dot"></div>
              <div className="dot"></div>
              <div className="dot"></div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default StudentInfo;
