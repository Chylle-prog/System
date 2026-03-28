import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { applicationAPI, scholarshipAPI, announcementAPI } from '../services/api';
import socketService from '../services/socket';

const Portal = () => {
  const navigate = useNavigate();
  const { logout: authLogout } = useAuth();
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [activeSection, setActiveSection] = useState('menu');
  const [showMessageDropdown, setShowMessageDropdown] = useState(false);
  const [showNotificationDropdown, setShowNotificationDropdown] = useState(false);
  const [currentChatId, setCurrentChatId] = useState(null);
  const [chatInput, setChatInput] = useState('');
  const [applications, setApplications] = useState([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  // ADDED THE MISSING STATE HERE
  const [showChatModal, setShowChatModal] = useState(false);
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState({ title: '', message: '' });
  
  const messageDropdownRef = useRef(null);
  const notificationDropdownRef = useRef(null);

  // Scholarship chat data
  const [scholarships, setScholarships] = useState([]);

  // Chat messages for each scholarship
  const [chatMessages, setChatMessages] = useState({});

  // Scholarship Resources (Guides)
  const [resources, setResources] = useState([]);

  // Notification data structure
  const [dbAnnouncements, setDbAnnouncements] = useState([]);
  const [notifications, setNotifications] = useState([
    {
      id: 1,
      title: 'Deadline Extended',
      message: 'Mayor Eric B. Africa Scholarship: Hard copy submission extended to Mar 27.',
      time: '2 hours ago',
      read: false,
      icon: 'fa-calendar-alt',
      scholarship: 'Mayor Eric B. Africa Scholarship'
    },
    {
      id: 2,
      title: 'Interview Schedule',
      message: 'Governor Vilma\'s Scholarship: Initial interviews start Mar 10. Check your email.',
      time: 'Yesterday',
      read: false,
      icon: 'fa-users',
      scholarship: 'Governor Vilma\'s Scholarship'
    },
    {
      id: 3,
      title: 'Document Reminder',
      message: 'CHED Tulong Dunong: Upload latest COR to avoid delays.',
      time: '3 days ago',
      read: false,
      icon: 'fa-file-alt',
      scholarship: 'CHED Tulong Dunong'
    },
  ]);

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
    const profiles = JSON.parse(localStorage.getItem('userProfiles')) || {};
    
    if (!user || !localStorage.getItem('authToken')) {
      navigate('/login');
      return;
    }

    setCurrentUser(user);
    setUserProfile(profiles[user] || null);

    // Load applications dynamically from DB
    const fetchApplications = async () => {
      try {
        setLoadingMessage({ title: 'Loading Applications', message: 'Retrieving your scholarship status and history...' });
        setShowLoadingOverlay(true);
        const apps = await applicationAPI.getUserApplications();
        setApplications(apps || []);
      } catch (err) {
        console.error("Failed to load applications:", err);
      } finally {
        setShowLoadingOverlay(false);
      }
    };
    
    if (user) {
      fetchApplications();
    }

    // Load scholarship resources
    const fetchResources = async () => {
      try {
        const data = await scholarshipAPI.getAll();
        // Filter to only show scholarships that have requirements defined
        // or prioritize the specific ones from the DB
        setResources(data || []);
      } catch (err) {
        console.error("Failed to load resources:", err);
      }
    };
    fetchResources();

    // Load dynamic announcements
    const fetchAnnouncements = async () => {
      try {
        const data = await announcementAPI.getAll();
        setDbAnnouncements(data || []);
      } catch (err) {
        console.error("Failed to load announcements:", err);
      }
    };
    fetchAnnouncements();

    // Socket.IO Integration
    let unsubLogged, unsubMsg, unsubRoom;
    const token = localStorage.getItem('authToken');
    const applicantNo = localStorage.getItem('applicantNo');
    if (token) {
      socketService.connect(token);
      
      unsubLogged = socketService.subscribe('logged_in', (data) => {
        // data.rooms is now an array of {room, provider_name} objects
        if (data.rooms) {
          const rooms = data.rooms.map(roomObj => {
            const roomId = typeof roomObj === 'string' ? roomObj : roomObj.room;
            const providerName = typeof roomObj === 'string'
              ? 'Scholarship Admin'
              : (roomObj.provider_name || 'Scholarship Admin');
            return {
              id: roomId,
              name: providerName,
              icon: 'fa-building',
              unread: 0,
              lastMessage: 'Connecting...',
              time: ''
            };
          });
          setScholarships(rooms);
          // Load history for all rooms to see previous messages
          data.rooms.forEach(roomObj => {
            const roomId = typeof roomObj === 'string' ? roomObj : roomObj.room;
            socketService.loadHistory(roomId);
          });
        }
      });

      unsubMsg = socketService.subscribe('message', (msg) => {
        setChatMessages(prev => {
          const roomMsgs = prev[msg.room] || [];
          const isDuplicate = roomMsgs.some(m => m.message === msg.message && m.time === msg.timestamp);
          if (isDuplicate) return prev;
          
          return {
            ...prev,
            [msg.room]: [...roomMsgs, {
              sender: msg.username,
              message: msg.message,
              time: msg.timestamp,
              type: msg.username === applicantNo ? 'sent' : 'received'
            }]
          };
        });

        setScholarships(prev => prev.map(s => 
          s.id === msg.room ? { ...s, lastMessage: msg.message, time: 'Just now' } : s
        ));
      });

      unsubRoom = socketService.subscribe('add_room', (data) => {
        setScholarships(prev => {
          if (prev.some(s => s.id === data.room)) return prev;
          return [...prev, {
            id: data.room,
            name: data.other_name || 'Admin',
            icon: 'fa-user-tie',
            unread: 1,
            lastMessage: 'New chat started',
            time: 'Just now'
          }];
        });
      });
    }

    // Close dropdowns when clicking outside
    const handleClickOutside = (event) => {
      if (messageDropdownRef.current && !messageDropdownRef.current.contains(event.target)) {
        setShowMessageDropdown(false);
      }
      if (notificationDropdownRef.current && !notificationDropdownRef.current.contains(event.target)) {
        setShowNotificationDropdown(false);
      }
    };

    document.addEventListener('click', handleClickOutside);

    return () => {
      // Cleanup socket connections
      if (unsubLogged) unsubLogged();
      if (unsubMsg) unsubMsg();
      if (unsubRoom) unsubRoom();
      if (token) {
        socketService.disconnect();
      }

      // Cleanup DOM
      if (document.head.contains(fontAwesomeLink)) document.head.removeChild(fontAwesomeLink);
      if (document.head.contains(googleFontsLink)) document.head.removeChild(googleFontsLink);
      if (document.head.contains(googleFontsDisplay)) document.head.removeChild(googleFontsDisplay);
      if (document.head.contains(googleFontsSheet)) document.head.removeChild(googleFontsSheet);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [navigate]);

  const logout = () => {
    authLogout();  // This clears currentUser, authToken, and applicantNo
    navigate('/');
  };

  const openChat = (scholarId, scholarName) => {
    setCurrentChatId(scholarId);
    setShowChatModal(true);
    socketService.loadHistory(scholarId);
    
    // Mark scholarship as read when opening chat
    setScholarships(prev => prev.map(s => 
      s.id === scholarId ? { ...s, unread: 0 } : s
    ));
  };

  const closeChat = () => {
    setShowChatModal(false);
    setCurrentChatId(null);
    setChatInput('');
  };

  const sendMessage = () => {
    const message = chatInput.trim();
    if (!message || !currentChatId) return;
    const applicantNo = localStorage.getItem('applicantNo');
    socketService.sendMessage(currentChatId, applicantNo, message);
    setChatInput('');
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  };

  const markAllMessagesRead = () => {
    setScholarships(prev => prev.map(s => ({ ...s, unread: 0 })));
  };

  // Calendar navigation functions
  const navigateMonth = (direction) => {
    setCurrentDate(prev => {
      const newDate = new Date(prev);
      if (direction === 'prev') {
        newDate.setMonth(prev.getMonth() - 1);
      } else {
        newDate.setMonth(prev.getMonth() + 1);
      }
      return newDate;
    });
  };

  const navigateYear = (direction) => {
    setCurrentDate(prev => {
      const newDate = new Date(prev);
      if (direction === 'prev') {
        newDate.setFullYear(prev.getFullYear() - 1);
      } else {
        newDate.setFullYear(prev.getFullYear() + 1);
      }
      return newDate;
    });
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  // Calendar generation functions
  const getMonthName = (date) => {
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  const getDaysInMonth = (date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const generateCalendarDays = () => {
    const daysInMonth = getDaysInMonth(currentDate);
    const firstDay = getFirstDayOfMonth(currentDate);
    const days = [];
    
    // Add empty cells for days before month starts
    for (let i = 0; i < firstDay; i++) {
      days.push(null);
    }
    
    // Add days of the month
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(i);
    }
    
    // Add empty cells to complete the grid (6 weeks = 42 cells)
    while (days.length < 42) {
      days.push(null);
    }
    
    return days;
  };

  // Sample events data
  const getEventsForDate = (day) => {
    const events = {
      11: { type: 'warning', title: 'Gov Vilma Mock Interview' },
      18: { type: 'success', title: 'CHED Seminars' },
      20: { type: 'primary', title: 'Deadline: Mayor Eric B. Africa Scholarship' }
    };
    return events[day] || null;
  };

  const markAllNotificationsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const markNotificationAsRead = (notifId) => {
    setNotifications(prev => prev.map(n => 
      n.id === notifId ? { ...n, read: true } : n
    ));
  };

  const cancelApplication = async (reqNo, scholarshipName) => {
    if (confirm(`Are you sure you want to cancel your application for "${scholarshipName}"?`)) {
      setLoadingMessage({
        title: 'Cancelling Application',
        message: 'Please wait while we process your request.'
      });
      setShowLoadingOverlay(true);
      
      try {
        await applicationAPI.cancel(reqNo);
        // Refresh the list after cancellation
        const apps = await applicationAPI.getUserApplications();
        setApplications(apps || []);
        alert(`Your application for "${scholarshipName}" has been cancelled.`);
      } catch (err) {
        console.error("Failed to cancel application:", err);
        alert(`Error: ${err.message || 'Could not cancel application'}`);
      } finally {
        setShowLoadingOverlay(false);
      }
    }
  };

  const totalUnreadMessages = scholarships.reduce((sum, s) => sum + s.unread, 0);
  const totalUnreadNotifications = notifications.filter(n => !n.read).length;

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
          gap: 1.5rem;
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
        }

        .profile-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          border-color: rgba(255, 255, 255, 0.6);
          color: white;
        }

        .message-wrapper,
        .notification-wrapper {
          position: relative;
          display: inline-block;
        }

        .message-btn,
        .notification-btn {
          background: transparent;
          border: none;
          color: white;
          font-size: 1.3rem;
          cursor: pointer;
          position: relative;
          padding: 0.5rem 0.8rem;
          display: flex;
          align-items: center;
          transition: all 0.2s;
          border-radius: 50%;
        }

        .message-btn:hover,
        .notification-btn:hover {
          background: rgba(255, 255, 255, 0.1);
        }

        .message-badge,
        .notification-badge {
          position: absolute;
          top: 0;
          right: 2px;
          background: #ff6b6b;
          color: white;
          font-size: 0.7rem;
          font-weight: 700;
          min-width: 18px;
          height: 18px;
          border-radius: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0 4px;
          border: 2px solid var(--primary);
        }

        .message-dropdown,
        .notification-dropdown {
          position: absolute;
          top: 45px;
          right: -10px;
          width: 340px;
          background: white;
          border-radius: 20px;
          box-shadow: var(--shadow-lg);
          border: var(--border-light);
          display: none;
          z-index: 1000;
          overflow: hidden;
        }

        .message-dropdown.show,
        .notification-dropdown.show {
          display: block;
        }

        .message-header,
        .notification-header {
          padding: 1rem 1.5rem;
          border-bottom: 1px solid var(--gray-2);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .message-actions {
          display: flex;
          gap: 0.5rem;
          align-items: center;
        }

        .message-header span,
        .notification-header span {
          font-size: 1rem;
        }

        .message-actions {
          display: flex;
          gap: 0.5rem;
          align-items: center;
        }

        .new-message-btn {
          background: var(--primary);
          color: white;
          border: none;
          padding: 0.3rem 0.6rem;
          border-radius: 20px;
          cursor: pointer;
          font-size: 0.8rem;
          display: flex;
          align-items: center;
          gap: 0.3rem;
          transition: all 0.2s ease;
        }

        .new-message-btn:hover {
          background: var(--primary-dark);
          transform: translateY(-1px);
          box-shadow: 0 4px 8px rgba(79, 13, 0, 0.2);
        }

        .mark-read {
          font-size: 0.8rem;
          color: #e74c3c;
          cursor: pointer;
          font-weight: 500;
        }

        .mark-read:hover {
          color: var(--primary);
        }

        .message-list,
        .notification-list {
          max-height: 380px;
          overflow-y: auto;
        }

        .message-item,
        .notification-item {
          padding: 1rem 1.5rem;
          border-bottom: 1px solid var(--gray-1);
          transition: background 0.2s;
          cursor: pointer;
          display: flex;
          gap: 1rem;
          align-items: start;
        }

        .message-item:hover,
        .notification-item:hover {
          background: var(--accent-soft);
        }

        .message-item.unread,
        .notification-item.unread {
          background: #fff9f7;
          border-left: 3px solid var(--primary);
        }

        .message-icon,
        .notification-icon {
          color: var(--primary);
          font-size: 1.1rem;
          min-width: 24px;
          text-align: center;
          margin-top: 2px;
        }

        .message-content,
        .notification-content {
          flex: 1;
        }

        .message-title,
        .notification-title {
          font-weight: 600;
          font-size: 0.9rem;
          color: var(--text-dark);
          margin-bottom: 0.2rem;
        }

        .message-sender {
          font-size: 0.8rem;
          color: var(--primary);
          font-weight: 500;
          margin-bottom: 0.2rem;
        }

        .message-preview,
        .notification-message {
          font-size: 0.85rem;
          color: var(--text-soft);
          margin-bottom: 0.3rem;
          line-height: 1.4;
        }

        .message-time,
        .notification-time {
          font-size: 0.7rem;
          color: var(--gray-3);
          font-weight: 500;
        }

        .chat-modal {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.5);
          z-index: 2000;
          align-items: center;
          justify-content: center;
        }

        .chat-modal.show {
          display: flex;
        }

        .chat-container {
          width: 90%;
          max-width: 500px;
          height: 600px;
          background: white;
          border-radius: 24px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          box-shadow: var(--shadow-lg);
        }

        .chat-header {
          background: var(--primary);
          color: white;
          padding: 1.2rem 1.5rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .chat-header h3 {
          font-size: 1.1rem;
          font-weight: 600;
        }

        .chat-header button {
          background: none;
          border: none;
          color: white;
          font-size: 1.2rem;
          cursor: pointer;
          padding: 0.3rem;
          border-radius: 50%;
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .chat-header button:hover {
          background: rgba(255, 255, 255, 0.2);
        }

        .chat-messages {
          flex: 1;
          padding: 1.5rem;
          overflow-y: auto;
          background: #f9fafc;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .message-bubble {
          max-width: 80%;
          padding: 0.8rem 1rem;
          border-radius: 18px;
          position: relative;
          word-wrap: break-word;
        }

        .message-bubble.received {
          background: white;
          align-self: flex-start;
          border-bottom-left-radius: 4px;
          box-shadow: var(--shadow-sm);
        }

        .message-bubble.sent {
          background: var(--primary);
          color: white;
          align-self: flex-end;
          border-bottom-right-radius: 4px;
        }

        .message-bubble .sender {
          font-size: 0.7rem;
          font-weight: 600;
          margin-bottom: 0.2rem;
          color: var(--primary);
        }

        .message-bubble.sent .sender {
          color: rgba(255, 255, 255, 0.8);
        }

        .message-bubble .time {
          font-size: 0.6rem;
          margin-top: 0.2rem;
          opacity: 0.7;
          text-align: right;
        }

        .chat-input-area {
          padding: 1rem 1.5rem;
          background: white;
          border-top: 1px solid var(--gray-2);
          display: flex;
          gap: 0.8rem;
        }

        .chat-input-area input {
          flex: 1;
          padding: 0.8rem 1rem;
          border: 1px solid var(--gray-2);
          border-radius: 40px;
          font-family: 'Inter', sans-serif;
          font-size: 0.9rem;
          outline: none;
          transition: border 0.2s;
        }

        .chat-input-area input:focus {
          border-color: var(--primary);
        }

        .chat-input-area button {
          background: var(--primary);
          color: white;
          border: none;
          width: 45px;
          height: 45px;
          border-radius: 50%;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .chat-input-area button:hover {
          background: var(--primary-light);
          transform: scale(1.05);
        }

        .portal-header {
          background: 
            radial-gradient(ellipse at 80% 30%, rgba(255,249,245,0.7) 0%, rgba(241,245,251,0.7) 100%),
            linear-gradient(rgba(255,255,255,0.6), rgba(255,255,255,0.6)),
            url('/cityhall.jpg') center/cover no-repeat;
          color: var(--primary);
          padding: 5rem 5%;
          text-align: center;
          border-radius: 32px;
          margin: 2.5rem 5%;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.08);
          position: relative;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.5);
        }

        .portal-header h2 {
          font-size: 2.8rem;
          font-weight: 800;
          letter-spacing: -0.02em;
          margin-bottom: 0.8rem;
          color: var(--primary);
          position: relative;
          z-index: 2;
          text-shadow: 0 2px 10px rgba(255, 255, 255, 0.5);
        }

        .portal-header p {
          color: #1a2332;
          font-weight: 500;
          font-size: 1.1rem;
          letter-spacing: 0.2px;
          position: relative;
          z-index: 2;
          opacity: 0.9;
        }

        .portal-content {
          max-width: 1300px;
          margin: 2rem auto;
          padding: 0 4%;
        }

        .portal-menu {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 2.5rem;
          margin-bottom: 3rem;
        }

        .menu-card {
          background: #f8fafb;
          padding: 2.5rem 2rem;
          border-radius: 24px;
          box-shadow: var(--shadow-sm);
          border: var(--border-light);
          transition: all 0.3s;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .menu-card:hover {
          box-shadow: var(--shadow-md);
          border-color: #ffe8e3;
          transform: translateY(-4px);
        }

        .menu-card h3 {
          font-size: 1.3rem;
          font-weight: 700;
          color: #4F0D00;
          margin-bottom: 0.8rem;
          font-size: 1.2rem;
          letter-spacing: -0.01em;
        }

        .menu-card p {
          color: #5a6b7d;
          margin-bottom: 2rem;
          font-size: 0.9rem;
          line-height: 1.6;
        }

        .menu-btn {
          background: #4F0D00;
          color: white;
          border: none;
          border-radius: 40px;
          padding: 0.8rem 2rem;
          font-weight: 600;
          font-size: 0.9rem;
          cursor: pointer;
          transition: all 0.2s;
          box-shadow: 0 4px 12px rgba(79, 13, 0, 0.15);
          text-decoration: none;
          display: inline-block;
        }

        .menu-btn:hover {
          background: #3d0a00;
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(79, 13, 0, 0.25);
        }

        .application-list {
          background: var(--white);
          border-radius: 30px;
          padding: 1rem 0;
          box-shadow: var(--shadow-sm);
          border: var(--border-light);
        }

        .application-item {
          padding: 1.5rem 2rem;
          border-bottom: 1px solid var(--gray-2);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .application-item:last-child {
          border-bottom: none;
        }

        .status-badge {
          padding: 0.4rem 1.2rem;
          border-radius: 40px;
          font-weight: 600;
          font-size: 0.8rem;
        }

        .status-pending {
          background: var(--warning-bg);
          color: var(--warning);
        }

        .status-approved {
          background: var(--success-bg);
          color: var(--success);
        }

        .status-rejected {
          background: var(--danger-bg);
          color: var(--danger);
        }

        .cancel-btn {
          background: none;
          border: 1px solid var(--danger);
          color: var(--danger);
          padding: 0.4rem 0.8rem;
          border-radius: 6px;
          font-size: 0.8rem;
          cursor: pointer;
          margin-left: 0.5rem;
          transition: all 0.2s;
        }

        .cancel-btn:hover {
          background: var(--danger);
          color: white;
        }

        .content-section {
          display: none;
        }

        .content-section.active {
          display: block;
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
        }

        .back-button:hover {
          background: #f1f5f9;
          border-color: var(--gray-3);
        }

        .community-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 2rem;
        }

        .community-post {
          background: var(--white);
          padding: 2rem;
          border-radius: 28px;
          box-shadow: var(--shadow-sm);
          border: var(--border-light);
        }

        .community-post h4 {
          color: var(--primary);
          font-weight: 700;
          margin-bottom: 0.25rem;
        }

        .community-post .author {
          color: var(--gray-3);
          font-size: 0.8rem;
          margin-bottom: 1rem;
          font-weight: 500;
        }

        .community-post p {
          color: var(--text-soft);
        }

        .scholarship-list {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 2rem;
          margin-top: 1.5rem;
        }

        .scholarship-card {
          background: var(--white);
          padding: 2.5rem 2rem;
          border-radius: 20px;
          box-shadow: var(--shadow-sm);
          border: var(--border-light);
          transition: all 0.3s;
          display: flex;
          flex-direction: column;
        }

        .scholarship-card:hover {
          box-shadow: var(--shadow-md);
          border-color: #ffe8e3;
          transform: translateY(-2px);
        }

        .scholarship-card h4 {
          font-size: 1.15rem;
          font-weight: 700;
          color: var(--primary);
          margin-bottom: 0.8rem;
          letter-spacing: -0.01em;
        }

        .scholarship-card p {
          color: var(--text-soft);
          margin-bottom: 1.5rem;
          font-size: 0.9rem;
          line-height: 1.6;
          flex-grow: 1;
        }

        .scholarship-card a {
          display: inline-block;
          color: var(--primary);
          font-weight: 600;
          text-decoration: none;
          transition: all 0.2s;
          align-self: flex-start;
        }

        .scholarship-card a:hover {
          transform: translateX(4px);
        }

        .requirements-list {
          margin-top: 1rem;
        }

        .requirements-list h5 {
          font-size: 1rem;
          font-weight: 600;
          color: var(--primary);
          margin-bottom: 0.8rem;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .requirements-list ul {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .requirements-list li {
          padding: 0.4rem 0;
          padding-left: 1.5rem;
          position: relative;
          color: var(--text-soft);
          font-size: 0.9rem;
          line-height: 1.4;
        }

        .requirements-list li::before {
          content: '✓';
          position: absolute;
          left: 0;
          top: 0.4rem;
          color: var(--primary);
          font-weight: bold;
          font-size: 0.8rem;
        }

        @media (max-width: 1024px) {
          .content-wrapper {
            grid-template-columns: 1fr;
          }
          
          .sidebar {
            position: fixed;
            left: -280px;
            top: 0;
            height: 100vh;
            width: 280px;
            z-index: 1000;
            transition: left 0.3s ease;
            box-shadow: 2px 0 10px rgba(0,0,0,0.1);
          }
          
          .sidebar.active {
            left: 0;
          }
          
          .main-content {
            margin-left: 0;
            padding: 2rem 5%;
          }
          
          .mobile-menu-toggle {
            display: block;
          }
        }

        @media (max-width: 768px) {
          .navbar {
            padding: 1rem 5%;
            flex-direction: column;
            gap: 0.8rem;
          }
          
          .navbar-menu {
            flex-wrap: wrap;
            justify-content: center;
            gap: 1rem;
          }
          
          .main-content {
            padding: 1.5rem 4%;
          }
          
          .welcome-header h2 {
            font-size: 1.8rem;
          }
          
          .welcome-header p {
            font-size: 1rem;
          }
          
          .tab-buttons {
            flex-direction: column;
            gap: 0.5rem;
          }
          
          .tab-btn {
            padding: 0.8rem;
            font-size: 0.9rem;
          }
          
          .application-card {
            padding: 1.5rem;
          }
          
          .application-card h4 {
            font-size: 1.1rem;
          }
          
          .application-card p {
            font-size: 0.9rem;
          }
          
          .announcement-card {
            padding: 1.5rem;
          }
          
          .announcement-card h4 {
            font-size: 1rem;
          }
          
          .announcement-card p {
            font-size: 0.85rem;
          }
          
          .resource-card {
            padding: 1.5rem;
          }
          
          .resource-card h4 {
            font-size: 1rem;
          }
          
          .resource-card p {
            font-size: 0.85rem;
          }
          
          .message-dropdown,
          .notification-dropdown {
            width: 300px;
            right: -20px;
          }
          
          .chat-modal {
            width: 95%;
            height: 90vh;
            right: 2.5%;
          }
        }

        @media (max-width: 480px) {
          .navbar {
            padding: 0.8rem 3%;
          }
          
          .navbar-menu span {
            font-size: 0.85rem;
          }
          
          .main-content {
            padding: 1rem 3%;
          }
          
          .welcome-header h2 {
            font-size: 1.5rem;
          }
          
          .welcome-header p {
            font-size: 0.9rem;
          }
          
          .tab-btn {
            padding: 0.6rem;
            font-size: 0.85rem;
          }
          
          .application-card {
            padding: 1rem;
          }
          
          .application-card h4 {
            font-size: 1rem;
          }
          
          .application-card .status-badge {
            font-size: 0.7rem;
            padding: 0.2rem 0.5rem;
          }
          
          .announcement-card {
            padding: 1rem;
          }
          
          .resource-card {
            padding: 1rem;
          }
          
          .message-dropdown,
          .notification-dropdown {
            width: 280px;
            right: -10px;
          }
          
          .chat-modal {
            width: 98%;
            height: 95vh;
            right: 1%;
          }
          
          .chat-header h3 {
            font-size: 1rem;
          }
          
          .chat-messages {
            padding: 1rem;
          }
          
          .chat-input-area {
            padding: 1rem;
          }
          
          .chat-input-area input {
            padding: 0.6rem;
            font-size: 0.85rem;
          }
          
          .chat-input-area button {
            padding: 0.6rem 1rem;
            font-size: 0.85rem;
          }
        }

        /* Loading Overlay Styles */
        .loading-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(8px);
          display: none;
          justify-content: center;
          align-items: center;
          z-index: 10000;
          transition: all 0.3s ease;
        }

        .loading-overlay.active {
          display: flex;
        }

        .loading-modal {
          background: white;
          padding: 2.5rem;
          border-radius: 30px;
          text-align: center;
          max-width: 450px;
          width: 90%;
          box-shadow: 0 20px 50px rgba(0,0,0,0.3);
          border: 1px solid rgba(255,255,255,0.2);
        }

        .loading-spinner {
          width: 60px;
          height: 60px;
          border: 6px solid #f3f3f3;
          border-top: 6px solid var(--primary);
          border-radius: 50%;
          margin: 0 auto 1.5rem;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>

      <nav className="navbar">
        <Link to="/" className="navbar-brand">iskoMats</Link>
        <div className="navbar-menu">
          <span>{currentUser}</span>

          {/* MESSAGE ICON WITH DROPDOWN */}
          <div className="message-wrapper" ref={messageDropdownRef}>
            <button className="message-btn" onClick={() => setShowMessageDropdown(!showMessageDropdown)}>
              <i className="fas fa-envelope"></i>
              {totalUnreadMessages > 0 && (
                <span className="message-badge">
                  {totalUnreadMessages > 9 ? '9+' : totalUnreadMessages}
                </span>
              )}
            </button>
            <div className={`message-dropdown ${showMessageDropdown ? 'show' : ''}`}>
              <div className="message-header">
                <span>Scholarship Chats</span>
                <div className="message-actions">
                  <span className="mark-read" onClick={markAllMessagesRead}>Mark all as read</span>
                  <button 
                    className="new-message-btn"
                    onClick={() => {
                      // Create new message modal or functionality
                      alert('New message feature: Select recipient and compose your message');
                    }}
                    title="Create new message"
                  >
                    <i className="fas fa-plus"></i>
                  </button>
                </div>
              </div>
              <div className="message-list">
                {scholarships.map(scholar => (
                  <div 
                    key={scholar.id}
                    className={`message-item ${scholar.unread > 0 ? 'unread' : ''}`}
                    onClick={() => openChat(scholar.id, scholar.name)}
                  >
                    <div className="message-icon">
                      <i className={`fas ${scholar.icon}`}></i>
                    </div>
                    <div className="message-content">
                      <div className="message-sender">{scholar.name}</div>
                      <div className="message-preview">{scholar.lastMessage}</div>
                      <div className="message-time">{scholar.time}</div>
                    </div>
                    {scholar.unread > 0 && (
                      <span style={{
                        background: 'var(--primary)', 
                        color: 'white', 
                        borderRadius: '12px', 
                        padding: '0.2rem 0.6rem', 
                        fontSize: '0.7rem', 
                        fontWeight: '600', 
                        marginLeft: 'auto'
                      }}>
                        {scholar.unread}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* NOTIFICATION BELL WITH DROPDOWN */}
          <div className="notification-wrapper" ref={notificationDropdownRef}>
            <button className="notification-btn" onClick={() => setShowNotificationDropdown(!showNotificationDropdown)}>
              <i className="fas fa-bell"></i>
              {totalUnreadNotifications > 0 && (
                <span className="notification-badge">
                  {totalUnreadNotifications > 9 ? '9+' : totalUnreadNotifications}
                </span>
              )}
            </button>
            <div className={`notification-dropdown ${showNotificationDropdown ? 'show' : ''}`}>
              <div className="notification-header">
                <span>Notifications</span>
                <span className="mark-read" onClick={markAllNotificationsRead}>Mark all as read</span>
              </div>
              <div className="notification-list">
                {notifications.map(notif => (
                  <div 
                    key={notif.id}
                    className={`notification-item ${notif.read ? '' : 'unread'}`}
                    onClick={() => markNotificationAsRead(notif.id)}
                  >
                    <div className="notification-icon">
                      <i className={`fas ${notif.icon}`}></i>
                    </div>
                    <div className="notification-content">
                      <div className="notification-title">{notif.title}</div>
                      <div className="notification-message">{notif.message}</div>
                      <div className="notification-time">{notif.time}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <button className="profile-btn" onClick={() => navigate('/profile')}>
            <i className="fas fa-user-circle" style={{marginRight: '6px'}}></i>Profile
          </button>
          <button className="logout-btn" onClick={logout}>
            <i className="fas fa-sign-out-alt" style={{marginRight: '6px'}}></i>Logout
          </button>
        </div>
      </nav>



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

      {/* Chat Modal */}
      <div className={`chat-modal ${showChatModal ? 'show' : ''}`}>
        <div className="chat-container">
          <div className="chat-header">
            <h3>Chat with {scholarships.find(s => s.id === currentChatId)?.name}</h3>
            <button onClick={closeChat}>
              <i className="fas fa-times"></i>
            </button>
          </div>
          <div className="chat-messages">
            {(chatMessages[currentChatId] || []).map((msg, index) => (
              <div key={index} className={`message-bubble ${msg.type}`}>
                {msg.type === 'received' && (
                  <div className="sender">{msg.sender}</div>
                )}
                <div>{msg.message}</div>
                <div className="time">{msg.time}</div>
              </div>
            ))}
          </div>
          <div className="chat-input-area">
            <input 
              type="text" 
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type your message..." 
            />
            <button onClick={sendMessage}>
              <i className="fas fa-paper-plane"></i>
            </button>
          </div>
        </div>
      </div>

      {/* Portal */}
      <section>
        <div className="portal-header">
          <h2>Welcome back, {userProfile?.fullName?.split(' ')[0] || 'Student'}</h2>
          <p>Your personalized scholarship dashboard</p>
        </div>
        <div className="portal-content">
          {activeSection === 'menu' && (
            <div className="portal-menu">
              <div className="menu-card">
                <h3>Find Scholarships</h3>
                <p>Discover personalized scholarship opportunities that match your profile and qualifications.</p>
                <Link to="/findscholarship" className="menu-btn">Get Started</Link>
              </div>
              <div className="menu-card">
                <h3>My Applications</h3>
                <p>Track and manage your scholarship applications in one convenient location.</p>
                <button className="menu-btn" onClick={() => setActiveSection('applications')}>View Applications</button>
              </div>
              <div className="menu-card">
                <h3>Community</h3>
                <p>Connect with other students, mentors, and scholarship providers.</p>
                <button className="menu-btn" onClick={() => setActiveSection('community')}>Join Community</button>
              </div>
              <div className="menu-card">
                <h3>Resources</h3>
                <p>Access guides, templates, and tools to strengthen your applications.</p>
                <button className="menu-btn" onClick={() => setActiveSection('resources')}>Browse Resources</button>
              </div>
            </div>
          )}

          {/* applications */}
          {activeSection === 'applications' && (
            <div className="content-section active">
              <button className="back-button" onClick={() => setActiveSection('menu')}>
                <i className="fas fa-arrow-left"></i> Back
              </button>
              <h3 style={{color: 'var(--primary)', fontSize: '1.8rem'}}>Ongoing Applications</h3>
              <div className="application-list">
                {applications.length === 0 ? (
                  <div style={{textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-soft)'}}>
                    <i className="fas fa-folder-open" style={{fontSize: '3rem', color: 'var(--gray-3)', marginBottom: '1rem', display: 'block'}}></i>
                    <p style={{marginBottom: '1rem'}}>You haven't submitted any scholarship applications yet.</p>
                    <Link to="/findscholarship" className="menu-btn" style={{textDecoration: 'none', color: 'white', display: 'inline-block'}}>
                      Find Scholarships
                    </Link>
                  </div>
                ) : (
                  [...applications].reverse().map((app, index) => {
                    const badgeClass = app.status === 'Approved' ? 'status-approved' :
                                     app.status === 'Rejected' ? 'status-rejected' : 'status-pending';
                    
                    return (
                      <div key={app.scholarship_no} className="application-item">
                        <div className="application-info">
                          <h4>{app.name}</h4>
                          <p style={{color: '#a0b0c0'}}>
                             Deadline: {app.deadline ? new Date(app.deadline).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A'}
                          </p>
                        </div>
                        <div className="application-actions">
                          <span className={`status-badge ${badgeClass}`}>{app.status}</span>
                          {app.status === 'Pending' && (
                            <button className="cancel-btn" onClick={() => cancelApplication(app.scholarship_no, app.name)}>
                              <i className="fas fa-times-circle"></i> Cancel
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* community */}
          {activeSection === 'community' && (
            <div className="content-section active">
              <button className="back-button" onClick={() => setActiveSection('menu')}>
                <i className="fas fa-arrow-left"></i> Back
              </button>

              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem'}}>
                <h3 style={{color: 'var(--primary)', margin: 0, fontSize: '1.8rem'}}>Announcements</h3>
                <button
                  onClick={() => document.getElementById('events-calendar-section')?.scrollIntoView({behavior: 'smooth'})}
                  style={{
                    background: 'var(--primary)', 
                    color: 'white', 
                    border: 'none', 
                    padding: '0.6rem 1.2rem', 
                    borderRadius: '8px', 
                    cursor: 'pointer', 
                    fontSize: '0.9rem', 
                    fontWeight: '500', 
                    transition: 'all 0.2s', 
                    boxShadow: '0 4px 10px rgba(79,13,0,0.15)'
                  }}
                >
                  <i className="fas fa-calendar-alt" style={{marginRight: '6px'}}></i> View Calendar
                </button>
              </div>              <div style={{display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2.5rem'}}>
                {dbAnnouncements.length > 0 ? (
                  dbAnnouncements.map((ann, idx) => (
                    <div key={ann.ann_no || idx} className="community-post" style={{borderLeft: '4px solid var(--primary)', paddingLeft: '1rem', borderRadius: '12px'}}>
                      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.5rem'}}>
                        <h4 style={{margin: 0, color: 'var(--primary)', fontSize: '1.1rem'}}>{ann.provider_name}</h4>
                        <span style={{fontSize: '0.8rem', color: 'var(--text-soft)', background: 'var(--gray-2)', padding: '0.2rem 0.6rem', borderRadius: '20px'}}>
                          {ann.created_at ? new Date(ann.created_at).toLocaleDateString() : 'Recent'}
                        </span>
                      </div>
                      <p style={{marginBottom: '0.5rem', color: 'var(--text-dark)'}}>
                        {ann.ann_message}
                      </p>
                    </div>
                  ))
                ) : (
                  <div style={{textAlign: 'center', padding: '2rem', color: 'var(--text-soft)'}}>
                    <i className="fas fa-bullhorn" style={{fontSize: '2rem', marginBottom: '1rem', display: 'block'}}></i>
                    <p>No announcements at this time.</p>
                  </div>
                )}
              </div>

              <h3 id="events-calendar-section" style={{color: 'var(--primary)', marginBottom: '1.5rem', fontSize: '1.6rem', paddingTop: '1rem'}}>
                Events Calendar
              </h3>
              <div style={{background: 'white', borderRadius: '16px', padding: '1.5rem', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border-light)'}}>
                {/* Calendar Navigation */}
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem'}}>
                  <div style={{display: 'flex', gap: '0.5rem'}}>
                    <button 
                      onClick={() => navigateYear('prev')}
                      style={{background: 'none', border: 'none', fontSize: '1rem', cursor: 'pointer', color: 'var(--text-soft)', padding: '0.3rem'}}
                      title="Previous Year"
                    >
                      <i className="fas fa-angle-double-left"></i>
                    </button>
                    <button 
                      onClick={() => navigateMonth('prev')}
                      style={{background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: 'var(--text-soft)', padding: '0.3rem'}}
                      title="Previous Month"
                    >
                      <i className="fas fa-chevron-left"></i>
                    </button>
                  </div>
                  <h4 style={{margin: 0, fontSize: '1.2rem', color: '#333'}}>{getMonthName(currentDate)}</h4>
                  <div style={{display: 'flex', gap: '0.5rem'}}>
                    <button 
                      onClick={() => navigateMonth('next')}
                      style={{background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: 'var(--text-soft)', padding: '0.3rem'}}
                      title="Next Month"
                    >
                      <i className="fas fa-chevron-right"></i>
                    </button>
                    <button 
                      onClick={() => navigateYear('next')}
                      style={{background: 'none', border: 'none', fontSize: '1rem', cursor: 'pointer', color: 'var(--text-soft)', padding: '0.3rem'}}
                      title="Next Year"
                    >
                      <i className="fas fa-angle-double-right"></i>
                    </button>
                  </div>
                </div>

                {/* Today Button */}
                <div style={{textAlign: 'center', marginBottom: '1rem'}}>
                  <button 
                    onClick={goToToday}
                    style={{
                      background: 'var(--primary)', 
                      color: 'white', 
                      border: 'none', 
                      padding: '0.4rem 1rem', 
                      borderRadius: '20px', 
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      boxShadow: '0 2px 4px rgba(79,13,0,0.15)'
                    }}
                  >
                    Today
                  </button>
                </div>

                {/* Calendar Grid */}
                <div style={{display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.5rem', textAlign: 'center', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.85rem', color: 'var(--text-soft)'}}>
                  <div>Su</div><div>Mo</div><div>Tu</div><div>We</div><div>Th</div><div>Fr</div><div>Sa</div>
                </div>
                <div style={{display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.5rem', textAlign: 'center', fontSize: '0.95rem'}}>
                  {generateCalendarDays().map((day, index) => {
                    const event = day ? getEventsForDate(day) : null;
                    const isToday = day === new Date().getDate() && 
                                   currentDate.getMonth() === new Date().getMonth() && 
                                   currentDate.getFullYear() === new Date().getFullYear();
                    
                    if (!day) {
                      return <div key={index} style={{padding: '0.6rem', color: '#ccc'}}></div>;
                    }
                    
                    let dayStyle = {padding: '0.6rem', cursor: 'pointer', borderRadius: '8px', transition: 'all 0.2s'};
                    
                    if (event) {
                      if (event.type === 'warning') {
                        dayStyle.background = 'var(--warning-bg)';
                        dayStyle.color = 'var(--warning)';
                        dayStyle.fontWeight = 'bold';
                        dayStyle.boxShadow = '0 2px 4px rgba(0,0,0,0.05)';
                      } else if (event.type === 'success') {
                        dayStyle.background = 'var(--success-bg)';
                        dayStyle.color = 'var(--success)';
                        dayStyle.fontWeight = 'bold';
                        dayStyle.boxShadow = '0 2px 4px rgba(0,0,0,0.05)';
                      } else if (event.type === 'primary') {
                        dayStyle.background = 'var(--accent-soft)';
                        dayStyle.color = 'var(--primary)';
                        dayStyle.fontWeight = 'bold';
                        dayStyle.boxShadow = '0 2px 4px rgba(0,0,0,0.05)';
                      }
                    }
                    
                    if (isToday) {
                      dayStyle.border = '2px solid var(--primary)';
                      dayStyle.fontWeight = 'bold';
                    }
                    
                    return (
                      <div 
                        key={index} 
                        style={dayStyle}
                        title={event ? event.title : ''}
                        onMouseEnter={(e) => {
                          if (!event) {
                            e.target.style.background = 'var(--gray-1)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!event && !isToday) {
                            e.target.style.background = 'transparent';
                          }
                        }}
                      >
                        {day}
                      </div>
                    );
                  })}
                </div>

                {/* Events Legend */}
                <div style={{marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '0.8rem', fontSize: '0.9rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border-light)'}}>
                  <div style={{display: 'flex', alignItems: 'center', gap: '0.8rem', fontWeight: '500', color: 'var(--text-dark)'}}>
                    <span style={{width: '14px', height: '14px', borderRadius: '4px', background: 'var(--warning-bg)', border: '2px solid var(--warning)'}}></span>
                    Governor Vilma's Initial Screenings &mdash; Mar 11
                  </div>
                  <div style={{display: 'flex', alignItems: 'center', gap: '0.8rem', fontWeight: '500', color: 'var(--text-dark)'}}>
                    <span style={{width: '14px', height: '14px', borderRadius: '4px', background: 'var(--success-bg)', border: '2px solid var(--success)'}}></span>
                    CHED Tulong Dunong Orientation &mdash; Mar 18
                  </div>
                  <div style={{display: 'flex', alignItems: 'center', gap: '0.8rem', fontWeight: '500', color: 'var(--text-dark)'}}>
                    <span style={{width: '14px', height: '14px', borderRadius: '4px', background: 'var(--accent-soft)', border: '2px solid var(--primary)'}}></span>
                    Deadline: Mayor Eric B. Africa Scholarship &mdash; Mar 20
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* resources */}
          {activeSection === 'resources' && (
            <div className="content-section active">
              <button className="back-button" onClick={() => setActiveSection('menu')}>
                <i className="fas fa-arrow-left"></i> Back
              </button>
              <h3 style={{color: 'var(--primary)', fontSize: '1.8rem', fontWeight: '700', marginBottom: '2rem'}}>
                Resources & Guides
              </h3>
              <div className="scholarship-list">
                {resources.length > 0 ? (
                  resources.map(res => {
                    let requirementsList = [];
                    try {
                      // Requirements are stored as a JSON string in the DB
                      requirementsList = res.requirements ? JSON.parse(res.requirements) : [];
                    } catch (e) {
                      console.error("Failed to parse requirements for", res.scholarship_name, e);
                    }

                    return (
                      <div className="scholarship-card" key={res.req_no}>
                        <h4>
                          <i 
                            className={`fas ${res.icon || 'fa-graduation-cap'}`} 
                            style={{marginRight: '10px', color: 'var(--primary)'}}
                          ></i>
                          {res.scholarship_name}
                        </h4>
                        <div className="requirements-list">
                          <h5>Requirements:</h5>
                          {requirementsList.length > 0 ? (
                            <ul>
                              {requirementsList.map((req, idx) => (
                                <li key={idx}>{req}</li>
                              ))}
                            </ul>
                          ) : (
                            <ul>
                              {res.gpa && <li>Minimum GPA: {res.gpa}</li>}
                              {res.parent_finance && <li>Monthly family income ≤ ₱{Number(res.parent_finance).toLocaleString()}</li>}
                              {res.location && <li>Resident of {res.location}</li>}
                              <li>Please check the official provider website for more details.</li>
                            </ul>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div style={{textAlign: 'center', padding: '2rem', color: 'var(--text-soft)'}}>
                    <i className="fas fa-spinner fa-spin" style={{fontSize: '2rem', marginBottom: '1rem'}}></i>
                    <p>Loading scholarship resources...</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
      
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

export default Portal;