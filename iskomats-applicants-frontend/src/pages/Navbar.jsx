import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './Navbar.css';

const Navbar = ({ showMenu = false, userEmail = '' }) => {
  const { logout, currentUser, userProfile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const toggleMobileMenu = () => {
    setMobileMenuOpen(!mobileMenuOpen);
  };

  const handleNavClick = (e, sectionId) => {
    e.preventDefault();
    setMobileMenuOpen(false);
    
    if (location.pathname === '/') {
      const element = document.getElementById(sectionId);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
    } else {
      navigate('/', { state: { scrollTo: sectionId } });
    }
  };

  // Get first name from profiles if available, or fallback to cached name, or email
  const cachedName = localStorage.getItem('userFirstName');
  const displayName = userProfile?.first_name || cachedName || userEmail || currentUser;

  return (
    <nav className="navbar">
      <div className="navbar-header">
        <Link to="/" className="navbar-brand">
          <img src="/iskologo.png" alt="iskoMats Logo" className="navbar-brand-logo" />
          <span className="navbar-brand-text">iskoMats</span>
        </Link>
        <button 
          className="mobile-toggle-btn" 
          onClick={toggleMobileMenu} 
          aria-label="Toggle navigation menu"
        >
          <i className={mobileMenuOpen ? "fas fa-times" : "fas fa-bars"}></i>
        </button>
      </div>
      
      {!currentUser ? (
        <div className={`navbar-nav ${mobileMenuOpen ? 'mobile-open' : ''}`}>
          <a href="#about" onClick={(e) => handleNavClick(e, 'about')}>About Us</a>
          <a href="#application" onClick={(e) => handleNavClick(e, 'application')}>Scholarship Programs</a>
          <a href="#contact" onClick={(e) => handleNavClick(e, 'contact')}>Contact Info</a>
          <Link to="/login" className="nav-btn" onClick={() => setMobileMenuOpen(false)}>Apply Now</Link>
        </div>
      ) : (
        <div className={`navbar-menu ${mobileMenuOpen ? 'mobile-open' : ''}`}>
          <span className="user-email"><i className="fas fa-user-circle mr-1"></i> {displayName}</span>
          {showMenu && (
            <>
              <button className="profile-btn" onClick={() => { setMobileMenuOpen(false); navigate('/profile'); }}>
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