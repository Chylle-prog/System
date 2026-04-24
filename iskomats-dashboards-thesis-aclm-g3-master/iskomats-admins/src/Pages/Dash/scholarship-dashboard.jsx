import { useEffect, useMemo, useRef, useState } from 'react';
import { Chart, registerables } from 'chart.js';
import {
  FaCheckCircle,
  FaChevronDown,
  FaClock,
  FaChartBar,
  FaPrint,
  FaSearch,
  FaStar,
  FaTachometerAlt,
  FaTimesCircle,
  FaEnvelope,
  FaEnvelopeOpen,
  FaFilter,
  FaGlobeAfrica,
  FaInbox,
  FaImage,
  FaUpload,
  FaUsers,
  FaEdit,
  FaTrash,
  FaPlus,
  FaFileExcel,
  FaUniversity,
  FaSave,
  FaCalendar,
  FaArrowRight,
  FaChartLine,
  FaGlobe,
  FaTrashAlt,
  FaPaperPlane,
  FaPlusCircle,
  FaRobot,
  FaSpinner
} from 'react-icons/fa';
import * as XLSX from 'xlsx';
import { adminAPI, scholarshipAPI, announcementService, warmBackendConnection } from '../../services/api';
import { decryptUrl } from '../../services/CryptoService';
import socketService from '../../services/socket';
import iskomatsLogo from '../../assets/logo.png';

Chart.register(...registerables);

/**
 * Helper component to handle encrypted images and videos in the dossier
 */
const DecryptedMedia = ({ src, type, className, controls = false, onClick = null, alt = "Document" }) => {
  const [decryptedSrc, setDecryptedSrc] = useState(src);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let objectUrl = null;
    setHasError(false);
    const load = async () => {
      if (src && typeof src === 'string' && src.startsWith('http')) {
        const decrypted = await decryptUrl(src, type);
        if (!decrypted) {
          setHasError(true);
        }
        setDecryptedSrc(decrypted);
        if (decrypted && typeof decrypted === 'string' && decrypted.startsWith('blob:')) {
          objectUrl = decrypted;
        }
      } else {
        setDecryptedSrc(src);
      }
      setIsLoading(false);
    };
    load();
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, type]);

  if (isLoading) {
    return (
      <div className={`${className} bg-gray-100 animate-pulse flex items-center justify-center`}>
        <FaSpinner className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (hasError || !decryptedSrc) {
    return (
      <div className={`${className} bg-gray-100 flex flex-col items-center justify-center text-gray-400`} onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default', minHeight: '60px' }}>
        <FaUsers className="text-xl mb-1" />
        <span className="text-[9px] font-bold uppercase tracking-wider">Unavailable</span>
      </div>
    );
  }

  if (type && type.startsWith('image')) {
    return (
      <img 
        src={decryptedSrc} 
        alt={alt} 
        className={className} 
        onClick={onClick}
        onError={() => setHasError(true)}
      />
    );
  }
  
  return (
    <video 
      src={decryptedSrc} 
      controls={controls} 
      className={className} 
    />
  );
};

const ACADEMIC_YEAR_PATTERN = /^\d{4}[-–—]\d{4}$/;

const autoAdjustColumnWidths = (data) => {
  if (!data || !data.length || !data[0]) return [];
  const keys = Object.keys(data[0]);
  return keys.map(key => {
    let maxLen = key.length;
    data.forEach(row => {
      const val = (row && row[key]) ? String(row[key]) : '';
      if (val.length > maxLen) maxLen = val.length;
    });
    return { wch: maxLen + 4 }; // Add padding
  });
};

const toMessageTimestamp = (value) => {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const toMessageOrderId = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const compareMessageOrder = (left, right) => {
  const timestampDiff = toMessageTimestamp(left?.timestamp) - toMessageTimestamp(right?.timestamp);
  if (timestampDiff !== 0) {
    return timestampDiff;
  }

  return toMessageOrderId(left?.m_id ?? left?.id) - toMessageOrderId(right?.m_id ?? right?.id);
};

const sortMessages = (messages) => [...messages].sort(compareMessageOrder);

const getDefaultAcademicYear = () => {
  const currentYear = new Date().getFullYear();
  return `${currentYear}–${currentYear + 1}`;
};

const normalizeAcademicYear = (value) => {
  const rawValue = String(value || '').trim();
  if (!rawValue) {
    return '';
  }

  const extractedYears = rawValue.match(/\d{4}/g);
  if (extractedYears && extractedYears.length >= 2) {
    return `${extractedYears[0]}–${extractedYears[1]}`;
  }

  const digitsOnly = rawValue.replace(/\D/g, '');
  if (digitsOnly.length >= 8) {
    return `${digitsOnly.slice(0, 4)}–${digitsOnly.slice(4, 8)}`;
  }

  // Replace any dash-like character with a proper en-dash
  return rawValue.replace(/[^\d\-–—]/g, '').replace(/[\-–—]{1,}/g, '–');
};

const COURSES = [
  "AB Communication",
  "Associate in Computer Technology",
  "Bachelor of Elementary Education",
  "Bachelor of Forensic Science",
  "Bachelor of Secondary Education",
  "BS Accountancy",
  "BS Accounting Information System",
  "BS Architecture",
  "BS Biology",
  "BS Computer Engineering",
  "BS Computer Science",
  "BS Electrical Engineering",
  "BS Electronics Engineering",
  "BS Entertainment and Multimedia Computing",
  "BS Entrepreneurship",
  "BS Hospitality Management",
  "BS Industrial Engineering",
  "BS Information Technology",
  "BS Legal Management",
  "BS Management Technology",
  "BS Nursing",
  "BS Psychology",
  "BS Tourism Management",
  "BSBA Financial Management",
  "BSBA Marketing Management",
  "Certificate in Entrepreneurship",
  "Cookery NC II (Culinary Arts)",
  "JURIS DOCTOR PROGRAM"
];

const isValidAcademicYear = (value) => ACADEMIC_YEAR_PATTERN.test(normalizeAcademicYear(value));

const normalizeProviderIdentity = (value) => String(value || '').toLowerCase().trim();

const decodeTokenPayload = (token) => {
  if (!token) {
    return null;
  }

  try {
    const [, payload] = token.split('.');
    if (!payload) {
      return null;
    }

    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = window.atob(normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '='));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
};

const getRequestErrorMessage = (error, fallbackMessage) => {
  if (error.response?.data?.message) {
    const errorType = error.response.data.error_type ? ` [${error.response.data.error_type}]` : '';
    return `${fallbackMessage}: ${error.response.data.message}${errorType}`;
  }

  if (error.code === 'ECONNABORTED') {
    return `${fallbackMessage}: the server took too long to respond.`;
  }

  if (!error.response && typeof navigator !== 'undefined' && navigator.onLine) {
    return `${fallbackMessage}: the server is temporarily unavailable or the request was interrupted.`;
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return `${fallbackMessage}: you appear to be offline.`;
  }

  return `${fallbackMessage}: ${error.message}`;
};

const getApplicantIdentityKey = (applicant) => String(
  applicant?.id
  ?? applicant?.applicant_no
  ?? applicant?.studentContact?.email
  ?? applicant?.emailAddress
  ?? applicant?.email
  ?? applicant?.name
  ?? ''
).trim().toLowerCase();

const optimizeImageFile = (file) => new Promise((resolve) => {
  if (!(file instanceof File) || !file.type.startsWith('image/') || file.size <= 500 * 1024) {
    resolve(file);
    return;
  }

  const image = new Image();
  const objectUrl = URL.createObjectURL(file);

  image.onload = () => {
    const maxDimension = 1600;
    const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
      return;
    }

    context.drawImage(image, 0, 0, width, height);
    canvas.toBlob((blob) => {
      URL.revokeObjectURL(objectUrl);

      if (!blob || blob.size >= file.size) {
        resolve(file);
        return;
      }

      const optimizedName = file.name.replace(/\.[^.]+$/, '') || 'announcement-image';
      resolve(new File([blob], `${optimizedName}.jpg`, {
        type: 'image/jpeg',
        lastModified: file.lastModified,
      }));
    }, 'image/jpeg', 0.82);
  };

  image.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    resolve(file);
  };

  image.src = objectUrl;
});

const initialDashboardData = {
  applicants: [],
  accepted: [],
  rejected: [],
  declined: [],
  cancelled: [],
  inbox: [], // Add later (Missing Schema)
  scholarshipPosts: [], // Add later (Missing Schema)
  announcements: [],
  historicalData: { // Add later (Missing Schema)
    monthlyApplications: [],
    courseDistribution: [],
    financialBreakdown: [],
    locationStats: [],
    gradeRanges: [],
    performanceMetrics: {
      averageProcessingTime: 0,
      acceptanceRate: 0,
      applicationCompletionRate: 0,
      satisfactionScore: 0,
    },
    schoolStats: []
  }
};

