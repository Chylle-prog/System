import { useEffect, useMemo, useRef, useState } from 'react';
import { Chart, registerables } from 'chart.js';
import logo from '../../assets/ad3.jpg';
import {
  FaCheckCircle,
  FaChevronDown,
  FaClock,
  FaChartBar,
  FaEnvelope,
  FaEnvelopeOpen,
  FaFilter,
  FaGlobeAfrica,
  FaInbox,
  FaPaperPlane,
  FaPrint,
  FaRobot,
  FaSearch,
  FaStar,
  FaTachometerAlt,
  FaTimesCircle,
  FaUserCircle,
  FaUsers,
  FaImage,
  FaUpload,
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
  FaPlusCircle,
  FaEdit,
} from 'react-icons/fa';
import * as XLSX from 'xlsx';
import { scholarshipAPI, announcementAPI } from '../../services/api';
import socketService from '../../services/socket';

Chart.register(...registerables);

const initialTulongData = {
  applicants: [],
  accepted: [],
  declined: [],
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

export default function DashTulong() {
  // Get user name from localStorage
  const userName = localStorage.getItem('userName') || 'Admin';
  const userFirstName = localStorage.getItem('userFirstName') || 'Admin';

  const [section, setSection] = useState('dashboard'); // dashboard | manage | track | reports | inbox | view-applicant
  const [reportsView, setReportsView] = useState('tables'); // analytics | tables
  const [trackTab, setTrackTab] = useState('all'); // all | accepted | declined
  const [data, setData] = useState(initialTulongData);
  const [searchTrack, setSearchTrack] = useState('');
  const [reportTab, setReportTab] = useState('pending'); // pending | accepted | declined
  const [viewApplicant, setViewApplicant] = useState(null); // { listType: 'all'|'accepted'|'declined', index }
  const [inboxSearch, setInboxSearch] = useState('');
  const [inboxFilter, setInboxFilter] = useState('all'); // all | pending | accepted
  const [viewMessage, setViewMessage] = useState(null); // { messageId }
  const [replyText, setReplyText] = useState('');
  const [recommendationModal, setRecommendationModal] = useState(false);
  const [recommended, setRecommended] = useState([]);
  const [imageModalSrc, setImageModalSrc] = useState(null);
  const [scholarshipImages, setScholarshipImages] = useState([]);
  const [manageMode, setManageMode] = useState('list'); // create | edit | list
  const [manageTab, setManageTab] = useState('scholarship'); // scholarship | announcement
  const [manageSearch, setManageSearch] = useState('');
  const [editingPost, setEditingPost] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [schoolVerifModal, setSchoolVerifModal] = useState(null); // applicant object
  const [indigencyVerifModal, setIndigencyVerifModal] = useState(null); // applicant object
  const [schoolVerifSent, setSchoolVerifSent] = useState({}); // { [applicantName]: true }
  const [indigencyVerifSent, setIndigencyVerifSent] = useState({}); // { [applicantName]: true }
  const [formData, setFormData] = useState({
    scholarshipName: '',
    deadline: '',
    minGpa: '',
    slots: '',
    location: '',
    parentFinance: '',
    description: '', // New field
    semester: '',
    year: new Date().getFullYear().toString(),
  });
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

  const loadScholarships = async () => {
    try {
      console.log('Loading scholarships for program: tulong');
      const response = await scholarshipAPI.getByProgram('tulong');
      console.log('Full API Response:', response);
      console.log('Response data:', response.data);

      if (response.data && response.data.success) {
        console.log('Scholarships from API:', response.data.scholarships);
        console.log('Number of scholarships:', response.data.scholarships ? response.data.scholarships.length : 0);

        setData(prev => ({
          ...prev,
          scholarshipPosts: response.data.scholarships || []
        }));
      } else {
        console.error('API response not successful:', response.data);
        alert('Failed to load scholarships: ' + (response.data?.message || 'Unknown error'));
      }
    } catch (error) {
      console.error('Failed to load scholarships:', error);
      console.error('Error response:', error.response?.data);
      console.error('Error message:', error.message);
      if (error.response?.data?.error) {
        console.error('Backend traceback:', error.response.data.error);
      }
      alert('Error loading scholarships: ' + (error.response?.data?.message || error.message));
    }
  };

  // Load applicants and scholarships from backend API on component mount
  useEffect(() => {
    const loadApplicants = async () => {
      try {
        const response = await scholarshipAPI.getApplicants('tulong');
        if (response.data.success) {
          const allApplicants = response.data.applicants || [];
          const historicalData = calculateHistoricalData(allApplicants);
          setData(prev => ({
            ...prev,
            applicants: allApplicants.filter(a => a.status === 'Pending'),
            accepted: allApplicants.filter(a => a.status === 'Accepted'),
            declined: allApplicants.filter(a => a.status === 'Declined'),
            historicalData
          }));
        }
      } catch (error) {
        console.error('Failed to load Tulong applicants:', error);
      }
    };

    loadApplicants();
    loadScholarships();

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

          return {
            ...prev,
            inbox: [...prev.inbox, {
              id: msg.m_id || (Date.now() + Math.random()),
              m_id: msg.m_id,
              studentName: msg.username,
              studentEmail: appNo, 
              applicant_no: appNo,
              studentStatus: msg.student_status,
              message: msg.message,
              timestamp: msg.timestamp,
              read: msg.username === userName,
              room: msg.room
            }]
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

      return () => {
        unsubMsg();
        unsubLogged();
        unsubRoom();
        socketService.disconnect();
      };
    }
  }, []);

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

    applicants.forEach(a => {
      // Monthly
      const dateStr = a.dateApplied || a.createdAt;
      const date = new Date(dateStr);
      const month = date.toLocaleString('default', { month: 'short', year: 'numeric' });
      if (!monthlyData[month]) monthlyData[month] = { month, applications: 0, accepted: 0, declined: 0 };
      monthlyData[month].applications++;
      if (a.status === 'Accepted') monthlyData[month].accepted++;
      if (a.status === 'Declined') monthlyData[month].declined++;

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
      courseDistribution: Object.entries(courses).map(([course, count]) => ({ course, count, percentage: Math.round((count / total) * 100) })),
      gradeRanges: Object.entries(grades).map(([range, count]) => ({ range, count, percentage: Math.round((count / total) * 100) })),
      financialBreakdown: Object.entries(financial).map(([level, count]) => ({ level, count, percentage: Math.round((count / total) * 100) })),
      locationStats: Object.entries(locations).map(([location, count]) => ({ location, count, percentage: Math.round((count / total) * 100) })),
      schoolStats: Object.entries(schools).map(([school, count]) => ({ school, count, percentage: Math.round((count / total) * 100) })),
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

  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files);
    const newImages = files.map(file => ({
      id: Date.now() + Math.random(),
      name: file.name,
      url: URL.createObjectURL(file),
      file: file
    }));
    setScholarshipImages(prev => [...prev, ...newImages]);
  };

  const removeImage = (imageId) => {
    setScholarshipImages(prev => {
      const image = prev.find(img => img.id === imageId);
      if (image && image.url.startsWith('blob:')) {
        URL.revokeObjectURL(image.url);
      }
      return prev.filter(img => img.id !== imageId);
    });
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const resetForm = () => {
    setFormData({
      scholarshipName: '',
      deadline: '',
      minGpa: '',
      slots: '',
      location: '',
      parentFinance: '',
      description: ''
    });
    setScholarshipImages([]);
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
      loadScholarships();
      loadAnnouncements();
    }
  }, [section]);

  const loadAnnouncements = async () => {
    try {
      const response = await announcementAPI.getAll();
      setData(prev => ({ ...prev, announcements: response.data || [] }));
    } catch (error) {
      console.error('Failed to load announcements:', error);
    }
  };

  const saveScholarshipPost = async () => {
    setIsSaving(true);
    try {
      console.log('Original scholarship images:', scholarshipImages);

      // Convert all NEW image files to base64
      const processedImages = await Promise.all(scholarshipImages.map(async (img) => {
        if (img.file) {
          // This is a new file upload
          try {
            const base64 = await fileToBase64(img.file);
            return { url: base64, name: img.name };
          } catch (err) {
            console.error('Error converting file to base64:', err);
            return null;
          }
        } else if (typeof img === 'string') {
          // This is an existing image URL from the API
          return { url: img };
        } else if (img.url) {
          // This is already an object with a URL
          return { url: img.url, name: img.name };
        }
        return null;
      }));

      const filteredImages = processedImages.filter(img => img !== null);
      console.log('Processed images for saving:', filteredImages);

      const postData = {
        ...formData,
        slots: parseInt(formData.slots),
        minGpa: parseFloat(formData.minGpa),
        parentFinance: parseFloat(formData.parentFinance),
        description: formData.description,
        scholarshipImages: filteredImages
      };

      console.log('Sending postData to API:', postData);

      let response;
      if (manageMode === 'edit') {
        response = await scholarshipAPI.updateScholarship(editingPost.reqNo, postData);
      } else {
        response = await scholarshipAPI.createScholarship(postData);
      }

      if (response.data.success) {
        alert(`Scholarship ${manageMode === 'edit' ? 'updated' : 'created'} successfully!`);
        resetForm();
        await loadScholarships();
        setManageMode('list');
      } else {
        alert('Error: ' + (response.data.message || 'Unknown error occurred'));
      }
    } catch (error) {
      console.error('Failed to save scholarship:', error);
      alert('Error saving scholarship: ' + (error.response?.data?.message || error.message));
    } finally {
      setIsSaving(false);
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
        description: post.description || ''
      };
      console.log('Form data being set:', formData);
      setFormData(formData);

      // Normalize images into objects with IDs
      const normalizedImages = (post.scholarshipImages || []).map((img, idx) => {
        if (typeof img === 'string') {
          return { id: `existing-${idx}`, url: img, name: `Existing ${idx + 1}` };
        }
        return img;
      });

      setScholarshipImages(normalizedImages);
      setManageMode('edit');
    } catch (error) {
      console.error('Error in editPost:', error);
      alert('Error editing post: ' + error.message);
    }
  };

  const deletePost = async (postId) => {
    if (confirm('Are you sure you want to delete this scholarship post?')) {
      try {
        const response = await scholarshipAPI.deleteScholarship(postId);
        if (response.data.success) {
          loadScholarships();
        }
      } catch (error) {
        console.error('Failed to delete scholarship:', error);
        alert('Error deleting scholarship: ' + (error.response?.data?.message || error.message));
      }
    }
  };

  const saveAnnouncement = async () => {
    if (!formData.title || !formData.content) {
      alert('Please fill in all required fields');
      return;
    }

    setIsSaving(true);
    try {
      const announcementData = {
        title: formData.title,
        content: formData.content
      };

      const response = await announcementAPI.create(announcementData);

      if (response.data.message) {
        alert('Announcement saved successfully!');
        resetForm();
        loadAnnouncements();
        setManageMode('list');
      }
    } catch (error) {
      console.error('Failed to save announcement:', error);
      alert('Error saving announcement: ' + (error.response?.data?.message || error.message));
    } finally {
      setIsSaving(false);
    }
  };

  const editAnnouncement = (ann) => {
    setEditingPost(ann);
    setFormData({
      title: ann.title,
      content: ann.message || ann.content,
      deadline: '',
      eligibility: '',
      slots: '',
      description: ''
    });
    setManageMode('edit');
  };

  const deleteAnnouncement = async (annId) => {
    if (confirm('Are you sure you want to delete this announcement?')) {
      try {
        await announcementAPI.delete(annId);
        loadAnnouncements();
      } catch (error) {
        console.error('Failed to delete announcement:', error);
        alert('Error deleting announcement: ' + (error.response?.data?.message || error.message));
      }
    }
  };

  const filteredScholarshipPosts = useMemo(() => {
    return (data.scholarshipPosts || []).filter(post => {
      const matchesSearch = (post.scholarshipName || post.title || '').toLowerCase().includes(manageSearch.toLowerCase()) ||
        (post.description || '').toLowerCase().includes(manageSearch.toLowerCase());
      return matchesSearch;
    });
  }, [data.scholarshipPosts, manageSearch]);

  const filteredAnnouncements = useMemo(() => {
    return (data.announcements || []).filter(ann => {
      const matchesSearch = (ann.title || '').toLowerCase().includes(manageSearch.toLowerCase()) ||
        (ann.content || '').toLowerCase().includes(manageSearch.toLowerCase());
      return matchesSearch;
    });
  }, [data.announcements, manageSearch]);

  const stats = useMemo(() => {
    const total = data.applicants.length + data.accepted.length + data.declined.length;
    return {
      total,
      accepted: data.accepted.length,
      declined: data.declined.length,
      pending: data.applicants.length,
    };
  }, [data]);

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
          labels: ['Accepted', 'Declined', 'Pending'],
          datasets: [{
            data: [stats.accepted, stats.declined, stats.pending],
            backgroundColor: ['#198754', '#dc3545', '#ffc107'],
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
          labels: data.historicalData.monthlyApplications.map(m => m.month),
          datasets: [
            {
              label: 'Applications',
              data: data.historicalData.monthlyApplications.map(m => m.applications),
              borderColor: '#800020',
              backgroundColor: 'rgba(128, 0, 32, 0.1)',
              tension: 0.4
            },
            {
              label: 'Accepted',
              data: data.historicalData.monthlyApplications.map(m => m.accepted),
              borderColor: '#198754',
              backgroundColor: 'rgba(25, 135, 84, 0.1)',
              tension: 0.4
            },
            {
              label: 'Declined',
              data: data.historicalData.monthlyApplications.map(m => m.declined),
              borderColor: '#dc3545',
              backgroundColor: 'rgba(220, 53, 69, 0.1)',
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
          labels: data.historicalData.gradeRanges.map(g => g.range),
          datasets: [{
            label: 'Number of Students',
            data: data.historicalData.gradeRanges.map(g => g.count),
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
          labels: data.historicalData.courseDistribution.map(c => c.course),
          datasets: [{
            data: data.historicalData.courseDistribution.map(c => c.count),
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
          labels: data.historicalData.financialBreakdown.map(f => f.level),
          datasets: [{
            data: data.historicalData.financialBreakdown.map(f => f.count),
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
          labels: data.historicalData.schoolStats.map(s => s.school),
          datasets: [{
            data: data.historicalData.schoolStats.map(s => s.count),
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
          labels: data.historicalData.locationStats.map(loc => loc.location),
          datasets: [{
            data: data.historicalData.locationStats.map(loc => loc.count),
            backgroundColor: ['#800020', '#198754', '#0d6efd', '#ffc107', '#6c757d'],
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
      });
    }

    return cleanupCharts;
  }, [section, reportsView, stats, data.historicalData]);

  const formatDate = (timestamp) => {
    if (!timestamp) return 'No timestamp';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return timestamp;
    return date.toISOString().split('T')[0];
  };

  const viewApplicantFn = (index, listType = 'all') => {
    setViewApplicant({ listType, index });
    setSection('view-applicant');
  };

  const handleStartChat = (applicant) => {
    const proNo = 3; // Tulong
    socketService.startChat(applicant.applicant_no || applicant.id, proNo);
    setSection('inbox');
  };

  const recommendStudents = () => {
    const top = [...data.applicants].sort((a, b) => b.grade - a.grade).slice(0, 3);
    setRecommended(top);
    setRecommendationModal(true);
  };

  const acceptRecommended = (applicant) => {
    const idx = data.applicants.findIndex((a) => a.studentContact?.email === applicant.studentContact?.email || a.name === applicant.name);
    if (idx >= 0) {
      setData((d) => ({
        ...d,
        applicants: d.applicants.filter((_, i) => i !== idx),
        accepted: [...d.accepted, d.applicants[idx]],
      }));
    }
    setRecommendationModal(false);
  };

  const declineRecommended = (applicant) => {
    const idx = data.applicants.findIndex((a) => a.studentContact?.email === applicant.studentContact?.email || a.name === applicant.name);
    if (idx >= 0) {
      setData((d) => ({
        ...d,
        applicants: d.applicants.filter((_, i) => i !== idx),
        declined: [...d.declined, d.applicants[idx]],
      }));
    }
    setRecommendationModal(false);
  };

  const acceptApplicant = () => {
    if (!viewApplicant || viewApplicant.listType !== 'all') return;
    const { index } = viewApplicant;
    setData((d) => {
      const applicant = d.applicants[index];
      if (!applicant) return d;
      return {
        ...d,
        applicants: d.applicants.filter((_, i) => i !== index),
        accepted: [...d.accepted, applicant],
      };
    });
    setViewApplicant(null);
    setSection('track');
    setTrackTab('accepted');
  };

  const declineApplicant = () => {
    if (!viewApplicant || viewApplicant.listType !== 'all') return;
    const { index } = viewApplicant;
    setData((d) => {
      const applicant = d.applicants[index];
      if (!applicant) return d;
      return {
        ...d,
        applicants: d.applicants.filter((_, i) => i !== index),
        declined: [...d.declined, applicant],
      };
    });
    setViewApplicant(null);
    setSection('track');
    setTrackTab('declined');
  };

  const cancelApplicant = (listType, index) => {
    setData((d) => {
      const list = d[listType] || [];
      const applicant = list[index];
      if (!applicant) return d;
      return {
        ...d,
        applicants: [...d.applicants, applicant],
        [listType]: list.filter((_, i) => i !== index),
      };
    });
    setTrackTab('all');
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
    messages.forEach((m) => {
      const key = m.applicant_no || m.studentEmail || m.studentName;
      if (!grouped[key]) {
        // Find actual applicant name for this ID from local data state
        const allApplicants = [...(data.applicants || []), ...(data.accepted || []), ...(data.declined || [])];
        const applicant = allApplicants.find(a => 
          a.applicant_no?.toString() === m.applicant_no?.toString() || 
          a.id?.toString() === m.applicant_no?.toString()
        );
        
        let initialName = m.studentName;
        if (applicant && applicant.name) {
          initialName = applicant.name;
        } else if (m.studentName === 'System' || m.studentName === 'Vilma Scholarship Program' || m.studentName === 'Africa Scholarship Program' || m.studentName === 'Tulong Dunong Program') {
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
      if (!grouped[key].lastMessage || new Date(m.timestamp) > new Date(grouped[key].lastMessage.timestamp)) {
        grouped[key].lastMessage = m;
      }
    });
    return Object.values(grouped).sort((a, b) => new Date(b.lastMessage.timestamp) - new Date(a.lastMessage.timestamp));
  };

  const markAsRead = (messageId) => {
    setData((d) => ({
      ...d,
      inbox: d.inbox.map((m) => (m.id === messageId ? { ...m, read: true } : m)),
    }));
  };

  const toggleStar = (messageId) => {
    setData((d) => ({
      ...d,
      inbox: d.inbox.map((m) => (m.id === messageId ? { ...m, starred: !m.starred } : m)),
    }));
  };

  const sendReply = (messageId) => {
    if (!replyText.trim() || !currentMessage?.room) return;
    socketService.sendMessage(currentMessage.room, userName, replyText);
    setReplyText('');
  };

  const allMessages = data.inbox || [];
  const unreadCount = allMessages.filter((m) => !m.read).length;
  const conversations = useMemo(() => groupMessagesByStudent(allMessages), [allMessages]);
  const currentMessage = viewMessage ? allMessages.find((m) => m.id === viewMessage.messageId) : null;
  const currentConversation = currentMessage
    ? conversations.find((c) => c.studentEmail === currentMessage.studentEmail || c.studentName === currentMessage.studentName)
    : null;
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
    }

    // Apply search filter
    if (inboxSearch.trim()) {
      const q = inboxSearch.toLowerCase();
      filtered = filtered.filter((c) => {
        return (
          c.studentName.toLowerCase().includes(q) ||
          (c.studentEmail || '').toLowerCase().includes(q) ||
          c.messages.some((m) => m.subject.toLowerCase().includes(q) || m.message.toLowerCase().includes(q))
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
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-6 border-b border-gray-50 flex justify-between items-center bg-gray-50/30">
              <h3 className="font-black text-gray-900 uppercase tracking-widest text-xs">Recent Applicants</h3>
              <button onClick={() => setSection('track')} className="text-xs font-bold text-[#800020] hover:underline">View All</button>
            </div>
            <div className="divide-y divide-gray-50">
              {data.applicants.slice(0, 5).map((app, idx) => (
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
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-6 border-b border-gray-50 flex justify-between items-center bg-gray-50/30">
              <h3 className="font-black text-gray-900 uppercase tracking-widest text-xs">Recent Messages</h3>
              <button onClick={() => setSection('inbox')} className="text-xs font-bold text-[#800020] hover:underline">View Inbox</button>
            </div>
            <div className="divide-y divide-gray-50">
              {allMessages.slice(0, 5).map(msg => (
                <div key={msg.id} className="p-4 flex items-center gap-4 hover:bg-gray-50 transition-colors">
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-white bg-blue-500"><FaEnvelope /></div>
                  <div className="flex-1">
                    <div className="flex justify-between items-center mb-0.5">
                      <span className="text-sm font-black text-gray-900">{msg.studentName}</span>
                      <span className="text-[10px] font-bold text-gray-400 uppercase">{formatDate(msg.timestamp)}</span>
                    </div>
                    <p className="text-xs text-gray-500 line-clamp-1">{msg.subject}</p>
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

  const renderManage = () => {
    if (manageMode === 'list') {
      return (
        <section className="bg-white p-6 rounded-xl shadow-sm">
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
                filteredScholarshipPosts.map((post) => (
                  <div key={post.reqNo || post.id} className="border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h4 className="text-lg font-semibold text-[#800020] mb-2">{post.scholarshipName || post.title}</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-600">
                          <div><strong>Deadline:</strong> {formatDate(post.deadline)}</div>
                          <div><strong>Slots:</strong> {post.slots}</div>
                          <div><strong>Location:</strong> {post.location}</div>
                          <div><strong>Min GPA:</strong> {post.minGpa}%</div>
                          <div><strong>Term:</strong> {post.semester} {post.year}</div>
                        </div>
                        <p className="text-sm text-gray-700 mt-3 line-clamp-2">{post.description}</p>
                        {post.scholarshipImages && post.scholarshipImages.length > 0 && (
                          <div className="flex gap-2 mt-3">
                            {post.scholarshipImages.slice(0, 3).map((img, idx) => (
                              <img key={idx} src={img.url || img} alt="Scholarship" className="w-16 h-16 object-cover rounded-lg border border-gray-200" />
                            ))}
                            {post.scholarshipImages.length > 3 && (
                              <div className="w-16 h-16 bg-gray-100 rounded-lg border border-gray-200 flex items-center justify-center text-xs text-gray-600">
                                +{post.scholarshipImages.length - 3}
                              </div>
                            )}
                          </div>
                        )}
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
                ))
              ) : (
                <div className="text-center py-12">
                  <FaImage className="text-4xl text-gray-300 mx-auto mb-4" />
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
                          <h4 className="text-lg font-semibold text-[#800020]">{ann.title}</h4>
                        </div>
                        <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{ann.content}</p>
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
                          onClick={() => deleteAnnouncement(ann.id)}
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
      <section className="bg-white p-6 rounded-xl shadow-sm">
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
              placeholder={manageTab === 'scholarship' ? "e.g. Tulong Scholarship 2026" : "e.g. System Maintenance"}
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
                <label className="block text-sm font-semibold text-[#800020] mb-1">Semester *</label>
                <input
                  type="text"
                  name="semester"
                  value={formData.semester}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50"
                  placeholder="e.g. 1st Semester"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#800020] mb-1">Academic Year *</label>
                <input
                  type="number"
                  name="year"
                  value={formData.year}
                  onChange={handleFormChange}
                  min="2020"
                  max="2100"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50"
                  placeholder="e.g. 2026"
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

              {/* Picture Upload Section */}
              <div className="md:col-span-2">
                <label className="block text-sm font-semibold text-[#800020] mb-3">
                  <FaImage className="inline mr-2" />
                  Scholarship Images
                </label>

                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-[#800020] transition-colors">
                  <input
                    type="file"
                    id="image-upload"
                    multiple
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                  <label
                    htmlFor="image-upload"
                    className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-[#800020] text-white rounded-lg hover:bg-[#650018] transition-colors"
                  >
                    <FaUpload />
                    Choose Images
                  </label>
                  <p className="text-sm text-gray-500 mt-2">Upload scholarship photos, banners, or promotional images</p>
                </div>

                {/* Image Preview Grid */}
                {scholarshipImages.length > 0 && (
                  <div className="mt-4">
                    <h4 className="text-sm font-semibold text-[#800020] mb-2">Uploaded Images ({scholarshipImages.length})</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {scholarshipImages.map((image, i) => (
                        <div key={image.id || i} className="relative group">
                          <img
                            src={image.preview || image.url}
                            alt={image.name || `Image ${i + 1}`}
                            className="w-full h-32 object-cover rounded-lg border border-gray-200"
                          />
                          <button
                            type="button"
                            onClick={() => removeImage(image.id || i)}
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
            </>
          ) : (
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
          )}

          <div className="md:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setManageMode('list')} className="px-4 py-2 rounded-lg bg-gray-500 text-white font-semibold hover:bg-gray-600 transition-colors">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-[#800020] text-white font-semibold hover:bg-[#650018] transition-colors">
              {manageMode === 'edit' ? 'Update' : 'Publish'} {manageTab === 'scholarship' ? 'Post' : 'Announcement'}
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
          (a.school && a.school.toLowerCase().includes(search));

        return matchesSearch;
      });
    };

    const pendingTagged = filterList(data.applicants).map((a, i) => ({ ...a, _listType: 'all', _listIdx: data.applicants.indexOf(a) }));
    const acceptedTagged = filterList(data.accepted).map((a, i) => ({ ...a, _listType: 'accepted', _listIdx: data.accepted.indexOf(a) }));
    const declinedTagged = filterList(data.declined).map((a, i) => ({ ...a, _listType: 'declined', _listIdx: data.declined.indexOf(a) }));
    const allList = [...pendingTagged, ...acceptedTagged, ...declinedTagged];
    const acceptedList = acceptedTagged;
    const declinedList = declinedTagged;

    return (
      <section className="bg-white p-6 rounded-xl shadow-sm">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <h3 className="text-xl font-semibold text-[#800020]">Tulong Scholarship - Track Applicants</h3>
          <button
            type="button"
            onClick={recommendStudents}
            className="px-4 py-2 rounded-lg bg-[#800020] text-white font-semibold flex items-center gap-2 hover:bg-[#650018] transition-colors"
          >
            <FaRobot /> Recommended Student Applicants
          </button>
        </div>

        <div className="flex flex-wrap gap-2 mb-4 justify-between items-center">
          <div className="flex gap-2">
            {['all', 'accepted', 'declined'].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTrackTab(t)}
                className={`px-4 py-2 rounded-lg font-semibold flex items-center gap-2 ${trackTab === t ? 'bg-[#800020] text-white' : 'bg-[#800020]/10 text-[#800020] border border-[#800020]'
                  }`}
              >
                {t === 'all' && <FaUsers />}
                {t === 'accepted' && <FaCheckCircle />}
                {t === 'declined' && <FaTimesCircle />}
                {t === 'all' ? 'All Applicants' : t.charAt(0).toUpperCase() + t.slice(1)}
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
        </div>

        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#800020] text-white">
                <th className="px-4 py-3 text-left font-semibold">Name</th>
                <th className="px-4 py-3 text-left font-semibold">Grade</th>
                <th className="px-4 py-3 text-left font-semibold">Financial</th>
                <th className="px-4 py-3 text-left font-semibold">School</th>
                <th className="px-4 py-3 text-left font-semibold">Contact & Address</th>
                <th className="px-4 py-3 text-left font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {trackTab === 'all' &&
                allList.map((a, i) => {
                  const statusColors = { all: 'bg-yellow-100 text-yellow-700', accepted: 'bg-green-100 text-green-700', declined: 'bg-red-100 text-red-700' };
                  const statusLabels = { all: 'Pending', accepted: 'Accepted', declined: 'Declined' };
                  return (
                    <tr key={`${a.name}-${a._listType}-${i}`} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-mono">#{a.applicant_no}</span>
                          <div className="font-semibold">{a.name}</div>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusColors[a._listType]}`}>{statusLabels[a._listType]}</span>
                      </td>
                      <td className="px-4 py-3">{a.grade}</td>
                      <td className="px-4 py-3">{getFinancialStatusLabel(a.income || a.financial_income_of_parents || a.family?.grossIncome)}</td>
                      <td className="px-4 py-3 text-xs">{a.school}</td>
                      <td className="px-4 py-3 text-[10px] leading-tight text-gray-600">{a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'}<br />{a.municipality || 'N/A'}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button type="button" onClick={() => viewApplicantFn(a._listIdx, a._listType)} className="px-3 py-1 rounded bg-[#800020] text-white text-xs font-semibold hover:bg-[#650018] transition-colors">
                            View
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

              {trackTab === 'accepted' &&
                acceptedList.map((a) => {
                  const idx = data.accepted.indexOf(a);
                  return (
                    <tr key={`${a.name}-${idx}`} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-4 py-3">{a.name}</td>
                      <td className="px-4 py-3">{a.grade}</td>
                      <td className="px-4 py-3">{getFinancialStatusLabel(a.income || a.financial_income_of_parents || a.family?.grossIncome)}</td>
                      <td className="px-4 py-3 text-xs">{a.school}</td>
                      <td className="px-4 py-3 text-[10px] leading-tight text-gray-600">{a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'}<br />{a.municipality || 'N/A'}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button type="button" onClick={() => viewApplicantFn(idx, 'accepted')} className="px-3 py-1 rounded bg-[#800020] text-white text-xs font-semibold hover:bg-[#650018] transition-colors">
                            View
                          </button>
                          <button type="button" onClick={() => cancelApplicant('accepted', idx)} className="px-3 py-1 rounded bg-amber-500 text-gray-900 text-xs font-semibold">
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

              {trackTab === 'declined' &&
                declinedList.map((a) => {
                  const idx = data.declined.indexOf(a);
                  return (
                    <tr key={`${a.name}-${idx}`} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-4 py-3">{a.name}</td>
                      <td className="px-4 py-3">{a.grade}</td>
                      <td className="px-4 py-3">{getFinancialStatusLabel(a.income || a.financial_income_of_parents || a.family?.grossIncome)}</td>
                      <td className="px-4 py-3 text-xs">{a.school}</td>
                      <td className="px-4 py-3 text-[10px] leading-tight text-gray-600">{a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'}<br />{a.municipality || 'N/A'}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button type="button" onClick={() => viewApplicantFn(idx, 'declined')} className="px-3 py-1 rounded bg-[#800020] text-white text-xs font-semibold hover:bg-[#650018] transition-colors">
                            View
                          </button>
                          <button type="button" onClick={() => cancelApplicant('declined', idx)} className="px-3 py-1 rounded bg-amber-500 text-gray-900 text-xs font-semibold">
                            Cancel
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
    const { historicalData, applicants, accepted, declined } = data;

    if (type === 'track') {
      const filterListToExport = (list) => list.filter((a) => {
        const search = searchTrack.toLowerCase();
        const matchesSearch =
          a.name.toLowerCase().includes(search) ||
          (a.school && a.school.toLowerCase().includes(search));

        const matchesType =
          typeFilter === 'all' ||
          (typeFilter === 'scholarship' && a.scholarshipName?.toLowerCase().includes('scholarship')) ||
          (typeFilter === 'grant' && a.scholarshipName?.toLowerCase().includes('financial assistance grant'));

        return matchesSearch && matchesType;
      });

      const fileName = `Tulong_Tracking_Full_${new Date().toISOString().split('T')[0]}`;
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

      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(formatTracking(filterListToExport(applicants))), 'Pending Review');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(formatTracking(filterListToExport(accepted))), 'Accepted Scholars');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(formatTracking(filterListToExport(declined))), 'Declined - Cancelled');

      XLSX.writeFile(wb, `${fileName}.xlsx`);
      return;
    }

    // Helper to format applicant data for Excel
    const formatApplicants = (list) => list.map(app => ({
      'Student Name': app.name || `${app.firstName} ${app.lastName}`,
      'Grade': app.grade || 'N/A',
      'Financial Status': getFinancialStatusLabel(app.income || app.family?.grossIncome),
      'School': app.school || 'N/A',
      'Contact No.': app.mobileNumber || app.phone || app.studentContact?.phone || 'N/A',
      'Address': app.municipality || 'N/A'
    }));

    // Create worksheets for Applicant Statuses
    const acceptedWS = XLSX.utils.json_to_sheet(formatApplicants(accepted));
    const declinedWS = XLSX.utils.json_to_sheet(formatApplicants(declined));
    const pendingWS = XLSX.utils.json_to_sheet(formatApplicants(applicants));

    // Create worksheet for Location Stats
    const locationData = historicalData.locationStats.map(item => ({
      Barangay: item.location,
      Count: item.count,
      Percentage: `${item.percentage}%`
    }));
    const locationWS = XLSX.utils.json_to_sheet(locationData);

    // Create worksheet for Course Distribution
    const courseWS = XLSX.utils.json_to_sheet(historicalData.courseDistribution.map(item => ({
      Course: item.course,
      Count: item.count,
      Percentage: `${item.percentage}%`
    })));

    // Create worksheet for Performance Metrics
    const metricsData = [
      { Metric: 'Acceptance Rate', Value: `${historicalData.performanceMetrics.acceptanceRate}%` },
      { Metric: 'Avg. Processing Time', Value: `${historicalData.performanceMetrics.averageProcessingTime} days` },
      { Metric: 'Application Completion Rate', Value: `${historicalData.performanceMetrics.applicationCompletionRate}%` },
      { Metric: 'Satisfaction Score', Value: `${historicalData.performanceMetrics.satisfactionScore}/5` }
    ];
    const metricsWS = XLSX.utils.json_to_sheet(metricsData);

    // Create worksheet for Monthly Trends
    const trendsWS = XLSX.utils.json_to_sheet(historicalData.monthlyApplications);

    // Create worksheet for School Stats
    const schoolWS = XLSX.utils.json_to_sheet(historicalData.schoolStats.map(item => ({
      School: item.school,
      Count: item.count,
      Percentage: `${item.percentage}%`
    })));

    // Create workbook and append sheets
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, acceptedWS, 'Accepted Scholars');
    XLSX.utils.book_append_sheet(wb, declinedWS, 'Declined-Cancelled');
    XLSX.utils.book_append_sheet(wb, pendingWS, 'Pending Applicants');
    XLSX.utils.book_append_sheet(wb, locationWS, 'Location Statistics');
    XLSX.utils.book_append_sheet(wb, courseWS, 'Course Distribution');
    XLSX.utils.book_append_sheet(wb, schoolWS, 'School Distribution');
    XLSX.utils.book_append_sheet(wb, metricsWS, 'Performance Metrics');
    XLSX.utils.book_append_sheet(wb, trendsWS, 'Monthly Trends');

    // Export the workbook
    XLSX.writeFile(wb, 'Tulong_Scholarship_Report.xlsx');
  };

  const renderReports = () => {
    const { historicalData } = data;

    const allApplicants = [...data.applicants, ...data.accepted, ...data.declined];
    const filteredApplicants = allApplicants;
    const monthlyStats = generateMonthlyStats(filteredApplicants);

    const kpiCards = [
      { label: 'Total Applicants', value: filteredApplicants.length.toLocaleString(), trend: '+12.5%', color: 'blue' },
      { label: 'New Applicants', value: data.applicants.length.toLocaleString(), trend: '+5.2%', color: 'green' },
      { label: 'Accepted', value: data.accepted.length.toLocaleString(), trend: '+8.1%', color: 'purple' },
      { label: 'Declined', value: data.declined.length.toLocaleString(), trend: '-2.4%', color: 'red' },
      { label: 'Avg. Processing', value: `${historicalData.performanceMetrics.averageProcessingTime}d`, trend: '-0.5d', color: 'amber' },
      { label: 'Completion Rate', value: `${historicalData.performanceMetrics.applicationCompletionRate}%`, trend: '+1.2%', color: 'indigo' },
    ];

    return (
      <div className="space-y-6">
        {/* Header with Export Buttons */}
        <div className="flex items-center justify-between gap-3 flex-wrap report-header">
          <div>
            <h3 className="text-2xl font-bold text-[#800020] report-title">Tulong Scholarship Reports</h3>
            <p className="text-gray-500 text-sm report-subtitle">Comprehensive KPI report and periodic trends</p>
            <p className="print-only text-[10px] text-gray-400 mt-2 font-bold italic">Generated on: {new Date().toLocaleString()}</p>
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
                  <div className="flex flex-col justify-center items-center text-center p-6 bg-gray-50 rounded-2xl border border-gray-100">
                    <div className="w-20 h-20 rounded-full border-4 border-[#800020] flex items-center justify-center mb-4">
                      <span className="text-xl font-black text-[#800020]">{historicalData.performanceMetrics.satisfactionScore}</span>
                    </div>
                    <h5 className="font-bold text-gray-800">Student Satisfaction</h5>
                    <p className="text-[11px] text-gray-500 mt-2 px-4 italic line-clamp-2">"The feedback from applicants has been overwhelmingly positive this semester."</p>
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
                    <span className="font-black">{historicalData.locationStats[0]?.location || 'N/A'}</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-white/10 pb-2">
                    <span className="text-xs font-bold text-rose-200">Leading Source</span>
                    <span className="font-black text-xs truncate max-w-[120px]">{historicalData.schoolStats[0]?.school || 'N/A'}</span>
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
                  {historicalData.schoolStats.length > 0 ? (
                    <>
                      Current data shows that <strong>{historicalData.schoolStats[0].school}</strong> remains the primary source of applicants for the Tulong Scholarship, contributing to {historicalData.schoolStats[0].percentage}% of the total application volume.
                    </>
                  ) : (
                    "No school distribution data available yet."
                  )}
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white p-4 rounded-xl border border-blue-100">
                    <p className="text-[10px] font-black text-gray-400 uppercase">Top Institution</p>
                    <p className="font-bold text-gray-800 truncate text-xs">{historicalData.schoolStats[0]?.school || 'N/A'}</p>
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
                  <div className="overflow-x-auto max-h-72">
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
                      { label: 'Satisfaction Score', value: `${historicalData.performanceMetrics.satisfactionScore}/5.0`, color: 'bg-amber-500' },
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
                  <div className="overflow-x-auto max-h-60">
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
                  <div className="overflow-x-auto max-h-60">
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
                  <div className="overflow-x-auto max-h-96">
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
                  <div className="overflow-x-auto max-h-96">
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
                      onClick={() => setReportTab('declined')}
                      className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${reportTab === 'declined' ? 'bg-red-600 text-white shadow-md' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                    >
                      DECLINED
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-8">
                  {/* Pending Applicants */}
                  {reportTab === 'pending' && (
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <h5 className="text-sm font-black text-amber-600 uppercase mb-4 flex items-center gap-2">
                        <FaClock /> Pending Review ({data.applicants.length})
                      </h5>
                      <div className="overflow-x-auto max-h-72">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead><tr className="bg-gray-50 border-y border-gray-100"><th className="p-3 font-bold text-gray-500 uppercase">Student Name</th><th className="p-3 font-bold text-gray-500 uppercase">Grade</th><th className="p-3 font-bold text-gray-500 uppercase">Financial</th><th className="p-3 font-bold text-gray-500 uppercase">Contact & Address</th></tr></thead>
                          <tbody className="divide-y divide-gray-100">
                            {data.applicants.map((a) => (
                              <tr key={a.id || a.applicant_no || a.name} className="hover:bg-gray-50"><td className="p-3 font-bold text-gray-800">{a.name}</td><td className="p-3">{a.grade}</td><td className="p-3">{getFinancialStatusLabel(a.income || a.financial_income_of_parents || a.family?.grossIncome)}</td><td className="p-3">{a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'} - {a.municipality || 'N/A'}</td></tr>
                            ))}
                            {data.applicants.length === 0 && <tr><td colSpan="4" className="p-4 text-center text-gray-400 italic">No applicants found</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Accepted Scholars */}
                  {reportTab === 'accepted' && (
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <h5 className="text-sm font-black text-green-600 uppercase mb-4 flex items-center gap-2">
                        <FaCheckCircle /> Accepted Scholars ({data.accepted.length})
                      </h5>
                      <div className="overflow-x-auto max-h-72">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead><tr className="bg-gray-50 border-y border-gray-100"><th className="p-3 font-bold text-gray-500 uppercase">Student Name</th><th className="p-3 font-bold text-gray-500 uppercase">Grade</th><th className="p-3 font-bold text-gray-500 uppercase">Financial</th><th className="p-3 font-bold text-gray-500 uppercase">Contact & Address</th></tr></thead>
                          <tbody className="divide-y divide-gray-100">
                            {data.accepted.map((a) => (
                              <tr key={a.id || a.applicant_no || a.name} className="hover:bg-gray-50"><td className="p-3 font-bold text-gray-800">{a.name}</td><td className="p-3">{a.grade}</td><td className="p-3">{getFinancialStatusLabel(a.income || a.financial_income_of_parents || a.family?.grossIncome)}</td><td className="p-3">{a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'} - {a.municipality || 'N/A'}</td></tr>
                            ))}
                            {data.accepted.length === 0 && <tr><td colSpan="4" className="p-4 text-center text-gray-400 italic">No accepted scholars found</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Declined Applicants */}
                  {reportTab === 'declined' && (
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <h5 className="text-sm font-black text-red-600 uppercase mb-4 flex items-center gap-2">
                        <FaTimesCircle /> Declined / Cancelled ({data.declined.length})
                      </h5>
                      <div className="overflow-x-auto max-h-72">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead><tr className="bg-gray-50 border-y border-gray-100"><th className="p-3 font-bold text-gray-500 uppercase">Student Name</th><th className="p-3 font-bold text-gray-500 uppercase">Grade</th><th className="p-3 font-bold text-gray-500 uppercase">Financial</th><th className="p-3 font-bold text-gray-500 uppercase">Contact & Address</th></tr></thead>
                          <tbody className="divide-y divide-gray-100">
                            {data.declined.map((a) => (
                              <tr key={a.id || a.applicant_no || a.name} className="hover:bg-gray-50"><td className="p-3 font-bold text-gray-800">{a.name}</td><td className="p-3">{a.grade}</td><td className="p-3">{getFinancialStatusLabel(a.income || a.financial_income_of_parents || a.family?.grossIncome)}</td><td className="p-3">{a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'} - {a.municipality || 'N/A'}</td></tr>
                            ))}
                            {data.declined.length === 0 && <tr><td colSpan="4" className="p-4 text-center text-gray-400 italic">No declined applicants found</td></tr>}
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
          <div className="border-b-2 border-gray-200 pb-4 mb-8">
            <h4 className="text-xl font-bold text-gray-800 uppercase tracking-widest">Detailed Scholarship Data Tables</h4>
          </div>

          <div className="space-y-8">
            <section>
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
                      <td className="border p-3 text-red-700">{m.declined}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section>
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

            <section>
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

            <section>
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

            <section>
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
                  {data.applicants.map((a) => (
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
                  {data.accepted.map((a) => (
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
              <h5 className="text-sm font-black text-[#800020] uppercase mb-4 border-l-4 border-[#800020] pl-3">Declined / Cancelled Applicants</h5>
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
                  {data.declined.map((a) => (
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
              <p className="text-xs font-black text-gray-900">Tulong Scholarship Administrator</p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderViewApplicant = () => {
    if (!viewApplicant) return null;
    const { listType, index } = viewApplicant;
    const list = listType === 'all' ? data.applicants : data[listType];
    const a = list[index];
    if (!a) return null;
    const isPending = listType === 'all';

    // Normalize family data for display
    const familyData = {
      father: {
        name: a.fatherFirstName ? `${a.fatherFirstName} ${a.fatherLastName || ''}` : (a.family?.father?.name || 'N/A'),
        status: a.fatherStatus || a.family?.father?.status || 'Living',
        job: a.fatherOccupation || a.family?.father?.job || 'N/A',
        phone: a.fatherPhone || a.family?.father?.phone || 'N/A'
      },
      mother: {
        name: a.motherFirstName ? `${a.motherFirstName} ${a.motherLastName || ''}` : (a.family?.mother?.name || 'N/A'),
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
              {f.type.startsWith('image') ? (
                <img
                  src={f.src}
                  alt="Document"
                  className="w-full h-28 object-cover group-hover:scale-105 transition-transform"
                  onClick={() => setImageModalSrc(f.src)}
                  onError={(e) => {
                    e.target.src = 'https://i.imgur.com/2h7z2S.jpg';
                  }}
                />
              ) : f.type.startsWith('video') ? (
                <video src={f.src} controls className="w-full h-28 object-cover rounded-lg" />
              ) : null}
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
        <div className="flex items-center justify-between mb-8 pb-4 border-b-2 border-[#800020]">
          <div className="flex items-center gap-4">
            <h2 className="text-2xl font-black text-[#800020] uppercase tracking-tight">Applicant Dossier</h2>
            <span className="bg-[#800020]/10 text-[#800020] px-3 py-1 rounded-lg text-sm font-black font-mono">ID #{a.applicant_no}</span>
          </div>
          <div className="flex gap-2">
            <span className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase ${isPending ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
              {isPending ? 'Pending Review' : 'Active Student'}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSchoolVerifModal(a)}
                disabled={schoolVerifSent[a.name]}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm ${schoolVerifSent[a.name] ? 'bg-green-100 text-green-700 cursor-default' : 'bg-[#800020] text-white hover:bg-[#650018]'}`}
              >
                <FaPaperPlane /> {schoolVerifSent[a.name] ? 'School Dispatch Sent' : 'Send for School Verification'}
              </button>
              <button
                type="button"
                onClick={() => setIndigencyVerifModal(a)}
                disabled={indigencyVerifSent[a.name]}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm ${indigencyVerifSent[a.name] ? 'bg-green-100 text-green-700 cursor-default' : 'bg-[#800020] text-white hover:bg-[#650018]'}`}
              >
                <FaPaperPlane /> {indigencyVerifSent[a.name] ? 'City Hall Dispatch Sent' : 'Verify Indigency (City Hall)'}
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
            <div className="p-4 border-t border-r border-gray-100">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">School ID Number</p>
              <p className="font-bold text-gray-800">{a.schoolId || 'N/A'}</p>
            </div>
            <div className="p-4 border-t border-gray-100">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Year Level</p>
              <p className="font-bold text-gray-800">{a.year || 'N/A'}</p>
            </div>

            <div className="p-4 border-t border-r border-gray-100 col-span-3">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">School Sector</p>
              <p className="font-bold text-gray-800">{a.schoolSector || 'N/A'}</p>
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
                <span className="w-1.5 h-1.5 rounded-full bg-[#800020]"></span> Grades / Transcript (supports video)
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
                  <img
                    src={a.signature}
                    alt="Digital Signature"
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
                className="px-8 py-3 rounded-xl bg-green-600 text-white font-black uppercase tracking-widest text-xs hover:bg-green-700 shadow-lg shadow-green-100 transition-all flex items-center gap-2"
              >
                <FaCheckCircle /> Approve
              </button>
              <button
                type="button"
                onClick={declineApplicant}
                className="px-8 py-3 rounded-xl bg-red-600 text-white font-black uppercase tracking-widest text-xs hover:bg-red-700 shadow-lg shadow-red-100 transition-all flex items-center gap-2"
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
              <h2 className="text-xl font-bold">Tulong Scholarship Messenger</h2>
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
                  const isActive =
                    currentConversation &&
                    (currentConversation.studentEmail === conv.studentEmail || currentConversation.studentName === conv.studentName);
                  return (
                    <div
                      key={conv.studentEmail || conv.studentName}
                      onClick={() => {
                        if (conv.messages.length > 0) {
                          const room = conv.messages[0].room;
                          setViewMessage({ messageId: conv.lastMessage.id });
                          socketService.loadHistory(room);
                        }
                      }}
                      className={`p-4 cursor-pointer transition-colors hover:bg-blue-50/50 ${isActive ? 'bg-blue-50 border-l-4 border-[#800020]' : ''
                        } ${conv.unreadCount > 0 ? 'bg-blue-50/30' : ''}`}
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
                {currentConversation.messages
                  .slice()
                  .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
                  .map((msg) => (
                    <div key={msg.id} className="space-y-2">
                      <div className="bg-gray-50 rounded-2xl p-4 border border-gray-200">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-semibold text-gray-900 text-sm">{msg.studentName}</span>
                          <span className="text-xs text-gray-500 flex items-center gap-1">
                            <FaClock className="text-[10px]" /> {formatDate(msg.timestamp)}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-[#800020] mb-1">{msg.subject}</p>
                        <p className="text-gray-700 whitespace-pre-wrap text-sm">{msg.message}</p>
                        <div className="mt-2 flex items-center justify-end gap-2">
                          <button type="button" onClick={() => toggleStar(msg.id)} className={`p-2 rounded-lg hover:bg-gray-100 ${msg.starred ? 'text-yellow-500' : 'text-gray-400'}`}>
                            <FaStar />
                          </button>
                        </div>
                      </div>

                      {msg.replies && msg.replies.length > 0 && (
                        <div className="ml-8 space-y-2">
                          {msg.replies.map((r) => (
                            <div key={r.id} className="bg-[#800020] text-white rounded-2xl p-4">
                              <div className="flex items-center justify-between mb-2">
                                <span className="font-semibold text-sm">{r.from}</span>
                                <span className="text-xs text-white/70">{formatDate(r.timestamp)}</span>
                              </div>
                              <p className="text-sm whitespace-pre-wrap">{r.text}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
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
                <p className="text-gray-500">All applicants (pending/accepted/declined) can message here.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-gray-50 to-blue-50/30 pt-20">
      <aside className="w-72 flex-shrink-0 bg-gradient-to-b from-[#800020] to-[#650018] text-white shadow-2xl flex flex-col">
        <div className="p-8 border-b border-white/10 mb-2">
          <div className="flex flex-col items-center text-center gap-4">
            <div className="w-20 h-20 rounded-2xl bg-white/10 backdrop-blur-md p-2 shadow-inner border border-white/20 flex items-center justify-center group overflow-hidden">
              <img src={logo} alt="Scholarship Logo" className="w-full h-full object-contain group-hover:scale-110 transition-transform duration-500" />
            </div>
            <div>
              <h2 className="text-xl font-black tracking-tight leading-tight uppercase">Tulong</h2>
              <p className="text-[10px] font-bold text-rose-200 tracking-[0.2em] uppercase opacity-70">Scholarship Program</p>
            </div>
          </div>
        </div>
        <nav className="flex-1">
          {[
            { id: 'dashboard', label: 'Dashboard', icon: <FaChevronDown className="opacity-0" /> },
            { id: 'manage', label: 'Manage', icon: <FaChevronDown className="opacity-0" /> },
            { id: 'track', label: 'Track', icon: <FaChevronDown className="opacity-0" /> },
            { id: 'reports', label: 'Reports', icon: <FaChevronDown className="opacity-0" /> },
            { id: 'inbox', label: 'Inbox', icon: <FaChevronDown className="opacity-0" /> },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={`w-full px-4 py-3 flex items-center justify-between hover:bg-[#650018] border-l-4 ${section === item.id ? 'border-rose-200 bg-[#650018]' : 'border-transparent'
                }`}
            >
              <span className="flex items-center gap-2">
                {item.id === 'dashboard' && <FaTachometerAlt />}
                {item.id === 'manage' && <FaFilter />}
                {item.id === 'track' && <FaUsers />}
                {item.id === 'reports' && <FaChartBar />}
                {item.id === 'inbox' && <FaInbox />}
                {item.label}
              </span>
              {item.icon}
            </button>
          ))}
        </nav>
      </aside>

      <main className="flex-1 p-6 overflow-y-auto">
        <header className="bg-white rounded-xl shadow-sm px-6 py-4 mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[#800020] font-bold text-xl">
            Tulong Scholarship Dashboard
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
            <h2 className="text-xl font-bold text-[#800020] text-center mb-4">AI Recommended Applicants</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {recommended.map((s, i) => (
                <div key={`${s.name}-${i}`} className="border-2 border-gray-200 rounded-xl p-4 bg-rose-50/40 hover:border-[#800020] hover:shadow-lg transition-all">
                  <div className="font-bold text-[#800020] mb-2">{i + 1}. {s.name}</div>
                  <p className="text-sm text-gray-600"><strong>Grade:</strong> {s.grade}</p>
                  <p className="text-sm text-gray-600"><strong>Financial:</strong> {s.financial}</p>
                  <div className="flex gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => acceptRecommended(s)}
                      className="flex-1 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => declineRecommended(s)}
                      className="flex-1 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold"
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
                      className="py-2 px-3 rounded-lg bg-[#800020] text-white text-sm font-semibold"
                    >
                      View
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="text-right mt-4">
              <button type="button" onClick={() => setRecommendationModal(false)} className="px-4 py-2 rounded-lg bg-gray-500 text-white font-semibold">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen Image Modal */}
      {imageModalSrc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={() => setImageModalSrc(null)}>
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <img src={imageModalSrc} alt="Full size" className="max-w-full max-h-[90vh] object-contain rounded-xl shadow-2xl" />
            <button type="button" onClick={() => setImageModalSrc(null)} className="absolute top-3 right-3 w-10 h-10 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-[#800020]">×</button>
          </div>
        </div>
      )}
    </div>
  );
}

