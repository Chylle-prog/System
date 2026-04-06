import { useEffect, useMemo, useRef, useState } from 'react';
import { Chart, registerables } from 'chart.js';
import logo from '../../assets/ad1.jpg';
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
  FaEdit,
  FaTrash,
  FaPlus,
  FaFileExcel,
} from 'react-icons/fa';
import * as XLSX from 'xlsx';

Chart.register(...registerables);

const initialAfricaData = {
  applicants: [
    {
      name: 'Ana Arriola',
      lastName: 'Arriola',
      firstName: 'Ana',
      middleName: 'Reyes',
      maidenName: '',
      dob: '2004-05-15',
      pob: 'Lipa City',
      sex: 'Female',
      citizenship: 'Filipino',
      mobileNumber: '09170001111',
      emailAddress: 'ana.arriola@example.com',
      applicationType: 'Scholarship',
      year: '3rd',
      course: 'IT',
      school: 'Mataasnakahoy HS',
      schoolId: '12345678',
      schoolAddress: 'Mataasnakahoy, Batangas',
      schoolContact: '(043) 723-1111',
      schoolSector: 'Public',
      grade: 95,
      financial: 'Low',
      location: '123 Calle Rizal, Bolbok, Lipa City, Batangas',
      street: '123 Calle Rizal',
      barangay: 'Bolbok',
      municipality: 'Lipa City',
      province: 'Batangas',
      zipCode: '4217',
      tribalMembership: 'N/A',
      disabilityType: 'None',
      educationalAssistance: 'Yes',
      educationalAssistanceDetails: 'Barangay Scholarship',
      family: {
        father: { name: 'Mike Arriola', status: 'Living', job: 'Driver', phone: '09171234567', address: 'Bolbok, Lipa' },
        mother: { name: 'Anna Arriola', status: 'Deceased', job: 'N/A', phone: 'N/A', address: 'N/A' },
        grossIncome: '120,000',
        siblingsCount: 3
      },
      studentContact: { phone: '09170001111', email: 'ana.arriola@example.com' },
      education: 'Graduated with honors',
      signature: 'https://i.imgur.com/2h7z2S.jpg',
      indigencyFiles: [
        { src: 'https://i.imgur.com/2h7z2S.jpg', type: 'image/jpeg' },
        { src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', type: 'video/mp4' },
      ],
      certificateFiles: [
        { src: 'https://i.imgur.com/2h7z2S.jpg', type: 'image/jpeg' },
        { src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4', type: 'video/mp4' },
      ],
      gradesFiles: [
        { src: 'https://i.imgur.com/2h7z2S.jpg', type: 'image/jpeg' },
        { src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', type: 'video/mp4' }
      ],
      idFiles: [
        { src: 'https://i.imgur.com/2h7z2S.jpg', type: 'image/jpeg' },
        { src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4', type: 'video/mp4' },
      ],
    },
    {
      name: 'Angela Cacao',
      lastName: 'Cacao',
      firstName: 'Angela',
      middleName: 'D.',
      maidenName: '',
      dob: '2005-03-10',
      pob: 'Lipa City',
      sex: 'Female',
      citizenship: 'Filipino',
      street: '456 Mango St',
      barangay: 'San Carlos',
      municipality: 'Lipa City',
      province: 'Batangas',
      zipCode: '4217',
      mobileNumber: '09170001112',
      emailAddress: 'angela.cacao@example.com',
      applicationType: 'Financial Assistance Grant',
      disabilityType: 'None',
      tribalMembership: 'None',
      educationalAssistance: 'No',
      educationalAssistanceDetails: '',
      year: '2nd',
      course: 'Computer Science',
      school: "St. Michael's School",
      schoolId: '22334455',
      schoolAddress: 'San Carlos, Batangas',
      schoolContact: '(043) 723-2222',
      schoolSector: 'Private',
      grade: 93,
      financial: 'Very Low',
      location: 'San Carlos, Adya, Batangas',
      family: {
        father: { name: 'Ahmed Cacao', status: 'Living', job: 'Farmer', phone: '09181234567' },
        mother: { name: 'Fatima Cacao', status: 'Living', job: 'Housewife', phone: '09189876543' },
        grossIncome: '90,000',
        siblingsCount: 4
      },
      studentContact: { phone: '09170001112', email: 'angela.cacao@example.com' },
      education: 'Top performer in class',
      signature: 'https://i.imgur.com/2h7z2S.jpg',
      indigencyFiles: [
        { src: 'https://i.imgur.com/2h7z2S.jpg', type: 'image/jpeg' },
        { src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', type: 'video/mp4' },
      ],
      certificateFiles: [{ src: 'https://i.imgur.com/2h7z2S.jpg', type: 'image/jpeg' }],
      gradesFiles: [{ src: 'https://i.imgur.com/2h7z2S.jpg', type: 'image/jpeg' }],
      idFiles: [{ src: 'https://i.imgur.com/2h7z2S.jpg', type: 'image/jpeg' }],
    },
    {
      name: 'Mikaela Lantafe',
      lastName: 'Lantafe',
      firstName: 'Mikaela',
      middleName: 'S.',
      maidenName: '',
      dob: '2004-11-20',
      pob: 'Mabini',
      sex: 'Female',
      citizenship: 'Filipino',
      street: '789 Coconut Dr',
      barangay: 'Mabini',
      municipality: 'Lipa City',
      province: 'Batangas',
      zipCode: '4217',
      mobileNumber: '09170001113',
      emailAddress: 'mikaela.lantafe@example.com',
      applicationType: 'Scholarship',
      disabilityType: 'Hearing Impairment',
      tribalMembership: 'Aeta',
      educationalAssistance: 'Yes',
      educationalAssistanceDetails: 'Financial Aid from NGO',
      year: '4th',
      course: 'Engineering',
      school: 'Federal High School',
      schoolId: '33445566',
      schoolAddress: 'Mabini, Batangas',
      schoolSector: 'Public',
      grade: 91,
      financial: 'Low',
      location: 'Mabini, Adya, Batangas',
      family: {
        father: { name: 'Peter Lantafe', status: 'Deceased', job: 'Mechanic', phone: 'N/A' },
        mother: { name: 'Grace Lantafe', status: 'Living', job: 'Trader', phone: '09179876544' },
        grossIncome: '110,000',
        siblingsCount: 2
      },
      studentContact: { phone: '09170001113', email: 'mikaela.lantafe@example.com' },
      education: 'Consistent academic performance',
      signature: 'https://i.imgur.com/2h7z2S.jpg',
      indigencyFiles: [
        { src: 'https://i.imgur.com/2h7z2S.jpg', type: 'image/jpeg' },
        { src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', type: 'video/mp4' },
      ],
      certificateFiles: [{ src: 'https://i.imgur.com/2h7z2S.jpg', type: 'image/jpeg' }],
      gradesFiles: [{ src: 'https://i.imgur.com/2h7z2S.jpg', type: 'image/jpeg' }],
      idFiles: [
        { src: 'https://i.imgur.com/2h7z2S.jpg', type: 'image/jpeg' },
        { src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4', type: 'video/mp4' },
      ],
    },
  ],
  accepted: [],
  declined: [],
  inbox: [
    {
      id: '1',
      studentName: 'Ana Arriola',
      studentEmail: 'ana.arriola@example.com',
      studentPhone: '09170001111',
      subject: 'Question about Application Status',
      message: 'Hello, I submitted my application last week and wanted to check on the status. When can I expect to hear back?',
      timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      read: false,
      starred: false,
      replies: [],
    },
    {
      id: '2',
      studentName: 'Angela Cacao',
      studentEmail: 'angela.cacao@example.com',
      studentPhone: '09170001112',
      subject: 'Document Submission Inquiry',
      message: 'I need to submit additional documents. What is the deadline and where should I send them?',
      timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      read: false,
      starred: true,
      replies: [],
    },
  ],
  scholarshipPosts: [
    {
      id: '1',
      title: 'Africa Excellence Scholarship 2026',
      deadline: '2026-03-15',
      eligibility: 'African students with minimum 85% grade',
      slots: 50,
      description: 'Comprehensive scholarship program for outstanding African students pursuing undergraduate studies. Covers tuition, accommodation, and living expenses.',
      images: [
        { id: 1, name: 'scholarship-banner.jpg', url: 'https://i.imgur.com/2h7z2S.jpg' },
        { id: 2, name: 'campus-life.jpg', url: 'https://i.imgur.com/2h7z2S.jpg' }
      ],
      createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'active',
      parentFinance: '150000' // Example: Max income for 'High' financial status
    },
    {
      id: '2',
      title: 'STEM Africa Initiative',
      deadline: '2026-04-01',
      eligibility: 'Students in Science, Technology, Engineering, and Mathematics',
      slots: 30,
      description: 'Special scholarship program focused on promoting STEM education among African youth. Includes mentorship and internship opportunities.',
      images: [
        { id: 3, name: 'stem-program.jpg', url: 'https://i.imgur.com/2h7z2S.jpg' }
      ],
      createdAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'active',
      parentFinance: '100000' // Example: Max income for 'High' financial status
    }
  ],
  historicalData: {
    monthlyApplications: [
      { month: '2025-06', applications: 45, accepted: 12, declined: 8 },
      { month: '2025-07', applications: 52, accepted: 15, declined: 10 },
      { month: '2025-08', applications: 38, accepted: 10, declined: 7 },
      { month: '2025-09', applications: 61, accepted: 18, declined: 12 },
      { month: '2025-10', applications: 73, accepted: 22, declined: 15 },
      { month: '2025-11', applications: 89, accepted: 25, declined: 18 },
      { month: '2025-12', applications: 95, accepted: 28, declined: 20 },
      { month: '2026-01', applications: 82, accepted: 24, declined: 16 },
      { month: '2026-02', applications: 78, accepted: 21, declined: 14 },
    ],
    courseDistribution: [
      { course: 'IT', count: 45, percentage: 35 },
      { course: 'Computer Science', count: 38, percentage: 30 },
      { course: 'Engineering', count: 28, percentage: 22 },
      { course: 'Business', count: 17, percentage: 13 },
    ],
    financialBreakdown: [
      { level: 'Very Low', count: 48, percentage: 38 },
      { level: 'Low', count: 55, percentage: 43 },
      { level: 'Medium', count: 18, percentage: 14 },
      { level: 'High', count: 7, percentage: 5 },
    ],
    locationStats: [
      { location: 'Adya', count: 12, percentage: 5 },
      { location: 'Anilao', count: 15, percentage: 6 },
      { location: 'Anilao-Labac', count: 8, percentage: 3 },
      { location: 'Antipolo del Norte', count: 10, percentage: 4 },
      { location: 'Antipolo del Sur', count: 9, percentage: 4 },
      { location: 'Bagong Pook', count: 14, percentage: 6 },
      { location: 'Balintawak', count: 20, percentage: 8 },
      { location: 'Banaybanay', count: 18, percentage: 7 },
      { location: 'Bolbok', count: 25, percentage: 10 },
      { location: 'Bugtong na Pulo', count: 7, percentage: 3 },
      { location: 'Bulacnin', count: 12, percentage: 5 },
      { location: 'Bulaklakan', count: 5, percentage: 2 },
      { location: 'Calamias', count: 6, percentage: 2 },
      { location: 'Cumba', count: 4, percentage: 2 },
      { location: 'Dagatan', count: 16, percentage: 7 },
      { location: 'Duhatan', count: 8, percentage: 3 },
      { location: 'Halang', count: 11, percentage: 5 },
      { location: 'Inosloban', count: 22, percentage: 9 },
      { location: 'Kayumanggi', count: 13, percentage: 5 },
      { location: 'Latag', count: 17, percentage: 7 },
      { location: 'Lodlod', count: 15, percentage: 6 },
      { location: 'Lumbang', count: 9, percentage: 4 },
      { location: 'Mabini', count: 10, percentage: 4 },
      { location: 'Malagonlong', count: 6, percentage: 2 },
      { location: 'Malitlit', count: 7, percentage: 3 },
      { location: 'Marauoy', count: 14, percentage: 6 },
      { location: 'Mataas na Lupa', count: 19, percentage: 8 },
      { location: 'Munting Pulo', count: 5, percentage: 2 },
      { location: 'Pagolingin Bata', count: 4, percentage: 2 },
      { location: 'Pagolingin East', count: 6, percentage: 2 },
      { location: 'Pagolingin West', count: 5, percentage: 2 },
      { location: 'Pangao', count: 8, percentage: 3 },
      { location: 'Pinagkawitan', count: 12, percentage: 5 },
      { location: 'Pinagtongulan', count: 7, percentage: 3 },
      { location: 'Plaridel', count: 9, percentage: 4 },
      { location: 'Poblacion Barangay 1', count: 11, percentage: 5 },
      { location: 'Poblacion Barangay 2', count: 10, percentage: 4 },
      { location: 'Poblacion Barangay 3', count: 13, percentage: 5 },
      { location: 'Poblacion Barangay 4', count: 12, percentage: 5 },
      { location: 'Poblacion Barangay 5', count: 14, percentage: 6 },
      { location: 'Poblacion Barangay 6', count: 11, percentage: 5 },
      { location: 'Poblacion Barangay 7', count: 10, percentage: 4 },
      { location: 'Poblacion Barangay 8', count: 9, percentage: 4 },
      { location: 'Poblacion Barangay 9', count: 8, percentage: 3 },
      { location: 'Poblacion Barangay 9-A', count: 7, percentage: 3 },
      { location: 'Poblacion Barangay 10', count: 6, percentage: 2 },
      { location: 'Poblacion Barangay 11', count: 5, percentage: 2 },
      { location: 'Poblacion Barangay 12', count: 4, percentage: 2 },
      { location: 'Pusil', count: 7, percentage: 3 },
      { location: 'Quezon', count: 8, percentage: 3 },
      { location: 'Rizal', count: 9, percentage: 4 },
      { location: 'Sabang', count: 21, percentage: 9 },
      { location: 'Sampaguita', count: 6, percentage: 2 },
      { location: 'San Benito', count: 5, percentage: 2 },
      { location: 'San Carlos', count: 18, percentage: 7 },
      { location: 'San Celestino', count: 7, percentage: 3 },
      { location: 'San Francisco', count: 10, percentage: 4 },
      { location: 'San Guillermo', count: 6, percentage: 2 },
      { location: 'San Isidro (formerly Sapac)', count: 9, percentage: 4 },
      { location: 'San Jose', count: 11, percentage: 5 },
      { location: 'San Lucas', count: 15, percentage: 6 },
      { location: 'San Salvador', count: 8, percentage: 3 },
      { location: 'San Sebastian (Balagbag)', count: 12, percentage: 5 },
      { location: 'Santo Niño', count: 7, percentage: 3 },
      { location: 'Santo Toribio', count: 6, percentage: 2 },
      { location: 'Sico', count: 14, percentage: 6 },
      { location: 'Talisay', count: 5, percentage: 2 },
      { location: 'Tambo', count: 23, percentage: 9 },
      { location: 'Tangob', count: 4, percentage: 2 },
      { location: 'Tanguay', count: 6, percentage: 2 },
      { location: 'Tibig', count: 8, percentage: 3 },
      { location: 'Tipacan', count: 9, percentage: 4 },
    ],
    gradeRanges: [
      { range: '90-100', count: 28, percentage: 22 },
      { range: '85-89', count: 42, percentage: 33 },
      { range: '80-84', count: 35, percentage: 27 },
      { range: '75-79', count: 18, percentage: 14 },
      { range: 'Below 75', count: 5, percentage: 4 },
    ],
    performanceMetrics: {
      averageProcessingTime: 4.2, // days
      acceptanceRate: 32.5, // percentage
      applicationCompletionRate: 78.3, // percentage
      satisfactionScore: 4.6, // out of 5
    },
    schoolStats: [
      { school: 'De La Salle Lipa (DLSL)', count: 52, percentage: 18 },
      { school: 'National University (NU) Lipa', count: 42, percentage: 14 },
      { school: 'University of Batangas - Lipa Campus (UBLC)', count: 38, percentage: 13 },
      { school: 'Batangas State University (Lipa Campus)', count: 48, percentage: 16 },
      { school: 'Lipa City Colleges (LCC)', count: 32, percentage: 11 },
      { school: 'STI College Lipa', count: 22, percentage: 7 },
      { school: 'Philippine State College of Aeronautics (PhilSCA)', count: 25, percentage: 8 },
      { school: 'AMA Computer College', count: 12, percentage: 4 },
      { school: 'Batangas College of Arts and Sciences (BCAS)', count: 15, percentage: 5 },
      { school: 'Kolehiyo ng Lungsod ng Lipa (KLL)', count: 11, percentage: 4 },
    ]
  }
};

export default function DashAfrica() {
  // Get user name from localStorage
  const userName = localStorage.getItem('userName') || 'Admin';
  const userFirstName = localStorage.getItem('userFirstName') || 'Admin';

  const [section, setSection] = useState('dashboard'); // dashboard | manage | track | reports | inbox | view-applicant
  const [reportsView, setReportsView] = useState('tables'); // analytics | tables
  const [monthlyFilter, setMonthlyFilter] = useState('all'); // all | specific month
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM format
  const [trackTab, setTrackTab] = useState('all'); // all | accepted | declined
  const [data, setData] = useState(initialAfricaData);
  const [searchTrack, setSearchTrack] = useState('');
  const [reportTab, setReportTab] = useState('pending'); // pending | accepted | declined
  const [typeFilter, setTypeFilter] = useState('all'); // all | scholarship | grant
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
  const [editingPost, setEditingPost] = useState(null);
  const [formData, setFormData] = useState({
    title: '',
    deadline: '',
    eligibility: '',
    slots: '',
    description: ''
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
      title: '',
      deadline: '',
      eligibility: '',
      slots: '',
      description: ''
    });
    setScholarshipImages([]);
    setEditingPost(null);
    setManageMode('create');
  };

  useEffect(() => {
    if (section === 'manage' && manageMode !== 'list') {
      setManageMode('list');
      resetForm();
    }
  }, [section]);

  const saveScholarshipPost = () => {
    if (!formData.title || !formData.deadline || !formData.eligibility || !formData.slots || !formData.description) {
      alert('Please fill in all required fields');
      return;
    }

    const newPost = {
      id: manageMode === 'edit' ? editingPost.id : Date.now().toString(),
      title: formData.title,
      deadline: formData.deadline,
      eligibility: formData.eligibility,
      slots: parseInt(formData.slots),
      description: formData.description,
      images: scholarshipImages,
      createdAt: manageMode === 'edit' ? editingPost.createdAt : new Date().toISOString(),
      status: 'active',
      parentFinance: '150000' // Default or dynamically set
    };

    if (manageMode === 'edit') {
      setData(prev => ({
        ...prev,
        scholarshipPosts: prev.scholarshipPosts.map(post =>
          post.id === editingPost.id ? newPost : post
        )
      }));
    } else {
      setData(prev => ({
        ...prev,
        scholarshipPosts: [...prev.scholarshipPosts, newPost]
      }));
    }

    resetForm();
    setManageMode('list');
  };

  const editPost = (post) => {
    console.log('Editing post:', post);
    console.log('Post deadline field:', post.deadline);
    console.log('Post deadline type:', typeof post.deadline);
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
      
      setFormData({
        title: post.title || '',
        deadline: formattedDeadline,
        eligibility: post.eligibility || '',
        slots: post.slots ? post.slots.toString() : '',
        description: post.description || ''
      });
      setScholarshipImages(post.images || []);
      setManageMode('edit');
    } catch (error) {
      console.error('Error in editPost:', error);
      alert('Error editing post: ' + error.message);
    }
  };

  // Filter applicants by month
  const getMonthlyApplicants = (applicants, monthFilter) => {
    if (monthFilter === 'all') {
      return applicants;
    }
    
    return applicants.filter(applicant => {
      if (!applicant.dateApplied) return false;
      
      const appliedDate = new Date(applicant.dateApplied);
      if (isNaN(appliedDate.getTime())) return false;
      
      const appliedMonth = appliedDate.toISOString().slice(0, 7); // YYYY-MM
      return appliedMonth === monthFilter;
    });
  };

  // Calculate Financial Status based on Income Limit
  const getFinancialStatusLabel = (incomeVal, limitVal) => {
    const income = parseFloat((incomeVal || "0").toString().replace(/,/g, ''));
    const limit = parseFloat((limitVal || "0").toString().replace(/,/g, ''));
    if (isNaN(income) || isNaN(limit) || limit === 0) return incomeVal || 'Unknown';
    
    const ratio = income / limit;
    if (ratio <= 0.30) return "Very Low";
    if (ratio <= 0.60) return "Low";
    if (ratio <= 0.85) return "Average";
    return "High";
  };

  // Generate monthly statistics
  const generateMonthlyStats = (applicants) => {
    const monthlyData = {};
    
    applicants.forEach(applicant => {
      if (!applicant.dateApplied) return;
      
      const appliedDate = new Date(applicant.dateApplied);
      if (isNaN(appliedDate.getTime())) return;
      
      const monthKey = appliedDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
      
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = { month: monthKey, applications: 0, accepted: 0, declined: 0 };
      }
      
      monthlyData[monthKey].applications++;
      if (applicant.status === 'Accepted') {
        monthlyData[monthKey].accepted++;
      } else if (applicant.status === 'Declined') {
        monthlyData[monthKey].declined++;
      }
    });
    
    return Object.values(monthlyData).sort((a, b) => {
      const dateA = new Date(a.month + ' 1, 2024');
      const dateB = new Date(b.month + ' 1, 2024');
      return dateB - dateA;
    });
  };

  // This function is assumed to be used to calculate the historicalData object if it were dynamic.
  // Since historicalData is static in initialAfricaData, this function is not actively called
  // in the provided code, but if it were, it would use getFinancialStatusLabel.
  const calculateHistoricalData = (allApplicants) => {
    const activePost = data.scholarshipPosts?.find(p => p.status === 'active' || p.status === 'ongoing');
    const incomeLimit = activePost?.parentFinance || 0; // Get income limit from active post

    const financialBreakdown = {};
    allApplicants.forEach(a => {
      const income = a.income || a.family?.grossIncome || '0';
      const finLabel = getFinancialStatusLabel(income, incomeLimit);
      financialBreakdown[finLabel] = (financialBreakdown[finLabel] || 0) + 1;
    });

    // Example of how other parts of historicalData would be calculated
    // This is a placeholder as the original historicalData is static.
    // If this function were to fully generate historicalData, it would look like this:
    /*
    const monthlyApplications = generateMonthlyStats(allApplicants);
    const courseDistribution = {}; // calculate course distribution
    const gradeRanges = {}; // calculate grade ranges
    const locationStats = {}; // calculate location stats
    const schoolStats = {}; // calculate school stats
    const performanceMetrics = {}; // calculate performance metrics

    return {
      monthlyApplications: Object.values(monthlyApplications),
      courseDistribution: Object.values(courseDistribution),
      financialBreakdown: Object.entries(financialBreakdown).map(([level, count]) => ({ level, count, percentage: (count / allApplicants.length * 100).toFixed(0) })),
      gradeRanges: Object.values(gradeRanges),
      locationStats: Object.values(locationStats),
      performanceMetrics: performanceMetrics,
      schoolStats: Object.values(schoolStats)
    };
    */
    // For now, we'll just return the financialBreakdown part if this function were to be used.
    return {
      ...data.historicalData, // Keep existing static data
      financialBreakdown: Object.entries(financialBreakdown).map(([level, count]) => ({
        level,
        count,
        percentage: allApplicants.length > 0 ? parseFloat((count / allApplicants.length * 100).toFixed(0)) : 0
      })).sort((a, b) => {
        // Sort by a predefined order for consistency
        const order = { "Very Low": 1, "Low": 2, "Average": 3, "High": 4, "Unknown": 5 };
        return order[a.level] - order[b.level];
      })
    };
  };


  const deletePost = (postId) => {
    if (confirm('Are you sure you want to delete this scholarship post?')) {
      setData(prev => ({
        ...prev,
        scholarshipPosts: prev.scholarshipPosts.filter(post => post.id !== postId)
      }));
    }
  };

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

    return cleanupCharts;
  }, [section, reportsView, stats, data.historicalData]);

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString();
  };

  const viewApplicantFn = (index, listType = 'all') => {
    setViewApplicant({ listType, index });
    setSection('view-applicant');
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

  const acceptApplicant = async () => {
    if (!viewApplicant || viewApplicant.listType !== 'all') return;
    const { index } = viewApplicant;
    
    try {
      const applicant = data.applicants[index];
      if (!applicant) return;
      
      // Call backend API to persist the change
      await scholarshipAPI.acceptApplicant(applicant.id);
      
      // Update frontend state
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
    } catch (error) {
      console.error('Error accepting applicant:', error);
      alert('Failed to accept applicant. Please try again.');
    }
  };

  const declineApplicant = async () => {
    if (!viewApplicant || viewApplicant.listType !== 'all') return;
    const { index } = viewApplicant;
    
    try {
      const applicant = data.applicants[index];
      if (!applicant) return;
      
      // Call backend API to persist the change
      await scholarshipAPI.declineApplicant(applicant.id);
      
      // Update frontend state
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
    } catch (error) {
      console.error('Error declining applicant:', error);
      alert('Failed to decline applicant. Please try again.');
    }
  };

  const cancelApplicant = async (listType, index) => {
    try {
      const list = data[listType] || [];
      const applicant = list[index];
      if (!applicant) return;
      
      // Call backend API to persist the change
      await scholarshipAPI.cancelApplicant(applicant.id);
      
      // Update frontend state
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
    } catch (error) {
      console.error('Error canceling applicant:', error);
      alert('Failed to cancel applicant status. Please try again.');
    }
  };

  const getStudentStatus = (email, name) => {
    const inList = (list) => list.some((a) => a.studentContact?.email === email || a.name === name);
    if (inList(data.accepted)) return 'Accepted';
    if (inList(data.declined)) return 'Declined';
    if (inList(data.applicants)) return 'Pending';
    return 'Unknown';
  };

  const groupMessagesByStudent = (messages) => {
    const grouped = {};
    messages.forEach((m) => {
      const key = m.studentEmail || m.studentName;
      if (!grouped[key]) {
        grouped[key] = {
          studentName: m.studentName,
          studentEmail: m.studentEmail,
          studentPhone: m.studentPhone,
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
    if (!replyText.trim()) return;
    const reply = {
      id: Date.now().toString(),
      text: replyText,
      timestamp: new Date().toISOString(),
      from: 'Admin',
    };
    setData((d) => ({
      ...d,
      inbox: d.inbox.map((m) => (m.id === messageId ? { ...m, replies: [...(m.replies || []), reply] } : m)),
    }));
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
        const studentStatus = getStudentStatus(c.studentEmail, c.studentName);
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

  const renderManage = () => {
    if (manageMode === 'list') {
      return (
        <section className="bg-white p-6 rounded-xl shadow-sm">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
            <h3 className="text-xl font-semibold text-[#800020]">Africa Scholarship - Manage Posts</h3>
            <button
              type="button"
              onClick={() => {
                resetForm();
                setManageMode('create');
              }}
              className="px-4 py-2 rounded-lg bg-[#800020] text-white font-semibold flex items-center gap-2 hover:bg-[#650018] transition-colors"
            >
              <FaPlus /> Add New Post
            </button>
          </div>

          <div className="space-y-4">
            {data.scholarshipPosts.length > 0 ? (
              data.scholarshipPosts.map((post) => (
                <div key={post.id} className="border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h4 className="text-lg font-semibold text-[#800020] mb-2">{post.title}</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-600">
                        <div><strong>Deadline:</strong> {post.deadline}</div>
                        <div><strong>Slots:</strong> {post.slots}</div>
                        <div><strong>Eligibility:</strong> {post.eligibility}</div>
                        <div><strong>Status:</strong> <span className="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs font-semibold">{post.status}</span></div>
                      </div>
                      <p className="text-sm text-gray-700 mt-3 line-clamp-2">{post.description}</p>
                      {post.images && post.images.length > 0 && (
                        <div className="flex gap-2 mt-3">
                          {post.images.slice(0, 3).map((img) => (
                            <img key={img.id} src={img.url} alt={img.name} className="w-16 h-16 object-cover rounded-lg border border-gray-200" />
                          ))}
                          {post.images.length > 3 && (
                            <div className="w-16 h-16 bg-gray-100 rounded-lg border border-gray-200 flex items-center justify-center text-xs text-gray-600">
                              +{post.images.length - 3}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="text-xs text-gray-500 mt-3">
                        Created: {formatDate(post.createdAt)}
                      </div>
                    </div>
                    <div className="flex gap-2 ml-4">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          console.log('Edit button clicked for post:', post);
                          editPost(post);
                        }}
                        className="p-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                        title="Edit Post"
                      >
                        <FaEdit />
                      </button>
                      <button
                        type="button"
                        onClick={() => deletePost(post.id)}
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
            )}
          </div>
        </section>
      );
    }

    return (
      <section className="bg-white p-6 rounded-xl shadow-sm">
        <div className="flex items-center justify-between gap-3 mb-6">
          <h3 className="text-xl font-semibold text-[#800020]">
            {manageMode === 'edit' ? 'Edit Scholarship Post' : 'Create New Scholarship Post'}
          </h3>
          <button
            type="button"
            onClick={() => setManageMode('list')}
            className="px-4 py-2 rounded-lg bg-gray-500 text-white font-semibold hover:bg-gray-600 transition-colors"
          >
            ← Back to List
          </button>
        </div>

        <form className="grid grid-cols-1 md:grid-cols-2 gap-4" onSubmit={(e) => { e.preventDefault(); saveScholarshipPost(); }}>
          <div>
            <label className="block text-sm font-semibold text-[#800020] mb-1">Title *</label>
            <input
              type="text"
              name="title"
              value={formData.title}
              onChange={handleFormChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50"
              placeholder="e.g. Africa Scholarship 2026"
              required
            />
          </div>
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
            <label className="block text-sm font-semibold text-[#800020] mb-1">Eligibility *</label>
            <input
              type="text"
              name="eligibility"
              value={formData.eligibility}
              onChange={handleFormChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50"
              placeholder="e.g. African students with minimum 85% grade"
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
                  {scholarshipImages.map((image) => (
                    <div key={image.id} className="relative group">
                      <img
                        src={image.url}
                        alt={image.name}
                        className="w-full h-32 object-cover rounded-lg border border-gray-200"
                      />
                      <button
                        type="button"
                        onClick={() => removeImage(image.id)}
                        className="absolute top-2 right-2 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <FaTimesCircle className="text-xs" />
                      </button>
                      <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs p-1 rounded-b-lg truncate">
                        {image.name}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="md:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={resetForm} className="px-4 py-2 rounded-lg bg-gray-500 text-white font-semibold hover:bg-gray-600 transition-colors">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-[#800020] text-white font-semibold hover:bg-[#650018] transition-colors">
              {manageMode === 'edit' ? 'Update Post' : 'Create Post'}
            </button>
          </div>
        </form>
      </section>
    );
  };

  const renderTrack = () => {
    const activePost = data.scholarshipPosts?.find(p => p.status === 'active' || p.status === 'ongoing');
    const incomeLimit = activePost?.parentFinance || 0;

    const filterList = (list) => {
      return list.filter((a) => {
        const search = searchTrack.toLowerCase();
        const matchesSearch =
          a.name.toLowerCase().includes(search) ||
          (a.school && a.school.toLowerCase().includes(search)) ||
          (a.municipality && a.municipality.toLowerCase().includes(search)) ||
          (a.mobileNumber && a.mobileNumber.toLowerCase().includes(search));
        const matchesType =
          typeFilter === 'all' ||
          (typeFilter === 'scholarship' && a.applicationType === 'Scholarship') ||
          (typeFilter === 'grant' && a.applicationType === 'Financial Assistance Grant');

        return matchesSearch && matchesType;
      });
    };

    const allList = filterList(data.applicants);
    const acceptedList = filterList(data.accepted);
    const declinedList = filterList(data.declined);

    return (
      <section className="bg-white p-6 rounded-xl shadow-sm">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <h3 className="text-xl font-semibold text-[#800020]">Africa Scholarship - Track Applicants</h3>
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
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none font-bold text-[#800020] shadow-sm focus:ring-2 focus:ring-[#800020] transition-all"
          >
            <option value="all">All Types</option>
            <option value="scholarship">Scholarship Only</option>
            <option value="grant">Financial Assistance Grant</option>
          </select>
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
                allList.map((a) => {
                  const idx = data.applicants.indexOf(a);
                  return (
                    <tr key={`${a.name}-${idx}`} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-4 py-3">{a.name}</td>
                      <td className="px-4 py-3">{a.grade}</td>
                      <td className="px-4 py-3">{getFinancialStatusLabel(a.income || a.family?.grossIncome, incomeLimit)}</td>
                      <td className="px-4 py-3 text-xs">{a.school}</td>
                      <td className="px-4 py-3 text-[10px] leading-tight text-gray-600">{a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'}<br />{a.municipality || 'N/A'}</td>
                      <td className="px-4 py-3">
                        <button type="button" onClick={() => viewApplicantFn(idx, 'all')} className="px-3 py-1 rounded bg-[#800020] text-white text-xs font-semibold hover:bg-[#650018] transition-colors">
                          View
                        </button>
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
                      <td className="px-4 py-3">{getFinancialStatusLabel(a.income || a.family?.grossIncome, incomeLimit)}</td>
                      <td className="px-4 py-3 text-xs">{a.school}</td>
                      <td className="px-4 py-3 text-[10px] leading-tight text-gray-600">{a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'}<br />{a.municipality || 'N/A'}</td>
                      <td className="px-4 py-3">
                        <button type="button" onClick={() => viewApplicantFn(idx, 'accepted')} className="px-3 py-1 rounded bg-[#800020] text-white text-xs font-semibold mr-1 hover:bg-[#650018] transition-colors">
                          View
                        </button>
                        <button type="button" onClick={() => cancelApplicant('accepted', idx)} className="px-3 py-1 rounded bg-amber-500 text-gray-900 text-xs font-semibold">
                          Cancel
                        </button>
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
                      <td className="px-4 py-3">{getFinancialStatusLabel(a.income || a.family?.grossIncome, incomeLimit)}</td>
                      <td className="px-4 py-3 text-xs">{a.school}</td>
                      <td className="px-4 py-3 text-[10px] leading-tight text-gray-600">{a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'}<br />{a.municipality || 'N/A'}</td>
                      <td className="px-4 py-3">
                        <button type="button" onClick={() => viewApplicantFn(idx, 'declined')} className="px-3 py-1 rounded bg-[#800020] text-white text-xs font-semibold mr-1 hover:bg-[#650018] transition-colors">
                          View
                        </button>
                        <button type="button" onClick={() => cancelApplicant('declined', idx)} className="px-3 py-1 rounded bg-amber-500 text-gray-900 text-xs font-semibold">
                          Cancel
                        </button>
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
    const activePost = data.scholarshipPosts?.find(p => p.status === 'active' || p.status === 'ongoing');
    const incomeLimit = activePost?.parentFinance || 0;

    if (type === 'track') {
      const filterListToExport = (list) => list.filter((a) => {
        const search = searchTrack.toLowerCase();
        return (
          a.name.toLowerCase().includes(search) ||
          (a.school && a.school.toLowerCase().includes(search)) ||
          (a.municipality && a.municipality.toLowerCase().includes(search)) ||
          (a.mobileNumber && a.mobileNumber.toLowerCase().includes(search))
        );
      });

      const fileName = `Africa_Tracking_Full_${new Date().toISOString().split('T')[0]}`;
      const wb = XLSX.utils.book_new();

      const formatTracking = (list) => list.map(app => ({
        'Student Name': app.name,
        'Grade': app.grade,
        'Financial Status': getFinancialStatusLabel(app.income || app.family?.grossIncome, incomeLimit),
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
      'Financial Status': getFinancialStatusLabel(app.income || app.family?.grossIncome, incomeLimit),
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
    XLSX.writeFile(wb, 'Africa_Scholarship_Report.xlsx');
  };

  const renderReports = () => {
    const { historicalData } = data;
    const activePost = data.scholarshipPosts?.find(p => p.status === 'active' || p.status === 'ongoing');
    const incomeLimit = activePost?.parentFinance || 0;
    
    // Get all applicants for monthly filtering
    const allApplicants = [...data.applicants, ...data.accepted, ...data.declined];
    const filteredApplicants = getMonthlyApplicants(allApplicants, monthlyFilter === 'specific' ? selectedMonth : 'all');
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
            <h3 className="text-2xl font-bold text-[#800020] report-title">Africa Scholarship Reports</h3>
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
            {/* Monthly Filter */}
            <div className="flex items-center gap-2">
              <select
                value={monthlyFilter}
                onChange={(e) => setMonthlyFilter(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm font-bold bg-white"
              >
                <option value="all">All Months</option>
                <option value="specific">Specific Month</option>
              </select>
              {monthlyFilter === 'specific' && (
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm font-bold"
                />
              )}
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
              {kpiCards.map((card, idx) => (
                <div key={idx} className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center text-center">
                  <span className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-2">{card.label}</span>
                  <span className="text-2xl font-black text-gray-800 mb-1">{card.value}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${card.trend.startsWith('+') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                    {card.trend}
                  </span>
                </div>
              ))}
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

              {/* Course Distribution - Horizontal Bars */}
              <div className="lg:col-span-4 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <h4 className="text-lg font-bold text-gray-800 mb-6 font-primary">Course Distribution</h4>
                <div className="h-[280px]">
                  <canvas ref={barChartRef} />
                </div>
              </div>

              {/* Location/Stats - Doughnut */}
              <div className="lg:col-span-3 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <h4 className="text-lg font-bold text-gray-800 mb-6">Location Split</h4>
                <div className="h-[220px] mb-4">
                  <canvas ref={courseChartRef} />
                </div>
                <div className="space-y-2 mt-4">
                  {historicalData.courseDistribution.slice(0, 4).map((c, i) => (
                    <div key={i} className="flex items-center justify-between text-[10px] font-bold">
                      <span className="text-gray-500">{c.course}</span>
                      <span className="text-gray-800">{c.percentage}%</span>
                    </div>
                  ))}
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
                      <div key={i} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: ['#800020', '#198754', '#0d6efd', '#ffc107', '#6c757d'][i] }}></div>
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
                  Current data shows that <strong>{historicalData.schoolStats[0].school}</strong> remains the primary source of applicants for the Africa Scholarship, contributing to {historicalData.schoolStats[0].percentage}% of the total application volume.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white p-4 rounded-xl border border-blue-100">
                    <p className="text-[10px] font-black text-gray-400 uppercase">Top Institution</p>
                    <p className="font-bold text-gray-800 truncate text-xs">{historicalData.schoolStats[0].school}</p>
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
                        {monthlyStats.map((m, idx) => (
                          <tr key={idx} className="hover:bg-gray-50 transition-colors">
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
                    ].map((metric, i) => (
                      <div key={i} className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100">
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
                        {historicalData.courseDistribution.map((c, idx) => (
                          <tr key={idx} className="hover:bg-gray-50 transition-colors">
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
                        {historicalData.gradeRanges.map((g, idx) => (
                          <tr key={idx} className="hover:bg-gray-50 transition-colors">
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
                        {historicalData.financialBreakdown.map((f, idx) => (
                          <tr key={idx} className="hover:bg-gray-50 transition-colors">
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
                        {historicalData.locationStats.map((loc, idx) => (
                          <tr key={idx} className="hover:bg-gray-50 transition-colors">
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
                        {historicalData.schoolStats.map((s, idx) => (
                          <tr key={idx} className="hover:bg-gray-50 transition-colors">
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
                            {data.applicants.map((a, i) => (
                              <tr key={i} className="hover:bg-gray-50"><td className="p-3 font-bold text-gray-800">{a.name}</td><td className="p-3">{a.grade}</td><td className="p-3">{getFinancialStatusLabel(a.income || a.family?.grossIncome, incomeLimit)}</td><td className="p-3">{a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'} - {a.municipality || 'N/A'}</td></tr>
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
                            {data.accepted.map((a, i) => (
                              <tr key={i} className="hover:bg-gray-50"><td className="p-3 font-bold text-gray-800">{a.name}</td><td className="p-3">{a.grade}</td><td className="p-3">{getFinancialStatusLabel(a.income || a.family?.grossIncome, incomeLimit)}</td><td className="p-3">{a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'} - {a.municipality || 'N/A'}</td></tr>
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
                            {data.declined.map((a, i) => (
                              <tr key={i} className="hover:bg-gray-50"><td className="p-3 font-bold text-gray-800">{a.name}</td><td className="p-3">{a.grade}</td><td className="p-3">{getFinancialStatusLabel(a.income || a.family?.grossIncome, incomeLimit)}</td><td className="p-3">{a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'} - {a.municipality || 'N/A'}</td></tr>
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
                  {historicalData.monthlyApplications.map((m, idx) => (
                    <tr key={idx}>
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
                  {historicalData.courseDistribution.map((c, idx) => (
                    <tr key={idx}>
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
                  {historicalData.gradeRanges.map((g, idx) => (
                    <tr key={idx}>
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
                  {historicalData.schoolStats.map((s, idx) => (
                    <tr key={idx}>
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
                  {historicalData.locationStats.map((loc, idx) => (
                    <tr key={idx}>
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
                  {data.applicants.map((a, i) => (
                    <tr key={i}>
                      <td className="border p-2 font-bold">{a.name}</td>
                      <td className="border p-2">{a.grade}</td>
                      <td className="border p-2">{getFinancialStatusLabel(a.income || a.family?.grossIncome, incomeLimit)}</td>
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
                  {data.accepted.map((a, i) => (
                    <tr key={i}>
                      <td className="border p-2 font-bold">{a.name}</td>
                      <td className="border p-2">{a.grade}</td>
                      <td className="border p-2">{getFinancialStatusLabel(a.income || a.family?.grossIncome, incomeLimit)}</td>
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
                  {data.declined.map((a, i) => (
                    <tr key={i}>
                      <td className="border p-2 font-bold">{a.name}</td>
                      <td className="border p-2">{a.grade}</td>
                      <td className="border p-2">{getFinancialStatusLabel(a.income || a.family?.grossIncome, incomeLimit)}</td>
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
              <p className="text-xs font-black text-gray-900">Africa Scholarship Administrator</p>
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

    const activePost = data.scholarshipPosts?.find(p => p.status === 'active' || p.status === 'ongoing');
    const incomeLimit = activePost?.parentFinance || 0;

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
          <h2 className="text-2xl font-black text-[#800020] uppercase tracking-tight">Applicant Dossier</h2>
          <div className="flex gap-2">
            <span className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase ${isPending ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
              {isPending ? 'Pending Review' : 'Active Student'}
            </span>
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
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Street & Barangay</p>
              <p className="font-bold text-gray-800">{a.street ? `${a.street}, ${a.barangay}` : (a.location && a.location.split(',')[0])}</p>
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
              <p className="font-bold text-gray-800">{a.zipCode || '4217'}</p>
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
              <p className="font-bold text-gray-800 truncate">{a.emailAddress || (a.studentContact && a.studentContact.email)}</p>
            </div>
            <div className="p-4 border-t border-r border-gray-100">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Mobile Number</p>
              <p className="font-bold text-gray-800">{a.mobileNumber || (a.studentContact && a.studentContact.phone)}</p>
            </div>
            <div className="p-4 border-t border-gray-100">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Course</p>
              <p className="font-bold text-gray-800">{a.course}</p>
            </div>


            <div className="p-4 border-t border-r border-gray-100 col-span-2">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">School Attended</p>
              <p className="font-bold text-gray-800">{a.school}</p>
            </div>
            <div className="p-4 border-t border-r border-gray-100">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">School ID Number</p>
              <p className="font-bold text-gray-800">{a.schoolId || 'N/A'}</p>
            </div>
            <div className="p-4 border-t border-gray-100">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Year Level</p>
              <p className="font-bold text-gray-800">{a.year}</p>
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
                <p className="text-sm"><strong>Name:</strong> {a.family.father.name}</p>
                <div className="flex gap-4 text-xs font-bold items-center">
                  <span>Status:</span>
                  <span className="flex items-center gap-1.5">
                    <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${a.family.father.status === 'Living' ? 'bg-[#800020] border-[#800020]' : 'border-gray-300'}`}>
                      {a.family.father.status === 'Living' && <div className="w-1.5 h-1.5 rounded-full bg-white"></div>}
                    </div>
                    Living
                  </span>
                  <span className="flex items-center gap-1.5">
                    <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${a.family.father.status === 'Deceased' ? 'bg-[#800020] border-[#800020]' : 'border-gray-300'}`}>
                      {a.family.father.status === 'Deceased' && <div className="w-1.5 h-1.5 rounded-full bg-white"></div>}
                    </div>
                    Deceased
                  </span>
                </div>
                <p className="text-sm"><strong>Occupation:</strong> {a.family.father.job}</p>
                <p className="text-sm"><strong>Phone:</strong> {a.family.father.phone}</p>
              </div>
            </div>
            <div className="p-4 bg-gray-50/50">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-3">Mother Information</p>
              <div className="space-y-2">
                <p className="text-sm"><strong>Name:</strong> {a.family.mother.name}</p>
                <div className="flex gap-4 text-xs font-bold items-center">
                  <span>Status:</span>
                  <span className="flex items-center gap-1.5">
                    <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${a.family.mother.status === 'Living' ? 'bg-[#800020] border-[#800020]' : 'border-gray-300'}`}>
                      {a.family.mother.status === 'Living' && <div className="w-1.5 h-1.5 rounded-full bg-white"></div>}
                    </div>
                    Living
                  </span>
                  <span className="flex items-center gap-1.5">
                    <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${a.family.mother.status === 'Deceased' ? 'bg-[#800020] border-[#800020]' : 'border-gray-300'}`}>
                      {a.family.mother.status === 'Deceased' && <div className="w-1.5 h-1.5 rounded-full bg-white"></div>}
                    </div>
                    Deceased
                  </span>
                </div>
                <p className="text-sm"><strong>Occupation:</strong> {a.family.mother.job}</p>
                <p className="text-sm"><strong>Phone:</strong> {a.family.mother.phone}</p>
              </div>
            </div>
            <div className="p-4 border-t border-r border-gray-100">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Parents Gross Income</p>
              <p className="font-bold text-[#800020]">PHP {a.family.grossIncome || 'N/A'}</p>
            </div>
            <div className="p-4 border-t border-gray-100">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">No. of Siblings</p>
              <p className="font-bold text-gray-800">{a.family.siblingsCount || '0'}</p>
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
                  {getFinancialStatusLabel(a.income || a.family?.grossIncome, incomeLimit)}
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
              <h2 className="text-xl font-bold">Africa Scholarship Messenger</h2>
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
                          setViewMessage({ messageId: conv.lastMessage.id });
                          conv.messages.forEach((m) => {
                            if (!m.read) markAsRead(m.id);
                          });
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
                              {getStudentStatus(conv.studentEmail, conv.studentName)}
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
                      Status: <span className="font-semibold">{getStudentStatus(currentConversation.studentEmail, currentConversation.studentName)}</span>
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
              <h2 className="text-xl font-black tracking-tight leading-tight uppercase">Africa</h2>
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
        <header className="bg-white rounded-xl shadow-sm px-6 py-4 mb-6 flex items-center gap-2 text-[#800020] font-bold text-xl">
          <FaTachometerAlt className="text-blue-600" /> Africa Scholarship Dashboard
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

