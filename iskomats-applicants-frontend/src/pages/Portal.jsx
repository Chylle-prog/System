import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { applicantAPI, applicationAPI, scholarshipAPI, announcementAPI, notificationAPI, messagingAPI, isAltCheckBypassed, API_ORIGIN } from '../services/api';
import socketService from '../services/socket';
import iskoLogo from '../assets/iskologo.png';
import ChatbotDesign from '../components/ChatbotDesign';

const ensureAbsoluteUrl = (url) => {
  if (!url) return url;
  if (url.startsWith('http')) return url;
  if (url.startsWith('/api')) return `${API_ORIGIN}${url}`;
  return url;
};

const toChatTimestamp = (value) => {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const toChatOrderId = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const compareChatMessages = (left, right) => {
  const timestampDiff = toChatTimestamp(left?.time) - toChatTimestamp(right?.time);
  if (timestampDiff !== 0) {
    return timestampDiff;
  }

  return toChatOrderId(left?.m_id ?? left?.id) - toChatOrderId(right?.m_id ?? right?.id);
};

const sortChatMessages = (messages) => [...messages].sort(compareChatMessages);

const formatAnnouncementDate = (value, options) => {
  if (!value) return 'Recently';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Recently';
  }

  return parsed.toLocaleDateString('en-US', options || {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getAnnouncementPreview = (message) => {
  const normalized = String(message || '').replace(/\s+/g, ' ').trim();

  if (!normalized) {
    return 'No details provided.';
  }

  if (normalized.length <= 180) {
    return normalized;
  }

  return `${normalized.slice(0, 177)}...`;
};

const formatToLocalTime = (dateStr) => {
  if (!dateStr) return '';

  // If it's a string like "2026-04-23 20:11:34", browsers treat it as local time.
  // We assume the backend sends UTC, so we normalize to ISO format with 'Z'.
  let normalized = dateStr;
  if (typeof dateStr === 'string' && dateStr.includes(' ') && !dateStr.includes('T') && !dateStr.includes('Z')) {
    normalized = dateStr.replace(' ', 'T') + 'Z';
  }

  const date = new Date(normalized);
  if (isNaN(date.getTime())) return dateStr;

  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
};

const DEFAULT_MOCK_SCHOLARSHIPS = [];
const DEFAULT_MOCK_CHAT_MESSAGES = {};

const Portal = () => {
  const navigate = useNavigate();
  const { logout: authLogout, userProfile: globalProfile } = useAuth();
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [activeSection, setActiveSection] = useState('menu');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showMessageDropdown, setShowMessageDropdown] = useState(false);
  const [showNotificationDropdown, setShowNotificationDropdown] = useState(false);
  const [currentChatId, setCurrentChatId] = useState(null);
  const [currentChatProviderName, setCurrentChatProviderName] = useState(null);
  const [chatInput, setChatInput] = useState('');
  const [applications, setApplications] = useState([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  // ADDED THE MISSING STATE HERE
  const [showChatModal, setShowChatModal] = useState(false);
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState({ title: '', message: '' });
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState(null);
  const [selectedAnnouncementImage, setSelectedAnnouncementImage] = useState(null);
  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedAppForView, setSelectedAppForView] = useState(null);
  const [viewModalTab, setViewModalTab] = useState('summary');

  // Custom Modal States for Cancellation
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [pendingCancel, setPendingCancel] = useState(null); // { reqNo, scholarshipName }
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [statusInfo, setStatusInfo] = useState({ title: '', message: '', isError: false });

  const messageDropdownRef = useRef(null);
  const notificationDropdownRef = useRef(null);
  const currentChatRoomRef = useRef(null);
  const chatMessagesEndRef = useRef(null);

  // Scholarship chat data
  const [scholarships, setScholarships] = useState([]);

  // Chat messages for each scholarship
  const [chatMessages, setChatMessages] = useState({});

  // Scholarship Resources (Guides)
  const [resources, setResources] = useState([]);

  // Notification data structure
  const [dbAnnouncements, setDbAnnouncements] = useState([]);
  const [announcementSearchQuery, setAnnouncementSearchQuery] = useState('');
  const [notifications, setNotifications] = useState([]);
  const portalLocked = Boolean(userProfile?.duplicate_applicant_exists) && !isAltCheckBypassed();
  const portalLockMessage = userProfile?.portal_lock_message || 'You already exist in the system';

  const setPortalSection = (nextSection) => {
    if (portalLocked && nextSection !== 'menu') {
      setShowMessageDropdown(false);
      setShowNotificationDropdown(false);
      setShowChatModal(false);
      setActiveSection('menu');
      return;
    }

    setActiveSection(nextSection);
  };

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
        hasFetchedApps.current = true;
      } catch (err) {
        console.error("Failed to load applications:", err);
      } finally {
        setShowLoadingOverlay(false);
      }
    };

    const fetchProfile = async () => {
      try {
        const profile = await applicantAPI.getProfile();
        setUserProfile(profile);
      } catch (err) {
        console.warn("Failed to fetch user profile:", err);
      }
    };

    if (user) {
      fetchApplications();
      fetchProfile();
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

    const fetchNotifications = async () => {
      try {
        const data = await notificationAPI.getAll();
        setNotifications(data || []);
      } catch (err) {
        console.error("Failed to load notifications:", err);
      }
    };
    fetchNotifications();

    // Set up polling for notifications every 30 seconds
    const notifInterval = setInterval(fetchNotifications, 30000);
    const announcementInterval = setInterval(fetchAnnouncements, 30000);

    // Socket.IO Integration
    let unsubLogged, unsubMsg, unsubHistory, unsubRoom;
    const token = localStorage.getItem('authToken');
    const applicantNo = localStorage.getItem('applicantNo');
    if (token) {
      socketService.connect(token);

      unsubLogged = socketService.subscribe('logged_in', (data) => {
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
          data.rooms.forEach(roomObj => {
            const roomId = typeof roomObj === 'string' ? roomObj : roomObj.room;
            socketService.loadHistory(roomId);
          });
        }
      });

      unsubMsg = socketService.subscribe('message', (msg) => {
        const isActiveRoom = currentChatRoomRef.current === msg.room;
        const currentAppNo = localStorage.getItem('applicantNo');
        const firstName = (userProfile?.first_name || currentUser?.first_name || '').toLowerCase();
        const msgUsername = String(msg.username || '').toLowerCase();

        const isStudentSender = (
          msgUsername === 'you' ||
          msgUsername === String(currentAppNo || '').toLowerCase() ||
          (firstName && msgUsername === firstName) ||
          msg.is_student_sender === true
        );

        setChatMessages(prev => {
          const roomMsgs = prev[msg.room] || [];
          const isDuplicate = roomMsgs.some((m) => {
            if (msg.m_id && m.m_id) return String(m.m_id) === String(msg.m_id);
            return m.message === msg.message && (m.type === 'sent' || isStudentSender);
          });
 
          if (isDuplicate) {
            return {
              ...prev,
              [msg.room]: sortChatMessages(roomMsgs.map(m => {
                if (m.message === msg.message && (m.type === 'sent' || isStudentSender)) {
                  return { ...m, m_id: msg.m_id || m.m_id, time: msg.timestamp || m.time };
                }
                return m;
              }))
            };
          }
 
          const nextMessage = {
            id: msg.m_id || `${msg.room}-${msg.timestamp}-${msg.username}`,
            m_id: msg.m_id,
            sender: msg.username,
            message: msg.message,
            time: msg.timestamp || new Date().toISOString(),
            type: isStudentSender ? 'sent' : 'received'
          };
 
          return {
            ...prev,
            [msg.room]: sortChatMessages([...roomMsgs, nextMessage])
          };
        });
 
        setScholarships(prev => prev.map((s) => {
          if (s.id !== msg.room) return s;
          const nextUnread = isActiveRoom ? 0 : ((s.unread || 0) + (isStudentSender ? 0 : 1));
          return { ...s, lastMessage: msg.message, time: 'Just now', unread: nextUnread };
        }));
      });
 
      unsubHistory = socketService.subscribe('history', (data) => {
        const roomId = data.room;
        const historyMsgs = data.messages || [];
        const currentAppNo = localStorage.getItem('applicantNo');
        const firstName = (userProfile?.first_name || currentUser?.first_name || '').toLowerCase();
 
        setChatMessages(prev => {
          const roomMsgs = prev[roomId] || [];
          const merged = [...roomMsgs];
 
          historyMsgs.forEach(msg => {
            const msgUsername = String(msg.username || '').toLowerCase();
            const isStudentSender = (
              msgUsername === 'you' ||
              msgUsername === String(currentAppNo || '').toLowerCase() ||
              (firstName && msgUsername === firstName) ||
              msg.is_student_sender === true
            );
 
            const exists = merged.some(m => (msg.m_id && m.m_id && String(m.m_id) === String(msg.m_id)) || (m.message === msg.message && (m.type === 'sent' || isStudentSender)));
            if (!exists) {
              merged.push({
                id: msg.m_id || `${roomId}-${msg.timestamp}-${msg.username}`,
                m_id: msg.m_id,
                sender: msg.username,
                message: msg.message,
                time: msg.timestamp,
                type: isStudentSender ? 'sent' : 'received'
              });
            }
          });

          return {
            ...prev,
            [roomId]: sortChatMessages(merged)
          };
        });
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

      // Live real-time updates for announcements
      const unsubAnnounce = socketService.subscribe('announcement_update', () => {
        console.log('[LIVE SYNC] Announcement update received live');
        fetchAnnouncements();
        fetchNotifications();
      });
      const unsubNewAnnounce = socketService.subscribe('new_announcement', () => {
        console.log('[LIVE SYNC] New announcement received live');
        fetchAnnouncements();
        fetchNotifications();
      });

      // Live real-time updates for scholarships
      const unsubScholar = socketService.subscribe('scholarship_update', () => {
        console.log('[LIVE SYNC] Scholarship update received live');
        fetchResources();
      });
      const unsubScholarChange = socketService.subscribe('scholarship_change', () => {
        console.log('[LIVE SYNC] Scholarship change received live');
        fetchResources();
      });

      // Live real-time updates for applicant status changes & notifications
      const unsubStatus = socketService.subscribe('applicant_status_update', (data) => {
        console.log('[LIVE SYNC] Applicant status update received live:', data);
        fetchApplications();
        fetchProfile();
        fetchNotifications();
      });
      const unsubNotifUpdate = socketService.subscribe('notification_update', () => {
        console.log('[LIVE SYNC] Notification update received live');
        fetchNotifications();
        fetchApplications();
      });
      const unsubNewNotif = socketService.subscribe('new_notification', () => {
        console.log('[LIVE SYNC] New notification received live');
        fetchNotifications();
        fetchApplications();
      });

      var cleanupLiveSockets = () => {
        unsubAnnounce();
        unsubNewAnnounce();
        unsubScholar();
        unsubScholarChange();
        unsubStatus();
        unsubNotifUpdate();
        unsubNewNotif();
      };
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
      if (typeof cleanupLiveSockets === 'function') cleanupLiveSockets();
      if (token) {
        socketService.disconnect();
      }

      clearInterval(notifInterval);
      clearInterval(announcementInterval);

      // Cleanup DOM
      if (document.head.contains(fontAwesomeLink)) document.head.removeChild(fontAwesomeLink);
      if (document.head.contains(googleFontsLink)) document.head.removeChild(googleFontsLink);
      if (document.head.contains(googleFontsDisplay)) document.head.removeChild(googleFontsDisplay);
      if (document.head.contains(googleFontsSheet)) document.head.removeChild(googleFontsSheet);
    };
  }, [navigate]);

  useEffect(() => {
    if (!portalLocked) {
      return;
    }

    setShowMessageDropdown(false);
    setShowNotificationDropdown(false);
    setShowChatModal(false);
    setShowAnnouncementModal(false);

    if (activeSection !== 'menu') {
      setActiveSection('menu');
    }
  }, [portalLocked, activeSection]);

  useEffect(() => {
    const hasAnnouncementNotification = notifications.some((notification) => notification.type === 'announcement');
    if (!hasAnnouncementNotification) {
      return;
    }

    let cancelled = false;

    announcementAPI.getAll()
      .then((data) => {
        if (!cancelled) {
          setDbAnnouncements(data || []);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Failed to refresh announcements:', err);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [notifications]);

  const logout = () => {
    authLogout();  // This clears currentUser, authToken, and applicantNo
    navigate('/');
  };

  const openChat = (scholarId, scholarName) => {
    setCurrentChatId(scholarId);
    setShowChatModal(true);
    socketService.loadHistory(scholarId);

    // Get the provider name from the scholarships array
    const scholarship = scholarships.find(s => s.id === scholarId);
    setCurrentChatProviderName(scholarship?.name || null);

    // Mark scholarship as read when opening chat
    setScholarships(prev => prev.map(s =>
      s.id === scholarId ? { ...s, unread: 0 } : s
    ));
  };

  const closeChat = () => {
    setShowChatModal(false);
    setCurrentChatId(null);
    setCurrentChatProviderName(null);
    setChatInput('');
  };

  const sendMessage = () => {
    const message = chatInput.trim();
    if (!message || !currentChatId) return;
    const applicantNo = localStorage.getItem('applicantNo') || 'You';
    const nowIso = new Date().toISOString();

    const newMsg = {
      id: `msg-${Date.now()}`,
      sender: userProfile?.first_name || currentUser?.first_name || applicantNo || 'You',
      message: message,
      time: nowIso,
      type: 'sent'
    };

    setChatMessages(prev => ({
      ...prev,
      [currentChatId]: sortChatMessages([...(prev[currentChatId] || []), newMsg])
    }));

    setScholarships(prev => prev.map(s => {
      if (s.id === currentChatId) {
        return { ...s, lastMessage: `You: ${message}`, time: 'Just now', unread: 0 };
      }
      return s;
    }));

    if (!currentChatId.startsWith('mock-')) {
      try {
        if (socketService.isConnected()) {
          socketService.sendMessage(currentChatId, applicantNo, message, currentChatProviderName);
        } else if (messagingAPI) {
          messagingAPI.sendMessage(currentChatId, {
            message: message,
            username: applicantNo || 'Applicant',
            sender_id: applicantNo ? Number(applicantNo) : null,
            is_student_sender: true
          }).catch(err => console.warn("HTTP REST fallback send info:", err));
        }
      } catch (err) {
        console.warn("Socket send error:", err);
      }
    } else {
      setTimeout(() => {
        const autoReply = {
          id: `reply-${Date.now()}`,
          sender: currentChatProviderName || 'Scholarship Admin',
          message: 'Thank you for reaching out! Your message has been received by our office.',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          type: 'received'
        };
        setChatMessages(p => ({
          ...p,
          [currentChatId]: sortChatMessages([...(p[currentChatId] || []), autoReply])
        }));
        setScholarships(p => p.map(s => {
          if (s.id === currentChatId) {
            return { ...s, lastMessage: autoReply.message, time: 'Just now' };
          }
          return s;
        }));
      }, 1200);
    }

    setChatInput('');
  };

  const currentRoomMessages = sortChatMessages(chatMessages[currentChatId] || []);

  useEffect(() => {
    currentChatRoomRef.current = showChatModal ? currentChatId : null;
  }, [currentChatId, showChatModal]);

  useEffect(() => {
    if (!showChatModal || !currentChatId) {
      return;
    }

    chatMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [currentChatId, currentRoomMessages.length, showChatModal]);

  const hasFetchedApps = useRef(false);

  // Automated Cleanup: Ensure chat rooms only exist for active applications
  useEffect(() => {
    // We only cleanup IF we have successfully fetched the application list at least once
    // to avoid clearing chat rooms before they've had a chance to match against applications.
    if (hasFetchedApps.current && scholarships.length > 0) {
      setScholarships(prev => {
        const filtered = prev.filter(room => {
          if (room.id.startsWith('mock-')) return true; // Preserve mock chat rooms
          // Room ID format: applicantNo+proNo
          const parts = room.id.split('+');
          if (parts.length < 2) return true; // Keep unidentified room formats

          const roomProNo = parseInt(parts[1]);
          // Check if any application matches this provider
          return applications.some(app => Number(app.pro_no) === roomProNo || Number(app.provider_no) === roomProNo);
        });

        // Only update if something was actually filtered out to avoid loops
        if (filtered.length !== prev.length) {
          return filtered;
        }
        return prev;
      });
    }
  }, [applications, scholarships.length]);

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
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
    // 1. Check dynamic scholarship deadlines from 'resources' state
    const deadlineEvents = resources.filter(scholarship => {
      if (!scholarship.deadline) return false;
      const deadlineDate = new Date(scholarship.deadline);
      return (
        deadlineDate.getDate() === day &&
        deadlineDate.getMonth() === currentDate.getMonth() &&
        deadlineDate.getFullYear() === currentDate.getFullYear()
      );
    });

    if (deadlineEvents.length > 0) {
      const names = deadlineEvents.map(s => s.scholarship_name || 'Scholarship').join(', ');
      return {
        type: 'primary',
        title: `Deadline: ${names}`,
        scholarships: deadlineEvents
      };
    }

    // 2. No more manual/placeholder events to avoid confusion
    return null;
  };

  const markAllNotificationsRead = async () => {
    try {
      await notificationAPI.markAllAsRead();
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch (err) {
      console.error("Failed to mark all as read:", err);
    }
  };

  const handleNotificationClick = async (notif) => {
    if (portalLocked) {
      return;
    }

    // 1. Mark as read in DB if not already
    // Optimistic update
    if (!notif.read) {
      setNotifications(prev => prev.map(n =>
        n.id === notif.id ? { ...n, read: true } : n
      ));
      notificationAPI.markAsRead(notif.id).catch(err => {
        console.error("Failed to mark notification as read:", err);
      });
    }

    // 2. Navigate based on type
    setShowNotificationDropdown(false);

    const notifTitle = (notif.title || '').toLowerCase();
    const notifType = (notif.type || '').toLowerCase();

    // Check if it's a new or updated scholarship
    const isScholarshipUpdate =
      notifType === 'scholarship' ||
      notifType === 'scholarship_update' ||
      (notifTitle.includes('scholarship') && (notifTitle.includes('new') || notifTitle.includes('update') || notifTitle.includes('posted')));

    if (notif.type === 'message') {
      setPortalSection('community');
    } else if (isScholarshipUpdate) {
      setPortalSection('resources');
    } else if (notif.type === 'announcement') {
      setPortalSection('community');
      // Find the specific announcement to open it
      // Use fuzzy matching for title or message if ID isn't linked
      const notifText = `${notif.title || ''} ${notif.message || ''}`;
      const ann = dbAnnouncements.find(a =>
        (a.ann_no && notifText.includes(String(a.ann_no))) ||
        (a.ann_title && (notif.title || '').includes(a.ann_title)) ||
        (a.ann_title && notifText.includes(a.ann_title)) ||
        (a.ann_message && notifText.includes(a.ann_message.substring(0, 20)))
      );
      if (ann) {
        openAnnouncement(ann);
      }
    } else if (notif.type === 'result' || notif.type === 'acceptance') {
      setPortalSection('applications');
    } else {
      setPortalSection('menu');
    }
  };



  const handleViewApplication = (app) => {
    setSelectedAppForView(app);
    setViewModalTab('summary');
    setShowViewModal(true);
  };

  const closeViewModal = () => {
    setShowViewModal(false);
    setSelectedAppForView(null);
  };

  const cancelApplication = (reqNo, scholarshipName) => {
    setPendingCancel({ reqNo, scholarshipName });
    setShowCancelConfirm(true);
  };

  const handleConfirmCancel = async () => {
    if (!pendingCancel) return;

    const { reqNo, scholarshipName } = pendingCancel;
    setShowCancelConfirm(false);

    setLoadingMessage({
      title: 'Cancelling Application',
      message: 'Please wait while we process your request.'
    });
    setShowLoadingOverlay(true);

    try {
      // 1. Find the application to get the provider ID for the chat room removal
      const targetApp = applications.find(app => (app.scholarship_no === reqNo || app.req_no === reqNo));
      const proNo = targetApp?.pro_no;
      const applicantNo = localStorage.getItem('applicantNo');

      // 2. If we found a provider, send a cancellation message via socket FIRST
      // This ensures the admin sees WHO cancelled WHAT before the room is detached.
      if (proNo && applicantNo) {
        const roomId = `${applicantNo}+${proNo}`;
        const scholarship = scholarships.find(s => s.id === roomId);
        const providerName = scholarship?.name || null;
        socketService.sendMessage(roomId, applicantNo, `I have cancelled my application for "${scholarshipName}".`, providerName);

        // Remove the room from the applicant's side local state immediately
        setScholarships(prev => prev.filter(s => s.id !== roomId));
      }

      // 3. Call the API to delete the application status from the DB
      await applicationAPI.cancel(reqNo);

      // Refresh the list after cancellation
      const apps = await applicationAPI.getUserApplications();
      setApplications(apps || []);

      setStatusInfo({
        title: 'Cancellation Successful',
        message: `Your application for "${scholarshipName}" has been successfully cancelled.`,
        isError: false
      });
      setShowStatusModal(true);
    } catch (err) {
      console.error("Failed to cancel application:", err);
      setStatusInfo({
        title: 'Cancellation Error',
        message: `Error: ${err.message || 'Could not cancel application'}`,
        isError: true
      });
      setShowStatusModal(true);
    } finally {
      setShowLoadingOverlay(true); // Keep overlay for status modal
      setTimeout(() => setShowLoadingOverlay(false), 500);
      setPendingCancel(null);
    }
  };

  const openAnnouncement = (ann) => {
    if (!ann) return;
    const id = ann?.ann_no ?? ann?.id ?? ann?.announcement_id ?? 'N/A';
    const title = ann?.ann_title || ann?.title || 'Announcement';
    const message = ann?.ann_message || ann?.message || ann?.content || 'No details provided.';
    const provider = ann?.provider_name || ann?.providerName || 'Scholarship Team';
    const date = ann?.time_added || ann?.status_updated || ann?.ann_date || null;

    setSelectedAnnouncement({
      ...ann,
      announcementId: id,
      announcementTitle: title,
      announcementMessage: message,
      announcementProvider: provider,
      postedAt: date,
    });
    setShowAnnouncementModal(true);
  };

  const closeAnnouncementModal = () => {
    setShowAnnouncementModal(false);
    setSelectedAnnouncement(null);
    setSelectedAnnouncementImage(null);
  };

  const openAnnouncementImage = (imageSrc, imageAlt) => {
    if (!imageSrc) return;
    setSelectedAnnouncementImage({ src: imageSrc, alt: imageAlt || 'Announcement image' });
  };

  const closeAnnouncementImage = () => {
    setSelectedAnnouncementImage(null);
  };

  const totalUnreadMessages = scholarships.reduce((sum, s) => sum + s.unread, 0);
  const totalUnreadNotifications = notifications.filter(n => !n.read).length;

  return (
    <div className="portal-page-wrapper">
      <style>{`
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        .portal-page-wrapper {
          display: flex;
          flex-direction: column;
          min-height: 100vh;
          width: 100%;
          background-color: #f9fafc;
          box-sizing: border-box;
        }

        .portal {
          flex: 1 0 auto;
          width: 100%;
          display: flex;
          flex-direction: column;
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
          background: rgba(0, 0, 0, 0.45);
          backdrop-filter: blur(12px);
          display: none;
          justify-content: center;
          align-items: center;
          z-index: 10000;
          animation: modalFadeIn 0.35s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .loading-overlay.active {
          display: flex;
        }

        .loading-modal {
          background: rgba(255, 255, 255, 0.98);
          backdrop-filter: blur(20px);
          padding: clamp(1.5rem, 4vw, 2.2rem) clamp(1.2rem, 3.5vw, 1.8rem);
          border-radius: clamp(18px, 3vw, 24px);
          text-align: center;
          box-shadow: 
            0 20px 45px -10px rgba(0, 0, 0, 0.2),
            0 0 1px 1px rgba(255, 255, 255, 0.1) inset;
          max-width: 420px;
          width: 90%;
          border: 1px solid rgba(255, 255, 255, 0.6);
          position: relative;
          overflow: hidden;
          animation: modalSlideUp 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        @keyframes modalFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes modalSlideUp {
          from { opacity: 0; transform: translateY(20px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        .loading-spinner {
          width: 48px;
          height: 48px;
          border: 4px solid #ffe8e3;
          border-top: 4px solid var(--primary);
          border-radius: 50%;
          margin: 0 auto 1.2rem;
          animation: spin 0.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .modal-buttons {
          display: flex;
          gap: 0.75rem;
          justify-content: center;
          margin-top: 1.5rem;
        }

        .modal-btn {
          padding: 0.65rem 1.6rem;
          border-radius: 30px;
          font-weight: 700;
          font-size: 0.85rem;
          cursor: pointer;
          transition: all 0.2s;
          min-width: 120px;
          font-family: 'Inter', sans-serif;
        }

        .modal-btn-primary {
          background: var(--primary);
          color: white;
          border: none;
          box-shadow: 0 6px 14px rgba(79, 13, 0, 0.18);
        }

        .modal-btn-primary:hover {
          background: #3d0a00;
          transform: translateY(-1px);
          box-shadow: 0 10px 18px rgba(79, 13, 0, 0.25);
        }

        .modal-btn-secondary {
          background: white;
          color: var(--text-soft);
          border: 1.5px solid var(--gray-2);
        }

        .modal-btn-secondary:hover {
          background: var(--gray-1);
          border-color: var(--gray-3);
        }

        /* View Application Modal Styles - Compact & Sleek */
        .view-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.45);
          backdrop-filter: blur(8px);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 9999;
          padding: clamp(0.5rem, 2vw, 1.2rem);
          box-sizing: border-box;
          animation: modalFadeIn 0.25s ease-out;
        }

        .view-modal {
          background: rgba(255, 255, 255, 0.98);
          width: min(92%, 660px);
          max-height: min(82vh, 720px);
          border-radius: clamp(16px, 2.5vw, 22px);
          box-shadow: var(--shadow-lg);
          border: 1px solid rgba(255, 255, 255, 0.8);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-sizing: border-box;
          animation: modalSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .view-modal-header {
          padding: clamp(0.85rem, 2vw, 1.25rem) clamp(1rem, 3vw, 1.6rem);
          border-bottom: 1px solid var(--gray-2);
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: linear-gradient(to right, #ffffff, var(--gray-1));
        }

        .view-modal-title h2 {
          color: var(--primary);
          font-weight: 800;
          font-size: clamp(1.05rem, 2.2vw, 1.3rem);
          margin: 0;
        }

        .view-modal-content {
          padding: clamp(1rem, 3vw, 1.5rem) clamp(1rem, 3vw, 1.6rem);
          overflow-y: auto;
          flex: 1;
        }

        .view-section {
          margin-bottom: clamp(1.1rem, 2.5vw, 1.6rem);
        }

        .view-section-title {
          font-size: clamp(0.78rem, 1.6vw, 0.85rem);
          font-weight: 700;
          color: var(--primary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: clamp(0.6rem, 1.5vw, 0.9rem);
          display: flex;
          align-items: center;
          gap: 0.6rem;
        }

        .view-section-title::after {
          content: "";
          flex: 1;
          height: 1px;
          background: var(--gray-2);
        }

        .view-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(min(100%, 160px), 1fr));
          gap: clamp(0.6rem, 1.5vw, 1.1rem);
        }

        .view-item label {
          display: block;
          font-size: clamp(0.68rem, 1.3vw, 0.75rem);
          color: var(--text-soft);
          margin-bottom: 0.2rem;
          font-weight: 600;
        }

        .view-item .value {
          font-size: clamp(0.82rem, 1.6vw, 0.92rem);
          color: var(--text-dark);
          font-weight: 500;
          word-break: break-word;
          overflow-wrap: break-word;
        }

        .doc-gallery {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(min(100%, 150px), 1fr));
          gap: clamp(0.6rem, 1.8vw, 1.2rem);
          margin-top: 1rem;
        }

        .doc-card {
          background: white;
          border: 1px solid var(--gray-2);
          border-radius: 16px;
          padding: 1rem;
          text-align: center;
          transition: all 0.2s;
          cursor: pointer;
        }

        .doc-card:hover {
          border-color: var(--primary);
          transform: translateY(-3px);
          box-shadow: var(--shadow-md);
        }

        .doc-icon {
          font-size: 2rem;
          color: var(--primary);
          margin-bottom: 0.8rem;
        }

        .doc-name {
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--text-dark);
        }

        .doc-status {
          font-size: 0.75rem;
          margin-top: 0.3rem;
        }

        .doc-status.available { color: var(--success); }
        .doc-status.missing { color: var(--danger); }

        .view-modal-close {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          border: none;
          background: var(--gray-1);
          color: var(--text-soft);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s;
        }

        .view-modal-close:hover {
          background: var(--danger-bg);
          color: var(--danger);
        }

        .view-btn {
          background: var(--primary);
          color: white;
          border: none;
          padding: clamp(0.45rem, 1.5vw, 0.65rem) clamp(0.9rem, 2vw, 1.4rem);
          border-radius: 20px;
          font-size: clamp(0.78rem, 1.5vw, 0.88rem);
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          box-shadow: 0 4px 8px rgba(79, 13, 0, 0.15);
          max-width: 100%;
          box-sizing: border-box;
        }

        .view-btn:hover {
          background: #3d0a00;
          transform: translateY(-1px);
          box-shadow: 0 6px 12px rgba(79, 13, 0, 0.25);
        }

        .navbar {
          background: var(--primary);
          padding: 0.85rem 4%;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: var(--border-light);
          position: sticky;
          top: 0;
          z-index: 100;
          backdrop-filter: blur(12px);
          background-color: rgba(79, 13, 0, 0.96);
          width: 100%;
          box-sizing: border-box;
        }

        .navbar-brand {
          display: flex;
          align-items: center;
          gap: clamp(0.35rem, 1.5vw, 0.65rem);
          font-size: clamp(1.1rem, 3.5vw, 1.55rem);
          font-weight: 800;
          letter-spacing: -0.02em;
          color: white;
          text-decoration: none;
          transition: transform 0.2s ease, opacity 0.2s ease;
          flex-shrink: 0;
        }

        .navbar-brand:hover {
          opacity: 0.95;
        }

        .navbar-brand-logo {
          height: clamp(28px, 4vw, 36px);
          width: clamp(28px, 4vw, 36px);
          min-width: clamp(28px, 4vw, 36px);
          flex-shrink: 0;
          object-fit: contain;
          filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.3));
          border-radius: 50%;
        }

        .navbar-brand-text {
          font-size: clamp(1.1rem, 3.5vw, 1.55rem);
          font-weight: 800;
          letter-spacing: -0.02em;
          color: white;
          text-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
          white-space: nowrap;
        }

        .navbar-actions-group {
          display: flex;
          align-items: center;
          gap: clamp(0.5rem, 1.5vw, 1rem);
          flex-shrink: 0;
        }

        .navbar-desktop-menu {
          display: flex;
          align-items: center;
          gap: clamp(0.5rem, 1.2vw, 0.85rem);
        }

        .navbar-toggle-btn {
          display: none;
          background: rgba(255, 255, 255, 0.14);
          border: 1px solid rgba(255, 255, 255, 0.25);
          color: white;
          font-size: clamp(0.95rem, 2.5vw, 1.15rem);
          cursor: pointer;
          width: clamp(32px, 5vw, 38px);
          min-width: clamp(32px, 5vw, 38px);
          height: clamp(32px, 5vw, 38px);
          flex-shrink: 0;
          aspect-ratio: 1 / 1;
          border-radius: 10px;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
          box-sizing: border-box;
        }

        .navbar-toggle-btn:hover {
          background: rgba(255, 255, 255, 0.25);
        }

        .close-dropdown-btn {
          background: transparent;
          border: none;
          color: white;
          font-size: 1rem;
          cursor: pointer;
          padding: 0.2rem 0.5rem;
          opacity: 0.8;
          transition: opacity 0.2s;
        }

        .close-dropdown-btn:hover {
          opacity: 1;
        }

        .navbar-menu {
          display: none;
        }

        .navbar-user-chip {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          color: rgba(255, 255, 255, 0.95);
          font-weight: 600;
          font-size: 0.9rem;
          padding: 0.4rem 0.9rem;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 20px;
          border: 1px solid rgba(255, 255, 255, 0.15);
        }

        @media (max-width: 768px) {
          .navbar {
            position: relative;
            padding: 0.65rem 4%;
          }

          .navbar-desktop-menu {
            display: none !important;
          }

          .navbar-toggle-btn {
            display: flex !important;
          }

          .navbar-brand-text {
            font-size: 1.35rem;
          }

          .navbar-brand-logo {
            height: 32px;
            width: 32px;
          }

          .navbar-menu {
            display: none;
            position: absolute;
            top: 100%;
            left: 0;
            width: 100%;
            background: #2b0600;
            flex-direction: column;
            padding: 1.2rem 1.25rem 1.5rem;
            gap: 0.75rem;
            align-items: stretch;
            border-top: 1px solid rgba(255, 255, 255, 0.12);
            border-bottom: 1px solid rgba(255, 255, 255, 0.15);
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.7);
            z-index: 1500;
            box-sizing: border-box;
          }

          .navbar-menu.active {
            display: flex;
          }

          .navbar-user-chip {
            width: 100%;
            justify-content: center;
            padding: 0.65rem;
            box-sizing: border-box;
            font-size: 0.95rem;
          }

          .profile-btn, .logout-btn {
            width: 100%;
            justify-content: center;
            padding: 0.75rem 1rem;
            font-size: 0.95rem;
            font-weight: 700;
            border-radius: 12px;
            box-sizing: border-box;
          }

          .message-dropdown,
          .notification-dropdown {
            position: fixed !important;
            top: 70px !important;
            left: 4% !important;
            right: 4% !important;
            width: 92% !important;
            max-width: 440px !important;
            margin: 0 auto !important;
            max-height: 80vh !important;
            overflow-y: auto !important;
            box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8) !important;
            border-radius: 16px !important;
            z-index: 3000 !important;
          }
        }

        .logout-btn {
          background: rgba(239, 68, 68, 0.22);
          border: 1px solid rgba(239, 68, 68, 0.45);
          color: #fee2e2;
          padding: 0.5rem 1.3rem;
          border-radius: 40px;
          font-weight: 600;
          font-size: 0.88rem;
          transition: all 0.2s ease;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 0.45rem;
          box-sizing: border-box;
        }

        .logout-btn:hover {
          background: rgba(220, 38, 38, 0.45);
          border-color: #fca5a5;
          color: white;
          transform: translateY(-1px);
        }

        .profile-btn {
          background: rgba(255, 255, 255, 0.14);
          border: 1px solid rgba(255, 255, 255, 0.25);
          color: white;
          padding: 0.5rem 1.3rem;
          border-radius: 40px;
          font-weight: 600;
          font-size: 0.88rem;
          transition: all 0.2s ease;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 0.45rem;
          box-sizing: border-box;
        }

        .profile-btn:hover {
          background: rgba(255, 255, 255, 0.25);
          border-color: rgba(255, 255, 255, 0.6);
          color: white;
          transform: translateY(-1px);
        }

        .nav-profile-avatar {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          object-fit: cover;
          border: 1.5px solid rgba(255, 255, 255, 0.8);
          margin-right: 4px;
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
          font-size: clamp(1.05rem, 2.5vw, 1.25rem);
          cursor: pointer;
          position: relative;
          width: auto;
          min-width: auto;
          height: auto;
          padding: 0.35rem;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
          flex-shrink: 0;
        }

        .message-btn:hover,
        .notification-btn:hover {
          opacity: 0.85;
          transform: scale(1.1);
        }

        .message-badge,
        .notification-badge {
          position: absolute;
          top: -2px;
          right: -4px;
          background: #ff5252;
          color: white;
          font-size: clamp(0.58rem, 1.5vw, 0.65rem);
          font-weight: 800;
          min-width: clamp(14px, 3.5vw, 16px);
          height: clamp(14px, 3.5vw, 16px);
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0 3px;
          border: 1.5px solid rgba(79, 13, 0, 0.95);
        }

        .message-dropdown,
        .notification-dropdown {
          position: absolute;
          top: 45px;
          right: 0;
          width: clamp(280px, 90vw, 340px);
          max-width: calc(100vw - 2rem);
          background: white;
          border-radius: 18px;
          box-shadow: 0 12px 36px rgba(0, 0, 0, 0.2);
          border: 1px solid rgba(79, 13, 0, 0.12);
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
          padding: 0.75rem 1rem;
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
          font-size: 0.88rem;
          font-weight: 700;
        }

        .new-message-btn {
          background: var(--primary);
          color: white;
          border: none;
          padding: 0.25rem 0.5rem;
          border-radius: 20px;
          cursor: pointer;
          font-size: 0.75rem;
          display: flex;
          align-items: center;
          gap: 0.25rem;
          transition: all 0.2s ease;
        }

        .new-message-btn:hover {
          background: var(--primary-dark);
          transform: translateY(-1px);
          box-shadow: 0 4px 8px rgba(79, 13, 0, 0.2);
        }

        .mark-read {
          cursor: pointer;
          color: var(--primary);
          font-size: 0.85rem;
          font-weight: 600;
          transition: all 0.2s ease;
        }

        .mark-read:hover {
          color: var(--primary-light);
          text-decoration: underline;
        }

        .message-list,
        .notification-list {
          max-height: 320px;
          overflow-y: auto;
        }

        .message-item,
        .notification-item {
          padding: 0.65rem 0.85rem;
          border-bottom: 1px solid var(--gray-1);
          transition: background 0.2s ease;
          cursor: pointer;
          display: flex;
          gap: 0.65rem;
          align-items: center;
          width: 100%;
          box-sizing: border-box;
        }

        .message-item:hover,
        .notification-item:hover {
          background: var(--accent-soft);
        }

        .message-item.unread,
        .notification-item.unread {
          background: #fff9f7;
          border-left: 3.5px solid var(--primary);
        }

        .message-icon,
        .notification-icon {
          width: clamp(28px, 6vw, 34px);
          height: clamp(28px, 6vw, 34px);
          min-width: clamp(28px, 6vw, 34px);
          border-radius: 50%;
          background: var(--accent-soft);
          color: var(--primary);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: clamp(0.8rem, 2vw, 0.95rem);
          flex-shrink: 0;
        }

        .message-content,
        .notification-content {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
        }

        .message-title,
        .notification-title {
          font-weight: 600;
          font-size: 0.85rem;
          color: var(--text-dark);
          margin-bottom: 0.15rem;
        }

        .message-sender {
          font-size: 0.78rem;
          color: var(--primary);
          font-weight: 700;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .message-preview,
        .notification-message {
          font-size: 0.73rem;
          color: var(--text-soft);
          line-height: 1.25;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .message-time,
        .notification-time {
          font-size: 0.65rem;
          color: var(--gray-3);
          font-weight: 500;
        }

        .chat-modal {
          display: none;
          position: fixed;
          inset: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(12, 16, 24, 0.55);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          z-index: 2000;
          align-items: center;
          justify-content: center;
          padding: 1rem;
          box-sizing: border-box;
        }

        .chat-modal.show {
          display: flex;
        }

        .chat-container {
          width: 100%;
          max-width: 380px;
          height: 480px;
          max-height: 82vh;
          background: white;
          border-radius: 20px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.2);
        }

        .chat-header {
          background: var(--primary);
          color: white;
          padding: 0.75rem 1rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .chat-header h3 {
          font-size: 0.92rem;
          font-weight: 700;
        }

        .chat-header button {
          background: none;
          border: none;
          color: white;
          font-size: 1rem;
          cursor: pointer;
          padding: 0.2rem;
          border-radius: 50%;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0.9;
        }

        .chat-header button:hover {
          background: rgba(255, 255, 255, 0.2);
          opacity: 1;
        }

        .chat-messages {
          flex: 1;
          padding: 0.85rem 1rem;
          overflow-y: auto;
          background: #f8fafc;
          display: flex;
          flex-direction: column;
          gap: 0.65rem;
        }

        .message-bubble {
          max-width: 82%;
          padding: 0.55rem 0.8rem;
          border-radius: 14px;
          position: relative;
          word-wrap: break-word;
          font-size: 0.8rem;
          line-height: 1.35;
        }

        .message-bubble.received {
          background: white;
          align-self: flex-start;
          border-bottom-left-radius: 3px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.06);
          border: 1px solid rgba(0,0,0,0.04);
        }

        .message-bubble.sent {
          background: var(--primary);
          color: white;
          align-self: flex-end;
          border-bottom-right-radius: 3px;
        }

        .message-bubble .sender {
          font-size: 0.65rem;
          font-weight: 700;
          margin-bottom: 0.15rem;
          color: var(--primary);
        }

        .message-bubble.sent .sender {
          color: rgba(255, 255, 255, 0.85);
        }

        .message-bubble .time {
          font-size: 0.58rem;
          margin-top: 0.15rem;
          opacity: 0.7;
          text-align: right;
        }

        .no-messages {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 2rem 1rem;
          min-height: 140px;
          font-size: 0.85rem;
          color: var(--text-soft);
          font-weight: 500;
          text-align: center;
          gap: 0.4rem;
          width: 100%;
          box-sizing: border-box;
        }

        .no-messages i {
          font-size: clamp(1.4rem, 4vw, 1.9rem);
          color: var(--gray-3);
          margin-bottom: 0.2rem;
          display: block;
        }

        .chat-input-area {
          padding: 0.65rem 0.85rem;
          background: white;
          border-top: 1px solid var(--gray-2);
          display: flex;
          gap: 0.65rem;
          align-items: center;
          width: 100%;
          box-sizing: border-box;
        }

        .chat-input-area input {
          flex: 1;
          min-width: 0;
          padding: 0.55rem 0.9rem;
          border: 1px solid var(--gray-2);
          border-radius: 30px;
          font-family: 'Inter', sans-serif;
          font-size: 0.82rem;
          outline: none;
          transition: border 0.2s;
          box-sizing: border-box;
        }

        .chat-input-area input:focus {
          border-color: var(--primary);
        }

        .chat-input-area button {
          background: var(--primary);
          color: white;
          border: none;
          width: 36px;
          height: 36px;
          min-width: 36px;
          min-height: 36px;
          max-width: 36px;
          max-height: 36px;
          aspect-ratio: 1 / 1;
          flex-shrink: 0;
          border-radius: 50%;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.85rem;
          padding: 0;
          box-sizing: border-box;
        }

        .chat-input-area button i {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transform: translate(-1px, 0);
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
          padding: clamp(1.8rem, calc(3.5vh + 2vw), 4.5rem) clamp(1.2rem, 4vw, 3.5rem);
          text-align: center;
          border-radius: clamp(18px, 3.5vw, 32px);
          margin: clamp(1rem, 2.5vw, 2rem) auto;
          width: 92%;
          max-width: 1300px;
          min-height: clamp(160px, calc(18vh + 8vw), 340px);
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.06);
          position: relative;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.6);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
        }

        .portal-header h2 {
          font-size: clamp(1.3rem, calc(1rem + 2vw + 1vh), 3rem);
          font-weight: 800;
          letter-spacing: -0.02em;
          margin-bottom: 0.5rem;
          color: var(--primary);
          position: relative;
          z-index: 2;
          text-shadow: 0 2px 10px rgba(255, 255, 255, 0.6);
          line-height: 1.25;
        }

        .portal-header p {
          color: #1a2332;
          font-weight: 500;
          font-size: clamp(0.85rem, calc(0.75rem + 0.8vw + 0.4vh), 1.2rem);
          letter-spacing: 0.2px;
          position: relative;
          z-index: 2;
          opacity: 0.92;
          max-width: 700px;
          margin: 0 auto;
        }

        .portal-content {
          max-width: 1300px;
          margin: 1.5rem auto 3rem;
          padding: 0 4%;
          box-sizing: border-box;
        }

        .portal-content {
          max-width: 1300px;
          margin: 1.5rem auto 3rem;
          padding: 0 3%;
          box-sizing: border-box;
          width: 100%;
        }

        .portal-menu {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: clamp(0.8rem, 1.8vw, 1.8rem);
          margin: 0 auto 3rem;
          justify-content: center;
          align-items: stretch;
          max-width: 1250px;
          width: 100%;
          box-sizing: border-box;
        }

        @media (max-width: 1024px) {
          .portal-menu {
            grid-template-columns: repeat(2, 1fr);
            gap: 1.25rem;
            max-width: 700px;
          }
        }

        @media (max-width: 600px) {
          .portal-menu {
            grid-template-columns: 1fr;
            gap: 1.2rem;
            max-width: 450px;
          }
        }

        .menu-card {
          background: #f8fafb;
          padding: clamp(1.4rem, 2.2vw, 2rem) clamp(0.8rem, 1.8vw, 1.4rem);
          border-radius: 24px;
          box-shadow: var(--shadow-sm);
          border: var(--border-light);
          transition: all 0.3s ease;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: space-between;
          height: 100%;
          min-height: clamp(200px, 28vh, 270px);
          width: 100%;
          box-sizing: border-box;
          overflow: hidden;
        }

        .menu-card:hover {
          box-shadow: 0 12px 28px rgba(79, 13, 0, 0.12);
          border-color: #ffe8e3;
          transform: translateY(-4px);
        }

        .menu-card h3 {
          font-size: clamp(1.05rem, 1.8vw, 1.25rem);
          font-weight: 700;
          color: #4F0D00;
          margin-bottom: 0.6rem;
          letter-spacing: -0.01em;
          word-break: break-word;
          overflow-wrap: break-word;
          width: 100%;
        }

        .menu-card p {
          color: #5a6b7d;
          margin-bottom: clamp(1rem, 2vw, 1.5rem);
          font-size: clamp(0.82rem, 1.4vw, 0.92rem);
          line-height: 1.5;
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          word-break: break-word;
          overflow-wrap: break-word;
          width: 100%;
        }

        .menu-btn {
          background: #4F0D00;
          color: white;
          border: none;
          border-radius: 40px;
          height: auto;
          min-height: 42px;
          padding: clamp(0.55rem, 1.2vw, 0.75rem) clamp(0.8rem, 1.8vw, 1.2rem);
          width: 85%;
          max-width: 200px;
          margin: 0 auto;
          font-weight: 700;
          font-size: clamp(0.75rem, 1.3vw, 0.86rem);
          line-height: 1.25;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 4px 12px rgba(79, 13, 0, 0.15);
          text-decoration: none;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          box-sizing: border-box;
          white-space: normal;
          word-break: break-word;
          overflow-wrap: break-word;
        }

        @media (max-width: 600px) {
          .menu-card {
            padding: 1.5rem 1.2rem !important;
            border-radius: 20px !important;
          }

          .menu-btn {
            height: auto !important;
            min-height: 42px !important;
            padding: 0.65rem 1rem !important;
            width: 85% !important;
            max-width: 240px !important;
            font-size: 0.88rem !important;
            margin: 0 auto !important;
            white-space: normal !important;
          }
        }

        .menu-btn:hover {
          background: #3d0a00;
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(79, 13, 0, 0.25);
        }

        .application-list {
          background: var(--white);
          border-radius: clamp(16px, 3vw, 24px);
          padding: 0.5rem 0;
          box-shadow: var(--shadow-sm);
          border: var(--border-light);
          overflow: hidden;
        }

        .application-item {
          padding: clamp(1rem, 2vw, 1.4rem) clamp(1rem, 2.5vw, 1.8rem);
          border-bottom: 1px solid var(--gray-2);
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 0.75rem;
          width: 100%;
          box-sizing: border-box;
        }

        .application-item:last-child {
          border-bottom: none;
        }

        .application-info {
          flex: 1 1 200px;
          min-width: 0;
        }

        .application-info h4 {
          margin: 0 0 0.25rem 0;
          font-size: clamp(0.95rem, 2vw, 1.1rem);
          font-weight: 700;
          color: var(--primary);
          line-height: 1.3;
          word-break: break-word;
          overflow-wrap: break-word;
        }

        .application-info p {
          margin: 0;
          font-size: clamp(0.78rem, 1.6vw, 0.85rem);
        }

        .application-actions {
          display: flex;
          align-items: center;
          gap: 0.45rem;
          flex-wrap: nowrap;
          flex-shrink: 0;
          margin-left: auto;
        }

        .status-badge {
          padding: 0.3rem 0.75rem;
          border-radius: 40px;
          font-weight: 600;
          font-size: clamp(0.7rem, 1.5vw, 0.78rem);
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
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

        .view-btn {
          background: var(--primary);
          color: white;
          border: none;
          padding: 0.35rem 0.85rem;
          border-radius: 20px;
          font-size: clamp(0.72rem, 1.5vw, 0.8rem);
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          white-space: nowrap;
          box-shadow: 0 2px 6px rgba(79, 13, 0, 0.15);
          width: auto !important;
        }

        .view-btn:hover {
          background: #3d0a00;
          transform: translateY(-1px);
          box-shadow: 0 4px 10px rgba(79, 13, 0, 0.25);
        }

        .cancel-btn {
          background: transparent;
          border: 1.5px solid var(--danger);
          color: var(--danger);
          padding: 0.3rem 0.75rem;
          border-radius: 20px;
          font-size: clamp(0.72rem, 1.5vw, 0.8rem);
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          white-space: nowrap;
          width: auto !important;
        }

        .cancel-btn:hover {
          background: var(--danger);
          color: white;
          box-shadow: 0 4px 8px rgba(231, 76, 60, 0.2);
        }

        @media (max-width: 580px) {
          .application-item {
            padding: 0.9rem 0.85rem;
            gap: 0.5rem;
          }
          .application-actions {
            width: 100%;
            justify-content: flex-end;
            margin-top: 0.2rem;
            margin-left: auto;
            flex-wrap: nowrap;
          }
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
          padding: clamp(0.35rem, 1vw, 0.5rem) clamp(0.8rem, 2vw, 1.2rem);
          border-radius: 40px;
          font-weight: 600;
          color: var(--text-soft);
          margin-bottom: clamp(1rem, 2.5vw, 1.5rem);
          cursor: pointer;
          transition: 0.1s;
          font-size: clamp(0.78rem, 2vw, 0.88rem);
        }

        .back-button:hover {
          background: #f1f5f9;
          border-color: var(--gray-3);
        }

        .section-header-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 0.5rem;
          margin-bottom: clamp(0.8rem, 2vw, 1.2rem);
        }

        .section-header-row h3 {
          color: var(--primary);
          margin: 0;
          font-size: clamp(1.1rem, 3vw, 1.4rem);
          font-weight: 800;
          flex: 1 1 auto;
          min-width: 0;
        }

        .section-header-btn,
        .card-action-btn {
          background: var(--primary);
          color: white;
          border: none;
          padding: clamp(0.35rem, 1vw, 0.5rem) clamp(0.65rem, 1.5vw, 0.95rem);
          border-radius: 8px;
          cursor: pointer;
          font-size: clamp(0.72rem, 1.8vw, 0.82rem);
          font-weight: 600;
          transition: all 0.2s ease;
          box-shadow: 0 4px 10px rgba(79, 13, 0, 0.15);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .section-header-btn:hover,
        .card-action-btn:hover {
          background: #3d0a00;
          transform: translateY(-1px);
          box-shadow: 0 6px 14px rgba(79, 13, 0, 0.25);
        }

        .announcement-search-input:focus {
          border-color: var(--primary) !important;
          box-shadow: 0 0 0 3px rgba(79, 13, 0, 0.12) !important;
        }

        @media (max-width: 480px) {
          .section-header-row {
            flex-direction: column;
            align-items: flex-start;
          }
          .section-header-btn,
          .card-action-btn {
            width: 100%;
            justify-content: center;
          }
        }

        .community-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 2rem;
        }

        .community-post {
          background: var(--white);
          padding: clamp(0.85rem, 2vw, 1.4rem);
          border-radius: clamp(12px, 3vw, 20px);
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
          grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
          gap: clamp(1rem, 2.5vw, 2rem);
          margin-top: 1.5rem;
        }

        .scholarship-card {
          background: var(--white);
          padding: clamp(1.2rem, 3vw, 2.2rem) clamp(1rem, 2.5vw, 1.8rem);
          border-radius: clamp(14px, 3vw, 20px);
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
          font-size: clamp(1.02rem, 2.2vw, 1.15rem);
          font-weight: 700;
          color: var(--primary);
          margin-bottom: 0.8rem;
          letter-spacing: -0.01em;
          word-break: break-word;
          overflow-wrap: break-word;
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
          padding: 0.6rem 0;
          padding-left: 2.2rem;
          position: relative;
          color: var(--text-soft);
          font-size: 0.95rem;
          line-height: 1.5;
        }

        .requirements-list li::before {
          content: '✓';
          position: absolute;
          left: 0;
          top: 0.5rem;
          color: var(--primary);
          background: var(--accent-soft);
          width: 1.4rem;
          height: 1.4rem;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 800;
          font-size: 0.75rem;
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
          
          .community-post {
            background: white;
            padding: 1.5rem;
            border-radius: 12px;
            box-shadow: var(--shadow-sm);
            border: 1px solid var(--border-light);
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            cursor: pointer;
            position: relative;
            overflow: hidden;
          }

          .community-post:hover {
            transform: translateY(-2px);
            box-shadow: var(--shadow-md);
            border-color: rgba(79, 13, 0, 0.2);
            background-color: #fffaf9;
          }
        }

        @media (max-width: 640px) {
          .portal-menu {
            grid-template-columns: repeat(2, 1fr) !important;
            gap: 0.75rem !important;
          }

          .menu-card {
            padding: 1.2rem 0.85rem !important;
            border-radius: 20px !important;
          }

          .menu-card h3 {
            font-size: 0.95rem !important;
          }

          .menu-card p {
            font-size: 0.78rem !important;
            margin-bottom: 1rem !important;
          }

          .menu-btn {
            padding: 0.5rem 1rem !important;
            font-size: 0.8rem !important;
            width: 100% !important;
          }
        }

        .announcement-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(8px);
          z-index: 99999;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: clamp(0.75rem, 3vw, 2rem);
          animation: modalFadeIn 0.3s ease forwards;
        }

        .announcement-modal {
          background: white;
          width: 100%;
          max-width: min(550px, 95vw);
          max-height: 88vh;
          border-radius: clamp(16px, 4vw, 28px);
          box-shadow: var(--shadow-lg);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          animation: modalSlideUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        .ann-modal-header {
          padding: clamp(1.2rem, 3vw, 2rem) clamp(1.2rem, 3vw, 2rem) clamp(0.8rem, 2vw, 1.2rem);
          position: relative;
          border-bottom: 1px solid var(--gray-1);
        }

        .ann-modal-close {
          position: absolute;
          top: clamp(0.8rem, 2vw, 1.5rem);
          right: clamp(0.8rem, 2vw, 1.5rem);
          background: var(--gray-1);
          border: none;
          width: clamp(30px, 5vw, 36px);
          height: clamp(30px, 5vw, 36px);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: var(--text-soft);
          font-size: clamp(0.75rem, 2vw, 0.9rem);
          transition: all 0.2s;
        }

        .ann-modal-close:hover {
          background: var(--accent-soft);
          color: var(--primary);
          transform: rotate(90deg);
        }

        .ann-modal-body {
          padding: clamp(1.2rem, 3vw, 2rem);
          max-height: 70vh;
          overflow-y: auto;
        }

        .ann-modal-title {
          font-size: clamp(1.1rem, 3.5vw, 1.5rem);
          font-weight: 800;
          color: var(--text-dark);
          line-height: 1.3;
          letter-spacing: -0.02em;
          margin-top: 0.4rem;
          word-break: break-word;
          overflow-wrap: break-word;
        }

        .ann-modal-provider {
          display: flex;
          align-items: center;
          gap: clamp(0.5rem, 1.5vw, 0.8rem);
          margin-bottom: 0.4rem;
        }

        .provider-icon {
          width: clamp(26px, 4vw, 32px);
          height: clamp(26px, 4vw, 32px);
          background: var(--accent-soft);
          color: var(--primary);
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: clamp(0.72rem, 2vw, 0.85rem);
          flex-shrink: 0;
        }

        .provider-name {
          font-weight: 700;
          color: var(--primary);
          font-size: clamp(0.75rem, 2vw, 0.88rem);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .ann-modal-meta {
          display: flex;
          align-items: center;
          gap: clamp(0.6rem, 2vw, 1.2rem);
          margin-top: clamp(0.8rem, 2vw, 1.2rem);
          color: var(--text-soft);
          font-size: clamp(0.72rem, 1.8vw, 0.82rem);
          font-weight: 500;
          flex-wrap: wrap;
        }

        .ann-modal-message {
          font-size: clamp(0.82rem, 2vw, 0.95rem);
          line-height: 1.65;
          color: var(--text-dark);
          white-space: pre-wrap;
        }

        .ann-modal-gallery {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(clamp(120px, 25vw, 180px), 1fr));
          gap: clamp(0.5rem, 1.5vw, 1rem);
          margin-top: clamp(1rem, 2.5vw, 1.5rem);
        }

        .ann-modal-image-card {
          background: var(--gray-1);
          border-radius: clamp(10px, 2vw, 16px);
          overflow: hidden;
          box-shadow: var(--shadow-sm);
          border: 1px solid rgba(79, 13, 0, 0.08);
          cursor: zoom-in;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
          padding: 0;
          width: 100%;
        }

        .ann-modal-image-card:hover {
          transform: translateY(-3px);
          box-shadow: var(--shadow-md);
        }

        .ann-modal-image {
          display: block;
          width: 100%;
          height: clamp(100px, 20vw, 160px);
          object-fit: cover;
          background: white;
        }

        .ann-modal-image-caption {
          padding: clamp(0.5rem, 1.5vw, 0.85rem) clamp(0.6rem, 1.5vw, 1rem);
          font-size: clamp(0.7rem, 1.8vw, 0.8rem);
          font-weight: 600;
          color: var(--text-soft);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
        }

        .ann-modal-image-caption-hint {
          color: var(--primary);
          font-size: clamp(0.65rem, 1.5vw, 0.72rem);
          font-weight: 700;
          letter-spacing: 0.02em;
          white-space: nowrap;
        }

          .announcement-image-lightbox {
            position: fixed;
            inset: 0;
            z-index: 100000;
            background: rgba(8, 11, 18, 0.88);
            backdrop-filter: blur(10px);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 1.5rem;
          }

          .announcement-image-lightbox-content {
            position: relative;
            max-width: min(92vw, 1100px);
            max-height: 90vh;
            display: flex;
            align-items: center;
            justify-content: center;
          }

          .announcement-image-lightbox img {
            max-width: 100%;
            max-height: 90vh;
            border-radius: 24px;
            box-shadow: 0 30px 80px rgba(0, 0, 0, 0.45);
            object-fit: contain;
            background: white;
          }

          .announcement-image-lightbox-close {
            position: absolute;
            top: 1rem;
            right: 1rem;
            width: 42px;
            height: 42px;
            border: none;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.92);
            color: var(--text-dark);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: var(--shadow-md);
          }

          .announcement-image-lightbox-close:hover {
            background: white;
            transition: all 0.2s;
          }

          

          .message-dropdown,
          .notification-dropdown {
            width: min(285px, 86vw);
            right: -5px;
          }

          .hide-scrollbar::-webkit-scrollbar {
            display: none;
          }
          
          .hide-scrollbar {
            -ms-overflow-style: none;
            scrollbar-width: none;
          }
          
          .chat-container {
            width: 100%;
            max-width: min(370px, 92vw);
            height: min(470px, 80vh);
          }

        @media (max-width: 480px) {
          .navbar {
            padding: 0.6rem 3%;
          }

          .menu-card {
            padding: 1.35rem 1rem;
            border-radius: 20px;
          }

          .menu-btn {
            width: 100%;
            max-width: 100%;
            padding: clamp(0.5rem, 1.8vw, 0.65rem) clamp(0.5rem, 2vw, 0.8rem);
            font-size: clamp(0.72rem, 2.6vw, 0.85rem);
            font-weight: 700;
            border-radius: 30px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            box-sizing: border-box;
            display: inline-flex;
            align-items: center;
            justify-content: center;
          }
          
          .navbar-menu span {
            font-size: 0.85rem;
          }
          
          .main-content {
            padding: 1rem 3%;
          }
          
          .portal-header {
            width: 94%;
            padding: 1.4rem 0.9rem;
            margin: 0.8rem auto 1.2rem;
            border-radius: 20px;
          }

          .portal-header h2,
          .welcome-header h2 {
            font-size: 1.3rem;
            line-height: 1.25;
            margin-bottom: 0.4rem;
          }
          
          .portal-header p,
          .welcome-header p {
            font-size: 0.85rem;
          }
          
          .tab-btn {
            padding: 0.5rem 0.8rem;
            font-size: 0.8rem;
          }

          .view-btn {
            width: auto;
            padding: 0.35rem 0.85rem;
            font-size: 0.82rem;
            justify-content: center;
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
            width: min(275px, 86vw);
            right: -10px;
          }

          .chat-container {
            max-width: 92vw;
            height: min(460px, 80vh);
            border-radius: 16px;
          }

          .chat-header {
            padding: 0.65rem 0.85rem;
          }
          
          .chat-header h3 {
            font-size: 0.88rem;
          }
          
          .chat-messages {
            padding: 0.75rem;
            gap: 0.5rem;
          }
          
          .chat-input-area {
            padding: 0.5rem 0.75rem;
            gap: 0.5rem;
          }
          
          .chat-input-area input {
            padding: 0.45rem 0.75rem;
            font-size: 0.78rem;
          }
          
          .chat-input-area button {
            width: 34px;
            height: 34px;
            min-width: 34px;
            min-height: 34px;
            max-width: 34px;
            max-height: 34px;
            aspect-ratio: 1 / 1;
            flex-shrink: 0;
            font-size: 0.8rem;
          }

        /* Site Footer */
        .site-footer {
          background: rgba(79, 13, 0, 0.96);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          color: rgba(255, 255, 255, 0.85);
          padding: 1.75rem 5% 1.5rem;
          border-top: 1px solid rgba(255, 255, 255, 0.12);
          text-align: center;
          position: relative;
          z-index: 10;
          margin-top: auto;
          width: 100%;
          box-sizing: border-box;
        }

        .footer-container {
          max-width: 1200px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.6rem;
        }

        .footer-brand {
          display: inline-flex;
          align-items: center;
          gap: 0.6rem;
          text-decoration: none;
        }

        .footer-logo {
          height: 32px;
          width: auto;
          filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
        }

        .footer-brand-name {
          font-size: 1.35rem;
          font-weight: 800;
          color: white;
          letter-spacing: -0.01em;
        }

        .footer-copyright {
          font-size: 0.85rem;
          color: rgba(255, 255, 255, 0.75);
          margin: 0;
          line-height: 1.5;
        }

        @media (max-width: 480px) {
          .site-footer {
            padding: 1.25rem 4% 1rem;
          }

          .footer-logo {
            height: 26px;
          }

          .footer-brand-name {
            font-size: 1.15rem;
          }

          .footer-copyright {
            font-size: 0.75rem;
          }
        }
      `}</style>

      <nav className="navbar">
        <Link to="/portal" className="navbar-brand" onClick={() => { setMobileMenuOpen(false); setShowMessageDropdown(false); setShowNotificationDropdown(false); }}>
          <img src={iskoLogo} alt="iskoMats Logo" className="navbar-brand-logo" />
          <span className="navbar-brand-text">iskoMats</span>
        </Link>

        <div className="navbar-actions-group">
          {/* MESSAGE ICON WITH DROPDOWN - SHOW IF APPLICATIONS OR SCHOLARSHIP CHATS EXIST */}
          {(applications.length > 0 || scholarships.length > 0) && (
            <div className="message-wrapper" ref={messageDropdownRef}>
              <button
                className="message-btn"
                onClick={() => {
                  setShowNotificationDropdown(false);
                  if (!portalLocked) setShowMessageDropdown(!showMessageDropdown);
                }}
                disabled={portalLocked}
                title={portalLocked ? portalLockMessage : 'Open scholarship chats'}
              >
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
                  <button className="close-dropdown-btn" onClick={() => setShowMessageDropdown(false)}>
                    <i className="fas fa-times"></i>
                  </button>
                </div>
                <div className="message-list">
                  {scholarships.length > 0 ? (
                    scholarships.map(scholar => (
                      <div
                        key={scholar.id}
                        className={`message-item ${scholar.unread > 0 ? 'unread' : ''}`}
                        onClick={() => { setShowMessageDropdown(false); openChat(scholar.id, scholar.name); }}
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
                            fontSize: '0.75rem',
                            fontWeight: '800',
                            marginLeft: 'auto',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px',
                            boxShadow: '0 2px 8px rgba(79,13,0,0.2)'
                          }}>
                            <i className="fas fa-circle" style={{ fontSize: '0.4rem', color: '#ffcc80' }}></i> {scholar.unread}
                          </span>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="no-messages">
                      <i className="fas fa-comments"></i>
                      <span>No messages here</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* NOTIFICATION BELL WITH DROPDOWN */}
          <div className="notification-wrapper" ref={notificationDropdownRef}>
            <button
              className="notification-btn"
              onClick={() => {
                setShowMessageDropdown(false);
                if (!portalLocked) setShowNotificationDropdown(!showNotificationDropdown);
              }}
              disabled={portalLocked}
              title={portalLocked ? portalLockMessage : 'Open notifications'}
            >
              <i className="fas fa-bell"></i>
              {totalUnreadNotifications > 0 && (
                <span className="notification-badge">
                  {totalUnreadNotifications > 9 ? '9+' : totalUnreadNotifications}
                </span>
              )}
            </button>
            <div className={`notification-dropdown ${showNotificationDropdown ? 'show' : ''}`}>
              <div className="notification-header" style={{ background: 'var(--primary)', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem' }}>
                <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>Notifications</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {totalUnreadNotifications > 0 && (
                    <span className="mark-read" onClick={markAllNotificationsRead} style={{ color: 'white', opacity: 0.9, fontSize: '0.8rem', cursor: 'pointer', fontWeight: 600 }}>
                      Mark all read
                    </span>
                  )}
                  <button className="close-dropdown-btn" onClick={() => setShowNotificationDropdown(false)} style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', fontSize: '1rem', padding: '0 4px', display: 'flex', alignItems: 'center' }}>
                    <i className="fas fa-times"></i>
                  </button>
                </div>
              </div>
              <div className="notification-list">
                {notifications.length === 0 ? (
                  <div className="empty-notifications" style={{ padding: '2rem 1.2rem', textAlign: 'center' }}>
                    <i className="fas fa-bell-slash" style={{ fontSize: '1.8rem', color: '#b0c0d0', marginBottom: '0.6rem', display: 'block' }}></i>
                    <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#121826' }}>No New Notifications</div>
                    <p style={{ fontSize: '0.78rem', color: '#5a6b7d', margin: '0.3rem 0 0 0' }}>You're all caught up!</p>
                  </div>
                ) : (
                  notifications.map(notif => (
                    <div
                      key={notif.id}
                      className={`notification-item ${notif.read ? '' : 'unread'}`}
                      onClick={() => { setShowNotificationDropdown(false); handleNotificationClick(notif); }}
                    >
                      <div className="notification-icon">
                        <i className={`fas ${notif.icon}`}></i>
                      </div>
                      <div className="notification-content">
                        <div className="notification-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          {notif.title}
                          {!notif.read && <i className="fas fa-circle" style={{ color: 'var(--primary)', fontSize: '0.5rem' }}></i>}
                        </div>
                        <div className="notification-message">{notif.message}</div>
                        <div className="notification-time">{formatToLocalTime(notif.time)}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* DESKTOP USER MENU ITEMS */}
          <div className="navbar-desktop-menu">
            <div className="navbar-user-chip">
              <i className="fas fa-user-circle"></i>
              <span>{globalProfile?.first_name || userProfile?.first_name || localStorage.getItem('userFirstName') || currentUser}</span>
            </div>

            <button className="profile-btn" onClick={() => { setMobileMenuOpen(false); navigate('/profile'); }}>
              {globalProfile?.profile_picture || userProfile?.profile_picture ? (
                <img
                  src={globalProfile?.profile_picture || userProfile?.profile_picture}
                  alt="Avatar"
                  className="nav-profile-avatar"
                />
              ) : (
                <i className="fas fa-user-circle" style={{ marginRight: '6px' }}></i>
              )}
              Profile
            </button>
            <button className="logout-btn" onClick={() => { setMobileMenuOpen(false); logout(); }}>
              <i className="fas fa-sign-out-alt" style={{ marginRight: '6px' }}></i>Logout
            </button>
          </div>

          {/* MOBILE TOGGLE BUTTON */}
          <button
            className="navbar-toggle-btn"
            aria-label="Toggle navigation menu"
            onClick={() => {
              setShowMessageDropdown(false);
              setShowNotificationDropdown(false);
              setMobileMenuOpen(prev => !prev);
            }}
          >
            <i className={mobileMenuOpen ? "fas fa-times" : "fas fa-bars"}></i>
          </button>
        </div>

        {/* MOBILE SLIDE-DOWN DRAWER */}
        <div className={`navbar-menu ${mobileMenuOpen ? 'active' : ''}`}>
          <div className="navbar-user-chip">
            <i className="fas fa-user-circle"></i>
            <span>{globalProfile?.first_name || userProfile?.first_name || localStorage.getItem('userFirstName') || currentUser}</span>
          </div>

          <button className="profile-btn" onClick={() => { setMobileMenuOpen(false); navigate('/profile'); }}>
            {globalProfile?.profile_picture || userProfile?.profile_picture ? (
              <img
                src={globalProfile?.profile_picture || userProfile?.profile_picture}
                alt="Avatar"
                className="nav-profile-avatar"
              />
            ) : (
              <i className="fas fa-user-circle" style={{ marginRight: '6px' }}></i>
            )}
            Profile
          </button>
          <button className="logout-btn" onClick={() => { setMobileMenuOpen(false); logout(); }}>
            <i className="fas fa-sign-out-alt" style={{ marginRight: '6px' }}></i>Logout
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
            {currentRoomMessages.length > 0 ? (
              currentRoomMessages.map((msg, index) => (
                <div key={msg.m_id || msg.id || index} className={`message-bubble ${msg.type}`}>
                  {msg.type === 'received' && (
                    <div className="sender">{msg.sender}</div>
                  )}
                  <div>{msg.message}</div>
                  <div className="time">{formatToLocalTime(msg.time) || msg.time}</div>
                </div>
              ))
            ) : (
              <div className="no-messages">
                <i className="fas fa-comments"></i>
                <span>No messages yet</span>
              </div>
            )}
            <div ref={chatMessagesEndRef} />
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

      {/* Announcement Detail Modal */}
      {showAnnouncementModal && selectedAnnouncement && (
        <div
          className="announcement-modal-overlay"
          onClick={closeAnnouncementModal}
        >
          <div
            className="announcement-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ann-modal-header">
              <button className="ann-modal-close" onClick={closeAnnouncementModal}>
                <i className="fas fa-times"></i>
              </button>
              <div className="ann-modal-provider">
                <div className="provider-icon">
                  <i className="fas fa-bullhorn"></i>
                </div>
                <span className="provider-name">{selectedAnnouncement.announcementProvider}</span>
              </div>
              <h2 className="ann-modal-title">{selectedAnnouncement.announcementTitle}</h2>
              <div className="ann-modal-meta">
                <span style={{ background: 'var(--accent-soft)', padding: '0.2rem 0.6rem', borderRadius: '6px', color: 'var(--primary)', fontWeight: '700' }}>
                  <i className="fas fa-hashtag" style={{ marginRight: '8px' }}></i>
                  {selectedAnnouncement.announcementId}
                </span>
                <span>
                  <i className="far fa-calendar-alt" style={{ marginRight: '8px' }}></i>
                  Posted on {selectedAnnouncement.postedAt ? new Date(selectedAnnouncement.postedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Recently'}
                </span>
                <span>
                  <i className="far fa-user" style={{ marginRight: '8px' }}></i>
                  {selectedAnnouncement.announcementProvider}
                </span>
              </div>
            </div>
            <div className="ann-modal-body">
              <div className="ann-modal-message">
                {selectedAnnouncement.announcementMessage}
              </div>
              {selectedAnnouncement.announcementImages?.length > 0 && (
                <div className="ann-modal-gallery">
                  {selectedAnnouncement.announcementImages.map((image, index) => {
                    const imageSrc = ensureAbsoluteUrl(typeof image === 'string' ? image : image?.url);

                    if (!imageSrc) {
                      return null;
                    }

                    const imageAlt = `${selectedAnnouncement.ann_title || 'Announcement'} image ${index + 1}`;

                    return (
                      <button
                        key={`${selectedAnnouncement.ann_no || selectedAnnouncement.ann_title || 'announcement'}-${index}`}
                        type="button"
                        className="ann-modal-image-card"
                        onClick={() => openAnnouncementImage(imageSrc, imageAlt)}
                      >
                        <img
                          src={imageSrc}
                          alt={imageAlt}
                          className="ann-modal-image"
                        />
                        <div className="ann-modal-image-caption">
                          <span>Announcement image {index + 1}</span>
                          <span className="ann-modal-image-caption-hint">Click to enlarge</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              <div style={{ marginTop: 'clamp(1.2rem, 3vw, 2rem)', padding: 'clamp(0.8rem, 2vw, 1.2rem)', background: 'var(--gray-1)', borderRadius: 'clamp(12px, 3vw, 18px)', display: 'flex', alignItems: 'center', gap: 'clamp(0.6rem, 1.5vw, 0.85rem)' }}>
                <div style={{ width: 'clamp(32px, 6vw, 42px)', height: 'clamp(32px, 6vw, 42px)', background: 'white', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', boxShadow: 'var(--shadow-sm)', fontSize: 'clamp(0.8rem, 2vw, 1rem)', flexShrink: 0 }}>
                  <i className="fas fa-info-circle"></i>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h4 style={{ fontSize: 'clamp(0.75rem, 2vw, 0.85rem)', color: 'var(--text-dark)', marginBottom: '0.15rem' }}>Need more information?</h4>
                  <p style={{ fontSize: 'clamp(0.68rem, 1.8vw, 0.78rem)', color: 'var(--text-soft)', lineHeight: '1.45' }}>You can contact the scholarship provider directly via the chat feature linked to your application.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedAnnouncementImage && (
        <div className="announcement-image-lightbox" onClick={closeAnnouncementImage}>
          <div className="announcement-image-lightbox-content" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="announcement-image-lightbox-close" onClick={closeAnnouncementImage}>
              <i className="fas fa-times"></i>
            </button>
            <img src={selectedAnnouncementImage.src} alt={selectedAnnouncementImage.alt} />
          </div>
        </div>
      )}



      {/* Portal */}
      <section className="portal">
        <div className="portal-header">
          <h2>Welcome back, {userProfile?.fullName?.split(' ')[0] || 'Student'}</h2>
          <p>Your personalized scholarship dashboard</p>
        </div>
        <div className="portal-content">
          {portalLocked && (
            <div style={{
              marginBottom: '1.5rem',
              padding: '1rem 1.2rem',
              borderRadius: '18px',
              border: '1px solid #fca5a5',
              background: 'linear-gradient(135deg, #fff1f2, #ffffff)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.9rem',
              color: '#991b1b'
            }}>
              <div style={{
                width: '42px',
                height: '42px',
                borderRadius: '50%',
                background: '#fee2e2',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <i className="fas fa-user-lock"></i>
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: '0.2rem' }}>{portalLockMessage}</div>
                <div style={{ fontSize: '0.88rem', lineHeight: '1.5' }}>Only your Profile remains available while this account is restricted.</div>
              </div>
            </div>
          )}
          {activeSection === 'menu' && (
            <div className="portal-menu">
              <div className="menu-card">
                <h3>Find Scholarships</h3>
                <p>Discover personalized scholarship opportunities that match your profile and qualifications.</p>
                {portalLocked ? (
                  <button className="menu-btn" disabled style={{ cursor: 'not-allowed', opacity: 0.7 }}>{portalLockMessage}</button>
                ) : (
                  <Link to="/findscholarship" className="menu-btn">Get Started</Link>
                )}
              </div>
              <div className="menu-card">
                <h3>My Applications</h3>
                <p>Track and manage your scholarship applications in one convenient location.</p>
                <button className="menu-btn" onClick={() => setPortalSection('applications')} disabled={portalLocked} style={portalLocked ? { cursor: 'not-allowed', opacity: 0.7 } : undefined}>View Applications</button>
              </div>
              <div className="menu-card">
                <h3>Community</h3>
                <p>Connect with other students, mentors, and scholarship providers.</p>
                <button className="menu-btn" onClick={() => setPortalSection('community')} disabled={portalLocked} style={portalLocked ? { cursor: 'not-allowed', opacity: 0.7 } : undefined}>Join Community</button>
              </div>
              <div className="menu-card">
                <h3>Resources</h3>
                <p>Access guides, templates, and tools to strengthen your applications.</p>
                <button className="menu-btn" onClick={() => setPortalSection('resources')} disabled={portalLocked} style={portalLocked ? { cursor: 'not-allowed', opacity: 0.7 } : undefined}>Browse Resources</button>
              </div>
            </div>
          )}

          {/* applications */}
          {activeSection === 'applications' && (
            <div className="content-section active">
              <button className="back-button" onClick={() => setPortalSection('menu')}>
                <i className="fas fa-arrow-left"></i> Back
              </button>
              <h3 style={{ color: 'var(--primary)', fontSize: 'clamp(1.1rem, 3vw, 1.4rem)', fontWeight: '800', marginBottom: 'clamp(0.8rem, 2vw, 1.2rem)' }}>Ongoing Applications</h3>
              <div className="application-list">
                {applications.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-soft)' }}>
                    <i className="fas fa-folder-open" style={{ fontSize: '3rem', color: 'var(--gray-3)', marginBottom: '1rem', display: 'block' }}></i>
                    <p style={{ marginBottom: '1rem' }}>You haven't submitted any scholarship applications yet.</p>
                    <Link to="/findscholarship" className="menu-btn" style={{ textDecoration: 'none', color: 'white', display: 'inline-block' }}>
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
                          <p style={{ color: '#a0b0c0' }}>
                            Deadline: {app.deadline ? new Date(app.deadline).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A'}
                          </p>
                        </div>
                        <div className="application-actions">
                          <span className={`status-badge ${badgeClass}`}>{app.status}</span>
                          <button className="view-btn" onClick={() => handleViewApplication(app)}>
                            <i className="fas fa-eye"></i> View
                          </button>
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
              <button className="back-button" onClick={() => setPortalSection('menu')}>
                <i className="fas fa-arrow-left"></i> Back
              </button>

              <div className="section-header-row">
                <h3>Announcements</h3>
                <button
                  className="section-header-btn"
                  onClick={() => document.getElementById('events-calendar-section')?.scrollIntoView({ behavior: 'smooth' })}
                >
                  <i className="fas fa-calendar-alt"></i> View Calendar
                </button>
              </div>
              {/* Announcements Search Bar */}
              <div className="announcement-search-wrapper" style={{
                marginBottom: '1.25rem',
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                width: '100%'
              }}>
                <i className="fas fa-search" style={{
                  position: 'absolute',
                  left: '1rem',
                  color: 'var(--text-soft)',
                  fontSize: '0.9rem',
                  pointerEvents: 'none'
                }}></i>
                <input
                  type="text"
                  className="announcement-search-input"
                  placeholder="Search announcements by title, provider, or content..."
                  value={announcementSearchQuery}
                  onChange={(e) => setAnnouncementSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.7rem 2.6rem 0.7rem 2.6rem',
                    borderRadius: '12px',
                    border: '1px solid var(--border-light)',
                    background: 'var(--white)',
                    fontSize: 'clamp(0.8rem, 1.8vw, 0.9rem)',
                    color: 'var(--text-dark)',
                    boxShadow: 'var(--shadow-sm)',
                    outline: 'none',
                    transition: 'all 0.2s ease'
                  }}
                />
                {announcementSearchQuery && (
                  <button
                    onClick={() => setAnnouncementSearchQuery('')}
                    style={{
                      position: 'absolute',
                      right: '0.75rem',
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-soft)',
                      cursor: 'pointer',
                      padding: '0.3rem 0.5rem',
                      fontSize: '0.85rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '50%',
                      transition: 'color 0.2s'
                    }}
                    title="Clear search"
                  >
                    <i className="fas fa-times"></i>
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
                {(() => {
                  const filteredAnnouncements = dbAnnouncements.filter((ann) => {
                    if (!announcementSearchQuery.trim()) return true;
                    const query = announcementSearchQuery.toLowerCase().trim();
                    const title = (ann.ann_title || '').toLowerCase();
                    const provider = (ann.provider_name || '').toLowerCase();
                    const message = (ann.ann_message || '').toLowerCase();
                    return title.includes(query) || provider.includes(query) || message.includes(query);
                  });

                  if (filteredAnnouncements.length > 0) {
                    return filteredAnnouncements.map((ann, idx) => (
                      <div
                        key={ann.ann_no || idx}
                        className="community-post"
                        style={{ borderLeft: '3px solid var(--primary)', padding: 'clamp(0.75rem, 2vw, 1.1rem)' }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.6rem' }}>
                          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                            <h4 style={{ margin: 0, color: 'var(--primary)', fontSize: 'clamp(0.65rem, 1.6vw, 0.75rem)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{ann.provider_name}</h4>
                            {ann.ann_title && (
                              <h5 style={{ margin: '0.2rem 0 0 0', color: 'var(--text-dark)', fontSize: 'clamp(0.88rem, 2.2vw, 1.05rem)', fontWeight: '700', lineHeight: '1.35', wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                                {ann.ann_title}
                                {(() => {
                                  const createdDate = new Date(ann.time_added || 0);
                                  const diffDays = (new Date() - createdDate) / (1000 * 60 * 60 * 24);
                                  return diffDays <= 3 ? (
                                    <span style={{
                                      background: 'linear-gradient(90deg, #ff9800 60%, #ffcc80 100%)',
                                      color: '#fff',
                                      fontWeight: 900,
                                      fontSize: 'clamp(0.55rem, 1.2vw, 0.62rem)',
                                      borderRadius: '6px',
                                      padding: '2px 8px',
                                      marginLeft: '8px',
                                      letterSpacing: '0.5px',
                                      boxShadow: '0 2px 6px rgba(255,152,0,0.2)',
                                      textTransform: 'uppercase',
                                      display: 'inline-block',
                                      verticalAlign: 'middle'
                                    }}>NEW</span>
                                  ) : null;
                                })()}
                              </h5>
                            )}
                          </div>
                          <span style={{ fontSize: 'clamp(0.62rem, 1.5vw, 0.7rem)', color: 'var(--text-soft)', background: 'var(--gray-2)', padding: '0.2rem 0.5rem', borderRadius: '20px', fontWeight: '600', whiteSpace: 'nowrap', flexShrink: 0 }}>
                            <i className="far fa-clock" style={{ marginRight: '5px' }}></i>
                            {ann.time_added ? formatToLocalTime(ann.time_added) : 'Recent'}
                          </span>
                        </div>
                        <p style={{ marginBottom: '0.6rem', color: 'var(--text-soft)', fontSize: 'clamp(0.78rem, 1.8vw, 0.85rem)', lineHeight: '1.5', display: '-webkit-box', WebkitLineClamp: '3', WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {ann.ann_message}
                        </p>

                        {/* Compact Image Preview for the List Card */}
                        {ann.announcementImages?.length > 0 && (
                          <div style={{
                            display: 'flex',
                            gap: '8px',
                            overflowX: 'auto',
                            paddingBottom: '0.8rem',
                            marginBottom: '0.8rem',
                            scrollbarWidth: 'none',
                            msOverflowStyle: 'none'
                          }} className="hide-scrollbar">
                            {ann.announcementImages.map((image, i) => {
                              const imageSrc = ensureAbsoluteUrl(typeof image === 'string' ? image : image?.url);
                              if (!imageSrc) return null;
                              const imageAlt = `Image ${i + 1} of ${ann.ann_title || 'Announcement'}`;

                              return (
                                <img
                                  key={i}
                                  src={imageSrc}
                                  alt={imageAlt}
                                  onClick={(e) => {
                                    e.stopPropagation(); // Don't trigger the card's openAnnouncement
                                    openAnnouncementImage(imageSrc, imageAlt);
                                  }}
                                  style={{
                                    height: '80px',
                                    width: 'auto',
                                    maxWidth: '120px',
                                    borderRadius: '8px',
                                    objectFit: 'cover',
                                    cursor: 'zoom-in',
                                    border: '1px solid var(--border-light)',
                                    transition: 'transform 0.2s',
                                    backgroundColor: '#f8f9fa'
                                  }}
                                  onMouseEnter={(e) => e.target.style.transform = 'scale(1.05)'}
                                  onMouseLeave={(e) => e.target.style.transform = 'scale(1)'}
                                />
                              );
                            })}
                          </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.6rem' }}>
                          <button
                            className="card-action-btn"
                            onClick={() => openAnnouncement(ann)}
                          >
                            <i className="far fa-eye"></i> View Details
                          </button>
                        </div>
                      </div>
                    ));
                  }

                  if (dbAnnouncements.length > 0) {
                    return (
                      <div style={{ textAlign: 'center', padding: '2.5rem 1rem', background: 'white', borderRadius: '12px', border: '1px solid var(--border-light)' }}>
                        <i className="fas fa-search" style={{ fontSize: '2rem', color: 'var(--text-soft)', marginBottom: '0.75rem', display: 'block' }}></i>
                        <p style={{ fontWeight: '600', color: 'var(--text-dark)', margin: '0 0 0.4rem 0' }}>No matching announcements found</p>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-soft)', margin: '0 0 1rem 0' }}>No results found for "{announcementSearchQuery}".</p>
                        <button
                          onClick={() => setAnnouncementSearchQuery('')}
                          className="card-action-btn"
                          style={{ display: 'inline-flex' }}
                        >
                          Clear Search
                        </button>
                      </div>
                    );
                  }

                  return (
                    <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-soft)' }}>
                      <i className="fas fa-bullhorn" style={{ fontSize: '2rem', marginBottom: '1rem', display: 'block' }}></i>
                      <p>No announcements at this time.</p>
                    </div>
                  );
                })()}
              </div>

              <h3 id="events-calendar-section" style={{ color: 'var(--primary)', marginBottom: 'clamp(0.8rem, 2vw, 1.2rem)', fontSize: 'clamp(1.1rem, 3vw, 1.4rem)', paddingTop: '0.75rem' }}>
                Events Calendar
              </h3>
              <div style={{ background: 'white', borderRadius: 'clamp(10px, 2vw, 16px)', padding: 'clamp(0.85rem, 2vw, 1.4rem)', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border-light)' }}>
                {/* Calendar Navigation */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'clamp(0.6rem, 1.5vw, 1rem)' }}>
                  <div style={{ display: 'flex', gap: 'clamp(0.2rem, 0.8vw, 0.5rem)' }}>
                    <button
                      onClick={() => navigateYear('prev')}
                      style={{ background: 'none', border: 'none', fontSize: 'clamp(0.8rem, 2vw, 1rem)', cursor: 'pointer', color: 'var(--text-soft)', padding: 'clamp(0.15rem, 0.5vw, 0.3rem)' }}
                      title="Previous Year"
                    >
                      <i className="fas fa-angle-double-left"></i>
                    </button>
                    <button
                      onClick={() => navigateMonth('prev')}
                      style={{ background: 'none', border: 'none', fontSize: 'clamp(0.9rem, 2.2vw, 1.15rem)', cursor: 'pointer', color: 'var(--text-soft)', padding: 'clamp(0.15rem, 0.5vw, 0.3rem)' }}
                      title="Previous Month"
                    >
                      <i className="fas fa-chevron-left"></i>
                    </button>
                  </div>
                  <h4 style={{ margin: 0, fontSize: 'clamp(0.88rem, 2.5vw, 1.1rem)', color: '#333', fontWeight: '700' }}>{getMonthName(currentDate)}</h4>
                  <div style={{ display: 'flex', gap: 'clamp(0.2rem, 0.8vw, 0.5rem)' }}>
                    <button
                      onClick={() => navigateMonth('next')}
                      style={{ background: 'none', border: 'none', fontSize: 'clamp(0.9rem, 2.2vw, 1.15rem)', cursor: 'pointer', color: 'var(--text-soft)', padding: 'clamp(0.15rem, 0.5vw, 0.3rem)' }}
                      title="Next Month"
                    >
                      <i className="fas fa-chevron-right"></i>
                    </button>
                    <button
                      onClick={() => navigateYear('next')}
                      style={{ background: 'none', border: 'none', fontSize: 'clamp(0.8rem, 2vw, 1rem)', cursor: 'pointer', color: 'var(--text-soft)', padding: 'clamp(0.15rem, 0.5vw, 0.3rem)' }}
                      title="Next Year"
                    >
                      <i className="fas fa-angle-double-right"></i>
                    </button>
                  </div>
                </div>

                {/* Today Button */}
                <div style={{ textAlign: 'center', marginBottom: 'clamp(0.5rem, 1.5vw, 0.8rem)' }}>
                  <button
                    onClick={goToToday}
                    style={{
                      background: 'var(--primary)',
                      color: 'white',
                      border: 'none',
                      padding: 'clamp(0.25rem, 0.8vw, 0.35rem) clamp(0.6rem, 1.5vw, 0.85rem)',
                      borderRadius: '20px',
                      fontSize: 'clamp(0.72rem, 1.8vw, 0.82rem)',
                      cursor: 'pointer',
                      boxShadow: '0 2px 4px rgba(79,13,0,0.15)'
                    }}
                  >
                    Today
                  </button>
                </div>

                {/* Calendar Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 'clamp(0.15rem, 0.6vw, 0.35rem)', textAlign: 'center', marginBottom: 'clamp(0.2rem, 0.5vw, 0.4rem)', fontWeight: '600', fontSize: 'clamp(0.68rem, 1.8vw, 0.8rem)', color: 'var(--text-soft)' }}>
                  <div>Su</div><div>Mo</div><div>Tu</div><div>We</div><div>Th</div><div>Fr</div><div>Sa</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 'clamp(0.15rem, 0.6vw, 0.35rem)', textAlign: 'center', fontSize: 'clamp(0.75rem, 2vw, 0.88rem)' }}>
                  {generateCalendarDays().map((day, index) => {
                    const event = day ? getEventsForDate(day) : null;
                    const isToday = day === new Date().getDate() &&
                      currentDate.getMonth() === new Date().getMonth() &&
                      currentDate.getFullYear() === new Date().getFullYear();

                    if (!day) {
                      return <div key={index} style={{ padding: 'clamp(0.3rem, 0.8vw, 0.5rem)', color: '#ccc' }}></div>;
                    }

                    let dayStyle = { padding: 'clamp(0.3rem, 0.8vw, 0.5rem)', cursor: 'pointer', borderRadius: 'clamp(4px, 1vw, 8px)', transition: 'all 0.2s' };

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
                        onClick={() => {
                          if (event) {
                            // Show event title or perform action
                            setStatusInfo({
                              title: 'Calendar Event',
                              message: event.title,
                              isError: false
                            });
                            setShowStatusModal(true);
                          } else {
                            // Feedback for non-event days
                            setStatusInfo({
                              title: 'No Events',
                              message: `No scholarship deadlines or events scheduled for ${getMonthName(currentDate)} ${day}.`,
                              isError: false
                            });
                            setShowStatusModal(true);
                          }
                        }}
                        onMouseEnter={(e) => {
                          if (!event) {
                            e.target.style.background = 'var(--gray-1)';
                          } else {
                            e.target.style.transform = 'scale(1.1)';
                            e.target.style.zIndex = '10';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!event && !isToday) {
                            e.target.style.background = 'transparent';
                          }
                          if (event) {
                            e.target.style.transform = 'scale(1)';
                          }
                        }}
                      >
                        {day}
                      </div>
                    );
                  })}
                </div>
                {/* Dynamic Events Legend */}
                <div style={{ marginTop: 'clamp(1rem, 2.5vw, 1.5rem)', display: 'flex', flexDirection: 'column', gap: 'clamp(0.4rem, 1vw, 0.6rem)', fontSize: 'clamp(0.75rem, 1.8vw, 0.85rem)', paddingTop: 'clamp(0.8rem, 2vw, 1.2rem)', borderTop: '1px solid var(--border-light)' }}>
                  <p style={{ fontSize: 'clamp(0.68rem, 1.6vw, 0.78rem)', color: 'var(--text-soft)', fontWeight: '600', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Upcoming Deadlines & Events</p>

                  {/* Dynamic Scholarship Deadlines */}
                  {resources.filter(s => {
                    if (!s.deadline) return false;
                    const d = new Date(s.deadline);
                    return d.getMonth() === currentDate.getMonth() && d.getFullYear() === currentDate.getFullYear();
                  }).sort((a, b) => new Date(a.deadline) - new Date(b.deadline)).map((s, idx) => (
                    <div key={`deadline-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 'clamp(0.4rem, 1vw, 0.6rem)', fontWeight: '600', color: 'var(--text-dark)', fontSize: 'clamp(0.72rem, 1.8vw, 0.82rem)' }}>
                      <span style={{ width: 'clamp(10px, 2vw, 14px)', height: 'clamp(10px, 2vw, 14px)', borderRadius: '3px', background: 'var(--accent-soft)', border: '2px solid var(--primary)', flexShrink: 0 }}></span>
                      Deadline: {s.scholarship_name || s.name} &mdash; {new Date(s.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                  ))}

                  {resources.filter(s => {
                    if (!s.deadline) return false;
                    const d = new Date(s.deadline);
                    return d.getMonth() === currentDate.getMonth() && d.getFullYear() === currentDate.getFullYear();
                  }).length === 0 && (
                      <p style={{ fontSize: 'clamp(0.72rem, 1.8vw, 0.82rem)', color: '#999', fontStyle: 'italic', marginTop: '0.3rem' }}>No scheduled deadlines for this month.</p>
                    )}
                </div>
              </div>
            </div>
          )}

          {/* resources */}
          {activeSection === 'resources' && (
            <div className="content-section active">
              <button className="back-button" onClick={() => setPortalSection('menu')}>
                <i className="fas fa-arrow-left"></i> Back
              </button>
              <h3 style={{ color: 'var(--primary)', fontSize: 'clamp(1.1rem, 3vw, 1.4rem)', fontWeight: '800', marginBottom: 'clamp(0.8rem, 2vw, 1.2rem)' }}>
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
                            style={{ marginRight: '10px', color: 'var(--primary)' }}
                          ></i>
                          {res.scholarship_name}
                          {(() => {
                            const createdDate = new Date(res.dateCreated || res.date_created || 0);
                            const diffDays = (new Date() - createdDate) / (1000 * 60 * 60 * 24);
                            return diffDays <= 3 ? (
                              <span style={{
                                background: 'linear-gradient(90deg, #ff9800 60%, #ffcc80 100%)',
                                color: '#fff',
                                fontWeight: 900,
                                fontSize: '0.65rem',
                                borderRadius: '8px',
                                padding: '1px 8px',
                                marginLeft: '10px',
                                letterSpacing: '0.5px',
                                boxShadow: '0 2px 6px rgba(255,152,0,0.2)',
                                textTransform: 'uppercase'
                              }}>NEW</span>
                            ) : null;
                          })()}
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
                  <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-soft)' }}>
                    <i className="fas fa-spinner fa-spin" style={{ fontSize: '2rem', marginBottom: '1rem' }}></i>
                    <p>Loading scholarship resources...</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Cancellation Confirmation Modal */}
      {showCancelConfirm && (
        <div className="loading-overlay active">
          <div className="loading-modal">
            <i className="fas fa-exclamation-triangle" style={{ fontSize: '3.5rem', color: '#e67e22', marginBottom: '1.5rem', display: 'block' }}></i>
            <h3 style={{ color: 'var(--primary)', fontWeight: '800', fontSize: '1.8rem', marginBottom: '1rem' }}>
              Confirm Cancellation
            </h3>
            <p style={{ color: 'var(--text-soft)', fontSize: '1.05rem', lineHeight: '1.6' }}>
              Are you sure you want to cancel your application for <br />
              <strong style={{ color: 'var(--text-dark)' }}>"{pendingCancel?.scholarshipName}"</strong>?
            </p>
            <div className="modal-buttons">
              <button className="modal-btn modal-btn-secondary" onClick={() => setShowCancelConfirm(false)}>
                No, Keep it
              </button>
              <button className="modal-btn modal-btn-primary" onClick={handleConfirmCancel}>
                Yes, Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success/Error Status Modal */}
      {showStatusModal && (
        <div className="loading-overlay active">
          <div className="loading-modal">
            <i
              className={`fas ${statusInfo.isError ? 'fa-times-circle' : 'fa-check-circle'}`}
              style={{
                fontSize: '4rem',
                color: statusInfo.isError ? '#e74c3c' : '#27ae60',
                marginBottom: '1.5rem',
                display: 'block'
              }}
            ></i>
            <h3 style={{ color: 'var(--primary)', fontWeight: '800', fontSize: '1.8rem', marginBottom: '1rem' }}>
              {statusInfo.title}
            </h3>
            <p style={{ color: 'var(--text-soft)', fontSize: '1.05rem', lineHeight: '1.6' }}>
              {statusInfo.message}
            </p>
            <div className="modal-buttons">
              <button
                className="modal-btn modal-btn-primary"
                onClick={() => setShowStatusModal(false)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      {/* View Application Detail Modal */}
      {showViewModal && selectedAppForView && (
        <div className="view-modal-overlay" onClick={closeViewModal}>
          <div className="view-modal" onClick={(e) => e.stopPropagation()}>
            <div className="view-modal-header">
              <div className="view-modal-title">
                <h2>Application Details</h2>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-soft)' }}>
                  For: <strong>{selectedAppForView?.name}</strong>
                </p>
              </div>
              <button className="view-modal-close" onClick={closeViewModal}>
                <i className="fas fa-times"></i>
              </button>
            </div>

            {/* Tab Navigation Buttons */}
            <div style={{
              display: 'flex',
              gap: '0.5rem',
              padding: '0.8rem 1.2rem 0',
              borderBottom: '1px solid var(--gray-2)',
              background: '#f8fafc'
            }}>
              <button
                type="button"
                onClick={() => setViewModalTab('summary')}
                style={{
                  flex: 1,
                  padding: '0.65rem 1rem',
                  border: 'none',
                  borderBottom: viewModalTab === 'summary' ? '3px solid var(--primary)' : '3px solid transparent',
                  background: viewModalTab === 'summary' ? 'white' : 'transparent',
                  color: viewModalTab === 'summary' ? 'var(--primary)' : 'var(--text-soft)',
                  fontWeight: viewModalTab === 'summary' ? 700 : 600,
                  fontSize: '0.88rem',
                  borderRadius: '8px 8px 0 0',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  transition: 'all 0.2s'
                }}
              >
                <i className="fas fa-file-alt"></i> Application Summary
              </button>
              <button
                type="button"
                onClick={() => setViewModalTab('details')}
                style={{
                  flex: 1,
                  padding: '0.65rem 1rem',
                  border: 'none',
                  borderBottom: viewModalTab === 'details' ? '3px solid var(--primary)' : '3px solid transparent',
                  background: viewModalTab === 'details' ? 'white' : 'transparent',
                  color: viewModalTab === 'details' ? 'var(--primary)' : 'var(--text-soft)',
                  fontWeight: viewModalTab === 'details' ? 700 : 600,
                  fontSize: '0.88rem',
                  borderRadius: '8px 8px 0 0',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  transition: 'all 0.2s'
                }}
              >
                <i className="fas fa-user-check"></i> Student Profile & Documents
              </button>
            </div>

            <div className="view-modal-content">
              {viewModalTab === 'summary' ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', marginBottom: '1.2rem' }}>
                    <span className={`status-badge ${selectedAppForView.status === 'Approved' || selectedAppForView.status === 'Accepted'
                        ? 'status-approved'
                        : selectedAppForView.status === 'Rejected'
                          ? 'status-rejected'
                          : 'status-pending'
                      }`}>
                      {selectedAppForView.status}
                    </span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-soft)', fontWeight: 600 }}>
                      Application #{selectedAppForView.scholarship_no || selectedAppForView.req_no}
                    </span>
                  </div>

                  <h3 style={{ color: 'var(--primary)', fontSize: '1.4rem', fontWeight: '800', marginBottom: '0.4rem', lineHeight: '1.3' }}>
                    {selectedAppForView.name}
                  </h3>

                  <p style={{ color: 'var(--text-soft)', fontSize: '0.92rem', fontWeight: '600', marginBottom: '1.5rem' }}>
                    <i className="fas fa-building" style={{ marginRight: '8px', color: 'var(--primary)' }}></i>
                    {selectedAppForView.provider_name || selectedAppForView.sponsor || 'Scholarship Provider'}
                  </p>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '1rem', marginBottom: '1.5rem', background: 'var(--gray-1)', padding: '1.2rem', borderRadius: '18px' }}>
                    <div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-soft)', display: 'block', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px' }}>Financial Grant</span>
                      <span style={{ fontWeight: 800, color: 'var(--primary)', fontSize: '1.05rem' }}>{selectedAppForView.amount || 'Standard Stipend'}</span>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-soft)', display: 'block', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px' }}>Date Applied</span>
                      <span style={{ fontWeight: 700, color: 'var(--text-dark)' }}>{selectedAppForView.applied_date || 'Recently'}</span>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-soft)', display: 'block', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px' }}>Deadline</span>
                      <span style={{ fontWeight: 700, color: 'var(--text-dark)' }}>{selectedAppForView.deadline || 'N/A'}</span>
                    </div>
                  </div>

                  {selectedAppForView.remarks && (
                    <div style={{
                      marginBottom: '1.5rem',
                      background: selectedAppForView.status === 'Accepted' || selectedAppForView.status === 'Approved' ? '#e1f7f0' : 'var(--warning-bg)',
                      padding: '1.2rem',
                      borderRadius: '16px',
                      borderLeft: selectedAppForView.status === 'Accepted' || selectedAppForView.status === 'Approved' ? '4px solid var(--success)' : '4px solid var(--warning)'
                    }}>
                      <h4 style={{
                        color: selectedAppForView.status === 'Accepted' || selectedAppForView.status === 'Approved' ? 'var(--success)' : 'var(--warning)',
                        fontSize: '0.95rem',
                        fontWeight: 800,
                        marginBottom: '0.4rem'
                      }}>
                        <i className={selectedAppForView.status === 'Accepted' || selectedAppForView.status === 'Approved' ? 'fas fa-check-circle' : 'fas fa-info-circle'} style={{ marginRight: '6px' }}></i>
                        Application Remarks & Status Updates
                      </h4>
                      <p style={{ fontSize: '0.9rem', color: 'var(--text-dark)', lineHeight: '1.6', margin: 0 }}>
                        {selectedAppForView.remarks}
                      </p>
                    </div>
                  )}

                  {selectedAppForView.submitted_documents && selectedAppForView.submitted_documents.length > 0 && (
                    <div style={{ marginBottom: '1.5rem' }}>
                      <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-dark)', marginBottom: '0.6rem' }}>
                        Submitted Documents & Requirements
                      </h4>
                      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {selectedAppForView.submitted_documents.map((doc, idx) => (
                          <li key={idx} style={{ background: 'var(--gray-1)', padding: '0.7rem 1rem', borderRadius: '12px', fontSize: '0.85rem', color: 'var(--text-dark)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <i className="fas fa-file-check" style={{ color: 'var(--success)' }}></i>
                            {doc}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* Applicant Details */}
                  <div className="view-section">
                    <div className="view-section-title">
                      <i className="fas fa-user-circle"></i> Applicant Details
                    </div>
                    <div className="view-grid">
                      <div className="view-item">
                        <label>Full Name</label>
                        <div className="value">{userProfile?.first_name} {userProfile?.middle_name} {userProfile?.last_name}</div>
                      </div>
                      <div className="view-item">
                        <label>Sex</label>
                        <div className="value" style={{ textTransform: 'capitalize' }}>{userProfile?.sex}</div>
                      </div>
                      <div className="view-item">
                        <label>Birth Date</label>
                        <div className="value">{userProfile?.birthdate}</div>
                      </div>
                      <div className="view-item">
                        <label>Mobile Number</label>
                        <div className="value">{userProfile?.mobile_no}</div>
                      </div>
                      <div className="view-item" style={{ gridColumn: 'span 2' }}>
                        <label>Home Address / Contact Location</label>
                        <div className="value">
                          {[
                            userProfile?.street_brgy || userProfile?.streetBarangay || userProfile?.streetBrgy,
                            userProfile?.town_city_municipality || userProfile?.townCity || userProfile?.municipality,
                            userProfile?.province,
                            userProfile?.zip_code || userProfile?.zipCode
                          ].filter(Boolean).join(', ') || '—'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Academic Information */}
                  <div className="view-section">
                    <div className="view-section-title">
                      <i className="fas fa-graduation-cap"></i> Academic Information
                    </div>
                    <div className="view-grid">
                      <div className="view-item" style={{ gridColumn: 'span 2' }}>
                        <label>School Name</label>
                        <div className="value">{userProfile?.school}</div>
                      </div>
                      <div className="view-item">
                        <label>School ID Number</label>
                        <div className="value">{userProfile?.school_id_no}</div>
                      </div>
                      <div className="view-item">
                        <label>Course / Program</label>
                        <div className="value">{userProfile?.course}</div>
                      </div>
                      <div className="view-item">
                        <label>Year Level</label>
                        <div className="value">{userProfile?.year_lvl}</div>
                      </div>
                      <div className="view-item">
                        <label>Overall GPA</label>
                        <div className="value">{userProfile?.overall_gpa}</div>
                      </div>
                    </div>
                  </div>

                  {/* Family Background */}
                  <div className="view-section">
                    <div className="view-section-title">
                      <i className="fas fa-users"></i> Family Background
                    </div>
                    <div className="view-grid">
                      <div className="view-item">
                        <label>Father's Name</label>
                        <div className="value">{userProfile?.father_name}</div>
                      </div>
                      <div className="view-item">
                        <label>Mother's Name</label>
                        <div className="value">{userProfile?.mother_name}</div>
                      </div>
                      <div className="view-item">
                        <label>Parents' Gross Income</label>
                        <div className="value">₱{Number(userProfile?.financial_income_of_parents || 0).toLocaleString()}</div>
                      </div>
                      <div className="view-item">
                        <label>Number of Siblings</label>
                        <div className="value">{userProfile?.sibling_no}</div>
                      </div>
                    </div>
                  </div>

                  {/* Submitted Documents */}
                  <div className="view-section">
                    <div className="view-section-title">
                      <i className="fas fa-file-contract"></i> Submitted Documents
                    </div>
                    <div className="doc-gallery">
                      {userProfile?.profile_picture && (
                        <div className="doc-card" onClick={() => window.open(ensureAbsoluteUrl(userProfile.profile_picture))}>
                          <div className="doc-icon"><i className="fas fa-user-image"></i></div>
                          <div className="doc-name">Profile Picture</div>
                          <div className="doc-status available">View File</div>
                        </div>
                      )}
                      {userProfile?.id_img_front && (
                        <div className="doc-card" onClick={() => window.open(ensureAbsoluteUrl(userProfile.id_img_front))}>
                          <div className="doc-icon"><i className="fas fa-id-card"></i></div>
                          <div className="doc-name">School ID (Front)</div>
                          <div className="doc-status available">View File</div>
                        </div>
                      )}
                      {userProfile?.grades_doc && (
                        <div className="doc-card" onClick={() => window.open(ensureAbsoluteUrl(userProfile.grades_doc))}>
                          <div className="doc-icon"><i className="fas fa-file-invoice"></i></div>
                          <div className="doc-name">Scholastic Record</div>
                          <div className="doc-status available">View File</div>
                        </div>
                      )}
                      {userProfile?.enrollment_certificate_doc && (
                        <div className="doc-card" onClick={() => window.open(ensureAbsoluteUrl(userProfile.enrollment_certificate_doc))}>
                          <div className="doc-icon"><i className="fas fa-certificate"></i></div>
                          <div className="doc-name">Enrollment Certificate</div>
                          <div className="doc-status available">View File</div>
                        </div>
                      )}
                      {userProfile?.indigency_doc && (
                        <div className="doc-card" onClick={() => window.open(ensureAbsoluteUrl(userProfile.indigency_doc))}>
                          <div className="doc-icon"><i className="fas fa-house-user"></i></div>
                          <div className="doc-name">Certificate of Indigency</div>
                          <div className="doc-status available">View File</div>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Site Footer */}
      <footer className="site-footer">
        <div className="footer-container">
          <div className="footer-brand">
            <img src={iskoLogo} alt="iskoMats Logo" className="footer-logo" />
            <span className="footer-brand-name">iskoMats</span>
          </div>
          <p className="footer-copyright">
            &copy; {new Date().getFullYear()} iskoMats - Lipa City Scholarship Management System. All rights reserved.
          </p>
        </div>
      </footer>

      {/* IskoBots AI Chatbot */}
      <ChatbotDesign />
    </div>
  );
};

export default Portal;
