import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { applicantAPI, uploadProfilePicture } from '../services/api';

const Profile = () => {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [showEditForm, setShowEditForm] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState({ title: '', message: '' });
  const [error, setError] = useState(null);
  const [rawProfilePictureFile, setRawProfilePictureFile] = useState(null);
  const [formData, setFormData] = useState({
    firstName: '',
    middleName: '',
    lastName: '',
    birthdate: '',
    school: '',
    mobileNo: '',
    streetBrgy: '',
    townCityMunicipality: 'Lipa City',
    province: 'Batangas',
    zipCode: '4217',
    course: '',
    profile_picture: null
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

    // Load user data from API
    const loadUserProfile = async () => {
      const user = localStorage.getItem('currentUser');
      const email = user;

      if (!user) {
        navigate('/login');
        return;
      }

      setCurrentUser(user);
      setLoadingMessage({ title: 'Loading Profile', message: 'Retrieving your information from the database...' });
      setShowLoadingOverlay(true);
      setIsLoading(true);
      setError(null);

      try {
        const profile = await applicantAPI.getProfile();
        setUserProfile(profile);
        setShowEditForm(false);
      } catch (err) {
        // If no profile exists yet or any error, show edit form so the user can fill it in
        if (err.message.includes('404') || err.message.includes('not found') || err.message.includes('Profile not found')) {
          setUserProfile(null);
          setShowEditForm(true);
        } else {
          // Non-404 error: log it but still show the edit form so the page isn't blank
          setError(err.message);
          setUserProfile(null);
          setShowEditForm(true);
          console.error('Error loading profile:', err);
        }
      } finally {
        setIsLoading(false);
        setShowLoadingOverlay(false);
      }
    };

    loadUserProfile();

    return () => {
      document.head.removeChild(fontAwesomeLink);
      document.head.removeChild(googleFontsLink);
      document.head.removeChild(googleFontsDisplay);
      document.head.removeChild(googleFontsSheet);
    };
  }, [navigate]);

  useEffect(() => {
    if (currentUser && userProfile) {
      // Load existing profile data - handle snake_case and camelCase field names consistently
      setFormData({
        firstName: userProfile.first_name || userProfile.firstName || '',
        middleName: userProfile.middle_name || userProfile.middleName || '',
        lastName: userProfile.last_name || userProfile.lastName || '',
        birthdate: userProfile.birthdate || userProfile.dateOfBirth || '',
        school: userProfile.school || userProfile.schoolName || '',
        mobileNo: userProfile.mobile_no || userProfile.mobileNumber || '',
        streetBrgy: userProfile.street_brgy || userProfile.streetBarangay || '',
        townCityMunicipality: userProfile.town_city_municipality || userProfile.townCity || 'Lipa City',
        province: userProfile.province || 'Batangas',
        zipCode: userProfile.zip_code || userProfile.zipCode || '4217',
        course: userProfile.course || '',
        profile_picture: userProfile.profile_picture || null
      });
    } else if (currentUser) {
      // New user, show edit form
      setShowEditForm(true);
      setFormData({
        firstName: '',
        middleName: '',
        lastName: '',
        birthdate: '',
        school: '',
        mobileNo: '',
        streetBrgy: '',
        townCityMunicipality: 'Lipa City',
        province: 'Batangas',
        zipCode: '4217',
        course: '',
        profile_picture: null
      });
    }
  }, [currentUser, userProfile]);

  const handleProfilePictureUpload = (e) => {
    const file = e.target.files[0];
    if (file && window.compressImage) {
      setRawProfilePictureFile(file);
      window.compressImage(file, 400).then(compressedBase64 => {
        setFormData(prev => ({ ...prev, profile_picture: compressedBase64 }));
        // Logically update it in DB immediately on select for better UX, or wait for submit?
        // Let's wait for submit to be consistent with the rest of the form.
      });
    } else if (file) {
      setRawProfilePictureFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData(prev => ({ ...prev, profile_picture: reader.result }));
      };
      reader.readAsDataURL(file);
    }
  };


  const logout = () => {
    localStorage.removeItem('currentUser');
    navigate('/');
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleProfileSubmit = async (e) => {
    e.preventDefault();

    try {
      setLoadingMessage({ title: 'Updating Profile', message: 'Saving your changes to the database...' });
      setShowLoadingOverlay(true);
      // Use the exact names expected by the backend field_mapping
      let finalProfilePictureUrl = formData.profile_picture;
      if (rawProfilePictureFile) {
        try {
          setLoadingMessage({ title: 'Uploading Photo', message: 'Securing your profile picture...' });
          finalProfilePictureUrl = await uploadProfilePicture(rawProfilePictureFile);
        } catch (uploadError) {
          console.error('[PROFILE-PIC] Failed to upload to storage:', uploadError);
          // Fallback to dataURL/formData value if storage fails
        }
      }

      const profileData = {
        firstName: formData.firstName,
        middleName: formData.middleName,
        lastName: formData.lastName,
        dateOfBirth: formData.birthdate,
        schoolName: formData.school,
        mobileNumber: formData.mobileNo,
        streetBarangay: formData.streetBrgy,
        townCity: formData.townCityMunicipality,
        province: formData.province,
        zipCode: formData.zipCode,
        course: formData.course,
        profile_picture: finalProfilePictureUrl
      };

      // Update profile via API
      const updatedData = await applicantAPI.updateProfile(profileData);

      // Create a local merged profile to update UI immediately
      const locallyUpdatedProfile = {
        ...userProfile,
        first_name: formData.firstName,
        middle_name: formData.middleName,
        last_name: formData.lastName,
        birthdate: formData.birthdate,
        school: formData.school,
        mobile_no: formData.mobileNo,
        street_brgy: formData.streetBrgy,
        town_city_municipality: formData.townCityMunicipality,
        province: formData.province,
        zip_code: formData.zipCode,
        course: formData.course,
        profile_picture: formData.profile_picture || userProfile?.profile_picture || null
      };

      setUserProfile(locallyUpdatedProfile);

      // Show success modal
      setShowSuccessModal(true);

      // After success, wait briefly then close modal and hide loading overlay
      // We don't automatically close the edit form here to prevent UI flicker; 
      // the useEffect will handle the transition based on the userProfile state change if needed,
      // but typically we'll want a deliberate close.
      const isNewProfile = !userProfile?.town_city_municipality;

      setTimeout(() => {
        setShowSuccessModal(false);
        setShowEditForm(false);
        setShowLoadingOverlay(false);
        
        // Redirect new users to portal after first profile setup
        if (isNewProfile) {
          navigate('/portal');
        }
      }, 2000);
    } catch (err) {
      setError(err.message || 'Failed to update profile');
      console.error('Error updating profile:', err);
      setShowLoadingOverlay(false);
    }
  };

  const showEditProfile = () => {
    setShowEditForm(true);
  };

  const getFirstName = () => {
    return userProfile?.first_name || 'Student';
  };

  const formatBirthdate = (birthdate) => {
    if (!birthdate) return 'No birthdate provided';
    return new Date(birthdate).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
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
        }

        .loading-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.75);
          backdrop-filter: blur(10px);
          display: none;
          justify-content: center;
          align-items: center;
          z-index: 9999;
          animation: fadeIn 0.3s ease;
        }

        .loading-overlay.active {
          display: flex;
        }

        .loading-modal {
          background: white;
          padding: 3.5rem;
          border-radius: 40px;
          text-align: center;
          box-shadow: 0 25px 50px rgba(0, 0, 0, 0.4);
          max-width: 450px;
          width: 90%;
          border: 1px solid rgba(255, 255, 255, 0.2);
        }

        .loading-spinner {
          width: 60px;
          height: 60px;
          border: 6px solid #ffe8e3;
          border-top: 6px solid var(--primary);
          border-radius: 50%;
          margin: 0 auto 1.8rem;
          animation: spin 1s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
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

        .profile-btn {
          background: transparent;
          padding: 0.5rem 1.5rem;
          border-radius: 40px;
          border: 1.5px solid rgba(255, 255, 255, 0.3);
          color: white;
          font-weight: 600;
          font-size: 0.9rem;
          transition: all 0.2s;
          cursor: pointer;
          margin-right: 1rem;
        }

        .profile-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          border-color: rgba(255, 255, 255, 0.6);
          color: white;
        }

        .profile-container {
          max-width: 800px;
          margin: 2rem auto;
          padding: 0 1rem;
        }

        .profile-container h2 {
          color: var(--primary);
          font-size: 1.8rem;
          font-weight: 700;
          text-align: left;
          margin-bottom: 1.5rem;
        }

        .profile-picture-upload {
          display: flex;
          align-items: center;
          gap: 2rem;
          margin-bottom: 2rem;
        }

        .profile-pic {
          width: 100px;
          height: 100px;
          border-radius: 50%;
          background: var(--gray-1);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 2.5rem;
          color: var(--text-soft);
          border: 3px solid var(--gray-2);
          position: relative;
          overflow: hidden;
        }

        .profile-display-section {
          background: var(--white);
          padding: 2.5rem;
          border-radius: 24px;
          box-shadow: var(--shadow-sm);
          border: var(--border-light);
          margin-bottom: 2rem;
        }

        .profile-display-header {
          display: flex;
          align-items: center;
          gap: 2rem;
          margin-bottom: 2rem;
          padding-bottom: 2rem;
          border-bottom: 1px solid var(--gray-2);
        }

        .profile-info h3 {
          color: var(--primary);
          font-size: 1.8rem;
          font-weight: 700;
          margin-bottom: 0.5rem;
        }

        .profile-info p {
          color: var(--text-soft);
          font-size: 0.95rem;
          margin-bottom: 0.3rem;
        }

        .profile-info .email {
          color: var(--primary);
          font-weight: 500;
        }

        .profile-details {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 1.5rem;
        }

        .detail-item {
          padding: 1rem;
          background: var(--gray-1);
          border-radius: 12px;
          border: 1px solid var(--gray-2);
        }

        .detail-item .label {
          font-size: 0.8rem;
          color: var(--text-soft);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 0.5rem;
        }

        .detail-item .value {
          font-size: 1rem;
          color: var(--text-dark);
          font-weight: 500;
        }

        .edit-profile-btn {
          background: var(--primary);
          color: white;
          border: none;
          padding: 0.8rem 2rem;
          border-radius: 40px;
          font-weight: 600;
          font-size: 0.95rem;
          cursor: pointer;
          transition: all 0.2s;
          box-shadow: var(--shadow-sm);
          margin-top: 1rem;
        }

        .edit-profile-btn:hover {
          background: #3d0a00;
          transform: translateY(-2px);
          box-shadow: var(--shadow-md);
        }

        .form-section {
          display: none;
        }

        .form-section.active {
          display: block;
        }

        .welcome-header {
          text-align: center;
          margin: 2rem 0 3rem 0;
          padding: 2rem;
          background: linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%);
          border-radius: 20px;
          color: white;
          box-shadow: var(--shadow-md);
        }

        .welcome-header h2 {
          color: white;
          font-size: 2rem;
          font-weight: 700;
          margin-bottom: 0.5rem;
          text-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        .welcome-header p {
          color: rgba(255,255,255,0.9);
          font-size: 1.1rem;
          margin: 0;
        }

        .welcome-header span {
          color: #ffb199;
          font-weight: 800;
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

        .form-group input, .form-group textarea, .form-group select {
          width: 100%;
          padding: 0.9rem 1.2rem;
          border: 1.5px solid var(--gray-2);
          border-radius: 18px;
          font-size: 0.95rem;
          transition: 0.15s;
          background: var(--gray-1);
          font-family: 'Inter', sans-serif;
        }

        .form-group input:focus, .form-group textarea:focus, .form-group select:focus {
          outline: none;
          border-color: var(--accent);
          background: var(--white);
          box-shadow: 0 0 0 4px rgba(79,13,0,0.08);
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
        }

        .back-button:hover {
          background: #f1f5f9;
          border-color: var(--gray-3);
        }

        .success-modal {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          z-index: 1000;
          align-items: center;
          justify-content: center;
        }

        .success-modal.active {
          display: flex;
        }

        .success-modal .modal-content {
          background: white;
          padding: 2rem;
          border-radius: 20px;
          text-align: center;
          box-shadow: var(--shadow-lg);
          max-width: 400px;
        }

        .success-modal h3 {
          color: var(--success);
          font-size: 1.5rem;
          margin-bottom: 1rem;
        }

        .success-modal p {
          color: var(--text-soft);
          margin-bottom: 1.5rem;
        }

        .success-modal .close-btn {
          background: var(--success);
          color: white;
          border: none;
          padding: 0.8rem 2rem;
          border-radius: 40px;
          font-weight: 600;
          cursor: pointer;
        }

        @media (max-width: 1024px) {
          .profile-container {
            max-width: 100%;
            padding: 0 2rem;
          }
          
          .profile-display-section {
            padding: 2rem;
          }
          
          .profile-edit-section {
            padding: 2rem;
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
          
          .profile-container {
            padding: 0 1rem;
          }
          
          .welcome-header {
            margin: 1rem 0 2rem 0;
            padding: 1.5rem;
          }
          
          .welcome-header h2 {
            font-size: 1.6rem;
          }
          
          .welcome-header p {
            font-size: 1rem;
          }
          
          .profile-display-section {
            padding: 1.5rem;
          }
          
          .profile-display-header {
            flex-direction: column;
            text-align: center;
            gap: 1.5rem;
          }
          
          .profile-pic {
            width: 120px;
            height: 120px;
          }
          
          .profile-info h3 {
            font-size: 1.4rem;
          }
          
          .profile-info p {
            font-size: 1rem;
          }
          
          .profile-edit-section {
            padding: 1.5rem;
          }
          
          .form-row {
            flex-direction: column;
            gap: 0;
          }
          
          .form-group {
            margin-bottom: 1rem;
          }
          
          .form-group label {
            font-size: 0.85rem;
          }
          
          .form-group input,
          .form-group select,
          .form-group textarea {
            padding: 0.8rem 1rem;
            font-size: 0.9rem;
          }
          
          .photo-upload-section {
            padding: 1.5rem;
          }
          
          .photo-upload-section h4 {
            font-size: 1rem;
          }
          
          .photo-upload-area {
            padding: 1.5rem;
          }
          
          .photo-preview {
            width: 120px;
            height: 120px;
          }
          
          .form-actions {
            flex-direction: column;
            gap: 1rem;
          }
          
          .save-btn,
          .cancel-btn {
            width: 100%;
            padding: 0.8rem;
          }
        }

        @media (max-width: 480px) {
          .navbar {
            padding: 0.8rem 3%;
          }
          
          .navbar-menu span {
            font-size: 0.85rem;
          }
          
          .profile-container {
            padding: 0 0.5rem;
          }
          
          .welcome-header {
            padding: 1rem;
          }
          
          .welcome-header h2 {
            font-size: 1.4rem;
          }
          
          .welcome-header p {
            font-size: 0.9rem;
          }
          
          .profile-display-section {
            padding: 1rem;
          }
          
          .profile-pic {
            width: 100px;
            height: 100px;
          }
          
          .profile-info h3 {
            font-size: 1.2rem;
          }
          
          .profile-info p {
            font-size: 0.9rem;
          }
          
          .profile-edit-section {
            padding: 1rem;
          }
          
          .form-group input,
          .form-group select,
          .form-group textarea {
            padding: 0.7rem 0.9rem;
            font-size: 0.85rem;
          }
          
          .photo-upload-section {
            padding: 1rem;
          }
          
          .photo-upload-area {
            padding: 1rem;
          }
          
          .photo-preview {
            width: 100px;
            height: 100px;
          }
          
          .save-btn,
          .cancel-btn {
            padding: 0.7rem;
            font-size: 0.9rem;
          }
        }
      `}</style>

      <nav className="navbar">
        <Link to="/" className="navbar-brand">iskoMats</Link>
        <div className="navbar-menu">
          <span>{currentUser}</span>
          <button className="profile-btn" onClick={() => navigate('/profile')}>Profile</button>
          <button className="logout-btn" onClick={logout}>
            <i className="fas fa-sign-out-alt" style={{ marginRight: '6px' }}></i>Logout
          </button>
        </div>
      </nav>

      {/* Profile Display Section */}
      <section>
        <div className="profile-container">
          <button className="back-button" onClick={() => navigate('/portal')}>
            <i className="fas fa-arrow-left"></i> Back to Portal
          </button>

          {/* Welcome Header */}
          <div className="welcome-header">
            <h2>Welcome, <span>{getFirstName()}</span>!</h2>
            <p>Manage your profile and keep your information up to date</p>
          </div>

          {/* Profile Display View */}
          {userProfile && !showEditForm && (
            <div className="form-section active">
              <div className="profile-display-header">
                <div className="profile-pic">
                  {userProfile.profile_picture ? (
                    <img src={userProfile.profile_picture} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <i className="fas fa-user-circle"></i>
                  )}
                </div>
                <div className="profile-info">
                  <h3>
                    {userProfile.first_name && userProfile.last_name ? `${userProfile.first_name} ${userProfile.last_name}` : 'No name provided'}
                    {userProfile.email_verified && (
                      <i className="fas fa-check-circle" style={{ color: '#28a745', fontSize: '1.1rem', marginLeft: '8px' }} title="Verified Account"></i>
                    )}
                  </h3>
                  <p className="email">{currentUser}</p>
                </div>
              </div>

              <div className="profile-details">

              <div className="form-group">
                <label>First name</label>
                <input
                  type="text"
                  value={userProfile.first_name || ''}
                  disabled
                  style={{ backgroundColor: 'var(--gray-1)', cursor: 'not-allowed' }}
                />
              </div>
              <div className="form-group">
                <label>Middle name</label>
                <input
                  type="text"
                  value={userProfile.middle_name || ''}
                  disabled
                  style={{ backgroundColor: 'var(--gray-1)', cursor: 'not-allowed' }}
                />
              </div>
              <div className="form-group">
                <label>Last name</label>
                <input
                  type="text"
                  value={userProfile.last_name || ''}
                  disabled
                  style={{ backgroundColor: 'var(--gray-1)', cursor: 'not-allowed' }}
                />
              </div>
              <div className="form-group">
                <label>Birthdate</label>
                <input
                  type="text"
                  value={formatBirthdate(userProfile.birthdate)}
                  disabled
                  style={{ backgroundColor: 'var(--gray-1)', cursor: 'not-allowed' }}
                />
              </div>
              <div className="form-group">
                <label>University / School</label>
                <input
                  type="text"
                  value={userProfile.school || ''}
                  disabled
                  style={{ backgroundColor: 'var(--gray-1)', cursor: 'not-allowed' }}
                />
              </div>
              <div className="form-group">
                <label>Phone number</label>
                <input
                  type="tel"
                  value={userProfile.mobile_no || ''}
                  disabled
                  style={{ backgroundColor: 'var(--gray-1)', cursor: 'not-allowed' }}
                />
              </div>
              <div className="form-group">
                <label>Street / Barangay</label>
                <input
                  type="text"
                  value={userProfile.street_brgy || ''}
                  disabled
                  style={{ backgroundColor: 'var(--gray-1)', cursor: 'not-allowed' }}
                />
              </div>
              <div className="form-group">
                <label>Town / City / Municipality</label>
                <input
                  type="text"
                  value={userProfile ? (userProfile.town_city_municipality || userProfile.townCity || 'Lipa City') : 'Lipa City'}
                  disabled
                  style={{ backgroundColor: '#f4f6fa', cursor: 'not-allowed', color: '#666' }}
                />
              </div>
              <div className="form-group">
                <label>Province</label>
                <input
                  type="text"
                  value={userProfile?.province || 'Batangas'}
                  disabled
                  style={{ backgroundColor: '#f4f6fa', cursor: 'not-allowed', color: '#666' }}
                />
              </div>
              <div className="form-group">
                <label>Zip Code</label>
                <input
                  type="text"
                  value={userProfile ? (userProfile.zip_code || userProfile.zipCode || '4217') : '4217'}
                  disabled
                  style={{ backgroundColor: '#f4f6fa', cursor: 'not-allowed', color: '#666' }}
                />
              </div>
              <div className="form-group">
                <label>Course / Program</label>
                <input
                  type="text"
                  value={userProfile?.course || 'Not specified'}
                  disabled
                  style={{ backgroundColor: '#f4f6fa', cursor: 'not-allowed', color: '#666' }}
                />
              </div>
              <button className="edit-profile-btn" onClick={showEditProfile} style={{ width: 'auto', marginTop: '1rem' }}>
                <i className="fas fa-edit" style={{ marginRight: '8px' }}></i> Edit Profile
              </button>
            </div>
          </div>
          )}

          {/* Profile Edit Form */}
          {showEditForm && (
            <div className="form-section active">
              <h2>{userProfile ? 'Edit Profile' : 'Complete Profile'}</h2>
              {error && <div style={{ color: 'var(--danger)', marginBottom: '1rem', padding: '0.8rem', backgroundColor: 'var(--danger-bg)', borderRadius: '8px' }}>{error}</div>}
              
              <div className="profile-picture-upload">
                <div className="profile-pic" style={{ width: '120px', height: '120px', position: 'relative' }}>
                  {formData.profile_picture ? (
                    <img src={formData.profile_picture} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <i className="fas fa-user"></i>
                  )}
                  <div style={{ 
                    position: 'absolute', 
                    bottom: 0, 
                    left: 0, 
                    right: 0, 
                    background: 'rgba(0,0,0,0.5)', 
                    color: 'white', 
                    fontSize: '0.7rem', 
                    padding: '4px 0',
                    cursor: 'pointer' 
                  }}>
                    <i className="fas fa-camera"></i> Change
                  </div>
                  <input 
                    type="file" 
                    accept="image/*" 
                    onChange={handleProfilePictureUpload}
                    style={{ 
                      position: 'absolute', 
                      top: 0, 
                      left: 0, 
                      width: '100%', 
                      height: '100%', 
                      opacity: 0, 
                      cursor: 'pointer' 
                    }} 
                  />
                </div>
                <div style={{ textAlign: 'left' }}>
                  <h4 style={{ color: 'var(--primary)', marginBottom: '0.5rem' }}>Profile Picture</h4>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-soft)' }}>Upload a formal 2x2 picture</p>
                </div>
              </div>

              <form onSubmit={handleProfileSubmit}>
                <div className="form-group">
                  <label>First name</label>
                  <input
                    type="text"
                    name="firstName"
                    value={formData.firstName}
                    onChange={handleInputChange}
                    placeholder="e.g., Maria"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Middle name</label>
                  <input
                    type="text"
                    name="middleName"
                    value={formData.middleName}
                    onChange={handleInputChange}
                    placeholder="e.g., Dela Cruz"
                  />
                </div>
                <div className="form-group">
                  <label>Last name</label>
                  <input
                    type="text"
                    name="lastName"
                    value={formData.lastName}
                    onChange={handleInputChange}
                    placeholder="e.g., Santos"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Birthdate</label>
                  <input
                    type="date"
                    name="birthdate"
                    value={formData.birthdate}
                    onChange={handleInputChange}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>University / School</label>
                  <select
                    name="school"
                    value={formData.school}
                    onChange={handleInputChange}
                    required
                  >
                    <option value="">Select School</option>
                    <option value="DLSL/De La Salle Lipa">DLSL/De La Salle Lipa</option>
                    <option value="NU/National University Lipa">NU/National University Lipa</option>
                    <option value="Batangas State University">Batangas State University</option>
                    <option value="Kolehiyo ng Lungsod ng Lipa">Kolehiyo ng Lungsod ng Lipa</option>
                    <option value="Philippine State College of Aeronautics">Philippine State College of Aeronautics</option>
                    <option value="Lipa City Colleges">Lipa City Colleges</option>
                    <option value="University of Batangas">University of Batangas</option>
                    <option value="New Era University">New Era University</option>
                    <option value="Batangas College of Arts and Sciences">Batangas College of Arts and Sciences</option>
                    <option value="Royal British College">Royal British College</option>
                    <option value="STI Academic Center">STI Academic Center</option>
                    <option value="AMA Computer College">AMA Computer College</option>
                    <option value="ICT-ED">ICT-ED</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Phone number</label>
                  <input
                    type="tel"
                    name="mobileNo"
                    value={formData.mobileNo}
                    onChange={handleInputChange}
                    placeholder="+63 ..."
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Street / Barangay</label>
                  <select
                    name="streetBrgy"
                    value={formData.streetBrgy}
                    onChange={handleInputChange}
                    required
                  >
                    <option value="">Select Barangay</option>
                    <option value="Adya">Adya</option>
                    <option value="Anilao">Anilao</option>
                    <option value="Anilao-Labac">Anilao-Labac</option>
                    <option value="Antipolo del Norte">Antipolo del Norte</option>
                    <option value="Antipolo del Sur">Antipolo del Sur</option>
                    <option value="Bagong Pook">Bagong Pook</option>
                    <option value="Balintawak">Balintawak</option>
                    <option value="Banaybanay">Banaybanay</option>
                    <option value="Bolbok">Bolbok</option>
                    <option value="Bugtong na Pulo">Bugtong na Pulo</option>
                    <option value="Bulacnin">Bulacnin</option>
                    <option value="Bulaklakan">Bulaklakan</option>
                    <option value="Calamias">Calamias</option>
                    <option value="Cumba">Cumba</option>
                    <option value="Dagatan">Dagatan</option>
                    <option value="Duhatan">Duhatan</option>
                    <option value="Halang">Halang</option>
                    <option value="Inosloban">Inosloban</option>
                    <option value="Kayumanggi">Kayumanggi</option>
                    <option value="Latag">Latag</option>
                    <option value="Lodlod">Lodlod</option>
                    <option value="Lumbang">Lumbang</option>
                    <option value="Mabini">Mabini</option>
                    <option value="Malagonlong">Malagonlong</option>
                    <option value="Malitlit">Malitlit</option>
                    <option value="Marauoy">Marauoy</option>
                    <option value="Mataas na Lupa">Mataas na Lupa</option>
                    <option value="Munting Pulo">Munting Pulo</option>
                    <option value="Pagolingin Bata">Pagolingin Bata</option>
                    <option value="Pagolingin East">Pagolingin East</option>
                    <option value="Pagolingin West">Pagolingin West</option>
                    <option value="Pangao">Pangao</option>
                    <option value="Pinagkawitan">Pinagkawitan</option>
                    <option value="Pinagtongulan">Pinagtongulan</option>
                    <option value="Plaridel">Plaridel</option>
                    <option value="Poblacion Barangay 1">Poblacion Barangay 1</option>
                    <option value="Poblacion Barangay 2">Poblacion Barangay 2</option>
                    <option value="Poblacion Barangay 3">Poblacion Barangay 3</option>
                    <option value="Poblacion Barangay 4">Poblacion Barangay 4</option>
                    <option value="Poblacion Barangay 5">Poblacion Barangay 5</option>
                    <option value="Poblacion Barangay 6">Poblacion Barangay 6</option>
                    <option value="Poblacion Barangay 7">Poblacion Barangay 7</option>
                    <option value="Poblacion Barangay 8">Poblacion Barangay 8</option>
                    <option value="Poblacion Barangay 9">Poblacion Barangay 9</option>
                    <option value="Poblacion Barangay 9-A">Poblacion Barangay 9-A</option>
                    <option value="Poblacion Barangay 10">Poblacion Barangay 10</option>
                    <option value="Poblacion Barangay 11">Poblacion Barangay 11</option>
                    <option value="Poblacion Barangay 12">Poblacion Barangay 12</option>
                    <option value="Pusil">Pusil</option>
                    <option value="Quezon">Quezon</option>
                    <option value="Rizal">Rizal</option>
                    <option value="Sabang">Sabang</option>
                    <option value="Sampaguita">Sampaguita</option>
                    <option value="San Benito">San Benito</option>
                    <option value="San Carlos">San Carlos</option>
                    <option value="San Celestino">San Celestino</option>
                    <option value="San Francisco">San Francisco</option>
                    <option value="San Guillermo">San Guillermo</option>
                    <option value="San Isidro">San Isidro</option>
                    <option value="San Jose">San Jose</option>
                    <option value="San Lucas">San Lucas</option>
                    <option value="San Salvador">San Salvador</option>
                    <option value="San Sebastian (Balagbag)">San Sebastian (Balagbag)</option>
                    <option value="Santo Niño">Santo Niño</option>
                    <option value="Santo Toribio">Santo Toribio</option>
                    <option value="Sico">Sico</option>
                    <option value="Talisay">Talisay</option>
                    <option value="Tambo">Tambo</option>
                    <option value="Tangob">Tangob</option>
                    <option value="Tanguay">Tanguay</option>
                    <option value="Tibig">Tibig</option>
                    <option value="Tipacan">Tipacan</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Town / City / Municipality</label>
                  <input
                    type="text"
                    name="townCityMunicipality"
                    value={formData.townCityMunicipality}
                    readOnly
                    style={{ backgroundColor: '#f0f0f0', cursor: 'not-allowed', color: '#666' }}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Province</label>
                  <input
                    type="text"
                    name="province"
                    value={formData.province}
                    readOnly
                    style={{ backgroundColor: '#f0f0f0', cursor: 'not-allowed', color: '#666' }}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Zip Code</label>
                  <input
                    type="text"
                    name="zipCode"
                    value={formData.zipCode}
                    readOnly
                    style={{ backgroundColor: '#f0f0f0', cursor: 'not-allowed', color: '#666' }}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Course / Program *</label>
                  <select
                    name="course"
                    value={formData.course}
                    onChange={handleInputChange}
                    required
                  >
                    <option value="">Select Course</option>
                    {["AB Communication", "Associate in Computer Technology", "Bachelor of Elementary Education", "Bachelor of Forensic Science", "Bachelor of Secondary Education", "BS Accountancy", "BS Accounting Information System", "BS Architecture", "BS Biology", "BS Computer Engineering", "BS Computer Science", "BS Electrical Engineering", "BS Electronics Engineering", "BS Entertainment and Multimedia Computing", "BS Entrepreneurship", "BS Hospitality Management", "BS Industrial Engineering", "BS Information Technology", "BS Legal Management", "BS Management Technology", "BS Nursing", "BS Psychology", "BS Tourism Management", "BSBA Financial Management", "BSBA Marketing Management", "Certificate in Entrepreneurship", "Cookery NC II (Culinary Arts)", "JURIS DOCTOR PROGRAM"].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <button type="submit" className="submit-btn">
                  {userProfile ? 'Update Profile →' : 'Create Profile →'}
                </button>
              </form>
            </div>
          )}
        </div>
      </section>

      {/* Modal success pop-up */}
      <div className={`success-modal ${showSuccessModal ? 'active' : ''}`}>
        <div className="modal-content">
          <h3 style={{color: 'var(--success)'}}>Profile Updated!</h3>
          <p>Your profile has been successfully saved.</p>
        </div>
      </div>

      {/* Loading overlay */}
      <div className={`loading-overlay ${showLoadingOverlay ? 'active' : ''}`}>
        <div className="loading-modal">
          <div className="loading-spinner"></div>
          <h3 style={{ color: 'var(--primary)', fontWeight: '800', fontSize: '1.8rem', marginBottom: '0.8rem' }}>
            {loadingMessage.title}
          </h3>
          <p style={{ color: 'var(--text-soft)', fontSize: '1rem' }}>
            {loadingMessage.message}
          </p>
        </div>
      </div>
    </>
  );
};

export default Profile;
