import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { applicantAPI, scholarshipAPI, applicationAPI, verificationAPI } from '../services/api';

const FindScholarship = () => {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [showFormView, setShowFormView] = useState(true);
  const [showResultsView, setShowResultsView] = useState(false);
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState({ title: '', message: '' });
  const [scholarshipMatches, setScholarshipMatches] = useState([]);
  const [ineligibleMatches, setIneligibleMatches] = useState([]);
  const [successBanner, setSuccessBanner] = useState('');
  const [hasApprovedApplication, setHasApprovedApplication] = useState(false);

  
  const [incomeLevel, setIncomeLevel] = useState('');

  const [formData, setFormData] = useState({
    fullName: '',
    university: '',
    gpa: '',
    income: '',
    street_brgy: '',
    town_city_municipality: '',
    province: '',
    zip_code: ''
  });

  const videoRef = useRef(null);
  const cameraTimeoutRef = useRef(null);



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

    if (!user) {
      navigate('/login');
      return;
    }

    setCurrentUser(user);

    // Pre-fill form fields from the backend profile API
    const loadProfile = async () => {
      try {
        setLoadingMessage({ title: 'Loading Profile', message: 'Retrieving your information to pre-fill the form...' });
        setShowLoadingOverlay(true);
        const profile = await applicantAPI.getProfile();
        setUserProfile(profile);

        const fullName = [
          profile.first_name,
          profile.last_name
        ].filter(Boolean).join(' ');

        setFormData(prev => ({
          ...prev,
          fullName,
          university: profile.school || '',
          street_brgy: profile.street_brgy || '',
          town_city_municipality: profile.town_city_municipality || '',
          province: profile.province || '',
          zip_code: profile.zip_code || '',
          // gpa and income intentionally left as '' (empty)
        }));

        try {
          const apps = await applicationAPI.getUserApplications();
          if (apps && Array.isArray(apps)) {
            const approvedApp = apps.find(app => app.status === 'Approved');
            if (approvedApp) {
              setHasApprovedApplication(true);
            }
          }
        } catch (appErr) {
          console.warn('Could not load user applications:', appErr.message);
        }

      } catch (err) {
        console.warn('Could not pre-fill from profile:', err.message);
      } finally {
        setShowLoadingOverlay(false);
      }
    };

    loadProfile();

    return () => {
      document.head.removeChild(fontAwesomeLink);
      document.head.removeChild(googleFontsLink);
      document.head.removeChild(googleFontsDisplay);
      document.head.removeChild(googleFontsSheet);
    };
  }, [navigate]);

  const logout = () => {
    localStorage.removeItem('currentUser');
    navigate('/');
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

  const convertGpaToPercentage = (gpa, university) => {
    // If it's already a percentage (e.g., 85, 92.5), return it directly
    if (gpa > 5.0) return gpa;

    const uniName = (university || '').toLowerCase();

    // DLSL Scale (4.00 is highest)
    if (uniName.includes('la salle') || uniName.includes('dlsl')) {
      if (gpa >= 3.87) return 99; // 4.00 -> 98-100
      if (gpa >= 3.62) return 96; // 3.75 -> 95-97
      if (gpa >= 3.37) return 93; // 3.50 -> 92-94
      if (gpa >= 3.12) return 90; // 3.25 -> 89-91
      if (gpa >= 2.87) return 87; // 3.00 -> 86-88
      if (gpa >= 2.62) return 84; // 2.75 -> 83-85
      if (gpa >= 2.37) return 81; // 2.50 -> 80-82
      if (gpa >= 2.12) return 78; // 2.25 -> 77-79
      if (gpa >= 1.50) return 75; // 2.00 -> 75-76
      return 70;                  // Below 75 -> 0.00
    }

    // NU Lipa Scale (1.00 is highest)
    if (uniName.includes('nu lipa') || uniName.includes('national university')) {
      if (gpa <= 1.12) return 99; // 1.00 -> 97-100
      if (gpa <= 1.37) return 95; // 1.25 -> 94-96
      if (gpa <= 1.62) return 92; // 1.50 -> 91-93
      if (gpa <= 1.87) return 89; // 1.75 -> 88-90
      if (gpa <= 2.12) return 86; // 2.00 -> 85-87
      if (gpa <= 2.37) return 83; // 2.25 -> 82-84
      if (gpa <= 2.62) return 80; // 2.50 -> 79-81
      if (gpa <= 2.87) return 77; // 2.75 -> 76-78
      if (gpa <= 4.00) return 75; // 3.00 -> 75
      return 70;                  // 5.00 -> Below 75
    }

    return gpa; // Default fallback
  };

  const handleScholarshipSearch = async (e) => {
    e.preventDefault();

    const rawGpa = parseFloat(formData.gpa);
    const gpa = convertGpaToPercentage(rawGpa, formData.university);
    const income = parseInt(formData.income);

    if (isNaN(gpa) || isNaN(income)) {
      alert('Please enter a valid GPA and income.');
      return;
    }

      setLoadingMessage({ title: 'Searching Scholarships', message: 'Analyzing your profile to find the best matches...' });
      setShowLoadingOverlay(true);

    try {
      // Step 1: Save GPA / income to profile
      try {
        await applicantAPI.updateProfile({
          overall_gpa: gpa,
          financial_income_of_parents: income,
          street_brgy: formData.street_brgy,
          town_city_municipality: formData.town_city_municipality,
          province: formData.province,
          zip_code: formData.zip_code,
        });
      } catch (saveErr) {
        console.warn('Could not save profile:', saveErr.message);
      }

      // Step 2: Scholarship ranking
      const response = await scholarshipAPI.getRankings({
        gpa,
        income,
        street_brgy: formData.street_brgy,
        town_city_municipality: formData.town_city_municipality,
        province: formData.province,
        zip_code: formData.zip_code,
      });

      const { eligible = [], ineligible = [] } = response;

      setShowLoadingOverlay(false);

      if (eligible.length > 0) {
        setSuccessBanner(`Found ${eligible.length} scholarship${eligible.length > 1 ? 's' : ''} matching your profile — ranked by estimated fit.`);
      } else if (ineligible.length > 0) {
        setSuccessBanner('No scholarships perfectly match your criteria, but we found some potential opportunities below.');
      } else {
        setSuccessBanner('No scholarships found. Try adjusting your criteria or checking again later.');
      }

      setScholarshipMatches(eligible);
      setIneligibleMatches(ineligible);
      setShowFormView(false);
      setShowResultsView(true);

    } catch (err) {
      setShowLoadingOverlay(false);
      console.error('Scholarship search error:', err);
      alert(`Error searching scholarships: ${err.message}`);
    }
  };


  const switchToFormView = () => {
    setShowFormView(true);
    setShowResultsView(false);
  };

  const applyForScholarship = (scholarshipName, reqNo) => {
    // Navigate to student info page with scholarship details and search criteria
    navigate(`/studentinfo?scholarship=${encodeURIComponent(scholarshipName)}&reqNo=${reqNo}&gpa=${formData.gpa}&income=${formData.income}`);
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

        .scholarship-card.ineligible {
          opacity: 0.85;
          border-left: 4px solid var(--danger);
          background: #fffcfc;
        }

        .scholarship-card.ineligible h4 {
          color: var(--text-soft);
        }

        .ineligible-badge {
          background: var(--danger-bg);
          color: var(--danger);
          padding: 0.5rem 1rem;
          border-radius: 12px;
          font-size: 0.85rem;
          font-weight: 700;
          margin-bottom: 1.5rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .reasons-list {
          margin-top: 0.5rem;
          padding-left: 1.2rem;
          color: var(--danger);
          font-size: 0.85rem;
          font-weight: 500;
        }

        .reasons-list li {
          margin-bottom: 0.3rem;
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
          padding: 1rem 1.2rem;
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

      {/* FORM VIEW */}
      {showFormView && (
        <div className="form-view">
          <div style={{maxWidth: '800px', margin: '0 auto', padding: '0 1rem'}}>
            <Link to="/portal" className="back-button">
              <i className="fas fa-arrow-left"></i> Back to Portal
            </Link>
            <h3 style={{color: 'var(--primary)', fontSize: '1.8rem', fontWeight: '700', textAlign: 'center', marginBottom: '1rem'}}>
              Find Scholarships
            </h3>

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
                  <span className="income-indicator" style={{color: incomeLevel.includes('Low') ? 'var(--success)' : incomeLevel.includes('Middle') ? 'var(--warning)' : 'var(--danger)'}}>
                    {incomeLevel}
                  </span>
                )}
              </div>

              <button type="submit" className="submit-btn">Find Scholarships</button>

            </form>
          </div>
        </div>
      )}


      {/* RESULTS VIEW */}
      {showResultsView && (
        <div className="results-view active">
          <div className="results-header">
            <h2>Your Scholarship Matches</h2>
            <p>Based on your profile, we've found these opportunities tailored for you.</p>
          </div>
          <div style={{textAlign: 'center', marginBottom: '1.5rem'}}>
            <button className="back-to-form-btn" onClick={switchToFormView}>
              <i className="fas fa-arrow-left" style={{marginRight: '8px'}}></i>
              Back to search form
            </button>
          </div>
          {successBanner && (
            <div className="success-banner">
              {successBanner}
            </div>
          )}
          <div className="scholarship-grid">
            {scholarshipMatches.length > 0 && (
              scholarshipMatches.map((match, index) => (
                <div key={match.req_no ?? index} className="scholarship-card">
                  <h4>{match.name}</h4>
                  <div className="scholarship-provider">
                    {match.location ? `📍 ${match.location}` : '🌐 Open to all locations'}
                  </div>
                  <div className="scholarship-requirements">
                    {match.minGpa != null && (
                      <div className="requirement-badge">Min GPA: {match.minGpa}</div>
                    )}
                    {match.maxIncome != null && (
                      <div className="requirement-badge">Max Income: ₱{Number(match.maxIncome).toLocaleString()}/yr</div>
                    )}
                    {match.deadline && (
                      <div className="requirement-badge">
                        Deadline: {new Date(match.deadline).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })}
                      </div>
                    )}
                  </div>
                  <div className="scholarship-benefits">
                    🏆 Match score: <strong>{match.score}</strong> pts
                  </div>
                  <button 
                    className="apply-btn" 
                    onClick={() => applyForScholarship(match.name, match.req_no)}
                    disabled={hasApprovedApplication || match.alreadyApplied}
                    style={(hasApprovedApplication || match.alreadyApplied) ? { backgroundColor: 'var(--gray-3)', cursor: 'not-allowed', color: 'white', opacity: 0.8 } : {}}
                  >
                    {hasApprovedApplication ? 'Limit Reached: Already Approved' : 
                     match.alreadyApplied ? 'Already Applied' : 'Apply for this Scholarship'}
                  </button>
                </div>
              ))
            )}

            {ineligibleMatches.length > 0 && (
              ineligibleMatches.map((match, index) => (
                <div key={`ineligible-${match.req_no ?? index}`} className="scholarship-card ineligible">
                  <div className="ineligible-badge">
                    <i className="fas fa-exclamation-circle"></i> Not Eligible
                  </div>
                  <h4>{match.name}</h4>
                  <div className="scholarship-provider">
                    {match.location ? `📍 ${match.location}` : '🌐 Open to all locations'}
                  </div>
                  
                  <div style={{ marginBottom: '1rem' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--text-soft)', textTransform: 'uppercase' }}>Reason for ineligibility:</span>
                    <ul className="reasons-list">
                      {match.reasons.map((reason, rIdx) => (
                        <li key={rIdx}>{reason}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="scholarship-requirements" style={{ opacity: 0.6 }}>
                    {match.minGpa != null && (
                      <div className="requirement-badge">Min GPA: {match.minGpa}</div>
                    )}
                    {match.maxIncome != null && (
                      <div className="requirement-badge">Max Income: ₱{Number(match.maxIncome).toLocaleString()}/yr</div>
                    )}
                  </div>

                  <button 
                    className="apply-btn" 
                    disabled={true}
                    style={{ backgroundColor: 'var(--gray-2)', color: 'var(--gray-3)', cursor: 'not-allowed' }}
                  >
                    {match.alreadyApplied ? 'Already Applied' : 'Not Eligible to Apply'}
                  </button>
                </div>
              ))
            )}

            {scholarshipMatches.length === 0 && ineligibleMatches.length === 0 && (
              <div className="no-results">
                <i className="fas fa-search" style={{fontSize: '2rem', opacity: '0.5', marginBottom: '1rem'}}></i>
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

export default FindScholarship;