export default function ScholarshipDashboard({
  providerKey,
  providerName,
  scholarshipLabel = `${providerName} Scholarship`,
  programName = `${providerName} Scholarship Program`,
  dashboardTitle = `${providerName} Scholarship Dashboard`,
  reportFilePrefix = providerName,
  proNo,
  logo,
}) {
  // Get user name from localStorage
  const userName = localStorage.getItem('userName') || 'Admin';
  const userFirstName = localStorage.getItem('userFirstName') || 'Admin';
  const authenticatedProviderNo = useMemo(() => {
    const payload = decodeTokenPayload(localStorage.getItem('authToken'));
    const parsedProviderNo = Number(payload?.pro_no);
    return Number.isFinite(parsedProviderNo) ? parsedProviderNo : null;
  }, []);
  const activeProviderNo = authenticatedProviderNo ?? proNo ?? null;
  const activeProviderNames = useMemo(
    () => [providerName, providerKey, programName].map(normalizeProviderIdentity).filter(Boolean),
    [programName, providerKey, providerName]
  );
  const adminSenderAliases = useMemo(
    () => new Set([
      userName,
      userFirstName,
      providerName,
      programName,
      scholarshipLabel,
    ].map(normalizeProviderIdentity).filter(Boolean)),
    [programName, providerName, scholarshipLabel, userFirstName, userName]
  );
  const sidebarTitle = useMemo(() => {
    const payload = decodeTokenPayload(localStorage.getItem('authToken'));
    if (payload?.role && payload.role.toLowerCase() !== 'admin') {
      return payload.role;
    }
    return providerName;
  }, [providerName]);
  const sidebarSubtitle = 'Scholarship Program';
  const trackTitle = `${scholarshipLabel} - Track Applicants`;
  const reportTitle = `${scholarshipLabel} Reports`;
  const applicantsOnlyLabel = `${scholarshipLabel} Applicants Only`;
  const scholarshipPlaceholder = `e.g. ${scholarshipLabel} 2026`;
  const messengerTitle = `${scholarshipLabel} Messenger`;
  const administratorTitle = `${scholarshipLabel} Administrator`;

  const [section, setSection] = useState('dashboard'); // dashboard | finder | manage | track | reports | inbox | view-applicant
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [reportsView, setReportsView] = useState('tables'); // analytics | tables
  const [trackTab, setTrackTab] = useState('all'); // pending | all | accepted | declined
  const [analyticsScholarshipFilter, setAnalyticsScholarshipFilter] = useState('all');
  const [trackScholarshipFilter, setTrackScholarshipFilter] = useState('all');
  const [data, setData] = useState(initialDashboardData);
  const [searchTrack, setSearchTrack] = useState('');
  const [finderSearch, setFinderSearch] = useState('');
  const [finderAvailabilityFilter, setFinderAvailabilityFilter] = useState('all'); // all | open | full
  const [reportTab, setReportTab] = useState('pending'); // pending | accepted | declined
  const [viewApplicant, setViewApplicant] = useState(null); // { listType: 'all'|'accepted'|'declined', index }
  const [inboxSearch, setInboxSearch] = useState('');
  const [inboxFilter, setInboxFilter] = useState('all'); // all | pending | accepted
  const [viewMessage, setViewMessage] = useState(null); // { messageId }
  const [replyText, setReplyText] = useState('');
  const [recommendationModal, setRecommendationModal] = useState(false);
  const [recommended, setRecommended] = useState([]);
  const [recommendCount, setRecommendCount] = useState(10);
  const [imageModalSrc, setImageModalSrc] = useState(null);
  const [announcementImages, setAnnouncementImages] = useState([]);
  const [manageMode, setManageMode] = useState('list'); // create | edit | list
  const [editingPost, setEditingPost] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [activeOverlay, setActiveOverlay] = useState(null);
  const [manageTab, setManageTab] = useState('scholarship'); // scholarship | announcement
  const [manageSearch, setManageSearch] = useState('');
  const [schoolVerifSent, setSchoolVerifSent] = useState({}); // { [applicantName]: true }
  const [indigencyVerifSent, setIndigencyVerifSent] = useState({}); // { [applicantName]: true }
  const [confirmDeleteModal, setConfirmDeleteModal] = useState(null); // { type: 'scholarship'|'announcement', id, title, label }
  const [pendingAction, setPendingAction] = useState(null); // { type, applicant, onConfirm, recipient, messageSummary }
  const [processingApplicantActions, setProcessingApplicantActions] = useState({});
  const [formData, setFormData] = useState({
    scholarshipName: '',
    deadline: '',
    minGpa: '',
    slots: '',
    location: '',
    parentFinance: '',
    description: '', // New field
    semester: '',
    year: getDefaultAcademicYear(),
    grades_sem: '',
    grades_year: '',
    course: 'All',
    program_type: 'All',
    title: '', // For announcements
    content: '', // For announcements
    sendToAllApplicants: true
  });
  const [courseTrackFilter, setCourseTrackFilter] = useState('all');
  const pieRef = useRef(null);
  const lineChartRef = useRef(null);
  const barChartRef = useRef(null);
  const courseChartRef = useRef(null);
  const financialChartRef = useRef(null);
  const chartInstance = useRef(null);
  const lineChartInstance = useRef(null);
  const barChartInstance = useRef(null);
  const courseChartInstance = useRef(null);
  const financialChartInstance = useRef(null);
  const schoolChartRef = useRef(null);
  const schoolChartInstance = useRef(null);
  const locationChartRef = useRef(null);
  const locationChartInstance = useRef(null);
  const currentInboxRoomRef = useRef(null);
  const inboxMessagesEndRef = useRef(null);

  const loadApplicants = async () => {
    try {
      const response = await scholarshipAPI.getApplicants(providerKey);
      if (response.data.success) {
        const allApplicantsRaw = response.data.applicants || [];

        // Deduplicate applicants to avoid multiple rows for the same student (e.g. if they applied to multiple scholarships)
        // We prioritize Accepted > Declined > Pending status for the display record
        const applicantMap = new Map();
        allApplicantsRaw.forEach(app => {
          const id = String(app.applicant_no || app.id);
          const existing = applicantMap.get(id);

          if (!existing) {
            applicantMap.set(id, app);
          } else {
            const statusPriority = { 'Accepted': 4, 'Rejected': 3, 'Cancelled': 2, 'Pending': 1 };
            if (statusPriority[app.status] > statusPriority[existing.status]) {
              applicantMap.set(id, app);
            }
          }
        });

        const uniqueApplicants = Array.from(applicantMap.values());
        const historicalData = calculateHistoricalData(allApplicantsRaw); // Use raw data for history/stats

        setData(prev => ({
          ...prev,
          applicants: uniqueApplicants.filter(a => a.status === 'Pending'),
          accepted: uniqueApplicants.filter(a => a.status === 'Accepted'),
          rejected: uniqueApplicants.filter(a => a.status === 'Rejected'),
          declined: uniqueApplicants.filter(a => a.status === 'Declined' || a.status === 'Rejected'),
          cancelled: uniqueApplicants.filter(a => a.status === 'Cancelled'),
          historicalData
        }));
      }
    } catch (error) {
      console.error(`Failed to load ${providerName} applicants:`, error);
    }
  };

  const loadScholarships = async (showAlert = true) => {
    try {
      const response = await scholarshipAPI.getByProgram(providerKey, { include_removed: true });

      if (response.data && response.data.success) {
        const scopedScholarships = (response.data.scholarships || []).filter((post) => {
          if (!post) return false;
          const postProviderNo = Number(post?.proNo ?? post?.pro_no);
          if (activeProviderNo !== null && Number.isFinite(postProviderNo)) {
            return postProviderNo === activeProviderNo;
          }

          const postProviderName = normalizeProviderIdentity(
            post?.providerName ?? post?.provider_name ?? post?.program ?? post?.provider
          );

          if (!postProviderName) {
            return false;
          }

          return activeProviderNames.some((name) => postProviderName.includes(name) || name.includes(postProviderName));
        });

        setData(prev => ({
          ...prev,
          scholarshipPosts: scopedScholarships
        }));
      } else if (showAlert) {
        console.error('API response not successful:', response.data);
        alert(`Failed to load scholarships: ${response.data?.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to load scholarships:', error);
      if (showAlert) {
        alert(getRequestErrorMessage(error, 'Error loading scholarships'));
      }
    }
  };

  // Load applicants and scholarships from backend API on component mount
  useEffect(() => {
    const initializeDashboard = async () => {
      await warmBackendConnection();
      loadApplicants();
      loadScholarships(false);
    };

    initializeDashboard();

    // Socket.IO Integration
    const token = localStorage.getItem('authToken');
    if (token) {
      socketService.connect(token);

      // Track which rooms belong to this admin
      const myRooms = new Set();

      const unsubMsg = socketService.subscribe('message', (msg) => {
        // Only accept messages for rooms this admin is authorized for
        if (!myRooms.has(msg.room)) return;

        setData(prev => {
          // Check if message already exists
          const roomMsgs = prev.inbox.filter(m => m.room === msg.room);
          const isDuplicate = roomMsgs.some(m => {
            if (msg.m_id && m.m_id) return m.m_id === msg.m_id;
            return (
              m.message === msg.message &&
              m.username === msg.username &&
              m.timestamp === msg.timestamp
            );
          });

          if (isDuplicate) return prev;

          const [appNo, proNo] = msg.room.split('+');
          const isActiveRoom = currentInboxRoomRef.current === msg.room;
          const isAdminMessage = adminSenderAliases.has(normalizeProviderIdentity(msg.username));
          const nextMessage = {
            id: msg.m_id || (Date.now() + Math.random()),
            m_id: msg.m_id,
            studentName: msg.username,
            studentEmail: appNo,
            applicant_no: msg.applicant_no || appNo,
            studentStatus: msg.student_status,
            message: msg.message,
            timestamp: msg.timestamp,
            read: isActiveRoom || isAdminMessage,
            is_student_sender: !isAdminMessage,
            room: msg.room
          };

          return {
            ...prev,
            inbox: sortMessages([...prev.inbox, nextMessage])
          };
        });
      });

      const unsubLogged = socketService.subscribe('logged_in', (data) => {
        // Store authorized rooms and load history for each
        // rooms may be [{room, provider_name}] objects or plain strings
        if (data.rooms && data.rooms.length > 0) {
          data.rooms.forEach(roomObj => {
            const roomId = typeof roomObj === 'string' ? roomObj : roomObj.room;
            myRooms.add(roomId);
            socketService.loadHistory(roomId);
          });
        }
      });

      const unsubRoom = socketService.subscribe('add_room', (roomData) => {
        if (roomData.room) myRooms.add(roomData.room);
      });

      // Subscribe to applicant status updates from other admins
      const unsubStatusUpdate = socketService.subscribe('applicant_status_update', (update) => {
        if (update.program !== providerKey) return;

        setData(prev => {
          const newData = { ...prev };
          const applicantToMove = newData.applicants.find(
            a => a.id === update.applicantId || a.name === update.applicantName
          );

          if (applicantToMove) {
            newData.applicants = newData.applicants.filter(
              a => a.id !== update.applicantId && a.name !== update.applicantName
            );

            if (update.newStatus === 'Accepted') {
              newData.accepted = [...newData.accepted, applicantToMove];
            } else if (update.newStatus === 'Rejected' || update.newStatus === 'Declined') {
              newData.rejected = [...newData.rejected, applicantToMove];
            } else if (update.newStatus === 'Cancelled') {
              newData.cancelled = [...newData.cancelled, applicantToMove];
            }

            // Recalculate historical data
            const allApplicants = [...(newData.applicants || []), ...(newData.accepted || []), ...(newData.rejected || []), ...(newData.declined || []), ...(newData.cancelled || [])];
            newData.historicalData = calculateHistoricalData(allApplicants);
          }

          return newData;
        });
      });

      return () => {
        unsubMsg();
        unsubLogged();
        unsubRoom();
        unsubStatusUpdate();
        socketService.disconnect();
      };
    }
  }, [providerKey, providerName]);

  // Filter applicants by month
  const getMonthlyApplicants = (applicants, monthFilter) => {
    if (monthFilter === 'all') {
      return applicants;
    }

    return applicants.filter(applicant => {
      if (!applicant.createdAt) return false;

      const appliedDate = new Date(applicant.createdAt);
      if (isNaN(appliedDate.getTime())) return false;

      const appliedMonth = appliedDate.toISOString().slice(0, 7); // YYYY-MM
      return appliedMonth === monthFilter;
    });
  };

  // Calculate Financial Status based on Income
  const getFinancialStatusLabel = (incomeVal) => {
    const income = parseFloat((incomeVal || "0").toString().replace(/,/g, ''));
    if (isNaN(income)) return incomeVal || 'Unknown';

    if (income <= 30000) return "Very Low";
    if (income <= 70000) return "Low";
    if (income <= 100000) return "High";
    return "Very High";
  };

  const parseNumericValue = (value) => {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const parsed = parseFloat(String(value).replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  };

  const normalizeFinderText = (value) => String(value || '').toLowerCase().trim();

  const applicantMatchesScholarshipCriteria = (applicant, scholarship) => {
    const applicantGrade = parseNumericValue(applicant.grade);
    const minimumGpa = parseNumericValue(scholarship.minGpa);
    if (minimumGpa !== null && (applicantGrade === null || applicantGrade < minimumGpa)) {
      return false;
    }

    const incomeLimit = parseNumericValue(scholarship.parentFinance);
    const applicantIncome = parseNumericValue(applicant.income);
    if (incomeLimit !== null && incomeLimit > 0 && (applicantIncome === null || applicantIncome > incomeLimit)) {
      return false;
    }

    const scholarshipLocation = normalizeFinderText(scholarship.location);
    if (scholarshipLocation) {
      const applicantLocation = normalizeFinderText(applicant.location);
      if (!applicantLocation || (!applicantLocation.includes(scholarshipLocation) && !scholarshipLocation.includes(applicantLocation))) {
        return false;
      }
    }

    return true;
  };

  // Sync recommendations when applicants or filter changes
  useEffect(() => {
    if (recommendationModal && data.applicants.length > 0) {
      const count = parseInt(recommendCount) || 10;
      const allPending = data.applicants || [];
      const filteredApplicants = allPending.filter(a => matchesScholarshipSelection(a, trackScholarshipFilter));
      const top = [...filteredApplicants]
        .sort((a, b) => (Number(b.grade) || 0) - (Number(a.grade) || 0))
        .slice(0, count);
      setRecommended(top);
    }
  }, [data.applicants, trackScholarshipFilter, recommendCount, recommendationModal]);

  const calculateHistoricalData = (applicants) => {
    // Attempt to get the current expected limit from the active scholarship post if any
    const activePost = data.scholarshipPosts?.find(p => p.status === 'Active' || p.status === 'Ongoing');
    const incomeLimit = activePost?.parentFinance || 0;

    const monthlyData = {};
    const courses = {};
    const grades = { '95-100': 0, '90-94': 0, '85-89': 0, '80-84': 0, 'Below 80': 0 };
    const financial = {};
    const locations = {};
    const schools = {};

    (applicants || []).forEach(a => {
      if (!a) return;
      // Monthly
      const dateStr = a.dateApplied || a.createdAt;
      const date = new Date(dateStr);
      let month = 'Unknown';
      if (!isNaN(date.getTime())) {
        month = date.toLocaleString('default', { month: 'short', year: 'numeric' });
      }
      if (!monthlyData[month]) monthlyData[month] = { month, applications: 0, accepted: 0, rejected: 0, cancelled: 0 };
      monthlyData[month].applications++;
      if (a.status === 'Accepted') monthlyData[month].accepted++;
      if (a.status === 'Rejected' || a.status === 'Declined') monthlyData[month].rejected++;
      if (a.status === 'Cancelled') monthlyData[month].cancelled++;

      // Course
      const course = a.course || 'Unknown';
      courses[course] = (courses[course] || 0) + 1;

      // Grade
      const g = parseFloat(a.grade);
      if (g >= 95) grades['95-100']++;
      else if (g >= 90) grades['90-94']++;
      else if (g >= 85) grades['85-89']++;
      else if (g >= 80) grades['80-84']++;
      else grades['Below 80']++;

      // Financial
      const income = a.income || a.family?.grossIncome || '0';
      const fin = getFinancialStatusLabel(income);
      financial[fin] = (financial[fin] || 0) + 1;

      // Location
      const loc = a.location || 'Unknown';
      locations[loc] = (locations[loc] || 0) + 1;

      // School
      const sch = a.school || 'Unknown';
      schools[sch] = (schools[sch] || 0) + 1;
    });

    const total = applicants.length || 1;

    return {
      monthlyApplications: Object.values(monthlyData).sort((a, b) => new Date(a.month) - new Date(b.month)),
      courseDistribution: Object.entries(courses).map(([course, count]) => ({ course, count, percentage: Math.round((count / total) * 100) })).sort((a, b) => b.count - a.count),
      gradeRanges: Object.entries(grades).map(([range, count]) => ({ range, count, percentage: Math.round((count / total) * 100) })),
      financialBreakdown: Object.entries(financial).map(([level, count]) => ({ level, count, percentage: Math.round((count / total) * 100) })),
      locationStats: Object.entries(locations).map(([location, count]) => ({ location, count, percentage: Math.round((count / total) * 100) })).sort((a, b) => b.count - a.count),
      schoolStats: Object.entries(schools).map(([school, count]) => ({ school, count, percentage: Math.round((count / total) * 100) })).sort((a, b) => b.count - a.count),
      performanceMetrics: {
        averageProcessingTime: 5,
        acceptanceRate: Math.round((applicants.filter(a => a.status === 'Accepted').length / total) * 100),
        applicationCompletionRate: 100,
        satisfactionScore: 4.8
      }
    };
  };

  const generateMonthlyStats = (applicants) => {
    return calculateHistoricalData(applicants).monthlyApplications;
  };

  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = error => reject(error);
    });
  };

  const handleAnnouncementImageUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    const optimizedFiles = await Promise.all(files.map((file) => optimizeImageFile(file)));
    const newImages = optimizedFiles.map((file) => ({
      id: Date.now() + Math.random(),
      name: file.name,
      url: URL.createObjectURL(file),
      file,
    }));
    setAnnouncementImages((prev) => [...prev, ...newImages]);
    e.target.value = '';
  };

  const removeAnnouncementImage = (imageId) => {
    setAnnouncementImages((prev) => {
      const image = prev.find((item) => item.id === imageId);
      if (image?.url?.startsWith('blob:')) {
        URL.revokeObjectURL(image.url);
      }
      return prev.filter((item) => item.id !== imageId);
    });
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'year' ? value.replace(/[^\d\s\-–—]/g, '') : value,
    }));
  };

  const handleAcademicYearBlur = () => {
    setFormData((prev) => ({
      ...prev,
      year: normalizeAcademicYear(prev.year),
    }));
  };

  const showActionOverlay = (title, message) => {
    setActiveOverlay({ title, message });
  };

  const hideActionOverlay = () => {
    setActiveOverlay(null);
  };

  const markApplicantProcessing = (applicant, requestedStatus = null) => {
    const applicantKey = getApplicantIdentityKey(applicant);
    if (!applicantKey) {
      return;
    }

    setProcessingApplicantActions((current) => {
      if (!requestedStatus) {
        if (!current[applicantKey]) {
          return current;
        }

        const next = { ...current };
        delete next[applicantKey];
        return next;
      }

      return {
        ...current,
        [applicantKey]: {
          requestedStatus,
          startedAt: Date.now(),
        },
      };
    });
  };

  const getApplicantProcessingState = (applicant) => processingApplicantActions[getApplicantIdentityKey(applicant)] || null;

  const prioritizeProcessingApplicants = (applicants) => {
    return [...applicants].sort((left, right) => {
      const leftProcessing = getApplicantProcessingState(left);
      const rightProcessing = getApplicantProcessingState(right);

      if (leftProcessing && rightProcessing) {
        return rightProcessing.startedAt - leftProcessing.startedAt;
      }

      if (leftProcessing) {
        return -1;
      }

      if (rightProcessing) {
        return 1;
      }

      return 0;
    });
  };

  // --- Optimistic UI for applicant status changes ---
  const beginApplicantStatusRequest = ({
    applicant,
    requestedStatus,
    request,
    successEvent,
    failureMessage,
    onStart,
  }) => {
    const applicantKey = getApplicantIdentityKey(applicant);
    if (!applicantKey || processingApplicantActions[applicantKey]) {
      return;
    }

    const applicantId = applicant?.id || applicant?.applicant_no;
    const scholarshipNo = applicant?.scholarshipNo;
    if (!applicantId || !scholarshipNo) {
      alert('Unable to update applicant status because the applicant record is incomplete.');
      return;
    }

    // Optimistically update UI
    markApplicantProcessing(applicant, requestedStatus);
    onStart?.();

    // Remove from current list and add to new status list immediately
    setData(prev => {
      let newApplicants = prev.applicants.filter(a => getApplicantIdentityKey(a) !== applicantKey);
      let newAccepted = prev.accepted;
      let newDeclined = prev.declined;
      if (requestedStatus === 'Accepted') {
        newAccepted = [...prev.accepted, { ...applicant, status: 'Accepted' }];
      } else if (requestedStatus === 'Declined') {
        newDeclined = [...prev.declined, { ...applicant, status: 'Declined' }];
      }
      return {
        ...prev,
        applicants: newApplicants,
        accepted: newAccepted,
        rejected: requestedStatus === 'Rejected' ? [...prev.rejected, { ...applicant, status: 'Rejected' }] : prev.rejected,
        declined: newDeclined,
        cancelled: requestedStatus === 'Cancelled' ? [...prev.cancelled, { ...applicant, status: 'Cancelled' }] : prev.cancelled,
      };
    });

    void (async () => {
      try {
        await request(applicantId, scholarshipNo);

        socketService.emit(successEvent, {
          applicantId: applicant.id,
          applicantName: applicant.name,
          program: providerKey,
          newStatus: requestedStatus,
          adminName: userName,
          timestamp: new Date().toISOString(),
        });
        // Optionally reload in background to sync
        loadApplicants();
        loadScholarships(false);
      } catch (error) {
        // Revert UI on error
        setData(prev => {
          // Move applicant back to applicants list
          let revertedApplicants = [...prev.applicants, { ...applicant, status: 'Pending' }];
          let revertedAccepted = prev.accepted.filter(a => getApplicantIdentityKey(a) !== applicantKey);
          let revertedDeclined = prev.declined.filter(a => getApplicantIdentityKey(a) !== applicantKey);
          return {
            ...prev,
            applicants: revertedApplicants,
            accepted: revertedAccepted,
            declined: revertedDeclined,
          };
        });
        alert(getRequestErrorMessage(error, failureMessage));
      } finally {
        markApplicantProcessing(applicant, null);
      }
    })();
  };

  const resetForm = () => {
    setFormData({
      scholarshipName: '',
      deadline: '',
      minGpa: '',
      slots: '',
      location: '',
      parentFinance: '',
      description: '',
      semester: '',
      year: getDefaultAcademicYear(),
      title: '',
      content: '',
      sendToAllApplicants: true
    });
    setAnnouncementImages([]);
    setEditingPost(null);
    setIsSaving(false);
  };

  useEffect(() => {
    if (section === 'manage' && manageMode !== 'list') {
      setManageMode('list');
      resetForm();
    }
  }, [section]);

  // Reload scholarships when entering manage section
  useEffect(() => {
    if (section === 'manage') {
      loadScholarships(false);
      loadAnnouncements();
    }

    // Listen for scholarship updates from other admins
    const unsubScholarships = socketService.onScholarshipUpdate((data) => {
      if (data.program === providerKey) {
        console.log('[SCHOLARSHIP UPDATE] Received update:', data);
        loadScholarships();
      }
    });

    // Listen for announcement updates from other admins
    const unsubAnnouncements = socketService.onAnnouncementUpdate((data) => {
      if (data.program === providerKey) {
        console.log('[ANNOUNCEMENT UPDATE] Received update:', data);
        loadAnnouncements();
      }
    });

    // Listen for real-time notifications
    const unsubNotifications = socketService.onAnnouncementNotification((data) => {
      console.log('[NOTIFICATION] Received announcement notification:', data);
      // Show an alert for the new announcement
      alert(`📢 ${data.title}\n\n${data.message}`);
    });

    return () => {
      unsubScholarships();
      unsubAnnouncements();
      unsubNotifications();
    };
  }, [section, providerKey]);

  const loadAnnouncements = async () => {
    try {
      if (typeof announcementService === 'undefined') {
        console.error('[ContentMain] announcementService is not defined in this scope.');
        return;
      }
      const response = await announcementService.getAll({ include_removed: true });
      // Map backend field names to frontend field names
      const normalizedAnnouncements = (response.data || []).map(ann => ({
        id: ann.ann_no || ann.id,
        ann_no: ann.ann_no || ann.id,
        title: ann.ann_title || ann.title,
        content: ann.ann_message || ann.message || ann.content,
        date: ann.created_at || ann.time_added || ann.ann_date || new Date().toISOString(),
        announcementImages: ann.announcementImages || [],
        status: ann.status || 'active',
        ...ann // Include all original fields too
      })).filter((ann) => {
        const announcementProviderNo = Number(ann?.proNo ?? ann?.pro_no);
        if (activeProviderNo !== null && Number.isFinite(announcementProviderNo)) {
          return announcementProviderNo === activeProviderNo;
        }

        const announcementProviderName = normalizeProviderIdentity(
          ann?.providerName ?? ann?.provider_name ?? ann?.program ?? ann?.provider
        );

        if (!announcementProviderName) {
          return true;
        }

        return activeProviderNames.some((name) => announcementProviderName.includes(name) || name.includes(announcementProviderName));
      });
      setData(prev => ({ ...prev, announcements: normalizedAnnouncements }));
    } catch (error) {
      console.error('Failed to load announcements:', error);
    }
  };

  const saveScholarshipPost = async () => {
    const actionLabel = manageMode === 'edit' ? 'Updating scholarship post' : 'Publishing scholarship post';
    setIsSaving(true);
    showActionOverlay(actionLabel, 'Please wait while the scholarship details are being saved.');
    try {
      const normalizedYear = normalizeAcademicYear(formData.year);
      if (!isValidAcademicYear(normalizedYear)) {
        alert('Academic year must use the YYYY-YYYY format, for example 2025-2026.');
        setIsSaving(false);
        hideActionOverlay();
        return;
      }

      const postData = {
        ...formData,
        slots: parseInt(formData.slots),
        minGpa: parseFloat(formData.minGpa),
        parentFinance: parseFloat(formData.parentFinance),
        description: formData.description,
        year: normalizedYear,
      };

      console.log('Sending postData to API:', postData);

      let response;
      if (manageMode === 'edit') {
        response = await scholarshipAPI.updateScholarship(editingPost.reqNo, postData);
      } else {
        response = await scholarshipAPI.createScholarship(postData);
      }

      if (response.data.success) {
        resetForm();
        setManageMode('list');
        await loadScholarships(false);

        // Notify other admins of the update via socket
        socketService.emit('scholarship_update', {
          program: providerKey,
          action: manageMode === 'edit' ? 'updated' : 'created',
          scholarshipName: formData.scholarshipName,
          reqNo: editingPost?.reqNo || null,
          adminName: userName,
          timestamp: new Date().toISOString()
        });
      } else {
        alert('Error: ' + (response.data.message || 'Unknown error occurred'));
      }
    } catch (error) {
      console.error('Failed to save scholarship:', error);
      alert(getRequestErrorMessage(error, 'Error saving scholarship'));
    } finally {
      setIsSaving(false);
      hideActionOverlay();
    }
  };

  const editPost = (post) => {
    console.log('Editing post:', post);
    try {
      setEditingPost(post);

      // Format date for HTML input (YYYY-MM-DD)
      let formattedDeadline = '';
      if (post.deadline) {
        const date = new Date(post.deadline);
        if (!isNaN(date.getTime())) {
          formattedDeadline = date.toISOString().split('T')[0];
        } else {
          formattedDeadline = post.deadline;
        }
      }

      const formData = {
        scholarshipName: post.scholarshipName || '',
        deadline: formattedDeadline,
        minGpa: post.minGpa ? post.minGpa.toString() : '',
        slots: post.slots ? post.slots.toString() : '',
        location: post.location || '',
        parentFinance: post.parentFinance ? post.parentFinance.toString() : '',
        description: post.description || '',
        semester: post.semester || post.term || '',
        year: post.year ? normalizeAcademicYear(post.year) : getDefaultAcademicYear(),
        grades_sem: post.grades_sem || '',
        grades_year: post.grades_year || '',
        title: '',
        content: '',
        sendToAllApplicants: true,
      };
      console.log('Form data being set:', formData);
      setFormData(formData);
      setAnnouncementImages([]);
      setManageMode('edit');
    } catch (error) {
      console.error('Error in editPost:', error);
      alert('Error editing post: ' + error.message);
    }
  };

  const deletePost = (postId) => {
    executeDeleteDirectly('scholarship', postId);
  };

  const deleteAnnouncement = (id) => {
    executeDeleteDirectly('announcement', id);
  };

  const executeDeleteDirectly = async (type, id) => {
    if (type === 'scholarship') {
      showActionOverlay('Deleting scholarship post', 'Please wait while the scholarship post is being removed.');
      try {
        const response = await scholarshipAPI.deleteScholarship(id);
        if (response.data.success) {
          await loadScholarships(false);
          await loadApplicants();
          if (editingPost && (editingPost.reqNo || editingPost.id) === id) {
            resetForm();
            setManageMode('list');
          }
        }
      } catch (error) {
        console.error('Failed to delete scholarship:', error);
        alert(getRequestErrorMessage(error, 'Error deleting scholarship'));
      } finally {
        hideActionOverlay();
      }
    } else if (type === 'announcement') {
      showActionOverlay('Deleting announcement', 'Please wait while the announcement is being removed.');
      try {
        await announcementService.delete(id);
        if (editingPost && (editingPost.id || editingPost.ann_no) === id) {
          resetForm();
          setManageMode('list');
        }
        await loadAnnouncements();
      } catch (error) {
        console.error('Failed to delete announcement:', error);
        alert(getRequestErrorMessage(error, 'Error deleting announcement'));
      } finally {
        hideActionOverlay();
      }
    }
  };

  const executeDelete = async () => {
    if (!confirmDeleteModal) return;
    const { type, id } = confirmDeleteModal;
    setConfirmDeleteModal(null);
    await executeDeleteDirectly(type, id);
  };

  const saveAnnouncement = async () => {
    if (!formData.title || !formData.content) {
      alert('Please fill in both title and content for the announcement.');
      return;
    }

    const actionLabel = manageMode === 'edit' ? 'Updating announcement' : 'Publishing announcement';
    setIsSaving(true);
    showActionOverlay(actionLabel, 'Please wait while the announcement is being saved.');
    try {
      // Use FormData for better performance and to avoid base64 overhead
      const fData = new FormData();
      fData.append('title', formData.title);
      fData.append('content', formData.content);
      fData.append('time_added', new Date().toISOString());
      fData.append('send_to_all_applicants', formData.sendToAllApplicants);

      // Distinguish between existing images and new file uploads
      const existingImages = [];
      announcementImages.forEach((img, idx) => {
        if (img.file) {
          // New file upload
          fData.append(`image_${idx}`, img.file);
        } else if (img.url && !img.url.startsWith('blob:')) {
          // Existing image URL
          existingImages.push(img.url);
        }
      });

      if (existingImages.length > 0) {
        fData.append('announcementImages', JSON.stringify(existingImages));
      }

      let response;
      if (manageMode === 'edit' && editingPost) {
        // Update existing announcement
        // Note: Backend might need update to handle FormData in PUT
        response = await announcementService.update(editingPost.id || editingPost.ann_no, fData);
      } else {
        // Create new announcement
        response = await announcementService.create(fData);
      }

      if (response.data.message || response.data.success) {
        resetForm();
        await loadAnnouncements();
        setManageMode('list');

        // Notify other admins of the announcement update via socket
        socketService.emit('announcement_update', {
          program: providerKey,
          action: manageMode === 'edit' ? 'updated' : 'created',
          title: formData.title,
          annNo: editingPost?.id || editingPost?.ann_no || null,
          adminName: userName,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('Failed to save announcement:', error);
      alert(getRequestErrorMessage(error, 'Error saving announcement'));
    } finally {
      setIsSaving(false);
      hideActionOverlay();
    }
  };

  const editAnnouncement = (ann) => {
    setEditingPost(ann);
    setFormData({
      title: ann.title,
      content: ann.message || ann.content,
      sendToAllApplicants: ann.send_to_all_applicants !== false
    });
    const normalizedImages = (ann.announcementImages || []).map((img, idx) => (
      typeof img === 'string'
        ? { id: `existing-announcement-${idx}`, url: img, name: `Existing ${idx + 1}` }
        : { id: img.id || `existing-announcement-${idx}`, ...img }
    ));
    setAnnouncementImages(normalizedImages);
    setManageMode('edit');
  };

  const filteredScholarshipPosts = useMemo(() => {
    // For the MANAGE list, we only want active scholarships (excluding deleted ones)
    const posts = (data.scholarshipPosts || []).filter(post => !(post.isRemoved || post.is_removed));
    if (!manageSearch) return posts;
    const search = manageSearch.toLowerCase();
    return posts.filter(post =>
      (post.scholarshipName || post.title || '').toLowerCase().includes(search) ||
      (post.description || '').toLowerCase().includes(search) ||
      (post.location || '').toLowerCase().includes(search)
    );
  }, [data.scholarshipPosts, manageSearch]);

  const filteredAnnouncements = useMemo(() => {
    // For the MANAGE list, we only want active announcements (excluding deleted ones)
    const announcements = (data.announcements || []).filter(ann => !(ann.is_removed || ann.isRemoved));
    if (!manageSearch) return announcements;
    const search = manageSearch.toLowerCase();
    return announcements.filter(ann =>
      (ann.title || '').toLowerCase().includes(search) ||
      (ann.content || '').toLowerCase().includes(search)
    );
  }, [data.announcements, manageSearch]);

  const scholarshipFilterOptions = useMemo(() => {
    const options = (data.scholarshipPosts || [])
      .map((post) => {
        const value = String(post.reqNo || post.id || post.scholarshipName || post.title || '').trim();
        let label = post.scholarshipName || post.title || 'Untitled Scholarship';

        if (post.isRemoved || post.is_removed) {
          label = `${label} (Deleted)`;
        }

        return value ? { value, label } : null;
      }).filter(Boolean);

    return [
      { value: 'deleted', label: 'Deleted Scholarships' },
      ...options
    ];
  }, [data.scholarshipPosts]);

  const matchesScholarshipSelection = (applicant, selectedValue) => {
    if (selectedValue === 'all') {
      return true;
    }

    if (selectedValue === 'deleted') {
      const applicantReqNo = applicant.reqNo || applicant.req_no || applicant.request_no || applicant.scholarshipNo || applicant.scholarship_no;
      if (!applicantReqNo) return false;

      const scholarship = (data.scholarshipPosts || []).find(s =>
        String(s.reqNo || s.id || '') === String(applicantReqNo)
      );

      return scholarship?.isRemoved === true || scholarship?.is_removed === true;
    }

    const selectedOption = scholarshipFilterOptions.find((option) => option.value === selectedValue);
    
    // Exact ID matching
    const applicantReqNo = String(applicant.reqNo || applicant.req_no || applicant.request_no || applicant.scholarshipNo || applicant.scholarship_no || '').toLowerCase();
    const selectedReqNo = String(selectedValue || '').toLowerCase();
    
    if (selectedReqNo && applicantReqNo === selectedReqNo) {
      return true;
    }

    // Name matching (more flexible)
    const applicantScholarshipName = String(applicant.scholarshipName || applicant.scholarship_name || applicant.appliedScholarship || applicant.scholarship || applicant.scholarshipTitle || '').toLowerCase();
    const selectedLabel = String(selectedOption?.label || '').toLowerCase();

    if (selectedLabel && applicantScholarshipName) {
      // Avoid partial matches for numeric-like names but allow for descriptive names
      if (applicantScholarshipName === selectedLabel || applicantScholarshipName.includes(selectedLabel) || selectedLabel.includes(applicantScholarshipName)) {
        return true;
      }
    }

    return false;
  };

  const scholarshipFinderResults = useMemo(() => {
    const search = normalizeFinderText(finderSearch);
    const allTrackedApplicants = [
      ...(data.applicants || []),
      ...(data.accepted || []),
      ...(data.rejected || []),
      ...(data.declined || []),
      ...(data.cancelled || [])
    ];

    return (data.scholarshipPosts || [])
      .map((post) => {
        const scholarshipId = String(post.reqNo || post.id || '');
        const acceptedCount = Number(post.acceptedCount ?? (data.accepted || []).filter((applicant) => matchesScholarshipSelection(applicant, scholarshipId)).length);
        const pendingCount = Number(post.pendingCount ?? (data.applicants || []).filter((applicant) => matchesScholarshipSelection(applicant, scholarshipId)).length);
        const declinedCount = Number(post.declinedCount ?? (data.declined || data.rejected || []).filter((applicant) => matchesScholarshipSelection(applicant, scholarshipId)).length);
        const totalApplicants = Number(post.totalApplicants ?? (acceptedCount + pendingCount + declinedCount));
        const slotLimit = Number(post.slots ?? 0);
        const availableSlots = post.availableSlots ?? Math.max(slotLimit - acceptedCount, 0);
        const isFull = typeof post.isFull === 'boolean' ? post.isFull : (slotLimit > 0 && availableSlots <= 0);
        const eligibleApplicantIds = new Set(
          allTrackedApplicants
            .filter((applicant) => applicantMatchesScholarshipCriteria(applicant, post))
            .map((applicant) => applicant.id || applicant.applicant_no)
            .filter(Boolean)
        );

        return {
          ...post,
          acceptedCount,
          pendingCount,
          declinedCount,
          totalApplicants,
          availableSlots,
          isFull,
          eligibleApplicantCount: eligibleApplicantIds.size,
        };
      })
      .filter((post) => {
        if (finderAvailabilityFilter === 'open' && post.isFull) {
          return false;
        }

        if (finderAvailabilityFilter === 'full' && !post.isFull) {
          return false;
        }

        if (!search) {
          return true;
        }

        return [
          post.scholarshipName,
          post.description,
          post.location,
          post.semester,
          post.year,
        ].some((value) => normalizeFinderText(value).includes(search));
      })
      .sort((left, right) => {
        if (left.isFull !== right.isFull) {
          return Number(left.isFull) - Number(right.isFull);
        }

        if (left.availableSlots !== right.availableSlots) {
          return right.availableSlots - left.availableSlots;
        }

        return String(left.scholarshipName || '').localeCompare(String(right.scholarshipName || ''));
      });
  }, [data.accepted, data.applicants, data.declined, data.scholarshipPosts, finderAvailabilityFilter, finderSearch, matchesScholarshipSelection]);

  const stats = useMemo(() => {
    const filteredPending = data.applicants.filter((applicant) => matchesScholarshipSelection(applicant, analyticsScholarshipFilter));
    const filteredAccepted = data.accepted.filter((applicant) => matchesScholarshipSelection(applicant, analyticsScholarshipFilter));
    const filteredRejected = data.rejected.filter((applicant) => matchesScholarshipSelection(applicant, analyticsScholarshipFilter));
    const filteredCancelled = data.cancelled.filter((applicant) => matchesScholarshipSelection(applicant, analyticsScholarshipFilter));
    const total = filteredPending.length + filteredAccepted.length + filteredRejected.length + filteredCancelled.length;
    return {
      total,
      accepted: filteredAccepted.length,
      rejected: filteredRejected.length,
      cancelled: filteredCancelled.length,
      pending: filteredPending.length,
    };
  }, [analyticsScholarshipFilter, data]);

  const filteredReportApplicants = useMemo(() => {
    const pending = data.applicants.filter((applicant) => matchesScholarshipSelection(applicant, analyticsScholarshipFilter));
    const accepted = data.accepted.filter((applicant) => matchesScholarshipSelection(applicant, analyticsScholarshipFilter));
    const rejected = data.rejected.filter((applicant) => matchesScholarshipSelection(applicant, analyticsScholarshipFilter));
    const cancelled = data.cancelled.filter((applicant) => matchesScholarshipSelection(applicant, analyticsScholarshipFilter));
    return {
      pending,
      accepted,
      rejected,
      cancelled,
      all: [...pending, ...accepted, ...rejected, ...cancelled],
    };
  }, [analyticsScholarshipFilter, data]);

  const filteredHistoricalData = useMemo(
    () => calculateHistoricalData(filteredReportApplicants.all),
    [filteredReportApplicants]
  );

  const openScholarshipInTrack = (post) => {
    const scholarshipValue = String(post.reqNo || post.id || 'all');
    setTrackScholarshipFilter(scholarshipValue);
    setAnalyticsScholarshipFilter(scholarshipValue);
    setSection('track');
  };

  const openScholarshipEditor = (post) => {
    setManageTab('scholarship');
    editPost(post);
    setSection('manage');
  };

  useEffect(() => {
    if (section !== 'reports') return;

    // Cleanup function for all charts
    const cleanupCharts = () => {
      if (chartInstance.current) { chartInstance.current.destroy(); chartInstance.current = null; }
      if (lineChartInstance.current) { lineChartInstance.current.destroy(); lineChartInstance.current = null; }
      if (barChartInstance.current) { barChartInstance.current.destroy(); barChartInstance.current = null; }
      if (courseChartInstance.current) { courseChartInstance.current.destroy(); courseChartInstance.current = null; }
      if (financialChartInstance.current) { financialChartInstance.current.destroy(); financialChartInstance.current = null; }
      if (schoolChartInstance.current) { schoolChartInstance.current.destroy(); schoolChartInstance.current = null; }
      if (locationChartInstance.current) { locationChartInstance.current.destroy(); locationChartInstance.current = null; }
    };

    // Pie Chart for Status Overview
    if (pieRef.current) {
      const ctx = pieRef.current.getContext('2d');
      if (chartInstance.current) chartInstance.current.destroy();
      chartInstance.current = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['Accepted', 'Rejected', 'Cancelled', 'Pending'],
          datasets: [{
            data: [stats.accepted, stats.rejected || 0, stats.cancelled || 0, stats.pending],
            backgroundColor: ['#198754', '#dc3545', '#6c757d', '#ffc107'],
            borderWidth: 2,
            borderColor: '#fff',
          }],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
      });
    }

    // Line Chart for Application Trends
    if (lineChartRef.current) {
      const ctx = lineChartRef.current.getContext('2d');
      if (lineChartInstance.current) lineChartInstance.current.destroy();
      lineChartInstance.current = new Chart(ctx, {
        type: 'line',
        data: {
          labels: filteredHistoricalData.monthlyApplications.map(m => m.month),
          datasets: [
            {
              label: 'Applications',
              data: filteredHistoricalData.monthlyApplications.map(m => m.applications),
              borderColor: '#800020',
              backgroundColor: 'rgba(128, 0, 32, 0.1)',
              tension: 0.4
            },
            {
              label: 'Accepted',
              data: filteredHistoricalData.monthlyApplications.map(m => m.accepted),
              borderColor: '#198754',
              backgroundColor: 'rgba(25, 135, 84, 0.1)',
              tension: 0.4
            },
            {
              label: 'Rejected',
              data: filteredHistoricalData.monthlyApplications.map(m => m.rejected),
              borderColor: '#dc3545',
              backgroundColor: 'rgba(220, 53, 69, 0.1)',
              tension: 0.4
            },
            {
              label: 'Cancelled',
              data: filteredHistoricalData.monthlyApplications.map(m => m.cancelled),
              borderColor: '#6c757d',
              backgroundColor: 'rgba(108, 117, 125, 0.1)',
              tension: 0.4
            }
          ]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
      });
    }

    // Bar Chart for Grade Distribution
    if (barChartRef.current) {
      const ctx = barChartRef.current.getContext('2d');
      if (barChartInstance.current) barChartInstance.current.destroy();
      barChartInstance.current = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: filteredHistoricalData.gradeRanges.map(g => g.range),
          datasets: [{
            label: 'Number of Students',
            data: filteredHistoricalData.gradeRanges.map(g => g.count),
            backgroundColor: '#800020',
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
      });
    }

    // Doughnut Chart for Course Distribution
    if (courseChartRef.current) {
      const ctx = courseChartRef.current.getContext('2d');
      if (courseChartInstance.current) courseChartInstance.current.destroy();
      courseChartInstance.current = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: filteredHistoricalData.courseDistribution.map(c => c.course),
          datasets: [{
            data: filteredHistoricalData.courseDistribution.map(c => c.count),
            backgroundColor: ['#800020', '#650018', '#a00028', '#c44569'],
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
      });
    }

    // Doughnut Chart for Financial Background
    if (financialChartRef.current) {
      const ctx = financialChartRef.current.getContext('2d');
      if (financialChartInstance.current) financialChartInstance.current.destroy();
      financialChartInstance.current = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: filteredHistoricalData.financialBreakdown.map(f => f.level),
          datasets: [{
            data: filteredHistoricalData.financialBreakdown.map(f => f.count),
            backgroundColor: ['#198754', '#ffc107', '#fd7e14', '#dc3545'],
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
      });
    }

    // Doughnut Chart for School Distribution
    if (schoolChartRef.current) {
      const ctx = schoolChartRef.current.getContext('2d');
      if (schoolChartInstance.current) schoolChartInstance.current.destroy();
      schoolChartInstance.current = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: filteredHistoricalData.schoolStats.map(s => s.school),
          datasets: [{
            data: filteredHistoricalData.schoolStats.map(s => s.count),
            backgroundColor: ['#800020', '#198754', '#0d6efd', '#ffc107', '#6c757d'],
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
      });
    }

    // New chart for Location Split
    if (locationChartRef.current) {
      const ctx = locationChartRef.current.getContext('2d');
      if (locationChartInstance.current) locationChartInstance.current.destroy();
      locationChartInstance.current = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: filteredHistoricalData.locationStats.map(loc => loc.location),
          datasets: [{
            data: filteredHistoricalData.locationStats.map(loc => loc.count),
            backgroundColor: ['#800020', '#198754', '#0d6efd', '#ffc107', '#6c757d'],
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
      });
    }

    return cleanupCharts;
  }, [section, reportsView, stats, filteredHistoricalData]);

  const formatDate = (timestamp) => {
    if (!timestamp) return 'No timestamp';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return timestamp;
    return date.toISOString().split('T')[0];
  };

  const getApplicantDispatchKey = (applicant) => applicant?.applicant_no || applicant?.id || applicant?.studentContact?.email || applicant?.email || applicant?.name;

  const handleSendSchoolVerification = async (applicant) => {
    const applicantId = applicant?.applicant_no || applicant?.id;
    const scholarshipNo = applicant?.scholarshipNo;
    const dispatchKey = getApplicantDispatchKey(applicant);

    if (!applicantId || !scholarshipNo) {
      alert('Unable to send school verification because the applicant record is incomplete.');
      return;
    }

    // Resolve school email for preview
    const schoolName = (applicant?.school || '').toLowerCase();
    const recipient = schoolName.includes('dlsl') || schoolName.includes('de la salle')
      ? 'dlsl.edu.ph@gmail.com'
      : 'Institutional Verification Office';

    setPendingAction({
      type: 'verification',
      title: 'Dispatch School Verification',
      recipient: recipient,
      messageSummary: `Official request to verify student records for ${applicant.name || 'this applicant'}.`,
      documents: ['Enrollment Certificate', 'Official Grades Report', 'Student ID (Front & Back)'],
      onConfirm: async () => {
        showActionOverlay('Sending school verification', 'Preparing the applicant documents and emailing the school verification address.');
        try {
          const response = await scholarshipAPI.sendSchoolVerification(applicantId, scholarshipNo);
          setSchoolVerifSent((prev) => ({ ...prev, [dispatchKey]: true }));
          // No alert here, overlay will show success briefly or we just hide
        } catch (error) {
          console.error('Failed to send school verification email:', error);
          alert('Error sending school verification');
        } finally {
          hideActionOverlay();
        }
      }
    });
  };

  const handleSendIndigencyVerification = async (applicant) => {
    const applicantId = applicant?.applicant_no || applicant?.id;
    const scholarshipNo = applicant?.scholarshipNo;
    const dispatchKey = getApplicantDispatchKey(applicant);

    if (!applicantId || !scholarshipNo) {
      alert('Unable to send indigency verification because the applicant record is incomplete.');
      return;
    }

    const recipient = 'lipacityhall.gov.ph@gmail.com';

    setPendingAction({
      type: 'verification',
      title: 'Dispatch Indigency Verification',
      recipient: recipient,
      messageSummary: `Verification request for the indigency document of ${applicant.name || 'this applicant'}.`,
      documents: ['Indigency Proof Image'],
      onConfirm: async () => {
        showActionOverlay('Sending indigency verification', 'Preparing the indigency document and emailing the city hall verification address.');
        try {
          const response = await scholarshipAPI.sendIndigencyVerification(applicantId, scholarshipNo);
          setIndigencyVerifSent((prev) => ({ ...prev, [dispatchKey]: true }));
        } catch (error) {
          console.error('Failed to send indigency verification email:', error);
          alert('Error sending indigency verification');
        } finally {
          hideActionOverlay();
        }
      }
    });
  };

  const viewApplicantFn = (index, listType = 'all') => {
    setViewApplicant({ listType, index });
    setSection('view-applicant');
  };

  const handleStartChat = (applicant) => {
    if (!activeProviderNo) {
      alert('Unable to determine the active provider for this session. Please sign in again.');
      return;
    }

    socketService.startChat(applicant.applicant_no || applicant.id, activeProviderNo);
    setSection('inbox');
  };

  const recommendStudents = () => {
    const count = parseInt(recommendCount) || 10;
    const allPending = data.applicants || [];
    
    // Exact same filtering logic as the Track list
    const filteredApplicants = allPending.filter(a => matchesScholarshipSelection(a, trackScholarshipFilter));
    
    const top = [...filteredApplicants]
      .sort((a, b) => (Number(b.grade) || 0) - (Number(a.grade) || 0))
      .slice(0, count);
      
    setRecommended(top);
    setRecommendationModal(true);
  };

  const acceptRecommended = async (applicant) => {
    const idx = data.applicants.findIndex((a) => a.studentContact?.email === applicant.studentContact?.email || a.name === applicant.name);
    if (idx < 0) return;

    const applicantToAccept = data.applicants[idx];
    const recipient = applicantToAccept.studentContact?.email || applicantToAccept.emailAddress || applicantToAccept.email || 'Student Email';

    setPendingAction({
      type: 'acceptance',
      title: 'Approve Applicant',
      recipient: recipient,
      messageSummary: `Congratulations! Your application for ${scholarshipLabel} has been accepted.`,
      onConfirm: async () => {
        beginApplicantStatusRequest({
          applicant: applicantToAccept,
          requestedStatus: 'Accepted',
          request: (applicantId, scholarshipNo) => scholarshipAPI.acceptApplicant(applicantId, scholarshipNo),
          successEvent: 'applicant_accept',
          failureMessage: 'Failed to accept applicant',
          onStart: () => {
            setRecommendationModal(false);
            setSection('track');
            setTrackTab('pending');
          },
        });
      }
    });
  };

  const declineRecommended = async (applicant) => {
    const idx = data.applicants.findIndex((a) => a.studentContact?.email === applicant.studentContact?.email || a.name === applicant.name);
    if (idx < 0) return;

    const applicantToDecline = data.applicants[idx];
    const recipient = applicantToDecline.studentContact?.email || applicantToDecline.emailAddress || applicantToDecline.email || 'Student Email';

    setPendingAction({
      type: 'rejection',
      title: 'Decline Applicant',
      recipient: recipient,
      messageSummary: `Thank you for your interest. We regret to inform you that your application has been declined.`,
      onConfirm: async () => {
        beginApplicantStatusRequest({
          applicant: applicantToDecline,
          requestedStatus: 'Declined',
          request: (applicantId, scholarshipNo) => scholarshipAPI.declineApplicant(applicantId, scholarshipNo),
          successEvent: 'applicant_decline',
          failureMessage: 'Failed to decline applicant',
          onStart: () => {
            setRecommendationModal(false);
            setSection('track');
            setTrackTab('pending');
          },
        });
      }
    });
  };

  const acceptApplicant = async () => {
    if (!viewApplicant || (viewApplicant.listType !== 'all' && viewApplicant.listType !== 'pending')) return;
    const { index } = viewApplicant;
    const applicant = data.applicants[index];
    if (!applicant) return;

    const recipient = applicant.studentContact?.email || applicant.emailAddress || applicant.email || 'Student Email';

    setPendingAction({
      type: 'acceptance',
      title: 'Approve Applicant',
      recipient: recipient,
      messageSummary: `Congratulations! Your application for ${scholarshipLabel} has been accepted.`,
      onConfirm: async () => {
        beginApplicantStatusRequest({
          applicant,
          requestedStatus: 'Accepted',
          request: (applicantId, scholarshipNo) => scholarshipAPI.acceptApplicant(applicantId, scholarshipNo),
          successEvent: 'applicant_accept',
          failureMessage: 'Failed to accept applicant',
          onStart: () => {
            setViewApplicant(null);
            setSection('track');
            setTrackTab('pending');
          },
        });
      }
    });
  };

  const declineApplicant = async () => {
    if (!viewApplicant || (viewApplicant.listType !== 'all' && viewApplicant.listType !== 'pending')) return;
    const { index } = viewApplicant;
    const applicant = data.applicants[index];
    if (!applicant) return;

    const recipient = applicant.studentContact?.email || applicant.emailAddress || applicant.email || 'Student Email';

    setPendingAction({
      type: 'rejection',
      title: 'Decline Applicant',
      recipient: recipient,
      messageSummary: `Thank you for your interest. We regret to inform you that your application for ${scholarshipLabel} has been declined.`,
      onConfirm: async () => {
        beginApplicantStatusRequest({
          applicant,
          requestedStatus: 'Declined',
          request: (applicantId, scholarshipNo) => scholarshipAPI.declineApplicant(applicantId, scholarshipNo),
          successEvent: 'applicant_decline',
          failureMessage: 'Failed to decline applicant',
          onStart: () => {
            setViewApplicant(null);
            setSection('track');
            setTrackTab('pending');
          },
        });
      }
    });
  };

  const getStudentStatus = (id, name, currentStatus) => {
    if (currentStatus && currentStatus !== 'Unknown') return currentStatus;
    const inList = (list) => list.some((a) => a.applicant_no?.toString() === id?.toString() || a.studentContact?.email === id || a.name === name);
    if (inList(data.accepted)) return 'Accepted';
    if (inList(data.declined)) return 'Declined';
    if (inList(data.applicants)) return 'Pending';
    return 'Unknown';
  };

  const groupMessagesByStudent = (messages) => {
    const grouped = {};

    // Seed with all known applicants so rooms show up even if no messages exist yet
    const allKnownApplicants = [
      ...(data.applicants || []),
      ...(data.accepted || []),
      ...(data.rejected || []),
      ...(data.declined || []),
      ...(data.cancelled || [])
    ];
    allKnownApplicants.forEach(a => {
      const key = (a.applicant_no || a.id || '').toString();
      if (!key) return;

      const applicantRoom = a.scholarshipNo ? `${key}+${activeProviderNo}` : null;

      grouped[key] = {
        studentName: a.name || (a.firstName ? `${a.firstName} ${a.lastName}` : 'Unknown Applicant'),
        studentEmail: a.email || a.emailAddress,
        studentPhone: a.mobileNumber || a.phone,
        applicant_no: key,
        room: applicantRoom,
        messages: [],
        unreadCount: 0,
        lastMessage: {
          timestamp: a.dateApplied || a.createdAt || new Date(0).toISOString(),
          message: "No messages yet",
          studentStatus: a.status || 'Pending',
          subject: 'No conversations started yet',
          room: applicantRoom
        },
      };
    });

    sortMessages(messages).forEach((m) => {
      const key = (m.applicant_no || m.studentEmail || m.studentName || '').toString();
      if (!key) return;

      if (!grouped[key]) {
        // Find actual applicant name for this ID from local data state if not already seeded
        const applicant = allKnownApplicants.find(a =>
          a.applicant_no?.toString() === m.applicant_no?.toString() ||
          a.id?.toString() === m.applicant_no?.toString()
        );

        let initialName = m.studentName;
        if (applicant && applicant.name) {
          initialName = applicant.name;
        } else if (m.studentName === 'System' || /(?:Scholarship|Dunong) Program$/i.test(m.studentName || '')) {
          initialName = `Applicant ${m.applicant_no || ''}`;
        }

        grouped[key] = {
          studentName: initialName,
          studentEmail: m.studentEmail,
          studentPhone: m.studentPhone,
          applicant_no: m.applicant_no,
          messages: [],
          unreadCount: 0,
          lastMessage: null,
        };
      }
      grouped[key].messages.push(m);
      if (!m.read) grouped[key].unreadCount += 1;
      grouped[key].lastMessage = m;
    });

    return Object.values(grouped)
      .map((conversation) => ({
        ...conversation,
        messages: sortMessages(conversation.messages),
        lastMessage: sortMessages(conversation.messages).at(-1) || conversation.lastMessage,
      }))
      .sort((a, b) => compareMessageOrder(b.lastMessage, a.lastMessage));
  };

  const markAsRead = (messageId) => {
    setData((d) => ({
      ...d,
      inbox: d.inbox.map((m) => (m.id === messageId ? { ...m, read: true } : m)),
    }));
  };

  const markConversationAsRead = (applicantNo, room) => {
    setData((d) => ({
      ...d,
      inbox: d.inbox.map((m) => {
        const sameApplicant = applicantNo && m.applicant_no?.toString() === applicantNo?.toString();
        const sameRoom = room && m.room === room;
        return sameApplicant || sameRoom ? { ...m, read: true } : m;
      }),
    }));
  };

  const toggleStar = (messageId) => {
    setData((d) => ({
      ...d,
      inbox: d.inbox.map((m) => (m.id === messageId ? { ...m, starred: !m.starred } : m)),
    }));
  };

  const sendReply = (messageId) => {
    const room = currentMessage?.room || currentConversation?.room || (currentConversation?.applicant_no ? `${currentConversation.applicant_no}+${activeProviderNo}` : null);
    if (!replyText.trim() || !room) {
      console.warn('Cannot send reply: Missing message text or room.', { room, replyText });
      return;
    }
    socketService.sendMessage(room, userName, replyText, programName);
    setReplyText('');
  };

  const allMessages = data.inbox || [];
  const unreadCount = allMessages.filter((m) => !m.read).length;
  const conversations = useMemo(() => groupMessagesByStudent(allMessages), [allMessages]);
  const currentConversation = viewMessage?.applicant_no
    ? conversations.find((c) => c.applicant_no?.toString() === viewMessage.applicant_no?.toString())
    : null;
  const currentConversationMessages = useMemo(
    () => sortMessages(currentConversation?.messages || []),
    [currentConversation]
  );
  const currentMessage = currentConversationMessages.at(-1)
    || (viewMessage ? allMessages.find((m) => m.id === viewMessage.messageId) : null);

  useEffect(() => {
    currentInboxRoomRef.current = currentMessage?.room || null;
  }, [currentMessage]);

  useEffect(() => {
    if (section !== 'inbox' || !currentConversation) {
      return;
    }

    inboxMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [currentConversation, currentConversationMessages.length, section]);

  const filteredConversations = useMemo(() => {
    let filtered = conversations;

    // Apply status filter
    if (inboxFilter !== 'all') {
      filtered = filtered.filter((c) => {
        const studentStatus = getStudentStatus(c.studentEmail, c.studentName, c.lastMessage?.studentStatus);
        if (inboxFilter === 'pending') {
          return studentStatus === 'Pending';
        } else if (inboxFilter === 'accepted') {
          return studentStatus === 'Accepted';
        }
        return true;
      });
    } else {
      // By default, do not show Declined applicants in the inbox
      filtered = filtered.filter((c) => {
        const studentStatus = getStudentStatus(c.studentEmail, c.studentName, c.lastMessage?.studentStatus);
        return studentStatus !== 'Declined';
      });
    }

    // Apply search filter
    if (inboxSearch.trim()) {
      const q = inboxSearch.toLowerCase();
      filtered = filtered.filter((c) => {
        return (
          c.studentName.toLowerCase().includes(q) ||
          (c.studentEmail || '').toLowerCase().includes(q) ||
          c.messages.some((m) => (m.message || '').toLowerCase().includes(q))
        );
      });
    }

    return filtered;
  }, [conversations, inboxSearch, inboxFilter]);

  const renderDashboard = () => {
    return (
      <div className="space-y-8 animate-in fade-in duration-300">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[
            { label: 'Total Applicants', value: stats.total, icon: <FaUsers />, color: '#800020' },
            { label: 'Accepted Scholars', value: stats.accepted, icon: <FaCheckCircle />, color: '#16a34a' },
            { label: 'Pending Reviews', value: stats.pending, icon: <FaClock />, color: '#d97706' }
          ].map((kpi, i) => (
            <div key={i} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 hover:shadow-md transition-all">
              <div className="flex justify-between items-start mb-4">
                <div className="p-3 rounded-2xl" style={{ backgroundColor: `${kpi.color}15`, color: kpi.color }}>{kpi.icon}</div>
                <span className="text-[10px] font-black text-green-600 bg-green-50 px-2 py-1 rounded-md">LIVE</span>
              </div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{kpi.label}</p>
              <h3 className="text-3xl font-black text-gray-900 mt-1">{kpi.value}</h3>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Recent Applicants */}
          <div className="bg-white rounded-3xl shadow-md border border-gray-100 overflow-hidden">
            <div className="p-6 border-b border-gray-50 flex justify-between items-center bg-gray-50/30">
              <h3 className="font-black text-gray-900 uppercase tracking-widest text-xs">Recent Applicants</h3>
              <button onClick={() => setSection('track')} className="text-xs font-bold text-[#800020] hover:underline">View All</button>
            </div>
            <div className="divide-y divide-gray-50">
              {data.applicants.slice(0, 15).map((app, idx) => (
                <div key={idx} className="p-4 flex items-center gap-4 hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => viewApplicantFn(idx, 'all')}>
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#800020] to-[#650018] flex items-center justify-center text-white font-semibold">
                    {(app.firstName?.[0] || app.name?.[0] || '').toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between items-center mb-0.5">
                      <span className="text-sm font-black text-gray-900">{app.lastName ? `${app.firstName} ${app.lastName}` : app.name}</span>
                      <span className="text-[10px] font-bold text-[#800020] bg-rose-50 px-2 py-0.5 rounded-full">{app.course}</span>
                    </div>
                    <p className="text-xs text-gray-500 line-clamp-1">{app.street ? `${app.barangay}, ${app.municipality}` : app.location}</p>
                  </div>
                </div>
              ))}
              {data.applicants.length === 0 && (
                <div className="p-8 text-center text-gray-400 text-sm">No recent applicants found.</div>
              )}
            </div>
          </div>


          {/* Recent Messages */}
          <div className="bg-white rounded-3xl shadow-md border border-gray-100 overflow-hidden">
            <div className="p-6 border-b border-gray-50 flex justify-between items-center bg-gray-50/30">
              <h3 className="font-black text-gray-900 uppercase tracking-widest text-xs">Recent Messages</h3>
              <button onClick={() => setSection('inbox')} className="text-xs font-bold text-[#800020] hover:underline">View Inbox</button>
            </div>
            <div className="divide-y divide-gray-50">
              {allMessages.slice(0, 15).map(msg => (
                <div key={msg.id} className="p-4 flex items-center gap-4 hover:bg-gray-50 transition-colors">
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-white bg-blue-500"><FaEnvelope /></div>
                  <div className="flex-1">
                    <div className="flex justify-between items-center mb-0.5">
                      <span className="text-sm font-black text-gray-900">{msg.studentName}</span>
                      <span className="text-[10px] font-bold text-gray-400 uppercase">{formatDate(msg.timestamp)}</span>
                    </div>
                    <p className="text-xs text-gray-500 line-clamp-1">{msg.message}</p>
                  </div>
                </div>
              ))}
              {allMessages.length === 0 && (
                <div className="p-8 text-center text-gray-400 text-sm">No recent messages.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderFinder = () => {
    const openScholarships = scholarshipFinderResults.filter((post) => !post.isFull).length;
    const totalOpenSlots = scholarshipFinderResults.reduce((sum, post) => sum + (Number(post.availableSlots) || 0), 0);

    return (
      <section className="space-y-6">
        <div className="bg-white rounded-3xl shadow-md border border-gray-100 p-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
            <div className="flex-1">
              <h2 className="text-2xl font-black text-gray-900">Scholarship Slot Tracking</h2>
              <p className="text-gray-500 font-medium">Monitor open slots and matching demand for all programs</p>
            </div>
            <button
              type="button"
              onClick={() => {
                resetForm();
                setManageTab('scholarship');
                setManageMode('create');
                setSection('manage');
              }}
              className="px-5 py-3 rounded-2xl bg-[#800020] text-white font-bold shadow-sm hover:bg-[#650018] transition-colors"
            >
              Add Scholarship Post
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
              <p className="text-xs font-black uppercase tracking-widest text-emerald-700 mb-2">Open Scholarships</p>
              <p className="text-3xl font-black text-emerald-900">{openScholarships}</p>
            </div>
            <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
              <p className="text-xs font-black uppercase tracking-widest text-blue-700 mb-2">Open Slots</p>
              <p className="text-3xl font-black text-blue-900">{totalOpenSlots}</p>
            </div>
            <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
              <p className="text-xs font-black uppercase tracking-widest text-amber-700 mb-2">Visible Posts</p>
              <p className="text-3xl font-black text-amber-900">{scholarshipFinderResults.length}</p>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row gap-3 mb-6">
            <div className="flex-1 flex items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
              <FaSearch className="text-[#800020]" />
              <input
                type="text"
                value={finderSearch}
                onChange={(event) => setFinderSearch(event.target.value)}
                placeholder="Search by scholarship, location, term, or year"
                className="w-full bg-transparent outline-none text-sm font-medium text-gray-700"
              />
            </div>
            <select
              value={finderAvailabilityFilter}
              onChange={(event) => setFinderAvailabilityFilter(event.target.value)}
              className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700"
            >
              <option value="all">All Scholarships</option>
              <option value="open">Open Slots Only</option>
              <option value="full">Full Scholarships</option>
            </select>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            {scholarshipFinderResults.length > 0 ? (
              scholarshipFinderResults.map((post) => (
                <article key={post.reqNo || post.id} className="rounded-3xl border border-gray-200 bg-gradient-to-br from-white to-gray-50 p-6 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <span className={`px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider ${post.isFull ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {post.isFull ? 'Full' : `${post.availableSlots} Open Slot${post.availableSlots === 1 ? '' : 's'}`}
                        </span>
                        <span className="px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider bg-rose-100 text-[#800020]">
                          {post.semester || 'Semester TBD'} {post.year || ''}
                        </span>
                      </div>
                      <h3 className="text-xl font-black text-gray-900">{post.scholarshipName || 'Untitled Scholarship'}</h3>
                      <p className="text-sm text-gray-500 mt-1">{post.location || 'Open location criteria'}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] font-black uppercase tracking-widest text-gray-400">Deadline</p>
                      <p className="text-sm font-bold text-gray-700">{formatDate(post.deadline)}</p>
                    </div>
                  </div>

                  <p className="text-sm text-gray-600 mb-4 line-clamp-3">{post.description || 'No description provided for this scholarship post yet.'}</p>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                    <div className="rounded-2xl bg-gray-100 px-3 py-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1">Slots</p>
                      <p className="text-lg font-black text-gray-900">{post.acceptedCount}/{post.slots || 0}</p>
                    </div>
                    <div className="rounded-2xl bg-gray-100 px-3 py-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1">Pending</p>
                      <p className="text-lg font-black text-amber-700">{post.pendingCount}</p>
                    </div>
                    <div className="rounded-2xl bg-gray-100 px-3 py-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1">Declined</p>
                      <p className="text-lg font-black text-red-700">{post.declinedCount}</p>
                    </div>
                    <div className="rounded-2xl bg-gray-100 px-3 py-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1">Eligible Pool</p>
                      <p className="text-lg font-black text-[#800020]">{post.eligibleApplicantCount}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-gray-600 mb-5">
                    <span className="px-3 py-1 rounded-full bg-white border border-gray-200">Min GPA: {post.minGpa ?? 'N/A'}</span>
                    <span className="px-3 py-1 rounded-full bg-white border border-gray-200">Income Cap: {post.parentFinance ? `PHP ${Number(post.parentFinance).toLocaleString()}` : 'Open'}</span>
                    <span className="px-3 py-1 rounded-full bg-white border border-gray-200">Applicants: {post.totalApplicants}</span>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => openScholarshipInTrack(post)}
                      className="px-4 py-2 rounded-xl bg-[#800020] text-white font-bold hover:bg-[#650018] transition-colors"
                    >
                      Track Applicants
                    </button>
                    <button
                      type="button"
                      onClick={() => openScholarshipEditor(post)}
                      className="px-4 py-2 rounded-xl bg-white border border-gray-300 text-gray-700 font-bold hover:border-[#800020] hover:text-[#800020] transition-colors"
                    >
                      Edit Post
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <div className="col-span-full rounded-3xl border border-dashed border-gray-300 bg-gray-50 p-12 text-center">
                <FaSearch className="text-4xl text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-black text-gray-800 mb-2">No scholarships matched this search</h3>
                <p className="text-sm text-gray-500">Try a different keyword or switch the availability filter.</p>
              </div>
            )}
          </div>
        </div>
      </section>
    );
  };

  const renderManage = () => {
    if (manageMode === 'list') {
      return (
        <section className="bg-white p-8 rounded-2xl shadow-md border border-gray-50">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
            <div className="flex bg-gray-100 p-1 rounded-xl shadow-inner mb-4 md:mb-0">
              <button
                onClick={() => setManageTab('scholarship')}
                className={`px-6 py-2 rounded-lg font-bold text-sm transition-all ${manageTab === 'scholarship' ? 'bg-[#800020] text-white shadow-md' : 'text-gray-500 hover:text-[#800020]'}`}
              >
                Scholarship Posts
              </button>
              <button
                onClick={() => setManageTab('announcement')}
                className={`px-6 py-2 rounded-lg font-bold text-sm transition-all ${manageTab === 'announcement' ? 'bg-[#800020] text-white shadow-md' : 'text-gray-500 hover:text-[#800020]'}`}
              >
                Announcements
              </button>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
                <FaSearch className="text-[#800020]" />
                <input
                  type="text"
                  placeholder={`Search ${manageTab}s...`}
                  value={manageSearch}
                  onChange={(e) => setManageSearch(e.target.value)}
                  className="bg-transparent border-none outline-none text-xs font-medium w-32 md:w-48"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  setManageMode('create');
                }}
                className="px-4 py-2 rounded-lg bg-[#800020] text-white font-semibold flex items-center gap-2 hover:bg-[#650018] transition-colors"
              >
                <FaPlus /> {manageTab === 'scholarship' ? 'Add Post' : 'Add Announcement'}
              </button>
            </div>
          </div>

          <div className="space-y-4">
            {manageTab === 'scholarship' ? (
              filteredScholarshipPosts.length > 0 ? (
                filteredScholarshipPosts.map((post) => {
                  // Determine if scholarship is NEW (created within last 3 days)
                  let isNew = false;
                  if (post.dateCreated) {
                    const createdDate = new Date(post.dateCreated);
                    const now = new Date();
                    const diffMs = now - createdDate;
                    const diffDays = diffMs / (1000 * 60 * 60 * 24);
                    isNew = diffDays <= 3;
                  }
                  return (
                    <div key={post.reqNo || post.id} className="border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h4 className="text-lg font-semibold text-[#800020]">
                              {post.scholarshipName || post.title}
                            </h4>
                            {isNew && (
                              <span className="ml-2 px-2 py-0.5 rounded bg-yellow-200 text-yellow-900 text-xs font-bold">NEW</span>
                            )}
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-600">
                            <div><strong>Deadline:</strong> {formatDate(post.deadline)}</div>
                            <div><strong>Slots:</strong> {post.slots}</div>
                            <div><strong>Location:</strong> {post.location}</div>
                            <div><strong>Min GPA:</strong> {post.minGpa}%</div>
                            <div><strong>Term:</strong> {post.semester} {post.year}</div>
                          </div>
                          <p className="text-sm text-gray-700 mt-3 line-clamp-2">{post.description}</p>
                          <div className="text-xs text-gray-500 mt-3">
                            Date Created: {formatDate(post.dateCreated)}
                          </div>
                        </div>
                        <div className="flex gap-2 ml-4">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              editPost(post);
                            }}
                            className="p-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                            title="Edit Post"
                          >
                            <FaEdit />
                          </button>
                          <button
                            type="button"
                            onClick={() => deletePost(post.reqNo || post.id)}
                            className="p-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
                            title="Delete Post"
                          >
                            <FaTrash />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-12">
                  <FaUniversity className="text-4xl text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500">No scholarship posts yet. Create your first post!</p>
                </div>
              )
            ) : (
              filteredAnnouncements.length > 0 ? (
                filteredAnnouncements.map((ann) => (
                  <div key={ann.id} className="border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow bg-blue-50/20">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${ann.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                            {ann.status}
                          </span>
                          <div className="flex flex-col">
                            <h4 className="text-lg font-semibold text-[#800020] flex items-center gap-2">
                              {ann.title}
                              {(() => {
                                const createdDate = new Date(ann.time_added || ann.date || ann.dateCreated);
                                const diffDays = (new Date() - createdDate) / (1000 * 60 * 60 * 24);
                                return diffDays <= 3 ? (
                                  <span className="px-2 py-0.5 rounded bg-yellow-400 text-yellow-900 text-[10px] font-black uppercase tracking-tighter shadow-sm animate-pulse">NEW</span>
                                ) : null;
                              })()}
                            </h4>
                            <span className="text-[10px] text-gray-500 font-mono">ID: {ann.ann_no || ann.id || 'N/A'}</span>
                          </div>
                        </div>
                        <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{ann.content}</p>
                        {ann.announcementImages && ann.announcementImages.length > 0 && (
                          <div className="flex gap-2 mt-3 flex-wrap">
                            {ann.announcementImages.slice(0, 3).map((img, idx) => (
                              <button
                                key={idx}
                                type="button"
                                className="w-16 h-16 overflow-hidden rounded-lg border border-gray-200 bg-slate-50 cursor-pointer"
                                onClick={() => setImageModalSrc(img.url || img)}
                              >
                                <img
                                  src={img.url || img}
                                  alt="Announcement"
                                  className="w-full h-full object-contain"
                                />
                              </button>
                            ))}
                            {ann.announcementImages.length > 3 && (
                              <div className="w-16 h-16 bg-gray-100 rounded-lg border border-gray-200 flex items-center justify-center text-xs text-gray-600">
                                +{ann.announcementImages.length - 3}
                              </div>
                            )}
                          </div>
                        )}
                        <div className="text-xs text-gray-500 mt-3 flex items-center gap-1">
                          <FaClock className="text-[10px]" /> {formatDate(ann.date)}
                        </div>
                      </div>
                      <div className="flex gap-2 ml-4">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            editAnnouncement(ann);
                          }}
                          className="p-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                          title="Edit Announcement"
                        >
                          <FaEdit />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteAnnouncement(ann.ann_no || ann.id)}
                          className="p-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
                          title="Delete Announcement"
                        >
                          <FaTrash />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-12">
                  <FaRobot className="text-4xl text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500">No announcements yet. Create your first one!</p>
                </div>
              )
            )}
          </div>
        </section>
      );
    }

    return (
      <section className="bg-white p-8 rounded-2xl shadow-md border border-gray-50">
        <div className="flex items-center justify-between gap-3 mb-6">
          <h3 className="text-xl font-semibold text-[#800020]">
            {manageMode === 'edit' ? `Edit ${manageTab === 'scholarship' ? 'Scholarship Post' : 'Announcement'}` : `Create New ${manageTab === 'scholarship' ? 'Scholarship Post' : 'Announcement'}`}
          </h3>
          <button
            type="button"
            onClick={() => setManageMode('list')}
            className="px-4 py-2 rounded-lg bg-gray-500 text-white font-semibold hover:bg-gray-600 transition-colors"
          >
            ← Back to List
          </button>
        </div>

        <form className="grid grid-cols-1 md:grid-cols-2 gap-4" onSubmit={(e) => { e.preventDefault(); manageTab === 'scholarship' ? saveScholarshipPost() : saveAnnouncement(); }}>
          <div className="md:col-span-2">
            <label className="block text-sm font-semibold text-[#800020] mb-1">Title *</label>
            <input
              type="text"
              name={manageTab === 'scholarship' ? 'scholarshipName' : 'title'}
              value={manageTab === 'scholarship' ? formData.scholarshipName : formData.title}
              onChange={handleFormChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50"
              placeholder={manageTab === 'scholarship' ? scholarshipPlaceholder : "e.g. System Maintenance"}
              required
            />
          </div>

          {manageTab === 'scholarship' ? (
            <>
              <div>
                <label className="block text-sm font-semibold text-[#800020] mb-1">Deadline *</label>
                <input
                  type="date"
                  name="deadline"
                  value={formData.deadline}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#800020] mb-1">Min. GPA (%) *</label>
                <input
                  type="number"
                  name="minGpa"
                  value={formData.minGpa}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50"
                  placeholder="e.g. 85"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#800020] mb-1">Slots *</label>
                <input
                  type="number"
                  name="slots"
                  value={formData.slots}
                  onChange={handleFormChange}
                  min="1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#800020] mb-1">Location *</label>
                <input
                  type="text"
                  name="location"
                  value={formData.location}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50"
                  placeholder="Eligible location"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#800020] mb-1">Parent Income Limit (PHP)</label>
                <input
                  type="number"
                  name="parentFinance"
                  value={formData.parentFinance}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50"
                  placeholder="Maximum annual income"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#800020] mb-1">Semester for ID and COE *</label>
                <select
                  name="semester"
                  value={formData.semester}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50"
                  required
                >
                  <option value="">Select Semester</option>
                  <option value="1st">1st Semester</option>
                  <option value="2nd">2nd Semester</option>
                  <option value="3rd">3rd Semester</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#800020] mb-1">Academic Year for ID and COE*</label>
                <input
                  type="text"
                  name="year"
                  value={formData.year}
                  onChange={handleFormChange}
                  onBlur={handleAcademicYearBlur}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50"
                  placeholder="e.g. 2025-2026"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">Use the YYYY–YYYY format (e.g., 2025–2026).</p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#800020] mb-1">Semester for Grades *</label>
                <select
                  name="grades_sem"
                  value={formData.grades_sem}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50"
                  required
                >
                  <option value="">Select Semester</option>
                  <option value="1st">1st Semester</option>
                  <option value="2nd">2nd Semester</option>
                  <option value="3rd">3rd Semester</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#800020] mb-1">Year for Grades *</label>
                <input
                  type="text"
                  name="grades_year"
                  value={formData.grades_year}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50"
                  placeholder="e.g. 2024-2025"
                  required
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-semibold text-[#800020] mb-1">Description *</label>
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 min-h-[120px]"
                  placeholder="Full details about the scholarship..."
                  required
                />
              </div>
            </>
          ) : (
            <>
              <div className="md:col-span-2">
                <label className="block text-sm font-semibold text-[#800020] mb-1">Announcement Content *</label>
                <textarea
                  name="content"
                  value={formData.content}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 min-h-[150px]"
                  placeholder="Write your announcement here..."
                  required
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-semibold text-[#800020] mb-3">
                  <FaImage className="inline mr-2" />
                  Announcement Images
                </label>

                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-[#800020] transition-colors">
                  <input
                    type="file"
                    id="announcement-image-upload"
                    multiple
                    accept="image/*"
                    onChange={handleAnnouncementImageUpload}
                    className="hidden"
                  />
                  <label
                    htmlFor="announcement-image-upload"
                    className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-[#800020] text-white rounded-lg hover:bg-[#650018] transition-colors"
                  >
                    <FaUpload />
                    Choose Images
                  </label>
                  <p className="text-sm text-gray-500 mt-2">Upload announcement photos, banners, or related images</p>
                </div>

                {announcementImages.length > 0 && (
                  <div className="mt-4">
                    <h4 className="text-sm font-semibold text-[#800020] mb-2">Uploaded Images ({announcementImages.length})</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {announcementImages.map((image, i) => (
                        <div key={image.id || i} className="relative group">
                          <button
                            type="button"
                            className="w-full h-32 overflow-hidden rounded-lg border border-gray-200 bg-slate-50 cursor-pointer"
                            onClick={() => setImageModalSrc(image.preview || image.url)}
                          >
                            <img
                              src={image.preview || image.url}
                              alt={image.name || `Image ${i + 1}`}
                              className="w-full h-full object-contain"
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeAnnouncementImage(image.id || i)}
                            className="absolute top-2 right-2 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <FaTimesCircle className="text-xs" />
                          </button>
                          <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs p-1 rounded-b-lg truncate">
                            {image.name || `Image ${i + 1}`}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-semibold text-[#800020] mb-2">Send to:</label>
                <div className="flex gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="sendToAllApplicants"
                      checked={formData.sendToAllApplicants === true}
                      onChange={() => setFormData({ ...formData, sendToAllApplicants: true })}
                      className="w-4 h-4"
                    />
                    <span className="text-gray-700">All Applicants (Recommended)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="sendToAllApplicants"
                      checked={formData.sendToAllApplicants === false}
                      onChange={() => setFormData({ ...formData, sendToAllApplicants: false })}
                      className="w-4 h-4"
                    />
                    <span className="text-gray-700">{applicantsOnlyLabel}</span>
                  </label>
                </div>
              </div>
            </>
          )}

          <div className="md:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setManageMode('list')} className="px-4 py-2 rounded-lg bg-gray-500 text-white font-semibold hover:bg-gray-600 transition-colors" disabled={isSaving}>
              Cancel
            </button>
            <button type="submit" disabled={isSaving} className={`px-4 py-2 rounded-lg bg-[#800020] text-white font-semibold hover:bg-[#650018] transition-colors ${isSaving ? 'opacity-50 cursor-not-allowed' : ''}`}>
              {isSaving ? 'Saving...' : `${manageMode === 'edit' ? 'Update' : 'Publish'} ${manageTab === 'scholarship' ? 'Post' : 'Announcement'}`}
            </button>
          </div>
        </form>
      </section>
    );
  };


  const renderTrack = () => {
    const filterList = (list) => {
      return list.filter((a) => {
        const search = searchTrack.toLowerCase();
        const matchesSearch =
          a.name.toLowerCase().includes(search) ||
          (a.school && a.school.toLowerCase().includes(search)) ||
          (a.municipality && a.municipality.toLowerCase().includes(search)) ||
          (a.course && a.course.toLowerCase().includes(search)) ||
          (a.barangay && a.barangay.toLowerCase().includes(search)) ||
          (a.address && a.address.toLowerCase().includes(search)) ||
          (a.mobileNumber && a.mobileNumber.toLowerCase().includes(search));
        const matchesScholarship = matchesScholarshipSelection(a, trackScholarshipFilter);
        const matchesCourse = courseTrackFilter === 'all' || a.course === courseTrackFilter;

        return matchesSearch && matchesScholarship && matchesCourse;
      });
    };

    const pendingTagged = prioritizeProcessingApplicants(filterList(data.applicants)).map((a) => ({ ...a, _listType: 'pending', _listIdx: data.applicants.indexOf(a) }));
    const acceptedTagged = filterList(data.accepted).map((a, i) => ({ ...a, _listType: 'accepted', _listIdx: data.accepted.indexOf(a) }));
    const rejectedTagged = filterList(data.rejected).map((a, i) => ({ ...a, _listType: 'rejected', _listIdx: data.rejected.indexOf(a) }));
    const cancelledTagged = filterList(data.cancelled).map((a, i) => ({ ...a, _listType: 'cancelled', _listIdx: data.cancelled.indexOf(a) }));
    const allList = [...pendingTagged, ...acceptedTagged, ...rejectedTagged, ...cancelledTagged];
    const acceptedList = acceptedTagged;
    const rejectedList = rejectedTagged;
    const cancelledList = cancelledTagged;

    return (
      <section className="bg-white p-8 rounded-2xl shadow-md border border-gray-50">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <h3 className="text-xl font-semibold text-[#800020]">{trackTitle}</h3>
          {trackScholarshipFilter !== 'all' && trackScholarshipFilter !== 'deleted' && (
            <button
              type="button"
              onClick={recommendStudents}
              className="px-4 py-2 rounded-lg bg-[#800020] text-white font-semibold flex items-center gap-2 hover:bg-[#650018] transition-colors"
            >
              <FaRobot /> Recommended Student Applicants
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mb-4 justify-between items-center">
          <div className="flex gap-2">
            {['all', 'pending', 'accepted', 'rejected', 'cancelled'].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTrackTab(t)}
                className={`px-4 py-2 rounded-lg font-semibold flex items-center gap-2 ${trackTab === t ? 'bg-[#800020] text-white' : 'bg-[#800020]/10 text-[#800020] border border-[#800020]'
                  }`}
              >
                {t === 'pending' && <FaClock />}
                {t === 'all' && <FaUsers />}
                {t === 'accepted' && <FaCheckCircle />}
                {t === 'rejected' && <FaTimesCircle />}
                {t === 'cancelled' && <FaTrashAlt />}
                {t === 'pending' ? 'Pending' : t === 'all' ? 'All Applicants' : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => exportToExcel('track')}
            className="px-4 py-2 rounded-lg bg-green-600 text-white font-semibold flex items-center gap-2 hover:bg-green-700 transition-colors shadow-sm"
          >
            <FaFileExcel /> Export Tracking List
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-4 mb-6">
          <div className="flex items-center gap-2 bg-gray-50 px-4 py-3 rounded-xl border border-gray-200 flex-1 max-w-md shadow-sm">
            <FaSearch className="text-[#800020]" />
            <input
              type="text"
              placeholder="Search by name, school, or address..."
              value={searchTrack}
              onChange={(e) => setSearchTrack(e.target.value)}
              className="bg-transparent border-none outline-none w-full text-sm font-medium"
            />
          </div>
          <select
            value={trackScholarshipFilter}
            onChange={(e) => setTrackScholarshipFilter(e.target.value)}
            className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none font-bold text-[#800020] shadow-sm focus:ring-2 focus:ring-[#800020] transition-all"
          >
            <option value="all">All Scholarship Types</option>
            {scholarshipFilterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-y-auto rounded-xl border border-gray-200" style={{ maxHeight: 'calc(100vh - 500px)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#800020] text-white">
                <th className="px-4 py-3 text-left font-semibold">Name</th>
                <th className="px-4 py-3 text-left font-semibold">Grade</th>
                <th className="px-4 py-3 text-left font-semibold">Financial</th>
                <th className="px-4 py-3 text-left font-semibold">School & Course</th>
                <th className="px-4 py-3 text-left font-semibold">Contact & Address</th>
                <th className="px-4 py-3 text-left font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {trackTab === 'pending' &&
                pendingTagged.map((a, i) => {
                  const idx = a._listIdx;
                  const processingState = getApplicantProcessingState(a);
                  return (
                    <tr key={`pending-${a.applicant_no}`} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-mono">#{a.applicant_no}</span>
                          <div className="font-semibold">{a.name}</div>
                        </div>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">Pending</span>
                      </td>
                      <td className="px-4 py-3">{a.grade}</td>
                      <td className="px-4 py-3">{getFinancialStatusLabel(a.income || a.financial_income_of_parents || a.family?.grossIncome)}</td>
                      <td className="px-4 py-3 text-xs">
                        <div className="font-bold text-[#800020]">{a.school}</div>
                        <div className="text-[10px] text-gray-500 font-medium">{a.course || 'No Course Provided'}</div>
                      </td>
                      <td className="px-4 py-3 text-[10px] leading-tight text-gray-600">{a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'}<br />{a.municipality || 'N/A'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <button type="button" onClick={() => viewApplicantFn(idx, 'all')} className="px-3 py-1 rounded bg-[#800020] text-white text-xs font-semibold hover:bg-[#650018] transition-colors">
                            View
                          </button>
                          {processingState && (
                            <span className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[#800020]">
                              <FaSpinner className="animate-spin text-xs" />
                              {processingState.requestedStatus === 'Accepted' ? 'Approving' : 'Rejecting'}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}

              {trackTab === 'all' &&
                allList.map((a, i) => {
                  const statusColors = { pending: 'bg-yellow-100 text-yellow-700', accepted: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-700', cancelled: 'bg-gray-100 text-gray-700' };
                  const statusLabels = { pending: 'Pending', accepted: 'Accepted', rejected: 'Rejected', cancelled: 'Cancelled' };
                  const processingState = getApplicantProcessingState(a);
                  return (
                    <tr key={`all-${a.applicant_no}`} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-mono">#{a.applicant_no}</span>
                          <div className="font-semibold">{a.name}</div>
                          {processingState && <FaSpinner className="animate-spin text-[#800020] text-xs" />}
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusColors[a._listType] || 'bg-yellow-100 text-yellow-700'}`}>{statusLabels[a._listType] || 'Pending'}</span>
                      </td>
                      <td className="px-4 py-3">{a.grade}</td>
                      <td className="px-4 py-3">{getFinancialStatusLabel(a.income || a.financial_income_of_parents || a.family?.grossIncome)}</td>
                      <td className="px-4 py-3 text-xs">
                        <div className="font-bold text-[#800020]">{a.school}</div>
                        <div className="text-[10px] text-gray-500 font-medium">{a.course || 'No Course Provided'}</div>
                      </td>
                      <td className="px-4 py-3 text-[10px] leading-tight text-gray-600">{a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'}<br />{a.municipality || 'N/A'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <button type="button" onClick={() => viewApplicantFn(a._listIdx, a._listType)} className="px-3 py-1 rounded bg-[#800020] text-white text-xs font-semibold hover:bg-[#650018] transition-colors" disabled={!!processingState}>
                            View
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

              {trackTab === 'accepted' &&
                acceptedList.map((a) => {
                  const idx = a._listIdx;
                  return (
                    <tr key={`accepted-${a.applicant_no}`} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-4 py-3 flex items-center gap-2">
                        {a.name}
                        {getApplicantProcessingState(a) && <FaSpinner className="animate-spin text-[#800020] text-xs" />}
                      </td>
                      <td className="px-4 py-3">{a.grade}</td>
                      <td className="px-4 py-3">{getFinancialStatusLabel(a.income || a.financial_income_of_parents || a.family?.grossIncome)}</td>
                      <td className="px-4 py-3 text-xs">
                        <div className="font-bold text-[#800020]">{a.school}</div>
                        <div className="text-[10px] text-gray-500 font-medium">{a.course || 'No Course Provided'}</div>
                      </td>
                      <td className="px-4 py-3 text-[10px] leading-tight text-gray-600">{a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'}<br />{a.municipality || 'N/A'}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button type="button" onClick={() => viewApplicantFn(idx, 'accepted')} className="px-3 py-1 rounded bg-[#800020] text-white text-xs font-semibold hover:bg-[#650018] transition-colors">
                            View
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

              {trackTab === 'rejected' &&
                rejectedList.map((a) => {
                  const idx = a._listIdx;
                  return (
                    <tr key={`rejected-${a.applicant_no}`} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-4 py-3 flex items-center gap-2">
                        {a.name}
                        {getApplicantProcessingState(a) && <FaSpinner className="animate-spin text-[#800020] text-xs" />}
                      </td>
                      <td className="px-4 py-3">{a.grade}</td>
                      <td className="px-4 py-3">{getFinancialStatusLabel(a.income || a.financial_income_of_parents || a.family?.grossIncome)}</td>
                      <td className="px-4 py-3 text-xs">
                        <div className="font-bold text-[#800020]">{a.school}</div>
                        <div className="text-[10px] text-gray-500 font-medium">{a.course || 'No Course Provided'}</div>
                      </td>
                      <td className="px-4 py-3 text-[10px] leading-tight text-gray-600">{a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'}<br />{a.municipality || 'N/A'}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button type="button" onClick={() => viewApplicantFn(idx, 'rejected')} className="px-3 py-1 rounded bg-[#800020] text-white text-xs font-semibold hover:bg-[#650018] transition-colors">
                            View
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

              {trackTab === 'cancelled' &&
                cancelledList.map((a) => {
                  const idx = a._listIdx;
                  return (
                    <tr key={`cancelled-${a.applicant_no}`} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-4 py-3 flex items-center gap-2">
                        {a.name}
                        {getApplicantProcessingState(a) && <FaSpinner className="animate-spin text-[#800020] text-xs" />}
                      </td>
                      <td className="px-4 py-3">{a.grade}</td>
                      <td className="px-4 py-3">{getFinancialStatusLabel(a.income || a.financial_income_of_parents || a.family?.grossIncome)}</td>
                      <td className="px-4 py-3 text-xs">
                        <div className="font-bold text-[#800020]">{a.school}</div>
                        <div className="text-[10px] text-gray-500 font-medium">{a.course || 'No Course Provided'}</div>
                      </td>
                      <td className="px-4 py-3 text-[10px] leading-tight text-gray-600">{a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'}<br />{a.municipality || 'N/A'}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button type="button" onClick={() => viewApplicantFn(idx, 'cancelled')} className="px-3 py-1 rounded bg-[#800020] text-white text-xs font-semibold hover:bg-[#650018] transition-colors">
                            View
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

      </section>
    );
  };

  const exportToExcel = (type = 'report') => {
    const { applicants, accepted, declined } = data;

    if (type === 'track') {
      const filterListToExport = (list) => list.filter((a) => {
        const search = searchTrack.toLowerCase();
        const matchesSearch =
          a.name.toLowerCase().includes(search) ||
          (a.school && a.school.toLowerCase().includes(search)) ||
          (a.municipality && a.municipality.toLowerCase().includes(search)) ||
          (a.course && a.course.toLowerCase().includes(search)) ||
          (a.barangay && a.barangay.toLowerCase().includes(search)) ||
          (a.address && a.address.toLowerCase().includes(search)) ||
          (a.mobileNumber && a.mobileNumber.toLowerCase().includes(search));
        const matchesScholarship = matchesScholarshipSelection(a, trackScholarshipFilter);

        return matchesSearch && matchesScholarship;
      });

      const fileName = `${reportFilePrefix}_Tracking_Full_${new Date().toISOString().split('T')[0]}`;
      const wb = XLSX.utils.book_new();

      const formatTracking = (list) => list.map(app => ({
        'Student Name': app.name,
        'Grade': app.grade,
        'Financial Status': getFinancialStatusLabel(app.income || app.family?.grossIncome),
        'School': app.school,
        'Contact No.': app.mobileNumber || app.phone || (app.studentContact && app.studentContact.phone) || 'N/A',
        'Address': app.municipality || 'N/A',
        'Course': app.course
      }));

      const activeScholarshipName = trackScholarshipFilter === 'all'
        ? 'All scholarship types'
        : (scholarshipFilterOptions.find(o => o.value === trackScholarshipFilter)?.label || scholarshipLabel);

      const addHeaderToSheet = (list, sheetName) => {
        const ws = XLSX.utils.aoa_to_sheet([[sidebarTitle, activeScholarshipName], [`Report: ${sheetName}`], [`Generated: ${new Date().toLocaleString()}`], []]);
        const formattedData = formatTracking(list);
        XLSX.utils.sheet_add_json(ws, formattedData, { origin: 'A5' });

        // Auto-width adjustment
        ws['!cols'] = autoAdjustColumnWidths(formattedData);

        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      };

      addHeaderToSheet(filterListToExport(applicants), 'Pending Review');
      addHeaderToSheet(filterListToExport(accepted), 'Accepted Scholars');
      addHeaderToSheet(filterListToExport(declined), 'Declined - Cancelled');

      XLSX.writeFile(wb, `${fileName}.xlsx`);
      return;
    }

    // Helper to format applicant data for Excel
    const formatApplicants = (list) => list.map(app => ({
      'Student Name': app.name || `${app.firstName} ${app.lastName}`,
      'Scholarship Name': app.scholarshipName || 'N/A',
      'Grade': app.grade || 'N/A',
      'Financial Status': getFinancialStatusLabel(app.income || app.family?.grossIncome),
      'School': app.school || 'N/A',
      'Contact No.': app.mobileNumber || app.phone || app.studentContact?.phone || 'N/A',
      'Address': app.municipality || 'N/A'
    }));

    const activeScholarshipName = analyticsScholarshipFilter === 'all'
      ? 'All scholarship types'
      : (scholarshipFilterOptions.find(o => o.value === analyticsScholarshipFilter)?.label || scholarshipLabel);

    const createSheetWithHeader = (list, title) => {
      const ws = XLSX.utils.aoa_to_sheet([[sidebarTitle, activeScholarshipName], [title], [`Date: ${new Date().toLocaleDateString()}`], []]);
      const formattedData = formatApplicants(list);
      XLSX.utils.sheet_add_json(ws, formattedData, { origin: 'A5' });
      ws['!cols'] = autoAdjustColumnWidths(formattedData);
      return ws;
    };

    // Create worksheets for Applicant Statuses
    const acceptedWS = createSheetWithHeader(filteredReportApplicants.accepted, 'Accepted Scholars');
    const declinedWS = createSheetWithHeader(filteredReportApplicants.declined, 'Declined Applicants');
    const pendingWS = createSheetWithHeader(filteredReportApplicants.pending, 'Pending Applications');

    // Create worksheet for Location Stats
    const locationData = filteredHistoricalData.locationStats.map(item => ({
      Barangay: item.location,
      Count: item.count,
      Percentage: `${item.percentage}%`
    }));
    const locationWS = XLSX.utils.json_to_sheet(locationData);

    // Create worksheet for Course Distribution
    const courseWS = XLSX.utils.json_to_sheet(filteredHistoricalData.courseDistribution.map(item => ({
      Course: item.course,
      Count: item.count,
      Percentage: `${item.percentage}%`
    })));

    // Create worksheet for Performance Metrics
    const metricsData = [
      { Metric: 'Acceptance Rate', Value: `${filteredHistoricalData.performanceMetrics.acceptanceRate}%` },
      { Metric: 'Avg. Processing Time', Value: `${filteredHistoricalData.performanceMetrics.averageProcessingTime} days` },
      { Metric: 'Application Completion Rate', Value: `${filteredHistoricalData.performanceMetrics.applicationCompletionRate}%` }
    ];
    const metricsWS = XLSX.utils.json_to_sheet(metricsData);

    // Create worksheet for Monthly Trends
    const trendsWS = XLSX.utils.json_to_sheet(filteredHistoricalData.monthlyApplications);

    // Create worksheet for School Stats
    const schoolWS = XLSX.utils.json_to_sheet(filteredHistoricalData.schoolStats.map(item => ({
      School: item.school,
      Count: item.count,
      Percentage: `${item.percentage}%`
    })));

    // Create workbook and append sheets
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, acceptedWS, 'Accepted Scholars');
    const rejectedWS = XLSX.utils.json_to_sheet(formatTracking(data.rejected));
    const cancelledWS = XLSX.utils.json_to_sheet(formatTracking(data.cancelled));
    XLSX.utils.book_append_sheet(wb, rejectedWS, 'Rejected Applicants');
    XLSX.utils.book_append_sheet(wb, cancelledWS, 'Cancelled Applications');
    XLSX.utils.book_append_sheet(wb, pendingWS, 'Pending Applicants');
    XLSX.utils.book_append_sheet(wb, locationWS, 'Location Statistics');
    XLSX.utils.book_append_sheet(wb, courseWS, 'Course Distribution');
    XLSX.utils.book_append_sheet(wb, schoolWS, 'School Distribution');
    XLSX.utils.book_append_sheet(wb, metricsWS, 'Performance Metrics');
    XLSX.utils.book_append_sheet(wb, trendsWS, 'Monthly Trends');

    // Export the workbook
    XLSX.writeFile(wb, `${reportFilePrefix}_Scholarship_Report.xlsx`);
  };

  const renderReports = () => {
    const historicalData = filteredHistoricalData;
    const { pending: filteredPending, accepted: filteredAccepted, rejected: filteredRejected, cancelled: filteredCancelled, all: filteredApplicants } = filteredReportApplicants;
    const monthlyStats = generateMonthlyStats(filteredApplicants);

    const kpiCards = [
      { label: 'Total Applicants', value: filteredApplicants.length.toLocaleString(), trend: '+12.5%', color: 'blue' },
      { label: 'New Applicants', value: filteredPending.length.toLocaleString(), trend: '+5.2%', color: 'green' },
      { label: 'Accepted', value: filteredAccepted.length.toLocaleString(), trend: '+8.1%', color: 'purple' },
      { label: 'Rejected', value: filteredRejected.length.toLocaleString(), trend: '-2.4%', color: 'red' },
      { label: 'Cancelled', value: filteredCancelled.length.toLocaleString(), trend: '0.0%', color: 'gray' },
      { label: 'Avg. Processing', value: `${historicalData.performanceMetrics?.averageProcessingTime || 0}d`, trend: '-0.5d', color: 'amber' },
    ];

    return (
      <div className="space-y-6">
        {/* Header with Export Buttons */}
        <div className="flex items-center justify-between gap-3 flex-wrap report-header relative">
          <div>
            <h3 className="text-2xl font-bold text-[#800020] report-title">{reportTitle}</h3>
            <p className="text-gray-500 text-sm report-subtitle">Comprehensive KPI report and periodic trends</p>
            <p className="print-only text-[10px] text-gray-400 mt-2 font-bold italic">Generated on: {new Date().toLocaleString()}</p>
          </div>

          {/* Print-only Logo positioned at top right */}
          <div className="print-only absolute right-0 top-0">
            <img src={iskomatsLogo} alt="Iskomats Logo" className="h-14 w-auto object-contain opacity-90" />
          </div>
          <div className="flex gap-4 items-center flex-wrap">
            <div className="flex bg-gray-100 p-1 rounded-xl">
              <button
                onClick={() => setReportsView('analytics')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${reportsView === 'analytics' ? 'bg-white text-[#800020] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >Analytics</button>
              <button
                onClick={() => setReportsView('tables')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${reportsView === 'tables' ? 'bg-white text-[#800020] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >Tables</button>
            </div>
            <select
              value={analyticsScholarshipFilter}
              onChange={(e) => setAnalyticsScholarshipFilter(e.target.value)}
              className="px-4 py-2 bg-white border border-gray-200 rounded-xl text-xs font-bold text-[#800020] shadow-sm focus:ring-2 focus:ring-[#800020] transition-all outline-none"
            >
              <option value="all">All Scholarship Types</option>
              {scholarshipFilterOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={exportToExcel}
                className="px-6 py-2 rounded-xl bg-white border border-gray-200 text-gray-700 font-bold flex items-center gap-2 hover:bg-gray-50 transition-all shadow-sm"
              >
                <FaPrint className="text-green-600" /> Export to Excel
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="px-6 py-2 rounded-xl bg-[#800020] text-white font-bold flex items-center gap-2 hover:opacity-90 transition-all shadow-lg"
              >
                <FaPrint /> Print PDF
              </button>
            </div>
          </div>
        </div>

        {reportsView === 'analytics' ? (
          <>
            {/* Top KPI Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {kpiCards.map((card) => (
                <div key={card.label} className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center text-center">
                  <span className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-2">{card.label}</span>
                  <span className="text-2xl font-black text-gray-800 mb-1">{card.value}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${card.trend.startsWith('+') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                    {card.trend}
                  </span>
                </div>
              ))}
            </div>

            {/* Dashboard Overview Section */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-6">
              <div className="lg:col-span-4 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <h4 className="text-lg font-bold text-gray-800 mb-6">Status Overview</h4>
                <div className="h-[250px]">
                  <canvas ref={pieRef} />
                </div>
              </div>
              <div className="lg:col-span-8 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <h4 className="text-lg font-bold text-gray-800 mb-6">Efficiency Analytics</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div className="p-4 bg-rose-50 rounded-xl border border-rose-100">
                      <p className="text-xs font-black text-[#800020] uppercase mb-1">Processing Efficiency</p>
                      <h3 className="text-2xl font-black text-gray-800">{historicalData.performanceMetrics.averageProcessingTime} days</h3>
                      <p className="text-[10px] text-gray-500 font-bold">Average time from application to decision</p>
                    </div>
                    <div className="p-4 bg-green-50 rounded-xl border border-green-100">
                      <p className="text-xs font-black text-green-700 uppercase mb-1">Completion Rate</p>
                      <h3 className="text-2xl font-black text-gray-800">{historicalData.performanceMetrics.applicationCompletionRate}%</h3>
                      <p className="text-[10px] text-gray-500 font-bold">Successfully submitted applications</p>
                    </div>
                  </div>

                </div>
              </div>
            </div>

            {/* Charts Middle Row */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Monthly Trends - Line Chart */}
              <div className="lg:col-span-5 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <div className="flex justify-between items-center mb-6">
                  <h4 className="text-lg font-bold text-gray-800">Monthly Applications</h4>
                  <div className="flex gap-4 text-xs font-bold uppercase tracking-tighter text-gray-400">
                    <span className="flex items-center gap-1"><div className="w-3 h-1 bg-[#800020] rounded"></div> Apps</span>
                    <span className="flex items-center gap-1"><div className="w-3 h-1 bg-[#198754] rounded"></div> Pass</span>
                  </div>
                </div>
                <div className="h-[280px]">
                  <canvas ref={lineChartRef} />
                </div>
              </div>

              {/* Grade Distribution - Bar Chart */}
              <div className="lg:col-span-4 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <h4 className="text-lg font-bold text-gray-800 mb-6 font-primary">Grade Distribution</h4>
                <div className="h-[280px]">
                  <canvas ref={barChartRef} />
                </div>
              </div>

              {/* Course Distribution - Doughnut */}
              <div className="lg:col-span-3 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <h4 className="text-lg font-bold text-gray-800 mb-6">Course Distribution</h4>
                <div className="h-[220px] mb-4">
                  <canvas ref={courseChartRef} />
                </div>
                <div className="space-y-1 mt-4">
                  {historicalData.courseDistribution.slice(0, 3).map((c, i) => (
                    <div key={c.course} className="flex items-center justify-between text-[10px] font-bold">
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: ['#800020', '#650018', '#a00028', '#c44569'][i % 4] }}></div>
                        <span className="text-gray-500 truncate max-w-[80px]">{c.course}</span>
                      </div>
                      <span className="text-gray-800">{c.percentage}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-6">
              {/* Location Split - Doughnut */}
              <div className="lg:col-span-4 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <h4 className="text-lg font-bold text-gray-800 mb-6">Location Split</h4>
                <div className="h-[220px]">
                  <canvas ref={locationChartRef} />
                </div>
              </div>

              {/* Financial Background - Doughnut */}
              <div className="lg:col-span-4 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <h4 className="text-lg font-bold text-gray-800 mb-6">Financial Background</h4>
                <div className="h-[220px]">
                  <canvas ref={financialChartRef} />
                </div>
              </div>

              {/* Quick Status Insight */}
              <div className="lg:col-span-4 bg-[#800020] p-6 rounded-2xl shadow-lg text-white flex flex-col justify-center">
                <h4 className="text-xl font-black mb-2 uppercase tracking-tight">Report Status</h4>
                <p className="text-rose-100/80 text-sm mb-4">High volume of applications from urban areas this month.</p>
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-white/10 pb-2">
                    <span className="text-xs font-bold text-rose-200">Top Barangay</span>
                    <span className="font-black">{historicalData.locationStats?.[0]?.location || 'N/A'}</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-white/10 pb-2">
                    <span className="text-xs font-bold text-rose-200">Leading Source</span>
                    <span className="font-black text-xs truncate max-w-[120px]">{historicalData.schoolStats?.[0]?.school || 'N/A'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* School Distribution Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <h4 className="text-lg font-bold text-gray-800 mb-6 font-primary">School Distribution</h4>
                <div className="flex flex-col md:flex-row gap-6 items-center">
                  <div className="h-[250px] w-full md:w-1/2">
                    <canvas ref={schoolChartRef} />
                  </div>
                  <div className="w-full md:w-1/2 space-y-3">
                    {historicalData.schoolStats.map((s, i) => (
                      <div key={s.school} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: ['#800020', '#198754', '#0d6efd', '#ffc107', '#6c757d'][i % 5] }}></div>
                          <span className="text-sm font-bold text-gray-600 truncate max-w-[150px]">{s.school}</span>
                        </div>
                        <span className="text-sm font-black text-gray-800">{s.percentage}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="bg-blue-50/50 p-6 rounded-2xl border border-blue-100 flex flex-col justify-center">
                <h4 className="text-[#800020] font-black text-xl mb-3">Academic Partner Insights</h4>
                <p className="text-gray-700 leading-relaxed mb-4">
                  {historicalData.schoolStats?.length > 0 ? (
                    <>
                      Current data shows that <strong>{historicalData.schoolStats?.[0]?.school}</strong> remains the primary source of applicants for the {scholarshipLabel}, contributing to {historicalData.schoolStats?.[0]?.percentage}% of the total application volume.
                    </>
                  ) : (
                    "No school distribution data available yet."
                  )}
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white p-4 rounded-xl border border-blue-100">
                    <p className="text-[10px] font-black text-gray-400 uppercase">Top Institution</p>
                    <p className="font-bold text-gray-800 truncate text-xs">{historicalData.schoolStats?.[0]?.school || 'N/A'}</p>
                  </div>
                  <div className="bg-white p-4 rounded-xl border border-blue-100">
                    <p className="text-[10px] font-black text-gray-400 uppercase">Institutional Diversity</p>
                    <p className="font-bold text-gray-800">{historicalData.schoolStats.length} Schools</p>
                  </div>
                </div>
              </div>
            </div>

          </>
        ) : (
          <>
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Monthly Trends Table */}
                <div className="lg:col-span-7 bg-white p-6 rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                  <h4 className="text-lg font-bold text-gray-800 mb-6">Monthly Applications</h4>
                  <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 500px)' }}>
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 bg-gray-50">
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="px-4 py-3 font-bold text-gray-500 uppercase tracking-widest text-[10px]">Month</th>
                          <th className="px-4 py-3 font-bold text-gray-500 uppercase tracking-widest text-[10px]">Applications</th>
                          <th className="px-4 py-3 font-bold text-gray-500 uppercase tracking-widest text-[10px]">Accepted</th>
                          <th className="px-4 py-3 font-bold text-gray-500 uppercase tracking-widest text-[10px]">Declined</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {monthlyStats.map((m) => (
                          <tr key={m.month} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 font-semibold text-[#800020]">{m.month}</td>
                            <td className="px-4 py-3 font-bold">{m.applications}</td>
                            <td className="px-4 py-3 text-green-600 font-semibold">{m.accepted}</td>
                            <td className="px-4 py-3 text-red-600 font-semibold">{m.declined}</td>
                          </tr>
                        ))}
                        {monthlyStats.length === 0 && (
                          <tr>
                            <td colSpan="4" className="px-4 py-8 text-center text-gray-500">
                              No applications found for the selected period
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Performance Metrics Table */}
                <div className="lg:col-span-5 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                  <h4 className="text-lg font-bold text-gray-800 mb-6">Performance Details</h4>
                  <div className="space-y-4">
                    {[
                      { label: 'Acceptance Rate', value: `${historicalData.performanceMetrics.acceptanceRate}%`, color: 'bg-green-500' },
                      { label: 'Avg. Processing Time', value: `${historicalData.performanceMetrics.averageProcessingTime} days`, color: 'bg-blue-500' },
                      { label: 'Application Completion', value: `${historicalData.performanceMetrics.applicationCompletionRate}%`, color: 'bg-purple-500' },
                    ].map((metric) => (
                      <div key={metric.label} className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100">
                        <span className="font-bold text-gray-600 text-sm">{metric.label}</span>
                        <div className="flex items-center gap-4">
                          <span className="text-lg font-black text-gray-800">{metric.value}</span>
                          <div className={`w-2 h-8 rounded-full ${metric.color}`}></div>
                        </div>
                      </div>
                    ))}
                    <div className="mt-6 p-4 bg-blue-50/50 rounded-xl border border-blue-100 italic text-[11px] text-blue-800 leading-relaxed">
                      "Trends indicate an efficiency boost in the last quarter, reducing average processing time by 12% across all scholarship categories."
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Course Distribution Table */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                  <h4 className="text-lg font-bold text-gray-800 mb-6">Course Distribution</h4>
                  <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 500px)' }}>
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 bg-gray-50">
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="px-4 py-3 font-bold text-gray-500 uppercase tracking-widest text-[10px]">Course</th>
                          <th className="px-4 py-3 font-bold text-gray-500 uppercase tracking-widest text-[10px]">Count</th>
                          <th className="px-4 py-3 font-bold text-gray-500 uppercase tracking-widest text-[10px]">%</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {historicalData.courseDistribution.map((c) => (
                          <tr key={c.course} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 font-semibold text-[#800020]">{c.course}</td>
                            <td className="px-4 py-3">{c.count}</td>
                            <td className="px-4 py-3 font-bold">{c.percentage}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Grade Distribution Table */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                  <h4 className="text-lg font-bold text-gray-800 mb-6">Grade Distribution</h4>
                  <div className="overflow-x-auto max-h-60">
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 bg-gray-50">
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="px-4 py-3 font-bold text-gray-500 uppercase tracking-widest text-[10px]">Grade Range</th>
                          <th className="px-4 py-3 font-bold text-gray-500 uppercase tracking-widest text-[10px]">Count</th>
                          <th className="px-4 py-3 font-bold text-gray-500 uppercase tracking-widest text-[10px]">%</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {historicalData.gradeRanges.map((g) => (
                          <tr key={g.range} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 font-semibold text-[#800020]">{g.range}</td>
                            <td className="px-4 py-3">{g.count}</td>
                            <td className="px-4 py-3 font-bold">{g.percentage}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Financial Breakdown Table */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                  <h4 className="text-lg font-bold text-gray-800 mb-6">Financial Background</h4>
                  <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 500px)' }}>
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 bg-gray-50">
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="px-4 py-3 font-bold text-gray-500 uppercase tracking-widest text-[10px]">Level</th>
                          <th className="px-4 py-3 font-bold text-gray-500 uppercase tracking-widest text-[10px]">Count</th>
                          <th className="px-4 py-3 font-bold text-gray-500 uppercase tracking-widest text-[10px]">%</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {historicalData.financialBreakdown.map((f) => (
                          <tr key={f.level} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 font-semibold text-[#800020]">{f.level}</td>
                            <td className="px-4 py-3">{f.count}</td>
                            <td className="px-4 py-3 font-bold">{f.percentage}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6">
                {/* Location Stats Table */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                  <h4 className="text-lg font-bold text-gray-800 mb-6">Location Analytics</h4>
                  <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 500px)' }}>
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 bg-gray-50">
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="px-4 py-3 font-bold text-gray-500 uppercase tracking-widest text-[10px]">Barangay</th>
                          <th className="px-4 py-3 font-bold text-gray-500 uppercase tracking-widest text-[10px]">Applicants</th>
                          <th className="px-4 py-3 font-bold text-gray-500 uppercase tracking-widest text-[10px]">% Distribution</th>
                          <th className="px-4 py-3 font-bold text-gray-500 uppercase tracking-widest text-[10px]">Trend</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {historicalData.locationStats.map((loc) => (
                          <tr key={loc.location} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 font-semibold text-[#800020]">{loc.location}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${loc.count > 15 ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                                {loc.count}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="flex-1 bg-gray-100 rounded-full h-1.5 max-w-[100px]">
                                  <div className="bg-[#800020] h-1.5 rounded-full" style={{ width: `${loc.percentage}%` }}></div>
                                </div>
                                <span className="font-bold text-[10px] text-gray-700">{loc.percentage}%</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 font-bold text-green-600 text-[10px]">{loc.percentage > 5 ? '↑ HIGH' : '→ STABLE'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* School Analytics Table */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                  <h4 className="text-lg font-bold text-gray-800 mb-6">School Distribution Table</h4>
                  <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 500px)' }}>
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 bg-gray-50">
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="px-4 py-3 font-bold text-gray-500 uppercase tracking-widest text-[10px]">Institution / School</th>
                          <th className="px-4 py-3 font-bold text-gray-500 uppercase tracking-widest text-[10px]">Applicants</th>
                          <th className="px-4 py-3 font-bold text-gray-500 uppercase tracking-widest text-[10px]">% Distribution</th>
                          <th className="px-4 py-3 font-bold text-gray-500 uppercase tracking-widest text-[10px]">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {historicalData.schoolStats.map((s) => (
                          <tr key={s.school} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 font-semibold text-[#800020] uppercase text-[11px]">{s.school}</td>
                            <td className="px-4 py-3 font-bold">{s.count}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="flex-1 bg-gray-100 rounded-full h-1.5 min-w-[80px]">
                                  <div className="bg-green-600 h-1.5 rounded-full" style={{ width: `${s.percentage}%` }}></div>
                                </div>
                                <span className="font-bold">{s.percentage}%</span>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${s.percentage > 20 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                                {s.percentage > 20 ? 'PRIMARY' : 'SECONDARY'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* DETAILED APPLICANT LISTS TABLES */}
              <div className="space-y-8 mt-10">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b-2 border-gray-100 pb-2">
                  <h4 className="text-xl font-black text-[#800020] uppercase">Applicant Status Lists</h4>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setReportTab('pending')}
                      className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${reportTab === 'pending' ? 'bg-amber-600 text-white shadow-md' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                    >
                      PENDING
                    </button>
                    <button
                      onClick={() => setReportTab('accepted')}
                      className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${reportTab === 'accepted' ? 'bg-green-600 text-white shadow-md' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                    >
                      ACCEPTED
                    </button>
                    <button
                      onClick={() => setReportTab('rejected')}
                      className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${reportTab === 'rejected' ? 'bg-red-600 text-white shadow-md' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                    >
                      REJECTED
                    </button>
                    <button
                      onClick={() => setReportTab('cancelled')}
                      className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${reportTab === 'cancelled' ? 'bg-slate-600 text-white shadow-md' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                    >
                      CANCELLED
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-8">
                  {/* Pending Applicants */}
                  {reportTab === 'pending' && (
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <h5 className="text-sm font-black text-amber-600 uppercase mb-4 flex items-center gap-2">
                        <FaClock /> Pending Review ({filteredPending.length})
                      </h5>
                      <div className="overflow-x-auto max-h-72">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead><tr className="bg-gray-50 border-y border-gray-100"><th className="p-3 font-bold text-gray-500 uppercase">Student Name</th><th className="p-3 font-bold text-gray-500 uppercase">Grade</th><th className="p-3 font-bold text-gray-500 uppercase">Financial</th><th className="p-3 font-bold text-gray-500 uppercase">Contact & Address</th></tr></thead>
                          <tbody className="divide-y divide-gray-100">
                            {filteredPending.map((a) => (
                              <tr key={a.id || a.applicant_no || a.name} className="hover:bg-gray-50"><td className="p-3 font-bold text-gray-800">{a.name}</td><td className="p-3">{a.grade}</td><td className="p-3">{getFinancialStatusLabel(a.income || a.financial_income_of_parents || a.family?.grossIncome)}</td><td className="p-3">{a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'} - {a.municipality || 'N/A'}</td></tr>
                            ))}
                            {filteredPending.length === 0 && <tr><td colSpan="4" className="p-4 text-center text-gray-400 italic">No pending applicants found for this scholarship</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Accepted Scholars */}
                  {reportTab === 'accepted' && (
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <h5 className="text-sm font-black text-green-600 uppercase mb-4 flex items-center gap-2">
                        <FaCheckCircle /> Accepted Scholars ({filteredAccepted.length})
                      </h5>
                      <div className="overflow-x-auto max-h-72">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead><tr className="bg-gray-50 border-y border-gray-100"><th className="p-3 font-bold text-gray-500 uppercase">Student Name</th><th className="p-3 font-bold text-gray-500 uppercase">Grade</th><th className="p-3 font-bold text-gray-500 uppercase">Financial</th><th className="p-3 font-bold text-gray-500 uppercase">Contact & Address</th></tr></thead>
                          <tbody className="divide-y divide-gray-100">
                            {filteredAccepted.map((a) => (
                              <tr key={a.id || a.applicant_no || a.name} className="hover:bg-gray-50"><td className="p-3 font-bold text-gray-800">{a.name}</td><td className="p-3">{a.grade}</td><td className="p-3">{getFinancialStatusLabel(a.income || a.financial_income_of_parents || a.family?.grossIncome)}</td><td className="p-3">{a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'} - {a.municipality || 'N/A'}</td></tr>
                            ))}
                            {filteredAccepted.length === 0 && <tr><td colSpan="4" className="p-4 text-center text-gray-400 italic">No accepted scholars found for this scholarship</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Rejected Applicants */}
                  {reportTab === 'rejected' && (
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <h5 className="text-sm font-black text-red-600 uppercase mb-4 flex items-center gap-2">
                        <FaTimesCircle /> Rejected Applicants ({filteredRejected.length})
                      </h5>
                      <div className="overflow-x-auto max-h-72">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead><tr className="bg-gray-50 border-y border-gray-100"><th className="p-3 font-bold text-gray-500 uppercase">Student Name</th><th className="p-3 font-bold text-gray-500 uppercase">Grade</th><th className="p-3 font-bold text-gray-500 uppercase">Financial</th><th className="p-3 font-bold text-gray-500 uppercase">Contact & Address</th></tr></thead>
                          <tbody className="divide-y divide-gray-100">
                            {filteredRejected.map((a) => (
                              <tr key={a.id || a.applicant_no || a.name} className="hover:bg-gray-50"><td className="p-3 font-bold text-gray-800">{a.name}</td><td className="p-3">{a.grade}</td><td className="p-3">{getFinancialStatusLabel(a.income || a.financial_income_of_parents || a.family?.grossIncome)}</td><td className="p-3">{a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'} - {a.municipality || 'N/A'}</td></tr>
                            ))}
                            {filteredRejected.length === 0 && <tr><td colSpan="4" className="p-4 text-center text-gray-400 italic">No rejected applicants found for this scholarship</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {/* DEDICATED PRINT-ONLY TABLE REPORT */}
        <div className="print-only mt-12 space-y-10">
          <div className="flex items-center justify-between border-b-2 border-gray-200 pb-6 mb-8">
            <div className="flex items-center gap-6">
              <div className="w-20 h-20 rounded-2xl bg-white p-3 flex items-center justify-center shadow-lg border border-gray-100">
                <img src={iskomatsLogo} alt="Iskomats Logo" className="w-full h-full object-contain" />
              </div>
              <div>
                <h2 className="text-3xl font-black text-[#800020] tracking-tighter uppercase leading-none mb-1">iskoMats</h2>
                <p className="text-xs font-bold text-gray-500 tracking-[0.3em] uppercase opacity-70">Unified Scholarship System</p>
              </div>
            </div>
            <div className="text-right">
              <h4 className="text-xl font-bold text-gray-800 uppercase tracking-widest">{scholarshipLabel} Report</h4>
              <p className="text-xs font-bold text-gray-400">{new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
            </div>
          </div>

          {/* EXECUTIVE SUMMARY KPIs */}
          <div className="grid grid-cols-4 gap-4 mb-10">
            <div className="border-2 border-gray-100 p-4 rounded-2xl text-center">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Total Applicants</p>
              <h4 className="text-2xl font-black text-gray-900">{data.applicants.length + data.accepted.length + data.rejected.length + data.cancelled.length}</h4>
            </div>
            <div className="border-2 border-gray-100 p-4 rounded-2xl text-center">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Acceptance Rate</p>
              <h4 className="text-2xl font-black text-green-600">{historicalData.performanceMetrics.acceptanceRate}%</h4>
            </div>
            <div className="border-2 border-gray-100 p-4 rounded-2xl text-center">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Avg. Processing</p>
              <h4 className="text-2xl font-black text-blue-600">{historicalData.performanceMetrics.averageProcessingTime}d</h4>
            </div>
            <div className="border-2 border-gray-100 p-4 rounded-2xl text-center">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Completion Rate</p>
              <h4 className="text-2xl font-black text-amber-600">{historicalData.performanceMetrics.applicationCompletionRate}%</h4>
            </div>
          </div>

          <div className="mb-6">
            <h4 className="text-sm font-black text-gray-900 uppercase tracking-[0.2em] border-b-2 border-gray-100 pb-2 inline-block">Detailed Analytics & Distribution</h4>
          </div>

          <div className="space-y-8">
            <section className="report-section">
              <h5 className="text-sm font-black text-[#800020] uppercase mb-4 border-l-4 border-[#800020] pl-3">Monthly Application Trends</h5>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border p-3 text-left">Month</th>
                    <th className="border p-3 text-left">Applications</th>
                    <th className="border p-3 text-left">Accepted</th>
                    <th className="border p-3 text-left">Declined</th>
                  </tr>
                </thead>
                <tbody>
                  {historicalData.monthlyApplications.map((m) => (
                    <tr key={m.month}>
                      <td className="border p-3 font-semibold">{m.month}</td>
                      <td className="border p-3">{m.applications}</td>
                      <td className="border p-3 text-green-700">{m.accepted}</td>
                      <td className="border p-3 text-red-700">{m.rejected}</td>
                      <td className="border p-3 text-gray-600">{m.cancelled}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="report-section">
              <h5 className="text-sm font-black text-[#800020] uppercase mb-4 border-l-4 border-[#800020] pl-3">Course Distribution</h5>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border p-3 text-left">Course / Program</th>
                    <th className="border p-3 text-left">Applicant Count</th>
                    <th className="border p-3 text-left">Percentage</th>
                  </tr>
                </thead>
                <tbody>
                  {historicalData.courseDistribution.map((c) => (
                    <tr key={c.course}>
                      <td className="border p-3 font-semibold">{c.course}</td>
                      <td className="border p-3">{c.count}</td>
                      <td className="border p-3 font-bold">{c.percentage}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="report-section">
              <h5 className="text-sm font-black text-[#800020] uppercase mb-4 border-l-4 border-[#800020] pl-3">Grade Distribution</h5>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border p-3 text-left">Grade Range</th>
                    <th className="border p-3 text-left">Applicant Count</th>
                    <th className="border p-3 text-left">Percentage</th>
                  </tr>
                </thead>
                <tbody>
                  {historicalData.gradeRanges.map((g) => (
                    <tr key={g.range}>
                      <td className="border p-3 font-semibold">{g.range}</td>
                      <td className="border p-3">{g.count}</td>
                      <td className="border p-3 font-bold">{g.percentage}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="report-section">
              <h5 className="text-sm font-black text-[#800020] uppercase mb-4 border-l-4 border-[#800020] pl-3">School Distribution</h5>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border p-3 text-left">Institution Name</th>
                    <th className="border p-3 text-left">Applicants</th>
                    <th className="border p-3 text-left">Percentage</th>
                  </tr>
                </thead>
                <tbody>
                  {historicalData.schoolStats.map((s) => (
                    <tr key={s.school}>
                      <td className="border p-3 font-semibold">{s.school}</td>
                      <td className="border p-3">{s.count}</td>
                      <td className="border p-3 font-bold">{s.percentage}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="report-section">
              <h5 className="text-sm font-black text-[#800020] uppercase mb-4 border-l-4 border-[#800020] pl-3">Location Analytics (Barangay)</h5>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border p-3 text-left">Location</th>
                    <th className="border p-3 text-left">Amount</th>
                    <th className="border p-3 text-left">Distribution</th>
                  </tr>
                </thead>
                <tbody>
                  {historicalData.locationStats.map((loc) => (
                    <tr key={loc.location}>
                      <td className="border p-3 font-semibold">{loc.location}</td>
                      <td className="border p-3">{loc.count}</td>
                      <td className="border p-3 font-bold">{loc.percentage}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="print-break-before">
              <h5 className="text-sm font-black text-[#800020] uppercase mb-4 border-l-4 border-[#800020] pl-3">Pending Applicants Review</h5>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border p-2 text-left">Student Name</th>
                    <th className="border p-2 text-left">Grade</th>
                    <th className="border p-2 text-left">Financial Status</th>
                    <th className="border p-2 text-left">Contact & Address</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPending.map((a) => (
                    <tr key={a.id || a.applicant_no || a.name}>
                      <td className="border p-2 font-bold">{a.name}</td>
                      <td className="border p-2">{a.grade}</td>
                      <td className="border p-2">{getFinancialStatusLabel(a.income || a.financial_income_of_parents || a.family?.grossIncome)}</td>
                      <td className="border p-2">{a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'} - {a.municipality || 'N/A'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="print-break-before">
              <h5 className="text-sm font-black text-[#800020] uppercase mb-4 border-l-4 border-[#800020] pl-3">Accepted Scholars List</h5>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border p-2 text-left">Student Name</th>
                    <th className="border p-2 text-left">Grade</th>
                    <th className="border p-2 text-left">Financial Status</th>
                    <th className="border p-2 text-left">Contact & Address</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAccepted.map((a) => (
                    <tr key={a.id || a.applicant_no || a.name}>
                      <td className="border p-2 font-bold">{a.name}</td>
                      <td className="border p-2">{a.grade}</td>
                      <td className="border p-2">{getFinancialStatusLabel(a.income || a.financial_income_of_parents || a.family?.grossIncome)}</td>
                      <td className="border p-2">{a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'} - {a.municipality || 'N/A'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="print-break-before">
              <h5 className="text-sm font-black text-[#800020] uppercase mb-4 border-l-4 border-[#800020] pl-3">Rejected / Cancelled Applicants</h5>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border p-2 text-left">Student Name</th>
                    <th className="border p-2 text-left">Grade</th>
                    <th className="border p-2 text-left">Financial Status</th>
                    <th className="border p-2 text-left">Contact & Address</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRejected.concat(filteredCancelled).map((a) => (
                    <tr key={a.id || a.applicant_no || a.name}>
                      <td className="border p-2 font-bold">{a.name}</td>
                      <td className="border p-2">{a.grade}</td>
                      <td className="border p-2">{getFinancialStatusLabel(a.income || a.financial_income_of_parents || a.family?.grossIncome)}</td>
                      <td className="border p-2">{a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'} - {a.municipality || 'N/A'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>

          <div className="mt-16 pt-8 border-t border-gray-100 flex justify-between items-end">
            <div className="text-left">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Certified Correct By</p>
              <div className="h-10 w-48 border-b-2 border-gray-900/10 mb-2"></div>
              <p className="text-xs font-black text-gray-900">{administratorTitle}</p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderViewApplicant = () => {
    if (!viewApplicant) return null;
    const { listType, index } = viewApplicant;

    // Use 'a' as the applicant object throughout
    // 'all' and 'pending' both refer to data.applicants (pending applicants list)
    const list = (listType === 'all' || listType === 'pending') ? data.applicants : data[listType];
    if (!list) return null;
    const a = list[index];
    if (!a) return null;
    const isPending = listType === 'all' || listType === 'pending';
    const dispatchKey = getApplicantDispatchKey(a);

    // Normalize family data for display
    const familyData = {
      father: {
        name: a.fatherName || a.family?.father?.name || 'N/A',
        status: a.fatherStatus || a.family?.father?.status || 'Living',
        job: a.fatherOccupation || a.family?.father?.job || 'N/A',
        phone: a.fatherPhone || a.family?.father?.phone || 'N/A'
      },
      mother: {
        name: a.motherName || a.family?.mother?.name || 'N/A',
        status: a.motherStatus || a.family?.mother?.status || 'Living',
        job: a.motherOccupation || a.family?.mother?.job || 'N/A',
        phone: a.motherPhone || a.family?.mother?.phone || 'N/A'
      },
      grossIncome: a.income || a.family?.grossIncome || 'N/A',
      siblingsCount: a.siblingNo ?? a.family?.siblingsCount ?? '0'
    };

    const renderMediaGrid = (files) => {
      if (!files || files.length === 0) return <p className="text-gray-400 italic text-xs">No documents uploaded</p>;
      return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {files.map((f, idx) => (
            <div key={idx} className="relative group cursor-pointer border rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-all">
              <DecryptedMedia
                src={f.src}
                type={f.type}
                className="w-full h-28 object-contain bg-gray-100 group-hover:scale-105 transition-transform"
                controls={true}
                onClick={() => setImageModalSrc(f.src)}
              />
              <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] py-0.5 text-center font-bold">
                {f.type.startsWith('image') ? 'IMAGE' : 'VIDEO'}
              </div>
            </div>
          ))}
        </div>
      );
    };

    return (
      <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-5xl mx-auto my-4 overflow-y-auto max-h-[90vh]">
        <div className="flex items-center justify-between mb-8 pb-6 border-b-2 border-[#800020]">
          <div className="flex items-center gap-6">
            <div className="w-20 h-20 rounded-2xl bg-gray-50 border-2 border-gray-100 p-1 shadow-sm overflow-hidden flex-shrink-0">
              {a.profile_picture ? (
                <DecryptedMedia src={a.profile_picture} type="image/jpeg" className="w-full h-full object-cover rounded-xl" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gray-200 text-gray-400">
                  <FaUsers className="text-2xl" />
                </div>
              )}
              {/* School ID No. display under profile picture */}
              <div className="mt-2 text-center">
                <span className="block text-[10px] font-black text-gray-400 uppercase">School ID No.</span>
                <span className="block font-bold text-gray-800">{a.school_id_no || 'N/A'}</span>
              </div>
            </div>
            <div>
              <h2 className="text-2xl font-black text-[#800020] uppercase tracking-tight flex items-center gap-2 mb-1">
                {a.name || `${a.firstName} ${a.lastName}`}
                {getApplicantProcessingState(a) && <FaSpinner className="animate-spin text-sm" />}
              </h2>
              <div className="flex items-center gap-2">
                <span className="bg-[#800020] text-white px-3 py-1 rounded-lg text-xs font-black font-mono shadow-sm tracking-widest">APPLICANT ID: {a.applicant_no || 'N/A'}</span>
                {/* Removed 'Awaiting Review' label as per requirements */}
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-2">
            <span className={`flex items-center justify-center px-4 py-1.5 rounded-full text-xs font-bold uppercase ${
              listType === 'accepted' ? 'bg-green-100 text-green-700' :
              listType === 'rejected' ? 'bg-red-100 text-red-700' :
              listType === 'cancelled' ? 'bg-gray-100 text-gray-700' :
              'bg-yellow-100 text-yellow-700'
            }`}>
              {listType === 'accepted' ? 'Accepted' :
               listType === 'rejected' ? 'Rejected' :
               listType === 'cancelled' ? 'Cancelled' :
               'Pending Review'}
            </span>
            <div className="flex gap-2 mb-4">
              <button
                type="button"
                onClick={() => handleSendSchoolVerification(a)}
                disabled={schoolVerifSent[dispatchKey]}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm ${schoolVerifSent[dispatchKey] ? 'bg-green-100 text-green-700 cursor-default' : 'bg-[#800020] text-white hover:bg-[#650018]'}`}
              >
                <FaPaperPlane /> {schoolVerifSent[dispatchKey] ? 'School Dispatch Sent' : 'Send for School Verification'}
              </button>
              <button
                type="button"
                onClick={() => handleSendIndigencyVerification(a)}
                disabled={indigencyVerifSent[dispatchKey]}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm ${indigencyVerifSent[dispatchKey] ? 'bg-green-100 text-green-700 cursor-default' : 'bg-[#800020] text-white hover:bg-[#650018]'}`}
              >
                <FaPaperPlane /> {indigencyVerifSent[dispatchKey] ? 'City Hall Dispatch Sent' : 'Verify Indigency (City Hall)'}
              </button>
            </div>
            <button
              onClick={() => { setViewApplicant(null); setSection('track'); }}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <FaTimesCircle className="text-gray-400 text-xl" />
            </button>
          </div>
        </div>

        {/* STUDENT INFORMATION SECTION */}
        <div className="mb-10">
          <h3 className="bg-[#800020] text-white px-4 py-2 text-sm font-black uppercase tracking-widest mb-4 rounded-t-lg">Student Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 border-2 border-gray-100 rounded-b-lg overflow-hidden">
            <div className="p-4 border-b md:border-b-0 md:border-r border-gray-100 bg-gray-50/50">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Last Name</p>
              <p className="font-bold text-gray-800">{a.lastName || (a.name && a.name.split(' ').pop())}</p>
            </div>
            <div className="p-4 border-b md:border-b-0 md:border-r border-gray-100 bg-gray-50/50">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">First Name</p>
              <p className="font-bold text-gray-800">{a.firstName || (a.name && a.name.split(' ')[0])}</p>
            </div>
            <div className="p-4 border-b md:border-b-0 md:border-r border-gray-100 bg-gray-50/50">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Middle Name</p>
              <p className="font-bold text-gray-800">{a.middleName || 'N/A'}</p>
            </div>
            <div className="p-4 bg-gray-50/50">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Maiden Name</p>
              <p className="font-bold text-gray-800">{a.maidenName || 'N/A'}</p>
            </div>

            <div className="p-4 border-t border-r border-gray-100">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Street &amp; Barangay</p>
              <p className="font-bold text-gray-800">{a.streetBrgy || (a.location && a.location.split(',')[0]) || 'N/A'}</p>
            </div>
            <div className="p-4 border-t border-r border-gray-100">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Town/City/Municipality</p>
              <p className="font-bold text-gray-800">{a.municipality || 'N/A'}</p>
            </div>
            <div className="p-4 border-t border-r border-gray-100">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Province</p>
              <p className="font-bold text-gray-800">{a.province || 'N/A'}</p>
            </div>
            <div className="p-4 border-t border-gray-100">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Zip Code</p>
              <p className="font-bold text-gray-800">{a.zipCode || 'N/A'}</p>
            </div>

            <div className="p-4 border-t border-r border-gray-100">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Date of Birth</p>
              <p className="font-bold text-gray-800">{a.dob || 'N/A'}</p>
            </div>
            <div className="p-4 border-t border-r border-gray-100">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Place of Birth</p>
              <p className="font-bold text-gray-800">{a.pob || 'N/A'}</p>
            </div>
            <div className="p-4 border-t border-r border-gray-100">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Sex</p>
              <p className="font-bold text-gray-800">{a.sex || 'N/A'}</p>
            </div>
            <div className="p-4 border-t border-gray-100">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Citizenship</p>
              <p className="font-bold text-gray-800">{a.citizenship || 'Filipino'}</p>
            </div>

            <div className="p-4 border-t border-r border-gray-100 col-span-2">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">E-mail Address</p>
              <p className="font-bold text-gray-800 truncate">{a.emailAddress || a.email || (a.studentContact && a.studentContact.email) || 'N/A'}</p>
            </div>
            <div className="p-4 border-t border-r border-gray-100">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Mobile Number</p>
              <p className="font-bold text-gray-800">{a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'}</p>
            </div>
            <div className="p-4 border-t border-gray-100">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Course</p>
              <p className="font-bold text-gray-800">{a.course || 'N/A'}</p>
            </div>

            <div className="p-4 border-t border-r border-gray-100 col-span-2">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">School Attended</p>
              <p className="font-bold text-gray-800">{a.school || 'N/A'}</p>
            </div>
            <div className="p-4 border-t border-r border-gray-100 col-span-2">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">School Location</p>
              <p className="font-bold text-gray-800">{a.schoolAddress || 'N/A'}</p>
            </div>
            <div className="p-4 border-t border-r border-gray-100">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">School ID Number</p>
              <p className="font-bold text-gray-800">{a.school_id_no || 'N/A'}</p>
            </div>
            <div className="p-4 border-t border-gray-100">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Year Level</p>
              <p className="font-bold text-gray-800">{a.year || 'N/A'}</p>
            </div>

            <div className="p-4 border-t border-gray-100">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">School Sector</p>
              <p className="font-bold text-gray-800">{a.schoolSector || 'N/A'}</p>
            </div>

            <div className="p-4 border-t border-gray-100 col-span-2">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Year for Grades</p>
              <p className="font-bold text-gray-800">{a.grades_year || 'N/A'}</p>
            </div>

          </div>
        </div>

        {/* FAMILY BACKGROUND SECTION */}
        <div className="mb-10">
          <h3 className="bg-[#800020] text-white px-4 py-2 text-sm font-black uppercase tracking-widest mb-4 rounded-t-lg">Family Background</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 border-2 border-gray-100 rounded-lg overflow-hidden">
            <div className="p-4 border-b md:border-b-0 md:border-r border-gray-100 bg-gray-50/50">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-3">Father Information</p>
              <div className="space-y-2">
                <p className="text-sm"><strong>Name:</strong> {familyData.father.name}</p>
                <div className="flex gap-4 text-xs font-bold items-center">
                  <span>Status:</span>
                  <span className="flex items-center gap-1.5">
                    <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${familyData.father.status === 'Living' ? 'bg-[#800020] border-[#800020]' : 'border-gray-300'}`}>
                      {familyData.father.status === 'Living' && <div className="w-1.5 h-1.5 rounded-full bg-white"></div>}
                    </div>
                    Living
                  </span>
                  <span className="flex items-center gap-1.5">
                    <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${familyData.father.status === 'Deceased' ? 'bg-[#800020] border-[#800020]' : 'border-gray-300'}`}>
                      {familyData.father.status === 'Deceased' && <div className="w-1.5 h-1.5 rounded-full bg-white"></div>}
                    </div>
                    Deceased
                  </span>
                </div>
                <p className="text-sm"><strong>Occupation:</strong> {familyData.father.job}</p>
                <p className="text-sm"><strong>Phone:</strong> {familyData.father.phone}</p>
              </div>
            </div>
            <div className="p-4 bg-gray-50/50">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-3">Mother Information</p>
              <div className="space-y-2">
                <p className="text-sm"><strong>Name:</strong> {familyData.mother.name}</p>
                <div className="flex gap-4 text-xs font-bold items-center">
                  <span>Status:</span>
                  <span className="flex items-center gap-1.5">
                    <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${familyData.mother.status === 'Living' ? 'bg-[#800020] border-[#800020]' : 'border-gray-300'}`}>
                      {familyData.mother.status === 'Living' && <div className="w-1.5 h-1.5 rounded-full bg-white"></div>}
                    </div>
                    Living
                  </span>
                  <span className="flex items-center gap-1.5">
                    <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${familyData.mother.status === 'Deceased' ? 'bg-[#800020] border-[#800020]' : 'border-gray-300'}`}>
                      {familyData.mother.status === 'Deceased' && <div className="w-1.5 h-1.5 rounded-full bg-white"></div>}
                    </div>
                    Deceased
                  </span>
                </div>
                <p className="text-sm"><strong>Occupation:</strong> {familyData.mother.job}</p>
                <p className="text-sm"><strong>Phone:</strong> {familyData.mother.phone}</p>
              </div>
            </div>
            <div className="p-4 border-t border-r border-gray-100">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Parents Gross Income</p>
              <p className="font-bold text-[#800020]">PHP {familyData.grossIncome}</p>
            </div>
            <div className="p-4 border-t border-gray-100">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">No. of Siblings</p>
              <p className="font-bold text-gray-800">{familyData.siblingsCount}</p>
            </div>
          </div>
        </div>

        {/* DOCUMENTS SECTION */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h3 className="bg-[#800020] text-white px-4 py-2 text-sm font-black uppercase tracking-widest rounded-lg">Uploaded Documents</h3>
            <div className="flex gap-3">
              <div className="bg-yellow-50 border border-yellow-200 px-3 py-1 rounded-full flex items-center gap-2">
                <span className="text-[10px] font-black text-[#800020] uppercase">Avg Grade:</span>
                <span className="text-sm font-black text-gray-800">{a.grade}</span>
              </div>
              <div className="bg-rose-50 border border-rose-200 px-3 py-1 rounded-full flex items-center gap-2">
                <span className="text-[10px] font-black text-[#800020] uppercase">Income:</span>
                <span className="text-sm font-black text-gray-800">
                  {getFinancialStatusLabel(a.income || a.financial_income_of_parents || a.family?.grossIncome)}
                </span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 border-2 border-gray-100 rounded-lg">
            <div className="space-y-2">
              <p className="text-[10px] font-black text-gray-500 uppercase flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#800020]"></span> Indigency Proof
              </p>
              <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
                {renderMediaGrid(a.indigencyFiles)}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-[10px] font-black text-gray-500 uppercase flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#800020]"></span> Enrollment Certificate
              </p>
              <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
                {renderMediaGrid(a.certificateFiles)}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-[10px] font-black text-gray-500 uppercase flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#800020]"></span> Grades / Transcript
              </p>
              <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
                {renderMediaGrid(a.gradesFiles)}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-[10px] font-black text-gray-500 uppercase flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#800020]"></span> ID (Front & Back)
              </p>
              <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
                {renderMediaGrid(a.idFiles)}
              </div>
            </div>
          </div>
        </div>


        {/* SIGNATURE SECTION */}
        <div className="mt-12 pt-8 border-t-2 border-dashed border-gray-200">
          <div className="flex flex-col md:flex-row items-center justify-between gap-8 text-center md:text-left">
            <div className="max-w-xs w-full">
              <div className="border-b-2 border-gray-300 mb-2 h-20 flex items-center justify-center overflow-hidden">
                {a.signature ? (
                  <DecryptedMedia
                    src={a.signature}
                    type="image/png"
                    className="max-h-full cursor-zoom-in hover:scale-110 transition-transform"
                    onClick={() => setImageModalSrc(a.signature)}
                  />
                ) : (
                  <span className="text-gray-300 italic text-sm">No signature on file</span>
                )}
              </div>
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Signature over Printed Name of Applicant</p>
              <p className="font-bold text-gray-800 text-sm italic underline">{a.firstName} {a.lastName}</p>
            </div>

            <div className="max-w-xs w-full">
              <div className="border-b-2 border-gray-300 mb-2 h-20 flex items-end justify-center pb-2">
                <p className="font-bold text-gray-800">{new Date().toLocaleDateString()}</p>
              </div>
              <p className="text-[10px] font-black text-gray-400 uppercase">Date Accomplished</p>
            </div>
          </div>
          <p className="text-center text-[10px] text-gray-400 italic mt-8 font-medium">
            I hereby certify that the foregoing statements are true and correct.
          </p>
        </div>

        <div className="sticky bottom-0 bg-white/80 backdrop-blur-md pt-6 mt-8 border-t border-gray-100 flex gap-3 justify-end">
          {isPending && (
            <>
              <button
                type="button"
                onClick={acceptApplicant}
                disabled={Boolean(getApplicantProcessingState(a))}
                className="px-8 py-3 rounded-xl bg-green-600 text-white font-black uppercase tracking-widest text-xs hover:bg-green-700 shadow-lg shadow-green-100 transition-all flex items-center gap-2 disabled:cursor-not-allowed disabled:bg-green-300 disabled:shadow-none"
              >
                <FaCheckCircle /> Approve
              </button>
              <button
                type="button"
                onClick={declineApplicant}
                disabled={Boolean(getApplicantProcessingState(a))}
                className="px-8 py-3 rounded-xl bg-red-600 text-white font-black uppercase tracking-widest text-xs hover:bg-red-700 shadow-lg shadow-red-100 transition-all flex items-center gap-2 disabled:cursor-not-allowed disabled:bg-red-300 disabled:shadow-none"
              >
                <FaTimesCircle /> Decline
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => { setViewApplicant(null); setSection('track'); }}
            className="px-8 py-3 rounded-xl bg-gray-100 text-gray-600 font-black uppercase tracking-widest text-xs hover:bg-gray-200 transition-all"
          >
            Close Dossier
          </button>
        </div>
      </section>
    );
  };


  const renderInbox = () => (
    <div className="flex flex-col h-[calc(100vh-8rem)] bg-gradient-to-br from-gray-50 to-blue-50/30">
      <div className="relative overflow-hidden bg-gradient-to-br from-[#800020] via-[#650018] to-[#a00028] rounded-2xl shadow-xl p-6 text-white mb-4">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.06\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] opacity-80" />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <FaInbox className="text-xl text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold">{messengerTitle}</h2>
              <p className="text-white/90 text-sm">Hello, {userFirstName}! {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}</p>
            </div>
          </div>
          <button type="button" onClick={() => setSection('track')} className="px-4 py-2 rounded-lg bg-white/20 hover:bg-white/30 transition-colors text-white font-medium">
            ← Track
          </button>
        </div>
      </div>

      <div className="flex-1 flex gap-4 overflow-hidden">
        <div className="w-80 flex-shrink-0 bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col">
          <div className="p-4 border-b border-gray-100">
            <div className="flex items-center gap-2 mb-3">
              <FaSearch className="text-gray-400" />
              <input
                type="text"
                placeholder="Search conversations..."
                value={inboxSearch}
                onChange={(e) => setInboxSearch(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#800020] text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setInboxFilter('all')}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${inboxFilter === 'all'
                  ? 'bg-[#800020] text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
              >
                All
              </button>
              <button
                onClick={() => setInboxFilter('pending')}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${inboxFilter === 'pending'
                  ? 'bg-yellow-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
              >
                Pending
              </button>
              <button
                onClick={() => setInboxFilter('accepted')}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${inboxFilter === 'accepted'
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
              >
                Accepted
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filteredConversations.length > 0 ? (
              <div className="divide-y divide-gray-100">
                {filteredConversations.map((conv) => {
                  const isActive = currentConversation && currentConversation.applicant_no?.toString() === conv.applicant_no?.toString();
                  return (
                    <div
                      key={conv.studentEmail || conv.studentName}
                      onClick={() => {
                        const room = conv.room || (conv.messages.length > 0 ? conv.messages[0].room : conv.lastMessage?.room);
                        if (room) {
                          markConversationAsRead(conv.applicant_no, room);
                          setViewMessage({
                            messageId: conv.lastMessage?.id || `new-${conv.applicant_no}`,
                            applicant_no: conv.applicant_no
                          });
                          socketService.loadHistory(room);
                        } else {
                          console.warn('No room found for conversation:', conv);
                          // Fallback room construction if room is still missing
                          const fallbackRoom = `${conv.applicant_no}+${activeProviderNo}`;
                          markConversationAsRead(conv.applicant_no, fallbackRoom);
                          setViewMessage({
                            messageId: `new-${conv.applicant_no}`,
                            applicant_no: conv.applicant_no
                          });
                          socketService.loadHistory(fallbackRoom);
                        }
                      }}
                      className={`p-4 cursor-pointer transition-colors border-l-4 ${isActive
                        ? 'bg-blue-100 border-l-4 border-[#800020] shadow-sm'
                        : `border-l-4 border-transparent hover:bg-blue-50/50 ${conv.unreadCount > 0 ? 'bg-blue-50/30' : ''}`
                        }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#800020] to-[#650018] flex items-center justify-center text-white font-semibold flex-shrink-0">
                          {conv.studentName.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-semibold text-gray-900 truncate text-sm">{conv.studentName}</span>
                            {conv.unreadCount > 0 && (
                              <span className="ml-2 px-2 py-0.5 bg-blue-600 text-white text-xs font-bold rounded-full flex-shrink-0">
                                {conv.unreadCount}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-gray-100 text-gray-700 border border-gray-200">
                              {getStudentStatus(conv.studentEmail, conv.studentName, conv.lastMessage?.studentStatus)}
                            </span>
                            <p className="text-xs text-gray-600 truncate mb-1 flex-1">{conv.lastMessage?.subject || ''}</p>
                          </div>
                          <span className="text-xs text-gray-400">{conv.lastMessage ? formatDate(conv.lastMessage.timestamp) : ''}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 px-6">
                <FaInbox className="text-4xl text-gray-300 mb-3" />
                <p className="text-gray-500 text-sm text-center">{inboxSearch ? 'No conversations found' : 'No messages yet'}</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col overflow-hidden">
          {currentConversation && currentMessage ? (
            <>
              <div className="p-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#800020] to-[#650018] flex items-center justify-center text-white font-semibold">
                    {currentConversation.studentName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{currentConversation.studentName}</h3>
                    <p className="text-xs text-gray-500">{currentConversation.studentEmail}</p>
                    <p className="text-[10px] text-gray-500">
                      Status: <span className="font-semibold">{getStudentStatus(currentConversation.studentEmail, currentConversation.studentName, currentConversation.lastMessage?.studentStatus)}</span>
                    </p>
                  </div>
                </div>
                <button type="button" onClick={() => setViewMessage(null)} className="text-sm text-gray-600 hover:text-[#800020]">
                  ← Back
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {currentConversationMessages.map((msg) => {
                  const isFromMe = msg.is_student_sender === false || adminSenderAliases.has(normalizeProviderIdentity(msg.username || msg.studentName));
                  return (
                    <div key={msg.id} className={`flex ${isFromMe ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] rounded-2xl p-4 shadow-sm border ${isFromMe
                        ? 'bg-[#800020] text-white border-[#800020]'
                        : 'bg-gray-50 text-gray-900 border-gray-200'
                        }`}>
                        <div className="flex items-center justify-between mb-2 gap-8">
                          <span className={`font-semibold text-xs ${isFromMe ? 'text-white/90' : 'text-[#800020]'}`}>
                            {isFromMe ? 'Me' : (msg.studentName || msg.username || 'Applicant')}
                          </span>
                          <span className={`text-[10px] flex items-center gap-1 ${isFromMe ? 'text-white/70' : 'text-gray-500'}`}>
                            <FaClock className="text-[10px]" /> {formatDate(msg.timestamp)}
                          </span>
                        </div>
                        <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.message}</p>
                        {!isFromMe && (
                          <div className="mt-2 flex items-center justify-end">
                            <button
                              type="button"
                              onClick={() => toggleStar(msg.id)}
                              className={`p-1.5 rounded-lg transition-colors ${msg.starred ? 'text-yellow-500 bg-yellow-50' : 'text-gray-300 hover:bg-gray-100'}`}
                            >
                              <FaStar size={12} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={inboxMessagesEndRef} />
              </div>

              <div className="p-4 border-t border-gray-200 bg-gray-50">
                <div className="flex gap-2">
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Type a message..."
                    className="flex-1 px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#800020] resize-none"
                    rows={2}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (replyText.trim()) sendReply(currentMessage.id);
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => sendReply(currentMessage.id)}
                    disabled={!replyText.trim()}
                    className="px-6 py-3 rounded-xl bg-[#800020] text-white font-semibold hover:bg-[#650018] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    <FaPaperPlane /> Send
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center px-6">
                <FaInbox className="text-6xl text-gray-300 mx-auto mb-4" />
                <h3 className="text-xl font-bold text-gray-800 mb-2">Select a conversation</h3>
                <p className="text-gray-500">All applicants (pending/accepted/rejected/cancelled) can message here.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-gray-50 to-blue-50/30 pt-20 fixed-sidebar-layout">
      <aside
        onMouseEnter={() => setSidebarCollapsed(false)}
        onMouseLeave={() => setSidebarCollapsed(true)}
        className={`fixed left-0 top-20 bottom-0 bg-gradient-to-b from-[#800020] to-[#650018] text-white shadow-2xl flex flex-col overflow-hidden transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'w-20' : 'w-72'}`}
      >
        <div className={`border-b border-white/10 mb-2 flex items-center justify-center transition-all ${sidebarCollapsed ? 'p-3' : 'p-8'}`}>
          <div className="flex flex-col items-center text-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-white/10 backdrop-blur-md p-2 shadow-inner border border-white/20 flex items-center justify-center group overflow-hidden flex-shrink-0">
              <img src={logo} alt="Scholarship Logo" className="w-full h-full object-contain group-hover:scale-110 transition-transform duration-500" />
            </div>
            {!sidebarCollapsed && (
              <div>
                <h2 className="text-xl font-black tracking-tight leading-tight uppercase">{sidebarTitle}</h2>
                <p className="text-[10px] font-bold text-rose-200 tracking-[0.2em] uppercase opacity-70">{sidebarSubtitle}</p>
              </div>
            )}
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto transition-all">
          <div className={`${sidebarCollapsed ? 'px-1' : 'px-2'} py-4 space-y-1`}>
            {[
              { id: 'dashboard', label: 'Dashboard', icon: <FaTachometerAlt /> },
              { id: 'finder', label: 'Slot Tracking', icon: <FaSearch /> },
              { id: 'manage', label: 'Manage', icon: <FaFilter /> },
              { id: 'track', label: 'Track', icon: <FaUsers /> },
              { id: 'reports', label: 'Reports', icon: <FaChartBar /> },
              { id: 'inbox', label: 'Inbox', icon: <FaInbox /> },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`w-full flex items-center transition-all rounded-xl ${section === item.id ? 'bg-white/20' : 'hover:bg-white/10'
                  } ${sidebarCollapsed ? 'justify-center p-3' : 'justify-start px-4 py-3 gap-3'}`}
              >
                <span className="flex-shrink-0 text-lg">{item.icon}</span>
                {!sidebarCollapsed && <span className="whitespace-nowrap">{item.label}</span>}
              </button>
            ))}
          </div>
        </nav>
      </aside>

      <main className={`transition-all duration-300 ${sidebarCollapsed ? 'ml-24' : 'ml-[19rem]'} flex-1 flex flex-col overflow-y-auto px-10 py-10 custom-scrollbar border-l border-r border-gray-200/80 shadow-[inset_10px_0_15px_-10px_rgba(0,0,0,0.05)]`} style={{ maxHeight: 'calc(100vh - 5rem)' }}>
        <header className="bg-white rounded-2xl shadow-sm px-8 py-5 mb-8 flex items-center justify-between border border-gray-100">
          <div className="flex items-center gap-2 text-[#800020] font-bold text-xl">
            {dashboardTitle}
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-xs text-gray-500 font-medium whitespace-nowrap">Welcome back,</p>
              <p className="text-sm font-bold text-gray-900 whitespace-nowrap">{userName}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#800020] to-[#650018] flex items-center justify-center text-white font-bold shadow-sm border-2 border-white">
              {userFirstName.charAt(0).toUpperCase()}
            </div>
          </div>
        </header>

        {section === 'dashboard' && renderDashboard()}
        {section === 'finder' && renderFinder()}
        {section === 'manage' && renderManage()}
        {section === 'track' && renderTrack()}
        {section === 'reports' && renderReports()}
        {section === 'inbox' && renderInbox()}
        {section === 'view-applicant' && renderViewApplicant()}
      </main>

      {/* AI Recommendation Modal */}
      {recommendationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setRecommendationModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6 border-b pb-4">
              <h2 className="text-xl font-bold text-[#800020]">Recommended Applicants ({recommended.length})</h2>
              <div className="flex items-center gap-3 bg-rose-50 px-4 py-2 rounded-xl border border-rose-100">
                <span className="text-xs font-black text-[#800020] uppercase tracking-wider">Number of Recommendations:</span>
                <input
                  type="number"
                  autoFocus
                  value={recommendCount}
                  onChange={(e) => {
                    const newCount = e.target.value;
                    setRecommendCount(newCount);
                    const count = parseInt(newCount) || 10;
                    const allPending = data.applicants || [];
                    const filteredApplicants = allPending.filter(a => matchesScholarshipSelection(a, trackScholarshipFilter));
                    const top = [...filteredApplicants]
                      .sort((a, b) => (Number(b.grade) || 0) - (Number(a.grade) || 0))
                      .slice(0, count);
                    setRecommended(top);
                  }}
                  className="w-16 text-center text-lg font-black bg-transparent border-none outline-none text-[#800020]"
                  min="1"
                />
              </div>
            </div>
            <div className="overflow-x-auto border border-gray-200 rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#800020] text-white">
                    <th className="px-4 py-3 text-left font-bold">Rank</th>
                    <th className="px-4 py-3 text-left font-bold">Name</th>
                    <th className="px-4 py-3 text-left font-bold">Grade</th>
                    <th className="px-4 py-3 text-left font-bold">Financial Status</th>
                    <th className="px-4 py-3 text-center font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {recommended.map((s, i) => (
                    <tr key={`${s.name}-${i}`} className="hover:bg-rose-50/30 transition-colors">
                      <td className="px-4 py-3 font-black text-[#800020] text-lg">{i + 1}</td>
                      <td className="px-4 py-3 font-bold text-gray-800">{s.name}</td>
                      <td className="px-4 py-3 font-mono text-blue-700 font-bold">{s.grade}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-100">
                          {getFinancialStatusLabel(s.income || s.financial_income_of_parents || s.family?.grossIncome)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2 justify-center">
                          <button
                            type="button"
                            onClick={() => acceptRecommended(s)}
                            className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-[10px] font-black uppercase hover:bg-green-700 transition-colors shadow-sm"
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            onClick={() => declineRecommended(s)}
                            className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-[10px] font-black uppercase hover:bg-red-700 transition-colors shadow-sm"
                          >
                            Decline
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const idx = data.applicants.findIndex((a) => a.studentContact?.email === s.studentContact?.email || a.name === s.name);
                              if (idx >= 0) viewApplicantFn(idx, 'all');
                              setRecommendationModal(false);
                            }}
                            className="px-3 py-1.5 rounded-lg bg-[#800020] text-white text-[10px] font-black uppercase hover:bg-[#650018] transition-colors shadow-sm"
                          >
                            View
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-right mt-4">
              <button type="button" onClick={() => setRecommendationModal(false)} className="px-4 py-2 rounded-lg bg-gray-500 text-white font-semibold">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {imageModalSrc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={() => setImageModalSrc(null)}>
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <DecryptedMedia 
              src={imageModalSrc} 
              type="image/jpeg" 
              className="max-w-full max-h-[90vh] object-contain rounded-xl shadow-2xl" 
            />
            <button type="button" onClick={() => setImageModalSrc(null)} className="absolute top-3 right-3 w-10 h-10 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-[#800020]">×</button>
          </div>
        </div>
      )}

      {/* Custom Delete Confirmation Modal */}
      {activeOverlay && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-[#2b0a14]/45 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm rounded-3xl border border-white/50 bg-white/95 p-8 text-center shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="mx-auto mb-5 h-14 w-14 rounded-full border-4 border-[#f1d8df] border-t-[#800020] animate-spin" />
            <h3 className="text-xl font-black text-[#800020]">{activeOverlay.title}</h3>
            <p className="mt-3 text-sm font-medium leading-6 text-gray-600">{activeOverlay.message}</p>
          </div>
        </div>
      )}

      {/* Action Confirmation Modal */}
      {pendingAction && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-8 max-w-lg w-full shadow-2xl animate-in zoom-in-95 duration-200 border border-gray-100 overflow-hidden relative">
            <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-[#800020] to-[#650018]"></div>

            <div className="w-16 h-16 bg-[#800020]/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <FaEnvelope className="text-3xl text-[#800020]" />
            </div>

            <h3 className="text-2xl font-black text-gray-900 text-center mb-2">{pendingAction.title}</h3>

            <div className="bg-gray-50 rounded-2xl p-5 mb-6 border border-gray-100">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-[#800020] flex items-center justify-center text-white text-xs">TO</div>
                <div className="overflow-hidden">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Recipient Gmail</p>
                  <p className="text-sm font-bold text-[#800020] truncate">{pendingAction.recipient}</p>
                </div>
              </div>

              {pendingAction.documents && (
                <div className="mb-4 pt-4 border-t border-gray-200/50">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Attachments to be sent:</p>
                  <div className="flex flex-wrap gap-2">
                    {pendingAction.documents.map((doc, idx) => (
                      <span key={idx} className="bg-white border border-gray-200 px-3 py-1 rounded-full text-[10px] font-bold text-gray-600 shadow-sm">
                        📎 {doc}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t border-gray-200/50 pt-4">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Message Content:</p>
                <p className="text-xs text-gray-600 leading-relaxed italic italic-serif">
                  "{pendingAction.messageSummary}"
                </p>
              </div>
            </div>

            <p className="text-center text-[10px] text-gray-500 mb-2 px-8 font-medium italic">
              Confirmation results in an automated dispatch from the ISKOMATS provider system.
            </p>
            <p className="text-center text-xs text-red-600 font-black mb-8 uppercase tracking-widest">
              Note: This action cannot be reversed
            </p>

            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setPendingAction(null)}
                className="px-6 py-4 rounded-xl border border-gray-200 text-gray-600 font-bold transition-all hover:bg-gray-50 active:scale-95"
              >
                Go Back
              </button>
              <button
                type="button"
                onClick={() => {
                  pendingAction.onConfirm();
                  setPendingAction(null);
                }}
                className="px-6 py-4 rounded-xl bg-[#800020] text-white font-bold transition-all hover:bg-[#650018] hover:shadow-lg hover:shadow-[#800020]/20 active:scale-95 flex items-center justify-center gap-2"
              >
                <FaPaperPlane className="text-xs" /> Dispatch Now
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-200 border border-gray-100">
            <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <FaTrashAlt className="text-3xl text-red-600" />
            </div>

            <h3 className="text-xl font-bold text-gray-900 text-center mb-2">{confirmDeleteModal.title}</h3>
            <p className="text-gray-500 text-center mb-8">
              Are you sure you want to delete <span className="font-semibold text-gray-700">"{confirmDeleteModal.label}"</span>? This action cannot be undone.
            </p>

            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setConfirmDeleteModal(null)}
                className="px-6 py-3 rounded-xl border border-gray-200 text-gray-600 font-semibold transition-all hover:bg-gray-50 active:scale-95"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeDelete}
                className="px-6 py-3 rounded-xl bg-red-600 text-white font-semibold transition-all hover:bg-red-700 hover:shadow-lg hover:shadow-red-600/20 active:scale-95"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


