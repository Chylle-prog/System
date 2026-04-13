import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import Navbar from './Navbar';
import './HomePage.css';

const HomePage = () => {
  const [activeModal, setActiveModal] = useState(null);
  const [showPhonePopup, setShowPhonePopup] = useState(false);
  const [activeFAQ, setActiveFAQ] = useState(null);
  const [activeCategory, setActiveCategory] = useState('all');

  const scrollToSection = (sectionId) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const showScholarshipModal = (scholarshipId) => {
    setActiveModal(scholarshipId);
    document.body.style.overflow = 'hidden';
  };

  const closeModal = () => {
    setActiveModal(null);
    document.body.style.overflow = '';
  };

  const toggleFAQ = (index) => {
    setActiveFAQ(activeFAQ === index ? null : index);
  };

  const filterFAQ = (category) => {
    setActiveCategory(category);
  };

  const scholarshipData = {
    'mayor-scholarship': {
      name: "Mayor Eric B. Africa's Scholarship",
      icon: 'fas fa-landmark',
      description: "A prestigious scholarship program established by Mayor Eric B. Africa to support deserving students in the local community. Focuses on academic excellence and community service.",
      sections: [
        {
          title: "Eligibility Requirements:",
          items: [
            "GPA of 3.5 and above",
            "Monthly family income ≤ ₱60,000",
            "Resident of Lipa City",
            "Enrolled in any college/university within Lipa City",
            "Good moral character",
            "No pending disciplinary cases"
          ]
        },
        {
          title: "Application Requirements:",
          items: [
            "Duly accomplished application form",
            "Certificate of Registration",
            "Latest transcript of records",
            "Proof of residency (Barangay Certificate)",
            "Parents' income tax return",
            "Two recommendation letters",
            "Essay on community service goals"
          ]
        },
        {
          title: "Benefits & Coverage:",
          items: [
            "100% tuition and miscellaneous fees",
            "₱6,000 monthly stipend for 10 months",
            "₱5,000 book allowance per semester",
            "₱2,000 transportation allowance monthly",
            "Leadership and development training",
            "Mentorship program with city officials"
          ]
        },
        {
          title: "Maintenance Requirements:",
          items: [
            "Maintain GPA of 3.0 or higher",
            "Complete 20 hours community service per semester",
            "Submit semester grade reports",
            "Attend quarterly scholar meetings",
            "Submit annual accomplishment report"
          ]
        }
      ]
    },
    'governor-scholarship': {
      name: "Governor Vilma Santos-Recto's Scholarship",
      icon: 'fas fa-award',
      description: "Established by Governor Vilma Santos-Recto to provide educational assistance to outstanding students from Batangas province. Emphasizes leadership and academic achievement.",
      sections: [
        {
          title: "Eligibility Requirements:",
          items: [
            "GPA of 3.5 and below",
            "Monthly family income ≤ ₱20,000",
            "Resident of Batangas province",
            "Enrolled in any accredited college/university",
            "Good moral character with barangay clearance",
            "No current educational assistance from other sources"
          ]
        },
        {
          title: "Application Requirements:",
          items: [
            "Scholarship application form",
            "Certificate of Enrollment",
            "Latest grade report",
            "Certificate of indigency",
            "Barangay residency certificate",
            "Parents' certificate of employment (if applicable)",
            "Character reference from school official"
          ]
        },
        {
          title: "Benefits & Coverage:",
          items: [
            "Partial to full tuition assistance",
            "₱5,000 monthly allowance",
            "Book allowance of ₱3,000 per semester",
            "Leadership development program",
            "Academic monitoring and support",
            "Networking opportunities with provincial leaders"
          ]
        },
        {
          title: "Maintenance Requirements:",
          items: [
            "Maintain passing grades (no failing marks)",
            "Submit grade reports each semester",
            "Attend scholar development activities",
            "Participate in provincial youth programs",
            "Submit annual progress report"
          ]
        }
      ]
    },
    'ched-scholarship': {
      name: "CHED's Tulong Dunong",
      icon: 'fas fa-graduation-cap',
      description: "A national scholarship program by the Commission on Higher Education providing financial assistance to students in priority courses. Supports STEM and other critical fields.",
      sections: [
        {
          title: "Qualifications:",
          items: [
            "Mga Pilipinong undergraduate students;",
            "Ang pinagsamang gross income ng household (magulang o guardian) ay hindi dapat lumalampas sa PHP 400,000 sa loob ng isang taon;",
            "Naka-enrol sa anumang unang undergraduate degree programs sa SUCs, LUCs, o Private Higher Education Institutions na kasama sa CHED Registry;",
            "Hindi hihigit sa tinakdang palugit ng programa; at",
            "Hindi benepisyaryo ng TES, CHED Scholarship Programs (CSPs), at iba pang national government-funded StuFAPs."
          ]
        },
        {
          title: "Requirements:",
          items: [
            "Tulong Dunong Program–Tertiary Education Subsidy Application Form.",
            "Certified True Copy / Electronically Generated Certificate of Enrolment (COE) o Certificate of Registration (COR) na nag-papakita ng bilang ng units bilang patunay ng pag-enrol.",
            "Certificate of Indigency bilang patunay ng kita na pirmado ng Punong Barangay kung saan nakatira ang aplikante."
          ]
        },
        {
          title: "Benefits & Coverage:",
          items: [
            "Financial assistance of Php 15,000 per academic year",
            "Support for tertiary education expenses including school fees and tuition",
            "Living allowance to help manage day-to-day expenses"
          ]
        }
      ]
    }
  };

  return (
    <>
      <Navbar />
      
      <section className="homepage">
        <div className="hero">
          <h1>Tulong Isko, Tulong Bayan!</h1>
          <p>Unlock your future with iskoMats – A centralized scholarship matching made simple and smart.</p>
          <Link to="/login" className="cta-button">Apply Now →</Link>
          <div className="features">
            <div className="feature-card">
              <h3><span style={{fontSize: '1.2rem', marginRight: '0.5rem'}}>🎯</span> 90% match rate</h3>
              <p>Smart filters show only relevant awards.</p>
            </div>
            <div className="feature-card">
              <h3><span style={{fontSize: '1.2rem', marginRight: '0.5rem'}}>📈</span> ₱40M+ awarded</h3>
              <p>Through our partner institutions.</p>
            </div>
            <div className="feature-card">
              <h3><span style={{fontSize: '1.2rem', marginRight: '0.5rem'}}>🏛️</span> 200+ partners</h3>
              <p>Trusted universities & donors.</p>
            </div>
            <div className="feature-card">
              <h3><span style={{fontSize: '1.2rem', marginRight: '0.5rem'}}>⚡</span> real‑time tracking</h3>
              <p>From application to decision.</p>
            </div>
          </div>
        </div>

        <div className="branded-section">
          <h2>Why Choose iskoMats?</h2>
          <div className="branded-grid">
            <div className="branded-card">
              <h3><span style={{fontSize: '1.2rem', marginRight: '0.5rem'}}>✓</span> Personalized Matching</h3>
              <p>Our Rule-based matching analyzes your profile and matches you with the most relevant scholarships based on your qualifications.</p>
            </div>
            <div className="branded-card">
              <h3><span style={{fontSize: '1.2rem', marginRight: '0.5rem'}}>✓</span> Fast & Easy</h3>
              <p>Complete your profile in minutes and start discovering scholarships tailored just for you.</p>
            </div>
            <div className="branded-card">
              <h3><span style={{fontSize: '1.2rem', marginRight: '0.5rem'}}>✓</span> Verified Opportunities</h3>
              <p>All scholarships are verified and from trusted institutions and leaders.</p>
            </div>
            <div className="branded-card">
              <h3><span style={{fontSize: '1.2rem', marginRight: '0.5rem'}}>✓</span> Real-time tracking</h3>
              <p>Monitor your applications and deadlines in one place. Never miss a scholarship opportunity again.</p>
            </div>
          </div>
        </div>

        <div className="stats-section">
          <div className="stats-container">
            <div className="stat-item"><h4>5,860+</h4><p>scholarships awarded</p></div>
            <div className="stat-item"><h4>150+</h4><p>partner facilities</p></div>
            <div className="stat-item"><h4>91%</h4><p>program success</p></div>
            <div className="stat-item"><h4>₱46K</h4><p>max annual stipend</p></div>
          </div>
        </div>

        <div id="about" className="info-section">
          <div className="about-container">
            <h2>About Us</h2>
            <div className="info-content">
              <p>iskoMats is an intelligent scholarship matching platform designed to connect deserving students with funding opportunities that align with their academic profile and financial needs. Our mission is to make quality education accessible to all by removing barriers and simplifying the scholarship search process.</p>
              <p style={{ marginTop: '1.5rem' }}>With partnerships across 150+ educational institutions and access to over 5,860 scholarships, we've helped thousands of students achieve their academic dreams. We believe every student deserves a fair chance, and our system matching ensures you see only the opportunities you truly qualify for.</p>
            </div>
          </div>
        </div>

        <div id="application" className="info-section">
          <h2>Available Scholarships</h2>
          <div className="scholarship-grid">
            <div className="scholarship-card">
              <div className="scholarship-icon">
                <img src="/mayorlogo.png" alt="Mayor Logo" style={{width: '40px', height: '40px', borderRadius: '8px', objectFit: 'cover'}} />
              </div>
              <h3>Mayor Eric B. Africa's Scholarship</h3>
              <p>A prestigious scholarship program established by Mayor Eric B. Africa to support deserving students in the local community. Focuses on academic excellence and community service.</p>
              <ul>
                <li>Full tuition coverage</li>
                <li>₱6,000 monthly stipend</li>
                <li>Book and transportation allowance</li>
                <li>Community service requirement</li>
              </ul>
              <button className="see-more-btn" onClick={() => showScholarshipModal('mayor-scholarship')}>See More</button>
            </div>
            
            <div className="scholarship-card">
              <div className="scholarship-icon">
                <img src="/govilmalogo.png" alt="Governor Vilma Logo" style={{width: '40px', height: '40px', borderRadius: '8px', objectFit: 'cover'}} />
              </div>
              <h3>Governor Vilma Santos-Recto's Scholarship</h3>
              <p>Established by Governor Vilma Santos-Recto to provide educational assistance to outstanding students from Batangas province. Emphasizes leadership and academic achievement.</p>
              <ul>
                <li>Economically disadvantaged sector or low income</li>
                <li>Must have good academic standing</li>
                <li>Must be of good moral character</li>
                <li>Will be prioritizing applicants who have not received any educational assistance from a national government agency or LGU</li>
              </ul>
              <button className="see-more-btn" onClick={() => showScholarshipModal('governor-scholarship')}>See More</button>
            </div>
            
            <div className="scholarship-card">
              <div className="scholarship-icon">
                <img src="/chedlogo.png" alt="CHED Logo" style={{width: '40px', height: '40px', borderRadius: '8px', objectFit: 'cover'}} />
              </div>
              <h3>CHED's Tulong Dunong</h3>
              <p>A national scholarship program by the Commission on Higher Education providing financial assistance to students in priority courses. Supports STEM and other critical fields.</p>
              <ul>
                <li>Grantees or student beneficiaries are entitled to receive a grant of fifteen thousand pesos (Php 15,000) per academic year.</li>
                <li>This financial assistance is designed to support tertiary education expenses, including school fees or tuition expenses.</li>
                <li>Additionally, the grant provides a living allowance to help students manage their day-to-day expenses while pursuing their education.</li>
              </ul>
              <button className="see-more-btn" onClick={() => showScholarshipModal('ched-scholarship')}>See More</button>
            </div>
          </div>
        </div>

        <div id="contact" className="info-section">
          <div className="contact-container">
            <div className="contact-header">
              <h2>Get in Touch</h2>
              <p>Have questions? We're here to help you succeed</p>
            </div>
            <div className="contact-grid">
              <div className="contact-card">
                <div className="contact-icon">
                  <span style={{fontSize: '1.5rem'}}>📧</span>
                </div>
                <div className="contact-info">
                  <h3>Email Us</h3>
                  <p>support@iskomats.com</p>
                  <p>community-affairs@yahoo.com</p>
                  <p>cado.lipa@gmail.com</p>
                  <span className="contact-subtitle">We respond within 24 hours</span>
                </div>
              </div>
              <div className="contact-card">
                <div className="contact-icon">
                  <span style={{fontSize: '1.5rem'}}>📞</span>
                </div>
                <div className="contact-info">
                  <h3>Call Us</h3>
                  <p>+63 (2) 1234-5678</p>
                  <span className="contact-subtitle">Mon-Fri, 9AM-5PM PST</span>
                </div>
              </div>
              <div className="contact-card">
                <div className="contact-icon">
                  <span style={{fontSize: '1.5rem'}}>📍</span>
                </div>
                <div className="contact-info">
                  <p>Lipa City Hall, President Jose P. Laurel Highway, Ayala Highway, Lipa City, 4217 Batangas</p>
                  <span className="contact-subtitle">Walk-ins welcome</span>
                </div>
              </div>
            </div>
            <div className="contact-footer">
              <p>🎓 Your scholarship journey starts here. Let us help you find the perfect funding opportunity for your education.</p>
              <div className="contact-actions">
                <a href="https://mail.google.com/mail/?view=cm&fs=1&to=iskomats@gmail.com" target="_blank" className="contact-btn primary">
                  <i className="fas fa-paper-plane"></i> Send Email
                </a>
                <button 
                  onClick={() => setShowPhonePopup(true)}
                  className="contact-btn secondary"
                  style={{cursor: 'pointer'}}
                >
                  <i className="fas fa-phone"></i> Call Now
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Scholarship Modal */}
      {activeModal && (
        <div className="scholarship-modal active" onClick={closeModal}>
          <div className="scholarship-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="scholarship-modal-header">
              <h3>
                <div className="scholarship-icon">
                  <i className={scholarshipData[activeModal].icon}></i>
                </div>
                <span>{scholarshipData[activeModal].name}</span>
              </h3>
              <button className="scholarship-modal-close" onClick={closeModal}>
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="scholarship-modal-body">
              <div className="scholarship-modal-section">
                <p style={{ color: 'var(--text-soft)', lineHeight: 1.7, marginBottom: '2rem' }}>
                  {scholarshipData[activeModal].description}
                </p>
              </div>
              {scholarshipData[activeModal].sections.map((section, idx) => (
                <div className="scholarship-modal-section" key={idx}>
                  <h4>{section.title}</h4>
                  <ul>
                    {section.items.map((item, itemIdx) => (
                      <li key={itemIdx}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
              <div className="scholarship-modal-section" style={{ textAlign: 'center', marginTop: '2rem', paddingTop: '2rem', borderTop: '1px solid var(--border)' }}>
                <Link to={`/studentinfo?scholarship=${encodeURIComponent(scholarshipData[activeModal].name)}`} 
                  className="apply-btn" style={{ display: 'inline-block', padding: '1rem 2.5rem', borderRadius: '40px' }}>
                  <i className="fas fa-paper-plane" style={{ marginRight: '8px' }}></i>Apply Now
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Phone Numbers Popup */}
      {showPhonePopup && (
        <div 
          className="phone-popup-overlay" 
          onClick={() => setShowPhonePopup(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
        >
          <div 
            className="phone-popup-content"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white',
              borderRadius: '16px',
              padding: '2rem',
              maxWidth: '400px',
              width: '90%',
              boxShadow: '0 10px 30px rgba(0, 0, 0, 0.3)',
              position: 'relative'
            }}
          >
            <button 
              onClick={() => setShowPhonePopup(false)}
              style={{
                position: 'absolute',
                top: '1rem',
                right: '1rem',
                background: 'none',
                border: 'none',
                fontSize: '1.5rem',
                cursor: 'pointer',
                color: 'var(--text-soft)',
                padding: '0.5rem'
              }}
            >
              <i className="fas fa-times"></i>
            </button>
            
            <h3 style={{margin: '0 0 1.5rem 0', color: 'var(--primary)', fontSize: '1.3rem'}}>
              <i className="fas fa-phone" style={{marginRight: '0.5rem'}}></i>
              Scholarship Contact Numbers
            </h3>
            
            <div style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
              <div style={{padding: '1rem', background: 'var(--gray-1)', borderRadius: '8px'}}>
                <div style={{fontWeight: '600', color: 'var(--text-dark)', marginBottom: '0.5rem'}}>
                  Mayor Eric B. Africa Scholarship
                </div>
                <div style={{color: 'var(--primary)', fontSize: '1.1rem'}}>
                  +63 (2) 8765-4321
                </div>
              </div>
              
              <div style={{padding: '1rem', background: 'var(--gray-1)', borderRadius: '8px'}}>
                <div style={{fontWeight: '600', color: 'var(--text-dark)', marginBottom: '0.5rem'}}>
                  Governor Vilma's Scholarship
                </div>
                <div style={{color: 'var(--primary)', fontSize: '1.1rem'}}>
                  +63 (2) 9876-5432
                </div>
              </div>
              
              <div style={{padding: '1rem', background: 'var(--gray-1)', borderRadius: '8px'}}>
                <div style={{fontWeight: '600', color: 'var(--text-dark)', marginBottom: '0.5rem'}}>
                  CHED Tulong Dunong
                </div>
                <div style={{color: 'var(--primary)', fontSize: '1.1rem'}}>
                  +63 (2) 5432-1098
                </div>
              </div>
            </div>
            
            <div style={{marginTop: '1.5rem', textAlign: 'center', fontSize: '0.9rem', color: 'var(--text-soft)'}}>
              <i className="fas fa-clock" style={{marginRight: '0.5rem'}}></i>
              Office Hours: Mon-Fri, 9AM-5PM PST
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default HomePage;