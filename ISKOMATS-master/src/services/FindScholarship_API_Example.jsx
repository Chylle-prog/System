/**
 * EXAMPLE: FindScholarship.jsx refactored to use API routes
 * 
 * This is a reduced example showing key changes needed to connect
 * the FindScholarship component to the Flask backend API.
 * 
 * Key changes:
 * 1. Import api service
 * 2. Replace localStorage calls with API calls
 * 3. Add loading and error states
 * 4. Update form submission to use API
 */

import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { scholarshipAPI, applicantAPI } from '../services/api';

const FindScholarshipWithAPI = () => {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [scholarshipMatches, setScholarshipMatches] = useState([]);
  const [formData, setFormData] = useState({
    gpa: '',
    income: '',
    address: ''
  });
  
  // New state management
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Load user profile on component mount
  useEffect(() => {
    const initializeComponent = async () => {
      try {
        // Check if user has valid auth token
        const token = localStorage.getItem('authToken');
        if (!token) {
          navigate('/login');
          return;
        }

        // Validate token
        await api.auth.validateToken();

        // Load user profile from API
        const profile = await applicantAPI.getProfile();
        setUserProfile(profile);
        setCurrentUser(profile.firstName + ' ' + profile.lastName);

        // Pre-fill form with profile data
        if (profile) {
          setFormData({
            gpa: profile.gpa || '',
            income: profile.income || '',
            address: profile.address || ''
          });
        }
      } catch (err) {
        console.error('Initialization error:', err);
        // Clear invalid token and redirect to login
        localStorage.removeItem('authToken');
        navigate('/login');
      }
    };

    initializeComponent();
  }, [navigate]);

  // Handle form input changes
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // Handle scholarship search with API
  const handleFindScholarships = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Validate form
    if (!formData.gpa || !formData.income || !formData.address) {
      setError('Please fill in all fields');
      return;
    }

    try {
      setLoading(true);

      // Get rankings from API
      const rankings = await scholarshipAPI.getRankings({
        gpa: parseFloat(formData.gpa),
        income: parseFloat(formData.income),
        address: formData.address
      });

      if (rankings.length === 0) {
        setSuccess('No scholarships match your profile at this time.');
        setScholarshipMatches([]);
      } else {
        setSuccess(`Found ${rankings.length} matching scholarships`);
        setScholarshipMatches(rankings);

        // Also update user profile in database
        await applicantAPI.updateProfile({
          gpa: parseFloat(formData.gpa),
          income: parseFloat(formData.income),
          address: formData.address
        });
      }
    } catch (err) {
      console.error('Error fetching scholarships:', err);
      setError('Failed to fetch scholarships: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Handle apply button click
  const handleApplyScholarship = async (reqNo) => {
    try {
      setLoading(true);
      const result = await api.applications.submit(reqNo, {});
      setSuccess(`Successfully applied for: ${result.scholarship}`);
      
      // Refresh scholarship list after applying
      setTimeout(() => {
        handleFindScholarships({ preventDefault: () => {} });
      }, 1500);
    } catch (err) {
      setError('Error submitting application: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Handle logout
  const handleLogout = async () => {
    try {
      api.auth.logout();
      localStorage.removeItem('authToken');
      navigate('/');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  return (
    <div className="find-scholarship-container">
      <style>{`
        .find-scholarship-container {
          max-width: 1000px;
          margin: 0 auto;
          padding: 20px;
          background: #f8f9fa;
          min-height: 100vh;
        }

        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 30px;
          background: white;
          padding: 20px;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }

        .header h1 {
          color: #2c3e50;
          margin: 0;
          font-size: 1.8em;
        }

        .logout-btn {
          background: #e74c3c;
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 1em;
        }

        .logout-btn:hover {
          background: #c0392b;
        }

        .form-container {
          background: white;
          padding: 30px;
          border-radius: 8px;
          margin-bottom: 30px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }

        .form-group {
          margin-bottom: 20px;
        }

        .form-group label {
          display: block;
          font-weight: bold;
          color: #2c3e50;
          margin-bottom: 8px;
        }

        .form-group input,
        .form-group textarea {
          width: 100%;
          padding: 12px;
          border: 1px solid #ccc;
          border-radius: 6px;
          font-size: 1em;
          box-sizing: border-box;
        }

        .form-group textarea {
          min-height: 80px;
          resize: vertical;
        }

        .btn-primary {
          background: #27ae60;
          color: white;
          border: none;
          padding: 14px 40px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 1.1em;
          font-weight: bold;
        }

        .btn-primary:hover {
          background: #219653;
        }

        .btn-primary:disabled {
          background: #95a5a6;
          cursor: not-allowed;
        }

        .status-message {
          padding: 15px;
          border-radius: 6px;
          margin-bottom: 20px;
        }

        .status-message.error {
          background: #f2dede;
          color: #a94442;
          border: 1px solid #ebccd1;
        }

        .status-message.success {
          background: #dff0d8;
          color: #3c763d;
          border: 1px solid #d6e9c6;
        }

        .results-container {
          background: white;
          padding: 30px;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }

        .results-container h2 {
          color: #2c3e50;
          margin-top: 0;
        }

        .scholarship-table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 20px;
        }

        .scholarship-table th {
          background: #ecf0f1;
          padding: 12px;
          text-align: left;
          font-weight: bold;
          border-bottom: 2px solid #bdc3c7;
        }

        .scholarship-table td {
          padding: 12px;
          border-bottom: 1px solid #ecf0f1;
        }

        .scholarship-table tr:hover {
          background: #f5f5f5;
        }

        .scholarship-table tr:first-of-type td {
          background: #fffacd;
          font-weight: bold;
        }

        .btn-apply {
          background: #3498db;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.9em;
        }

        .btn-apply:hover {
          background: #2980b9;
        }

        .loading-spinner {
          display: inline-block;
          width: 20px;
          height: 20px;
          border: 3px solid #f3f3f3;
          border-top: 3px solid #3498db;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-right: 10px;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>

      {/* Header */}
      <div className="header">
        <h1>Find Scholarships</h1>
        <button className="logout-btn" onClick={handleLogout}>
          Logout
        </button>
      </div>

      {/* Status Messages */}
      {error && <div className="status-message error">{error}</div>}
      {success && <div className="status-message success">{success}</div>}

      {/* Search Form */}
      <div className="form-container">
        <h2>Your Profile</h2>
        <form onSubmit={handleFindScholarships}>
          <div className="form-group">
            <label htmlFor="gpa">Overall GPA</label>
            <input
              type="number"
              id="gpa"
              name="gpa"
              step="0.01"
              min="0"
              max="4.0"
              value={formData.gpa}
              onChange={handleInputChange}
              placeholder="e.g., 3.5"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="income">Annual Family Income (₱)</label>
            <input
              type="number"
              id="income"
              name="income"
              min="0"
              value={formData.income}
              onChange={handleInputChange}
              placeholder="e.g., 500000"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="address">Address</label>
            <textarea
              id="address"
              name="address"
              value={formData.address}
              onChange={handleInputChange}
              placeholder="Street, Barangay, City, Province"
              required
            />
          </div>

          <button
            type="submit"
            className="btn-primary"
            disabled={loading}
          >
            {loading ? (
              <>
                <div className="loading-spinner"></div>
                Searching...
              </>
            ) : (
              'Find Matching Scholarships'
            )}
          </button>
        </form>
      </div>

      {/* Results Table */}
      {scholarshipMatches.length > 0 && (
        <div className="results-container">
          <h2>Your Best Matching Scholarships</h2>
          <table className="scholarship-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Scholarship Name</th>
                <th>Min GPA</th>
                <th>Max Income</th>
                <th>Location</th>
                <th>Deadline</th>
                <th>Match Score</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {scholarshipMatches.map((scholarship, index) => (
                <tr key={scholarship.req_no}>
                  <td>{index + 1}</td>
                  <td>{scholarship.name}</td>
                  <td>{scholarship.minGpa || '—'}</td>
                  <td>{scholarship.maxIncome ? `₱${scholarship.maxIncome.toLocaleString()}` : 'No limit'}</td>
                  <td>{scholarship.location || 'Any'}</td>
                  <td>{scholarship.deadline || '—'}</td>
                  <td><strong>{scholarship.score}</strong></td>
                  <td>
                    <button
                      className="btn-apply"
                      onClick={() => handleApplyScholarship(scholarship.req_no)}
                      disabled={loading}
                    >
                      Apply Now
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default FindScholarshipWithAPI;

/**
 * MIGRATION CHECKLIST:
 * 
 * ✓ Import api services
 * ✓ Remove localStorage references for scholarships
 * ✓ Replace with API calls in useEffect and event handlers
 * ✓ Add loading and error states
 * ✓ Update form submission to call API
 * ✓ Handle JWT token validation on mount
 * ✓ Implement logout via API
 * ✓ Add proper error handling
 * ✓ Update UI to show loading states
 * ✓ Test with backend API
 */
