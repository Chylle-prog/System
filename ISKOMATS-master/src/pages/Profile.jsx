import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { applicantAPI } from '../services/api';

const Profile = () => {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [showEditForm, setShowEditForm] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [profilePicture, setProfilePicture] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState({ title: '', message: '' });
  const [error, setError] = useState(null);
  const [formData, setFormData] = useState({
    firstName: '',
    middleName: '',
    lastName: '',
    birthdate: '',
    school: '',
    mobileNo: '',
    streetBrgy: '',
    townCityMunicipality: '',
    province: '',
    zipCode: '',
    profilePicture: null
  });

  const profilePictureInputRef = useRef(null);

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
        // Load existing profile picture for display
        if (profile.profile_picture) {
          setProfilePicture(profile.profile_picture);
        }
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
      // Load existing profile data - handle both old and new field names
      setFormData({
        firstName: userProfile.first_name || '',
        middleName: userProfile.middle_name || '',
        lastName: userProfile.last_name || '',
        birthdate: userProfile.birthdate || '',
        school: userProfile.school || '',
        mobileNo: userProfile.mobile_no || '',
        streetBrgy: userProfile.street_brgy || '',
        townCityMunicipality: userProfile.town_city_municipality || '',
        province: userProfile.province || '',
        zipCode: userProfile.zip_code || '',
        profilePicture: null
      });
      // Restore saved profile picture (base64 from backend), don't reset to null
      setProfilePicture(userProfile.profile_picture || null);
      setShowEditForm(false);
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
        townCityMunicipality: '',
        province: '',
        zipCode: '',
        profilePicture: null
      });
      setProfilePicture(null);
    }
  }, [currentUser, userProfile]);


  const logout = () => {
    localStorage.removeItem('currentUser');
    navigate('/');
  };

  const handleProfilePictureUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      setProfilePicture(ev.target.result);
    };
    reader.readAsDataURL(file);
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
        zipCode: formData.zipCode
      };

      // Only include profile picture if it's a new upload (data URL string)
      if (profilePicture && typeof profilePicture === 'string' && profilePicture.startsWith('data:')) {
        profileData.profile_picture = profilePicture;
      }

      // Update profile via API
      const updatedData = await applicantAPI.updateProfile(profileData);

      // Re-fetch the full profile from the server so all fields are populated
      const freshProfile = await applicantAPI.getProfile();

      // Preserve the profile picture we already have in state (server may not return binary)
      const mergedProfile = { ...freshProfile };
      if (profilePicture) {
        mergedProfile.profile_picture = profilePicture;
      }
      setUserProfile(mergedProfile);

      // Show success modal
      setShowSuccessModal(true);

      // After success, close edit form and hide loading overlay
      setTimeout(() => {
        setShowSuccessModal(false);
        setShowEditForm(false);
        setShowLoadingOverlay(false);
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

  const getProfilePictureHtml = () => {
    if (profilePicture) {
      return `<img src="${profilePicture}" alt="profile" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
    }
    return '<span>👤</span>';
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
              <h2>Your Profile</h2>
              <div className="profile-picture-upload">
                <div
                  className="profile-pic"
                  dangerouslySetInnerHTML={{ __html: getProfilePictureHtml() }}
                />
                <div style={{ flex: 1 }}>
                  <h3 style={{ color: 'var(--primary)', fontSize: '1.5rem', marginBottom: '0.3rem' }}>
                    {userProfile.first_name && userProfile.last_name ? `${userProfile.first_name} ${userProfile.last_name}` : 'No name provided'}
                  </h3>
                  <p style={{ color: 'var(--text-soft)', margin: 0 }}>{currentUser}</p>
                </div>
              </div>
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
                  value={userProfile.town_city_municipality || ''}
                  disabled
                  style={{ backgroundColor: 'var(--gray-1)', cursor: 'not-allowed' }}
                />
              </div>
              <div className="form-group">
                <label>Province</label>
                <input
                  type="text"
                  value={userProfile.province || ''}
                  disabled
                  style={{ backgroundColor: 'var(--gray-1)', cursor: 'not-allowed' }}
                />
              </div>
              <div className="form-group">
                <label>Zip Code</label>
                <input
                  type="text"
                  value={userProfile.zip_code || ''}
                  disabled
                  style={{ backgroundColor: 'var(--gray-1)', cursor: 'not-allowed' }}
                />
              </div>
              <button className="edit-profile-btn" onClick={showEditProfile} style={{ width: 'auto', marginTop: '1rem' }}>
                <i className="fas fa-edit" style={{ marginRight: '8px' }}></i> Edit Profile
              </button>
            </div>
          )}

          {/* Profile Edit Form */}
          {showEditForm && (
            <div className="form-section active">
              <h2>{userProfile ? 'Edit Profile' : 'Complete Profile'}</h2>
              {error && <div style={{ color: 'var(--danger)', marginBottom: '1rem', padding: '0.8rem', backgroundColor: 'var(--danger-bg)', borderRadius: '8px' }}>{error}</div>}
              <form onSubmit={handleProfileSubmit}>
                <div className="profile-picture-upload">
                  <div
                    className="profile-pic"
                    dangerouslySetInnerHTML={{ __html: getProfilePictureHtml() }}
                  />
                  <div className="form-group">
                    <label>Profile picture</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleProfilePictureUpload}
                      ref={profilePictureInputRef}
                    />
                  </div>
                </div>
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
                  <input
                    type="text"
                    name="school"
                    value={formData.school}
                    onChange={handleInputChange}
                    placeholder="University of Manila"
                    required
                  />
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
                  <input
                    type="text"
                    name="streetBrgy"
                    value={formData.streetBrgy}
                    onChange={handleInputChange}
                    placeholder="e.g., 123 Main St, Brgy. Nayong Kanluran"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Town / City / Municipality</label>
                  <input
                    type="text"
                    name="townCityMunicipality"
                    value={formData.townCityMunicipality}
                    onChange={handleInputChange}
                    placeholder="e.g., Manila"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Province</label>
                  <input
                    type="text"
                    name="province"
                    value={formData.province}
                    onChange={handleInputChange}
                    placeholder="e.g., Metro Manila"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Zip Code</label>
                  <input
                    type="text"
                    name="zipCode"
                    value={formData.zipCode}
                    onChange={handleInputChange}
                    placeholder="e.g., 1000"
                    required
                  />
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
