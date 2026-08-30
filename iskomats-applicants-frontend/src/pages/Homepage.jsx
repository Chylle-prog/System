import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Navbar from './Navbar';
import TermsModal from '../components/TermsModal';
import { useAuth } from '../contexts/AuthContext';
import './HomePage.css';

const HomePage = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [activeModal, setActiveModal] = useState(null);
  const [activeFAQ, setActiveFAQ] = useState(null);
  const [activeCategory, setActiveCategory] = useState('all');
  const [showTermsOverlay, setShowTermsOverlay] = useState(false);
  const [pendingTargetUrl, setPendingTargetUrl] = useState('/login');
  const [activeLocationIndex, setActiveLocationIndex] = useState(0);
  const [activeSocialIndex, setActiveSocialIndex] = useState(0);
  const [activeEmailIndex, setActiveEmailIndex] = useState(0);
  const [activePartnerIndex, setActivePartnerIndex] = useState(0);
  const [activeContactIndex, setActiveContactIndex] = useState(0);
  const [isPartnerPaused, setIsPartnerPaused] = useState(false);

  const partnersData = [
    {
      id: 1,
      badge: "CITY MAYOR OF LIPA",
      bigTitle: "MAYOR ERIC AFRICA",
      img: "/mayor.jpg",
      bgImg: "/cityhall.jpg",
      cardCategory: "LIPA MUNICIPAL SCHOLARSHIP",
      cardTitle: "Mayor Eric B. Africa's Scholarship",
      cardDesc: "Establishing educational funds, local youth development programs, full tuition coverage, and ₱5,000 monthly stipends for deserving Lipa City scholars.",
      link: "#application"
    },
    {
      id: 2,
      badge: "LOCAL GOVERNMENT UNIT",
      bigTitle: "LIPA CITY HALL",
      img: "/mayorlogo.png",
      bgImg: "/hall.jpg",
      cardCategory: "MUNICIPAL LGU PARTNER",
      cardTitle: "Lipa City Government Unit",
      cardDesc: "Partnering directly with iskoMats to monitor, evaluate, and distribute student aid packages to verified college scholarship applicants in Lipa City.",
      link: "#application"
    },
    {
      id: 3,
      badge: "PROVINCIAL SCHOLARSHIP",
      bigTitle: "GOV. VILMA SANTOS",
      img: "/gov.jpg",
      bgImg: "/cap.jpg",
      cardCategory: "PROVINCIAL AID PROGRAM",
      cardTitle: "Governor Vilma Santos-Recto Grant",
      cardDesc: "Empowering Batangueño youth through educational grants, leadership awards, ₱5,000 monthly stipends, and academic assistance packages.",
      link: "#application"
    },
    {
      id: 4,
      badge: "PROVINCIAL CAPITOL",
      bigTitle: "LALAWIGAN BATANGAS",
      img: "/lalawigan.png",
      bgImg: "/provincial.jpg",
      cardCategory: "PROVINCIAL GOV UNIT",
      cardTitle: "Lalawigan ng Batangas Capitol",
      cardDesc: "Partnering directly with iskoMats to monitor, evaluate, and distribute provincial college student aid packages to verified scholarship applicants.",
      link: "#application"
    }
  ];

  useEffect(() => {
    if (isPartnerPaused) return;

    const interval = setInterval(() => {
      setActivePartnerIndex((prev) => (prev + 1) % partnersData.length);
    }, 3500);

    return () => clearInterval(interval);
  }, [isPartnerPaused, partnersData.length]);

  const handleMouseEnterPartner = () => setIsPartnerPaused(true);
  const handleMouseLeavePartner = () => setIsPartnerPaused(false);
  const handleMouseDownPartner = () => setIsPartnerPaused(true);
  const handleMouseUpPartner = () => setIsPartnerPaused(false);
  const handleTouchStartPartner = () => setIsPartnerPaused(true);
  const handleTouchEndPartner = () => setIsPartnerPaused(false);

  const emailList = [
    {
      name: "iskoMats Support Desk",
      logo: "/iskologo.png",
      category: "iskoMats System",
      email: "support@iskomats.com",
      response: "Responds within 24 hours"
    },
    {
      name: "Community Affairs Office",
      logo: "/mayorlogo.png",
      category: "Lipa City Hall (Mayor)",
      email: "communityaffairs001@gmail.com",
      response: "Mon-Fri | 8:00 AM - 5:00 PM"
    },
    {
      name: "CADO Lipa Office",
      logo: "/govilmalogo.png",
      category: "Province of Batangas (Vilma)",
      email: "cadolipa0003@gmail.com",
      response: "Mon-Fri | 8:00 AM - 5:00 PM"
    }
  ];

  const socialList = [
    {
      name: "iskoMats Official Helpdesk",
      logo: "/iskologo.png",
      category: "iskoMats System",
      contact: "+63 (2) 1234-5678",
      facebookName: "iskoMats Lipa City",
      facebookUrl: "https://www.facebook.com/iskomats.lipacity"
    },
    {
      name: "Lipa City Mayor's Office",
      logo: "/mayorlogo.png",
      category: "Lipa City Hall",
      contact: "(043) 756-1234",
      facebookName: "Eric Africa Official Facebook Page",
      facebookUrl: "https://www.facebook.com/EricAfricaPage"
    },
    {
      name: "Batangas Provincial Office",
      logo: "/govilmalogo.png",
      category: "Province of Batangas",
      contact: "(043) 723-4567",
      facebookName: "Gov. Vilma Santos Scholarship Group",
      facebookUrl: "https://www.facebook.com/groups/1087078960035547/about/"
    }
  ];

  const locationList = [
    {
      name: "iskoMats Main Office",
      badge: "Main Office",
      address: "1962 J.P. Laurel National Highway, Mataas na Lupa, 4217, Batangas",
      hours: "Monday - Friday | 8:00 AM - 5:00 PM",
      mapUrl: "https://maps.app.goo.gl/xxxjGgiV6J4TMeds6",
      img: "/cityhall.jpg"
    },
    {
      name: "Bahay Pamahalaan Ng Marawoy",
      badge: "Gov Scholarship Office",
      address: "Bahay Pamahalaan Ng Marawoy, Lipa City, Batangas",
      hours: "Monday - Friday | 8:00 AM - 5:00 PM",
      mapUrl: "https://maps.app.goo.gl/nWkvD41Rbphuj7SK6",
      img: "/lalawigan.png"
    },
    {
      name: "New Lipa City Hall",
      badge: "Mayor Scholarship Office",
      address: "New Lipa City Hall, Ayala Highway, Lipa City, Batangas",
      hours: "Monday - Friday | 8:00 AM - 5:00 PM",
      mapUrl: "https://maps.app.goo.gl/6zyuSSxtBmKHnUTCA",
      img: "/mayorlogo.png"
    }
  ];

  const handleApplyClick = (e, targetUrl = '/login') => {
    if (e) e.preventDefault();
    if (currentUser) {
      setPendingTargetUrl(targetUrl.includes('studentinfo') ? targetUrl : '/portal');
    } else {
      setPendingTargetUrl(targetUrl);
    }
    setShowTermsOverlay(true);
  };

  const handleAcceptTerms = () => {
    sessionStorage.setItem('acceptedTerms', 'true');
    setShowTermsOverlay(false);
    navigate(pendingTargetUrl);
  };

  const handleRejectTerms = () => {
    setShowTermsOverlay(false);
  };

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
            "Must be a bona fide resident of the Lipa City.",
            "Must be a currently enrolled college student in a recognized college, university, or technical-vocational institution.",
            "Must be enrolled in an undergraduate program for the current semester or academic year.",
            "Must meet the minimum grade requirement set by the scholarship committee.",
            "Must submit complete and truthful documents within the application period."
          ]
        },
        {
          title: "Application Requirements:",
          items: [
            "Accomplished application form.",
            "Certificate of Enrollment for the current semester or academic year.",
            "Latest Certified True Copy of Grades, Transcript of Records, or report card.",
            "Valid government-issued ID or school ID.",
            "Proof of residency or indigency.",
            "Recent 2x2 Photo of you."
          ]
        },
        {
          title: "Benefits & Coverage:",
          items: [
            "Full or partial tuition assistance.",
            "Educational cash assistance.",
            "Allowance for books, school supplies, transportation, internet/data, or other education-related expenses.",
            "Financial support for one semester or one academic year, subject to available funds.",
            "Assistance released directly to the student, parent/guardian, school, or authorized representative, depending on program policy."
          ]
        },
        {
          title: "Maintenance Requirements:",
          items: [
            "Remain enrolled in the approved college course and school.",
            "Maintain the required grade average and avoid failing grades.",
            "Maintain good moral character and comply with school rules.",
            "Submit updated enrollment records and certified grades during renewal or validation periods.",
            "Notify the scholarship committee of changes in school, course, address, or enrollment status.",
            "Use the assistance only for legitimate educational expenses.",
            "Follow all program guidelines, deadlines, and reporting requirements."
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
            "Must be a bona fide resident of Lipa City.",
            "Must be a currently enrolled college student in a recognized college or university in Lipa City.",
            "Must be enrolled in an undergraduate program for the current semester or academic year.",
            "Must meet the minimum grade requirement set by the scholarship committee.",
            "Must submit complete and truthful documents within the application period.",
            "Must provide proof of Lipa City residency, such as a barangay indigency."
          ]
        },
        {
          title: "Application Requirements:",
          items: [
            "Accomplished application form.",
            "Certificate of Enrollment for the current semester or academic year.",
            "Latest Certified True Copy of Grades, Transcript of Records, or report card.",
            "Valid school ID.",
            "Proof of Lipa City - certificate of indigency issued by the applicant’s barangay in Lipa City.",
            "Recent 2x2 photo of you.",
            "Barangay clearance or certificate of indigency."
          ]
        },
        {
          title: "Benefits & Coverage:",
          items: [
            "Full or partial tuition assistance for qualified Lipa City college students.",
            "Educational cash assistance for books, school supplies, transportation, internet/data, and other school-related expenses.",
            "Financial support for one semester or one academic year, subject to available funds and program guidelines.",
            "Assistance may be released directly to the student, parent/guardian, depending on the program policy."
          ]
        },
        {
          title: "Maintenance Requirements:",
          items: [
            "Remain officially enrolled in the approved college course and school.",
            "Maintain the minimum grade average required by the scholarship committee.",
            "Avoid failing grades.",
            "Inform the scholarship committee of any change in school, course, address, or enrollment status.",
            "Continue to be a resident of Lipa City while receiving the scholarship or educational financial assistance.",
            "Use the financial assistance only for legitimate education-related expenses.",
            "Follow all program guidelines, schedules, deadlines, and reporting requirements established by the Governor."
          ]
        }
      ]
    }
  };

  return (
    <div className="homepage-wrapper">
      <Navbar onApplyClick={handleApplyClick} />

      <section className="homepage">
        <div className="hero">
          <h1>Tulong Isko, Tulong Bayan!</h1>
          <p>Unlock your future with iskoMats – A centralized scholarship matching made simple and smart.</p>
          <button
            type="button"
            onClick={(e) => handleApplyClick(e, '/login')}
            className="cta-button"
            style={{ border: 'none', cursor: 'pointer' }}
          >
            Apply Now →
          </button>
          <div className="features">
            <div className="feature-card">
              <h3><span style={{ fontSize: '1.2rem', marginRight: '0.5rem' }}>🎯</span> 90% match rate</h3>
              <p>Smart filters show only relevant awards.</p>
            </div>
            <div className="feature-card">
              <h3><span style={{ fontSize: '1.2rem', marginRight: '0.5rem' }}>📈</span> ₱40M+ awarded</h3>
              <p>Through our partner institutions.</p>
            </div>
            <div className="feature-card">
              <h3><span style={{ fontSize: '1.2rem', marginRight: '0.5rem' }}>🏛️</span> 200+ partners</h3>
              <p>Trusted universities & donors.</p>
            </div>
            <div className="feature-card">
              <h3><span style={{ fontSize: '1.2rem', marginRight: '0.5rem' }}>⚡</span> real‑time tracking</h3>
              <p>From application to decision.</p>
            </div>
          </div>
        </div>

        <div className="branded-section">
          <h2>Why Choose iskoMats?</h2>
          <div className="branded-grid">
            <div className="branded-card">
              <h3><span style={{ fontSize: '1.2rem', marginRight: '0.5rem' }}>✓</span> Personalized Matching</h3>
              <p>Our Rule-based matching analyzes your profile and matches you with the most relevant scholarships based on your qualifications.</p>
            </div>
            <div className="branded-card">
              <h3><span style={{ fontSize: '1.2rem', marginRight: '0.5rem' }}>✓</span> Fast & Easy</h3>
              <p>Complete your profile in minutes and start discovering scholarships tailored just for you.</p>
            </div>
            <div className="branded-card">
              <h3><span style={{ fontSize: '1.2rem', marginRight: '0.5rem' }}>✓</span> Verified Opportunities</h3>
              <p>All scholarships are verified and from trusted institutions and leaders.</p>
            </div>
            <div className="branded-card">
              <h3><span style={{ fontSize: '1.2rem', marginRight: '0.5rem' }}>✓</span> Real-time tracking</h3>
              <p>Monitor your applications and deadlines in one place. Never miss a scholarship opportunity again.</p>
            </div>
          </div>
        </div>



        {/* Connected Institutions & Leadership Showcase */}
        <div
          className="partners-showcase-section showcase-cinematic"
          onMouseEnter={handleMouseEnterPartner}
          onMouseLeave={handleMouseLeavePartner}
          onMouseDown={handleMouseDownPartner}
          onMouseUp={handleMouseUpPartner}
          onTouchStart={handleTouchStartPartner}
          onTouchEnd={handleTouchEndPartner}
        >
          {/* Dynamic Background Image with Smooth Fade */}
          <div
            key={`partner-bg-${activePartnerIndex}`}
            className="partners-dynamic-bg"
            style={{ backgroundImage: `linear-gradient(135deg, rgba(255, 255, 255, 0.82) 0%, rgba(254, 249, 245, 0.68) 50%, rgba(255, 255, 255, 0.84) 100%), url(${partnersData[activePartnerIndex].bgImg || partnersData[activePartnerIndex].img})` }}
          ></div>

          <div className="partners-showcase-container" style={{ position: 'relative', zIndex: 3 }}>
            <div className="partners-section-header">
              <h2>Connected Institutions & Key Leaders</h2>
              <p className="partners-showcase-sub">
                iskoMats works directly with local government units, provincial leadership, and higher education commissions to bring verified scholarship opportunities to deserving students.
              </p>
            </div>

            {/* Main Cinematic Showcase Grid */}
            <div className="cinematic-showcase-grid">
              {/* Left Column: Stacked Typography Title (Centered) */}
              <div className="cinematic-col-left">
                <span className="cinematic-badge-tag">{partnersData[activePartnerIndex].badge}</span>
                <h1 className="cinematic-big-title">{partnersData[activePartnerIndex].bigTitle}</h1>
              </div>

              {/* Center Column: Big Logo/Picture (No Box) + Navigation Arrows Below */}
              <div className="cinematic-col-center">
                <div className="cinematic-carousel-stack">
                  {/* Previous image peeking behind left */}
                  {(() => {
                    const prevImg = partnersData[activePartnerIndex === 0 ? partnersData.length - 1 : activePartnerIndex - 1].img;
                    const isPrevLogo = prevImg && (prevImg.includes('logo') || prevImg.includes('lalawigan') || prevImg.includes('ched'));
                    return (
                      <div className="cinematic-peek-img cinematic-peek-prev">
                        <img
                          src={prevImg}
                          alt="Previous"
                          className={isPrevLogo ? 'cinematic-img-contain' : ''}
                        />
                      </div>
                    );
                  })()}

                  {/* Main center image */}
                  {(() => {
                    const currentImg = partnersData[activePartnerIndex].img;
                    const isCurrentLogo = currentImg && (currentImg.includes('logo') || currentImg.includes('lalawigan') || currentImg.includes('ched'));
                    return (
                      <div className="cinematic-image-wrapper" key={`partner-img-${activePartnerIndex}`}>
                        <img
                          src={currentImg}
                          alt={partnersData[activePartnerIndex].bigTitle}
                          className={`cinematic-hero-img ${isCurrentLogo ? 'cinematic-img-contain' : ''}`}
                        />
                      </div>
                    );
                  })()}

                  {/* Next image peeking behind right */}
                  {(() => {
                    const nextImg = partnersData[activePartnerIndex === partnersData.length - 1 ? 0 : activePartnerIndex + 1].img;
                    const isNextLogo = nextImg && (nextImg.includes('logo') || nextImg.includes('lalawigan') || nextImg.includes('ched'));
                    return (
                      <div className="cinematic-peek-img cinematic-peek-next">
                        <img
                          src={nextImg}
                          alt="Next"
                          className={isNextLogo ? 'cinematic-img-contain' : ''}
                        />
                      </div>
                    );
                  })()}
                </div>

                {/* Circular Arrow Navigation Buttons Below Picture */}
                <div className="cinematic-nav-circles">
                  <button
                    type="button"
                    onClick={() => setActivePartnerIndex((prev) => (prev === 0 ? partnersData.length - 1 : prev - 1))}
                    className="cinematic-circle-btn"
                    title="Previous Slide"
                  >
                    <i className="fas fa-arrow-left"></i>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivePartnerIndex((prev) => (prev === partnersData.length - 1 ? 0 : prev + 1))}
                    className="cinematic-circle-btn"
                    title="Next Slide"
                  >
                    <i className="fas fa-arrow-right"></i>
                  </button>
                </div>
              </div>

              {/* Right Column: Clean Description Text (No Box) */}
              <div className="cinematic-col-right">
                <div className="cinematic-text-content">
                  <span className="cinematic-card-category">{partnersData[activePartnerIndex].cardCategory}</span>
                  <h3 className="cinematic-card-title">{partnersData[activePartnerIndex].cardTitle}</h3>
                  <p className="cinematic-card-desc">{partnersData[activePartnerIndex].cardDesc}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* How to Use iskoMats - Branded Dark Banner Layout */}
        <div id="how-it-works" className="branded-section process-branded-section">
          <h2>How to Use iskoMats</h2>
          <div className="branded-grid">
            <div className="branded-card">
              <h3>
                <span style={{ fontSize: '1.2rem', marginRight: '0.5rem' }}>👤</span>
                01. Create Account
              </h3>
              <p>Register your student profile with your academic background, GWA, course, and barangay details in Lipa City.</p>
            </div>

            <div className="branded-card">
              <h3>
                <span style={{ fontSize: '1.2rem', marginRight: '0.5rem' }}>🎯</span>
                02. Smart Matching
              </h3>
              <p>iskoMats automatically filters and matches your profile with eligible scholarship programs like Mayor Africa & Gov. Vilma grants.</p>
            </div>

            <div className="branded-card">
              <h3>
                <span style={{ fontSize: '1.2rem', marginRight: '0.5rem' }}>📄</span>
                03. Submit Requirements
              </h3>
              <p>Upload authentic requirements, Certificates of Grades, Indigency, and Student IDs online through our secure portal.</p>
            </div>

            <div className="branded-card">
              <h3>
                <span style={{ fontSize: '1.2rem', marginRight: '0.5rem' }}>🔔</span>
                04. Track Status
              </h3>
              <p>Receive real-time evaluation updates and status notifications directly on your applicant dashboard.</p>
            </div>
          </div>
        </div>

        {/* Available Scholarships Section - FIRST */}
        <div id="application" className="info-section">
          <h2>Available Scholarships</h2>
          <div className="scholarship-grid">
            <div className="scholarship-card">
              <div className="scholarship-icon">
                <img src="/mayorlogo.png" alt="Mayor Logo" style={{ width: '40px', height: '40px', borderRadius: '8px', objectFit: 'cover' }} />
              </div>
              <h3>Mayor Eric B. Africa's Scholarship</h3>
              <p>A prestigious scholarship program established by Mayor Eric B. Africa to support deserving students in the local community. Focuses on academic excellence and community service.</p>
              <ul>
                <li>Full or partial tuition assistance</li>
                <li>Educational cash assistance</li>
                <li>Books, supplies, transportation & data allowance</li>
                <li>Bona fide Lipa City resident priority</li>
              </ul>
              <button className="see-more-btn" onClick={() => showScholarshipModal('mayor-scholarship')}>See More</button>
            </div>

            <div className="scholarship-card">
              <div className="scholarship-icon">
                <img src="/govilmalogo.png" alt="Governor Vilma Logo" style={{ width: '40px', height: '40px', borderRadius: '8px', objectFit: 'cover' }} />
              </div>
              <h3>Governor Vilma Santos-Recto's Scholarship</h3>
              <p>Established by Governor Vilma Santos-Recto to provide educational assistance to outstanding students from Batangas province. Emphasizes leadership and academic achievement.</p>
              <ul>
                <li>Full or partial tuition assistance</li>
                <li>Educational cash assistance & allowances</li>
                <li>Financial support for 1 sem / academic year</li>
                <li>Lipa City resident college scholars</li>
              </ul>
              <button className="see-more-btn" onClick={() => showScholarshipModal('governor-scholarship')}>See More</button>
            </div>
          </div>
        </div>

        {/* About Us Section - Cinematic Dark Layout */}
        <div id="about" className="aboutus-cinematic-section">
          <div className="aboutus-cinematic-container">
            {/* Left Column: Text Content */}
            <div className="aboutus-cinematic-left">
              <h2 className="aboutus-big-title">About iskoMats</h2>
              <p className="aboutus-description">
                iskoMats is a smart scholarship matching and application management system designed to help college students in Lipa City find scholarship opportunities that match their academic qualifications and financial needs. Our mission is to make scholarship opportunities more accessible by simplifying the process of finding suitable programs, checking eligibility, submitting requirements, and tracking applications — all in one convenient platform.
              </p>
              <div className="aboutus-highlights">
                <div className="aboutus-highlight-item">
                  <span className="aboutus-highlight-icon">🎯</span>
                  <div>
                    <h4>Smart Rule Matching</h4>
                    <p>Direct qualification engine tailored to your GWA and needs</p>
                  </div>
                </div>
                <div className="aboutus-highlight-item">
                  <span className="aboutus-highlight-icon">🏛️</span>
                  <div>
                    <h4>Official Partners</h4>
                    <p>Verified funds from Lipa City Hall & Provincial Capitol</p>
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="aboutus-cta-btn"
                onClick={(e) => handleApplyClick(e, '/login')}
              >
                <span>Discover Opportunities</span>
                <i className="fas fa-arrow-right"></i>
              </button>
            </div>

            {/* Right Column: 2x2 Image Grid */}
            <div className="aboutus-cinematic-right">
              <div className="aboutus-image-grid">
                <div className="aboutus-grid-img">
                  <img src="/mayorisko.jpg" alt="Mayor Eric Africa's Scholars" />
                  <span className="aboutus-img-badge">Mayor's Scholars</span>
                </div>
                <div className="aboutus-grid-img">
                  <img src="/govisko.jpg" alt="Governor Vilma Santos's Scholars" />
                  <span className="aboutus-img-badge">Governor's Scholars</span>
                </div>
                <div className="aboutus-grid-img">
                  <img src="/hall.jpg" alt="Lipa City Hall" />
                  <span className="aboutus-img-badge">Lipa City Hall</span>
                </div>
                <div className="aboutus-grid-img">
                  <img src="/cap.jpg" alt="Batangas Provincial Capitol Scholars" />
                  <span className="aboutus-img-badge">Provincial Capitol</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Get in Touch Section - Tailored Branded 3-Card Design */}
        <div id="contact" className="info-section get-in-touch-section">
          <div className="contact-container">
            <div className="contact-header">
              <h2>Get in Touch</h2>
              <p>Have questions? We're here to help you succeed in your scholarship journey.</p>
            </div>

            <div className="contact-grid-custom">
              {/* Card 1: Email Channels (All 3 Emails Visible at a Glance) */}
              <div className={`touch-card ${activeContactIndex !== 0 ? 'touch-card-hidden' : ''}`}>
                <div>
                  <div className="touch-card-header">
                    <div className="touch-icon-box brand">
                      <i className="fas fa-envelope"></i>
                    </div>
                    <h3>Email Channels</h3>
                  </div>

                  <div className="touch-email-list-wrapper">
                    <div className="touch-email-row">
                      <div className="touch-email-row-top">
                        <span className="location-badge">iskomats</span>
                        <span className="touch-email-label">System Support</span>
                      </div>
                      <a href="https://mail.google.com/mail/?view=cm&fs=1&to=support@iskomats.com" target="_blank" rel="noopener noreferrer" className="touch-email-link">
                        <i className="fas fa-paper-plane touch-email-icon"></i>
                        support@iskomats.com
                      </a>
                    </div>

                    <div className="touch-email-row">
                      <div className="touch-email-row-top">
                        <span className="location-badge">Mayor</span>
                        <span className="touch-email-label">Community Affairs Office</span>
                      </div>
                      <a href="https://mail.google.com/mail/?view=cm&fs=1&to=communityaffairs001@gmail.com" target="_blank" rel="noopener noreferrer" className="touch-email-link">
                        <i className="fas fa-paper-plane touch-email-icon"></i>
                        communityaffairs001@gmail.com
                      </a>
                    </div>

                    <div className="touch-email-row">
                      <div className="touch-email-row-top">
                        <span className="location-badge">Vilma</span>
                        <span className="touch-email-label">CADO Lipa Office</span>
                      </div>
                      <a href="https://mail.google.com/mail/?view=cm&fs=1&to=cadolipa0003@gmail.com" target="_blank" rel="noopener noreferrer" className="touch-email-link">
                        <i className="fas fa-paper-plane touch-email-icon"></i>
                        cadolipa0003@gmail.com
                      </a>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 2: Helpdesk & Social Media Slider */}
              <div className={`touch-card ${activeContactIndex !== 1 ? 'touch-card-hidden' : ''}`}>
                <div>
                  <div className="touch-card-header touch-location-header">
                    <div className="touch-header-left">
                      <div className="touch-icon-box brand">
                        <i className="fab fa-facebook-messenger"></i>
                      </div>
                      <h3>Official Social & Contact No.</h3>
                    </div>
                    {/* Social Slide Navigation Controls */}
                    <div className="location-nav-controls">
                      <button
                        type="button"
                        onClick={() => setActiveSocialIndex((prev) => (prev === 0 ? socialList.length - 1 : prev - 1))}
                        className="location-nav-btn"
                        title="Previous Channel"
                      >
                        <i className="fas fa-chevron-left"></i>
                      </button>
                      <span className="location-nav-counter">
                        {activeSocialIndex + 1}/{socialList.length}
                      </span>
                      <button
                        type="button"
                        onClick={() => setActiveSocialIndex((prev) => (prev === socialList.length - 1 ? 0 : prev + 1))}
                        className="location-nav-btn"
                        title="Next Channel"
                      >
                        <i className="fas fa-chevron-right"></i>
                      </button>
                    </div>
                  </div>

                  {/* Active Social Channel Slide (Centered Logo/Badge/Title, Left Details) */}
                  <div className="touch-social-slide touch-social-centered">
                    <div className="touch-logo-centered-box">
                      <img src={socialList[activeSocialIndex].logo} alt={socialList[activeSocialIndex].name} className="touch-entity-logo-centered" />
                      <span className="location-badge location-badge-centered">{socialList[activeSocialIndex].category}</span>
                    </div>

                    <h4 className="touch-entity-title-centered">{socialList[activeSocialIndex].name}</h4>

                    <div className="touch-social-details touch-details-left">
                      <p className="touch-detail-item">
                        <i className="fas fa-phone-alt touch-detail-icon"></i>
                        <span><strong>Contact:</strong> {socialList[activeSocialIndex].contact}</span>
                      </p>
                      <p className="touch-detail-item">
                        <i className="fab fa-facebook touch-detail-icon-fb"></i>
                        <span><strong>Facebook:</strong> {socialList[activeSocialIndex].facebookName}</span>
                      </p>
                    </div>
                  </div>
                </div>

                <div className="touch-card-footer">
                  <a
                    href={socialList[activeSocialIndex].facebookUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="touch-action-btn primary-brand-outline"
                  >
                    <i className="fab fa-facebook-f touch-action-icon-fb"></i> Visit Facebook Page ↗
                  </a>
                </div>
              </div>

              {/* Card 3: Visit Us & Locations Carousel */}
              <div className={`touch-card touch-card-location ${activeContactIndex !== 2 ? 'touch-card-hidden' : ''}`}>
                <div>
                  <div className="touch-card-header touch-location-header">
                    <div className="touch-header-left">
                      <i className="fas fa-map-marker-alt touch-visit-icon"></i>
                      <h3>Visit Us</h3>
                    </div>
                    {/* Location Slide Navigation Controls */}
                    <div className="location-nav-controls">
                      <button
                        type="button"
                        onClick={() => setActiveLocationIndex((prev) => (prev === 0 ? locationList.length - 1 : prev - 1))}
                        className="location-nav-btn"
                        title="Previous Location"
                      >
                        <i className="fas fa-chevron-left"></i>
                      </button>
                      <span className="location-nav-counter">
                        {activeLocationIndex + 1}/{locationList.length}
                      </span>
                      <button
                        type="button"
                        onClick={() => setActiveLocationIndex((prev) => (prev === locationList.length - 1 ? 0 : prev + 1))}
                        className="location-nav-btn"
                        title="Next Location"
                      >
                        <i className="fas fa-chevron-right"></i>
                      </button>
                    </div>
                  </div>

                  {/* Top Map Frame (Full-Width) */}
                  <div className="touch-location-map-full">
                    <iframe
                      title={locationList[activeLocationIndex].name}
                      src={`https://www.google.com/maps?q=${encodeURIComponent(locationList[activeLocationIndex].address)}&output=embed`}
                      width="100%"
                      height="100%"
                      style={{ border: 0 }}
                      allowFullScreen=""
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                    ></iframe>
                  </div>

                  {/* Location Details Placed Below the Map */}
                  <div className="touch-location-info-below">
                    <div className="touch-location-badge-row">
                      <span className="location-badge">{locationList[activeLocationIndex].badge}</span>
                      <a
                        href={locationList[activeLocationIndex].mapUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="location-maps-link"
                      >
                        Open Maps ↗
                      </a>
                    </div>
                    <h4 className="location-name">{locationList[activeLocationIndex].name}</h4>
                    <p className="touch-address-text">
                      {locationList[activeLocationIndex].address}
                    </p>
                    <p className="touch-hours-text">
                      <i className="far fa-clock touch-hours-icon"></i>
                      Monday - Friday | 8:00 AM - 5:00 PM
                    </p>
                  </div>
                </div>
              </div>

              {/* Mobile Carousel Navigation (Below Cards) */}
              <div className="contact-carousel-nav">
                <button
                  type="button"
                  onClick={() => setActiveContactIndex((prev) => (prev === 0 ? 2 : prev - 1))}
                  className="contact-carousel-btn"
                  title="Previous"
                >
                  <i className="fas fa-chevron-left"></i>
                </button>
                <span className="contact-carousel-counter">
                  {activeContactIndex + 1}/3
                </span>
                <button
                  type="button"
                  onClick={() => setActiveContactIndex((prev) => (prev === 2 ? 0 : prev + 1))}
                  className="contact-carousel-btn"
                  title="Next"
                >
                  <i className="fas fa-chevron-right"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Site Footer */}
      <footer className="site-footer">
        <div className="footer-container">
          <div className="footer-brand">
            <img src="/iskologo.png" alt="iskoMats Logo" className="footer-logo" />
            <span className="footer-brand-name">iskoMats</span>
          </div>
          <p className="footer-copyright">
            &copy; {new Date().getFullYear()} iskoMats - Lipa City Scholarship Management System. All rights reserved.
          </p>
        </div>
      </footer>

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
                <button
                  type="button"
                  onClick={(e) => handleApplyClick(e, `/studentinfo?scholarship=${encodeURIComponent(scholarshipData[activeModal].name)}`)}
                  className="apply-btn"
                  style={{ display: 'inline-block', padding: '1rem 2.5rem', borderRadius: '40px', cursor: 'pointer', border: 'none' }}
                >
                  <i className="fas fa-paper-plane" style={{ marginRight: '8px' }}></i>Apply Now
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Terms & Conditions Overlay Modal */}
      <TermsModal
        isOpen={showTermsOverlay}
        onAccept={handleAcceptTerms}
        onReject={handleRejectTerms}
      />
    </div>
  );
};

export default HomePage;