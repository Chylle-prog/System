import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import iskoLogo from '../assets/iskologo.png';
import './Navbar.css';

const Navbar = ({ showMenu = false, userEmail = '', onApplyClick }) => {
  const { logout, currentUser, userProfile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const toggleMobileMenu = () => {
    setMobileMenuOpen(prev => !prev);
  };

  const closeMobileMenu = () => {
    setMobileMenuOpen(false);
  };

  const handleNavClick = (e, sectionId) => {
    e.preventDefault();
    closeMobileMenu();
    if (location.pathname !== '/') {
      navigate('/');
      if (sectionId && sectionId !== 'hero') {
        setTimeout(() => {
          document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' });
        }, 150);
      }
    } else {
      if (sectionId === 'hero') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' });
      }
    }
  };

  // Get first name from profiles if available, or fallback to cached name, or email
  const cachedName = localStorage.getItem('userFirstName');
  const displayName = userProfile?.first_name || cachedName || userEmail || currentUser;

  return (
    <nav className="navbar">
      <div className="navbar-header-row">
        <Link to="/" className="navbar-brand" onClick={closeMobileMenu}>
          <img src={iskoLogo} alt="iskoMats Logo" className="navbar-brand-logo" />
          <span className="navbar-brand-text">iskoMats</span>
        </Link>
        <button
          className="navbar-toggle-btn"
          aria-label="Toggle navigation menu"
          onClick={toggleMobileMenu}
        >
          <i className={mobileMenuOpen ? "fas fa-times" : "fas fa-bars"}></i>
        </button>
      </div>

      {!currentUser ? (
        <div className={`navbar-nav ${mobileMenuOpen ? 'active' : ''}`}>
          <a href="/" onClick={(e) => handleNavClick(e, 'hero')}>
            <i className="fas fa-home nav-icon"></i>Home
          </a>
          <a href="#about" onClick={(e) => handleNavClick(e, 'about')}>
            <i className="fas fa-info-circle nav-icon"></i>About Us
          </a>
          <a href="#application" onClick={(e) => handleNavClick(e, 'application')}>
            <i className="fas fa-graduation-cap nav-icon"></i>Scholarship Programs
          </a>
          <a href="#contact" onClick={(e) => handleNavClick(e, 'contact')}>
            <i className="fas fa-envelope nav-icon"></i>Contact Info
          </a>
          {!['/login', '/forgot-password', '/applicant-forgot-password', '/verify-email'].includes(location.pathname) && (
            <a
              href="/login"
              className="nav-btn"
              onClick={(e) => {
                closeMobileMenu();
                if (onApplyClick) {
                  onApplyClick(e, '/login');
                } else {
                  e.preventDefault();
                  navigate('/login');
                }
              }}
            >
              LOGIN
            </a>
          )}
        </div>
      ) : (
        <div className={`navbar-menu ${mobileMenuOpen ? 'active' : ''}`}>
          <div className="navbar-user-chip">
            <i className="fas fa-user-circle"></i>
            <span>{displayName}</span>
          </div>
          {showMenu && (
            <>
              <button className="profile-btn" onClick={() => { closeMobileMenu(); navigate('/profile'); }}>
                <i className="fas fa-user"></i>Profile
              </button>
              <div className="notification-wrapper">
                <button className="notification-btn" id="notificationBell" title="Notifications">
                  <i className="fas fa-bell"></i>
                  <span className="notif-label">Notifications</span>
                  <span className="notification-badge" style={{ display: 'none' }}>0</span>
                </button>
              </div>
            </>
          )}
          <button className="logout-btn" onClick={() => { closeMobileMenu(); handleLogout(); }}>
            <i className="fas fa-sign-out-alt"></i>Logout
          </button>
        </div>
      )}
    </nav>
  );
};

export default Navbar;