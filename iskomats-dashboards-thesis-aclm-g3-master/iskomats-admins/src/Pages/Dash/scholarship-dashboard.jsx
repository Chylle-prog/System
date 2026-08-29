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
  FaBars,
  FaTimes,
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
  FaSpinner,
  FaPlay,
  FaAward,
  FaSearchPlus
} from 'react-icons/fa';
import * as XLSX from 'xlsx';
import { adminAPI, scholarshipAPI, announcementService, messagingAPI } from '../../services/api';
import { decryptUrl, preloadMediaUrls } from '../../services/CryptoService';
import socketService from '../../services/socket';
import iskomatsLogo from '../../assets/logo.png';

Chart.register(...registerables);

/**
 * Helper component to handle encrypted images and videos in the dossier
 */
const DecryptedMedia = ({ src, type, className, controls = false, autoPlay = false, onClick = null, alt = "Document" }) => {
  const isVideo = Boolean(
    (type && type.startsWith('video')) ||
    (typeof src === 'string' && (src.includes('.mp4') || src.includes('.webm') || src.includes('.mov') || src.includes('/video/') || src.includes('_vid_url')))
  );

  const [decryptedSrc, setDecryptedSrc] = useState(src);
  const [isLoading, setIsLoading] = useState(Boolean(!isVideo && src && typeof src === 'string' && src.startsWith('http')));
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setHasError(false);

    if (!src || typeof src !== 'string' || !src.startsWith('http')) {
      setDecryptedSrc(src);
      setIsLoading(false);
      return;
    }

    if (isVideo) {
      setDecryptedSrc(src);
      setIsLoading(false);
      return;
    }

    decryptUrl(src, type)
      .then((decrypted) => {
        if (!isMounted) return;
        if (!decrypted) {
          setHasError(true);
        } else {
          setDecryptedSrc(decrypted);
        }
        setIsLoading(false);
      })
      .catch(() => {
        if (!isMounted) return;
        setHasError(true);
        setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [src, type, isVideo]);

  if (isVideo) {
    if (hasError || !src) {
      return (
        <div className={`${className} bg-gray-900 flex flex-col items-center justify-center text-gray-400`} onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default', minHeight: '60px' }}>
          <FaPlay className="text-xl mb-1 text-gray-500" />
          <span className="text-[9px] font-bold uppercase tracking-wider">Video Unavailable</span>
        </div>
      );
    }
    return (
      <video
        src={decryptedSrc || src}
        controls={controls}
        autoPlay={autoPlay}
        preload="metadata"
        playsInline
        className={className}
        onClick={onClick}
        onError={() => setHasError(true)}
      />
    );
  }

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

  return (
    <img
      src={decryptedSrc}
      alt={alt}
      loading="lazy"
      className={className}
      onClick={onClick}
      onError={() => setHasError(true)}
    />
  );
};

const ACADEMIC_YEAR_PATTERN = /^\d{4}[-]\d{4}$/;

const getApplicantAddressDisplay = (a) => {
  if (!a) return 'N/A';
  const streetBrgy = a.streetBrgy || a.street_brgy || a.street || a.barangay || '';
  const municipality = a.municipality || a.town_city_municipality || a.townCity || a.city || '';
  const province = a.province || '';

  const parts = [streetBrgy, municipality, province].map(s => String(s || '').trim()).filter(Boolean);
  if (parts.length > 0) {
    return parts.join(', ');
  }
  return a.location || a.address || 'N/A';
};

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
  return `${currentYear}-${currentYear + 1}`;
};

