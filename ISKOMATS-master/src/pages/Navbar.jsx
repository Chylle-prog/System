import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './Navbar.css';

const Navbar = ({ showMenu = false, userEmail = '' }) => {
  const { logout, currentUser } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <nav className="navbar">
      <Link to="/" className="navbar-brand">
        <img src="/iskologo.png" alt="iskoMats Logo" className="navbar-brand-logo" />
        <span className="navbar-brand-text">iskoMats</span>
      </Link>
      
      {!currentUser ? (
        <div className="navbar-nav">
          <a href="#about" onClick={(e) => { e.preventDefault(); document.getElementById('about')?.scrollIntoView({ behavior: 'smooth' }); }}>About Us</a>
          <a href="#application" onClick={(e) => { e.preventDefault(); document.getElementById('application')?.scrollIntoView({ behavior: 'smooth' }); }}>Scholarship Programs</a>
          <a href="#contact" onClick={(e) => { e.preventDefault(); document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' }); }}>Contact Info</a>
          <Link to="/login" className="nav-btn">Apply Now</Link>
        </div>
      ) : (
        <div className="navbar-menu">
          <span className="user-email">{userEmail || currentUser}</span>
          {showMenu && (
            <>
              <button className="profile-btn" onClick={() => navigate('/profile')}>
                <i className="fas fa-user-circle" style={{ marginRight: '6px' }}></i>Profile
              </button>
              <div className="notification-wrapper">
                <button className="notification-btn" id="notificationBell">
                  <i className="fas fa-bell"></i>
                  <span className="notification-badge" style={{ display: 'none' }}>0</span>
                </button>
              </div>
            </>
          )}
          <button className="logout-btn" onClick={handleLogout}>
            <i className="fas fa-sign-out-alt" style={{ marginRight: '6px' }}></i>Logout
          </button>
        </div>
      )}
    </nav>
  );
};

export default Navbar;