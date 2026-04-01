import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authAPI, applicantAPI } from '../services/api';

const ProfileSetup = () => {
  const navigate = useNavigate();
  const [profilePicture, setProfilePicture] = useState(null);
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState({ title: '', message: '' });
  const [showError, setShowError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    // Check if user has verified email
    const registrationEmail = localStorage.getItem('registrationEmail');
    if (!registrationEmail) {
      navigate('/login');
      return;
    }

    // Add Font Awesome link
    const fontAwesomeLink = document.createElement('link');
    fontAwesomeLink.rel = 'stylesheet';
    fontAwesomeLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css';
    document.head.appendChild(fontAwesomeLink);

    // Add Google Fonts link
    const googleFontsLink = document.createElement('link');
    googleFontsLink.rel = 'stylesheet';
    googleFontsLink.href = 'https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400;14..32,500;14..32,600;14..32,700;14..32,800&display=swap';
    document.head.appendChild(googleFontsLink);

    return () => {
      document.head.removeChild(fontAwesomeLink);
      document.head.removeChild(googleFontsLink);
    };
  }, [navigate]);

  const handleProfilePictureUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      setProfilePicture(ev.target.result);
    };
    reader.readAsDataURL(file);
  };

  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    const firstName = e.target.firstName?.value || '';
    const middleName = e.target.middleName?.value || '';
    const lastName = e.target.lastName?.value || '';
    const birthdate = e.target.birthdate?.value || '';
    const school = e.target.school?.value || '';
    const mobileNo = e.target.mobileNo?.value || '';
    const streetBrgy = e.target.streetBrgy?.value || '';
    const townCityMunicipality = e.target.townCityMunicipality?.value || '';
    const province = e.target.province?.value || '';
    const zipCode = e.target.zipCode?.value || '';
    const overallGpa = e.target.overallGpa?.value || '';
    const financialIncomeOfParents = e.target.financialIncomeOfParents?.value || '';

    // Validate required fields
    if (!firstName || !lastName || !birthdate || !school || !mobileNo || !streetBrgy || !townCityMunicipality || !province || !zipCode) {
      setErrorMessage('Please fill in all required fields');
      setShowError(true);
      return;
    }

    try {
      setLoadingMessage({ title: 'Saving Profile', message: 'Setting up your profile...' });
      setShowLoadingOverlay(true);

      const email = localStorage.getItem('registrationEmail');
      const password = localStorage.getItem('registrationPassword');

      try {
        // Login to get token
        const loginResponse = await authAPI.login(email, password);
        localStorage.setItem('authToken', loginResponse.token);
        localStorage.setItem('applicantNo', loginResponse.applicant_no);
        localStorage.setItem('currentUser', email);

        // Prepare profile payload
        const profilePayload = {
          firstName,
          middleName,
          lastName,
          dateOfBirth: birthdate,
          schoolName: school,
          mobileNumber: mobileNo,
          streetBarangay: streetBrgy,
          townCity: townCityMunicipality,
          province,
          zipCode,
        };

        if (overallGpa) profilePayload.gpa = parseFloat(overallGpa);
        if (financialIncomeOfParents) profilePayload.parentsGrossIncome = parseInt(financialIncomeOfParents);
        if (profilePicture) profilePayload.profile_picture = profilePicture;

        // Save profile
        await applicantAPI.updateProfile(profilePayload);

        // Clear temporary data
        localStorage.removeItem('registrationEmail');
        localStorage.removeItem('registrationPassword');

        setShowLoadingOverlay(false);
        // Redirect to portal
        navigate('/portal');
      } catch (regError) {
        throw regError;
      }
    } catch (error) {
      setErrorMessage(error.message || 'Profile creation failed. Please try again.');
      setShowError(true);
      setShowLoadingOverlay(false);
    }
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
          background: linear-gradient(145deg, #f3f7fc 0%, #fefaf8 100%);
          color: #121826;
          line-height: 1.5;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
        }

        :root {
          --primary: #4F0D00;
          --primary-light: #7b2f1a;
          --primary-gradient: linear-gradient(135deg, #4F0D00, #9b3e22);
          --accent-soft: #fff1ec;
          --gray-1: #f8fafd;
          --gray-2: #e9eef3;
          --gray-3: #b8c4d4;
          --text-dark: #121826;
          --text-soft: #2c3b4f;
          --white: #ffffff;
          --shadow-sm: 0 6px 16px rgba(0, 0, 0, 0.02), 0 2px 8px rgba(20, 20, 30, 0.02);
          --shadow-md: 0 16px 32px -12px rgba(79, 13, 0, 0.18), 0 6px 14px rgba(0, 10, 20, 0.02);
        }

        .navbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 1.2rem 5%;
          background: var(--white);
          box-shadow: var(--shadow-sm);
          gap: 3rem;
          position: sticky;
          top: 0;
          z-index: 100;
        }

        .navbar-brand {
          display: flex;
          align-items: center;
          color: var(--text-dark);
          text-decoration: none;
          font-weight: 700;
          font-size: 1.5rem;
          white-space: nowrap;
          transition: opacity 0.2s ease;
        }

        .navbar-brand:hover {
          opacity: 0.8;
        }

        .navbar-nav {
          display: flex;
          gap: 2.5rem;
          flex: 1;
        }

        .navbar-nav a {
          color: var(--text-soft);
          text-decoration: none;
          font-size: 1rem;
          transition: color 0.2s ease;
        }

        .navbar-nav a:hover {
          color: var(--primary);
        }

        .profile-wrapper {
          padding: 3rem 5%;
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .profile-card {
          background: var(--white);
          border-radius: 24px;
          padding: 3rem;
          box-shadow: var(--shadow-md);
          max-width: 700px;
          width: 100%;
        }

        .profile-card h2 {
          font-size: 2rem;
          margin-bottom: 0.5rem;
          color: var(--text-dark);
        }

        .profile-card p {
          color: var(--text-soft);
          margin-bottom: 2rem;
          font-size: 1rem;
        }

        .error-message {
          background-color: #fef2f2;
          color: #dc2626;
          padding: 1rem;
          border-radius: 8px;
          margin-bottom: 1.5rem;
          display: flex;
          align-items: center;
          gap: 0.75rem;
          border-left: 4px solid #dc2626;
        }

        .error-message i {
          font-size: 1.2rem;
        }

        .profile-form {
          display: grid;
          gap: 1.5rem;
        }

        .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1.5rem;
        }

        .profile-form-group {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .profile-form-group label {
          font-weight: 600;
          color: var(--text-dark);
          font-size: 0.95rem;
        }

        .profile-form-group input,
        .profile-form-group select {
          padding: 0.875rem;
          border: 2px solid var(--gray-2);
          border-radius: 8px;
          font-size: 1rem;
          font-family: inherit;
          transition: all 0.2s ease;
          background: var(--white);
        }

        .profile-form-group input:focus,
        .profile-form-group select:focus {
          outline: none;
          border-color: var(--primary);
          box-shadow: 0 0 0 3px rgba(79, 13, 0, 0.1);
        }

        .profile-picture-upload {
          display: flex;
          align-items: center;
          gap: 2rem;
          margin-bottom: 2rem;
          padding: 1.5rem;
          background: var(--accent-soft);
          border-radius: 12px;
        }

        .profile-pic {
          width: 120px;
          height: 120px;
          border-radius: 50%;
          background: var(--gray-1);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 3rem;
          flex-shrink: 0;
          border: 2px solid var(--primary);
          overflow: hidden;
        }

        .profile-picture-upload .profile-form-group {
          flex: 1;
        }

        .profile-picture-upload input[type="file"] {
          padding: 0.5rem;
          border: 2px dashed var(--primary);
          cursor: pointer;
        }

        .submit-btn {
          background: var(--primary-gradient);
          color: var(--white);
          border: none;
          padding: 1rem 2rem;
          border-radius: 8px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          margin-top: 1rem;
        }

        .submit-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 16px rgba(79, 13, 0, 0.15);
        }

        .submit-btn:active {
          transform: translateY(0);
        }

        .loading-overlay {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
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

        @media (max-width: 768px) {
          .profile-wrapper {
            padding: 1.5rem 5%;
          }

          .profile-card {
            padding: 1.5rem;
          }

          .profile-card h2 {
            font-size: 1.5rem;
          }

          .form-row {
            grid-template-columns: 1fr;
          }

          .profile-picture-upload {
            flex-direction: column;
            text-align: center;
          }
        }
      `}</style>

      <nav className="navbar">
        <a href="/" className="navbar-brand">
          <img src="/iskologo.png" alt="iskoMats" style={{ height: '56px', marginRight: '16px', verticalAlign: 'middle' }} />
          iskoMats
        </a>
      </nav>

      <div className="profile-wrapper">
        <div className="profile-card">
          <h2>Complete your Profile</h2>
          <p>Help us get to know you better to find the best scholarships for you</p>

          {showError && (
            <div className="error-message">
              <i className="fas fa-exclamation-triangle"></i>
              <span>{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleProfileSubmit} className="profile-form">
            <div className="profile-picture-upload">
              <div
                className="profile-pic"
                dangerouslySetInnerHTML={{ __html: profilePicture ? `<img src="${profilePicture}" alt="profile" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">` : '<span>👤</span>' }}
              />
              <div className="profile-form-group">
                <label>Profile Picture (Optional)</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleProfilePictureUpload}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="profile-form-group">
                <label>First Name *</label>
                <input type="text" name="firstName" placeholder="e.g., Maria" required />
              </div>
              <div className="profile-form-group">
                <label>Middle Name</label>
                <input type="text" name="middleName" placeholder="e.g., Dela Cruz" />
              </div>
            </div>

            <div className="profile-form-group">
              <label>Last Name *</label>
              <input type="text" name="lastName" placeholder="e.g., Santos" required />
            </div>

            <div className="profile-form-group">
              <label>Birthdate *</label>
              <input type="date" name="birthdate" required />
            </div>

            <div className="profile-form-group">
              <label>University / School *</label>
              <select name="school" required>
                <option value="">Select School</option>
                <option value="De La Salle University">De La Salle University</option>
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

            <div className="profile-form-group">
              <label>Phone Number *</label>
              <input type="tel" name="mobileNo" placeholder="+63 ..." required />
            </div>

            <div className="profile-form-group">
              <label>Street / Barangay *</label>
              <select name="streetBrgy" required>
                <option value="">Select Barangay</option>
                <option value="Adya">Adya</option>
                <option value="Anilao">Anilao</option>
                <option value="Bagong Pook">Bagong Pook</option>
                <option value="Balintawak">Balintawak</option>
                <option value="Poblacion Barangay 1">Poblacion Barangay 1</option>
                <option value="Poblacion Barangay 2">Poblacion Barangay 2</option>
              </select>
            </div>

            <div className="form-row">
              <div className="profile-form-group">
                <label>Town / City / Municipality *</label>
                <input type="text" name="townCityMunicipality" placeholder="e.g., Lipa City" required />
              </div>
              <div className="profile-form-group">
                <label>Province *</label>
                <input type="text" name="province" placeholder="e.g., Batangas" required />
              </div>
            </div>

            <div className="profile-form-group">
              <label>Zip Code *</label>
              <input type="text" name="zipCode" placeholder="e.g., 4217" required />
            </div>

            <div className="form-row">
              <div className="profile-form-group">
                <label>Overall GPA (Optional)</label>
                <input type="number" name="overallGpa" placeholder="e.g., 3.5" step="0.01" min="0" max="4" />
              </div>
              <div className="profile-form-group">
                <label>Parents' Gross Income (Optional)</label>
                <input type="number" name="financialIncomeOfParents" placeholder="e.g., 50000" />
              </div>
            </div>

            <button type="submit" className="submit-btn">
              Complete Profile & Continue
            </button>
          </form>
        </div>
      </div>

      {/* Loading Overlay */}
      <div className={`loading-overlay ${showLoadingOverlay ? 'active' : ''}`}>
        <div className="loading-modal">
          <div className="loading-spinner"></div>
          <h3 style={{ fontSize: '1.3rem', marginBottom: '0.5rem' }}>{loadingMessage.title}</h3>
          <p style={{ color: 'var(--text-soft)' }}>{loadingMessage.message}</p>
        </div>
      </div>
    </>
  );
};

export default ProfileSetup;