const normalizeAcademicYear = (value) => {
  const rawValue = String(value || '').trim();
  if (!rawValue) {
    return '';
  }

  const extractedYears = rawValue.match(/\d{4}/g);
  if (extractedYears && extractedYears.length >= 2) {
    return `${extractedYears[0]}-${extractedYears[1]}`;
  }

  const digitsOnly = rawValue.replace(/\D/g, '');
  if (digitsOnly.length >= 8) {
    return `${digitsOnly.slice(0, 4)}-${digitsOnly.slice(4, 8)}`;
  }

  // Replace any dash-like character with a proper en-dash
  return rawValue.replace(/[^\d\-]/g, '').replace(/[\-]{1,}/g, '-');
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

const normalizeSearchText = (value) => String(value ?? '').toLowerCase().trim();

export const normalizeSchoolName = (rawSchool) => {
  if (!rawSchool) return 'Unspecified';
  const str = String(rawSchool).trim();
  if (!str) return 'Unspecified';
  const lower = str.toLowerCase();

  // De La Salle Lipa / DLSL
  if (lower.includes('la salle') || lower.includes('dlsl') || lower.includes('de la salle lipa')) {
    return 'De La Salle Lipa';
  }
  // Batangas State University / BatStateU / BSU
  if (lower.includes('batangas state') || lower.includes('batstateu') || lower.includes('bsu')) {
    return 'Batangas State University';
  }
  // University of Batangas / UB
  if (lower === 'ub' || lower.includes('university of batangas')) {
    return 'University of Batangas';
  }
  // Lipa City Colleges / LCC
  if (lower === 'lcc' || lower.includes('lipa city college') || lower.includes('lipa city colleges')) {
    return 'Lipa City Colleges';
  }
  // Kolehiyo ng Lungsod ng Lipa / KLL
  if (lower === 'kll' || lower.includes('kolehiyo ng lungsod ng lipa')) {
    return 'Kolehiyo ng Lungsod ng Lipa';
  }
  // Polytechnic University of the Philippines / PUP
  if (lower === 'pup' || lower.includes('polytechnic university of the philippines')) {
    return 'Polytechnic University of the Philippines';
  }
  // University of the Philippines / UP
  if (lower === 'up' || lower.includes('university of the philippines')) {
    return 'University of the Philippines';
  }
  // Canossa Academy
  if (lower.includes('canossa')) {
    return 'Canossa Academy';
  }
  // Lipa City National High School
  if (lower.includes('lipa city national high') || lower.includes('lcnhs')) {
    return 'Lipa City National High School';
  }

  // Handle slash formats like "DLSL/De La Salle Lipa" by picking longest descriptive part
  if (str.includes('/')) {
    const parts = str.split('/').map(p => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      return parts.reduce((a, b) => (b.length > a.length ? b : a), parts[0]);
    }
  }

  return str;
};

/**
 * Official 4.0 GPA to Percentage Conversion Table:
 * 98-100   - 4.00 (midpoint ~99%)
 * 95-97    - 3.75 (midpoint ~96%)
 * 92-94    - 3.50 (midpoint ~93%)
 * 89-91    - 3.25 (midpoint ~90%)
 * 86-88    - 3.00 (midpoint ~87%)
 * 83-85    - 2.75 (midpoint ~84%)
 * 80-82    - 2.50 (midpoint ~81%)
 * 77-79    - 2.25 (midpoint ~78%)
 * 75-76    - 2.00 (midpoint ~75.5%)
 * Below 75 - 0.00
 */
export const getGpaRangeLabel = (grade) => {
  if (grade === null || grade === undefined || grade === '') return '';
  const num = parseFloat(String(grade).replace(/%/g, '').trim());
  if (isNaN(num)) return '';
  if (num >= 3.88 && num <= 4.0) return '98-100%';
  if (num >= 3.63 && num < 3.88) return '95-97%';
  if (num >= 3.38 && num < 3.63) return '92-94%';
  if (num >= 3.13 && num < 3.38) return '89-91%';
  if (num >= 2.88 && num < 3.13) return '86-88%';
  if (num >= 2.63 && num < 2.88) return '83-85%';
  if (num >= 2.38 && num < 2.63) return '80-82%';
  if (num >= 2.13 && num < 2.38) return '77-79%';
  if (num >= 1.90 && num < 2.13) return '75-76%';
  if (num < 1.90 && num > 0) return 'Below 75%';
  return '';
};

export const convertGpaToPercentage = (val, schoolName = '') => {
  if (val === null || val === undefined || val === '') return null;
  const cleanStr = String(val).replace(/%/g, '').trim();
  const num = parseFloat(cleanStr);
  if (isNaN(num)) return null;

  // Already on percentage scale (e.g. 50.0 to 100.0)
  if (num >= 50.0 && num <= 100.0) {
    return num;
  }

  // 1.0 to 5.0 Point scale
  if (num >= 0.0 && num <= 5.0) {
    const schoolLower = String(schoolName || '').toLowerCase().trim();
    let isUpSystem = false;

    if (schoolLower) {
      const upKeywords = ['philippines', 'up', 'pup', 'plm', 'pamantasan', 'tup', 'bulsu', 'state', 'university', 'college', 'technological', 'mapua', 'su'];
      const dlsuKeywords = ['la salle', 'dlsu', 'ateneo', 'admu', 'benilde', 'csb', 'beda'];
      if (upKeywords.some(kw => schoolLower.includes(kw)) && !dlsuKeywords.some(kw => schoolLower.includes(kw))) {
        isUpSystem = true;
      }
    } else if (num >= 1.0 && num <= 1.9) {
      isUpSystem = true;
    }

    if (isUpSystem) {
      // UP/State U 1.0 - 5.0 scale (1.0 = 100%, 3.0 = 75%, 5.0 = 50%)
      return Math.round((100 - (num - 1.0) * 12.5) * 100) / 100;
    }

    // 4.0 Scale tier mapping from chart
    if (num >= 3.88) return 99;   // 98-100 (4.00)
    if (num >= 3.63) return 96;   // 95-97  (3.75)
    if (num >= 3.38) return 93;   // 92-94  (3.50)
    if (num >= 3.13) return 90;   // 89-91  (3.25)
    if (num >= 2.88) return 87;   // 86-88  (3.00)
    if (num >= 2.63) return 84;   // 83-85  (2.75)
    if (num >= 2.38) return 81;   // 80-82  (2.50)
    if (num >= 2.13) return 78;   // 77-79  (2.25)
    if (num >= 1.90) return 75.5; // 75-76  (2.00)
    if (num > 0.0) {
      // Below 2.00 / Below 75
      return Math.max(0, Math.round((75 - (2.0 - num) * 12) * 100) / 100);
    }
    return 0; // 0.00 -> Below 75
  }

  // Fraction scale (e.g. 0.85 = 85%)
  if (num > 0.0 && num < 1.0) {
    return Math.round(num * 10000) / 100;
  }

  return num;
};

export const formatGpaDisplay = (grade, schoolName = '') => {
  if (grade === null || grade === undefined || grade === '') return 'N/A';
  const cleanStr = String(grade).replace(/%/g, '').trim();
  const num = parseFloat(cleanStr);
  if (isNaN(num)) return String(grade);

  // If already percentage >= 50
  if (num >= 50.0 && num <= 100.0) {
    const formatted = (num % 1 === 0) ? num.toFixed(0) : num.toFixed(2).replace(/\.?0+$/, '');
    return `${formatted}%`;
  }

  const converted = convertGpaToPercentage(grade, schoolName);
  if (converted === null || isNaN(converted)) return String(grade);
  const formatted = (converted % 1 === 0) ? converted.toFixed(0) : converted.toFixed(2).replace(/\.?0+$/, '');
  return `${formatted}%`;
};

const EMPTY_ADVANCED_SEARCH = {
  scholarshipName: '',
  provider: '',
  educationLevel: '',
  courseProgram: '',
  location: '',
  academicRequirements: '',
  incomeBracket: '',
  status: '',
  deadlineFrom: '',
  deadlineTo: '',
  scholarshipType: '',
  minGpa: '',
  applicantName: '',
  familyName: '',
  applicantSchool: '',
  applicantGpa: '',
  year: '',
  dateApplied: '',
  appliedDate: '',
  appliedToDate: '',
  accompliteToDate: ''
};

const getScholarshipField = (post, fieldNames) => {
  for (const fieldName of fieldNames) {
    const value = post?.[fieldName];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
};

const hasActiveAdvancedFilters = (advanced) =>
  Object.values(advanced).some((value) => String(value ?? '').trim() !== '');

const getApplicantScholarshipPost = (applicant, scholarshipPosts) => {
  const posts = scholarshipPosts || [];
  const applicantReqNo = String(
    applicant.reqNo || applicant.req_no || applicant.request_no || applicant.scholarshipNo || applicant.scholarship_no || ''
  );

  if (applicantReqNo) {
    const byId = posts.find((post) => String(post.reqNo || post.id || '') === applicantReqNo);
    if (byId) {
      return byId;
    }
  }

  const applicantScholarshipName = normalizeSearchText(
    applicant.scholarshipName || applicant.scholarship_name || applicant.appliedScholarship || applicant.scholarship || applicant.scholarshipTitle || ''
  );

  if (!applicantScholarshipName) {
    return null;
  }

  return posts.find((post) => {
    const postName = normalizeSearchText(post.scholarshipName || post.title || '');
    return postName && (postName === applicantScholarshipName || postName.includes(applicantScholarshipName) || applicantScholarshipName.includes(postName));
  }) || null;
};

const applicantMatchesAdvancedScholarshipFilters = (applicant, advanced, scholarshipPosts) => {
  if (!hasActiveAdvancedFilters(advanced)) {
    return true;
  }

  // Filter by applicant's own attributes
  if (advanced.applicantName && !normalizeSearchText(applicant.name).includes(normalizeSearchText(advanced.applicantName))) {
    return false;
  }

  if (advanced.applicantSchool && !normalizeSearchText(applicant.school).includes(normalizeSearchText(advanced.applicantSchool))) {
    return false;
  }

  if (advanced.applicantGpa) {
    const rawGpaText = normalizeSearchText(String(applicant.grade || applicant.overall_gpa || applicant.gpa || ''));
    const convertedGpaText = normalizeSearchText(formatGpaDisplay(applicant.grade || applicant.overall_gpa || applicant.gpa, applicant.school));
    const searchGpaText = normalizeSearchText(advanced.applicantGpa);
    if (!rawGpaText.includes(searchGpaText) && !convertedGpaText.includes(searchGpaText)) {
      return false;
    }
  }

  if (advanced.familyName && !normalizeSearchText(applicant.lastName || applicant.last_name || applicant.surname || applicant.family_name || applicant.name || '').includes(normalizeSearchText(advanced.familyName))) {
    return false;
  }

  if (advanced.year && !normalizeSearchText(String(applicant.year || applicant.year_level || applicant.yearLevel || '')).includes(normalizeSearchText(advanced.year))) {
    return false;
  }

  const selectedAppliedDate = advanced.dateApplied || advanced.appliedDate || advanced.appliedToDate || advanced.accompliteToDate || advanced.applicationDateTo || advanced.dateTo;
  if (selectedAppliedDate) {
    const rawAppliedDate = applicant.status_created_at || applicant.created_at || applicant.createdAt || applicant.dateApplied || applicant.date_applied || applicant.status_updated || applicant.statusUpdated;
    if (!rawAppliedDate) {
      return false;
    }

    const appDate = new Date(rawAppliedDate);
    if (isNaN(appDate.getTime())) {
      return false;
    }

    const targetDateStr = String(selectedAppliedDate).trim().slice(0, 10);

    const localYear = appDate.getFullYear();
    const localMonth = String(appDate.getMonth() + 1).padStart(2, '0');
    const localDay = String(appDate.getDate()).padStart(2, '0');
    const localDateStr = `${localYear}-${localMonth}-${localDay}`;

    const utcYear = appDate.getUTCFullYear();
    const utcMonth = String(appDate.getUTCMonth() + 1).padStart(2, '0');
    const utcDay = String(appDate.getUTCDate()).padStart(2, '0');
    const utcDateStr = `${utcYear}-${utcMonth}-${utcDay}`;

    if (localDateStr !== targetDateStr && utcDateStr !== targetDateStr) {
      return false;
    }
  }

  if (advanced.courseProgram && applicant.course && !normalizeSearchText(applicant.course).includes(normalizeSearchText(advanced.courseProgram))) {
    return false;
  }

  if (advanced.location) {
    const fullAddr = getApplicantAddressDisplay(applicant);
    const locationFields = [
      fullAddr,
      applicant.municipality,
      applicant.town_city_municipality,
      applicant.townCity,
      applicant.city,
      applicant.address,
      applicant.location,
      applicant.streetBrgy,
      applicant.street_brgy,
      applicant.street,
      applicant.barangay,
      applicant.province
    ].map(s => String(s || '').toLowerCase()).join(' ');

    if (!locationFields.includes(normalizeSearchText(advanced.location))) {
      return false;
    }
  }

  if (advanced.incomeBracket && (applicant.income || applicant.financial_income_of_parents || applicant.parentFinance || applicant.family?.grossIncome) && !normalizeSearchText(String(applicant.income || applicant.financial_income_of_parents || applicant.parentFinance || applicant.family?.grossIncome)).includes(normalizeSearchText(advanced.incomeBracket))) {
    return false;
  }

  if (advanced.status && applicant.status !== advanced.status) {
    return false;
  }

  // Filter by scholarship attributes (scholarship they applied to)
  const post = getApplicantScholarshipPost(applicant, scholarshipPosts);

  if (advanced.scholarshipName) {
    const postName = normalizeSearchText(post?.scholarshipName || post?.title || '');
    if (!postName.includes(normalizeSearchText(advanced.scholarshipName))) {
      return false;
    }
  }

  if (advanced.provider) {
    const providerValue = normalizeSearchText(getScholarshipField(post, ['providerName', 'provider_name', 'provider', 'program']));
    if (!providerValue.includes(normalizeSearchText(advanced.provider))) {
      return false;
    }
  }

  if (advanced.educationLevel) {
    const educationValue = normalizeSearchText(getScholarshipField(post, ['educationLevel', 'education_level', 'education', 'education_level_required']));
    if (!educationValue.includes(normalizeSearchText(advanced.educationLevel))) {
      return false;
    }
  }

  if (advanced.scholarshipType) {
    const scholarshipTypeValue = normalizeSearchText(getScholarshipField(post, ['scholarshipType', 'scholarship_type', 'type', 'program_type']));
    if (!scholarshipTypeValue.includes(normalizeSearchText(advanced.scholarshipType))) {
      return false;
    }
  }

  if (advanced.academicRequirements) {
    const academicRequirements = normalizeSearchText(getScholarshipField(post, ['academicRequirements', 'requirements', 'eligibility', 'eligibilityRequirements', 'minGpa']));
    if (!academicRequirements.includes(normalizeSearchText(advanced.academicRequirements))) {
      return false;
    }
  }

  if (advanced.minGpa) {
    const minGpaValue = normalizeSearchText(post?.minGpa);
    if (!minGpaValue.includes(normalizeSearchText(advanced.minGpa))) {
      return false;
    }
  }

  if (advanced.deadlineFrom || advanced.deadlineTo) {
    const deadlineValue = post?.deadline ? new Date(post.deadline) : null;
    if (advanced.deadlineFrom) {
      const fromDate = new Date(advanced.deadlineFrom);
      if (deadlineValue && deadlineValue < fromDate) {
        return false;
      }
    }
    if (advanced.deadlineTo) {
      const toDate = new Date(advanced.deadlineTo);
      toDate.setHours(23, 59, 59, 999);
      if (deadlineValue && deadlineValue > toDate) {
        return false;
      }
    }
  }

  return true;
};

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
  if (!(file instanceof File) || !file.type.startsWith('image/')) {
    resolve(file);
    return;
  }

  const image = new Image();
  const objectUrl = URL.createObjectURL(file);

  image.onload = () => {
    const maxDimension = 1200;
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

const ALL_ADMIN_PROVIDER_ROOMS = [
  {
    room: 'provider_room_1',
    pro_no: 1,
    applicant_no: 'admin-room-1',
    studentName: "Mayor Eric B. Africa's Scholarship",
    studentEmail: "Mayor Africa Admin Channel",
    badge: "Mayor Africa",
    icon: "fas fa-landmark"
  },
  {
    room: 'provider_room_2',
    pro_no: 2,
    applicant_no: 'admin-room-2',
    studentName: "Governor Vilma Santos-Recto's Scholarship",
    studentEmail: "Governor Vilma Admin Channel",
    badge: "Governor Vilma",
    icon: "fas fa-award"
  }
];

export default function ScholarshipDashboard({
  providerKey,
  providerName,
  scholarshipLabel = `${providerName} Scholarship`,
  programName = `${providerName} Scholarship Program`,
  dashboardTitle = `${providerName} Scholarship Dashboard`,
  reportFilePrefix = providerName,
  proNo,
  logo,
  standaloneInbox = false,
}) {
  // Get user name and ID from localStorage / token
  const userName = localStorage.getItem('userName') || 'Admin';
  const userFirstName = localStorage.getItem('userFirstName') || 'Admin';
  const currentUserId = useMemo(() => {
    const payload = decodeTokenPayload(localStorage.getItem('authToken'));
    return payload?.user_id || payload?.id || payload?.user_no || socketService.userId || null;
  }, []);
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
  const userRole = (localStorage.getItem('userRole') || '').toLowerCase();
  const isSuperAdminUser = useMemo(() => {
    return (
      standaloneInbox ||
      providerKey === 'system' ||
      userRole === 'admin' ||
      userRole === 'superadmin' ||
      userRole === 'super_admin' ||
      !activeProviderNo ||
      activeProviderNo === 0
    );
  }, [standaloneInbox, providerKey, activeProviderNo, userRole]);

  const [section, setSection] = useState(standaloneInbox ? 'inbox' : 'dashboard'); // dashboard | finder | manage | track | reports | inbox | view-applicant
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [reportsView, setReportsView] = useState('tables'); // analytics | tables
  const [trackTab, setTrackTab] = useState('all'); // pending | all | accepted | declined
  const [applicantTrackPage, setApplicantTrackPage] = useState(1);
  const [analyticsScholarshipFilter, setAnalyticsScholarshipFilter] = useState('all');
  const [trackScholarshipFilter, setTrackScholarshipFilter] = useState('all');
  const [data, setData] = useState(initialDashboardData);
  const [searchTrack, setSearchTrack] = useState('');
  const [sortByPoints, setSortByPoints] = useState(false);
  const [finderSearch, setFinderSearch] = useState('');
  const [finderAvailabilityFilter, setFinderAvailabilityFilter] = useState('all'); // all | open | full
  const [reportTab, setReportTab] = useState('pending'); // pending | accepted | declined
  const [viewApplicant, setViewApplicant] = useState(null); // { listType: 'all'|'accepted'|'declined', index }
  const [inboxSearch, setInboxSearch] = useState('');
  const [inboxFilter, setInboxFilter] = useState('all'); // all | pending | accepted
  const isActualSuperAdmin = userRole === 'superadmin' || userRole === 'super_admin' || providerKey === 'system';
  const [inboxMode, setInboxMode] = useState(isActualSuperAdmin ? 'admin_rooms' : 'applicants'); // 'applicants' | 'admin_rooms'
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
  const [sortConfig, setSortConfig] = useState({ column: null, direction: null });
  const [activeDropdown, setActiveDropdown] = useState(null);
  const [showTrackAdvancedSearch, setShowTrackAdvancedSearch] = useState(false);
  const [trackAdvancedSearch, setTrackAdvancedSearch] = useState({ ...EMPTY_ADVANCED_SEARCH });

  const trackActiveFilterCount = useMemo(() => {
    return Object.values(trackAdvancedSearch).filter((value) => String(value ?? '').trim() !== '').length;
  }, [trackAdvancedSearch]);

  const advancedFilterOptions = useMemo(() => {
    const posts = (data.scholarshipPosts || []).filter(post => !(post.isRemoved || post.is_removed));
    const providers = new Set();
    const educationLevels = new Set();
    const coursePrograms = new Set();
    const scholarshipTypes = new Set();

    posts.forEach((post) => {
      const provider = getScholarshipField(post, ['providerName', 'provider_name', 'provider', 'program']);
      if (provider) providers.add(provider);

      const educationLevel = getScholarshipField(post, ['educationLevel', 'education_level', 'education', 'education_level_required']);
      if (educationLevel) educationLevels.add(educationLevel);

      const courseProgram = getScholarshipField(post, ['course', 'courseProgram', 'program', 'programName']);
      if (courseProgram) coursePrograms.add(courseProgram);

      const scholarshipType = getScholarshipField(post, ['scholarshipType', 'scholarship_type', 'type', 'program_type']);
      if (scholarshipType) scholarshipTypes.add(scholarshipType);
    });

    return {
      providers: [...providers].sort(),
      educationLevels: [...educationLevels].sort(),
      coursePrograms: [...coursePrograms].sort(),
      scholarshipTypes: [...scholarshipTypes].sort(),
    };
  }, [data.scholarshipPosts]);

  const renderAdvancedSearchPanel = (title, filters, setFilters, onReset, isApplicantSearch = false) => (
    <div className="mb-6 rounded-2xl border border-gray-200 bg-gray-50 p-4 space-y-4 shadow-sm">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h4 className="text-sm font-black uppercase tracking-wider text-[#800020]">{title}</h4>
        <button
          type="button"
          onClick={onReset}
          className="text-sm font-semibold text-[#800020] hover:underline"
        >
          Reset Filters
        </button>
      </div>

      {isApplicantSearch ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {/* Row 1: Applicant Name | Family Name | Applicant School */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Applicant Name</label>
            <input
              type="text"
              name="applicantName"
              value={filters.applicantName}
              onChange={(e) => setFilters((prev) => ({ ...prev, applicantName: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[#800020] outline-none"
              placeholder="Search applicant name"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Family Name (LAST NAME)</label>
            <input
              type="text"
              name="familyName"
              value={filters.familyName}
              onChange={(e) => setFilters((prev) => ({ ...prev, familyName: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[#800020] outline-none"
              placeholder="Search last name"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Applicant School</label>
            <input
              type="text"
              name="applicantSchool"
              value={filters.applicantSchool}
              onChange={(e) => setFilters((prev) => ({ ...prev, applicantSchool: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[#800020] outline-none"
              placeholder="Search school name"
            />
          </div>

          {/* Row 2: GPA/Grade | Course/Program | Year */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Applicant GPA/Grade</label>
            <input
              type="text"
              name="applicantGpa"
              value={filters.applicantGpa}
              onChange={(e) => setFilters((prev) => ({ ...prev, applicantGpa: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[#800020] outline-none"
              placeholder="e.g. 85"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Course / Program</label>
            <input
              type="text"
              name="courseProgram"
              value={filters.courseProgram}
              onChange={(e) => setFilters((prev) => ({ ...prev, courseProgram: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[#800020] outline-none"
              placeholder="Search course or program"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Year</label>
            <input
              type="text"
              name="year"
              value={filters.year}
              onChange={(e) => setFilters((prev) => ({ ...prev, year: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[#800020] outline-none"
              placeholder="e.g. 1st Year, 2nd Year, 3rd Year"
            />
          </div>

          {/* Row 3: Income bracket | Location | Accomplite to Date */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Income bracket</label>
            <input
              type="text"
              name="incomeBracket"
              value={filters.incomeBracket}
              onChange={(e) => setFilters((prev) => ({ ...prev, incomeBracket: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[#800020] outline-none"
              placeholder="e.g. PHP 100k"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Location</label>
            <input
              type="text"
              name="location"
              value={filters.location}
              onChange={(e) => setFilters((prev) => ({ ...prev, location: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[#800020] outline-none"
              placeholder="e.g. Lipa City, Batangas"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Date Applied</label>
            <input
              type="date"
              name="dateApplied"
              value={filters.dateApplied || filters.appliedDate || filters.appliedToDate || filters.accompliteToDate || ''}
              onChange={(e) => {
                const val = e.target.value;
                setFilters((prev) => ({
                  ...prev,
                  dateApplied: val,
                  appliedDate: val,
                  appliedToDate: val,
                  accompliteToDate: val
                }));
              }}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[#800020] outline-none"
            />
          </div>

          {/* Row 4: Status */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Status</label>
            <select
              name="status"
              value={filters.status}
              onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[#800020] outline-none"
            >
              <option value="">Any status</option>
              <option value="Pending">Pending</option>
              <option value="Accepted">Accepted</option>
              <option value="Rejected">Rejected</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Scholarship name</label>
            <input
              type="text"
              name="scholarshipName"
              value={filters.scholarshipName}
              onChange={(e) => setFilters((prev) => ({ ...prev, scholarshipName: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[#800020] outline-none"
              placeholder="Search title"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Provider / Organization</label>
            <select
              name="provider"
              value={filters.provider}
              onChange={(e) => setFilters((prev) => ({ ...prev, provider: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[#800020] outline-none"
            >
              <option value="">All providers</option>
              {advancedFilterOptions.providers.map((provider) => (
                <option key={provider} value={provider}>{provider}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Education level</label>
            <select
              name="educationLevel"
              value={filters.educationLevel}
              onChange={(e) => setFilters((prev) => ({ ...prev, educationLevel: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[#800020] outline-none"
            >
              <option value="">Any level</option>
              {advancedFilterOptions.educationLevels.map((level) => (
                <option key={level} value={level}>{level}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Course / Program</label>
            <select
              name="courseProgram"
              value={filters.courseProgram}
              onChange={(e) => setFilters((prev) => ({ ...prev, courseProgram: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[#800020] outline-none"
            >
              <option value="">Any course</option>
              {advancedFilterOptions.coursePrograms.map((course) => (
                <option key={course} value={course}>{course}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Location</label>
            <input
              type="text"
              name="location"
              value={filters.location}
              onChange={(e) => setFilters((prev) => ({ ...prev, location: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[#800020] outline-none"
              placeholder="e.g. Lipa City, Batangas"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Academic requirements</label>
            <input
              type="text"
              name="academicRequirements"
              value={filters.academicRequirements}
              onChange={(e) => setFilters((prev) => ({ ...prev, academicRequirements: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[#800020] outline-none"
              placeholder="GPA / grade requirement"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Income bracket</label>
            <input
              type="text"
              name="incomeBracket"
              value={filters.incomeBracket}
              onChange={(e) => setFilters((prev) => ({ ...prev, incomeBracket: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[#800020] outline-none"
              placeholder="e.g. PHP 100k"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Status</label>
            <select
              name="status"
              value={filters.status}
              onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[#800020] outline-none"
            >
              <option value="">Any status</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="pending">Pending</option>
              <option value="expired">Expired</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Application deadline from</label>
            <input
              type="date"
              name="deadlineFrom"
              value={filters.deadlineFrom}
              onChange={(e) => setFilters((prev) => ({ ...prev, deadlineFrom: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[#800020] outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Application deadline to</label>
            <input
              type="date"
              name="deadlineTo"
              value={filters.deadlineTo}
              onChange={(e) => setFilters((prev) => ({ ...prev, deadlineTo: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[#800020] outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Type of scholarship</label>
            <select
              name="scholarshipType"
              value={filters.scholarshipType}
              onChange={(e) => setFilters((prev) => ({ ...prev, scholarshipType: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[#800020] outline-none"
            >
              <option value="">Any type</option>
              {advancedFilterOptions.scholarshipTypes.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Minimum GPA</label>
            <input
              type="text"
              name="minGpa"
              value={filters.minGpa}
              onChange={(e) => setFilters((prev) => ({ ...prev, minGpa: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[#800020] outline-none"
              placeholder="e.g. 85"
            />
          </div>
        </div>
      )}
    </div>
  );

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (!e.target.closest('.sort-dropdown-container')) {
        setActiveDropdown(null);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, []);

  const handleSortCheck = (column, direction) => {
    if (sortConfig.column === column && sortConfig.direction === direction) {
      setSortConfig({ column: null, direction: null });
    } else {
      setSortConfig({ column, direction });
    }
  };

  const getApplicantSubmissionTime = (applicant) => {
    if (!applicant) return 0;
    const rawDate = applicant.dateApplied || applicant.createdAt || applicant.status_created_at || applicant.created_at || applicant.status_updated || applicant.submissionDate || applicant.date || applicant.time_added;
    if (rawDate) {
      const time = new Date(rawDate).getTime();
      if (!isNaN(time) && time > 0) return time;
    }
    return Number(applicant.applicant_no || applicant.id || applicant.applicantNo || 0);
  };

  const compareApplicantsByLatestSubmission = (a, b) => {
    const timeA = getApplicantSubmissionTime(a);
    const timeB = getApplicantSubmissionTime(b);
    if (timeA !== timeB) {
      return timeB - timeA; // Latest submitted applicant first
    }
    const idA = Number(a.applicant_no || a.id || a.applicantNo || 0);
    const idB = Number(b.applicant_no || b.id || b.applicantNo || 0);
    return idB - idA;
  };

  const sortApplicants = (list) => {
    if (!sortConfig.column || !sortConfig.direction) {
      return [...list].sort(compareApplicantsByLatestSubmission);
    }

    return [...list].sort((a, b) => {
      let valA, valB;
      if (sortConfig.column === 'name') {
        valA = String(a.name || '').trim().toLowerCase();
        valB = String(b.name || '').trim().toLowerCase();
      } else if (sortConfig.column === 'grade') {
        valA = convertGpaToPercentage(a.grade || a.overall_gpa || a.gpa, a.school) ?? 0;
        valB = convertGpaToPercentage(b.grade || b.overall_gpa || b.gpa, b.school) ?? 0;
        if (isNaN(valA)) valA = 0;
        if (isNaN(valB)) valB = 0;
      } else if (sortConfig.column === 'financial') {
        valA = parseFloat(String(a.income || a.financial_income_of_parents || a.family?.grossIncome || 0).replace(/,/g, ''));
        valB = parseFloat(String(b.income || b.financial_income_of_parents || b.family?.grossIncome || 0).replace(/,/g, ''));
        if (isNaN(valA)) valA = 0;
        if (isNaN(valB)) valB = 0;
      } else if (sortConfig.column === 'points') {
        valA = Number(a.evaluationScore || a.totalPoints || a.points || 0);
        valB = Number(b.evaluationScore || b.totalPoints || b.points || 0);
      } else if (sortConfig.column === 'schoolCourse') {
        const schoolA = String(a.school || '').trim().toLowerCase();
        const schoolB = String(b.school || '').trim().toLowerCase();
        if (schoolA !== schoolB) {
          valA = schoolA;
          valB = schoolB;
        } else {
          valA = String(a.course || '').trim().toLowerCase();
          valB = String(b.course || '').trim().toLowerCase();
        }
      } else if (sortConfig.column === 'contactAddress') {
        const addrA = String(a.municipality || '').trim().toLowerCase();
        const addrB = String(b.municipality || '').trim().toLowerCase();
        if (addrA !== addrB) {
          valA = addrA;
          valB = addrB;
        } else {
          valA = String(a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || '').trim().toLowerCase();
          valB = String(b.mobileNumber || b.phone || (b.studentContact && b.studentContact.phone) || '').trim().toLowerCase();
        }
      } else if (sortConfig.column === 'createdAt' || sortConfig.column === 'date' || sortConfig.column === 'dateApplied') {
        valA = getApplicantSubmissionTime(a);
        valB = getApplicantSubmissionTime(b);
      }

      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  };
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
  const readMessageIdsRef = useRef(new Set());
  const readRoomsRef = useRef(new Set());

  const loadApplicants = async () => {
    try {
      const response = await scholarshipAPI.getApplicants(providerKey);
      let allApplicantsRaw = (response.data && response.data.success) ? (response.data.applicants || []) : [];

      // Deduplicate applicants per scholarship application (student ID + scholarship ID)
      const applicantMap = new Map();
      allApplicantsRaw.forEach(app => {
        const schId = app.scholarshipNo || app.scholarship_no || app.reqNo || app.req_no || app.scholarshipName || '';
        const id = `${app.applicant_no || app.id}_${schId}`;
        const existing = applicantMap.get(id);

        if (!existing) {
          applicantMap.set(id, app);
        } else {
          const statusPriority = { 'Accepted': 4, 'Rejected': 3, 'Cancelled': 2, 'Pending': 1 };
          if ((statusPriority[app.status] || 0) > (statusPriority[existing.status] || 0)) {
            applicantMap.set(id, app);
          }
        }
      });

      const uniqueApplicants = Array.from(applicantMap.values());
      // Sort applicants on load by latest application submission timestamp descending (most recent first)
      const sortedByLatest = uniqueApplicants.sort(compareApplicantsByLatestSubmission);
      const historicalData = calculateHistoricalData(allApplicantsRaw);

      setData(prev => ({
        ...prev,
        applicants: sortedByLatest.filter(a => a.status === 'Pending'),
        accepted: sortedByLatest.filter(a => a.status === 'Accepted'),
        rejected: sortedByLatest.filter(a => a.status === 'Rejected'),
        declined: sortedByLatest.filter(a => a.status === 'Declined' || a.status === 'Rejected'),
        cancelled: sortedByLatest.filter(a => a.status === 'Cancelled'),
        historicalData
      }));
    } catch (error) {
      console.error(`Failed to load ${providerName} applicants:`, error);
      const emptyApplicants = [];
      const historicalData = calculateHistoricalData(emptyApplicants);
      setData(prev => ({
        ...prev,
        applicants: [],
        accepted: [],
        rejected: [],
        declined: [],
        cancelled: [],
        historicalData
      }));
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

  // Load applicants, scholarships, and announcements from backend API concurrently on component mount
  useEffect(() => {
    Promise.allSettled([
      loadApplicants(),
      loadScholarships(false),
      loadAnnouncements()
    ]).catch(() => undefined);
  }, []);

  // Socket.IO Integration
  useEffect(() => {
    const token = localStorage.getItem('authToken');
    if (token) {
      socketService.connect(token);

      const userRole = (localStorage.getItem('userRole') || '').toLowerCase();
      const isSuperAdminUser = (
        standaloneInbox ||
        providerKey === 'system' ||
        userRole === 'admin' ||
        userRole === 'superadmin' ||
        userRole === 'super_admin' ||
        !activeProviderNo ||
        activeProviderNo === 0
      );

      const visibleRooms = isSuperAdminUser
        ? ALL_ADMIN_PROVIDER_ROOMS
        : ALL_ADMIN_PROVIDER_ROOMS.filter(r => r.pro_no === Number(activeProviderNo));

      visibleRooms.forEach(r => {
        socketService.loadHistory(r.room);
      });

      const unsubMsg = socketService.subscribe('message', (msg) => {
        let normRoom = msg.room;
        if (msg.room === '0+1' || msg.room === 'superadmin_room_1') normRoom = 'provider_room_1';
        else if (msg.room === '0+2' || msg.room === 'superadmin_room_2') normRoom = 'provider_room_2';
        else if (msg.room === '0+3' || msg.room === 'superadmin_room_3') normRoom = 'provider_room_3';

        setData(prev => {
          const existingIndex = prev.inbox.findIndex(m => {
            if (msg.m_id && m.m_id && String(m.m_id) === String(msg.m_id)) return true;
            const sameRoom = (m.room === normRoom || m.room === msg.room);
            if (typeof m.id === 'string' && m.id.startsWith('temp-') && m.message === msg.message && sameRoom) return true;
            return m.message === msg.message && sameRoom && (m.studentName === msg.username || !m.is_student_sender);
          });

          if (existingIndex !== -1) {
            const updatedInbox = [...prev.inbox];
            updatedInbox[existingIndex] = {
              ...updatedInbox[existingIndex],
              id: msg.m_id || updatedInbox[existingIndex].id,
              m_id: msg.m_id,
              room: normRoom,
              timestamp: msg.timestamp || updatedInbox[existingIndex].timestamp
            };
            return { ...prev, inbox: sortMessages(updatedInbox) };
          }

          const isActiveRoom = currentInboxRoomRef.current === normRoom || currentInboxRoomRef.current === msg.room;
          const isAdminMessage = adminSenderAliases.has(normalizeProviderIdentity(msg.username));
          const isPreviouslyRead = (msg.m_id && readMessageIdsRef.current.has(String(msg.m_id))) ||
            (readRoomsRef.current.has(normRoom) || readRoomsRef.current.has(msg.room));
          const isRead = isActiveRoom || isAdminMessage || isPreviouslyRead;
          if (isRead && msg.m_id) {
            readMessageIdsRef.current.add(String(msg.m_id));
          }
          const nextMessage = {
            id: msg.m_id || (Date.now() + Math.random()),
            m_id: msg.m_id,
            studentName: msg.username,
            studentEmail: msg.username,
            applicant_no: msg.applicant_no || null,
            studentStatus: msg.student_status,
            message: msg.message,
            timestamp: msg.timestamp,
            read: isRead,
            is_student_sender: msg.is_student_sender !== undefined ? msg.is_student_sender : !isAdminMessage,
            room: normRoom
          };

          return {
            ...prev,
            inbox: sortMessages([...prev.inbox, nextMessage])
          };
        });
      });

      const unsubHistory = socketService.subscribe('history', (histData) => {
        const roomId = histData.room;
        const messages = histData.messages || [];
        if (!roomId || messages.length === 0) return;

        let normRoom = roomId;
        if (roomId === '0+1' || roomId === 'superadmin_room_1') normRoom = 'provider_room_1';
        else if (roomId === '0+2' || roomId === 'superadmin_room_2') normRoom = 'provider_room_2';
        else if (roomId === '0+3' || roomId === 'superadmin_room_3') normRoom = 'provider_room_3';

        const isAdminRoom = normRoom.startsWith('provider_room_') || normRoom.startsWith('admin_room');
        const isApplicantRoom = normRoom.includes('+') && /^[1-9]\d*\+[1-9]\d*$/.test(normRoom);

        if (!isAdminRoom && !isApplicantRoom) return;

        setData(prev => {
          const existingIds = new Set((prev.inbox || []).map(m => String(m.m_id)).filter(Boolean));
          const newMsgs = [];

          messages.forEach(msg => {
            if (msg.m_id && existingIds.has(String(msg.m_id))) return; // skip duplicates

            const isActiveRoom = currentInboxRoomRef.current === normRoom || currentInboxRoomRef.current === roomId;
            const isSelfMessage = adminSenderAliases.has(normalizeProviderIdentity(msg.username));
            const isRoomMarkedRead = readRoomsRef.current.has(normRoom) || readRoomsRef.current.has(roomId);
            const isPreviouslyRead = (msg.m_id && readMessageIdsRef.current.has(String(msg.m_id))) ||
              (msg.id && readMessageIdsRef.current.has(String(msg.id)));
            const isRead = isActiveRoom || isSelfMessage || isRoomMarkedRead || isPreviouslyRead;
            if (isRead && msg.m_id) {
              readMessageIdsRef.current.add(String(msg.m_id));
            }
            if (isRead && msg.id) {
              readMessageIdsRef.current.add(String(msg.id));
            }
            const resolvedApplicantNo = msg.applicant_no
              ? String(msg.applicant_no)
              : (isApplicantRoom ? normRoom.split('+')[0] : null);

            newMsgs.push({
              id: msg.m_id || (Date.now() + Math.random()),
              m_id: msg.m_id,
              studentName: msg.applicant_name || (msg.is_student_sender ? msg.username : (resolvedApplicantNo ? `Applicant ${resolvedApplicantNo}` : msg.username)),
              applicant_name: msg.applicant_name,
              first_name: msg.first_name,
              last_name: msg.last_name,
              studentEmail: msg.username,
              applicant_no: resolvedApplicantNo,
              studentStatus: msg.student_status || 'Pending',
              student_status: msg.student_status || 'Pending',
              message: msg.message,
              timestamp: msg.timestamp,
              sender_id: msg.sender_id,
              is_student_sender: msg.is_student_sender !== undefined ? msg.is_student_sender : !isSelfMessage,
              read: isRead,
              room: normRoom
            });
          });

          if (newMsgs.length === 0) return prev;
          return {
            ...prev,
            inbox: sortMessages([...(prev.inbox || []), ...newMsgs])
          };
        });
      });

      const unsubLogged = socketService.subscribe('logged_in', (data) => {
        // Active room history is handled by inbox query and current active conversation.
        // Avoid mass socket calls for all historical rooms to prevent DB connection pool starvation.
        if (currentInboxRoomRef.current) {
          socketService.loadHistory(currentInboxRoomRef.current);
        }
      });

      const unsubRoom = socketService.subscribe('add_room', (roomData) => {
        if (roomData && roomData.room) {
          socketService.loadHistory(roomData.room);
        }
      });

      // Debounced applicant loader to prevent socket storm lag
      let debounceApplicantsTimer = null;
      const debouncedLoadApplicants = () => {
        clearTimeout(debounceApplicantsTimer);
        debounceApplicantsTimer = setTimeout(() => {
          loadApplicants();
        }, 400);
      };

      // Subscribe to applicant updates from students and other admins
      const unsubStatusUpdate = socketService.subscribe('applicant_status_update', (update) => {
        console.log('[LIVE SYNC] Applicant status update received:', update);
        debouncedLoadApplicants();
      });

      const unsubNewApp = socketService.subscribe('new_application', (update) => {
        console.log('[LIVE SYNC] New application received live:', update);
        debouncedLoadApplicants();
        if (update && update.applicant_no && update.pro_no) {
          socketService.loadHistory(`${update.applicant_no}+${update.pro_no}`);
        }
      });

      const unsubNewApplicant = socketService.subscribe('new_applicant', (update) => {
        console.log('[LIVE SYNC] New applicant received live:', update);
        debouncedLoadApplicants();
      });

      const unsubAccountChange = socketService.subscribe('account_change', (update) => {
        console.log('[LIVE SYNC] Account change received live:', update);
        debouncedLoadApplicants();
      });

      return () => {
        clearTimeout(debounceApplicantsTimer);
        unsubMsg();
        unsubLogged();
        unsubRoom();
        unsubStatusUpdate();
        unsubNewApp();
        unsubNewApplicant();
        unsubAccountChange();
        if (unsubHistory) unsubHistory();
        socketService.disconnect();
      };
    }
  }, [providerKey, providerName]);

  useEffect(() => {
    if (!messagingAPI) return;

    messagingAPI.getAllMessages(activeProviderNo).then(res => {
      if (res.data?.messages && Array.isArray(res.data.messages)) {
        const isValidRoom = (m) => {
          if (!m.room) return false;
          if (m.room.startsWith('provider_room_') || m.room.startsWith('superadmin_room_') || m.room.startsWith('admin_room') || m.room === '0+1' || m.room === '0+2' || m.room === '0+3') {
            return true;
          }
          const appNo = m.applicant_no ? String(m.applicant_no) : (m.room.includes('+') ? m.room.split('+')[0] : null);
          return appNo && /^[1-9]\d*$/.test(appNo);
        };

        const normalized = res.data.messages
          .filter(isValidRoom)
          .map(m => {
            let normRoom = m.room;
            if (m.room === '0+1' || m.room === 'superadmin_room_1') normRoom = 'provider_room_1';
            else if (m.room === '0+2' || m.room === 'superadmin_room_2') normRoom = 'provider_room_2';
            else if (m.room === '0+3' || m.room === 'superadmin_room_3') normRoom = 'provider_room_3';

            const appNo = m.applicant_no ? String(m.applicant_no) : (normRoom.includes('+') ? normRoom.split('+')[0] : null);
            const isStudentName = m.username && !m.username.toLowerCase().includes('admin') && !m.username.toLowerCase().includes('mayor') && !m.username.toLowerCase().includes('ched') && !m.username.toLowerCase().includes('vilma');
            const isSelfMessage = adminSenderAliases.has(normalizeProviderIdentity(m.username));
            const isActiveRoom = currentInboxRoomRef.current === normRoom || currentInboxRoomRef.current === m.room;
            const isRoomMarkedRead = readRoomsRef.current.has(normRoom) || readRoomsRef.current.has(m.room);
            const isPreviouslyRead = (m.m_id && readMessageIdsRef.current.has(String(m.m_id))) ||
              (m.id && readMessageIdsRef.current.has(String(m.id)));
            const isRead = isActiveRoom || isSelfMessage || isRoomMarkedRead || isPreviouslyRead;
            if (isRead && m.m_id) {
              readMessageIdsRef.current.add(String(m.m_id));
            }
            return {
              id: m.m_id,
              m_id: m.m_id,
              studentName: m.applicant_name || (isStudentName ? m.username : (appNo ? `Applicant ${appNo}` : 'Admin')),
              applicant_name: m.applicant_name,
              first_name: m.first_name,
              last_name: m.last_name,
              studentEmail: isStudentName ? m.username : '',
              applicant_no: appNo,
              pro_no: m.pro_no,
              room: normRoom,
              message: m.message,
              timestamp: m.timestamp,
              sender_id: m.sender_id,
              is_student_sender: m.is_student_sender,
              student_status: m.student_status || 'Pending',
              studentStatus: m.student_status || 'Pending',
              read: isRead,
              starred: false,
            };
          });

        setData(prev => {
          const existingIds = new Set((prev.inbox || []).map(m => String(m.m_id)).filter(Boolean));
          const newMsgs = normalized.filter(m => m.m_id && !existingIds.has(String(m.m_id)));
          if (newMsgs.length === 0) return prev;
          return { ...prev, inbox: sortMessages([...(prev.inbox || []), ...newMsgs]) };
        });
      }
    }).catch(err => console.warn('Failed to load REST messages:', err));
  }, [activeProviderNo]);

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
    if (incomeVal === null || incomeVal === undefined || incomeVal === '') return 'Unspecified';
    const income = parseFloat(String(incomeVal).replace(/,/g, ''));
    if (isNaN(income)) return String(incomeVal);

    if (income <= 60000) return 'Low Income (≤ ₱60k)';
    if (income <= 150000) return 'Lower-Middle (₱60k - ₱150k)';
    if (income <= 250000) return 'Middle Income (₱150k - ₱250k)';
    return 'Upper-Middle (Above ₱250k)';
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
    const applicantGrade = convertGpaToPercentage(applicant.grade || applicant.overall_gpa || applicant.gpa, applicant.school);
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
        .sort((a, b) => {
          const gradeA = convertGpaToPercentage(a.grade || a.overall_gpa || a.gpa, a.school) ?? 0;
          const gradeB = convertGpaToPercentage(b.grade || b.overall_gpa || b.gpa, b.school) ?? 0;
          return gradeB - gradeA;
        })
        .slice(0, count);
      setRecommended(top);
    }
  }, [data.applicants, trackScholarshipFilter, recommendCount, recommendationModal]);

  const calculateHistoricalData = (applicants) => {
    const list = Array.isArray(applicants) ? applicants : [];
    const total = list.length || 1;

    const monthlyMap = new Map();
    const coursesMap = new Map();
    const grades = { '95 - 100%': 0, '90 - 94%': 0, '85 - 89%': 0, '80 - 84%': 0, 'Below 80%': 0 };
    const financial = {
      'Low Income (≤ ₱60k)': 0,
      'Lower-Middle (₱60k - ₱150k)': 0,
      'Middle Income (₱150k - ₱250k)': 0,
      'Upper-Middle (Above ₱250k)': 0
    };
    const locationsMap = new Map();
    const schoolsMap = new Map();

    // Generate a continuous rolling window of the last 6 months so line charts connect across time
    const referenceDate = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const sortKey = `${y}-${m}`;
      const monthLabel = d.toLocaleString('default', { month: 'short', year: 'numeric' });
      monthlyMap.set(sortKey, {
        sortKey,
        month: monthLabel,
        applications: 0,
        accepted: 0,
        declined: 0,
        rejected: 0,
        cancelled: 0
      });
    }

    let acceptedCount = 0;
    let rejectedCount = 0;
    let cancelledCount = 0;
    let pendingCount = 0;
    let completedDocsCount = 0;
    let totalProcessingDays = 0;
    let processedCount = 0;

    list.forEach(a => {
      if (!a) return;
      const status = a.status || 'Pending';
      if (status === 'Accepted') acceptedCount++;
      else if (status === 'Rejected' || status === 'Declined') rejectedCount++;
      else if (status === 'Cancelled') cancelledCount++;
      else pendingCount++;

      // Monthly aggregation
      const rawDate = a.status_created_at || a.created_at || a.createdAt || a.dateApplied || a.date_applied || a.status_updated || a.statusUpdated;
      let monthLabel = 'Recent';
      let sortKey = '9999-99';
      if (rawDate) {
        const d = new Date(rawDate);
        if (!isNaN(d.getTime())) {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          sortKey = `${y}-${m}`;
          monthLabel = d.toLocaleString('default', { month: 'short', year: 'numeric' });
        }
      }

      if (!monthlyMap.has(sortKey)) {
        monthlyMap.set(sortKey, {
          sortKey,
          month: monthLabel,
          applications: 0,
          accepted: 0,
          declined: 0,
          rejected: 0,
          cancelled: 0
        });
      }
      const mEntry = monthlyMap.get(sortKey);
      mEntry.applications++;
      if (status === 'Accepted') mEntry.accepted++;
      if (status === 'Rejected' || status === 'Declined') {
        mEntry.declined++;
        mEntry.rejected++;
      }
      if (status === 'Cancelled') mEntry.cancelled++;

      // Processing days calculation
      if ((status === 'Accepted' || status === 'Rejected') && rawDate) {
        const startDate = new Date(rawDate);
        const endDate = a.status_updated ? new Date(a.status_updated) : new Date();
        if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
          const diffDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
          totalProcessingDays += Math.min(30, diffDays);
          processedCount++;
        }
      }

      // Documentation completion check
      if (a.has_indigency_doc || a.has_grades_doc || a.has_enrollment_certificate_doc || (a.indigencyFiles && a.indigencyFiles.length > 0)) {
        completedDocsCount++;
      }

      // Course
      const course = String(a.course || 'Unspecified').trim();
      coursesMap.set(course, (coursesMap.get(course) || 0) + 1);

      // Grade
      const convertedGrade = convertGpaToPercentage(a.grade ?? a.overall_gpa ?? a.gpa, a.school);
      const g = convertedGrade !== null ? convertedGrade : parseFloat(String(a.grade || '0'));
      if (!isNaN(g) && g > 0) {
        if (g >= 95) grades['95 - 100%']++;
        else if (g >= 90) grades['90 - 94%']++;
        else if (g >= 85) grades['85 - 89%']++;
        else if (g >= 80) grades['80 - 84%']++;
        else grades['Below 80%']++;
      }

      // Financial status
      const incomeVal = a.income ?? a.financial_income_of_parents ?? a.parentFinance ?? a.family?.grossIncome ?? 0;
      const finLabel = getFinancialStatusLabel(incomeVal);
      if (financial[finLabel] !== undefined) {
        financial[finLabel]++;
      } else {
        financial[finLabel] = (financial[finLabel] || 0) + 1;
      }

      // Clean Barangay / Location extraction
      let loc = String(a.street_brgy || a.streetBrgy || a.barangay || '').trim();
      if (!loc && a.location) {
        loc = String(a.location).split(',')[0].trim();
      }
      if (!loc && (a.municipality || a.town_city_municipality)) {
        loc = String(a.municipality || a.town_city_municipality).trim();
      }
      if (!loc) loc = 'Unspecified';
      locationsMap.set(loc, (locationsMap.get(loc) || 0) + 1);

      // School (normalized)
      const sch = normalizeSchoolName(a.school);
      schoolsMap.set(sch, (schoolsMap.get(sch) || 0) + 1);
    });

    const monthlyApplications = Array.from(monthlyMap.values()).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    const courseDistribution = Array.from(coursesMap.entries())
      .map(([course, count]) => ({ course, count, percentage: Math.round((count / total) * 100) }))
      .sort((a, b) => b.count - a.count);
    const gradeRanges = Object.entries(grades).map(([range, count]) => ({
      range,
      count,
      percentage: Math.round((count / total) * 100)
    }));
    const financialBreakdown = Object.entries(financial).map(([level, count]) => ({
      level,
      count,
      percentage: Math.round((count / total) * 100)
    }));
    const locationStats = Array.from(locationsMap.entries())
      .map(([location, count]) => ({ location, count, percentage: Math.round((count / total) * 100) }))
      .sort((a, b) => b.count - a.count);
    const schoolStats = Array.from(schoolsMap.entries())
      .map(([school, count]) => ({ school, count, percentage: Math.round((count / total) * 100) }))
      .sort((a, b) => b.count - a.count);

    const avgTime = processedCount > 0 ? Math.max(1, Math.round(totalProcessingDays / processedCount)) : 3;
    const completionRate = list.length > 0 ? Math.round((completedDocsCount / total) * 100) : 100;
    const acceptRate = list.length > 0 ? Math.round((acceptedCount / total) * 100) : 0;

    return {
      monthlyApplications,
      courseDistribution,
      gradeRanges,
      financialBreakdown,
      locationStats,
      schoolStats,
      performanceMetrics: {
        averageProcessingTime: avgTime,
        acceptanceRate: acceptRate,
        applicationCompletionRate: completionRate,
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
      [name]: value,
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
        // Invalidate cache so future tab switches pull fresh data
        scholarshipAPI.getApplicants.invalidate();
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
      units: '',
      residencyDocType: 'Indigency Document',
      idType: 'School ID',
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

    let debounceScholarshipTimer = null;
    const debouncedLoadScholarships = () => {
      clearTimeout(debounceScholarshipTimer);
      debounceScholarshipTimer = setTimeout(() => {
        loadScholarships(false);
      }, 400);
    };

    let debounceAnnouncementTimer = null;
    const debouncedLoadAnnouncements = () => {
      clearTimeout(debounceAnnouncementTimer);
      debounceAnnouncementTimer = setTimeout(() => {
        loadAnnouncements();
      }, 400);
    };

    // Listen for scholarship updates from other admins
    const unsubScholarships = socketService.onScholarshipUpdate((data) => {
      console.log('[SCHOLARSHIP UPDATE] Received update:', data);
      debouncedLoadScholarships();
    });

    const unsubScholarshipChange = socketService.subscribe('scholarship_change', (data) => {
      console.log('[SCHOLARSHIP CHANGE] Received change:', data);
      debouncedLoadScholarships();
    });

    // Listen for announcement updates from other admins
    const unsubAnnouncements = socketService.onAnnouncementUpdate((data) => {
      console.log('[ANNOUNCEMENT UPDATE] Received update:', data);
      debouncedLoadAnnouncements();
    });

    const unsubNewAnnouncements = socketService.subscribe('new_announcement', (data) => {
      console.log('[NEW ANNOUNCEMENT] Received new announcement:', data);
      debouncedLoadAnnouncements();
    });

    // Listen for real-time notifications
    const unsubNotifications = socketService.onAnnouncementNotification((data) => {
      console.log('[NOTIFICATION] Received announcement notification:', data);
    });

    return () => {
      clearTimeout(debounceScholarshipTimer);
      clearTimeout(debounceAnnouncementTimer);
      unsubScholarships();
      unsubScholarshipChange();
      unsubAnnouncements();
      unsubNewAnnouncements();
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
        pro_no: ann.pro_no ?? ann.proNo,
        proNo: ann.pro_no ?? ann.proNo,
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

        return activeProviderNames.some((name) =>
          announcementProviderName.includes(name) ||
          name.includes(announcementProviderName) ||
          (name.includes('tulong') && announcementProviderName.includes('tulong')) ||
          (name.includes('dunong') && announcementProviderName.includes('dunong'))
        );
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
        units: formData.units ? parseInt(formData.units) : null,
        residencyDocType: formData.residencyDocType || 'Indigency Document',
        idType: formData.idType || 'School ID',
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

      if (response.data.success || response.status === 200 || response.status === 201) {
        setIsSaving(false);
        hideActionOverlay();
        resetForm();
        setManageMode('list');
        loadScholarships(false);

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
        setIsSaving(false);
        hideActionOverlay();
        alert('Error: ' + (response.data.message || 'Unknown error occurred'));
      }
    } catch (error) {
      console.error('Failed to save scholarship:', error);
      setIsSaving(false);
      hideActionOverlay();
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
        units: post.units !== undefined && post.units !== null ? post.units.toString() : '',
        residencyDocType: post.residencyDocType || post.residency_doc_type || 'Indigency Document',
        idType: post.idType || post.id_type || 'School ID',
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
    const post = (data.scholarshipPosts || []).find(p => String(p.reqNo || p.id) === String(postId));
    const title = post ? (post.scholarshipName || post.title) : 'this scholarship post';
    setConfirmDeleteModal({
      type: 'scholarship',
      id: postId,
      title: 'Delete Scholarship Post',
      label: title
    });
  };

  const deleteAnnouncement = (id) => {
    const ann = (data.announcements || []).filter(a => !(a.is_removed || a.isRemoved)).find(a => String(a.ann_no || a.id) === String(id));
    const title = ann ? ann.title : 'this announcement';
    setConfirmDeleteModal({
      type: 'announcement',
      id,
      title: 'Delete Announcement',
      label: title
    });
  };

  const executeDeleteDirectly = async (type, id) => {
    if (type === 'scholarship') {
      const targetPost = (data.scholarshipPosts || []).find(p => String(p.reqNo || p.id) === String(id));
      const previousPosts = data.scholarshipPosts;
      const targetTitle = targetPost?.scholarshipName || targetPost?.title || '';
      // Instant optimistic UI update (0ms latency for user)
      setData(prev => ({
        ...prev,
        scholarshipPosts: (prev.scholarshipPosts || []).filter(p => String(p.reqNo || p.id) !== String(id))
      }));
      if (editingPost && String(editingPost.reqNo || editingPost.id) === String(id)) {
        resetForm();
        setManageMode('list');
      }

      try {
        await scholarshipAPI.deleteScholarship(id);
        socketService.emit('scholarship_update', {
          program: providerKey,
          action: 'delete',
          reqNo: id,
          req_no: id,
          scholarshipName: targetTitle,
          scholarship_name: targetTitle,
          title: targetTitle,
          adminName: userName,
          timestamp: new Date().toISOString()
        });
        socketService.emit('notification_update', {
          type: 'scholarship',
          action: 'delete',
          req_no: id,
          title: targetTitle
        });
      } catch (error) {
        console.error('Failed to delete scholarship:', error);
        // Rollback state if delete failed
        setData(prev => ({ ...prev, scholarshipPosts: previousPosts }));
        alert(getRequestErrorMessage(error, 'Error deleting scholarship'));
      }
    } else if (type === 'announcement') {
      const targetAnn = (data.announcements || []).find(a => String(a.ann_no || a.id) === String(id));
      const previousAnnouncements = data.announcements;
      const targetTitle = targetAnn?.ann_title || targetAnn?.title || '';
      // Instant optimistic UI update (0ms latency for user)
      setData(prev => ({
        ...prev,
        announcements: (prev.announcements || []).filter(a => String(a.ann_no || a.id) !== String(id))
      }));
      if (editingPost && String(editingPost.id || editingPost.ann_no) === String(id)) {
        resetForm();
        setManageMode('list');
      }

      try {
        await announcementService.delete(id);
        socketService.emit('announcement_update', {
          action: 'delete',
          ann_no: id,
          title: targetTitle,
          adminName: userName,
          timestamp: new Date().toISOString()
        });
        socketService.emit('notification_update', {
          type: 'announcement',
          action: 'delete',
          ann_no: id,
          title: targetTitle
        });
      } catch (error) {
        console.error('Failed to delete announcement:', error);
        // Rollback state if delete failed
        setData(prev => ({ ...prev, announcements: previousAnnouncements }));
        alert(getRequestErrorMessage(error, 'Error deleting announcement'));
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

      if (response.data.message || response.data.success || response.status === 200 || response.status === 201) {
        setIsSaving(false);
        hideActionOverlay();
        resetForm();
        setManageMode('list');
        loadAnnouncements();
      }
    } catch (error) {
      console.error('Failed to save announcement:', error);
      setIsSaving(false);
      hideActionOverlay();
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

  const activeScholarshipOptions = useMemo(() => {
    return (data.scholarshipPosts || [])
      .filter((post) => !(post.isRemoved || post.is_removed))
      .map((post) => {
        const value = String(post.reqNo || post.id || post.scholarshipName || post.title || '').trim();
        const label = post.scholarshipName || post.title || 'Untitled Scholarship';
        return value ? { value, label, isDeleted: false } : null;
      })
      .filter(Boolean);
  }, [data.scholarshipPosts]);

  const deletedScholarshipOptions = useMemo(() => {
    return (data.scholarshipPosts || [])
      .filter((post) => Boolean(post.isRemoved || post.is_removed))
      .map((post) => {
        const value = String(post.reqNo || post.id || post.scholarshipName || post.title || '').trim();
        const rawLabel = post.scholarshipName || post.title || 'Untitled Scholarship';
        const label = `${rawLabel} (Deleted)`;
        return value ? { value, label, isDeleted: true } : null;
      })
      .filter(Boolean);
  }, [data.scholarshipPosts]);

  const scholarshipFilterOptions = useMemo(() => {
    return [
      ...activeScholarshipOptions,
      { value: 'deleted', label: 'Deleted Scholarships', isDeleted: true },
      ...deletedScholarshipOptions
    ];
  }, [activeScholarshipOptions, deletedScholarshipOptions]);

  const matchesScholarshipSelection = (applicant, selectedValue) => {
    if (!applicant) return false;
    if (!selectedValue || selectedValue === 'all' || selectedValue === 'All') {
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

    const selectedReqNo = String(selectedValue || '').trim().toLowerCase();

    // Applicant identifiers
    const applicantReqNo = String(applicant.reqNo || applicant.req_no || applicant.request_no || applicant.scholarshipNo || applicant.scholarship_no || '').trim().toLowerCase();
    const applicantScholarshipName = String(applicant.scholarshipName || applicant.scholarship_name || applicant.appliedScholarship || applicant.scholarship || applicant.scholarshipTitle || '').trim().toLowerCase();

    // Check numeric ID equality when both are numeric
    const isSelectedNumeric = /^\d+$/.test(selectedReqNo);
    const isApplicantNumeric = /^\d+$/.test(applicantReqNo);

    if (isSelectedNumeric && isApplicantNumeric) {
      return applicantReqNo === selectedReqNo;
    }

    // Lookup target post details for title matching
    const targetPost = (data.scholarshipPosts || []).find(s => String(s.reqNo || s.id || '') === selectedReqNo);
    const selectedOption = scholarshipFilterOptions.find((option) => option.value === selectedValue);
    const postName = targetPost
      ? String(targetPost.scholarshipName || targetPost.title || '').trim().toLowerCase()
      : String(selectedOption?.label || selectedValue || '').trim().toLowerCase();

    if (postName && applicantScholarshipName) {
      return (
        applicantScholarshipName === postName ||
        applicantScholarshipName.includes(postName) ||
        postName.includes(applicantScholarshipName)
      );
    }

    return false;
  };

  const getScholarshipForApplicant = (a) => {
    if (!a) return null;
    const reqNo = a.reqNo || a.req_no || a.scholarshipNo || a.scholarship_no;
    if (!reqNo && trackScholarshipFilter !== 'all' && trackScholarshipFilter !== 'deleted') {
      return (data.scholarshipPosts || []).find(s => String(s.reqNo || s.id || '') === String(trackScholarshipFilter));
    }
    return (data.scholarshipPosts || []).find(s => String(s.reqNo || s.id || '') === String(reqNo));
  };

  const calculateDeservednessScoreDetails = (a, sch) => {
    if (!a) return { total: 0, gpaScore: 0, incomeScore: 0, meritScore: 0, reason: '' };

    const applicantRawGpa = a.grade ?? a.overall_gpa ?? a.gpa ?? 0;
    const applicantIncome = Number(a.income ?? a.financial_income_of_parents ?? a.family?.grossIncome ?? 0);

    const normalizedGpa = convertGpaToPercentage(applicantRawGpa, a.school || a.schoolName) ?? Number(applicantRawGpa || 0);

    let gpaScore = 0;
    const minGpa = sch ? Number(sch.gpa ?? sch.minGpa ?? 0) : 0;
    if (minGpa > 0) {
      const normalizedMinGpa = minGpa;
      if (normalizedGpa >= normalizedMinGpa) {
        gpaScore = Math.min(60, (normalizedGpa - normalizedMinGpa) * 12);
      }
    } else {
      gpaScore = Math.min(60, Math.max(0, (normalizedGpa - 75) * 2.4));
    }

    let incomeScore = 0;
    const maxInc = sch ? Number(sch.parentFinance ?? sch.parent_finance ?? sch.maxIncome ?? 400000) : 400000;
    if (applicantIncome <= maxInc) {
      incomeScore = Math.min(50, Math.floor((maxInc - applicantIncome) / 15000));
    }

    const meritScore = Number(a.meritScore ?? 0);
    const total = Math.max(0, gpaScore + incomeScore + meritScore);

    return {
      total,
      gpaScore,
      incomeScore,
      meritScore,
      reason: a.meritReason || 'No evaluated achievements.'
    };
  };

  const calculateDeservednessScore = (a, sch) => {
    return calculateDeservednessScoreDetails(a, sch).total;
  };

  const renderPointsCell = (a) => {
    const details = calculateDeservednessScoreDetails(a, getScholarshipForApplicant(a));
    const tooltipText = `Score Breakdown:\n GPA Score: ${details.gpaScore.toFixed(1)} pts\n  Financial Need: ${details.incomeScore.toFixed(1)} pts\n  Merits/Awards (AI): ${details.meritScore.toFixed(1)} pts\n\nAI Reason:\n${details.reason}`;

    return (
      <td className="px-4 py-3 font-semibold text-gray-700">
        <div className="flex items-center gap-1.5 cursor-help" title={tooltipText}>
          <FaStar className="text-yellow-500 text-xs" />
          <span>{details.total.toFixed(0)}</span>
        </div>
      </td>
    );
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
        const liveAccepted = (data.accepted || []).filter((applicant) => matchesScholarshipSelection(applicant, scholarshipId)).length;
        const livePending = (data.applicants || []).filter((applicant) => matchesScholarshipSelection(applicant, scholarshipId)).length;
        const liveDeclined = (data.declined || data.rejected || []).filter((applicant) => matchesScholarshipSelection(applicant, scholarshipId)).length;

        const hasLoadedApplicants = (data.accepted?.length || 0) + (data.applicants?.length || 0) + (data.declined?.length || 0) + (data.rejected?.length || 0) > 0;

        const acceptedCount = hasLoadedApplicants ? liveAccepted : Number(post.acceptedCount || 0);
        const pendingCount = hasLoadedApplicants ? livePending : Number(post.pendingCount || 0);
        const declinedCount = hasLoadedApplicants ? liveDeclined : Number(post.declinedCount || 0);
        const totalApplicants = acceptedCount + pendingCount + declinedCount;
        const slotLimit = Number(post.slots ?? 0);
        const availableSlots = slotLimit > 0 ? Math.max(slotLimit - acceptedCount, 0) : 0;
        const isFull = slotLimit > 0 && availableSlots <= 0;
        const eligibleApplicantIds = new Set(
          (data.accepted || [])
            .filter((applicant) => matchesScholarshipSelection(applicant, scholarshipId))
            .map((applicant) => applicant.id || applicant.applicant_no)
            .filter(Boolean)
        );
        const eligibleApplicantCount = hasLoadedApplicants ? eligibleApplicantIds.size : Number(post.acceptedCount || 0);

        return {
          ...post,
          acceptedCount,
          pendingCount,
          declinedCount,
          totalApplicants,
          availableSlots,
          isFull,
          eligibleApplicantCount,
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

  const recentPendingApplicants = useMemo(() => {
    const pendingList = (data.applicants || []).filter(app => {
      const status = String(app.status || 'Pending').toLowerCase();
      return status === 'pending' || status === 'null' || !app.status;
    });
    return [...pendingList].sort(compareApplicantsByLatestSubmission);
  }, [data.applicants]);

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

    const CHART_PALETTE = [
      '#800020', '#198754', '#0d6efd', '#ffc107', '#6f42c1', '#fd7e14', '#20c997', '#d63384',
      '#0dcaf0', '#6c757d', '#b02a37', '#146c43', '#0a58ca', '#997404', '#491217', '#59359a'
    ];

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
              backgroundColor: 'rgba(128, 0, 32, 0.08)',
              borderWidth: 3,
              pointRadius: 4,
              pointHoverRadius: 6,
              fill: true,
              tension: 0.3
            },
            {
              label: 'Accepted',
              data: filteredHistoricalData.monthlyApplications.map(m => m.accepted),
              borderColor: '#198754',
              backgroundColor: 'rgba(25, 135, 84, 0.08)',
              borderWidth: 2.5,
              pointRadius: 4,
              pointHoverRadius: 6,
              fill: false,
              tension: 0.3
            },
            {
              label: 'Rejected',
              data: filteredHistoricalData.monthlyApplications.map(m => m.rejected),
              borderColor: '#dc3545',
              backgroundColor: 'rgba(220, 53, 69, 0.08)',
              borderWidth: 2,
              pointRadius: 4,
              pointHoverRadius: 6,
              fill: false,
              tension: 0.3
            },
            {
              label: 'Cancelled',
              data: filteredHistoricalData.monthlyApplications.map(m => m.cancelled),
              borderColor: '#6c757d',
              backgroundColor: 'rgba(108, 117, 125, 0.08)',
              borderWidth: 2,
              pointRadius: 4,
              pointHoverRadius: 6,
              fill: false,
              tension: 0.3
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'index',
            intersect: false
          },
          plugins: {
            legend: { position: 'bottom' }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { precision: 0 }
            }
          }
        },
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
      const topCourses = filteredHistoricalData.courseDistribution.slice(0, 8);
      courseChartInstance.current = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: topCourses.map(c => c.course),
          datasets: [{
            data: topCourses.map(c => c.count),
            backgroundColor: topCourses.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]),
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
      });
    }

    // Doughnut Chart for Financial Background
    if (financialChartRef.current) {
      const ctx = financialChartRef.current.getContext('2d');
      if (financialChartInstance.current) financialChartInstance.current.destroy();
      const finColors = ['#198754', '#0d6efd', '#ffc107', '#800020', '#6c757d'];
      financialChartInstance.current = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: filteredHistoricalData.financialBreakdown.map(f => f.level),
          datasets: [{
            data: filteredHistoricalData.financialBreakdown.map(f => f.count),
            backgroundColor: filteredHistoricalData.financialBreakdown.map((_, i) => finColors[i % finColors.length]),
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
      });
    }

    // Doughnut Chart for School Distribution
    if (schoolChartRef.current) {
      const ctx = schoolChartRef.current.getContext('2d');
      if (schoolChartInstance.current) schoolChartInstance.current.destroy();
      const topSchools = filteredHistoricalData.schoolStats.slice(0, 8);
      schoolChartInstance.current = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: topSchools.map(s => s.school),
          datasets: [{
            data: topSchools.map(s => s.count),
            backgroundColor: topSchools.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]),
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
      });
    }

    // New chart for Location Split
    if (locationChartRef.current) {
      const ctx = locationChartRef.current.getContext('2d');
      if (locationChartInstance.current) locationChartInstance.current.destroy();
      const topLocations = filteredHistoricalData.locationStats.slice(0, 8);
      locationChartInstance.current = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: topLocations.map(loc => loc.location),
          datasets: [{
            data: topLocations.map(loc => loc.count),
            backgroundColor: topLocations.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]),
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
      });
    }

    return cleanupCharts;
  }, [section, reportsView, stats, filteredHistoricalData]);

  const parseSafeDate = (timestamp) => {
    if (!timestamp) return null;
    if (timestamp instanceof Date) return isNaN(timestamp.getTime()) ? null : timestamp;
    let tsStr = String(timestamp).trim();
    if (!tsStr) return null;
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(tsStr)) {
      tsStr = tsStr.replace(' ', 'T') + 'Z';
    }
    const d = new Date(tsStr);
    return isNaN(d.getTime()) ? null : d;
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'No timestamp';
    const date = parseSafeDate(timestamp);
    if (!date) return String(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getApplicantDispatchKey = (applicant) => applicant?.applicant_no || applicant?.id || applicant?.studentContact?.email || applicant?.email || applicant?.name;

  const getApplicantDocTypes = (applicant) => {
    if (!applicant) return { residencyDocType: 'Indigency Document', residencyLabel: 'Indigency', residencyFullLabel: 'Indigency Proof', idType: 'School ID', idLabel: 'Student ID (Front & Back)' };

    const matchPost = (data.scholarshipPosts || []).find(p =>
      String(p.reqNo || p.id || p.req_no) === String(applicant.scholarshipNo || applicant.reqNo || applicant.req_no) ||
      (p.scholarshipName && applicant.scholarshipName && p.scholarshipName.toLowerCase() === applicant.scholarshipName.toLowerCase())
    );

    const rawResidency = applicant.residencyDocType || applicant.residency_doc_type || matchPost?.residencyDocType || matchPost?.residency_doc_type || 'Indigency Document';
    const rawId = applicant.idType || applicant.id_type || matchPost?.idType || matchPost?.id_type || 'School ID';

    const isResidency = /residency/i.test(rawResidency);
    const residencyLabel = isResidency ? 'Residency' : 'Indigency';
    const residencyFullLabel = isResidency ? 'Residency Proof' : 'Indigency Proof';

    let idLabel = 'Student ID (Front & Back)';
    if (/national/i.test(rawId)) {
      idLabel = 'National ID (Front & Back)';
    } else if (/school|student/i.test(rawId)) {
      idLabel = 'Student ID (Front & Back)';
    } else if (rawId) {
      idLabel = `${rawId} (Front & Back)`;
    }

    return {
      residencyDocType: rawResidency,
      residencyLabel,
      residencyFullLabel,
      idType: rawId,
      idLabel
    };
  };

  const handleSendSchoolVerification = async (applicant) => {
    const applicantId = applicant?.applicant_no || applicant?.id;
    const scholarshipNo = applicant?.scholarshipNo;
    const dispatchKey = getApplicantDispatchKey(applicant);
    const docTypes = getApplicantDocTypes(applicant);

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
      documents: ['Enrollment Certificate', 'Official Grades Report', docTypes.idLabel, 'Merit Document(s)'],
      onConfirm: async () => {
        showActionOverlay('Sending school verification', 'Preparing the applicant documents and emailing the school verification address.');
        try {
          const response = await scholarshipAPI.sendSchoolVerification(applicantId, scholarshipNo);
          setSchoolVerifSent((prev) => ({ ...prev, [dispatchKey]: true }));
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
    const docTypes = getApplicantDocTypes(applicant);

    if (!applicantId || !scholarshipNo) {
      alert(`Unable to send ${docTypes.residencyLabel.toLowerCase()} verification because the applicant record is incomplete.`);
      return;
    }

    const recipient = 'lipacityhall.gov.ph@gmail.com';

    setPendingAction({
      type: 'verification',
      title: `Dispatch ${docTypes.residencyLabel} Verification`,
      recipient: recipient,
      messageSummary: `Verification request for the ${docTypes.residencyLabel.toLowerCase()} document of ${applicant.name || 'this applicant'}.`,
      documents: [`${docTypes.residencyLabel} Proof Image`],
      onConfirm: async () => {
        showActionOverlay(`Sending ${docTypes.residencyLabel.toLowerCase()} verification`, `Preparing the ${docTypes.residencyLabel.toLowerCase()} document and emailing the city hall verification address.`);
        try {
          const response = await scholarshipAPI.sendIndigencyVerification(applicantId, scholarshipNo);
          setIndigencyVerifSent((prev) => ({ ...prev, [dispatchKey]: true }));
        } catch (error) {
          console.error(`Failed to send ${docTypes.residencyLabel.toLowerCase()} verification email:`, error);
          alert(`Error sending ${docTypes.residencyLabel.toLowerCase()} verification`);
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
      .sort((a, b) => {
        const schA = getScholarshipForApplicant(a);
        const schB = getScholarshipForApplicant(b);
        return calculateDeservednessScore(b, schB) - calculateDeservednessScore(a, schA);
      })
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

  const getStudentStatus = (id, name, currentStatus, email = null) => {
    if (currentStatus && currentStatus !== 'Unknown') return currentStatus;
    const inList = (list) => (list || []).some((a) => {
      const aNo = (a.applicant_no || a.applicantNo || a.applicant_id || (typeof a.id === 'string' ? a.id.split('_')[0] : a.id) || '').toString();
      if (id && aNo && aNo === id.toString()) return true;
      const aEmail = (a.email || a.emailAddress || a.studentContact?.email || '').toLowerCase();
      if (email && aEmail && aEmail === email.toLowerCase()) return true;
      return false;
    });
    if (inList(data.accepted)) return 'Accepted';
    if (inList(data.declined)) return 'Declined';
    if (inList(data.applicants)) return 'Pending';
    return 'Unknown';
  };

  const groupMessagesByStudent = (messages) => {
    const userRole = (localStorage.getItem('userRole') || '').toLowerCase();
    const isSuperAdminUser = (
      standaloneInbox ||
      providerKey === 'system' ||
      userRole === 'admin' ||
      userRole === 'superadmin' ||
      userRole === 'super_admin' ||
      !activeProviderNo ||
      activeProviderNo === 0
    );

    const grouped = {};

    if (inboxMode === 'admin_rooms') {
      const visibleRooms = isSuperAdminUser
        ? ALL_ADMIN_PROVIDER_ROOMS
        : ALL_ADMIN_PROVIDER_ROOMS.filter(r => r.pro_no === Number(activeProviderNo));

      visibleRooms.forEach(r => {
        grouped[r.applicant_no] = {
          studentName: r.studentName,
          studentEmail: r.studentEmail,
          applicant_no: r.applicant_no,
          room: r.room,
          pro_no: r.pro_no,
          badge: r.badge,
          icon: r.icon,
          isAdminRoom: true,
          messages: [],
          unreadCount: 0,
          lastMessage: {
            timestamp: new Date(0).toISOString(),
            message: "No messages yet in this channel",
            studentStatus: r.badge,
            subject: "Official Admin Channel",
            room: r.room
          }
        };
      });

      sortMessages(messages).forEach((m) => {
        if (!m.room) return;
        let normRoom = m.room;
        if (m.room === '0+1' || m.room === 'superadmin_room_1') normRoom = 'provider_room_1';
        else if (m.room === '0+2' || m.room === 'superadmin_room_2') normRoom = 'provider_room_2';
        else if (m.room === '0+3' || m.room === 'superadmin_room_3') normRoom = 'provider_room_3';

        const targetRoom = visibleRooms.find(r => r.room === normRoom || r.room === m.room);
        if (targetRoom && grouped[targetRoom.applicant_no]) {
          const roomMsgs = grouped[targetRoom.applicant_no].messages;
          const isDuplicate = roomMsgs.some(existingMsg => {
            if (m.m_id && existingMsg.m_id && String(m.m_id) === String(existingMsg.m_id)) return true;
            if (m.id && existingMsg.id && String(m.id) === String(existingMsg.id)) return true;
            if (m.message === existingMsg.message && (String(m.id || '').startsWith('temp-') || String(existingMsg.id || '').startsWith('temp-'))) return true;
            return existingMsg.message === m.message && existingMsg.timestamp === m.timestamp;
          });

          if (!isDuplicate) {
            roomMsgs.push(m);
            const isMsgRead = m.read ||
              (m.m_id && readMessageIdsRef.current.has(String(m.m_id))) ||
              (m.id && readMessageIdsRef.current.has(String(m.id))) ||
              (targetRoom && (readRoomsRef.current.has(targetRoom.room) || currentInboxRoomRef.current === targetRoom.room)) ||
              (m.room && (readRoomsRef.current.has(m.room) || currentInboxRoomRef.current === m.room));
            if (!isMsgRead) grouped[targetRoom.applicant_no].unreadCount += 1;
            grouped[targetRoom.applicant_no].lastMessage = m;
          }
        }
      });
    } else {
      // Applicant mode: Group applicant messages (including all applicant statuses)
      const allKnownApplicants = [
        ...(data.applicants || []),
        ...(data.accepted || []),
        ...(data.rejected || []),
        ...(data.declined || []),
        ...(data.cancelled || [])
      ];

      allKnownApplicants.forEach(a => {
        const rawId = (a.applicant_no || a.applicantNo || a.applicant_id || a.user_no || (typeof a.id === 'string' ? a.id.split('_')[0] : a.id) || '').toString();
        if (!rawId || !/^[1-9]\d*$/.test(rawId)) return;
        const key = rawId;

        const normName = normalizeProviderIdentity(a.name || (a.firstName ? `${a.firstName} ${a.lastName}` : (a.first_name ? `${a.first_name} ${a.last_name}` : '')));
        const normEmail = (a.email || a.emailAddress || '').toLowerCase();

        // Skip provider/admin alias accounts from applicant list
        if (
          adminSenderAliases.has(normName) ||
          normName.includes('mayor') ||
          normName.includes('vilma') ||
          normName.includes('ched') ||
          normName.includes('admin') ||
          normEmail.includes('admin@') ||
          normEmail.includes('superadmin')
        ) {
          return;
        }

        const applicantRoom = `${key}+${activeProviderNo || 1}`;
        const officialName = (a.firstName && a.lastName) ? `${a.firstName} ${a.lastName}` : ((a.first_name && a.last_name) ? `${a.first_name} ${a.last_name}` : (a.name || `Applicant ${key}`));

        if (!grouped[key]) {
          grouped[key] = {
            studentName: officialName,
            studentEmail: a.email || a.emailAddress,
            studentPhone: a.mobileNumber || a.phone,
            applicant_no: key,
            room: applicantRoom,
            isAdminRoom: false,
            messages: [],
            unreadCount: 0,
            lastMessage: {
              timestamp: a.dateApplied || a.createdAt || new Date(0).toISOString(),
              message: "No messages yet",
              studentStatus: a.status || getStudentStatus(key, officialName),
              subject: 'No conversations started yet',
              room: applicantRoom
            },
          };
        } else {
          grouped[key].studentName = officialName;
          grouped[key].studentEmail = a.email || a.emailAddress || grouped[key].studentEmail;
          grouped[key].studentPhone = a.mobileNumber || a.phone || grouped[key].studentPhone;
          if (a.status) {
            grouped[key].lastMessage.studentStatus = a.status;
          }
        }
      });

      sortMessages(messages).forEach((m) => {
        if (!m.room) return;
        // Filter out all non-applicant rooms
        if (
          m.room.startsWith('provider_room_') ||
          m.room.startsWith('superadmin_room_') ||
          m.room.startsWith('admin_room') ||
          m.room === '0+1' || m.room === '0+2' || m.room === '0+3' ||
          /^0\+/.test(m.room) // any room starting with applicant_no=0
        ) return;

        let resolvedApplicantNo = m.applicant_no ? m.applicant_no.toString() : '';
        if (!resolvedApplicantNo && m.room && m.room.includes('+')) {
          resolvedApplicantNo = m.room.split('+')[0];
        }

        if (!resolvedApplicantNo) {
          const match = allKnownApplicants.find(a =>
            (m.studentEmail && (a.email === m.studentEmail || a.emailAddress === m.studentEmail)) ||
            (m.studentName && a.name?.toLowerCase() === m.studentName.toLowerCase())
          );
          if (match) {
            resolvedApplicantNo = (match.applicant_no || match.applicantNo || match.applicant_id || (typeof match.id === 'string' ? match.id.split('_')[0] : match.id) || '').toString();
          }
        }

        const key = resolvedApplicantNo;
        // Only allow positive integer applicant numbers — filters out '0', admin names, etc.
        if (!key || !/^[1-9]\d*$/.test(key)) return;

        const match = allKnownApplicants.find(a =>
          String(a.applicant_no || a.applicantNo || a.applicant_id || (typeof a.id === 'string' ? a.id.split('_')[0] : a.id)) === String(key)
        );
        const resolvedStudentName = match
          ? ((match.firstName && match.lastName) ? `${match.firstName} ${match.lastName}` : ((match.first_name && match.last_name) ? `${match.first_name} ${match.last_name}` : (match.name || `Applicant ${key}`)))
          : (m.is_student_sender && m.username && !m.username.toLowerCase().includes('admin') && !m.username.toLowerCase().includes('mayor') && !m.username.toLowerCase().includes('ched') && !m.username.toLowerCase().includes('vilma') ? m.username : `Applicant ${key}`);

        if (!grouped[key]) {
          const applicantRoom = m.room || `${key}+${activeProviderNo || 1}`;
          grouped[key] = {
            studentName: resolvedStudentName,
            studentEmail: m.studentEmail || match?.email || match?.emailAddress || '',
            studentPhone: m.studentPhone || match?.mobileNumber || '',
            applicant_no: key,
            room: applicantRoom,
            isAdminRoom: false,
            messages: [],
            unreadCount: 0,
            lastMessage: {
              timestamp: m.timestamp || new Date(0).toISOString(),
              message: m.message,
              studentStatus: m.student_status || m.studentStatus || 'Pending',
              subject: 'Message Conversation',
              room: applicantRoom
            },
          };
        } else if (match && (grouped[key].studentName.startsWith('Applicant ') || grouped[key].studentName.toLowerCase().includes('admin') || grouped[key].studentName.toLowerCase().includes('mayor'))) {
          grouped[key].studentName = resolvedStudentName;
        }

        const exists = grouped[key].messages.some(existingMsg => {
          if (m.m_id && existingMsg.m_id) return String(existingMsg.m_id) === String(m.m_id);
          if (m.id && existingMsg.id) return String(existingMsg.id) === String(m.id);
          return existingMsg.message === m.message && existingMsg.timestamp === m.timestamp;
        });

        if (!exists) {
          grouped[key].messages.push(m);
          const isMsgRead = m.read ||
            (m.m_id && readMessageIdsRef.current.has(String(m.m_id))) ||
            (m.id && readMessageIdsRef.current.has(String(m.id))) ||
            (m.room && (readRoomsRef.current.has(m.room) || currentInboxRoomRef.current === m.room)) ||
            (key && readRoomsRef.current.has(String(key)));
          if (!isMsgRead) grouped[key].unreadCount += 1;
          grouped[key].lastMessage = m;
        }
      });
    }

    return Object.values(grouped).map((conversation) => {
      const sortedMsgs = sortMessages(conversation.messages);
      const lastMsg = sortedMsgs.at(-1) || conversation.lastMessage;
      return {
        ...conversation,
        messages: sortedMsgs,
        lastMessage: lastMsg,
        hasActualMessages: sortedMsgs.length > 0
      };
    }).sort((a, b) => {
      const timeA = a.hasActualMessages ? new Date(a.lastMessage?.timestamp || 0).getTime() : 0;
      const timeB = b.hasActualMessages ? new Date(b.lastMessage?.timestamp || 0).getTime() : 0;
      if (timeB !== timeA) {
        return timeB - timeA;
      }
      if (b.unreadCount !== a.unreadCount) {
        return b.unreadCount - a.unreadCount;
      }
      const idA = Number(a.applicant_no || 0);
      const idB = Number(b.applicant_no || 0);
      return idB - idA;
    });
  };

  const markAsRead = (messageId) => {
    setData((d) => ({
      ...d,
      inbox: d.inbox.map((m) => (m.id === messageId ? { ...m, read: true } : m)),
    }));
  };

  const markConversationAsRead = (applicantNo, room) => {
    if (room) readRoomsRef.current.add(room);
    if (applicantNo) readRoomsRef.current.add(String(applicantNo));
    setData((d) => ({
      ...d,
      inbox: d.inbox.map((m) => {
        const sameApplicant = applicantNo && m.applicant_no?.toString() === applicantNo?.toString();
        const sameRoom = room && (m.room === room || m.room === `provider_room_${room.split('_')[2]}`);
        if (sameApplicant || sameRoom) {
          if (m.m_id) readMessageIdsRef.current.add(String(m.m_id));
          if (m.id) readMessageIdsRef.current.add(String(m.id));
          return { ...m, read: true };
        }
        return m;
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
    const effectiveProNo = activeProviderNo || currentConversation?.pro_no || currentMessage?.pro_no || 1;
    let room = currentMessage?.room || currentConversation?.room;
    if (!room && currentConversation?.applicant_no) {
      room = `${currentConversation.applicant_no}+${effectiveProNo}`;
    }
    if (room && (room.includes('+null') || room.includes('+undefined'))) {
      const parts = room.split('+');
      room = `${parts[0]}+${effectiveProNo}`;
    }

    if (!replyText.trim() || !room) {
      console.warn('Cannot send reply: Missing message text or room.', { room, replyText });
      return;
    }

    const textToSend = replyText.trim();
    const tempId = `temp-${Date.now()}-${Math.random()}`;
    const nowIso = new Date().toISOString();
    const resolvedSenderId = currentUserId ? Number(currentUserId) : null;
    const resolvedUsername = programName || userName || 'Admin';

    const optimisticMsg = {
      id: tempId,
      m_id: tempId,
      studentName: userName || userFirstName || 'Admin',
      studentEmail: userName || userFirstName || 'Admin',
      applicant_no: currentConversation?.isAdminRoom ? null : (currentConversation?.applicant_no || room),
      studentStatus: 'Active',
      message: textToSend,
      timestamp: nowIso,
      read: true,
      is_student_sender: false,
      room: room
    };

    setData((prev) => ({
      ...prev,
      inbox: sortMessages([...(prev.inbox || []), optimisticMsg])
    }));

    setReplyText('');

    if (socketService.isConnected()) {
      socketService.sendMessage(room, userName, textToSend, programName, false, resolvedSenderId);
    } else if (messagingAPI && room) {
      messagingAPI.sendMessage(room, {
        message: textToSend,
        username: resolvedUsername,
        sender_id: resolvedSenderId,
        is_student_sender: false
      }).then(res => {
        if (res.data?.message?.m_id) {
          const serverMsg = res.data.message;
          setData(prev => {
            const updatedInbox = (prev.inbox || []).map(m => {
              if (m.id === tempId) {
                return {
                  ...m,
                  id: serverMsg.m_id,
                  m_id: serverMsg.m_id,
                  timestamp: serverMsg.timestamp || m.timestamp
                };
              }
              return m;
            });
            return { ...prev, inbox: sortMessages(updatedInbox) };
          });
        }
      }).catch(err => console.warn('REST message send fallback notice:', err));
    }
  };

  const allKnownApplicants = useMemo(() => [
    ...(data.applicants || []),
    ...(data.accepted || []),
    ...(data.rejected || []),
    ...(data.declined || []),
    ...(data.cancelled || [])
  ], [data.applicants, data.accepted, data.rejected, data.declined, data.cancelled]);

  const allMessages = data.inbox || [];
  const unreadCount = allMessages.filter((m) => !m.read).length;
  const conversations = useMemo(() => groupMessagesByStudent(allMessages), [allMessages, inboxMode]);

  const recentApplicantMessages = useMemo(() => {
    const rawInbox = data.inbox || [];
    // Only include applicant-related messages (exclude admin provider channels like provider_room_X, superadmin_room_X, 0+X)
    const applicantMsgs = rawInbox.filter(m => {
      if (!m.room) return false;
      if (
        m.room.startsWith('provider_room_') ||
        m.room.startsWith('superadmin_room_') ||
        m.room.startsWith('admin_room') ||
        m.room === '0+1' || m.room === '0+2' || m.room === '0+3' ||
        /^0\+/.test(m.room)
      ) return false;
      return true;
    });

    return applicantMsgs.map(msg => {
      let resolvedApplicantNo = msg.applicant_no ? String(msg.applicant_no) : '';
      if (!resolvedApplicantNo && msg.room && msg.room.includes('+')) {
        const p = msg.room.split('+')[0];
        if (/^[1-9]\d*$/.test(p)) resolvedApplicantNo = p;
      }

      // 1. Check allKnownApplicants
      const match = allKnownApplicants.find(a => {
        const aNo = (a.applicant_no || a.applicantNo || a.applicant_id || a.user_no || (typeof a.id === 'string' ? a.id.split('_')[0] : a.id) || '').toString();
        if (resolvedApplicantNo && aNo === resolvedApplicantNo) return true;
        const aEmail = (a.email || a.emailAddress || a.studentContact?.email || '').toLowerCase();
        if (msg.studentEmail && aEmail && aEmail === msg.studentEmail.toLowerCase()) return true;
        return false;
      });

      let applicantFullName = '';
      if (match) {
        if (match.firstName && match.lastName) applicantFullName = `${match.firstName} ${match.lastName}`;
        else if (match.first_name && match.last_name) applicantFullName = `${match.first_name} ${match.last_name}`;
        else if (match.name && !match.name.toLowerCase().startsWith('applicant ')) applicantFullName = match.name;
      }

      // 2. Check resolved conversations
      if (!applicantFullName && resolvedApplicantNo && Array.isArray(conversations)) {
        const conv = conversations.find(c => String(c.applicant_no) === String(resolvedApplicantNo));
        if (conv && conv.studentName && !conv.studentName.toLowerCase().startsWith('applicant ')) {
          applicantFullName = conv.studentName;
        }
      }

      // 3. Check explicit applicant_name or name fields on the message
      if (!applicantFullName) {
        if (msg.applicant_name && !msg.applicant_name.toLowerCase().startsWith('applicant ')) {
          applicantFullName = msg.applicant_name;
        } else if (msg.first_name || msg.last_name) {
          applicantFullName = `${msg.first_name || ''} ${msg.last_name || ''}`.trim();
        }
      }

      // 4. If student sender sent it and username is not a provider alias
      if (!applicantFullName && msg.is_student_sender && msg.username && !adminSenderAliases.has(normalizeProviderIdentity(msg.username)) && !msg.username.toLowerCase().startsWith('applicant ')) {
        applicantFullName = msg.username;
      }

      // 5. Fallback
      if (!applicantFullName) {
        if (resolvedApplicantNo) {
          applicantFullName = `Applicant ${resolvedApplicantNo}`;
        } else {
          applicantFullName = 'Applicant';
        }
      }

      // Clean up auto-generated initial system message text if it contains "Applicant <number>"
      let displayMessage = msg.message || '';
      if (displayMessage && /Chat initiated for Applicant \d+/i.test(displayMessage) && applicantFullName && !applicantFullName.startsWith('Applicant ')) {
        displayMessage = displayMessage.replace(/Chat initiated for Applicant \d+/i, `Chat initiated for ${applicantFullName}`);
      }

      return {
        ...msg,
        applicant_no: resolvedApplicantNo || msg.applicant_no,
        studentName: applicantFullName,
        message: displayMessage
      };
    });
  }, [data.inbox, allKnownApplicants, conversations]);

  const filteredConversations = useMemo(() => {
    let filtered = conversations;

    if (inboxMode === 'applicants') {
      filtered = filtered.filter(c => !c.isAdminRoom && !c.room?.startsWith('provider_room_'));

      // Ensure rejected and declined applicants are not shown in the inbox
      filtered = filtered.filter((c) => {
        const studentStatus = getStudentStatus(c.applicant_no, c.studentName, c.lastMessage?.studentStatus, c.studentEmail);
        const normStatus = (studentStatus || '').toLowerCase();

        const isRejectedStatus = normStatus === 'rejected' || normStatus === 'declined';

        const isRejectedApplicant = (a) => {
          const aNo = (a.applicant_no || a.applicantNo || a.applicant_id || (typeof a.id === 'string' ? a.id.split('_')[0] : a.id) || '').toString();
          if (c.applicant_no && aNo && aNo === c.applicant_no.toString()) return true;
          const aEmail = (a.email || a.emailAddress || '').toLowerCase();
          if (c.studentEmail && aEmail && aEmail === c.studentEmail.toLowerCase()) return true;
          return false;
        };

        const isRejectedList =
          (data.rejected || []).some(isRejectedApplicant) ||
          (data.declined || []).some(isRejectedApplicant);

        return !isRejectedStatus && !isRejectedList;
      });

      if (inboxFilter !== 'all') {
        filtered = filtered.filter((c) => {
          const studentStatus = getStudentStatus(c.applicant_no, c.studentName, c.lastMessage?.studentStatus, c.studentEmail);
          if (inboxFilter === 'pending') {
            return studentStatus === 'Pending';
          } else if (inboxFilter === 'accepted') {
            return studentStatus === 'Accepted';
          }
          return true;
        });
      }

      if (inboxSearch.trim()) {
        const q = inboxSearch.toLowerCase();
        filtered = filtered.filter((c) => {
          return (
            (c.applicant_no && c.applicant_no.toString().toLowerCase().includes(q)) ||
            c.studentName.toLowerCase().includes(q) ||
            (c.studentEmail || '').toLowerCase().includes(q) ||
            c.messages.some((m) => (m.message || '').toLowerCase().includes(q))
          );
        });
      }
    } else {
      filtered = filtered.filter(c => c.isAdminRoom || c.room?.startsWith('provider_room_'));
    }

    return [...filtered].sort((a, b) => {
      const timeA = a.hasActualMessages || (a.messages && a.messages.length > 0)
        ? new Date(a.lastMessage?.timestamp || 0).getTime()
        : 0;
      const timeB = b.hasActualMessages || (b.messages && b.messages.length > 0)
        ? new Date(b.lastMessage?.timestamp || 0).getTime()
        : 0;
      if (timeB !== timeA) {
        return timeB - timeA;
      }
      if (b.unreadCount !== a.unreadCount) {
        return b.unreadCount - a.unreadCount;
      }
      const idA = Number(a.applicant_no || 0);
      const idB = Number(b.applicant_no || 0);
      return idB - idA;
    });
  }, [conversations, inboxSearch, inboxFilter, inboxMode]);

  const selectedConversation = viewMessage
    ? (filteredConversations.find((c) => (viewMessage.applicant_no && c.applicant_no?.toString() === viewMessage.applicant_no?.toString()) || (viewMessage.room && c.room === viewMessage.room)) || null)
    : null;
  const currentConversation = selectedConversation || (filteredConversations.length > 0 ? filteredConversations[0] : null);
  const currentConversationMessages = useMemo(
    () => sortMessages(currentConversation?.messages || []),
    [currentConversation]
  );
  const currentMessage = currentConversationMessages.at(-1)
    || (viewMessage ? allMessages.find((m) => m.id === viewMessage.messageId) : null);

  useEffect(() => {
    currentInboxRoomRef.current = currentMessage?.room || currentConversation?.room || null;
    if (section === 'inbox' && currentConversation?.room) {
      socketService.loadHistory(currentConversation.room);
    }
  }, [currentMessage, currentConversation?.room, section]);

  useEffect(() => {
    if (section !== 'inbox' || !currentConversation) {
      return;
    }

    inboxMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [currentConversation, currentConversationMessages.length, section]);



  const renderDashboard = () => {
    return (
      <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-300">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {[
            { label: 'Total Applicants', value: stats.total, icon: <FaUsers />, color: '#800020' },
            { label: 'Accepted Scholars', value: stats.accepted, icon: <FaCheckCircle />, color: '#16a34a' },
            { label: 'Pending Reviews', value: stats.pending, icon: <FaClock />, color: '#d97706' }
          ].map((kpi, i) => (
            <div key={i} className="bg-white p-4 sm:p-6 rounded-2xl sm:rounded-3xl shadow-sm border border-gray-100 hover:shadow-md transition-all">
              <div className="flex justify-between items-start mb-3 sm:mb-4">
                <div className="p-2.5 sm:p-3 rounded-2xl" style={{ backgroundColor: `${kpi.color}15`, color: kpi.color }}>{kpi.icon}</div>
                <span className="text-[10px] font-black text-green-600 bg-green-50 px-2 py-1 rounded-md">LIVE</span>
              </div>
              <p className="text-[10px] sm:text-xs font-bold text-gray-400 uppercase tracking-widest">{kpi.label}</p>
              <h3 className="text-2xl sm:text-3xl font-black text-gray-900 mt-1">{kpi.value}</h3>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8">
          {/* Recent Applicants */}
          <div className="bg-white rounded-2xl sm:rounded-3xl shadow-md border border-gray-100 overflow-hidden">
            <div className="p-4 sm:p-6 border-b border-gray-50 flex justify-between items-center bg-gray-50/30">
              <h3 className="font-black text-gray-900 uppercase tracking-widest text-[11px] sm:text-xs">Recent Applicants</h3>
              <button onClick={() => setSection('track')} className="text-xs font-bold text-[#800020] hover:underline">View All</button>
            </div>
            <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
              {recentPendingApplicants.slice(0, 15).map((app, idx) => {
                const targetIdx = data.applicants.indexOf(app);
                return (
                  <div
                    key={app.applicant_no || app.id || idx}
                    className="p-3 sm:p-4 flex items-center gap-3 sm:gap-4 hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={() => viewApplicantFn(targetIdx >= 0 ? targetIdx : idx, 'all')}
                  >
                    <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-[#800020] to-[#650018] flex items-center justify-center text-white font-semibold flex-shrink-0 text-sm">
                      {(app.firstName?.[0] || app.name?.[0] || '').toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center mb-0.5 gap-2">
                        <span className="text-xs sm:text-sm font-black text-gray-900 truncate">{app.lastName ? `${app.firstName} ${app.lastName}` : app.name}</span>
                        <span className="text-[9px] sm:text-[10px] font-bold text-[#800020] bg-rose-50 px-2 py-0.5 rounded-full flex-shrink-0">{app.course}</span>
                      </div>
                      <p className="text-[11px] sm:text-xs text-gray-500 line-clamp-1">{getApplicantAddressDisplay(app)}</p>
                    </div>
                  </div>
                );
              })}
              {recentPendingApplicants.length === 0 && (
                <div className="p-8 text-center text-gray-400 text-sm">No recent applicants found.</div>
              )}
            </div>
          </div>


          {/* Recent Messages */}
          <div className="bg-white rounded-2xl sm:rounded-3xl shadow-md border border-gray-100 overflow-hidden">
            <div className="p-4 sm:p-6 border-b border-gray-50 flex justify-between items-center bg-gray-50/30">
              <h3 className="font-black text-gray-900 uppercase tracking-widest text-[11px] sm:text-xs">Recent Messages</h3>
              <button onClick={() => setSection('inbox')} className="text-xs font-bold text-[#800020] hover:underline">View Inbox</button>
            </div>
            <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
              {recentApplicantMessages.slice(0, 15).map(msg => (
                <div
                  key={msg.id}
                  className="p-3 sm:p-4 flex items-center gap-3 sm:gap-4 hover:bg-gray-50 transition-colors cursor-pointer"
                  onClick={() => {
                    if (msg.applicant_no) {
                      setViewMessage({ applicant_no: msg.applicant_no, room: msg.room, messageId: msg.id });
                    }
                    setSection('inbox');
                  }}
                >
                  <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl flex items-center justify-center text-white bg-blue-500 flex-shrink-0 text-sm shadow-xs">
                    <FaEnvelope />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center mb-0.5 gap-2">
                      <span className="text-xs sm:text-sm font-black text-gray-900 truncate">{msg.studentName}</span>
                      <span className="text-[9px] sm:text-[10px] font-bold text-gray-400 uppercase flex-shrink-0">{formatDate(msg.timestamp)}</span>
                    </div>
                    <p className="text-[11px] sm:text-xs text-gray-500 line-clamp-1">{msg.message}</p>
                  </div>
                </div>
              ))}
              {recentApplicantMessages.length === 0 && (
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
      <section className="space-y-4 sm:space-y-6 animate-in fade-in duration-300">
        <div className="bg-white rounded-2xl sm:rounded-3xl shadow-md border border-gray-100 p-4 sm:p-6 lg:p-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
            <div className="flex-1 min-w-0">
              <h2 className="text-xl sm:text-2xl font-black text-gray-900 truncate">Scholarship Slot Tracking</h2>
              <p className="text-xs sm:text-sm text-gray-500 font-medium">Monitor open slots and matching demand for all programs</p>
            </div>
            <button
              type="button"
              onClick={() => {
                resetForm();
                setManageTab('scholarship');
                setManageMode('create');
                setSection('manage');
              }}
              className="w-full sm:w-auto px-4 py-2.5 sm:px-5 sm:py-3 rounded-xl sm:rounded-2xl bg-[#800020] text-white font-bold text-xs sm:text-sm shadow-sm hover:bg-[#650018] transition-colors text-center"
            >
              Add Scholarship Post
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-6">
            <div className="rounded-xl sm:rounded-2xl border border-emerald-100 bg-emerald-50 p-3.5 sm:p-4">
              <p className="text-[10px] sm:text-xs font-black uppercase tracking-widest text-emerald-700 mb-1 sm:mb-2">Open Scholarships</p>
              <p className="text-2xl sm:text-3xl font-black text-emerald-900">{openScholarships}</p>
            </div>
            <div className="rounded-xl sm:rounded-2xl border border-blue-100 bg-blue-50 p-3.5 sm:p-4">
              <p className="text-[10px] sm:text-xs font-black uppercase tracking-widest text-blue-700 mb-1 sm:mb-2">Open Slots</p>
              <p className="text-2xl sm:text-3xl font-black text-blue-900">{totalOpenSlots}</p>
            </div>
            <div className="rounded-xl sm:rounded-2xl border border-amber-100 bg-amber-50 p-3.5 sm:p-4">
              <p className="text-[10px] sm:text-xs font-black uppercase tracking-widest text-amber-700 mb-1 sm:mb-2">Visible Posts</p>
              <p className="text-2xl sm:text-3xl font-black text-amber-900">{scholarshipFinderResults.length}</p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 mb-4 sm:mb-6">
            <div className="flex-1 flex items-center gap-3 rounded-xl sm:rounded-2xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 sm:px-4 sm:py-3">
              <FaSearch className="text-[#800020] flex-shrink-0" />
              <input
                type="text"
                value={finderSearch}
                onChange={(event) => setFinderSearch(event.target.value)}
                placeholder="Search by scholarship, location, term, or year"
                className="w-full bg-transparent outline-none text-xs sm:text-sm font-medium text-gray-700"
              />
            </div>
            <select
              value={finderAvailabilityFilter}
              onChange={(event) => setFinderAvailabilityFilter(event.target.value)}
              className="rounded-xl sm:rounded-2xl border border-gray-200 bg-white px-3.5 py-2.5 sm:px-4 sm:py-3 text-xs sm:text-sm font-semibold text-gray-700 outline-none"
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
                        {(post.isRemoved === true || post.is_removed === true) && (
                          <span className="px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider bg-red-600 text-white shadow-sm flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span> DELETED
                          </span>
                        )}
                      </div>
                      <h3 className="text-xl font-black text-gray-900 flex items-center gap-2">
                        {post.scholarshipName || 'Untitled Scholarship'}
                        {(post.isRemoved === true || post.is_removed === true) && (
                          <span className="text-xs font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-md uppercase">(Deleted)</span>
                        )}
                      </h3>
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
                      <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1">Accepted</p>
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
        <section className="bg-white p-4 sm:p-6 lg:p-8 rounded-2xl shadow-md border border-gray-50 animate-in fade-in duration-300">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
            <div className="flex bg-gray-100 p-1 rounded-xl shadow-inner w-full sm:w-auto">
              <button
                onClick={() => setManageTab('scholarship')}
                className={`flex-1 sm:flex-initial px-3.5 py-2 sm:px-6 sm:py-2 rounded-lg font-bold text-xs sm:text-sm transition-all text-center ${manageTab === 'scholarship' ? 'bg-[#800020] text-white shadow-md' : 'text-gray-500 hover:text-[#800020]'}`}
              >
                Scholarship Posts
              </button>
              <button
                onClick={() => setManageTab('announcement')}
                className={`flex-1 sm:flex-initial px-3.5 py-2 sm:px-6 sm:py-2 rounded-lg font-bold text-xs sm:text-sm transition-all text-center ${manageTab === 'announcement' ? 'bg-[#800020] text-white shadow-md' : 'text-gray-500 hover:text-[#800020]'}`}
              >
                Announcements
              </button>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-3 w-full sm:w-auto">
              <div className="flex items-center gap-2 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200 flex-1 min-w-0">
                <FaSearch className="text-[#800020] flex-shrink-0" />
                <input
                  type="text"
                  placeholder={`Search ${manageTab}s...`}
                  value={manageSearch}
                  onChange={(e) => setManageSearch(e.target.value)}
                  className="bg-transparent border-none outline-none text-xs font-medium w-full"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  setManageMode('create');
                }}
                className="w-full sm:w-auto px-3.5 py-2 sm:px-4 sm:py-2 rounded-lg bg-[#800020] text-white font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 hover:bg-[#650018] transition-colors flex-shrink-0"
              >
                <FaPlus /> {manageTab === 'scholarship' ? 'Add Post' : 'Add Announcement'}
              </button>
            </div>
          </div>

          <div className="space-y-3 sm:space-y-4">
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
                    <div key={post.reqNo || post.id} className="border border-gray-200 rounded-xl p-3.5 sm:p-5 hover:shadow-md transition-shadow">
                      <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <h4 className="text-base sm:text-lg font-semibold text-[#800020]">
                              {post.scholarshipName || post.title}
                            </h4>
                            {isNew && (
                              <span className="px-2 py-0.5 rounded bg-yellow-200 text-yellow-900 text-[10px] sm:text-xs font-bold">NEW</span>
                            )}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 text-xs sm:text-sm text-gray-600">
                            <div><strong>Deadline:</strong> {formatDate(post.deadline)}</div>
                            <div><strong>Slots:</strong> {post.slots}</div>
                            <div><strong>Location:</strong> {post.location}</div>
                            <div><strong>Min GPA:</strong> {post.minGpa}%</div>
                            <div><strong>Term:</strong> {post.semester} {post.year}</div>
                          </div>
                          <p className="text-xs sm:text-sm text-gray-700 mt-2.5 sm:mt-3 line-clamp-2">{post.description}</p>
                          <div className="text-[10px] sm:text-xs text-gray-500 mt-2 sm:mt-3">
                            Date Created: {formatDate(post.dateCreated)}
                          </div>
                        </div>
                        <div className="flex gap-2 self-end sm:self-auto flex-shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              editPost(post);
                            }}
                            className="p-2 sm:p-2.5 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors text-xs sm:text-sm"
                            title="Edit Post"
                          >
                            <FaEdit />
                          </button>
                          <button
                            type="button"
                            onClick={() => deletePost(post.reqNo || post.id)}
                            className="p-2 sm:p-2.5 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors text-xs sm:text-sm"
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
      <section className="bg-white p-4 sm:p-6 lg:p-8 rounded-2xl shadow-md border border-gray-50 animate-in fade-in duration-300">
        <div className="flex flex-row items-center justify-between gap-3 mb-4 sm:mb-6">
          <h3 className="text-base sm:text-lg lg:text-xl font-bold text-[#800020] min-w-0 flex-1">
            {manageMode === 'edit' ? `Edit ${manageTab === 'scholarship' ? 'Scholarship Post' : 'Announcement'}` : `Create New ${manageTab === 'scholarship' ? 'Scholarship Post' : 'Announcement'}`}
          </h3>
          <button
            type="button"
            onClick={() => setManageMode('list')}
            className="whitespace-nowrap px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg bg-gray-500 text-white font-semibold text-xs sm:text-sm hover:bg-gray-600 transition-colors flex-shrink-0"
          >
            Back to List
          </button>
        </div>

        <form className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4" onSubmit={(e) => { e.preventDefault(); manageTab === 'scholarship' ? saveScholarshipPost() : saveAnnouncement(); }}>
          <div className="md:col-span-2">
            <label className="block text-xs sm:text-sm font-semibold text-[#800020] mb-1">Title *</label>
            <input
              type="text"
              name={manageTab === 'scholarship' ? 'scholarshipName' : 'title'}
              value={manageTab === 'scholarship' ? formData.scholarshipName : formData.title}
              onChange={handleFormChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-xs sm:text-sm"
              placeholder={manageTab === 'scholarship' ? scholarshipPlaceholder : "e.g. System Maintenance"}
              required
            />
          </div>

          {manageTab === 'scholarship' ? (
            <>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-[#800020] mb-1">Deadline *</label>
                <input
                  type="date"
                  name="deadline"
                  value={formData.deadline}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-xs sm:text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-[#800020] mb-1">Min. GPA (%) *</label>
                <input
                  type="number"
                  name="minGpa"
                  value={formData.minGpa}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-xs sm:text-sm"
                  placeholder="e.g. 85"
                  required
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-[#800020] mb-1">Required Units (Int)</label>
                <input
                  type="number"
                  name="units"
                  value={formData.units}
                  onChange={handleFormChange}
                  min="1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-xs sm:text-sm"
                  placeholder="e.g. 18"
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-[#800020] mb-1">Residency Document *</label>
                <select
                  name="residencyDocType"
                  value={formData.residencyDocType}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-xs sm:text-sm font-medium"
                >
                  <option value="Indigency Document">Indigency Document</option>
                  <option value="Residency Document">Residency Document</option>
                </select>
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-[#800020] mb-1">ID Verification *</label>
                <select
                  name="idType"
                  value={formData.idType}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-xs sm:text-sm font-medium"
                >
                  <option value="School ID">School ID</option>
                  <option value="National ID">National ID</option>
                </select>
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-[#800020] mb-1">Slots *</label>
                <input
                  type="number"
                  name="slots"
                  value={formData.slots}
                  onChange={handleFormChange}
                  min="1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-xs sm:text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-[#800020] mb-1">Location *</label>
                <input
                  type="text"
                  name="location"
                  value={formData.location}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-xs sm:text-sm"
                  placeholder="Eligible location"
                  required
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-[#800020] mb-1">Parent Income Limit (PHP)</label>
                <input
                  type="number"
                  name="parentFinance"
                  value={formData.parentFinance}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-xs sm:text-sm"
                  placeholder="Maximum annual income"
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-[#800020] mb-1">Semester for ID and COE *</label>
                <select
                  name="semester"
                  value={formData.semester}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-xs sm:text-sm"
                  required
                >
                  <option value="">Select Semester</option>
                  <option value="1st">1st Semester</option>
                  <option value="2nd">2nd Semester</option>
                  <option value="3rd">3rd Semester</option>
                </select>
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-[#800020] mb-1">Academic Year for ID and COE*</label>
                <input
                  type="text"
                  name="year"
                  value={formData.year}
                  onChange={handleFormChange}
                  onBlur={handleAcademicYearBlur}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-xs sm:text-sm"
                  placeholder="e.g. 2025-2026"
                  required
                />
                <p className="text-[10px] sm:text-xs text-gray-500 mt-1">Use the YYYY-YYYY format (e.g., 2025-2026).</p>
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-[#800020] mb-1">Semester for Grades *</label>
                <select
                  name="grades_sem"
                  value={formData.grades_sem}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-xs sm:text-sm"
                  required
                >
                  <option value="">Select Semester</option>
                  <option value="1st">1st Semester</option>
                  <option value="2nd">2nd Semester</option>
                  <option value="3rd">3rd Semester</option>
                </select>
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-[#800020] mb-1">Year for Grades *</label>
                <input
                  type="text"
                  name="grades_year"
                  value={formData.grades_year}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-xs sm:text-sm"
                  placeholder="e.g. 2024-2025"
                  required
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs sm:text-sm font-semibold text-[#800020] mb-1">Description *</label>
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-xs sm:text-sm min-h-[120px]"
                  placeholder="Full details about the scholarship..."
                  required
                />
              </div>
            </>
          ) : (
            <>
              <div className="md:col-span-2">
                <label className="block text-xs sm:text-sm font-semibold text-[#800020] mb-1">Announcement Content *</label>
                <textarea
                  name="content"
                  value={formData.content}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-xs sm:text-sm min-h-[150px]"
                  placeholder="Write your announcement here..."
                  required
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs sm:text-sm font-semibold text-[#800020] mb-2">
                  <FaImage className="inline mr-2" />
                  Announcement Images
                </label>

                <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 sm:p-6 text-center hover:border-[#800020] transition-colors">
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
                    className="cursor-pointer inline-flex items-center gap-2 px-3.5 py-2 sm:px-4 sm:py-2 bg-[#800020] text-white rounded-lg text-xs sm:text-sm font-semibold hover:bg-[#650018] transition-colors"
                  >
                    <FaUpload />
                    Choose Images
                  </label>
                  <p className="text-xs sm:text-sm text-gray-500 mt-2">Upload announcement photos, banners, or related images</p>
                </div>

                {announcementImages.length > 0 && (
                  <div className="mt-4">
                    <h4 className="text-xs sm:text-sm font-semibold text-[#800020] mb-2">Uploaded Images ({announcementImages.length})</h4>
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
                <label className="block text-xs sm:text-sm font-semibold text-[#800020] mb-2">Send to:</label>
                <div className="flex flex-col sm:flex-row gap-2.5 sm:gap-6">
                  <label className="flex items-center gap-2 cursor-pointer text-xs sm:text-sm">
                    <input
                      type="radio"
                      name="sendToAllApplicants"
                      checked={formData.sendToAllApplicants === true}
                      onChange={() => setFormData({ ...formData, sendToAllApplicants: true })}
                      className="w-4 h-4 text-[#800020] focus:ring-[#800020]"
                    />
                    <span className="text-gray-700">All Applicants (Recommended)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs sm:text-sm">
                    <input
                      type="radio"
                      name="sendToAllApplicants"
                      checked={formData.sendToAllApplicants === false}
                      onChange={() => setFormData({ ...formData, sendToAllApplicants: false })}
                      className="w-4 h-4 text-[#800020] focus:ring-[#800020]"
                    />
                    <span className="text-gray-700">{applicantsOnlyLabel}</span>
                  </label>
                </div>
              </div>
            </>
          )}

          <div className="md:col-span-2 flex flex-col sm:flex-row justify-end gap-2.5 sm:gap-3 mt-2">
            <button type="button" onClick={() => setManageMode('list')} className="w-full sm:w-auto px-4 py-2 sm:px-6 sm:py-2.5 rounded-lg bg-gray-500 text-white font-semibold text-xs sm:text-sm hover:bg-gray-600 transition-colors text-center" disabled={isSaving}>
              Cancel
            </button>
            <button type="submit" disabled={isSaving} className={`w-full sm:w-auto px-4 py-2 sm:px-6 sm:py-2.5 rounded-lg bg-[#800020] text-white font-semibold text-xs sm:text-sm hover:bg-[#650018] transition-colors text-center ${isSaving ? 'opacity-50 cursor-not-allowed' : ''}`}>
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
          (getApplicantAddressDisplay(a).toLowerCase().includes(search)) ||
          (a.course && a.course.toLowerCase().includes(search)) ||
          (a.mobileNumber && a.mobileNumber.toLowerCase().includes(search));
        const matchesScholarship = matchesScholarshipSelection(a, trackScholarshipFilter);
        const matchesCourse = courseTrackFilter === 'all' || a.course === courseTrackFilter;
        const matchesAdvanced = applicantMatchesAdvancedScholarshipFilters(a, trackAdvancedSearch, data.scholarshipPosts);

        return matchesSearch && matchesScholarship && matchesCourse && matchesAdvanced;
      });
    };

    const sortApplicants = (list) => {
      return [...list].sort((a, b) => {
        if (sortConfig.column && sortConfig.direction) {
          let valA = '';
          let valB = '';

          if (sortConfig.column === 'name') {
            valA = String(a.name || '').toLowerCase();
            valB = String(b.name || '').toLowerCase();
          } else if (sortConfig.column === 'grade') {
            valA = convertGpaToPercentage(a.grade || a.overall_gpa || a.gpa, a.school) ?? 0;
            valB = convertGpaToPercentage(b.grade || b.overall_gpa || b.gpa, b.school) ?? 0;
          } else if (sortConfig.column === 'financial') {
            valA = Number(a.income || a.financial_income_of_parents || a.parentFinance || a.family?.grossIncome || 0);
            valB = Number(b.income || b.financial_income_of_parents || b.parentFinance || b.family?.grossIncome || 0);
          } else if (sortConfig.column === 'points') {
            const schA = getScholarshipForApplicant(a);
            const schB = getScholarshipForApplicant(b);
            valA = calculateDeservednessScore(a, schA);
            valB = calculateDeservednessScore(b, schB);
          } else if (sortConfig.column === 'schoolCourse') {
            valA = String(`${a.school || ''} ${a.course || ''}`).toLowerCase();
            valB = String(`${b.school || ''} ${b.course || ''}`).toLowerCase();
          } else if (sortConfig.column === 'contactAddress') {
            valA = String(`${getApplicantAddressDisplay(a)} ${a.mobileNumber || ''}`).toLowerCase();
            valB = String(`${getApplicantAddressDisplay(b)} ${b.mobileNumber || ''}`).toLowerCase();
          } else if (sortConfig.column === 'createdAt' || sortConfig.column === 'date' || sortConfig.column === 'dateApplied') {
            valA = getApplicantSubmissionTime(a);
            valB = getApplicantSubmissionTime(b);
          } else {
            valA = String(a[sortConfig.column] || '').toLowerCase();
            valB = String(b[sortConfig.column] || '').toLowerCase();
          }

          if (valA !== valB) {
            if (typeof valA === 'number' && typeof valB === 'number') {
              return sortConfig.direction === 'asc' ? valA - valB : valB - valA;
            }
            return sortConfig.direction === 'asc'
              ? String(valA).localeCompare(String(valB))
              : String(valB).localeCompare(String(valA));
          }
        }

        if (sortByPoints) {
          const schA = getScholarshipForApplicant(a);
          const schB = getScholarshipForApplicant(b);
          const scoreA = calculateDeservednessScore(a, schA);
          const scoreB = calculateDeservednessScore(b, schB);
          if (scoreB !== scoreA) return scoreB - scoreA;
        }

        return compareApplicantsByLatestSubmission(a, b);
      });
    };

    const pendingTaggedRaw = prioritizeProcessingApplicants(filterList(data.applicants)).map((a) => ({ ...a, _listType: 'pending', _listIdx: data.applicants.indexOf(a) }));
    const pendingTagged = sortApplicants(pendingTaggedRaw);

    const acceptedTaggedRaw = filterList(data.accepted).map((a, i) => ({ ...a, _listType: 'accepted', _listIdx: data.accepted.indexOf(a) }));
    const acceptedTagged = sortApplicants(acceptedTaggedRaw);

    const rejectedTaggedRaw = filterList(data.rejected).map((a, i) => ({ ...a, _listType: 'rejected', _listIdx: data.rejected.indexOf(a) }));
    const rejectedTagged = sortApplicants(rejectedTaggedRaw);

    const cancelledTaggedRaw = filterList(data.cancelled).map((a, i) => ({ ...a, _listType: 'cancelled', _listIdx: data.cancelled.indexOf(a) }));
    const cancelledTagged = sortApplicants(cancelledTaggedRaw);

    const allList = sortApplicants([...pendingTaggedRaw, ...acceptedTaggedRaw, ...rejectedTaggedRaw, ...cancelledTaggedRaw]);
    const acceptedList = acceptedTagged;
    const rejectedList = rejectedTagged;
    const cancelledList = cancelledTagged;

    const currentTrackList = trackTab === 'pending'
      ? pendingTagged
      : trackTab === 'accepted'
      ? acceptedList
      : trackTab === 'rejected'
      ? rejectedList
      : trackTab === 'cancelled'
      ? cancelledList
      : allList;

    const APPLICANT_PAGE_SIZE = 20;
    const totalTrackItems = currentTrackList.length;
    const totalTrackPages = Math.max(1, Math.ceil(totalTrackItems / APPLICANT_PAGE_SIZE));
    const safeTrackPage = Math.min(Math.max(1, applicantTrackPage), totalTrackPages);
    const paginatedTrackApplicants = currentTrackList.slice(
      (safeTrackPage - 1) * APPLICANT_PAGE_SIZE,
      safeTrackPage * APPLICANT_PAGE_SIZE
    );

    return (
      <section className="bg-white p-3 sm:p-6 lg:p-8 rounded-2xl shadow-md border border-gray-50 animate-in fade-in duration-300">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 mb-4">
          <h3 className="text-base sm:text-lg lg:text-xl font-semibold text-[#800020] break-words min-w-0">{trackTitle}</h3>
        </div>

        <div className="flex flex-col gap-2.5 mb-4">
          {/* Tab row + Export button: stacked on mobile, side-by-side on sm+ */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            {/* Tabs — horizontally scrollable */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none -mx-1 px-1 flex-1">
              {['all', 'pending', 'accepted', 'rejected', 'cancelled'].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setTrackTab(t); setApplicantTrackPage(1); }}
                  className={`px-2.5 py-1.5 sm:px-4 sm:py-2 rounded-lg font-semibold text-[10px] sm:text-sm flex items-center gap-1 sm:gap-1.5 whitespace-nowrap flex-shrink-0 ${trackTab === t ? 'bg-[#800020] text-white' : 'bg-[#800020]/10 text-[#800020] border border-[#800020]'
                    }`}
                >
                  {t === 'pending' && <FaClock className="text-[10px] sm:text-xs" />}
                  {t === 'all' && <FaUsers className="text-[10px] sm:text-xs" />}
                  {t === 'accepted' && <FaCheckCircle className="text-[10px] sm:text-xs" />}
                  {t === 'rejected' && <FaTimesCircle className="text-[10px] sm:text-xs" />}
                  {t === 'cancelled' && <FaTrashAlt className="text-[10px] sm:text-xs" />}
                  {t === 'pending' ? 'Pending' : t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            {/* Export button — full width below tabs on mobile, auto-width beside tabs on sm+ */}
            <button
              type="button"
              onClick={() => exportToExcel('track')}
              className="w-full sm:w-auto px-3 py-2 sm:px-4 sm:py-2 rounded-lg bg-green-600 text-white font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 hover:bg-green-700 transition-colors shadow-sm flex-shrink-0 whitespace-nowrap"
            >
              <FaFileExcel /> <span>Export to Excel</span>
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2.5 mb-4">
          <div className="flex items-center gap-2 bg-gray-50 px-3 py-2.5 sm:px-4 sm:py-3 rounded-xl border border-gray-200 w-full shadow-sm">
            <FaSearch className="text-[#800020] flex-shrink-0 text-xs sm:text-sm" />
            <input
              type="text"
              placeholder="Search by name, school, or address..."
              value={searchTrack}
              onChange={(e) => { setSearchTrack(e.target.value); setApplicantTrackPage(1); }}
              className="bg-transparent border-none outline-none w-full text-xs sm:text-sm font-medium"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={trackScholarshipFilter}
              onChange={(e) => { setTrackScholarshipFilter(e.target.value); setApplicantTrackPage(1); }}
              className="flex-1 min-w-[120px] px-2.5 py-2 sm:px-4 sm:py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs sm:text-sm outline-none font-bold text-[#800020] shadow-sm focus:ring-2 focus:ring-[#800020] transition-all"
            >
              <option value="all">All Scholarships</option>
              {activeScholarshipOptions.length > 0 && (
                <optgroup label="Active Scholarships">
                  {activeScholarshipOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              )}
              {deletedScholarshipOptions.length > 0 && (
                <optgroup label="Deleted Scholarships">
                  <option value="deleted">All Deleted Scholarships</option>
                  {deletedScholarshipOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>

            <button
              type="button"
              onClick={() => { setSortByPoints(prev => !prev); setApplicantTrackPage(1); }}
              className={`px-2.5 py-2 sm:px-4 sm:py-2.5 rounded-xl text-xs sm:text-sm outline-none font-bold shadow-sm transition-all flex items-center justify-center gap-1.5 border flex-shrink-0 ${sortByPoints
                ? 'bg-[#800020] text-white border-[#800020] hover:bg-[#650018]'
                : 'bg-gray-50 text-[#800020] border-gray-200 hover:bg-gray-100'
                }`}
            >
              <FaStar className={sortByPoints ? 'text-yellow-400' : 'text-[#800020]/75'} />
              <span className="hidden sm:inline">{sortByPoints ? 'Sorted by Points' : 'Sort by Points'}</span>
              <span className="sm:hidden">Points</span>
            </button>

            <button
              type="button"
              onClick={() => setShowTrackAdvancedSearch((prev) => !prev)}
              className="px-2.5 py-2 sm:px-4 sm:py-2.5 rounded-xl border border-[#800020] text-[#800020] font-semibold text-xs sm:text-sm hover:bg-[#800020]/10 transition-colors flex items-center justify-center gap-1.5 flex-shrink-0"
            >
              <FaFilter />
              <span className="hidden sm:inline">{showTrackAdvancedSearch ? 'Hide Filters' : 'Advanced Search'}</span>
              <span className="sm:hidden">Filter</span>
              {trackActiveFilterCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-[#800020] text-white text-[10px] font-black">
                  {trackActiveFilterCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {showTrackAdvancedSearch && renderAdvancedSearchPanel(
          'Advanced Applicant Search',
          trackAdvancedSearch,
          setTrackAdvancedSearch,
          () => { setTrackAdvancedSearch({ ...EMPTY_ADVANCED_SEARCH }); setApplicantTrackPage(1); },
          true
        )}

        {trackActiveFilterCount > 0 && !showTrackAdvancedSearch && (
          <p className="text-xs text-gray-500 mb-4">
            {trackActiveFilterCount} filter{trackActiveFilterCount === 1 ? '' : 's'} active — showing applicants matching your criteria.
          </p>
        )}

        <div className="overflow-x-auto overflow-y-auto rounded-t-xl border border-gray-200 min-h-[320px]" style={{ maxHeight: 'calc(100vh - 400px)' }}>
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-20 bg-[#800020] text-white">
              <tr className="bg-[#800020] text-white select-none">
                <th className="px-4 py-3 text-left font-semibold">Name</th>
                <th className="px-4 py-3 text-left font-semibold">Grade / GPA</th>
                <th className="px-4 py-3 text-left font-semibold">Financial</th>
                <th className="px-4 py-3 text-left font-semibold">Points</th>
                <th className="px-4 py-3 text-left font-semibold">School &amp; Course</th>
                <th className="px-4 py-3 text-left font-semibold">Contact &amp; Address</th>
                <th className="px-4 py-3 text-left font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {paginatedTrackApplicants.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-4 py-12 text-center text-gray-500 font-medium">
                    No applicants found matching your criteria.
                  </td>
                </tr>
              ) : (
                paginatedTrackApplicants.map((a, localIdx) => {
                  const i = (safeTrackPage - 1) * APPLICANT_PAGE_SIZE + localIdx;
                  const idx = a._listIdx !== undefined ? a._listIdx : data.applicants.indexOf(a);
                  const listType = a._listType || (a.status ? a.status.toLowerCase() : 'pending');
                  const processingState = getApplicantProcessingState(a);
                  const statusColors = {
                    pending: 'bg-yellow-100 text-yellow-700',
                    accepted: 'bg-green-100 text-green-700',
                    rejected: 'bg-red-100 text-red-700',
                    cancelled: 'bg-gray-100 text-gray-700',
                    declined: 'bg-red-100 text-red-700'
                  };
                  const statusLabels = {
                    pending: 'Pending',
                    accepted: 'Accepted',
                    rejected: 'Rejected',
                    cancelled: 'Cancelled',
                    declined: 'Declined'
                  };

                  return (
                    <tr key={`app-${a.applicant_no}-${a.scholarshipNo || i}`} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-[9px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-mono">#{i + 1}</span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${statusColors[listType] || 'bg-yellow-100 text-yellow-700'}`}>
                            {statusLabels[listType] || (listType.charAt(0).toUpperCase() + listType.slice(1))}
                          </span>
                          {processingState && <FaSpinner className="animate-spin text-[#800020] text-xs" />}
                        </div>
                        <div className="font-semibold text-sm">{a.name}</div>
                      </td>
                      <td className="px-3 py-2 text-sm font-semibold text-gray-800" title={a.grade ? `Original GPA: ${a.grade}` : ''}>
                        {formatGpaDisplay(a.grade || a.overall_gpa || a.gpa, a.school)}
                      </td>
                      <td className="px-3 py-2 text-sm">{getFinancialStatusLabel(a.income || a.financial_income_of_parents || a.family?.grossIncome)}</td>
                      {renderPointsCell(a)}
                      <td className="px-3 py-2 text-xs">
                        <div className="font-bold text-[#800020] leading-tight">{a.school}</div>
                        <div className="text-[10px] text-gray-500">{a.course || 'No Course'}</div>
                      </td>
                      <td className="px-3 py-2 text-[10px] leading-tight text-gray-600">
                        {a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'}<br />{getApplicantAddressDisplay(a)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => viewApplicantFn(idx, listType)}
                            className="px-3 py-1 rounded bg-[#800020] text-white text-xs font-semibold hover:bg-[#650018] transition-colors"
                            disabled={!!processingState}
                          >
                            View
                          </button>
                          {processingState && (
                            <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-[#800020]">
                              <FaSpinner className="animate-spin text-xs" />
                              {processingState.requestedStatus === 'Accepted' ? 'Approving' : 'Rejecting'}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 bg-gray-50 border border-gray-200 border-t-0 rounded-b-xl">
          <span className="text-xs text-gray-500 font-medium">
            Showing <span className="font-bold text-gray-800">{totalTrackItems === 0 ? 0 : (safeTrackPage - 1) * APPLICANT_PAGE_SIZE + 1}</span> to <span className="font-bold text-gray-800">{Math.min(safeTrackPage * APPLICANT_PAGE_SIZE, totalTrackItems)}</span> of <span className="font-bold text-[#800020]">{totalTrackItems}</span> applicants
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={safeTrackPage <= 1}
              onClick={() => setApplicantTrackPage(p => Math.max(1, p - 1))}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-300 bg-white text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 transition-all shadow-xs"
            >
              Previous
            </button>
            <span className="px-3 py-1 text-xs font-bold text-[#800020] bg-white border border-gray-200 rounded-lg shadow-xs">
              Page {safeTrackPage} of {totalTrackPages}
            </span>
            <button
              type="button"
              disabled={safeTrackPage >= totalTrackPages}
              onClick={() => setApplicantTrackPage(p => Math.min(totalTrackPages, p + 1))}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-300 bg-white text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 transition-all shadow-xs"
            >
              Next
            </button>
          </div>
        </div>

      </section>
    );
  };

  const exportToExcel = (type = 'report') => {
    const { applicants, accepted, rejected, cancelled, declined } = data;

    if (type === 'track') {
      const filterListToExport = (list) => (list || []).filter((a) => {
        if (!a) return false;
        const search = (searchTrack || '').toLowerCase().trim();
        const matchesSearch = !search || (
          String(a.name || '').toLowerCase().includes(search) ||
          String(a.school || '').toLowerCase().includes(search) ||
          getApplicantAddressDisplay(a).toLowerCase().includes(search) ||
          String(a.course || '').toLowerCase().includes(search) ||
          String(a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || '').toLowerCase().includes(search)
        );
        const matchesScholarship = matchesScholarshipSelection(a, trackScholarshipFilter);
        const matchesCourse = courseTrackFilter === 'all' || a.course === courseTrackFilter;
        const matchesAdvanced = applicantMatchesAdvancedScholarshipFilters(a, trackAdvancedSearch, data.scholarshipPosts);

        return matchesSearch && matchesScholarship && matchesCourse && matchesAdvanced;
      });

      const fileName = `${reportFilePrefix}_Tracking_Export_${new Date().toISOString().split('T')[0]}`;
      const wb = XLSX.utils.book_new();

      const formatTracking = (list) => list.map(app => {
        const sch = getScholarshipForApplicant(app);
        const points = calculateDeservednessScore(app, sch);
        return {
          'Student Name': app.name || `${app.firstName || ''} ${app.lastName || ''}`.trim() || 'N/A',
          'Status': app.status || 'Pending',
          'Grade': formatGpaDisplay(app.grade || app.overall_gpa || app.gpa, app.school),
          'Financial Status': getFinancialStatusLabel(app.income || app.financial_income_of_parents || app.parentFinance || app.family?.grossIncome),
          'Points': points ?? 'N/A',
          'School': app.school || 'N/A',
          'Course': app.course || 'N/A',
          'Contact No.': app.mobileNumber || app.phone || (app.studentContact && app.studentContact.phone) || 'N/A',
          'Address': getApplicantAddressDisplay(app)
        };
      });

      const activeScholarshipName = trackScholarshipFilter === 'all'
        ? 'All scholarship types'
        : (scholarshipFilterOptions.find(o => o.value === trackScholarshipFilter)?.label || scholarshipLabel);

      const addHeaderToSheet = (list, sheetName) => {
        const ws = XLSX.utils.aoa_to_sheet([
          [sidebarTitle, activeScholarshipName],
          [`Report: ${sheetName}`],
          [`Generated: ${new Date().toLocaleString()}`],
          []
        ]);
        const formattedData = formatTracking(list);
        XLSX.utils.sheet_add_json(ws, formattedData, { origin: 'A5' });

        // Auto-width adjustment
        ws['!cols'] = autoAdjustColumnWidths(formattedData);

        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      };

      const combinedAll = [
        ...(applicants || []),
        ...(accepted || []),
        ...(rejected || []),
        ...(cancelled || [])
      ];

      const uniqueCombinedMap = new Map();
      combinedAll.forEach(app => {
        const key = getApplicantIdentityKey(app) || app.applicant_no || app.id || app.name;
        if (!uniqueCombinedMap.has(key)) {
          uniqueCombinedMap.set(key, app);
        }
      });
      const uniqueAll = Array.from(uniqueCombinedMap.values());

      const filteredAll = filterListToExport(uniqueAll);
      const filteredPending = filterListToExport(applicants || []);
      const filteredAccepted = filterListToExport(accepted || []);
      const filteredRejected = filterListToExport(rejected || []);
      const filteredCancelled = filterListToExport(cancelled || []);

      addHeaderToSheet(filteredAll, 'All Applicants');
      addHeaderToSheet(filteredPending, 'Pending Review');
      addHeaderToSheet(filteredAccepted, 'Accepted Scholars');
      addHeaderToSheet(filteredRejected, 'Rejected');
      addHeaderToSheet(filteredCancelled, 'Cancelled');

      XLSX.writeFile(wb, `${fileName}.xlsx`);
      return;
    }

    // Helper to format applicant data for Excel
    const formatApplicants = (list) => list.map(app => ({
      'Student Name': app.name || `${app.firstName} ${app.lastName}`,
      'Scholarship Name': app.scholarshipName || 'N/A',
      'Grade': formatGpaDisplay(app.grade || app.overall_gpa || app.gpa, app.school),
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
    XLSX.utils.book_append_sheet(wb, declinedWS, 'Declined Applicants');
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

    const totalApplicantsCount = filteredApplicants.length;
    const totalSafe = totalApplicantsCount || 1;
    const kpiCards = [
      { label: 'Total Applicants', value: totalApplicantsCount.toLocaleString(), trend: `${totalApplicantsCount} total`, color: 'blue' },
      { label: 'New Applicants', value: filteredPending.length.toLocaleString(), trend: `${Math.round((filteredPending.length / totalSafe) * 100)}% of total`, color: 'green' },
      { label: 'Accepted', value: filteredAccepted.length.toLocaleString(), trend: `${Math.round((filteredAccepted.length / totalSafe) * 100)}% of total`, color: 'purple' },
      { label: 'Rejected', value: filteredRejected.length.toLocaleString(), trend: `${Math.round((filteredRejected.length / totalSafe) * 100)}% of total`, color: 'red' },
      { label: 'Cancelled', value: filteredCancelled.length.toLocaleString(), trend: `${Math.round((filteredCancelled.length / totalSafe) * 100)}% of total`, color: 'gray' },
      { label: 'Avg. Processing', value: `${historicalData.performanceMetrics?.averageProcessingTime || 0}d`, trend: `${historicalData.performanceMetrics?.acceptanceRate || 0}% accept rate`, color: 'amber' },
    ];

    return (
      <div className="space-y-6">
        {/* Header with Export Buttons */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6 report-header relative">
          <div className="min-w-0 flex-1 text-center lg:text-left">
            <h3 className="text-lg sm:text-2xl font-bold text-[#800020] report-title break-words leading-tight">{reportTitle}</h3>
            <p className="text-gray-500 text-xs sm:text-sm report-subtitle mt-0.5">Comprehensive KPI report and periodic trends</p>
            <p className="print-only text-[10px] text-gray-400 mt-2 font-bold italic">Generated on: {new Date().toLocaleString()}</p>
          </div>

          {/* Print-only Logo positioned at top right */}
          <div className="print-only absolute right-0 top-0">
            <img src={iskomatsLogo} alt="Iskomats Logo" className="h-14 w-auto object-contain opacity-90" />
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-3 flex-wrap w-full lg:w-auto">
            <div className="flex bg-gray-100 p-1 rounded-xl w-full sm:w-auto">
              <button
                onClick={() => setReportsView('analytics')}
                className={`flex-1 sm:flex-initial px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs font-bold transition-all text-center ${reportsView === 'analytics' ? 'bg-white text-[#800020] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >Analytics</button>
              <button
                onClick={() => setReportsView('tables')}
                className={`flex-1 sm:flex-initial px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs font-bold transition-all text-center ${reportsView === 'tables' ? 'bg-white text-[#800020] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >Tables</button>
            </div>
            <select
              value={analyticsScholarshipFilter}
              onChange={(e) => setAnalyticsScholarshipFilter(e.target.value)}
              className="w-full sm:w-auto px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs font-bold text-[#800020] shadow-sm focus:ring-2 focus:ring-[#800020] transition-all outline-none"
            >
              <option value="all">All Scholarship Types</option>
              {activeScholarshipOptions.length > 0 && (
                <optgroup label="Active Scholarships">
                  {activeScholarshipOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </optgroup>
              )}
              {deletedScholarshipOptions.length > 0 && (
                <optgroup label="Deleted Scholarships">
                  <option value="deleted">All Deleted Scholarships</option>
                  {deletedScholarshipOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </optgroup>
              )}
            </select>
            <div className="flex flex-row items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => window.print()}
                className="flex-1 sm:flex-initial px-3 py-2 rounded-xl bg-[#800020] text-white text-xs font-bold flex items-center justify-center gap-1.5 hover:opacity-90 transition-all shadow-lg"
              >
                <FaPrint className="flex-shrink-0" /> <span className="truncate">Print PDF</span>
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
                            <td className="px-4 py-3 text-red-600 font-semibold">{m.declined ?? m.rejected ?? 0}</td>
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
                            <td className="px-4 py-3 font-bold text-green-600 text-[10px]">{loc.percentage > 5 ? 'â†‘ HIGH' : 'â†’ STABLE'}</td>
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
              <div className="space-y-6 mt-8">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b-2 border-gray-100 pb-2">
                  <h4 className="text-base sm:text-lg font-black text-[#800020] uppercase tracking-wide">Applicant Status Lists</h4>
                  <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-1 -mx-2 px-2 flex-nowrap w-full sm:w-auto">
                    <button
                      onClick={() => setReportTab('pending')}
                      className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-[10px] sm:text-xs font-black transition-all whitespace-nowrap ${reportTab === 'pending' ? 'bg-amber-600 text-white shadow-md' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                    >
                      PENDING
                    </button>
                    <button
                      onClick={() => setReportTab('accepted')}
                      className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-[10px] sm:text-xs font-black transition-all whitespace-nowrap ${reportTab === 'accepted' ? 'bg-green-600 text-white shadow-md' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                    >
                      ACCEPTED
                    </button>
                    <button
                      onClick={() => setReportTab('rejected')}
                      className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-[10px] sm:text-xs font-black transition-all whitespace-nowrap ${reportTab === 'rejected' ? 'bg-red-600 text-white shadow-md' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                    >
                      REJECTED
                    </button>
                    <button
                      onClick={() => setReportTab('cancelled')}
                      className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-[10px] sm:text-xs font-black transition-all whitespace-nowrap ${reportTab === 'cancelled' ? 'bg-slate-600 text-white shadow-md' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
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
                          <thead><tr className="bg-gray-50 border-y border-gray-100"><th className="p-3 font-bold text-gray-500 uppercase">Student Name</th><th className="p-3 font-bold text-gray-500 uppercase">Grade / GPA</th><th className="p-3 font-bold text-gray-500 uppercase">Financial</th><th className="p-3 font-bold text-gray-500 uppercase">Contact & Address</th></tr></thead>
                          <tbody className="divide-y divide-gray-100">
                            {filteredPending.map((a) => (
                              <tr key={a.id || a.applicant_no || a.name} className="hover:bg-gray-50"><td className="p-3 font-bold text-gray-800">{a.name}</td><td className="p-3 font-semibold">{formatGpaDisplay(a.grade || a.overall_gpa || a.gpa, a.school)}</td><td className="p-3">{getFinancialStatusLabel(a.income || a.financial_income_of_parents || a.family?.grossIncome)}</td><td className="p-3">{a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'} - {getApplicantAddressDisplay(a)}</td></tr>
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
                          <thead><tr className="bg-gray-50 border-y border-gray-100"><th className="p-3 font-bold text-gray-500 uppercase">Student Name</th><th className="p-3 font-bold text-gray-500 uppercase">Grade / GPA</th><th className="p-3 font-bold text-gray-500 uppercase">Financial</th><th className="p-3 font-bold text-gray-500 uppercase">Contact & Address</th></tr></thead>
                          <tbody className="divide-y divide-gray-100">
                            {filteredAccepted.map((a) => (
                              <tr key={a.id || a.applicant_no || a.name} className="hover:bg-gray-50"><td className="p-3 font-bold text-gray-800">{a.name}</td><td className="p-3 font-semibold">{formatGpaDisplay(a.grade || a.overall_gpa || a.gpa, a.school)}</td><td className="p-3">{getFinancialStatusLabel(a.income || a.financial_income_of_parents || a.family?.grossIncome)}</td><td className="p-3">{a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'} - {getApplicantAddressDisplay(a)}</td></tr>
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
                          <thead><tr className="bg-gray-50 border-y border-gray-100"><th className="p-3 font-bold text-gray-500 uppercase">Student Name</th><th className="p-3 font-bold text-gray-500 uppercase">Grade / GPA</th><th className="p-3 font-bold text-gray-500 uppercase">Financial</th><th className="p-3 font-bold text-gray-500 uppercase">Contact & Address</th></tr></thead>
                          <tbody className="divide-y divide-gray-100">
                            {filteredRejected.map((a) => (
                              <tr key={a.id || a.applicant_no || a.name} className="hover:bg-gray-50"><td className="p-3 font-bold text-gray-800">{a.name}</td><td className="p-3 font-semibold">{formatGpaDisplay(a.grade || a.overall_gpa || a.gpa, a.school)}</td><td className="p-3">{getFinancialStatusLabel(a.income || a.financial_income_of_parents || a.family?.grossIncome)}</td><td className="p-3">{a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'} - {getApplicantAddressDisplay(a)}</td></tr>
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
                      <td className="border p-2">{formatGpaDisplay(a.grade || a.overall_gpa || a.gpa, a.school)}</td>
                      <td className="border p-2">{getFinancialStatusLabel(a.income || a.financial_income_of_parents || a.family?.grossIncome)}</td>
                      <td className="border p-2">{a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'} - {getApplicantAddressDisplay(a)}</td>
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
                    <th className="border p-2 text-left">Grade / GPA</th>
                    <th className="border p-2 text-left">Financial Status</th>
                    <th className="border p-2 text-left">Contact & Address</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAccepted.map((a) => (
                    <tr key={a.id || a.applicant_no || a.name}>
                      <td className="border p-2 font-bold">{a.name}</td>
                      <td className="border p-2">{formatGpaDisplay(a.grade || a.overall_gpa || a.gpa, a.school)}</td>
                      <td className="border p-2">{getFinancialStatusLabel(a.income || a.financial_income_of_parents || a.family?.grossIncome)}</td>
                      <td className="border p-2">{a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'} - {getApplicantAddressDisplay(a)}</td>
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
                    <th className="border p-2 text-left">Grade / GPA</th>
                    <th className="border p-2 text-left">Financial Status</th>
                    <th className="border p-2 text-left">Contact & Address</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRejected.concat(filteredCancelled).map((a) => (
                    <tr key={a.id || a.applicant_no || a.name}>
                      <td className="border p-2 font-bold">{a.name}</td>
                      <td className="border p-2">{formatGpaDisplay(a.grade || a.overall_gpa || a.gpa, a.school)}</td>
                      <td className="border p-2">{getFinancialStatusLabel(a.income || a.financial_income_of_parents || a.family?.grossIncome)}</td>
                      <td className="border p-2">{a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'} - {getApplicantAddressDisplay(a)}</td>
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
    const docTypes = getApplicantDocTypes(a);
    const meritDetails = calculateDeservednessScoreDetails(a, getScholarshipForApplicant(a));
    const aiMeritReason = a.meritReason || meritDetails.reason || (a.meritsAwardsReceived ? 'Evaluated based on academic merits.' : 'No evaluated achievements.');
    const aiMeritScore = a.meritScore ?? meritDetails.meritScore ?? 0;

    // Ensure idFiles contains Front & Back ID videos alongside ID images
    const idFiles = [...(a.idFiles || [])];
    const frontVid = a.schoolid_front_vid_url || a.id_vid_url || a.schoolIdFront_video;
    if (frontVid && !idFiles.some(f => f.src === frontVid || f.name?.includes('Front Video') || f.name?.includes('ID Video'))) {
      const frontImgIdx = idFiles.findIndex(f => f.name?.includes('Front') || f.name?.includes('ID Front'));
      const insertIdx = frontImgIdx !== -1 ? frontImgIdx + 1 : 1;
      idFiles.splice(insertIdx, 0, { src: frontVid, type: 'video/mp4', name: 'ID Front Video' });
    }
    const backVid = a.schoolid_back_vid_url || a.schoolIdBack_video;
    if (backVid && !idFiles.some(f => f.src === backVid || f.name?.includes('Back Video'))) {
      const backImgIdx = idFiles.findIndex(f => f.name?.includes('Back') || f.name?.includes('ID Back'));
      const insertIdx = backImgIdx !== -1 ? backImgIdx + 1 : idFiles.length;
      idFiles.splice(insertIdx, 0, { src: backVid, type: 'video/mp4', name: 'ID Back Video' });
    }

    // Extract and normalize merit document files from 1NF merit_proofs table or a.meritFiles
    const meritFiles = (a.meritFiles && a.meritFiles.length > 0)
      ? a.meritFiles
      : (a.merit_proofs || []).map((mp, idx) => ({
        src: mp.merit_document,
        type: 'image/jpeg',
        name: mp.merit_title || `Merit Document #${idx + 1}`,
        title: mp.merit_title || `Merit Document #${idx + 1}`,
        id: mp.merit_id
      })).filter(f => Boolean(f.src));

    // Preload document images when applicant dossier opens so photos appear immediately
    if (a) {
      const imageMediaUrls = [
        a.profile_picture,
        a.signature,
        ...(a.coeFiles || []).filter(f => f.type && f.type.startsWith('image')).map(f => f.src),
        ...(a.indigencyFiles || []).filter(f => f.type && f.type.startsWith('image')).map(f => f.src),
        ...(a.gradesFiles || []).filter(f => f.type && f.type.startsWith('image')).map(f => f.src),
        ...idFiles.filter(f => f.type && f.type.startsWith('image')).map(f => f.src),
        ...meritFiles.filter(f => f.type && f.type.startsWith('image')).map(f => f.src),
      ].filter(Boolean);

      preloadMediaUrls(imageMediaUrls, 'image/jpeg');
    }

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
          {files.map((f, idx) => {
            const isVideo = Boolean(
              (f.type && f.type.startsWith('video')) ||
              (typeof f.src === 'string' && (f.src.includes('.mp4') || f.src.includes('.webm') || f.src.includes('.mov') || f.src.includes('/video/')))
            );

            return (
              <div
                key={idx}
                className="relative group cursor-pointer border-2 border-gray-200 hover:border-[#800020] rounded-xl overflow-hidden shadow-xs hover:shadow-md transition-all bg-gray-900 flex flex-col items-center justify-center min-h-[112px]"
                onClick={() => setImageModalSrc({ src: f.src, type: f.type || (isVideo ? 'video/mp4' : 'image/jpeg') })}
              >
                {isVideo ? (
                  <div className="w-full h-28 bg-gradient-to-br from-gray-900 via-gray-800 to-black flex flex-col items-center justify-center p-2 relative group-hover:scale-105 transition-transform select-none">
                    <div className="w-11 h-11 rounded-full bg-[#800020] text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform border-2 border-white/60 mb-1">
                      <FaPlay className="text-sm ml-0.5 text-white" />
                    </div>
                    <span className="text-[10px] text-gray-200 font-bold tracking-tight text-center truncate max-w-[90%]">
                      {f.name || 'Click to Play Video'}
                    </span>
                    <div className="absolute top-1.5 right-1.5 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded font-black tracking-wider uppercase">
                      VIDEO
                    </div>
                  </div>
                ) : (
                  <>
                    <DecryptedMedia
                      src={f.src}
                      type={f.type || 'image/jpeg'}
                      className="w-full h-28 object-contain bg-gray-100 group-hover:scale-105 transition-transform pointer-events-none"
                      controls={false}
                    />
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] py-0.5 text-center font-bold pointer-events-none">
                      IMAGE
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      );
    };

    return (
      <section className="relative bg-white rounded-xl sm:rounded-2xl shadow-sm border border-gray-100 p-3 sm:p-6 lg:p-8 max-w-5xl mx-auto my-2 sm:my-4 overflow-y-auto max-h-[90vh] animate-in fade-in duration-300">
        {/* Close button — always top-right */}
        <button
          onClick={() => { setViewApplicant(null); setSection('track'); }}
          className="absolute top-3 right-3 p-1.5 hover:bg-gray-100 rounded-lg transition-colors z-10"
          aria-label="Close"
        >
          <FaTimesCircle className="text-gray-400 text-xl" />
        </button>
        <div className="flex flex-col gap-4 mb-5 sm:mb-8 pb-4 sm:pb-6 border-b-2 border-[#800020]">
          <div className="flex flex-row items-start gap-3 sm:gap-6">
            <div className="w-14 h-14 sm:w-20 sm:h-20 rounded-xl sm:rounded-2xl bg-gray-50 border-2 border-gray-100 p-0.5 shadow-sm overflow-hidden flex-shrink-0">
              {a.profile_picture ? (
                <DecryptedMedia src={a.profile_picture} type="image/jpeg" className="w-full h-full object-cover rounded-lg sm:rounded-xl" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gray-200 text-gray-400">
                  <FaUsers className="text-xl sm:text-2xl" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg sm:text-2xl font-black text-[#800020] uppercase tracking-tight flex items-center gap-2 mb-1 break-words">
                {a.name || `${a.firstName} ${a.lastName}`}
                {getApplicantProcessingState(a) && <FaSpinner className="animate-spin text-sm flex-shrink-0" />}
              </h2>
              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                <span className="bg-[#800020] text-white px-2.5 py-0.5 rounded-lg text-[9px] sm:text-xs font-black font-mono shadow-sm tracking-widest">APPLICANT ID: {a.applicant_no || 'N/A'}</span>
              </div>
              <div className="text-[10px] text-gray-400 font-semibold">School ID: {a.school_id_no || 'N/A'}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`flex items-center justify-center px-3 py-1.5 rounded-full text-xs font-bold uppercase ${listType === 'accepted' ? 'bg-green-100 text-green-700' :
              listType === 'rejected' ? 'bg-red-100 text-red-700' :
                listType === 'cancelled' ? 'bg-gray-100 text-gray-700' :
                  'bg-yellow-100 text-yellow-700'
              }`}>
              {listType === 'accepted' ? 'Accepted' :
                listType === 'rejected' ? 'Rejected' :
                  listType === 'cancelled' ? 'Cancelled' :
                    'Pending Review'}
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => handleSendSchoolVerification(a)}
                disabled={schoolVerifSent[dispatchKey]}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] sm:text-xs font-bold transition-all shadow-sm ${schoolVerifSent[dispatchKey] ? 'bg-green-100 text-green-700 cursor-default' : 'bg-[#800020] text-white hover:bg-[#650018]'}`}
              >
                <FaPaperPlane className="flex-shrink-0" /> <span className="hidden sm:inline">{schoolVerifSent[dispatchKey] ? 'School Dispatch Sent' : 'Send for School Verification'}</span><span className="sm:hidden">{schoolVerifSent[dispatchKey] ? 'Sent' : 'School Verif'}</span>
              </button>
              <button
                type="button"
                onClick={() => handleSendIndigencyVerification(a)}
                disabled={indigencyVerifSent[dispatchKey]}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] sm:text-xs font-bold transition-all shadow-sm ${indigencyVerifSent[dispatchKey] ? 'bg-green-100 text-green-700 cursor-default' : 'bg-[#800020] text-white hover:bg-[#650018]'}`}
              >
                <FaPaperPlane className="flex-shrink-0" /> <span className="hidden sm:inline">{indigencyVerifSent[dispatchKey] ? 'City Hall Dispatch Sent' : `Verify ${docTypes.residencyLabel} (City Hall)`}</span><span className="sm:hidden">{indigencyVerifSent[dispatchKey] ? 'Sent' : docTypes.residencyLabel}</span>
              </button>
            </div>
          </div>
        </div>

        {/* STUDENT INFORMATION SECTION */}
        <div className="mb-8">
          <h3 className="bg-[#800020] text-white px-3 sm:px-4 py-2 text-xs sm:text-sm font-black uppercase tracking-widest mb-0 rounded-t-lg">Student Information</h3>
          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 border-2 border-gray-100 rounded-b-lg overflow-hidden">
            <div className="p-2.5 sm:p-3 border-b border-r border-gray-100 bg-gray-50/50">
              <p className="text-[9px] sm:text-[10px] font-black text-gray-400 uppercase mb-1">Last Name</p>
              <p className="font-bold text-gray-800 text-xs sm:text-sm break-words">{a.lastName || (a.name && a.name.split(' ').pop())}</p>
            </div>
            <div className="p-2.5 sm:p-3 border-b border-r border-gray-100 bg-gray-50/50">
              <p className="text-[9px] sm:text-[10px] font-black text-gray-400 uppercase mb-1">First Name</p>
              <p className="font-bold text-gray-800 text-xs sm:text-sm break-words">{a.firstName || (a.name && a.name.split(' ')[0])}</p>
            </div>
            <div className="p-2.5 sm:p-3 border-b border-r border-gray-100 bg-gray-50/50">
              <p className="text-[9px] sm:text-[10px] font-black text-gray-400 uppercase mb-1">Middle Name</p>
              <p className="font-bold text-gray-800 text-xs sm:text-sm">{a.middleName || 'N/A'}</p>
            </div>
            <div className="p-2.5 sm:p-3 border-b border-gray-100 bg-gray-50/50">
              <p className="text-[9px] sm:text-[10px] font-black text-gray-400 uppercase mb-1">Maiden Name</p>
              <p className="font-bold text-gray-800 text-xs sm:text-sm">{a.maidenName || 'N/A'}</p>
            </div>

            <div className="p-2.5 sm:p-3 border-b border-r border-gray-100">
              <p className="text-[9px] sm:text-[10px] font-black text-gray-400 uppercase mb-1">Street &amp; Barangay</p>
              <p className="font-bold text-gray-800 text-xs sm:text-sm break-words">{a.streetBrgy || a.street_brgy || (a.location && a.location.split(',')[0]) || 'N/A'}</p>
            </div>
            <div className="p-2.5 sm:p-3 border-b border-r border-gray-100">
              <p className="text-[9px] sm:text-[10px] font-black text-gray-400 uppercase mb-1">Town/City/Municipality</p>
              <p className="font-bold text-gray-800 text-xs sm:text-sm">{a.municipality || a.town_city_municipality || 'N/A'}</p>
            </div>
            <div className="p-2.5 sm:p-3 border-b border-r border-gray-100">
              <p className="text-[9px] sm:text-[10px] font-black text-gray-400 uppercase mb-1">Province</p>
              <p className="font-bold text-gray-800 text-xs sm:text-sm">{a.province || 'N/A'}</p>
            </div>
            <div className="p-2.5 sm:p-3 border-b border-gray-100">
              <p className="text-[9px] sm:text-[10px] font-black text-gray-400 uppercase mb-1">Zip Code</p>
              <p className="font-bold text-gray-800 text-xs sm:text-sm">{a.zipCode || a.zip_code || 'N/A'}</p>
            </div>

            <div className="p-2.5 sm:p-3 border-b border-r border-gray-100">
              <p className="text-[9px] sm:text-[10px] font-black text-gray-400 uppercase mb-1">Date of Birth</p>
              <p className="font-bold text-gray-800 text-xs sm:text-sm">{a.dob || 'N/A'}</p>
            </div>
            <div className="p-2.5 sm:p-3 border-b border-r border-gray-100">
              <p className="text-[9px] sm:text-[10px] font-black text-gray-400 uppercase mb-1">Place of Birth</p>
              <p className="font-bold text-gray-800 text-xs sm:text-sm">{a.pob || 'N/A'}</p>
            </div>
            <div className="p-2.5 sm:p-3 border-b border-r border-gray-100">
              <p className="text-[9px] sm:text-[10px] font-black text-gray-400 uppercase mb-1">Sex</p>
              <p className="font-bold text-gray-800 text-xs sm:text-sm">{a.sex || 'N/A'}</p>
            </div>
            <div className="p-2.5 sm:p-3 border-b border-gray-100">
              <p className="text-[9px] sm:text-[10px] font-black text-gray-400 uppercase mb-1">Citizenship</p>
              <p className="font-bold text-gray-800 text-xs sm:text-sm">{a.citizenship || 'Filipino'}</p>
            </div>

            <div className="p-2.5 sm:p-3 border-b border-r border-gray-100 col-span-2">
              <p className="text-[9px] sm:text-[10px] font-black text-gray-400 uppercase mb-1">E-mail Address</p>
              <p className="font-bold text-gray-800 truncate text-xs sm:text-sm">{a.emailAddress || a.email || (a.studentContact && a.studentContact.email) || 'N/A'}</p>
            </div>
            <div className="p-2.5 sm:p-3 border-b border-r border-gray-100">
              <p className="text-[9px] sm:text-[10px] font-black text-gray-400 uppercase mb-1">Mobile Number</p>
              <p className="font-bold text-gray-800 text-xs sm:text-sm">{a.mobileNumber || a.phone || (a.studentContact && a.studentContact.phone) || 'N/A'}</p>
            </div>
            <div className="p-2.5 sm:p-3 border-b border-gray-100">
              <p className="text-[9px] sm:text-[10px] font-black text-gray-400 uppercase mb-1">Course</p>
              <p className="font-bold text-gray-800 text-xs sm:text-sm">{a.course || 'N/A'}</p>
            </div>

            <div className="p-2.5 sm:p-3 border-b border-r border-gray-100 col-span-2">
              <p className="text-[9px] sm:text-[10px] font-black text-gray-400 uppercase mb-1">School Attended</p>
              <p className="font-bold text-gray-800 text-xs sm:text-sm">{a.school || 'N/A'}</p>
            </div>
            <div className="p-2.5 sm:p-3 border-b border-gray-100 col-span-2">
              <p className="text-[9px] sm:text-[10px] font-black text-gray-400 uppercase mb-1">School Location</p>
              <p className="font-bold text-gray-800 text-xs sm:text-sm">{a.schoolAddress || 'N/A'}</p>
            </div>
            <div className="p-2.5 sm:p-3 border-b border-r border-gray-100">
              <p className="text-[9px] sm:text-[10px] font-black text-gray-400 uppercase mb-1">School ID Number</p>
              <p className="font-bold text-gray-800 text-xs sm:text-sm">{a.school_id_no || 'N/A'}</p>
            </div>
            <div className="p-2.5 sm:p-3 border-b border-gray-100">
              <p className="text-[9px] sm:text-[10px] font-black text-gray-400 uppercase mb-1">Year Level</p>
              <p className="font-bold text-gray-800 text-xs sm:text-sm">{a.year || 'N/A'}</p>
            </div>

            <div className="p-2.5 sm:p-3 border-b border-r border-gray-100 col-span-2 md:col-span-2">
              <p className="text-[9px] sm:text-[10px] font-black text-gray-400 uppercase mb-1">School Sector</p>
              <p className="font-bold text-gray-800 text-xs sm:text-sm">{a.schoolSector || 'N/A'}</p>
            </div>

            <div className="p-2.5 sm:p-3 col-span-2 md:col-span-4 border-b border-gray-100 bg-gray-50/20">
              <p className="text-[9px] sm:text-[10px] font-black text-gray-400 uppercase mb-1">Merits/Awards</p>
              <p className="font-bold text-gray-800 whitespace-pre-wrap text-xs sm:text-sm">{a.meritsAwardsReceived || 'N/A'}</p>

              {/* MERIT PROOF CERTIFICATE IMAGES DISPLAYED RIGHT BELOW MERITS/AWARDS */}
              {meritFiles && meritFiles.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-200/80">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-[10px] sm:text-xs font-black text-[#800020] uppercase tracking-wider flex items-center gap-1.5">
                      <FaAward className="text-[#800020] text-xs sm:text-sm" /> Attached Merit Document{meritFiles.length > 1 ? 's' : ''} ({meritFiles.length})
                    </p>
                    <span className="text-[9px] sm:text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full border border-gray-200">
                      Click image to enlarge
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {meritFiles.map((file, mIdx) => (
                      <div
                        key={mIdx}
                        className="group relative border-2 border-gray-200 hover:border-[#800020] rounded-xl overflow-hidden bg-white shadow-xs hover:shadow-md transition-all cursor-pointer flex flex-col"
                        onClick={() => setImageModalSrc({ src: file.src, type: file.type || 'image/jpeg' })}
                      >
                        <div className="relative h-28 sm:h-32 bg-gray-900 flex items-center justify-center overflow-hidden">
                          <DecryptedMedia
                            src={file.src}
                            type={file.type || 'image/jpeg'}
                            className="w-full h-full object-contain group-hover:scale-105 transition-transform pointer-events-none"
                            alt={file.title || `Merit Document #${mIdx + 1}`}
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-bold gap-1 pointer-events-none">
                            <FaSearchPlus /> View Certificate
                          </div>
                        </div>
                        <div className="p-2 bg-gray-50 border-t border-gray-100 flex flex-col gap-0.5">
                          <p className="text-[10px] sm:text-xs font-bold text-gray-800 truncate" title={file.title || `Merit Proof #${mIdx + 1}`}>
                            {file.title || `Merit Proof #${mIdx + 1}`}
                          </p>
                          <span className="text-[9px] text-emerald-700 font-semibold flex items-center gap-1">
                            <FaCheckCircle className="text-[8px]" /> Proof of Award
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-3 p-3 rounded-xl bg-gradient-to-r from-amber-50/80 to-orange-50/40 border border-amber-200/80 shadow-xs">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <FaRobot className="text-amber-600 text-xs sm:text-sm" />
                    <span className="text-[10px] sm:text-xs font-black text-amber-900 uppercase tracking-wider">
                      Score Explanation for Merits / Awards
                    </span>
                  </div>
                  <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 text-[10px] sm:text-xs px-2.5 py-0.5 rounded-full font-bold border border-amber-300 shadow-xs">
                    <FaStar className="text-amber-500 text-[10px]" /> {aiMeritScore} / 20 pts
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-amber-950 font-medium leading-relaxed pl-5 sm:pl-6">
                  {aiMeritReason}
                </p>
              </div>
            </div>

          </div>
        </div>

        {/* FACE VERIFICATION PHOTO SECTION */}
        <div className="mb-10">
          <h3 className="bg-[#800020] text-white px-4 py-2 text-sm font-black uppercase tracking-widest mb-4 rounded-t-lg">Face Verification Photo</h3>
          <div className="p-6 border-2 border-gray-100 rounded-b-lg bg-gray-50/50 flex flex-col items-center justify-center">
            {a.id_pic ? (
              <div className="flex flex-col items-center gap-3">
                <div
                  className="relative group max-w-xs overflow-hidden rounded-xl border-2 border-[#800020] shadow-md bg-white cursor-pointer"
                  onClick={() => setImageModalSrc(a.id_pic)}
                >
                  <DecryptedMedia
                    src={a.id_pic || a.face_photo || a.facePhoto || a.idPic}
                    alt="Face Verification Capture"
                    type="image/jpeg"
                    className="w-48 h-56 object-cover rounded-lg transition-transform duration-300 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-bold gap-1 pointer-events-none">
                    <i className="fas fa-search-plus"></i> View Image
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 bg-emerald-100 text-emerald-800 text-xs px-3 py-1 rounded-full font-bold border border-emerald-200">
                  <i className="fas fa-user-check text-emerald-600"></i> Verified Step 4 Selfie
                </span>
              </div>
            ) : (
              <div className="text-center p-4 text-gray-400">
                <i className="fas fa-user-slash text-3xl mb-2 text-gray-300"></i>
                <p className="text-xs font-semibold">No face verification photo recorded for this applicant</p>
              </div>
            )}
          </div>
        </div>

        {/* FAMILY BACKGROUND SECTION */}
        <div className="mb-8">
          <h3 className="bg-[#800020] text-white px-3 sm:px-4 py-2 text-xs sm:text-sm font-black uppercase tracking-widest mb-0 rounded-t-lg">Family Background</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 border-2 border-gray-100 rounded-b-lg overflow-hidden">
            <div className="p-3 sm:p-4 border-b sm:border-b-0 sm:border-r border-gray-100 bg-gray-50/50">
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
            <div className="p-3 sm:p-4 bg-gray-50/50">
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
            <div className="p-3 sm:p-4 border-t border-gray-100 sm:border-r">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Parents Gross Income</p>
              <p className="font-bold text-[#800020] text-sm sm:text-base">PHP {familyData.grossIncome}</p>
            </div>
            <div className="p-3 sm:p-4 border-t border-gray-100">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">No. of Siblings</p>
              <p className="font-bold text-gray-800">{familyData.siblingsCount}</p>
            </div>
          </div>
        </div>

        {/* DOCUMENTS SECTION */}
        <div className="mb-8">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="bg-[#800020] text-white px-3 sm:px-4 py-2 text-xs sm:text-sm font-black uppercase tracking-widest rounded-lg">Uploaded Documents</h3>
            <div className="flex gap-1.5 sm:gap-3 flex-wrap">
              <div className="bg-yellow-50 border border-yellow-200 px-2 sm:px-3 py-1 rounded-full flex items-center gap-1.5">
                <span className="text-[9px] sm:text-[10px] font-black text-[#800020] uppercase">Avg Grade:</span>
                <span className="text-xs sm:text-sm font-black text-gray-800" title={a.grade ? `Original GPA: ${a.grade}` : ''}>
                  {formatGpaDisplay(a.grade || a.overall_gpa || a.gpa, a.school)}
                </span>
              </div>
              <div className="bg-rose-50 border border-rose-200 px-2 sm:px-3 py-1 rounded-full flex items-center gap-1.5">
                <span className="text-[9px] sm:text-[10px] font-black text-[#800020] uppercase">Income:</span>
                <span className="text-xs sm:text-sm font-black text-gray-800">
                  {getFinancialStatusLabel(a.income || a.financial_income_of_parents || a.family?.grossIncome)}
                </span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-6 p-3 sm:p-6 border-2 border-gray-100 rounded-lg">
            <div className="space-y-2">
              <p className="text-[10px] font-black text-gray-500 uppercase flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#800020]"></span> {docTypes.residencyFullLabel}
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
                <span className="w-1.5 h-1.5 rounded-full bg-[#800020]"></span> {docTypes.idLabel}
              </p>
              <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
                {renderMediaGrid(idFiles)}
              </div>
            </div>
            {meritFiles && meritFiles.length > 0 && (
              <div className="space-y-2 sm:col-span-2">
                <p className="text-[10px] font-black text-gray-500 uppercase flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#800020]"></span> Merit / Award Certificates ({meritFiles.length})
                </p>
                <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
                  {renderMediaGrid(meritFiles)}
                </div>
              </div>
            )}
          </div>
        </div>


        {/* SIGNATURE SECTION */}
        <div className="mt-8 sm:mt-12 pt-6 sm:pt-8 border-t-2 border-dashed border-gray-200">
          <div className="flex flex-col sm:flex-row items-stretch justify-between gap-4 sm:gap-8">
            {/* Signature box */}
            <div className="flex-1 flex flex-col text-center sm:text-left">
              <div className="border-b-2 border-gray-300 mb-2 h-20 flex items-end justify-center overflow-hidden pb-1">
                {(a.signature || a.signature_image_data || a.signatureUrl) ? (
                  <DecryptedMedia
                    src={a.signature || a.signature_image_data || a.signatureUrl}
                    type="image/png"
                    className="max-h-full cursor-zoom-in hover:scale-110 transition-transform"
                    onClick={() => setImageModalSrc(a.signature || a.signature_image_data || a.signatureUrl)}
                  />
                ) : (
                  <span className="text-gray-300 italic text-sm pb-1">No signature on file</span>
                )}
              </div>
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Signature over Printed Name of Applicant</p>
              <p className="font-bold text-gray-800 text-sm italic underline">{a.firstName} {a.lastName}</p>
            </div>

            {/* Date box */}
            <div className="flex-1 flex flex-col text-center sm:text-left">
              <div className="border-b-2 border-gray-300 mb-2 h-20 flex items-end justify-center pb-2">
                <p className="font-bold text-gray-800 text-base">{(() => {
                  const rawDate = a.status_created_at || a.created_at || a.dateApplied || a.createdAt;
                  if (rawDate) {
                    const parsed = new Date(rawDate);
                    if (!isNaN(parsed.getTime())) {
                      return parsed.toLocaleDateString();
                    }
                  }
                  return '—';
                })()}</p>
              </div>
              <p className="text-[10px] font-black text-gray-400 uppercase">Date Accomplished</p>
            </div>
          </div>
          <p className="text-center text-[10px] text-gray-400 italic mt-6 sm:mt-8 font-medium">
            I hereby certify that the foregoing statements are true and correct.
          </p>
        </div>

        <div className="sticky bottom-0 bg-white/95 backdrop-blur-md pt-4 sm:pt-6 mt-6 sm:mt-8 border-t border-gray-100 flex flex-col sm:flex-row gap-2.5 sm:gap-3 justify-end">
          {isPending && (
            <>
              <button
                type="button"
                onClick={acceptApplicant}
                disabled={Boolean(getApplicantProcessingState(a))}
                className="w-full sm:w-auto px-6 py-2.5 sm:px-8 sm:py-3 rounded-xl bg-green-600 text-white font-black uppercase tracking-widest text-xs hover:bg-green-700 shadow-lg shadow-green-100 transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:bg-green-300 disabled:shadow-none"
              >
                <FaCheckCircle /> Approve
              </button>
              <button
                type="button"
                onClick={declineApplicant}
                disabled={Boolean(getApplicantProcessingState(a))}
                className="w-full sm:w-auto px-6 py-2.5 sm:px-8 sm:py-3 rounded-xl bg-red-600 text-white font-black uppercase tracking-widest text-xs hover:bg-red-700 shadow-lg shadow-red-100 transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:bg-red-300 disabled:shadow-none"
              >
                <FaTimesCircle /> Decline
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => { setViewApplicant(null); setSection('track'); }}
            className="w-full sm:w-auto px-6 py-2.5 sm:px-8 sm:py-3 rounded-xl bg-gray-100 text-gray-600 font-black uppercase tracking-widest text-xs hover:bg-gray-200 transition-all text-center"
          >
            Close Dossier
          </button>
        </div>
      </section>
    );
  };


  const renderInbox = () => (
    <div className="flex-1 flex flex-col min-h-0 h-full overflow-hidden bg-gradient-to-br from-gray-50 to-blue-50/30 animate-in fade-in duration-300">
      <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-3 flex-shrink-0">
        {!isSuperAdminUser && (
          <button
            type="button"
            onClick={() => {
              setInboxMode('applicants');
              setViewMessage(null);
            }}
            className={`px-3 py-2 sm:px-5 sm:py-2.5 rounded-xl sm:rounded-2xl text-xs sm:text-sm font-extrabold transition-all flex items-center gap-1.5 sm:gap-2.5 ${inboxMode === 'applicants'
              ? 'bg-[#800020] text-white shadow-lg shadow-rose-900/20 ring-2 ring-[#800020]/30'
              : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-100 shadow-sm'
              }`}
          >
            <FaUsers className="text-xs sm:text-sm" /> <span>Applicant Messages</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setInboxMode('admin_rooms');
            setViewMessage(null);
          }}
          className={`px-3 py-2 sm:px-5 sm:py-2.5 rounded-xl sm:rounded-2xl text-xs sm:text-sm font-extrabold transition-all flex items-center gap-1.5 sm:gap-2.5 ${inboxMode === 'admin_rooms'
            ? 'bg-[#800020] text-white shadow-lg shadow-rose-900/20 ring-2 ring-[#800020]/30'
            : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-100 shadow-sm'
            }`}
        >
          <FaInbox className="text-xs sm:text-sm" /> <span>Super Admin Chat</span>
        </button>
      </div>

      <div className="flex-1 flex flex-col md:flex-row gap-3 sm:gap-4 overflow-hidden min-h-0 h-full">
        <div className={`w-full md:w-80 flex-shrink-0 bg-white rounded-xl sm:rounded-2xl shadow-sm border border-gray-100 flex flex-col min-h-0 h-full overflow-hidden ${selectedConversation ? 'hidden md:flex' : 'flex'}`}>
          {inboxMode === 'applicants' ? (
            <div className="p-3 sm:p-4 border-b border-gray-100 bg-white flex-shrink-0">
              <div className="flex items-center gap-2 mb-2 sm:mb-3">
                <FaSearch className="text-gray-400 flex-shrink-0" />
                <input
                  type="text"
                  placeholder="Search conversations..."
                  value={inboxSearch}
                  onChange={(e) => setInboxSearch(e.target.value)}
                  className="flex-1 px-3 py-1.5 sm:py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#800020] text-xs sm:text-sm"
                />
              </div>
              <div className="flex gap-1.5 sm:gap-2">
                <button
                  onClick={() => setInboxFilter('all')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${inboxFilter === 'all' ? 'bg-[#800020] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                >
                  All
                </button>
                <button
                  onClick={() => setInboxFilter('pending')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${inboxFilter === 'pending' ? 'bg-yellow-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                >
                  Pending
                </button>
                <button
                  onClick={() => setInboxFilter('accepted')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${inboxFilter === 'accepted' ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                >
                  Accepted
                </button>
              </div>
            </div>
          ) : (
            <div className="p-3 sm:p-4 border-b border-gray-100 bg-gray-50/80 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[#800020] text-white flex items-center justify-center font-bold text-xs shadow-sm">
                  <FaInbox />
                </div>
                <div>
                  <h3 className="font-bold text-xs sm:text-sm text-gray-900 uppercase tracking-wider">Official Admin Rooms</h3>
                  <p className="text-[10px] text-gray-400 font-medium">Channel Communications</p>
                </div>
              </div>
              <span className="text-[10px] font-extrabold px-2.5 py-1 rounded-full bg-[#800020]/10 text-[#800020] border border-[#800020]/20">
                {filteredConversations.length} {filteredConversations.length === 1 ? 'Room' : 'Rooms'}
              </span>
            </div>
          )}

          <div className="flex-1 overflow-y-auto min-h-0 h-full custom-scrollbar mobile-touch-scroll overscroll-contain">
            {filteredConversations.length > 0 ? (
              <div className="divide-y divide-gray-100">
                {filteredConversations.map((conv) => {
                  const isActive = currentConversation && (currentConversation.applicant_no?.toString() === conv.applicant_no?.toString() || currentConversation.room === conv.room);
                  const status = getStudentStatus(conv.applicant_no, conv.studentName, conv.lastMessage?.studentStatus);

                  return (
                    <div
                      key={conv.room || conv.applicant_no}
                      onClick={() => {
                        markConversationAsRead(conv.applicant_no, conv.room);
                        currentInboxRoomRef.current = conv.room || null;
                        setViewMessage({
                          messageId: conv.lastMessage?.id || `new-${conv.applicant_no}`,
                          applicant_no: conv.applicant_no,
                          room: conv.room
                        });
                        socketService.loadHistory(conv.room);

                        if (conv.room && messagingAPI) {
                          messagingAPI.getRoomMessages(conv.room).then(res => {
                            if (res.data?.messages && Array.isArray(res.data.messages)) {
                              const readRoomMsgs = res.data.messages.map(m => {
                                if (m.m_id) readMessageIdsRef.current.add(String(m.m_id));
                                if (m.id) readMessageIdsRef.current.add(String(m.id));
                                return {
                                  ...m,
                                  read: true,
                                  room: conv.room
                                };
                              });
                              setData(prev => ({
                                ...prev,
                                inbox: sortMessages([
                                  ...(prev.inbox || []).filter(m => m.room !== conv.room),
                                  ...readRoomMsgs
                                ])
                              }));
                            }
                          }).catch(() => { });
                        }
                      }}
                      className={`p-3 sm:p-4 cursor-pointer transition-colors border-l-4 ${isActive
                        ? 'bg-rose-50/80 border-l-4 border-[#800020] shadow-sm'
                        : `border-l-4 border-transparent hover:bg-gray-50 ${conv.unreadCount > 0 ? 'bg-rose-50/20' : ''}`
                        }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#800020] to-[#650018] flex items-center justify-center text-white font-black flex-shrink-0 text-base shadow-sm border border-white/20">
                          {conv.isAdminRoom ? (
                            <i className={conv.icon || 'fas fa-landmark'}></i>
                          ) : (
                            conv.studentName.charAt(0).toUpperCase()
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-bold text-gray-900 truncate text-xs sm:text-sm">{conv.studentName}</span>
                            {conv.unreadCount > 0 && (
                              <span className="ml-2 px-2 py-0.5 bg-[#800020] text-white text-[10px] sm:text-xs font-bold rounded-full flex-shrink-0">
                                {conv.unreadCount}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-extrabold uppercase flex-shrink-0 ${conv.isAdminRoom
                              ? 'bg-rose-50 text-[#800020] border border-rose-100'
                              : status === 'Accepted'
                                ? 'bg-green-100 text-green-700 border border-green-200'
                                : status === 'Pending'
                                  ? 'bg-yellow-100 text-yellow-700 border border-yellow-200'
                                  : 'bg-gray-100 text-gray-700 border border-gray-200'
                              }`}>
                              {conv.isAdminRoom ? conv.badge : status}
                            </span>
                            <p className="text-xs text-gray-600 truncate flex-1">{conv.lastMessage?.message || ''}</p>
                          </div>
                          {!conv.isAdminRoom && conv.lastMessage?.timestamp && conv.lastMessage.timestamp !== new Date(0).toISOString() && (
                            <span className="text-[10px] sm:text-xs text-gray-400 mt-1 block">{formatDate(conv.lastMessage.timestamp)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 px-6">
                <FaInbox className="text-4xl text-gray-300 mb-3" />
                <p className="text-gray-500 text-sm text-center">No conversations found</p>
              </div>
            )}
          </div>
        </div>

        <div className={`flex-1 bg-white rounded-xl sm:rounded-2xl shadow-sm border border-gray-100 flex flex-col min-h-0 h-full overflow-hidden ${selectedConversation ? 'flex' : 'hidden md:flex'}`}>
          {currentConversation ? (
            <>
              <div className="p-3 sm:p-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between gap-3 flex-shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    type="button"
                    onClick={() => setViewMessage(null)}
                    className="md:hidden p-1.5 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold text-xs flex-shrink-0"
                  >
                    ← Back
                  </button>
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#800020] to-[#650018] flex items-center justify-center text-white font-black flex-shrink-0 text-base shadow-sm border border-white/20">
                    {currentConversation.isAdminRoom ? (
                      <i className={currentConversation.icon || 'fas fa-landmark'}></i>
                    ) : (
                      currentConversation.studentName.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-gray-900 truncate text-xs sm:text-sm">{currentConversation.studentName}</h3>
                    <p className="text-[11px] sm:text-xs text-gray-500 truncate">
                      {currentConversation.isAdminRoom
                        ? 'Official Admin Communication Channel'
                        : (currentConversation.studentEmail || `Status: ${getStudentStatus(currentConversation.applicant_no, currentConversation.studentName)}`)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-3 sm:space-y-4 bg-white min-h-0 h-full custom-scrollbar mobile-touch-scroll overscroll-contain">
                {currentConversationMessages.length > 0 ? (
                  currentConversationMessages.map((msg) => {
                    let isFromMe = false;
                    if (msg.sender_id && currentUserId) {
                      isFromMe = String(msg.sender_id) === String(currentUserId);
                    } else {
                      const normMsgSender = normalizeProviderIdentity(msg.username || msg.studentName || '');
                      const normMyName = normalizeProviderIdentity(userName);
                      const normMyFirstName = normalizeProviderIdentity(userFirstName);

                      if (normMsgSender && (normMsgSender === normMyName || normMsgSender === normMyFirstName)) {
                        isFromMe = true;
                      } else if (msg.is_student_sender === true) {
                        isFromMe = false;
                      } else if (msg.is_student_sender === false && currentConversation?.applicant_no) {
                        isFromMe = true;
                      }
                    }

                    return (
                      <div key={msg.id} className={`flex ${isFromMe ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[90%] sm:max-w-[80%] rounded-2xl p-3 sm:p-4 shadow-sm border ${isFromMe
                          ? 'bg-[#800020] text-white border-[#800020]'
                          : 'bg-gray-50 text-gray-900 border-gray-200'
                          }`}>
                          <div className="flex items-center justify-between mb-1.5 sm:mb-2 gap-4">
                            <span className={`font-semibold text-[11px] sm:text-xs ${isFromMe ? 'text-white/90' : 'text-[#800020]'}`}>
                              {isFromMe ? 'Me' : (msg.studentName || msg.username || 'Applicant')}
                            </span>
                            <span className={`text-[9px] sm:text-[10px] flex items-center gap-1 ${isFromMe ? 'text-white/70' : 'text-gray-500'}`}>
                              <FaClock className="text-[9px]" /> {formatDate(msg.timestamp)}
                            </span>
                          </div>
                          <p className="text-xs sm:text-sm whitespace-pre-wrap leading-relaxed">{msg.message}</p>
                          {!isFromMe && (
                            <div className="mt-1.5 flex items-center justify-end">
                              <button
                                type="button"
                                onClick={() => toggleStar(msg.id)}
                                className={`p-1 rounded-lg transition-colors ${msg.starred ? 'text-yellow-500 bg-yellow-50' : 'text-gray-300 hover:bg-gray-100'}`}
                              >
                                <FaStar size={12} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-gray-400 italic py-8">
                    <FaInbox className="text-3xl mb-2 text-gray-300" />
                    <p className="text-xs">No messages in this chat yet. Send a message to start the conversation!</p>
                  </div>
                )}
                <div ref={inboxMessagesEndRef} />
              </div>

              <div className="p-3 sm:p-4 border-t border-gray-200 bg-gray-50 flex-shrink-0">
                <div className="flex gap-2">
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Type a message..."
                    className="flex-1 px-3 py-2 sm:px-4 sm:py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#800020] resize-none text-xs sm:text-sm bg-white"
                    rows={2}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (replyText.trim()) sendReply(currentMessage?.id || currentConversation.applicant_no);
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => sendReply(currentMessage?.id || currentConversation.applicant_no)}
                    disabled={!replyText.trim()}
                    className="px-4 py-2 sm:px-6 sm:py-3 rounded-xl bg-[#800020] text-white font-semibold hover:bg-[#650018] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 text-xs sm:text-sm flex-shrink-0"
                  >
                    <FaPaperPlane /> <span className="hidden sm:inline">Send</span>
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center px-6">
                <FaInbox className="text-5xl sm:text-6xl text-gray-300 mx-auto mb-3 sm:mb-4" />
                <h3 className="text-lg sm:text-xl font-bold text-gray-800 mb-1 sm:mb-2">Select a conversation</h3>
                <p className="text-xs sm:text-sm text-gray-500">All applicants (pending/accepted/rejected/cancelled) can message here.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (standaloneInbox) {
    return (
      <div className="w-full flex-1 flex flex-col min-h-0 overflow-hidden">
        {renderInbox()}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-gray-50 to-blue-50/30 pt-16 sm:pt-20 fixed-sidebar-layout">
      {/* Mobile Drawer Overlay Backdrop */}
      {isMobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      )}

      <aside
        onMouseEnter={() => setSidebarCollapsed(false)}
        onMouseLeave={() => setSidebarCollapsed(true)}
        className={`fixed left-0 top-16 sm:top-20 bottom-0 z-50 bg-gradient-to-b from-[#800020] to-[#650018] text-white shadow-2xl flex flex-col overflow-hidden transition-all duration-300 ease-in-out ${isMobileSidebarOpen ? 'translate-x-0 w-72' : '-translate-x-full md:translate-x-0'
          } ${sidebarCollapsed ? 'md:w-20' : 'md:w-72'}`}
      >
        <div className={`border-b border-white/10 mb-2 flex items-center justify-between transition-all ${sidebarCollapsed ? 'p-3' : 'p-6 sm:p-8'}`}>
          <div className="flex flex-col items-center text-center gap-2 sm:gap-4 w-full">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-white/10 backdrop-blur-md p-2 shadow-inner border border-white/20 flex items-center justify-center group overflow-hidden flex-shrink-0">
              <img src={logo} alt="Scholarship Logo" className="w-full h-full object-contain group-hover:scale-110 transition-transform duration-500" />
            </div>
            {(!sidebarCollapsed || isMobileSidebarOpen) && (
              <div>
                <h2 className="text-base sm:text-xl font-black tracking-tight leading-tight uppercase">{sidebarTitle}</h2>
                <p className="text-[9px] sm:text-[10px] font-bold text-rose-200 tracking-[0.2em] uppercase opacity-70">{sidebarSubtitle}</p>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setIsMobileSidebarOpen(false)}
            className="md:hidden text-white/70 hover:text-white p-1"
          >
            <FaTimes className="text-xl" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto transition-all">
          <div className={`${sidebarCollapsed && !isMobileSidebarOpen ? 'px-1' : 'px-2'} py-4 space-y-1`}>
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
                onClick={() => {
                  setSection(item.id);
                  setIsMobileSidebarOpen(false);
                }}
                className={`w-full flex items-center transition-all rounded-xl ${section === item.id ? 'bg-white/20' : 'hover:bg-white/10'
                  } ${sidebarCollapsed && !isMobileSidebarOpen ? 'justify-center p-3' : 'justify-start px-4 py-3 gap-3'}`}
              >
                <span className="flex-shrink-0 text-lg">{item.icon}</span>
                {(!sidebarCollapsed || isMobileSidebarOpen) && <span className="whitespace-nowrap font-medium text-sm sm:text-base">{item.label}</span>}
              </button>
            ))}
          </div>
        </nav>
      </aside>

      <main className={`transition-all duration-300 ml-0 ${sidebarCollapsed ? 'md:ml-20' : 'md:ml-72'} flex-1 flex flex-col ${section === 'inbox' ? 'h-[calc(100dvh-4rem)] sm:h-[calc(100dvh-5rem)] max-h-[calc(100dvh-4rem)] sm:max-h-[calc(100dvh-5rem)] overflow-hidden py-2 sm:py-4' : 'overflow-y-auto py-4 sm:py-6 lg:py-10'} px-2 sm:px-6 lg:px-10 custom-scrollbar border-l border-r border-gray-200/80 shadow-[inset_10px_0_15px_-10px_rgba(0,0,0,0.05)]`}>
        <header className={`bg-white rounded-2xl shadow-sm px-3.5 sm:px-6 lg:px-8 py-3 sm:py-4 lg:py-5 flex flex-row items-center justify-between gap-2 sm:gap-4 border border-gray-100 flex-shrink-0 ${section === 'inbox' ? 'mb-3 sm:mb-4' : 'mb-4 sm:mb-6 lg:mb-8'}`}>
          <div className="flex items-center gap-2 sm:gap-3 text-[#800020] font-bold text-sm sm:text-lg lg:text-xl min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setIsMobileSidebarOpen(prev => !prev)}
              className="md:hidden p-2 rounded-xl bg-rose-50 text-[#800020] hover:bg-rose-100 transition-colors flex-shrink-0"
              title="Open Sidebar"
            >
              <FaBars className="text-sm sm:text-base" />
            </button>
            <span className="truncate font-black tracking-tight">{dashboardTitle}</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
            <div className="text-right">
              <p className="text-[10px] sm:text-xs text-gray-500 font-medium whitespace-nowrap hidden sm:block">Welcome back,</p>
              <p className="text-xs sm:text-sm font-bold text-gray-900 whitespace-nowrap">{userName}</p>
            </div>
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-[#800020] to-[#650018] flex items-center justify-center text-white font-bold text-xs sm:text-base shadow-sm border-2 border-white flex-shrink-0">
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
                      .sort((a, b) => {
                        const gradeA = convertGpaToPercentage(a.grade || a.overall_gpa || a.gpa, a.school) ?? 0;
                        const gradeB = convertGpaToPercentage(b.grade || b.overall_gpa || b.gpa, b.school) ?? 0;
                        return gradeB - gradeA;
                      })
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
                    <th className="px-4 py-3 text-left font-bold">Grade / GPA</th>
                    <th className="px-4 py-3 text-left font-bold">Financial Status</th>
                    <th className="px-4 py-3 text-center font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {recommended.map((s, i) => (
                    <tr key={`${s.name}-${i}`} className="hover:bg-rose-50/30 transition-colors">
                      <td className="px-4 py-3 font-black text-[#800020] text-lg">{i + 1}</td>
                      <td className="px-4 py-3 font-bold text-gray-800">{s.name}</td>
                      <td className="px-4 py-3 font-mono text-blue-700 font-bold" title={s.grade ? `Original GPA: ${s.grade}` : ''}>
                        {formatGpaDisplay(s.grade || s.overall_gpa || s.gpa, s.school)}
                      </td>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setImageModalSrc(null)}>
          <div className="relative max-w-[90vw] max-h-[90vh] flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <DecryptedMedia
              src={typeof imageModalSrc === 'object' && imageModalSrc !== null ? imageModalSrc.src : imageModalSrc}
              type={
                typeof imageModalSrc === 'object' && imageModalSrc !== null && imageModalSrc.type
                  ? imageModalSrc.type
                  : (typeof imageModalSrc === 'string' && (imageModalSrc.toLowerCase().includes('.mp4') || imageModalSrc.toLowerCase().includes('.webm') || imageModalSrc.toLowerCase().includes('video')))
                    ? 'video/mp4'
                    : 'image/jpeg'
              }
              className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl"
              controls={true}
              autoPlay={true}
            />
            <button
              type="button"
              onClick={() => setImageModalSrc(null)}
              className="absolute -top-10 right-0 sm:top-3 sm:right-3 w-10 h-10 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-[#800020] transition-colors z-10 text-xl font-bold shadow-lg"
              aria-label="Close media view"
            >
              <FaTimes />
            </button>
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







