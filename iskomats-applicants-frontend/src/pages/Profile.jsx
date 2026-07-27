import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { applicantAPI } from '../services/api';
import iskoLogo from '../assets/iskologo.png';

const SCHOOL_OPTIONS = [
  "DLSL/De La Salle Lipa",
  "NU/National University Lipa",
  "Batangas State University",
  "Kolehiyo ng Lungsod ng Lipa",
  "Philippine State College of Aeronautics",
  "Lipa City Colleges",
  "University of Batangas",
  "New Era University",
  "Batangas College of Arts and Sciences",
  "Royal British College",
  "STI Academic Center",
  "AMA Computer College",
  "ICT-ED"
];

const BARANGAY_OPTIONS = [
  "Adya", "Anilao", "Anilao-Labac", "Antipolo del Norte", "Antipolo del Sur",
  "Bagong Pook", "Balintawak", "Banaybanay", "Bolbok", "Bugtong na Pulo",
  "Bulacnin", "Bulaklakan", "Calamias", "Cumba", "Dagatan", "Duhatan",
  "Halang", "Inosluban", "Kayumanggi", "Latag", "Lodlod", "Lumbang",
  "Mabini", "Malagonlong", "Malitlit", "Marauoy", "Mataas na Lupa",
  "Munting Pulo", "Pagolingin Bata", "Pagolingin East", "Pagolingin West",
  "Pangao", "Pinagkawitan", "Pinagtongulan", "Plaridel",
  "Poblacion Barangay 1", "Poblacion Barangay 2", "Poblacion Barangay 3",
  "Poblacion Barangay 4", "Poblacion Barangay 5", "Poblacion Barangay 6",
  "Poblacion Barangay 7", "Poblacion Barangay 8", "Poblacion Barangay 9",
  "Poblacion Barangay 9-A", "Poblacion Barangay 10", "Poblacion Barangay 11",
  "Poblacion Barangay 12", "Pusil", "Quezon", "Rizal", "Sabang",
  "Sampaguita", "San Benito", "San Carlos", "San Celestino", "San Francisco",
  "San Guillermo", "San Isidro", "San Jose", "San Lucas", "San Salvador",
  "San Sebastian (Balagbag)", "Santo Niño", "Santo Toribio", "Sico",
  "Talisay", "Tambo", "Tangob", "Tanguay", "Tibig", "Tipacan"
];

const Profile = () => {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
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
    townCityMunicipality: 'Lipa City',
    province: 'Batangas',
    zipCode: '4217',
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

      if (!user) {
        navigate('/login');
        return;
      }

      setCurrentUser(user);
      setLoadingMessage({ title: 'Loading Profile', message: 'Retrieving your information...' });
      setShowLoadingOverlay(true);
      setIsLoading(true);
      setError(null);

      try {
        const profile = await applicantAPI.getProfile();
        setUserProfile(profile);
        setShowEditForm(false);
      } catch (err) {
        if (err.message.includes('404') || err.message.includes('not found') || err.message.includes('Profile not found')) {
          setUserProfile(null);
          setShowEditForm(true);
        } else {
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
      if (document.head.contains(fontAwesomeLink)) document.head.removeChild(fontAwesomeLink);
      if (document.head.contains(googleFontsLink)) document.head.removeChild(googleFontsLink);
      if (document.head.contains(googleFontsDisplay)) document.head.removeChild(googleFontsDisplay);
      if (document.head.contains(googleFontsSheet)) document.head.removeChild(googleFontsSheet);
    };
  }, [navigate]);

  useEffect(() => {
    if (currentUser && userProfile) {
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
        profile_picture: userProfile.profile_picture || null
      });
    } else if (currentUser) {
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
        profile_picture: null
      });
    }
  }, [currentUser, userProfile]);

  const handleProfilePictureUpload = (e) => {
    const file = e.target.files[0];
    if (file && window.compressImage) {
      window.compressImage(file, 400).then(compressedBase64 => {
        setFormData(prev => ({ ...prev, profile_picture: compressedBase64 }));
      });
    } else if (file) {
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
      setLoadingMessage({ title: 'Updating Profile', message: 'Saving changes to database...' });
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
        zipCode: formData.zipCode,
        profile_picture: formData.profile_picture
      };

      await applicantAPI.updateProfile(profileData);

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
        profile_picture: formData.profile_picture || userProfile?.profile_picture || null
      };

      setUserProfile(locallyUpdatedProfile);
      setShowSuccessModal(true);

      const isNewProfile = !userProfile?.town_city_municipality;

      setTimeout(() => {
        setShowSuccessModal(false);
        setShowEditForm(false);
        setShowLoadingOverlay(false);

        if (isNewProfile) {
          navigate('/portal');
        }
      }, 1500);
    } catch (err) {
      setError(err.message || 'Failed to update profile');
      console.error('Error updating profile:', err);
      setShowLoadingOverlay(false);
    }
  };

  const getFirstName = () => {
    return userProfile?.first_name || formData.firstName || 'Student';
  };

  const getFullName = () => {
    const fn = userProfile?.first_name || formData.firstName || '';
    const mn = userProfile?.middle_name || formData.middleName || '';
    const ln = userProfile?.last_name || formData.lastName || '';
    const full = [fn, mn, ln].filter(Boolean).join(' ');
    return full || 'No name provided';
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

        :root {
          --primary: #4F0D00;
          --primary-light: #7A1A05;
          --primary-soft: #ffe8e3;
          --accent: #d9534f;
          --gray-bg: #f8fafc;
          --gray-100: #f1f5f9;
          --gray-200: #e2e8f0;
          --gray-300: #cbd5e1;
          --gray-600: #475569;
          --text-main: #0f172a;
          --text-muted: #64748b;
          --white: #ffffff;
          --shadow-card: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.03);
          --shadow-lg: 0 20px 30px -10px rgba(79, 13, 0, 0.15);
        }

        body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          background-color: #f4f6f9;
          color: var(--text-main);
          line-height: 1.5;
        }

        /* Navbar Styling */
        .navbar {
          background-color: var(--primary);
          padding: 0.75rem 5%;
          display: flex;
          justify-content: space-between;
          align-items: center;
          position: sticky;
          top: 0;
          z-index: 100;
          box-shadow: 0 4px 12px rgba(0,0,0,0.12);
        }

        .navbar-header-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: auto;
        }

        .navbar-brand {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          text-decoration: none;
        }

        .navbar-brand-logo {
          height: 36px;
          width: 36px;
          object-fit: contain;
          border-radius: 50%;
        }

        .navbar-brand-text {
          font-size: 1.4rem;
          font-weight: 800;
          color: white;
          letter-spacing: -0.02em;
        }

        .navbar-toggle-btn {
          display: none;
          background: rgba(255, 255, 255, 0.15);
          border: none;
          color: white;
          font-size: 1.1rem;
          cursor: pointer;
          width: 38px;
          height: 38px;
          border-radius: 8px;
          align-items: center;
          justify-content: center;
        }

        .navbar-menu {
          display: flex;
          gap: 1rem;
          align-items: center;
        }

        .navbar-menu span {
          color: rgba(255, 255, 255, 0.9);
          font-weight: 500;
          font-size: 0.9rem;
          margin-right: 0.5rem;
        }

        .nav-btn {
          background: rgba(255, 255, 255, 0.12);
          padding: 0.45rem 1.1rem;
          border-radius: 30px;
          border: 1px solid rgba(255, 255, 255, 0.25);
          color: white;
          font-weight: 600;
          font-size: 0.85rem;
          transition: all 0.2s;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
        }

        .nav-btn:hover {
          background: rgba(255, 255, 255, 0.25);
          border-color: rgba(255, 255, 255, 0.5);
        }

        /* Profile Layout Container */
        .profile-container {
          max-width: 900px;
          margin: 1.25rem auto 2.5rem;
          padding: 0 1rem;
        }

        .back-button {
          background: white;
          border: 1px solid var(--gray-200);
          padding: 0.45rem 1.1rem;
          border-radius: 30px;
          font-weight: 600;
          color: var(--text-muted);
          margin-bottom: 1rem;
          cursor: pointer;
          transition: all 0.2s ease;
          font-size: 0.85rem;
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          box-shadow: 0 2px 5px rgba(0,0,0,0.03);
        }

        .back-button:hover {
          background: var(--gray-100);
          color: var(--primary);
          border-color: var(--gray-300);
        }

        /* Welcome Banner */
        .welcome-banner {
          background: linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%);
          border-radius: 16px;
          padding: 1.2rem 1.5rem;
          color: white;
          margin-bottom: 1.2rem;
          box-shadow: var(--shadow-card);
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 0.8rem;
        }

        .welcome-banner h2 {
          font-size: 1.4rem;
          font-weight: 800;
          line-height: 1.2;
        }

        .welcome-banner h2 span {
          color: #ffc0b0;
        }

        .welcome-banner p {
          color: rgba(255, 255, 255, 0.85);
          font-size: 0.85rem;
          margin-top: 0.2rem;
        }

        /* Main Profile Card */
        .profile-card {
          background: var(--white);
          border-radius: 16px;
          border: 1px solid var(--gray-200);
          box-shadow: var(--shadow-card);
          overflow: hidden;
        }

        /* Header block in card */
        .card-header-bar {
          padding: 1.2rem 1.5rem;
          background: #ffffff;
          border-bottom: 1px solid var(--gray-200);
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1rem;
        }

        .profile-identity {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .avatar-box {
          width: 72px;
          height: 72px;
          border-radius: 50%;
          background: var(--primary-soft);
          color: var(--primary);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 2rem;
          border: 3px solid white;
          box-shadow: 0 4px 10px rgba(0,0,0,0.08);
          overflow: hidden;
          position: relative;
          flex-shrink: 0;
        }

        .avatar-box img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .identity-text h3 {
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--primary);
          margin-bottom: 0.15rem;
        }

        .identity-text p {
          font-size: 0.85rem;
          color: var(--text-muted);
          font-weight: 500;
        }

        .action-btn {
          background: var(--primary);
          color: white;
          border: none;
          padding: 0.5rem 1.25rem;
          border-radius: 25px;
          font-weight: 600;
          font-size: 0.85rem;
          cursor: pointer;
          transition: all 0.2s;
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          box-shadow: 0 3px 8px rgba(79, 13, 0, 0.2);
          white-space: nowrap;
        }

        .action-btn:hover {
          background: var(--primary-light);
          transform: translateY(-1px);
        }

        .action-btn.secondary {
          background: var(--gray-100);
          color: var(--text-main);
          border: 1px solid var(--gray-300);
          box-shadow: none;
        }

        .action-btn.secondary:hover {
          background: var(--gray-200);
        }

        /* Card Content Body */
        .card-body {
          padding: 1.25rem 1.5rem;
        }

        .section-title {
          font-size: 0.75rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--primary);
          margin: 1rem 0 0.75rem;
          padding-bottom: 0.35rem;
          border-bottom: 1.5px solid var(--primary-soft);
          display: flex;
          align-items: center;
          gap: 0.4rem;
        }

        .section-title:first-of-type {
          margin-top: 0;
        }

        /* Responsive Form Layout Grid */
        .form-grid {
          display: grid;
          grid-template-columns: repeat(12, 1fr);
          gap: 0.75rem 1rem;
        }

        .col-12 { grid-column: span 12; }
        .col-8  { grid-column: span 8; }
        .col-6  { grid-column: span 6; }
        .col-4  { grid-column: span 4; }
        .col-3  { grid-column: span 3; }

        .field-group {
          display: flex;
          flex-direction: column;
        }

        .field-group label {
          font-size: 0.72rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--text-muted);
          margin-bottom: 0.3rem;
        }

        .field-input, .field-display {
          width: 100%;
          padding: 0.55rem 0.85rem;
          border-radius: 8px;
          font-size: 0.88rem;
          font-family: inherit;
          transition: all 0.15s ease;
        }

        .field-display {
          background-color: var(--gray-bg);
          border: 1px solid var(--gray-200);
          color: var(--text-main);
          font-weight: 500;
          min-height: 38px;
          display: flex;
          align-items: center;
        }

        .field-input {
          border: 1.5px solid var(--gray-200);
          background: white;
          color: var(--text-main);
        }

        .field-input:focus {
          outline: none;
          border-color: var(--primary);
          box-shadow: 0 0 0 3px rgba(79, 13, 0, 0.1);
        }

        .field-input:disabled {
          background-color: var(--gray-bg);
          cursor: not-allowed;
          color: var(--gray-600);
        }

        /* Form Footer Buttons */
        .form-footer {
          margin-top: 1.5rem;
          padding-top: 1rem;
          border-top: 1px solid var(--gray-200);
          display: flex;
          justify-content: flex-end;
          gap: 0.75rem;
        }

        /* Profile picture edit area */
        .avatar-upload-row {
          display: flex;
          align-items: center;
          gap: 1.2rem;
          padding: 0.8rem;
          background: var(--gray-bg);
          border-radius: 12px;
          border: 1px dashed var(--gray-300);
          margin-bottom: 1.25rem;
        }

        .avatar-preview-box {
          width: 64px;
          height: 64px;
          border-radius: 50%;
          background: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.5rem;
          color: var(--primary);
          overflow: hidden;
          position: relative;
          border: 2px solid var(--primary-soft);
          flex-shrink: 0;
        }

        .avatar-preview-box img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .upload-info h4 {
          font-size: 0.9rem;
          font-weight: 700;
          color: var(--primary);
        }

        .upload-info p {
          font-size: 0.78rem;
          color: var(--text-muted);
          margin-bottom: 0.4rem;
        }

        .file-select-btn {
          position: relative;
          display: inline-block;
          overflow: hidden;
        }

        .file-select-btn input[type="file"] {
          position: absolute;
          left: 0;
          top: 0;
          opacity: 0;
          width: 100%;
          height: 100%;
          cursor: pointer;
        }

        /* Modals & Overlays */
        .loading-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(4px);
          display: none;
          justify-content: center;
          align-items: center;
          z-index: 9999;
        }

        .loading-overlay.active { display: flex; }

        .loading-modal {
          background: white;
          padding: 2rem 2.5rem;
          border-radius: 20px;
          text-align: center;
          box-shadow: var(--shadow-lg);
          max-width: 380px;
          width: 90%;
        }

        .loading-spinner {
          width: 44px;
          height: 44px;
          border: 4px solid var(--primary-soft);
          border-top: 4px solid var(--primary);
          border-radius: 50%;
          margin: 0 auto 1.2rem;
          animation: spin 0.9s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .success-modal {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: none;
          align-items: center;
          justify-content: center;
          z-index: 10000;
        }

        .success-modal.active { display: flex; }

        .success-modal .modal-content {
          background: white;
          padding: 2rem;
          border-radius: 18px;
          text-align: center;
          box-shadow: var(--shadow-lg);
          max-width: 360px;
          width: 90%;
        }

        /* Responsive Breakpoints */
        @media (max-width: 768px) {
          .navbar {
            position: relative;
            padding: 0.75rem 4%;
          }

          .navbar-header-row {
            width: 100%;
          }

          .navbar-toggle-btn {
            display: flex;
          }

          .navbar-menu {
            display: none;
            position: absolute;
            top: 100%;
            left: 0;
            width: 100%;
            background: var(--primary);
            flex-direction: column;
            padding: 1rem;
            gap: 0.6rem;
            box-shadow: 0 10px 20px rgba(0,0,0,0.3);
            border-top: 1px solid rgba(255,255,255,0.1);
          }

          .navbar-menu.active {
            display: flex;
          }

          .navbar-menu span {
            margin-right: 0;
            margin-bottom: 0.4rem;
          }

          .nav-btn {
            width: 100%;
            justify-content: center;
          }

          .col-4, .col-6, .col-8 {
            grid-column: span 6;
          }

          .card-header-bar {
            flex-direction: column;
            align-items: flex-start;
            gap: 0.8rem;
          }

          .action-btn {
            width: 100%;
            justify-content: center;
          }
        }

        @media (max-width: 520px) {
          .profile-container {
            padding: 0 0.6rem;
            margin-top: 0.8rem;
          }

          .welcome-banner {
            padding: 1rem;
            border-radius: 12px;
          }

          .welcome-banner h2 { font-size: 1.2rem; }
          .welcome-banner p { font-size: 0.78rem; }

          .card-header-bar, .card-body {
            padding: 1rem;
          }

          .col-3, .col-4, .col-6, .col-8 {
            grid-column: span 12;
          }

          .form-grid {
            gap: 0.6rem;
          }

          .field-group label {
            font-size: 0.68rem;
          }

          .field-input, .field-display {
            padding: 0.45rem 0.7rem;
            font-size: 0.84rem;
          }

          .avatar-box {
            width: 56px;
            height: 56px;
            font-size: 1.5rem;
          }

          .identity-text h3 {
            font-size: 1.1rem;
          }
        }
      `}</style>

      {/* Top Navbar */}
      <nav className="navbar">
        <div className="navbar-header-row">
          <Link to="/portal" className="navbar-brand" onClick={() => setMobileMenuOpen(false)}>
            <img src={iskoLogo} alt="iskoMats Logo" className="navbar-brand-logo" />
            <span className="navbar-brand-text">iskoMats</span>
          </Link>
          <button
            className="navbar-toggle-btn"
            aria-label="Toggle navigation menu"
            onClick={() => setMobileMenuOpen(prev => !prev)}
          >
            <i className={mobileMenuOpen ? "fas fa-times" : "fas fa-bars"}></i>
          </button>
        </div>
        <div className={`navbar-menu ${mobileMenuOpen ? 'active' : ''}`}>
          <span><i className="fas fa-user-circle" style={{ marginRight: '5px' }}></i>{currentUser}</span>
          <button className="nav-btn" onClick={() => { setMobileMenuOpen(false); navigate('/profile'); }}>
            <i className="fas fa-id-card"></i> Profile
          </button>
          <button className="nav-btn" onClick={() => { setMobileMenuOpen(false); logout(); }}>
            <i className="fas fa-sign-out-alt"></i> Logout
          </button>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="profile-container">
        <button className="back-button" onClick={() => navigate('/portal')}>
          <i className="fas fa-arrow-left"></i> Back to Portal
        </button>

        {/* Welcome Header */}
        <div className="welcome-banner">
          <div>
            <h2>Welcome, <span>{getFirstName()}</span>!</h2>
            <p>Manage your profile and keep your information up to date</p>
          </div>
        </div>

        {/* Main Profile Card Container */}
        <div className="profile-card">
          {/* Card Top Identity Header */}
          <div className="card-header-bar">
            <div className="profile-identity">
              <div className="avatar-box">
                {(showEditForm ? formData.profile_picture : userProfile?.profile_picture) ? (
                  <img src={showEditForm ? formData.profile_picture : userProfile?.profile_picture} alt="Profile Avatar" />
                ) : (
                  <i className="fas fa-user"></i>
                )}
              </div>
              <div className="identity-text">
                <h3>{getFullName()}</h3>
                <p><i className="fas fa-envelope" style={{ marginRight: '6px' }}></i>{currentUser}</p>
              </div>
            </div>

            {/* Header Action Button */}
            {!showEditForm && userProfile && (
              <button className="action-btn" onClick={() => setShowEditForm(true)}>
                <i className="fas fa-user-edit"></i> Edit Profile
              </button>
            )}

            {showEditForm && userProfile && (
              <button className="action-btn secondary" onClick={() => setShowEditForm(false)}>
                <i className="fas fa-times"></i> Cancel
              </button>
            )}
          </div>

          {/* Card Body */}
          <div className="card-body">
            {error && (
              <div style={{ color: 'var(--accent)', marginBottom: '1rem', padding: '0.65rem 0.9rem', backgroundColor: '#fee2e2', borderRadius: '8px', fontSize: '0.85rem' }}>
                <i className="fas fa-exclamation-circle" style={{ marginRight: '6px' }}></i>{error}
              </div>
            )}

            {/* VIEW DISPLAY MODE */}
            {!showEditForm && userProfile && (
              <div>
                {/* Personal Section */}
                <div className="section-title">
                  <i className="fas fa-user"></i> Personal Information
                </div>
                <div className="form-grid">
                  <div className="field-group col-4">
                    <label>First Name</label>
                    <div className="field-display">{userProfile.first_name || '—'}</div>
                  </div>
                  <div className="field-group col-4">
                    <label>Middle Name</label>
                    <div className="field-display">{userProfile.middle_name || '—'}</div>
                  </div>
                  <div className="field-group col-4">
                    <label>Last Name</label>
                    <div className="field-display">{userProfile.last_name || '—'}</div>
                  </div>
                  <div className="field-group col-6">
                    <label>Birthdate</label>
                    <div className="field-display">{formatBirthdate(userProfile.birthdate)}</div>
                  </div>
                  <div className="field-group col-6">
                    <label>Phone Number</label>
                    <div className="field-display">{userProfile.mobile_no || '—'}</div>
                  </div>
                </div>

                {/* Academic Section */}
                <div className="section-title">
                  <i className="fas fa-graduation-cap"></i> Academic Information
                </div>
                <div className="form-grid">
                  <div className="field-group col-12">
                    <label>University / School</label>
                    <div className="field-display">{userProfile.school || '—'}</div>
                  </div>
                </div>

                {/* Address Section */}
                <div className="section-title">
                  <i className="fas fa-map-marker-alt"></i> Address & Location
                </div>
                <div className="form-grid">
                  <div className="field-group col-6">
                    <label>Street / Barangay</label>
                    <div className="field-display">{userProfile.street_brgy || '—'}</div>
                  </div>
                  <div className="field-group col-6">
                    <label>Town / City</label>
                    <div className="field-display">{userProfile.town_city_municipality || userProfile.townCity || 'Lipa City'}</div>
                  </div>
                  <div className="field-group col-6">
                    <label>Province</label>
                    <div className="field-display">{userProfile.province || 'Batangas'}</div>
                  </div>
                  <div className="field-group col-6">
                    <label>Zip Code</label>
                    <div className="field-display">{userProfile.zip_code || userProfile.zipCode || '4217'}</div>
                  </div>
                </div>
              </div>
            )}

            {/* EDIT FORM MODE */}
            {showEditForm && (
              <form onSubmit={handleProfileSubmit}>
                {/* Profile Picture Upload Row */}
                <div className="avatar-upload-row">
                  <div className="avatar-preview-box">
                    {formData.profile_picture ? (
                      <img src={formData.profile_picture} alt="Preview" />
                    ) : (
                      <i className="fas fa-user"></i>
                    )}
                  </div>
                  <div className="upload-info">
                    <h4>Profile Picture</h4>
                    <p>Upload a formal 2x2 picture</p>
                    <div className="file-select-btn">
                      <button type="button" className="action-btn secondary" style={{ padding: '0.35rem 0.9rem', fontSize: '0.78rem' }}>
                        <i className="fas fa-camera"></i> Change Photo
                      </button>
                      <input type="file" accept="image/*" onChange={handleProfilePictureUpload} />
                    </div>
                  </div>
                </div>

                {/* Personal Section */}
                <div className="section-title">
                  <i className="fas fa-user"></i> Personal Information
                </div>
                <div className="form-grid">
                  <div className="field-group col-4">
                    <label>First Name *</label>
                    <input
                      type="text"
                      className="field-input"
                      name="firstName"
                      value={formData.firstName}
                      onChange={handleInputChange}
                      placeholder="e.g. Maria"
                      required
                    />
                  </div>
                  <div className="field-group col-4">
                    <label>Middle Name</label>
                    <input
                      type="text"
                      className="field-input"
                      name="middleName"
                      value={formData.middleName}
                      onChange={handleInputChange}
                      placeholder="e.g. Dela Cruz"
                    />
                  </div>
                  <div className="field-group col-4">
                    <label>Last Name *</label>
                    <input
                      type="text"
                      className="field-input"
                      name="lastName"
                      value={formData.lastName}
                      onChange={handleInputChange}
                      placeholder="e.g. Santos"
                      required
                    />
                  </div>
                  <div className="field-group col-6">
                    <label>Birthdate *</label>
                    <input
                      type="date"
                      className="field-input"
                      name="birthdate"
                      value={formData.birthdate}
                      onChange={handleInputChange}
                      required
                    />
                  </div>
                  <div className="field-group col-6">
                    <label>Phone Number *</label>
                    <input
                      type="tel"
                      className="field-input"
                      name="mobileNo"
                      value={formData.mobileNo}
                      onChange={handleInputChange}
                      placeholder="09XXXXXXXXX"
                      required
                    />
                  </div>
                </div>

                {/* Academic Section */}
                <div className="section-title">
                  <i className="fas fa-graduation-cap"></i> Academic Information
                </div>
                <div className="form-grid">
                  <div className="field-group col-12">
                    <label>University / School *</label>
                    <select
                      className="field-input"
                      name="school"
                      value={formData.school}
                      onChange={handleInputChange}
                      required
                    >
                      <option value="">Select School</option>
                      {SCHOOL_OPTIONS.map(sch => (
                        <option key={sch} value={sch}>{sch}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Address Section */}
                <div className="section-title">
                  <i className="fas fa-map-marker-alt"></i> Address & Location
                </div>
                <div className="form-grid">
                  <div className="field-group col-6">
                    <label>Street / Barangay *</label>
                    <select
                      className="field-input"
                      name="streetBrgy"
                      value={formData.streetBrgy}
                      onChange={handleInputChange}
                      required
                    >
                      <option value="">Select Barangay</option>
                      {BARANGAY_OPTIONS.map(brgy => (
                        <option key={brgy} value={brgy}>{brgy}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field-group col-6">
                    <label>Town / City</label>
                    <input
                      type="text"
                      className="field-input"
                      name="townCityMunicipality"
                      value={formData.townCityMunicipality}
                      disabled
                    />
                  </div>
                  <div className="field-group col-6">
                    <label>Province</label>
                    <input
                      type="text"
                      className="field-input"
                      name="province"
                      value={formData.province}
                      disabled
                    />
                  </div>
                  <div className="field-group col-6">
                    <label>Zip Code</label>
                    <input
                      type="text"
                      className="field-input"
                      name="zipCode"
                      value={formData.zipCode}
                      disabled
                    />
                  </div>
                </div>

                {/* Form Footer Action */}
                <div className="form-footer">
                  {userProfile && (
                    <button type="button" className="action-btn secondary" onClick={() => setShowEditForm(false)}>
                      Cancel
                    </button>
                  )}
                  <button type="submit" className="action-btn">
                    <i className="fas fa-save"></i> {userProfile ? 'Save Changes' : 'Create Profile'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </main>

      {/* Success Modal */}
      <div className={`success-modal ${showSuccessModal ? 'active' : ''}`}>
        <div className="modal-content">
          <div style={{ fontSize: '2.5rem', color: '#10b981', marginBottom: '0.5rem' }}>
            <i className="fas fa-check-circle"></i>
          </div>
          <h3 style={{ color: 'var(--primary)', marginBottom: '0.4rem', fontWeight: '800' }}>Profile Saved!</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>Your profile details have been successfully updated.</p>
        </div>
      </div>

      {/* Loading Overlay */}
      <div className={`loading-overlay ${showLoadingOverlay ? 'active' : ''}`}>
        <div className="loading-modal">
          <div className="loading-spinner"></div>
          <h3 style={{ color: 'var(--primary)', fontWeight: '800', fontSize: '1.25rem', marginBottom: '0.4rem' }}>
            {loadingMessage.title}
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
            {loadingMessage.message}
          </p>
        </div>
      </div>
    </>
  );
};

export default Profile;
