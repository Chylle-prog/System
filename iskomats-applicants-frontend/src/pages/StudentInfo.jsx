import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import SignaturePad from '../components/SignaturePad';
import VideoRecorder from '../components/VideoRecorder';
import { applicantAPI, applicationAPI, scholarshipAPI, verificationAPI, uploadProfilePicture } from '../services/api';
import { SCHOOLS, BARANGAYS } from '../utils/constants';

const FIND_SCHOLARSHIP_PROFILE_KEY = 'findScholarshipProfile';


// COURSES array removed as per user request to change to normal text field


const normalizeSelectValue = (value, options) => {
  if (!value) return '';
  const normalized = String(value).trim().toLowerCase();

  // 1. Check exact match (ignoring case)
  const exactMatch = options.find(opt => opt.toLowerCase() === normalized);
  if (exactMatch) return exactMatch;

  // 2. Check if normalized value is contained in any option (DLSL -> DLSL/De La Salle Lipa)
  const optionContainsValue = options.find(opt => opt.toLowerCase().includes(normalized));
  if (optionContainsValue) return optionContainsValue;

  // 3. Check if any option is contained in the normalized value (De La Salle Lipa -> DLSL/De La Salle Lipa)
  const valueContainsOption = options.find(opt => normalized.includes(opt.toLowerCase()));
  if (valueContainsOption) return valueContainsOption;

  return value;
};

const normalizeGuideVideoUrl = (value) => {
  const rawValue = String(value || '').trim();
  if (!rawValue) return '';

  try {
    const parsedUrl = new URL(rawValue);
    if (parsedUrl.hostname.includes('youtu.be')) {
      const videoId = parsedUrl.pathname.replace('/', '');
      return videoId ? `https://www.youtube.com/embed/${videoId}` : rawValue;
    }
    if (parsedUrl.hostname.includes('youtube.com')) {
      const videoId = parsedUrl.searchParams.get('v');
      return videoId ? `https://www.youtube.com/embed/${videoId}` : rawValue;
    }
    return rawValue;
  } catch {
    return rawValue;
  }
};

const isDataUrl = (value) => typeof value === 'string' && value.startsWith('data:');
const isHttpUrl = (value) => typeof value === 'string' && /^https?:\/\//i.test(value);

const fetchImageAsDataUrl = async (url) => {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load image: ${response.status}`);
  }

  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to convert image to data URL'));
    reader.readAsDataURL(blob);
  });
};

const normalizeVerificationImage = async (value) => {
  if (!value) {
    return value;
  }

  if (isDataUrl(value)) {
    return value;
  }

  if (isHttpUrl(value)) {
    return fetchImageAsDataUrl(value);
  }

  return value;
};

const resolvePersistedDocumentUrl = (...values) => values.find((value) => isHttpUrl(value)) || null;

const getVerificationDocumentSource = (localValue, ...persistedValues) => {
  if (isFileLike(localValue) || isDataUrl(localValue)) {
    return localValue;
  }

  return resolvePersistedDocumentUrl(localValue, ...persistedValues) || null;
};

const STEP_FIELDS = {
  1: [
    'lastName', 'firstName', 'middleName', 'maidenName', 'dateOfBirth', 'placeOfBirth',
    'barangay', 'townCityMunicipality', 'province', 'zipCode', 'sex', 'citizenship',
    'mobileNumber', 'mayorIndigency_photo'
  ],
  2: [
    'fatherStatus', 'fatherName', 'fatherOccupation', 'fatherPhoneNumber',
    'motherStatus', 'motherName', 'motherOccupation', 'motherPhoneNumber',
    'parentsGrossIncome', 'numberOfSiblings'
  ],
  3: [
    'meritsAwardsReceived', 'schoolIdNumber', 'schoolName', 'schoolAddress', 'schoolSector', 'yearLevel', 'course', 'gpa',
    'mayorCOE_photo', 'mayorGrades_photo'
  ],
  4: [
    'dataCertifyConsent',
    'applicantSignatureName', 'dateAccomplished'
  ]
};

const isFileLike = (value) => typeof File !== 'undefined' && value instanceof File;
const DOCUMENT_IMAGE_FIELDS = new Set([
  'mayorCOE_photo',
  'mayorGrades_photo',
  'mayorIndigency_photo'
]);
const DOCUMENT_UPLOAD_FIELD_MAP = {
  mayorCOE_photo: 'enrollment_certificate_doc',
  mayorGrades_photo: 'grades_doc',
  mayorIndigency_photo: 'indigency_doc'
};

const buildDraftStorageKey = (user, searchParams, scholarshipName) => {
  const scholarshipKey = searchParams.get('reqNo') || searchParams.get('scholarship_id') || scholarshipName || 'default';
  return `studentinfo:draft:${user}:${scholarshipKey}`;
};

const serializeDraftFormData = (data) => Object.fromEntries(
  Object.entries(data).filter(([, value]) => {
    if (value === null || value === undefined || isFileLike(value)) {
      return false;
    }

    if (typeof value === 'string' && !value.trim()) {
      return false;
    }

    return ['string', 'number', 'boolean'].includes(typeof value);
  })
);

const mergeMeaningfulValues = (baseData, incomingData = {}) => {
  const nextData = { ...baseData };

  Object.entries(incomingData).forEach(([key, value]) => {
    if (value === null || value === undefined) {
      return;
    }

    if (typeof value === 'string' && !value.trim()) {
      return;
    }

    nextData[key] = value;
  });

  return nextData;
};

const fillEmptyValuesOnly = (baseData, incomingData = {}) => {
  const nextData = { ...baseData };

  Object.entries(incomingData).forEach(([key, value]) => {
    if (value === null || value === undefined) {
      return;
    }

    if (typeof value === 'string' && !value.trim()) {
      return;
    }

    const currentValue = nextData[key];
    const hasCurrentString = typeof currentValue === 'string' && currentValue.trim();
    const hasCurrentValue = hasCurrentString || typeof currentValue === 'number' || currentValue === true;

    if (!hasCurrentValue) {
      nextData[key] = value;
    }
  });

  return nextData;
};

const formatCurrencyPreview = (value) => {
  const numericValue = Number(String(value || '').replace(/,/g, ''));

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return 'Not provided';
  }

  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(numericValue);
};

const splitFullName = (fullName) => {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);

  if (!parts.length) {
    return { firstName: '', middleName: '', lastName: '' };
  }

  if (parts.length === 1) {
    return { firstName: parts[0], middleName: '', lastName: '' };
  }

  if (parts.length === 2) {
    return { firstName: parts[0], middleName: '', lastName: parts[1] };
  }

  // Handle common Filipino last name prefixes like "Dela", "De", "Del", "Santo"
  const lastNamePrefixes = ['dela', 'del', 'de', 'santo', 'santa', 'san', 'dos'];
  const lastIndex = parts.length - 1;
  const secondLastIndex = parts.length - 2;

  if (secondLastIndex >= 1 && lastNamePrefixes.includes(parts[secondLastIndex].toLowerCase())) {
    return {
      firstName: parts.slice(0, secondLastIndex).join(' '),
      middleName: '', // Fallback, middle name detection is hard with prefixes
      lastName: parts.slice(secondLastIndex).join(' '),
    };
  }

  // Default split
  return {
    firstName: parts[0],
    middleName: parts.slice(1, -1).join(' '),
    lastName: parts[parts.length - 1],
  };
};

let tesseractWorkerSingleton = null;
let activeOcrLogger = null;

const getTesseractWorker = async () => {
  if (tesseractWorkerSingleton) {
    return tesseractWorkerSingleton;
  }

  if (!window.Tesseract) {
    throw new Error("WebAssembly OCR Engine (Tesseract.js) failed to load. Please check your internet connection.");
  }

  tesseractWorkerSingleton = await window.Tesseract.createWorker('eng', 1, {
    workerPath: 'https://unpkg.com/tesseract.js@5.1.0/dist/worker.min.js',
    corePath: 'https://unpkg.com/tesseract.js-core@5.1.0/tesseract-core.wasm.js',
    langPath: 'https://tessdata.projectnaptha.com/4.0.0',
    // Cache the language model in IndexedDB so it's only downloaded once.
    // After the first scan, subsequent scans load from local cache (~instant).
    cacheMethod: 'write',
    logger: (m) => {
      if (activeOcrLogger) {
        activeOcrLogger(m);
      }
    }
  });

  return tesseractWorkerSingleton;
};

const StudentInfo = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [showSubmissionModal, setShowSubmissionModal] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [promptMessage, setPromptMessage] = useState('');
  const [idPicturePreview, setIdPicturePreview] = useState(null);
  const [rawProfilePictureFile, setRawProfilePictureFile] = useState(null);
  const [faceVerificationPreview, setFaceVerificationPreview] = useState(null);
  const [signaturePreview, setSignaturePreview] = useState(null);
  const [drawnSignature, setDrawnSignature] = useState(null);
  const [signatureVerified, setSignatureVerified] = useState(null);
  const [signatureStatus, setSignatureStatus] = useState('');
  const [signatureResults, setSignatureResults] = useState(null);
  const [signatureStats, setSignatureStats] = useState({ inkMass: 0, junctions: 0 });
  const [feedbackStatus, setFeedbackStatus] = useState({});
  const [hasOtherAssistance, setHasOtherAssistance] = useState('');
  const [scholarshipName, setScholarshipName] = useState('Scholarship Application');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingStep, setIsSavingStep] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState({ title: '', message: '' });
  const [currentStep, setCurrentStep] = useState(1);

  const [schoolIdPhotos, setSchoolIdPhotos] = useState({
    front: null,
    back: null
  });

  const [autoScanTrigger, setAutoScanTrigger] = useState(null);
  const [indigencyResults, setIndigencyResults] = useState([]);
  const [coeResults, setCoeResults] = useState([]);
  const [gradesResults, setGradesResults] = useState([]);
  const [idResults, setIdResults] = useState([]);

  const calculateVerificationPercentage = (results) => {
    if (!results || !Array.isArray(results) || results.length === 0) return null;
    let totalFields = 0;
    let passedFields = 0;

    results.forEach(res => {
      if (res.score_details) {
        Object.values(res.score_details).forEach(val => {
          if (val !== null && val !== undefined) {
            totalFields++;
            if (val === true || val === 1 || val === 'true') passedFields++;
          }
        });
      }
    });

    if (totalFields === 0) return 0;
    return totalFields > 0 ? Math.round((passedFields / totalFields) * 100) : (results.every(r => r.verified) ? 100 : 0);
  };

  const [showAllRequirementsChecklist, setShowAllRequirementsChecklist] = useState(true);

  const renderInlineRequirementsChecklist = (docType) => {
    if (!showAllRequirementsChecklist) return null;
    const log = ocrDebugLogs[docType];
    if (!log || !log.requirements || Object.keys(log.requirements).length === 0) return null;

    return (
      <div style={{ marginTop: '12px', borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: '10px' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: '8px',
          marginBottom: '8px'
        }}>
          {Object.entries(log.requirements).map(([key, val]) => {
            const matchVal = log.scoreDetails ? log.scoreDetails[key] : null;
            let isMatch = matchVal === 'MATCH✓' || matchVal === true || val === 'Uploaded & Attached';
            if (matchVal === 'MISMATCH✗' || matchVal === false) isMatch = false;

            return (
              <div key={key} style={{
                background: isMatch ? '#f0fdf4' : '#fef2f2',
                border: `1px solid ${isMatch ? '#bbf7d0' : '#fecaca'}`,
                borderRadius: '8px',
                padding: '8px 10px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div style={{ overflow: 'hidden', paddingRight: '4px' }}>
                  <div style={{ fontSize: '0.62rem', color: '#64748b', fontWeight: '700', textTransform: 'uppercase' }}>{key}</div>
                  <div style={{ fontSize: '0.78rem', fontWeight: '800', color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(val)}</div>
                </div>
                <span style={{
                  fontSize: '0.62rem',
                  fontWeight: '800',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: isMatch ? '#16a34a' : '#dc2626',
                  color: 'white',
                  whiteSpace: 'nowrap'
                }}>
                  {isMatch ? 'MATCH✓' : 'MISMATCH✗'}
                </span>
              </div>
            );
          })}
        </div>

        {log.detectedText && (
          <details style={{ marginTop: '6px' }}>
            <summary style={{ fontSize: '0.72rem', color: '#64748b', cursor: 'pointer', fontWeight: '600' }}>
              📄 View Raw Text Extracted by OCR Engine
            </summary>
            <pre style={{
              marginTop: '4px',
              fontSize: '0.7rem',
              color: '#334155',
              background: '#f8fafc',
              padding: '8px',
              borderRadius: '6px',
              whiteSpace: 'pre-wrap',
              maxHeight: '120px',
              overflowY: 'auto',
              border: '1px solid #e2e8f0'
            }}>
              {log.detectedText}
            </pre>
          </details>
        )}
      </div>
    );
  };

  const triggerAutoScan = (docType) => setAutoScanTrigger(prev => prev === docType ? `${docType}_${Date.now()}` : docType);

  const getDocTypeFromField = (field) => {
    if (field.includes('Indigency')) return 'Indigency';
    if (field.includes('COE') || field.includes('Enrollment')) return 'Enrollment';
    if (field.includes('Grades')) return 'Grades';
    if (field.includes('schoolId') || field.includes('id_front') || field.includes('id_back') || field.includes('SchoolId')) return 'SchoolID';
    return null;
  };

  const [showCameraModal, setShowCameraModal] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [cameraInitializing, setCameraInitializing] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [usingFrontCamera, setUsingFrontCamera] = useState(true);
  const [currentStream, setCurrentStream] = useState(null);
  const [cameraPermissionStatus, setCameraPermissionStatus] = useState('');
  const [ocrError, setOcrError] = useState('');
  const [ocrVerified, setOcrVerified] = useState(null);
  const [ocrStatus, setOcrStatus] = useState('');
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [photos, setPhotos] = useState({
    id_front: null,
    id_back: null,
    face_photo: null,
    mayorCOE_photo: null,
    mayorGrades_photo: null,
    mayorIndigency_photo: null,
    mayorValidID_photo: null
  });
  const [activeCameraField, setActiveCameraField] = useState('face_photo');

  const invalidateVerificationState = (docType, reason) => {
    const message = `Invalid: ${reason}. Please run the scan again.`;

    if (docType === 'Indigency' && ocrVerified === 'success') {
      setOcrVerified('failed');
      setOcrStatus(message);
    } else if (docType === 'Enrollment' && coeVerified === 'success') {
      setCoeVerified('failed');
      setCoeStatus(message);
    } else if (docType === 'Grades' && gradesVerified === 'success') {
      setGradesVerified('failed');
      setGradesStatus(message);
    } else if (docType === 'SchoolID' && idVerified === 'success') {
      setIdVerified('failed');
      setIdStatus(message);
    } else if (docType === 'Signature' && signatureVerified === 'success') {
      setSignatureVerified('failed');
      setSignatureStatus(message);
    }
  };

  const invalidateVerificationDependencies = (fieldName, nextValue) => {
    const currentValue = formData[fieldName];
    if (currentValue === nextValue) {
      return;
    }

    if (['firstName', 'middleName', 'lastName'].includes(fieldName)) {
      invalidateVerificationState('Indigency', 'name details changed');
      invalidateVerificationState('Enrollment', 'name details changed');
      invalidateVerificationState('Grades', 'name details changed');
      invalidateVerificationState('SchoolID', 'name details changed');
      return;
    }

    if (['barangay', 'streetBarangay', 'townCityMunicipality', 'province', 'zipCode'].includes(fieldName)) {
      invalidateVerificationState('Indigency', 'location details changed');
      return;
    }

    if (fieldName === 'schoolIdNumber') {
      invalidateVerificationState('SchoolID', 'school ID number changed');
      invalidateVerificationState('Enrollment', 'school ID number changed');
      invalidateVerificationState('Grades', 'school ID number changed');
      return;
    }

    if (fieldName === 'yearLevel') {
      invalidateVerificationState('SchoolID', 'year level changed');
      invalidateVerificationState('Enrollment', 'year level changed');
      invalidateVerificationState('Grades', 'year level changed');
      return;
    }

    if (fieldName === 'schoolName') {
      invalidateVerificationState('Enrollment', 'school name changed');
      invalidateVerificationState('Grades', 'school name changed');
      return;
    }

    if (fieldName === 'course') {
      invalidateVerificationState('Enrollment', 'course changed');
    }
  };

  const handleVideoUpload = (fieldName, blob) => {
    if (!blob) return;

    // Check size limit: 20MB
    const MAX_SIZE = 20 * 1024 * 1024;
    if (blob.size > MAX_SIZE) {
      alert(`The selected video file is too large (${(blob.size / (1024 * 1024)).toFixed(1)}MB). The maximum allowed size is 20MB. Please record a shorter or lower-resolution video.`);
      return;
    }

    // Immediate local preview
    const localUrl = URL.createObjectURL(blob);
    setDocumentVideos(prev => ({ ...prev, [fieldName]: localUrl }));

    // Reset verification on video change
    if (fieldName === 'mayorIndigency_video') { setOcrVerified(null); setOcrStatus(''); }
    else if (fieldName === 'mayorCOE_video') { setCoeVerified(null); setCoeStatus(''); }
    else if (fieldName === 'mayorGrades_video') { setGradesVerified(null); setGradesStatus(''); }
    else if (fieldName === 'schoolIdFront_video' || fieldName === 'schoolIdBack_video') { setIdVerified(null); setIdStatus(''); }
    else if (fieldName === 'face_video') { setFaceVerified(null); }

    // Start background upload
    const uploadPromise = applicantAPI.uploadRequirementVideo(fieldName, blob, (percent) => {
      setUploadProgress(prev => ({ ...prev, [fieldName]: percent }));
    })
      .then(result => {
        const publicUrl = result.publicUrl;
        setFormData(prev => ({ ...prev, [fieldName]: publicUrl }));

        // Remove from uploading state
        setUploadingFields(prev => {
          const next = { ...prev };
          delete next[fieldName];
          return next;
        });

        setUploadProgress(prev => {
          const next = { ...prev };
          delete next[fieldName];
          return next;
        });

        // Persist to profile in background (Wait! We already do this? If not, keep it)
        applicantAPI.updateProfile({ [fieldName]: publicUrl }).catch(err => {
          console.warn(`Could not sync ${fieldName} to profile:`, err.message);
        });

        console.log(`Video uploaded successfully for ${fieldName}:`, publicUrl);

        // Trigger auto-scan logic
        const docType = getDocTypeFromField(fieldName);
        if (docType) triggerAutoScan(docType);
      })
      .catch(err => {
        console.error(`Failed to upload video for ${fieldName}:`, err);
        alert(`Video upload failed: ${err.message}. Please try again.`);

        setUploadingFields(prev => {
          const next = { ...prev };
          delete next[fieldName];
          return next;
        });
      });

    setUploadingFields(prev => ({ ...prev, [fieldName]: uploadPromise }));
    setHasInteracted(true);
  };

  const [extraSignaturePhoto, setExtraSignaturePhoto] = useState(null);
  const [isFaceMatching, setIsFaceMatching] = useState(false);
  const [faceMatchResult, setFaceMatchResult] = useState(null);
  const [faceVerified, setFaceVerified] = useState(null);

  const [documentVideos, setDocumentVideos] = useState({
    mayorIndigency_video: null,
    mayorGrades_video: null,
    mayorCOE_video: null,
    schoolIdFront_video: null,
    schoolIdBack_video: null,
    face_video: null
  });

  const [uploadingFields, setUploadingFields] = useState({}); // { fieldName: Promise }
  const [uploadProgress, setUploadProgress] = useState({});

  const [coeVerified, setCoeVerified] = useState(null);
  const [coeStatus, setCoeStatus] = useState('');
  const [gradesVerified, setGradesVerified] = useState(null);
  const [gradesStatus, setGradesStatus] = useState('');
  const [idVerified, setIdVerified] = useState(null);
  const [idStatus, setIdStatus] = useState('');
  const [scanProgress, setScanProgress] = useState(0); // 0-100 progress for scanning animations
  const [scholarshipDetails, setScholarshipDetails] = useState(null);

  // OCR Debug Inspector States
  const [showOcrDebugModal, setShowOcrDebugModal] = useState(false);
  const [selectedDebugTab, setSelectedDebugTab] = useState('SchoolID');
  const [ocrDebugLogs, setOcrDebugLogs] = useState({
    SchoolID: { status: 'Not Scanned', detectedText: '', requirements: {}, scoreDetails: {}, timestamp: null },
    Enrollment: { status: 'Not Scanned', detectedText: '', requirements: {}, scoreDetails: {}, timestamp: null },
    Grades: { status: 'Not Scanned', detectedText: '', requirements: {}, scoreDetails: {}, timestamp: null },
    Indigency: { status: 'Not Scanned', detectedText: '', requirements: {}, scoreDetails: {}, timestamp: null }
  });

  const idPictureInputRef = useRef(null);
  const signatureInputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const sigPad = useRef(null);
  const signatureContainerRef = useRef(null);
  const [sigDimensions, setSigDimensions] = useState({ width: 750, height: 180 });
  const cameraTimeoutRef = useRef(null);

  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [lockedNameFields, setLockedNameFields] = useState({
    firstName: false,
    middleName: false,
    lastName: false,
  });

  const getImagePickerStatus = (value) => {
    if (!value) {
      return {
        label: 'No image selected yet',
        color: '#64748b',
        background: '#f8fafc',
        border: '#e2e8f0',
      };
    }

    if (isFileLike(value)) {
      return {
        label: `Selected: ${value.name}`,
        color: '#166534',
        background: '#ecfdf5',
        border: '#bbf7d0',
      };
    }

    if (typeof value === 'string') {
      if (value.startsWith('data:') || value.startsWith('blob:')) {
        return {
          label: 'New image selected',
          color: '#166534',
          background: '#ecfdf5',
          border: '#bbf7d0',
        };
      }

      return {
        label: 'Saved image loaded',
        color: '#1d4ed8',
        background: '#eff6ff',
        border: '#bfdbfe',
      };
    }

    return {
      label: 'Image ready',
      color: '#166534',
      background: '#ecfdf5',
      border: '#bbf7d0',
    };
  };


  const renderDocumentMediaPicker = ({
    photoId, photoName, photoLabel, photoValue, onPhotoChange,
    videoId, videoName, videoValue, onVideoChange,
    isUploadingVideo = false,
    isVerifying = false
  }) => {
    const photoStatus = getImagePickerStatus(photoValue);
    const hasVideo = videoValue && (typeof videoValue === 'string' ? videoValue.length > 0 : true);
    const isDisabled = isUploadingVideo || isVerifying;

    const photoBtnLabel = photoLabel || 'Image';
    const videoBtnLabel = photoLabel ? `${photoLabel} Video` : 'Video';

    return (
      <div style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', color: '#334155', marginBottom: '10px' }}>Upload Media Check</label>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '0.8rem' }}>
          {/* PHOTO PICKER */}
          <div style={{ flex: '1', minWidth: '140px' }}>
            <input id={photoId} type="file" name={photoName} accept="image/*" onChange={onPhotoChange} style={{ display: 'none' }} disabled={isDisabled} />
            <label
              htmlFor={isDisabled ? undefined : photoId}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '0.8rem 0.5rem',
                borderRadius: '14px',
                border: '1px solid #cbd5e1',
                background: isDisabled ? '#f1f5f9' : '#fff',
                color: isDisabled ? '#64748b' : '#0f172a',
                cursor: isDisabled ? 'not-allowed' : 'pointer',
                fontSize: '0.8rem',
                fontWeight: '700',
                boxShadow: '0 4px 12px rgba(15, 23, 42, 0.05)',
                width: '100%',
                transition: 'all 0.2s ease',
                opacity: isDisabled ? 0.6 : 1
              }}
              title="Upload from device"
            >
              <i className={isVerifying ? "fas fa-spinner fa-spin" : "fas fa-file-upload"} style={{ color: isDisabled ? '#94a3b8' : 'var(--primary)' }}></i>
              {isVerifying ? 'Verifying...' : (photoValue ? 'Replace' : 'Upload')}
            </label>
          </div>

          {/* VIDEO PICKER */}
          {(videoId && onVideoChange) && (
            <div style={{ flex: '1', minWidth: '160px' }}>
              <input
                id={videoId}
                type="file"
                accept="video/*"
                onChange={(e) => {
                  const file = e.target.files[0];
                  if (file) onVideoChange(videoName, file);
                }}
                style={{ display: 'none' }}
              />
              <label
                htmlFor={isDisabled ? undefined : videoId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '0.8rem 1rem',
                  borderRadius: '14px',
                  border: '1px solid #cbd5e1',
                  background: isDisabled ? '#f1f5f9' : '#fff',
                  color: isDisabled ? '#64748b' : '#0f172a',
                  cursor: isDisabled ? 'not-allowed' : 'pointer',
                  fontSize: '0.82rem',
                  fontWeight: '700',
                  boxShadow: '0 4px 12px rgba(15, 23, 42, 0.05)',
                  width: '100%',
                  transition: 'all 0.2s ease',
                  opacity: isDisabled ? 0.6 : 1
                }}
              >
                <i className={isDisabled ? "fas fa-spinner fa-spin" : "fas fa-video"} style={{ color: isDisabled ? '#94a3b8' : 'var(--primary)' }}></i>
                {isUploadingVideo ? 'Uploading...' : (isVerifying ? 'Verifying...' : (hasVideo ? `Replace ${videoBtnLabel}` : `Add ${videoBtnLabel}`))}
              </label>
            </div>
          )}
        </div>

        {/* COMBINED STATUS */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{
            flex: 1,
            padding: '0.6rem 0.8rem',
            borderRadius: '11px',
            border: `1px solid ${photoStatus.border}`,
            background: photoStatus.background,
            color: photoStatus.color,
            fontSize: '0.72rem',
            fontWeight: '700',
            textAlign: 'center'
          }}>
            {photoStatus.label}
          </div>
          {videoId && (
            <div style={{
              flex: 1,
              padding: '0.6rem 0.8rem',
              borderRadius: '11px',
              border: hasVideo ? '1px solid #bbf7d0' : '1px solid #e2e8f0',
              background: hasVideo ? '#ecfdf5' : '#f8fafc',
              color: hasVideo ? '#166534' : '#64748b',
              fontSize: '0.72rem',
              fontWeight: '700',
              textAlign: 'center'
            }}>
              {isUploadingVideo ? 'Uploading video...' : (hasVideo ? 'Video uploaded' : 'No video selected')}
            </div>
          )}
        </div>
      </div>
    );
  };


  const [formData, setFormData] = useState({
    lastName: '',
    firstName: '',
    middleName: '',
    maidenName: '',
    dateOfBirth: '',
    placeOfBirth: '',
    barangay: '',
    streetBarangay: '',
    townCity: 'Lipa City',
    townCityMunicipality: 'Lipa City',
    province: 'Batangas',
    zipCode: '4217',
    sex: '',
    citizenship: '',
    schoolIdNumber: '',
    schoolName: '',
    schoolAddress: '',
    schoolSector: '',
    mobileNumber: '',
    yearLevel: '',
    emailAddress: '',
    gpa: '',
    meritsAwardsReceived: '',

    fatherStatus: '',
    fatherName: '',
    fatherOccupation: '',
    fatherAddress: '',
    fatherPhoneNumber: '',
    motherStatus: '',
    motherName: '',
    motherOccupation: '',
    motherAddress: '',
    motherPhoneNumber: '',
    parentsGrossIncome: '',
    numberOfSiblings: '',
    course: '',
    mayorCOE_photo: null,
    mayorGrades_photo: null,
    mayorIndigency_photo: null,
    mayorValidID_photo: null,

    schoolIdFront: null,
    schoolIdBack: null,
    schoolIdFront_video: null,
    schoolIdBack_video: null,
    mayorIndigency_video: null,
    mayorGrades_video: null,
    mayorCOE_video: null,
    face_video: null,

    dataCertifyConsent: false,
    applicantSignatureName: '',
    dateAccomplished: ''
  });

  // Automated Sibling Early Warning Check
  useEffect(() => {
    const checkSiblingRestriction = async () => {
      // Only check if all identifying family fields + scholarship ID are present
      let reqNo = searchParams.get('reqNo') || searchParams.get('scholarship_id');
      const hasFamilyData = formData.lastName && formData.fatherName && formData.motherName;

      if (reqNo && hasFamilyData) {
        try {
          const res = await applicationAPI.checkSibling(parseInt(reqNo), formData);
          if (res.blocked) {
            showPromptMessage(`Restriction Notice: ${res.message}`);
          }
        } catch (err) {
          console.error("Early sibling check failed:", err);
        }
      }
    };

    const timer = setTimeout(checkSiblingRestriction, 1000); // Debounce check
    return () => clearTimeout(timer);
  }, [formData.lastName, formData.fatherName, formData.motherName, searchParams]);

  const scholarshipSearchSnapshot = {
    scholarship: scholarshipName,
    gpa: formData.gpa || searchParams.get('gpa') || '',
    income: formData.parentsGrossIncome || searchParams.get('income') || '',
  };

  const persistDraft = (user, nextFormData = formData, nextStep = currentStep) => {
    if (!user) {
      return;
    }

    sessionStorage.setItem(
      buildDraftStorageKey(user, searchParams, scholarshipName),
      JSON.stringify({
        currentStep: nextStep,
        hasOtherAssistance,
        formData: serializeDraftFormData(nextFormData),
        verificationStates: {
          ocrVerified,
          coeVerified,
          gradesVerified,
          idVerified,
          faceVerified,
          signatureVerified,
          faceMatchResult
        }
      })
    );
  };

  const clearDraft = (user = currentUser) => {
    if (!user) {
      return;
    }

    sessionStorage.removeItem(buildDraftStorageKey(user, searchParams, scholarshipName));
  };

  const analyzeSignatureComplexity = (canvas) => {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    let inkPixels = 0;
    let points = [];
    let minX = canvas.width, maxX = 0;
    let minY = canvas.height, maxY = 0;

    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 200) { // Black ink
        inkPixels++;
        const pixelIdx = i / 4;
        const x = pixelIdx % canvas.width;
        const y = Math.floor(pixelIdx / canvas.width);
        
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;

        if (inkPixels % 8 === 0) {
          points.push({ x, y });
        }
      }
    }

    if (inkPixels === 0) return { score: 0, mass: 0, junctions: 0 };

    const width = maxX - minX;
    const height = maxY - minY;

    // Reject extremely flat, tiny, or empty strokes
    if (width < 25 || height < 20 || inkPixels < 150) {
      console.log('[SIGNATURE COMPLEXITY] Rejected due to size/flatness:', { width, height, inkPixels });
      return { score: 0.02, mass: inkPixels, junctions: 0 };
    }

    // Collinearity check (line fitting)
    const N = points.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, sumYY = 0;
    points.forEach(p => {
      sumX += p.x;
      sumY += p.y;
      sumXY += p.x * p.y;
      sumXX += p.x * p.x;
      sumYY += p.y * p.y;
    });

    const meanX = sumX / N;
    const meanY = sumY / N;

    let varX = 0, varY = 0, covXY = 0;
    points.forEach(p => {
      const dx = p.x - meanX;
      const dy = p.y - meanY;
      varX += dx * dx;
      varY += dy * dy;
      covXY += dx * dy;
    });

    const rNumerator = covXY;
    const rDenominator = Math.sqrt(varX * varY);
    let rSquared = 0;
    if (rDenominator > 0) {
      const r = rNumerator / rDenominator;
      rSquared = r * r;
    }

    // Junctions check using a wider offset window
    let junctions = 0;
    const neighborOffsets = [
      [-2, -2], [0, -2], [2, -2],
      [-2, 0],          [2, 0],
      [-2, 2],  [0, 2],  [2, 2]
    ];

    points.forEach(p => {
      let neighbors = 0;
      neighborOffsets.forEach(([dx, dy]) => {
        const nx = p.x + dx;
        const ny = p.y + dy;
        const idx = (ny * canvas.width + nx) * 4;
        if (data[idx] < 200) neighbors++;
      });
      if (neighbors > 2) junctions++;
    });
    
    const normalizedMass = Math.min(1, inkPixels / 3000);
    const normalizedJunctions = Math.min(1, junctions / 120);
    let score = (normalizedMass * 0.3) + (normalizedJunctions * 0.7);

    // If points are highly collinear (e.g., drawing is a single line), heavily penalize the score
    if (rSquared > 0.75) {
      const penalty = (rSquared - 0.75) / 0.25; // 0 to 1
      score = score * (1 - penalty * 0.95); // reduce score by up to 95%
      console.log('[SIGNATURE COMPLEXITY] Collinear penalty applied:', { rSquared, penalty, originalScore: (normalizedMass * 0.3) + (normalizedJunctions * 0.7), newScore: score });
    }

    return { score, mass: inkPixels, junctions };
  };

  const handleSignatureScan = async () => {
    const idBack = schoolIdPhotos.back || formData.schoolIdBack;
    const currentSignature = drawnSignature || formData.applicantSignatureName;

    if (!currentSignature) {
      showPromptMessage('Please provide your signature first using the digital pad.');
      return;
    }

    if (!idBack) {
      showPromptMessage('Reference ID (Back) not found. Please upload it in Step 3 first.');
      return;
    }

    try {
      setSignatureVerified('verifying');
      setSignatureStatus('Analyzing handwriting patterns...');
      setScanProgress(20);

      // 1. Get complexity score (prefer pre-calculated signatureStats.score from saveSignature)
      let scoreToCheck = signatureStats.score;
      
      // Fallback: if pad is somehow still mounted, calculate it now
      if (scoreToCheck === undefined && sigPad.current) {
        const canvas = sigPad.current.getCanvas();
        if (canvas) {
          const strokes = sigPad.current.getDrawingPath ? sigPad.current.getDrawingPath() : null;
          const comp = analyzeSignatureComplexity(canvas, strokes);
          scoreToCheck = comp.score;
          setSignatureStats({ inkMass: comp.mass, junctions: comp.junctions, score: comp.score });
        }
      }
      
      if (scoreToCheck === undefined) {
        // Safe fallback if not pre-calculated and pad is hidden
        scoreToCheck = 1.0; 
      }

      console.log('[SIGNATURE] Checking complexity score before match:', scoreToCheck);

      const pInterval = setInterval(() => {
        setScanProgress(p => p < 90 ? p + (Math.random() * 15) : p);
      }, 100);

      const result = await applicantAPI.verifySignatureAgainstIdBack(currentSignature, idBack);
      console.log('[SIGNATURE] API match response received:', result);

      clearInterval(pInterval);
      setScanProgress(100);

      // Clone result to avoid mutation failures if response object is frozen
      const finalResult = { ...result };

      // If complexity is extremely low, reject simple doodle
      if (scoreToCheck < 0.22 && finalResult.verified) {
        console.log('[SIGNATURE] Local rejection triggered: complexity score', scoreToCheck, 'is below 0.22');
        finalResult.verified = false;
        finalResult.message = `[Verification Rejected] Simple doodle detected. Structure score: ${(scoreToCheck * 100).toFixed(1)}%.`;
      }

      console.log('[SIGNATURE] Evaluated final result:', finalResult);
      setSignatureResults(finalResult);

      if (finalResult.verified) {
        setSignatureVerified('success');
        setSignatureStatus(finalResult.message || 'Signature patterns match your ID!');
      } else {
        setSignatureVerified('failed');
        setSignatureStatus(finalResult.message || 'Signature mismatch. Please ensure you sign as you did on your ID.');
      }
    } catch (err) {
      console.error('Signature Verification Error:', err);
      setSignatureVerified('failed');
      setSignatureStatus(`Technical Issue: ${err.message}`);
    }
  };

  const sendFeedback = async (type, decision) => {
    if (feedbackStatus[type]) return;

    try {
      if (type === 'signature') {
        const currentSignature = drawnSignature || formData.applicantSignatureName;
        const wasVerified = signatureResults?.verified || false;
        await applicantAPI.sendSignatureFeedback(currentSignature, decision, wasVerified);
        setFeedbackStatus(prev => ({ ...prev, signature: true }));
        showPromptMessage('Thank you for your feedback!');
      }
    } catch (err) {
      console.warn('Feedback error:', err);
    }
  };

  const preScanDocument = async (docType, base64) => {
    // Only pre-scan if we have content and it's not already verified
    const isAlreadyVerified =
      (docType === 'Indigency' && ocrVerified === 'success') ||
      (docType === 'Enrollment' && coeVerified === 'success') ||
      (docType === 'Grades' && gradesVerified === 'success') ||
      (docType === 'SchoolID' && idVerified === 'success');

    if (!base64 || isAlreadyVerified) return;

    try {
      // Trigger a silent OCR check in background to warm up server cache
      await performOcrVerification(
        docType,
        docType === 'SchoolID' ? { front: base64, back: null } : base64,
        { schoolName: formData.schoolName, idNumber: formData.schoolIdNumber, yearLevel: formData.yearLevel },
        null,
        true
      );
    } catch (e) {
      console.log("Background pre-scan deferred", e);
    }
  };

  // --- Client-Side Verification Algorithms (Streamlined for React) ---
  const normalizeForOcr = (str) => {
    if (!str) return "";
    return str.toString()
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
  };

  const studentNameMatchesText = (text, first, middle, last) => {
    const normText = normalizeForOcr(text);
    if (!normText) return { success: false, details: { first_ok: false, middle_ok: false, last_ok: false } };

    const checkNamePart = (part, isMiddle = false) => {
        if (!part) return true;
        const words = normalizeForOcr(part).split(' ').filter(w => w.length >= 2);
        if (words.length === 0) return true;

        let foundCount = 0;
        words.forEach(word => {
            if (new RegExp('\\b' + word + '\\b').test(normText) || normText.includes(word)) {
                foundCount++;
            } else if (isMiddle && word.length > 0) {
                const initial = word[0];
                if (new RegExp('\\b' + initial + '\\b').test(normText)) {
                    foundCount++;
                }
            }
        });

        if (foundCount < words.length) {
            const cleanPart = words.join('');
            const cleanText = normText.replace(/\s/g, '');
            if (cleanText.includes(cleanPart)) {
                return true;
            }
        }

        return foundCount >= Math.max(1, words.length - 1);
    };

    const firstOk = checkNamePart(first);
    const middleOk = middle ? checkNamePart(middle, true) : true;
    const lastOk = checkNamePart(last);

    return {
        success: firstOk && lastOk,
        details: {
            first_ok: firstOk,
            middle_ok: middleOk,
            last_ok: lastOk
        }
    };
  };

  const studentIdNoMatchesText = (targetId, text) => {
    if (!targetId) return true;
    
    const normalizeId = (s) => {
        return s.toString().toLowerCase().replace(/[^a-z0-9]/g, '')
            .replace(/o/g, '0').replace(/q/g, '0').replace(/d/g, '0')
            .replace(/i/g, '1').replace(/l/g, '1')
            .replace(/z/g, '2').replace(/s/g, '5')
            .replace(/g/g, '6').replace(/b/g, '6')
            .replace(/q/g, '9');
    };

    const tId = normalizeId(targetId);
    if (!tId) return true;

    const normText = normalizeId(text);
    const isMatched = normText.includes(tId);
    if (isMatched) return true;

    const words = text.split(/\s+/);
    for (let word of words) {
        if (normalizeId(word).includes(tId)) {
            return true;
        }
    }
    return false;
  };

  const schoolNameMatchesText = (text, targetSchool) => {
    if (!targetSchool || !text) return true;
    const normText = normalizeForOcr(text);
    
    // Support slash-separated school aliases, e.g. "DLSL/De La Salle Lipa"
    const schoolAliases = String(targetSchool).split(/[\/\|,]/).map(s => s.trim()).filter(Boolean);

    for (let alias of schoolAliases) {
      const normAlias = normalizeForOcr(alias);
      if (normAlias && normText.includes(normAlias)) return true;

      // Words check (excluding common filler words)
      const schoolWords = normAlias.split(' ').filter(w => w.length > 2 && !['school', 'university', 'college', 'of', 'and', 'the', 'inc', 'corp'].includes(w));
      if (schoolWords.length > 0) {
        const matched = schoolWords.filter(w => normText.includes(w)).length;
        if ((matched / schoolWords.length) >= 0.5) return true;
      }
    }

    return false;
  };

  const academic_year_matches_expected = (text, expectedYear) => {
    if (!expectedYear) return true;
    if (!text) return false;

    const normText = String(text).replace(/[\–\—]/g, '-').toLowerCase();
    const normExpected = String(expectedYear).replace(/[\–\—]/g, '-').trim();

    const yearRegex = /20\d{2}/g;
    const foundYears = normText.match(yearRegex) || [];
    const expectedYears = normExpected.match(yearRegex) || [];

    if (expectedYears.length === 0) return true;
    if (foundYears.length === 0) return false;

    // If expected year is a range like "2026-2027" (contains 2 years), ALL expected years must be present in the text
    if (expectedYears.length >= 2) {
      const firstTwoExpected = expectedYears.slice(0, 2);
      return firstTwoExpected.every(yr => foundYears.includes(yr));
    }

    // Single year matching (e.g., "2026")
    return expectedYears.every(yr => foundYears.includes(yr));
  };

  const courseMatchesText = (expectedCourse, text) => {
    if (!expectedCourse || !text) return true;
    const normText = normalizeForOcr(text);
    const normCourse = normalizeForOcr(expectedCourse);

    // 1. Direct substring match
    if (normText.includes(normCourse)) return true;

    // 2. Generate acronym (e.g., "BS Information Technology" -> "bsit", "bs it")
    const words = String(expectedCourse).trim().split(/\s+/);
    const acronym = words.map(w => w[0] ? w[0].toLowerCase() : '').join('');
    if (acronym.length >= 2 && (normText.includes(acronym) || normText.includes(acronym.replace('bs', 'bs ')))) {
      return true;
    }

    // 3. Significant words match (e.g. "information", "technology", "computer", "science")
    const sigWords = words.map(normalizeForOcr).filter(w => w.length > 2 && !['bachelor', 'master', 'doctor', 'science', 'arts', 'degree', 'major', 'in', 'of', 'and'].includes(w));
    if (sigWords.length > 0) {
      const matched = sigWords.filter(w => normText.includes(w)).length;
      return (matched / sigWords.length) >= 0.5;
    }

    return false;
  };

  const gpaMatchesText = (text, expectedGpa) => {
    if (!expectedGpa || !text) return true;

    const rawGpaStr = String(expectedGpa).trim();
    const parsedTargetGpa = parseFloat(rawGpaStr.replace(/[^0-9.]/g, ''));
    if (isNaN(parsedTargetGpa)) return true;

    const cleanText = String(text).replace(/[\–\—·•]/g, '.');

    // 1. Direct text match with exact string, rounded string, or comma decimal (e.g. "3.4375", "3.44", "3,4375")
    if (cleanText.includes(rawGpaStr) || cleanText.includes(rawGpaStr.replace('.', ','))) return true;

    const roundedGpaStr = parsedTargetGpa.toFixed(2); // "3.44"
    if (cleanText.includes(roundedGpaStr)) return true;

    // 2. Extract digits only of expected GPA (e.g., "3.4375" -> "34375")
    const expectedDigits = rawGpaStr.replace(/\D/g, '');

    // 3. Tokenize numbers in OCR text (both explicitly formatted and missing-period digit sequences)
    const tokens = cleanText.split(/[\s:;=,]+/);

    for (let token of tokens) {
      const cleanToken = token.replace(/[^0-9.]/g, '');
      if (!cleanToken) continue;

      // Direct digits-only match (e.g. OCR recognized "34375" without decimal point)
      if (expectedDigits.length >= 3 && cleanToken === expectedDigits) {
        return true;
      }

      // Check if inserting a decimal point into digits-only sequence matches target
      if (!cleanToken.includes('.') && cleanToken.length >= 3 && cleanToken.length <= 6) {
        // Option A: 1st digit decimal (e.g. "34375" -> "3.4375", "175" -> "1.75")
        const cand1Str = cleanToken.slice(0, 1) + '.' + cleanToken.slice(1);
        const cand1Val = parseFloat(cand1Str);
        if (!isNaN(cand1Val) && Math.abs(cand1Val - parsedTargetGpa) < 0.05) {
          return true;
        }

        // Option B: 2nd digit decimal for percentage scale (e.g. "885" -> "88.5")
        const cand2Str = cleanToken.slice(0, 2) + '.' + cleanToken.slice(2);
        const cand2Val = parseFloat(cand2Str);
        if (!isNaN(cand2Val) && Math.abs(cand2Val - parsedTargetGpa) < 0.05) {
          return true;
        }
      }

      // Standard float proximity check (e.g. 3.44 vs 3.4375)
      const tokenValue = parseFloat(cleanToken);
      if (!isNaN(tokenValue) && Math.abs(tokenValue - parsedTargetGpa) < 0.05) {
        return true;
      }
    }

    return false;
  };

  const addressMatchesText = (text, expectedAddr) => {
    if (!expectedAddr) return true;
    const normText = normalizeForOcr(text);
    const normAddr = normalizeForOcr(expectedAddr);

    if (normText.includes(normAddr)) return true;

    const words = normAddr.split(' ').filter(w => w.length > 2 && !['barangay', 'brgy', 'city', 'municipality'].includes(w));
    if (words.length === 0) return true;

    return words.some(w => normText.includes(w));
  };

  const performOcrVerification = async (docType, docParam, extraParams = {}, videoUrl = null, silent = false) => {
    const setStatus = (status) => {
      if (silent) return;
      if (docType === 'Indigency') { setOcrStatus(status); }
      else if (docType === 'Enrollment') { setCoeStatus(status); }
      else if (docType === 'Grades') { setGradesStatus(status); }
      else if (docType === 'SchoolID') { setIdStatus(status); }
    };

    const setVerified = (v) => {
      if (silent) return;
      if (docType === 'Indigency') { setOcrVerified(v); }
      else if (docType === 'Enrollment') { setCoeVerified(v); }
      else if (docType === 'Grades') { setGradesVerified(v); }
      else if (docType === 'SchoolID') { setIdVerified(v); }
    };

    try {
      if (!silent) {
        setVerified('verifying');
        setStatus(`Initializing in-browser WebAssembly OCR Engine...`);
        setScanProgress(5);
      }

      let { townCity, barangay, schoolName, idNumber, yearLevel, gpa, course, semester, academicYear } = extraParams;
      const targetBarangay = barangay || formData.barangay || formData.streetBarangay || '';
      const { firstName, lastName, middleName } = formData;
      const reqNo = searchParams.get('reqNo') || searchParams.get('scholarship_id');

      if (!window.Tesseract) {
        throw new Error("WebAssembly OCR Engine (Tesseract.js) failed to load. Please check your internet connection.");
      }

      // Resolve/decrypt proxy URLs to local blob URLs for robust local OCR scanning
      let resolvedParam = docParam;
      if (docType === 'SchoolID') {
        const resolvedFront = docParam.front ? await applicantAPI.resolveDocument('id_img_front', docParam.front) : null;
        const resolvedBack = docParam.back ? await applicantAPI.resolveDocument('id_img_back', docParam.back) : null;
        resolvedParam = { front: resolvedFront, back: resolvedBack };
      } else {
        const fieldMap = {
          'Indigency': 'indigency_doc',
          'Enrollment': 'enrollment_certificate_doc',
          'Grades': 'grades_doc'
        };
        resolvedParam = await applicantAPI.resolveDocument(fieldMap[docType] || 'document', docParam);
      }

      const runOcrOnImage = async (imgSource, stepName = "") => {
        if (!silent) setStatus(`Scanning ${stepName} image with WebAssembly Worker...`);
        
        activeOcrLogger = (m) => {
          if (!silent && m.status === 'recognizing text') {
            setScanProgress(Math.round(m.progress * 90));
          }
        };

        const worker = await getTesseractWorker();
        const ocrResult = await worker.recognize(imgSource);
        return ocrResult.data.text || "";
      };

      let detectedText = "";
      let isSuccess = false;
      let scoreDetails = {};
      let finalMessage = "";
      let resultsList = [];

      if (docType === 'SchoolID') {
        const frontText = await runOcrOnImage(resolvedParam.front, "School ID Front");
        const backText = await runOcrOnImage(resolvedParam.back, "School ID Back");
        detectedText = `[FRONT ID TEXT]\n${frontText}\n\n[BACK ID TEXT]\n${backText}`;

        const nameMatchFront = studentNameMatchesText(frontText, firstName, middleName, lastName);
        const nameMatchBack = studentNameMatchesText(backText, firstName, middleName, lastName);
        const nameOk = nameMatchFront.success || nameMatchBack.success;
        const firstOk = nameMatchFront.details.first_ok || nameMatchBack.details.first_ok;
        const middleOk = middleName ? (nameMatchFront.details.middle_ok || nameMatchBack.details.middle_ok) : true;
        const lastOk = nameMatchFront.details.last_ok || nameMatchBack.details.last_ok;

        const idOk = idNumber ? (studentIdNoMatchesText(idNumber, frontText) || studentIdNoMatchesText(idNumber, backText)) : true;
        const schoolOk = schoolName ? (schoolNameMatchesText(frontText, schoolName) || schoolNameMatchesText(backText, schoolName)) : true;
        const ayOk = academicYear ? (academic_year_matches_expected(frontText, academicYear) || academic_year_matches_expected(backText, academicYear)) : true;

        isSuccess = nameOk && idOk && schoolOk && ayOk;
        scoreDetails = {
          "First Name": firstOk,
          "Middle Name": middleName ? middleOk : null,
          "Last Name": lastOk,
          "ID Number": idNumber ? idOk : null,
          "School Name": schoolName ? schoolOk : null,
          "Academic Year": academicYear ? ayOk : null
        };
        finalMessage = isSuccess ? "School ID verified successfully client-side!" : "School ID verification mismatch.";
        resultsList = [{ doc: 'SchoolID', verified: isSuccess, message: finalMessage, score_details: scoreDetails }];
      } 
      else if (docType === 'Enrollment') {
        detectedText = await runOcrOnImage(resolvedParam, "COE/COR");
        const nameCheck = studentNameMatchesText(detectedText, firstName, middleName, lastName);
        const schoolOk = schoolName ? schoolNameMatchesText(detectedText, schoolName) : true;
        const courseOk = course ? courseMatchesText(course, detectedText) : true;
        const ayOk = academicYear ? academic_year_matches_expected(detectedText, academicYear) : true;
        const semOk = semester ? normalizeForOcr(detectedText).includes(normalizeForOcr(semester)) : true;
        const idOk = idNumber ? studentIdNoMatchesText(idNumber, detectedText) : true;

        isSuccess = nameCheck.success && schoolOk && courseOk && ayOk && semOk && idOk;
        scoreDetails = {
          "First Name": nameCheck.details.first_ok,
          "Last Name": nameCheck.details.last_ok,
          "School Name": schoolName ? schoolOk : null,
          "Course / Track": course ? courseOk : null,
          "Academic Year": academicYear ? ayOk : null,
          "Semester": semester ? semOk : null,
          "ID Number": idNumber ? idOk : null
        };
        finalMessage = isSuccess ? "Enrollment verified successfully client-side!" : "Enrollment verification mismatch.";
        resultsList = [{ doc: 'Enrollment', verified: isSuccess, message: finalMessage, score_details: scoreDetails }];
      }
      else if (docType === 'Grades') {
        detectedText = await runOcrOnImage(resolvedParam, "Grades Transcript");
        const nameCheck = studentNameMatchesText(detectedText, firstName, middleName, lastName);
        const gpaOk = gpa ? gpaMatchesText(detectedText, gpa) : true;
        const ayOk = academicYear ? academic_year_matches_expected(detectedText, academicYear) : true;
        const semOk = semester ? normalizeForOcr(detectedText).includes(normalizeForOcr(semester)) : true;
        const schoolOk = schoolName ? schoolNameMatchesText(detectedText, schoolName) : true;
        const courseOk = course ? courseMatchesText(course, detectedText) : true;
        const idOk = idNumber ? studentIdNoMatchesText(idNumber, detectedText) : true;

        isSuccess = nameCheck.success && gpaOk && ayOk && semOk && schoolOk && courseOk && idOk;
        scoreDetails = {
          "First Name": nameCheck.details.first_ok,
          "Last Name": nameCheck.details.last_ok,
          "GPA Requirement": gpa ? gpaOk : null,
          "Academic Year": academicYear ? ayOk : null,
          "Semester": semester ? semOk : null,
          "School Name": schoolName ? schoolOk : null,
          "Course / Track": course ? courseOk : null,
          "ID Number": idNumber ? idOk : null
        };
        finalMessage = isSuccess ? "Grades verified successfully client-side!" : "Grades verification mismatch.";
        resultsList = [{ doc: 'Grades', verified: isSuccess, message: finalMessage, score_details: scoreDetails }];
      }
      else if (docType === 'Indigency') {
        detectedText = await runOcrOnImage(resolvedParam, "Certificate of Indigency");
        const nameCheck = studentNameMatchesText(detectedText, firstName, middleName, lastName);
        const addrOk = targetBarangay ? addressMatchesText(detectedText, targetBarangay) : true;

        isSuccess = nameCheck.success && addrOk;
        scoreDetails = {
          "First Name": nameCheck.details.first_ok,
          "Last Name": nameCheck.details.last_ok,
          "Barangay Address": targetBarangay ? addrOk : null,
          "Town / City": townCity ? true : null,
          "Video Proof": videoUrl ? true : false
        };
        finalMessage = isSuccess ? "Indigency verified successfully client-side!" : "Indigency verification mismatch.";
        resultsList = [{ doc: 'Indigency', verified: isSuccess, message: finalMessage, score_details: scoreDetails }];
      }

      let debugRequirements = {};
      if (docType === 'SchoolID') {
        debugRequirements = {
          "First Name": firstName || 'N/A',
          "Middle Name": middleName || 'N/A',
          "Last Name": lastName || 'N/A',
          "ID Number": idNumber || 'N/A',
          "School Name": schoolName || 'N/A',
          "Academic Year": academicYear || 'N/A'
        };
      } else if (docType === 'Enrollment') {
        debugRequirements = {
          "First Name": firstName || 'N/A',
          "Last Name": lastName || 'N/A',
          "School Name": schoolName || 'N/A',
          "Course / Track": course || 'N/A',
          "Academic Year": academicYear || 'N/A',
          "Semester": semester || 'N/A',
          "ID Number": idNumber || 'N/A'
        };
      } else if (docType === 'Grades') {
        debugRequirements = {
          "First Name": firstName || 'N/A',
          "Last Name": lastName || 'N/A',
          "GPA Requirement": gpa || 'N/A',
          "Academic Year": academicYear || 'N/A',
          "Semester": semester || 'N/A',
          "School Name": schoolName || 'N/A',
          "Course / Track": course || 'N/A',
          "ID Number": idNumber || 'N/A'
        };
      } else if (docType === 'Indigency') {
        debugRequirements = {
          "First Name": firstName || 'N/A',
          "Last Name": lastName || 'N/A',
          "Barangay Address": targetBarangay || 'N/A',
          "Town / City": townCity || 'N/A',
          "Video Proof": videoUrl ? 'Uploaded & Attached' : 'No Video Attached'
        };
      }

      setOcrDebugLogs((prev) => ({
        ...prev,
        [docType]: {
          status: isSuccess ? 'VERIFIED (SUCCESS)' : 'FAILED (MISMATCH)',
          message: finalMessage,
          detectedText: detectedText || 'No text recognized by OCR engine.',
          scoreDetails: scoreDetails || {},
          requirements: debugRequirements,
          timestamp: new Date().toLocaleTimeString()
        }
      }));

      if (!silent) {
        setStatus("Saving verification results to database...");
        setScanProgress(95);
      }

      const result = await applicantAPI.ocrCheck(
        docType,
        isSuccess,
        finalMessage,
        resultsList,
        reqNo
      );

      if (!silent) setScanProgress(100);

      if (isSuccess) {
        setVerified('success');
        setStatus(finalMessage);
        
        const viewResults = resultsList.map(r => ({
          doc: r.doc,
          verified: r.verified,
          message: r.message,
          score_details: r.score_details
        }));
        if (docType === 'Indigency') setIndigencyResults(viewResults);
        else if (docType === 'Enrollment') setCoeResults(viewResults);
        else if (docType === 'Grades') setGradesResults(viewResults);
        else if (docType === 'SchoolID') setIdResults(viewResults);

        return true;
      } else {
        setVerified('failed');
        setStatus(finalMessage);

        const viewResults = resultsList.map(r => ({
          doc: r.doc,
          verified: r.verified,
          message: r.message,
          score_details: r.score_details
        }));
        if (docType === 'Indigency') setIndigencyResults(viewResults);
        else if (docType === 'Enrollment') setCoeResults(viewResults);
        else if (docType === 'Grades') setGradesResults(viewResults);
        else if (docType === 'SchoolID') setIdResults(viewResults);

        return false;
      }
    } catch (err) {
      console.error('Client-Side OCR Error:', err);
      const errMsg = `Technical Issue: ${err.message}`;
      setOcrDebugLogs((prev) => ({
        ...prev,
        [docType]: {
          status: 'ERROR (EXCEPTION)',
          message: errMsg,
          detectedText: err.stack || err.message,
          scoreDetails: {},
          requirements: {},
          timestamp: new Date().toLocaleTimeString()
        }
      }));
      setVerified('failed');
      setStatus(errMsg);
      return false;
    }
  };

  // --- Indigency Verification Optimization ---
  const lastIndigencyScanRef = useRef({ doc: null, vid: null });
  const handleIndigencyScan = async () => {
    const indigencyDoc = getVerificationDocumentSource(
      photos.mayorIndigency_photo,
      formData.mayorIndigency_photo
    );
    const townCity = formData.townCityMunicipality || '';
    const barangay = formData.barangay || '';
    const videoUrl = formData.mayorIndigency_video || documentVideos.mayorIndigency_video;

    // Skip if nothing changed (doc/video)
    const last = lastIndigencyScanRef.current;
    if (
      last.doc === indigencyDoc &&
      last.vid === videoUrl &&
      ocrVerified === 'success'
    ) {
      return;
    }

    if (!indigencyDoc) {
      showPromptMessage('Please upload or capture your Certificate of Indigency first.');
      return;
    }
    const hasVideo = !!videoUrl && (
      (typeof videoUrl === 'string' && videoUrl.trim().length > 0) ||
      (typeof videoUrl === 'object')
    );

    if (!hasVideo) {
      showPromptMessage('Please record and upload the Indigency video first.');
      return;
    }
    if (!townCity) {
      showPromptMessage('Please fill in your Town/City first.');
      return;
    }
    if (!barangay) {
      showPromptMessage('Please select your Barangay first in the dropdown.');
      return;
    }

    setLoadingMessage({ title: 'Scanning Document', message: 'Verifying your Certificate of Indigency and Video Content...' });
    lastIndigencyScanRef.current = { doc: indigencyDoc, vid: videoUrl };

    try {
      // Only check video presence, not full video OCR (backend already optimized)
      const success = await performOcrVerification('Indigency', indigencyDoc, { townCity: formData.townCityMunicipality, barangay: formData.barangay }, videoUrl);
      if (success) {
        setOcrVerified('success');
        showPromptMessage('Indigency verified successfully!');
      } else {
        setOcrVerified('failed');
        showPromptMessage('Verification failed. Please ensure document and video are clear.');
      }
    } catch (err) {
      console.error('Scan Error:', err);
    }
  };

  const handleCOEScan = async () => {
    const coeDoc = getVerificationDocumentSource(
      photos.mayorCOE_photo,
      formData.mayorCOE_photo
    );
    const schoolName = formData.schoolName || '';
    const idNumber = formData.schoolIdNumber || '';
    const yearLevel = formData.yearLevel || '';
    const course = formData.course || '';
    const videoUrl = formData.mayorCOE_video || documentVideos.mayorCOE_video;
    const year = formData.year || '';
    const semester = ''; // Semester removed from frontend

    if (!coeDoc) {
      showPromptMessage('Please upload your Certificate of Enrollment first.');
      return;
    }
    const hasCoeVideo = !!videoUrl && (
      (typeof videoUrl === 'string' && videoUrl.trim().length > 0) ||
      (typeof videoUrl === 'object')
    );

    if (!hasCoeVideo) {
      showPromptMessage('Please record and upload the COE video first.');
      return;
    }
    if (!schoolName || !idNumber || !yearLevel || !course) {
      showPromptMessage('Please complete School Name, ID, Year Level, and Course first.');
      return;
    }

    setLoadingMessage({ title: 'Scanning COE', message: 'Verifying your Certificate of Enrollment and Video Content...' });

    try {
      const targetAcademicYear = scholarshipDetails?.year || scholarshipDetails?.academic_year || formData.schoolYear || '';
      const success = await performOcrVerification('Enrollment', coeDoc, {
        schoolName,
        idNumber,
        yearLevel,
        course,
        semester,
        academicYear: targetAcademicYear
      }, videoUrl);
      if (success) {
        if (scholarshipDetails) {
          /* Semester check removed */
        }
        setCoeVerified('success');
        showPromptMessage('COE verified successfully!');
      } else {
        setCoeVerified('failed');
        showPromptMessage('COE verification failed.');
      }
    } catch (err) {
      console.error('Scan Error:', err);
    }
  };

  const handleGradesScan = async () => {
    const gradesDoc = getVerificationDocumentSource(
      photos.mayorGrades_photo,
      formData.mayorGrades_photo
    );
    const schoolName = formData.schoolName || '';
    const idNumber = formData.schoolIdNumber || '';
    const yearLevel = formData.yearLevel || '';
    const gpa = formData.gpa || '';
    const videoUrl = formData.mayorGrades_video || documentVideos.mayorGrades_video;
    const grades_sem = ''; // Semester for Grades removed

    if (!gradesDoc) {
      showPromptMessage('Please upload your Grades document first.');
      return;
    }
    const hasGradesVideo = !!videoUrl && (
      (typeof videoUrl === 'string' && videoUrl.trim().length > 0) ||
      (typeof videoUrl === 'object')
    );

    if (!hasGradesVideo) {
      showPromptMessage('Please record and upload the Grades video first.');
      return;
    }
    if (!schoolName || !idNumber || !yearLevel || !gpa) {
      showPromptMessage('Please complete School Name, School ID Number, Year Level, and GPA first.');
      return;
    }

    setLoadingMessage({ title: 'Scanning Grades', message: 'Verifying your Grades document and Video Content...' });

    try {
      const targetAcademicYear = scholarshipDetails?.grades_year || scholarshipDetails?.year || scholarshipDetails?.academic_year || formData.schoolYear || '';
      const success = await performOcrVerification('Grades', gradesDoc, {
        schoolName: formData.schoolName,
        idNumber: formData.schoolIdNumber,
        yearLevel: formData.yearLevel,
        gpa: formData.gpa,
        semester: '',
        grades_sem,
        academicYear: targetAcademicYear
      }, videoUrl);
      if (success) {
        const applicantGpa = parseFloat(formData.gpa);
        const minRequired = scholarshipDetails?.minGpa ? parseFloat(scholarshipDetails.minGpa) : 0;

        if (minRequired > 0 && applicantGpa < minRequired) {
          setGradesVerified('failed');
          showPromptMessage(`Verification Error: Your GPA (${applicantGpa}) does not meet the minimum requirement (${minRequired}) for this scholarship.`);
          return;
        }

        setGradesVerified('success');
        showPromptMessage('Grades verified successfully!');
      } else {
        setGradesVerified('failed');
        showPromptMessage('Grades verification failed.');
      }
    } catch (err) {
      console.error('Scan Error:', err);
    }
  };

  // School ID Verification Optimization
  const lastIdScanRef = useRef({ front: null, back: null, frontVid: null, backVid: null });
  const handleIdScan = async () => {
    const idFront = getVerificationDocumentSource(
      schoolIdPhotos.front,
      formData.schoolIdFront
    );
    const idBack = getVerificationDocumentSource(
      schoolIdPhotos.back,
      formData.schoolIdBack
    );
    const frontVideoUrl = formData.schoolIdFront_video || documentVideos.schoolIdFront_video;
    const backVideoUrl = formData.schoolIdBack_video || documentVideos.schoolIdBack_video;

    // Skip if nothing changed (images/videos)
    const last = lastIdScanRef.current;
    if (
      last.front === idFront &&
      last.back === idBack &&
      last.frontVid === frontVideoUrl &&
      last.backVid === backVideoUrl &&
      idVerified === 'success'
    ) {
      return;
    }

    if (!idFront || !idBack) {
      showPromptMessage('Please upload both front and back of your School ID first.');
      return;
    }
    const hasFrontVideo = !!frontVideoUrl && (
      (typeof frontVideoUrl === 'string' && frontVideoUrl.trim().length > 0) ||
      (typeof frontVideoUrl === 'object')
    );
    const hasBackVideo = !!backVideoUrl && (
      (typeof backVideoUrl === 'string' && backVideoUrl.trim().length > 0) ||
      (typeof backVideoUrl === 'object')
    );

    if (!hasFrontVideo) {
      showPromptMessage('Please record and upload the front School ID video first.');
      return;
    }
    if (!hasBackVideo) {
      showPromptMessage('Please record and upload the back School ID video first.');
      return;
    }
    if (!formData.schoolName || !formData.schoolIdNumber || !formData.yearLevel) {
      showPromptMessage('Please complete School Name, School ID Number, and Year Level first.');
      return;
    }

    setLoadingMessage({ title: 'Scanning School ID', message: 'Verifying your School ID images and Video Content...' });
    lastIdScanRef.current = { front: idFront, back: idBack, frontVid: frontVideoUrl, backVid: backVideoUrl };

    try {
      const targetAcademicYear = scholarshipDetails?.year || scholarshipDetails?.academic_year || formData.schoolYear || '';
      // Only check video presence, not full video OCR (backend already optimized)
      const success = await performOcrVerification(
        'SchoolID',
        { front: idFront, back: idBack },
        {
          schoolName: formData.schoolName,
          idNumber: formData.schoolIdNumber,
          yearLevel: formData.yearLevel,
          academicYear: targetAcademicYear
        },
        { front: frontVideoUrl, back: backVideoUrl }
      );
      if (success) {
        setIdVerified('success');
        showPromptMessage('Front & Back ID verified successfully!');
      } else {
        setIdVerified('failed');
        showPromptMessage('Front & Back ID verification failed.');
      }
    } catch (err) {
      console.error('Scan Error:', err);
    }
  };

  const saveCurrentStepProgress = async (stepNumber = currentStep) => {
    const payload = new FormData();
    const jsonData = {};
    let hasPayload = false;

    for (const fieldName of STEP_FIELDS[stepNumber] || []) {
      let value = formData[fieldName];

      if (value === undefined || value === null || value === '') {
        continue;
      }

      // Skip fields that are handled specially later as files/blobs
      if (DOCUMENT_IMAGE_FIELDS.has(fieldName) || fieldName === 'profile_picture') {
        continue;
      }

      if (fieldName === 'barangay') {
        const fullAddress = formData.barangay || formData.streetBarangay || '';
        if (!jsonData['street_brgy']) {
          jsonData['street_brgy'] = fullAddress;
          payload.append('street_brgy', fullAddress);
        }
        continue;
      }

      if (fieldName === 'sex') {
        value = value === 'Male' ? 'M' : value === 'Female' ? 'F' : value;
      }

      const payloadFieldName = DOCUMENT_UPLOAD_FIELD_MAP[fieldName] || fieldName;
      payload.append(payloadFieldName, typeof value === 'boolean' ? String(value) : value);
      hasPayload = true;
    }

    // Helper to convert base64 dataUrl to Blob
    const dataUrlToBlob = (dataUrl) => {
      try {
        const arr = dataUrl.split(',');
        const match = arr[0].match(/:(.*?);/);
        const mime = match ? match[1] : 'video/mp4';
        const bstr = atob(arr[1] || '');
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) u8arr[n] = bstr.charCodeAt(n);
        return new Blob([u8arr], { type: mime });
      } catch (e) {
        return null;
      }
    };

    const appendSmartFile = (fieldName, sourceValue) => {
      if (!sourceValue) return;

      // If it's already a URL, don't re-upload as binary
      if (typeof sourceValue === 'string' && sourceValue.startsWith('http')) {
        jsonData[fieldName] = sourceValue;
        hasPayload = true;
        return;
      }

      if (isFileLike(sourceValue)) {
        payload.append(fieldName, sourceValue);
        hasPayload = true;
      } else if (typeof sourceValue === 'string' && sourceValue.startsWith('data:')) {
        const blob = dataUrlToBlob(sourceValue);
        if (blob) {
          payload.append(fieldName, blob, `${fieldName}.jpg`);
          hasPayload = true;
        }
      }
    };

    // 2. Special handling for files and previews based on the current step
    if (stepNumber === 1) {
      appendSmartFile('profile_picture', idPicturePreview);
      appendSmartFile('indigency_doc', photos.mayorIndigency_photo);
    }

    if (stepNumber === 3) {
      appendSmartFile('id_front', schoolIdPhotos.front);
      appendSmartFile('id_back', schoolIdPhotos.back);
      appendSmartFile('enrollment_certificate_doc', photos.mayorCOE_photo);
      appendSmartFile('grades_doc', photos.mayorGrades_photo);
    }

    if (stepNumber === 4) {
      appendSmartFile('face_photo', photos.face_photo);
      const signatureToSave = drawnSignature || signaturePreview;
      if (signatureToSave) {
        appendSmartFile('signature_data', signatureToSave);
      }
    }

    // Common: Handle video URLs if they exist in formData (e.g. from previous loads)
    const videoFields = ['mayorIndigency_video', 'mayorGrades_video', 'mayorCOE_video', 'schoolIdFront_video', 'schoolIdBack_video', 'face_video'];
    videoFields.forEach(field => {
      const val = formData[field];
      if (val && typeof val === 'string' && val.startsWith('http')) {
        jsonData[field] = val;
        hasPayload = true;
      }
    });

    persistDraft(currentUser);

    if (!hasPayload) {
      return;
    }

    if (Object.keys(jsonData).length > 0 && Array.from(payload.entries()).length === 0) {
      await applicantAPI.updateProfile(jsonData);
    } else if (Object.keys(jsonData).length > 0) {
      Object.entries(jsonData).forEach(([key, value]) => {
        payload.append(key, value);
      });
      await applicantAPI.updateProfile(payload);
    } else {
      await applicantAPI.updateProfile(payload);
    }
  };



  useEffect(() => {
    const fontAwesomeLink = document.createElement('link');
    fontAwesomeLink.rel = 'stylesheet';
    fontAwesomeLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css';
    document.head.appendChild(fontAwesomeLink);

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

    const compressImage = (file, maxWidth = 1200, quality = 0.7) => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
          const img = new Image();
          img.src = event.target.result;
          img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;

            if (width > maxWidth) {
              height *= maxWidth / width;
              width = maxWidth;
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
            resolve(compressedBase64);
          };
          img.onerror = reject;
        };
        reader.onerror = reject;
      });
    };
    window.compressImage = compressImage;

    const user = localStorage.getItem('currentUser');

    if (!user) {
      navigate('/login');
      return;
    }

    setCurrentUser(user);

    const scholarship = searchParams.get('scholarship');
    const urlGpa = searchParams.get('gpa');
    const urlIncome = searchParams.get('income');
    let scholarshipSearchProfile = null;

    try {
      const rawSearchProfile = sessionStorage.getItem(FIND_SCHOLARSHIP_PROFILE_KEY);
      scholarshipSearchProfile = rawSearchProfile ? JSON.parse(rawSearchProfile) : null;
    } catch {
      scholarshipSearchProfile = null;
    }

    const searchNameParts = splitFullName(scholarshipSearchProfile?.fullName);
    setLockedNameFields({
      firstName: Boolean(searchNameParts.firstName),
      middleName: Boolean(searchNameParts.middleName),
      lastName: Boolean(searchNameParts.lastName),
    });
    setFormData((prev) => mergeMeaningfulValues(prev, {
      firstName: searchNameParts.firstName,
      middleName: searchNameParts.middleName,
      lastName: searchNameParts.lastName,
      schoolName: normalizeSelectValue(scholarshipSearchProfile?.university, SCHOOLS),
      gpa: urlGpa || scholarshipSearchProfile?.gpa || '',
      parentsGrossIncome: urlIncome || scholarshipSearchProfile?.income || '',
      barangay: normalizeSelectValue(scholarshipSearchProfile?.street_brgy, BARANGAYS),
      townCityMunicipality: scholarshipSearchProfile?.town_city_municipality,
      province: scholarshipSearchProfile?.province,
      zipCode: scholarshipSearchProfile?.zip_code,
    }));

    const draftKey = buildDraftStorageKey(user, searchParams, scholarship || scholarshipName);
    let savedDraft = null;

    try {
      const rawDraft = sessionStorage.getItem(draftKey);
      savedDraft = rawDraft ? JSON.parse(rawDraft) : null;
    } catch {
      savedDraft = null;
    }

    setCurrentStep(1);
    if (scholarship) {
      setScholarshipName(scholarship);
    }

    const loadProfile = async () => {
      // RESET: Explicitly clear local verification flags to prevent stale state persistence across reloads
      setOcrVerified(null);
      setCoeVerified(null);
      setGradesVerified(null);
      setIdVerified(null);
      setFaceVerified(null);
      setSignatureVerified(null);

      try {
        setLoadingMessage({ title: 'Loading Profile', message: 'Retrieving your information to pre-fill the application...' });
        setIsInitialLoading(true);
        const profile = await applicantAPI.getProfile();
        setUserProfile(profile);

        const profileFullName = [profile.first_name, profile.middle_name, profile.last_name].filter(Boolean).join(' ');
        const searchFullName = scholarshipSearchProfile?.fullName || '';

        let targetFirstName = profile.first_name || '';
        let targetMiddleName = profile.middle_name || '';
        let targetLastName = profile.last_name || '';

        // Only override profile parts if the search name was explicitly changed in the search form.
        // This prevents splitFullName from mangling multi-word first names (e.g., "Alex Kyle").
        if (searchFullName && searchFullName.trim().toLowerCase() !== profileFullName.trim().toLowerCase()) {
          const parts = splitFullName(searchFullName);
          targetFirstName = parts.firstName || targetFirstName;
          targetMiddleName = parts.middleName || targetMiddleName;
          targetLastName = parts.lastName || targetLastName;
        }

        const updates = {
          firstName: targetFirstName,
          lastName: targetLastName,
          middleName: targetMiddleName,
          maidenName: profile.maiden_name || '',
          dateOfBirth: profile.birthdate || '',
          placeOfBirth: profile.birth_place || '',
          sex: profile.sex === 'M' ? 'Male' : profile.sex === 'F' ? 'Female' : (profile.sex || ''),
          citizenship: profile.citizenship || '',
          schoolIdNumber: profile.school_id_no || '',
          schoolName: normalizeSelectValue(scholarshipSearchProfile?.university || profile.school, SCHOOLS),
          schoolAddress: profile.school_address || '',
          schoolSector: profile.school_sector || '',
          mobileNumber: profile.mobile_no || '',
          yearLevel: profile.year_lvl || '',
          emailAddress: profile.email || user,
          fatherStatus: profile.father_status === true ? 'Living' : profile.father_status === false ? 'Deceased' : '',
          fatherName: profile.father_name || '',
          fatherOccupation: profile.father_occupation || '',
          fatherPhoneNumber: profile.father_phone_no || '',
          motherStatus: profile.mother_status === true ? 'Living' : profile.mother_status === false ? 'Deceased' : '',
          motherName: profile.mother_name || '',
          motherOccupation: profile.mother_occupation || '',
          motherPhoneNumber: profile.mother_phone_no || '',
          parentsGrossIncome: urlIncome || scholarshipSearchProfile?.income || profile.financial_income_of_parents || '',
          gpa: urlGpa || scholarshipSearchProfile?.gpa || profile.overall_gpa || '',
          numberOfSiblings: profile.sibling_no || '',
          course: profile.course || '',
          meritsAwardsReceived: profile.merits_awards_received || ''
        };

        if (scholarshipSearchProfile?.street_brgy || profile.street_brgy || profile.streetBarangay) {
          updates.barangay = normalizeSelectValue(scholarshipSearchProfile?.street_brgy || profile.street_brgy || profile.streetBarangay, BARANGAYS);
        }
        if (scholarshipSearchProfile?.town_city_municipality || profile.town_city_municipality || profile.townCity) {
          updates.townCityMunicipality = scholarshipSearchProfile?.town_city_municipality || profile.town_city_municipality || profile.townCity;
        }
        if (scholarshipSearchProfile?.province || profile.province) {
          updates.province = scholarshipSearchProfile?.province || profile.province;
        }
        if (scholarshipSearchProfile?.zip_code || profile.zip_code || profile.zipCode) {
          updates.zipCode = scholarshipSearchProfile?.zip_code || profile.zip_code || profile.zipCode;
        }

        setFormData(prev => {
          const merged = mergeMeaningfulValues(prev, updates);
          return {
            ...merged,
            firstName: targetFirstName,
            lastName: targetLastName,
            middleName: targetMiddleName
          };
        });

        // LAZY LOADING OPTIMIZATION
        // (Removed fetchHeavyBlobs as it was causing excessive egress and slowing down initial load.
        // Images now load on-demand using standard <img> tags and browser caching.)

        if (profile.profile_picture) {
          setIdPicturePreview(profile.profile_picture);
        }

        if (profile.has_other_assistance) {
          setHasOtherAssistance('Yes');
        } else if (profile.has_other_assistance === false) {
          setHasOtherAssistance('No');
        }

        // Fetch scholarship requirements
        const reqNo = searchParams.get('reqNo') || searchParams.get('scholarship_id');
        if (reqNo) {
          try {
            const res = await scholarshipAPI.getById(reqNo);
            const scholarshipData = res?.scholarship || res;
            if (scholarshipData) {
              setScholarshipDetails(scholarshipData);
              console.log('[SCHOLARSHIP] Loaded requirements:', scholarshipData);
            }
          } catch (e) {
            console.warn('[SCHOLARSHIP] Could not load scholarship details:', e);
          }
        }
      } catch (err) {
        console.warn('Could not pre-fill from profile:', err.message);
      } finally {
        if (savedDraft?.formData) {
          const draftForm = savedDraft.formData;
          setFormData(prev => {
            const next = fillEmptyValuesOnly(prev, draftForm);
            
            // Restore previews from next formData
            if (draftForm.mayorIndigency_photo) {
              setPhotos(p => ({ ...p, mayorIndigency_photo: draftForm.mayorIndigency_photo }));
            }
            if (draftForm.schoolIdFront) {
              setSchoolIdPhotos(p => ({ ...p, front: draftForm.schoolIdFront }));
              setPhotos(p => ({ ...p, id_front: draftForm.schoolIdFront }));
            }
            if (draftForm.schoolIdBack) {
              setSchoolIdPhotos(p => ({ ...p, back: draftForm.schoolIdBack }));
              setPhotos(p => ({ ...p, id_back: draftForm.schoolIdBack }));
            }
            if (draftForm.mayorCOE_photo) {
              setPhotos(p => ({ ...p, mayorCOE_photo: draftForm.mayorCOE_photo }));
            }
            if (draftForm.mayorGrades_photo) {
              setPhotos(p => ({ ...p, mayorGrades_photo: draftForm.mayorGrades_photo }));
            }
            
            // Restore video previews
            const nextVideos = {};
            const videoFields = {
              face_video: 'face_video',
              mayorIndigency_video: 'mayorIndigency_video',
              mayorGrades_video: 'mayorGrades_video',
              mayorCOE_video: 'mayorCOE_video',
              schoolIdFront_video: 'schoolIdFront_video',
              schoolIdBack_video: 'schoolIdBack_video'
            };
            Object.entries(videoFields).forEach(([stateKey, formKey]) => {
              if (draftForm[formKey]) {
                nextVideos[stateKey] = draftForm[formKey];
              }
            });
            if (Object.keys(nextVideos).length > 0) {
              setDocumentVideos(p => ({ ...p, ...nextVideos }));
            }

            return next;
          });
        }

        if (savedDraft?.verificationStates) {
          const vs = savedDraft.verificationStates;
          if (vs.ocrVerified) setOcrVerified(vs.ocrVerified);
          if (vs.coeVerified) setCoeVerified(vs.coeVerified);
          if (vs.gradesVerified) setGradesVerified(vs.gradesVerified);
          if (vs.idVerified) setIdVerified(vs.idVerified);
          if (vs.faceVerified) setFaceVerified(vs.faceVerified);
          if (vs.signatureVerified) setSignatureVerified(vs.signatureVerified);
          if (vs.faceMatchResult) setFaceMatchResult(vs.faceMatchResult);
        }

        if (savedDraft?.hasOtherAssistance) {
          setHasOtherAssistance(savedDraft.hasOtherAssistance);
        }

        if (savedDraft?.currentStep) {
          setCurrentStep(savedDraft.currentStep);
        }
        setIsInitialLoading(false);
      }
    };

    loadProfile();

    return () => {
      document.head.removeChild(fontAwesomeLink);
      document.head.removeChild(googleFontsLink);
      document.head.removeChild(googleFontsDisplay);
      document.head.removeChild(googleFontsSheet);

      if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
      }
      if (cameraTimeoutRef.current) {
        clearTimeout(cameraTimeoutRef.current);
      }
    };
  }, [navigate, searchParams]);

  useEffect(() => {
    if (!currentUser) {
      return;
    }

    persistDraft(currentUser);
  }, [
    currentUser, formData, hasOtherAssistance, currentStep, scholarshipName, searchParams,
    ocrVerified, coeVerified, gradesVerified, idVerified, faceVerified, signatureVerified, faceMatchResult
  ]);



  const openCamera = async (fieldName = 'face_photo') => {
    setActiveCameraField(fieldName);
    setShowCameraModal(true);
    setCameraInitializing(true);
    setCameraError(null);
    setCameraReady(false);

    try {
      if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
      }

      const constraints = {
        video: {
          facingMode: usingFrontCamera ? 'user' : 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      };

      const timeoutPromise = new Promise((_, reject) => {
        cameraTimeoutRef.current = setTimeout(() => reject(new Error('Camera access timeout')), 10000);
      });

      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia(constraints),
        timeoutPromise
      ]);

      if (cameraTimeoutRef.current) clearTimeout(cameraTimeoutRef.current);

      setCurrentStream(stream);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await new Promise((resolve, reject) => {
          videoRef.current.onloadedmetadata = () => {
            videoRef.current.play().then(resolve).catch(reject);
          };
          videoRef.current.onerror = () => reject(new Error('Video playback error'));
        });
      }

      setCameraInitializing(false);
      setCameraReady(true);
    } catch (err) {
      console.error('Camera error:', err);
      setCameraInitializing(false);
      setCameraReady(false);
      setCameraError({
        message: err.name === 'NotAllowedError' ? 'Camera permission denied' : 'Camera access failed',
        details: err.message
      });
    }
  };

  const closeCamera = () => {
    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop());
      setCurrentStream(null);
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setShowCameraModal(false);
    setCameraInitializing(false);
    setCameraReady(false);
    setCameraError(null);
    if (cameraTimeoutRef.current) clearTimeout(cameraTimeoutRef.current);
  };

  const capturePhoto = () => {
    if (!videoRef.current || !currentStream) return;

    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');

    if (usingFrontCamera) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Limit image resolution to 1200px max width to reduce payload size
    let finalCanvas = canvas;
    const maxWidth = 1200;
    if (canvas.width > maxWidth) {
      const scale = maxWidth / canvas.width;
      const resCanvas = document.createElement('canvas');
      resCanvas.width = maxWidth;
      resCanvas.height = canvas.height * scale;
      const resCtx = resCanvas.getContext('2d');
      resCtx.drawImage(canvas, 0, 0, resCanvas.width, resCanvas.height);
      finalCanvas = resCanvas;
    }

    const dataUrl = finalCanvas.toDataURL('image/jpeg', 0.8);
    setPhotos(prev => ({ ...prev, [activeCameraField]: dataUrl }));
    
    if (activeCameraField === 'face_photo') {
      setFaceVerificationPreview(dataUrl);
      setFaceVerified(null);
    }
    
    closeCamera();
  };

  const openGallery = (type) => {
    const fileInput = document.getElementById(`photo_${type}`);
    if (fileInput) fileInput.click();
  };

  const handlePhotoChange = (type) => {
    const fileInput = document.getElementById(`photo_${type}`);
    const file = fileInput?.files[0];
    if (file && window.compressImage) {
      window.compressImage(file).then(compressedBase64 => {
        setPhotos(prev => ({ ...prev, [type]: compressedBase64 }));

        if (type === 'face_photo') {
          setFaceVerificationPreview(compressedBase64);
          setFaceVerified(null);
        } else if (type === 'mayorIndigency_photo') {
          setOcrVerified(null);
          setOcrStatus('');
          triggerAutoScan('Indigency');
        } else if (type === 'mayorCOE_photo') {
          setCoeVerified(null);
          setCoeStatus('');
          triggerAutoScan('Enrollment');
        } else if (type === 'mayorGrades_photo') {
          setGradesVerified(null);
          setGradesStatus('');
          triggerAutoScan('Grades');
        }

        setHasInteracted(true);
      });
    }
  };

  const removePhoto = (type) => {
    setPhotos(prev => ({ ...prev, [type]: null }));

    if (type === 'face_photo') {
      setFaceVerificationPreview(null);
      setFaceVerified(null);
    } else if (type === 'mayorIndigency_photo') {
      setOcrVerified(null);
      setOcrStatus('');
    } else if (type === 'mayorCOE_photo') {
      setCoeVerified(null);
      setCoeStatus('');
    } else if (type === 'mayorGrades_photo') {
      setGradesVerified(null);
      setGradesStatus('');
    }
    const fileInput = document.getElementById(`photo_${type}`);
    if (fileInput) fileInput.value = '';
  };

  const logout = () => {
    localStorage.removeItem('currentUser');
    navigate('/');
  };

  const isAnyVideoUploading = Object.keys(uploadingFields).some(key => key.toLowerCase().includes('video'));
  const isAnyScanning = [idVerified, coeVerified, gradesVerified, ocrVerified, faceVerified, signatureVerified].some(v => v === 'verifying') || isFaceMatching || isAnyVideoUploading;
  const isStep1DocumentsVerified = ocrVerified === 'success';
  const isStep1Complete = STEP_FIELDS[1].every(field => formData[field]);
  const isStep2Complete = STEP_FIELDS[2].every(field => formData[field]);
  const isStep3DocumentsVerified = idVerified === 'success' && coeVerified === 'success' && gradesVerified === 'success';
  const isStep4Complete = formData.dataCertifyConsent && (drawnSignature || formData.applicantSignatureName) && signatureVerified === 'success';

  const [hasInteracted, setHasInteracted] = useState(false);

  useEffect(() => {
    // AUTO-SCAN LOGIC
    if (isAnyScanning || isSavingStep || !autoScanTrigger) return;

    const baseScanType = String(autoScanTrigger).split('_')[0];

    const autoTrigger = async () => {
      // Step 1: Indigency
      if (currentStep === 1 && baseScanType === 'Indigency' && ocrVerified === null) {
        const doc = getVerificationDocumentSource(photos.mayorIndigency_photo, formData.mayorIndigency_photo);
        const vid = formData.mayorIndigency_video || documentVideos.mayorIndigency_video;
        if (doc && vid && typeof vid === 'string' && vid.startsWith('http')) {
          handleIndigencyScan();
          setAutoScanTrigger(null);
        }
      }

      // Step 3: School ID, COE, Grades
      if (currentStep === 3) {
        // School ID
        if (baseScanType === 'SchoolID' && idVerified === null) {
          const front = getVerificationDocumentSource(schoolIdPhotos.front, formData.schoolIdFront);
          const back = getVerificationDocumentSource(schoolIdPhotos.back, formData.schoolIdBack);
          const fVid = formData.schoolIdFront_video || documentVideos.schoolIdFront_video;
          const bVid = formData.schoolIdBack_video || documentVideos.schoolIdBack_video;
          if (front && back && fVid && bVid && typeof fVid === 'string' && fVid.startsWith('http') && typeof bVid === 'string' && bVid.startsWith('http')) {
            handleIdScan();
            setAutoScanTrigger(null);
          }
        }

        // COE
        if (baseScanType === 'Enrollment' && coeVerified === null) {
          const doc = getVerificationDocumentSource(photos.mayorCOE_photo, formData.mayorCOE_photo);
          const vid = formData.mayorCOE_video || documentVideos.mayorCOE_video;
          if (doc && vid && typeof vid === 'string' && vid.startsWith('http')) {
            handleCOEScan();
            setAutoScanTrigger(null);
          }
        }

        // Grades
        if (baseScanType === 'Grades' && gradesVerified === null) {
          const doc = getVerificationDocumentSource(photos.mayorGrades_photo, formData.mayorGrades_photo);
          const vid = formData.mayorGrades_video || documentVideos.mayorGrades_video;
          if (doc && vid && typeof vid === 'string' && vid.startsWith('http')) {
            handleGradesScan();
            setAutoScanTrigger(null);
          }
        }
      }
    };

    autoTrigger();
  }, [
    autoScanTrigger,
    currentStep, ocrVerified, idVerified, coeVerified, gradesVerified,
    photos.mayorIndigency_photo, documentVideos.mayorIndigency_video,
    schoolIdPhotos.front, schoolIdPhotos.back, documentVideos.schoolIdFront_video, documentVideos.schoolIdBack_video,
    photos.mayorCOE_photo, documentVideos.mayorCOE_video,
    photos.mayorGrades_photo, documentVideos.mayorGrades_video,
    isAnyScanning, isSavingStep
  ]);

  const handleInputChange = (e) => {
    if (isAnyScanning || isSavingStep) return;
    const { name, value, type, checked, files } = e.target;

    // Prevent modification of locked name fields (except in Step 1 where editing is allowed)
    if (lockedNameFields[name] && currentStep !== 1) {
      return;
    }

    if (type === 'checkbox') {
      invalidateVerificationDependencies(name, checked);
      setFormData(prev => ({
        ...prev,
        [name]: checked
      }));
    } else if (type === 'file') {
      const file = files[0] || null;
      if (DOCUMENT_IMAGE_FIELDS.has(name) && file) {
        // Create local preview immediately
        const localUrl = URL.createObjectURL(file);
        setPhotos(prev => ({ ...prev, [name]: localUrl }));

        if (file.type.startsWith('image/') && window.compressImage) {
          window.compressImage(file).then(compressedBase64 => {
            setFormData(prev => ({ ...prev, [name]: compressedBase64 }));
            setPhotos(prev => ({ ...prev, [name]: compressedBase64 })); // Update with compressed version

            // Reset verification on photo change
            if (name === 'mayorIndigency_photo') { setOcrVerified(null); setOcrStatus(''); preScanDocument('Indigency', compressedBase64); triggerAutoScan('Indigency'); }
            else if (name === 'mayorCOE_photo') { setCoeVerified(null); setCoeStatus(''); preScanDocument('Enrollment', compressedBase64); triggerAutoScan('Enrollment'); }
            else if (name === 'mayorGrades_photo') { setGradesVerified(null); setGradesStatus(''); preScanDocument('Grades', compressedBase64); triggerAutoScan('Grades'); }
          });
        } else {
          // Non-image or compression skipped
          setFormData(prev => ({ ...prev, [name]: file }));
        }

        if (name === 'mayorValidID_photo') {
          setValidIdPreview(localUrl);
        }
        return;
      }

      if (file && file.type.startsWith('image/') && window.compressImage) {
        window.compressImage(file).then(compressedBase64 => {
          setFormData(prev => ({ ...prev, [name]: compressedBase64 }));
          if (name === 'mayorValidID_photo') setValidIdPreview(compressedBase64);
        });
      } else {
        setFormData(prev => ({ ...prev, [name]: file }));
      }
    } else {
      invalidateVerificationDependencies(name, value);
      setFormData(prev => ({
        ...prev,
        [name]: value
      }));
    }
  };

  const handleIdPictureUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    // Keep the raw File object so we can upload it to storage on submit
    setRawProfilePictureFile(file);
    if (window.compressImage) {
      window.compressImage(file, 400).then(compressedBase64 => {
        setIdPicturePreview(compressedBase64);
        setFormData(prev => ({ ...prev, profile_picture: compressedBase64 }));
      });
    } else {
      // Fallback: use the file directly as preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setIdPicturePreview(reader.result);
        setFormData(prev => ({ ...prev, profile_picture: reader.result }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSchoolIdPhotoUpload = (side, e) => {
    const file = e.target.files[0];
    if (file && window.compressImage) {
      window.compressImage(file).then(compressedBase64 => {
        setSchoolIdPhotos(prev => ({ ...prev, [side]: compressedBase64 }));
        setIdVerified(null);
        setIdStatus('');
        setFormData(prev => ({
          ...prev,
          [`schoolId${side.charAt(0).toUpperCase() + side.slice(1)}`]: compressedBase64
        }));
        const photoKey = side === 'front' ? 'id_front' : 'id_back';
        setPhotos(prev => ({ ...prev, [photoKey]: compressedBase64 }));

        // Pre-scan front ID in background
        if (side === 'front') preScanDocument('SchoolID', compressedBase64);

        triggerAutoScan('SchoolID');
      });
    }
  };

  const removeSchoolIdPhoto = (side) => {
    setSchoolIdPhotos(prev => ({ ...prev, [side]: null }));
    setIdVerified(null);
    setIdStatus('');
    setFormData(prev => ({ ...prev, [`schoolId${side.charAt(0).toUpperCase() + side.slice(1)}`]: null }));
    const fileInput = document.getElementById(`school_id_${side}_photo`);
    if (fileInput) fileInput.value = '';
  };

  const handleSignatureUpload = (e) => {
    const file = e.target.files[0];
    if (file && window.compressImage) {
      window.compressImage(file).then(compressedBase64 => {
        setSignaturePreview(compressedBase64);
      });
    }
  };

  const handleFaceVerificationUpload = (e) => {
    const file = e.target.files[0];
    if (file && window.compressImage) {
      window.compressImage(file).then(compressedBase64 => {
        setFaceVerificationPreview(compressedBase64);
        setPhotos(prev => ({ ...prev, face_photo: compressedBase64 }));
      });
    }
  };

  const clearSignature = () => {
    if (sigPad.current) {
      sigPad.current.clear();
    }
    setDrawnSignature(null);
    setFormData(prev => ({ ...prev, applicantSignatureName: '' }));
  };

  const saveSignature = () => {
    if (sigPad.current && !sigPad.current.isEmpty()) {
      const canvas = sigPad.current.getCanvas();
      const strokes = sigPad.current.getDrawingPath ? sigPad.current.getDrawingPath() : null;
      const complexity = analyzeSignatureComplexity(canvas, strokes);
      console.log('[SIGNATURE] Drawing complexity check:', complexity);
      setSignatureStats({ inkMass: complexity.mass, junctions: complexity.junctions, score: complexity.score });
      
      const dataUrl = canvas.toDataURL('image/png');
      setFormData(prev => ({ ...prev, applicantSignatureName: dataUrl }));
      setShowSignaturePad(false);
      setSignatureVerified(null); // Reset verification when updated
      setSignatureStatus('');
      setDrawnSignature(dataUrl);
    } else {
      showPromptMessage('Please provide a signature first.');
    }
  };

  const showPromptMessage = (message, duration = 3000) => {
    setPromptMessage(message);
    setShowPrompt(true);
    setTimeout(() => {
      setShowPrompt(false);
    }, duration);
  };

  const handleNextStep = async (e) => {
    if (e) e.preventDefault();
    if (isAnyScanning) {
      showPromptMessage('Please wait for individual verification to complete before proceeding.');
      return;
    }
    const pendingUploads = Object.values(uploadingFields);
    if (pendingUploads.length > 0) {
      setLoadingMessage({ title: 'Completing Uploads', message: 'Finalizing your video uploads. Please wait a moment...' });
      setIsSavingStep(true);
      try { await Promise.all(pendingUploads); } catch (err) { console.error("Delayed wait failed:", err); }
      setIsSavingStep(false);
    }

    const stepContainer = document.querySelector('.step-container.active');
    if (!stepContainer) return;

    const requiredFields = stepContainer.querySelectorAll('[required]');
    let isMissing = false;

    requiredFields.forEach(field => {
      if (field.type === 'checkbox') {
        field.parentElement.style.color = '#333';
      } else {
        field.style.borderColor = 'var(--border)';
      }

      if (field.type === 'checkbox' && !field.checked) {
        isMissing = true;
        field.parentElement.style.color = '#e74c3c';
      } else if (field.type === 'file') {
        if (field.name) {
          const hasSavedFile = Boolean(formData[field.name]);
          if (!hasSavedFile) {
            isMissing = true;
          }
        }
      } else if (!field.value.trim() && field.type !== 'file') {
        isMissing = true;
        field.style.borderColor = '#e74c3c';
      }
    });

    // Manual File Requirement Checks
    if (currentStep === 1) {
      if (!idPicturePreview) {
        showPromptMessage('Please upload your 2x2 ID Picture.');
        return;
      }
      if (!photos.mayorIndigency_photo && !formData.mayorIndigency_photo) {
        showPromptMessage('Please upload your Certificate of Indigency.');
        return;
      }
      if (!isStep1DocumentsVerified) {
        showPromptMessage('Please verify your Certificate of Indigency before proceeding to the next step.');
        return;
      }
    }

    if (currentStep === 3) {
      if (!schoolIdPhotos.front || !schoolIdPhotos.back) {
        showPromptMessage('Please upload both Front and Back of your ID.');
        return;
      }
      if (!photos.mayorCOE_photo && !formData.mayorCOE_photo) {
        showPromptMessage('Please upload your Certificate of Enrollment.');
        return;
      }
      if (!photos.mayorGrades_photo && !formData.mayorGrades_photo) {
        showPromptMessage('Please upload your Grades document.');
        return;
      }
      if (idVerified !== 'success') {
        showPromptMessage('Please verify your Front & Back ID before proceeding to the next step.');
        return;
      }
      if (coeVerified !== 'success') {
        showPromptMessage('Please verify your Certificate of Enrollment before proceeding to the next step.');
        return;
      }
      if (gradesVerified !== 'success') {
        showPromptMessage('Please verify your Grades document before proceeding to the next step.');
        return;
      }

      // Final Eligibility Check
      if (scholarshipDetails) {
        // GPA
        const applicantGpa = parseFloat(formData.gpa);
        const minRequired = scholarshipDetails.minGpa ? parseFloat(scholarshipDetails.minGpa) : 0;
        if (minRequired > 0 && applicantGpa < minRequired) {
          showPromptMessage(`Ineligible: Your GPA (${applicantGpa}) is below the required ${minRequired}.`);
          return;
        }
      }
    }

    if (currentStep === 4) {
      if (!(drawnSignature || formData.applicantSignatureName)) {
        showPromptMessage('Please provide your signature before proceeding.');
        return;
      }
      if (signatureVerified !== 'success') {
        showPromptMessage('Please verify your handwriting against your ID signature before submitting.');
        return;
      }
      if (faceVerified !== 'success' && faceMatchResult?.verified !== true) {
        showPromptMessage('Please complete the final Face Identity Verification before submitting.');
        return;
      }
    }

    if (isMissing) {
      showPromptMessage('Please fill in all required fields.');
      return;
    }

    try {
      setLoadingMessage({ title: `Saving Step ${currentStep}`, message: 'Updating your application progress...' });
      setIsSavingStep(true);

      if (currentStep === 1) {
        console.log('[Step 1] Transitioning to Step 2. Manual verification check already passed.');
      }

      await saveCurrentStepProgress(currentStep);
      setCurrentStep(prev => Math.min(prev + 1, 4));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      console.error('Save error:', err);
      showPromptMessage(`Could not save Step ${currentStep}. ${err.message}`);
    } finally {
      setIsSavingStep(false);
    }
  };

  const handlePrevStep = () => {
    if (isAnyScanning || isSavingStep) return;
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
      window.scrollTo(0, 0);
    }
  };

  const handleApplicationSubmit = async (e) => {
    e.preventDefault();

    // Safety check: wait for background uploads
    const pendingUploads = Object.values(uploadingFields);
    if (pendingUploads.length > 0) {
      setLoadingMessage({ title: 'Completing Uploads', message: 'Finalizing your video uploads before submission...' });
      setIsSavingStep(true);
      try { await Promise.all(pendingUploads); } catch (err) { console.error("Delayed wait failed:", err); }
      setIsSavingStep(false);
    }

    const requiredFields = [
      { name: 'lastName', label: 'Last Name' },
      { name: 'firstName', label: 'First Name' },
      { name: 'middleName', label: 'Middle Name' },
      { name: 'dateOfBirth', label: 'Date of Birth' },
      { name: 'placeOfBirth', label: 'Place of Birth' },
      { name: 'barangay', label: 'Barangay' },
      { name: 'townCityMunicipality', label: 'Town/City' },
      { name: 'province', label: 'Province' },
      { name: 'zipCode', label: 'Zip Code' },
      { name: 'sex', label: 'Sex' },
      { name: 'citizenship', label: 'Citizenship' },
      { name: 'schoolIdNumber', label: 'School ID Number' },
      { name: 'schoolName', label: 'School Name' },
      { name: 'schoolAddress', label: 'School Address' },
      { name: 'schoolSector', label: 'School Sector' },
      { name: 'mobileNumber', label: 'Mobile Number' },
      { name: 'yearLevel', label: 'Year Level' },
      { name: 'fatherStatus', label: 'Father Status' },
      { name: 'motherStatus', label: 'Mother Status' },
      { name: 'fatherOccupation', label: 'Father Occupation' },
      { name: 'motherOccupation', label: 'Mother Occupation' },
      { name: 'parentsGrossIncome', label: "Parents' Gross Income" },
      { name: 'numberOfSiblings', label: 'Number of Siblings' },
      { name: 'course', label: 'Course' }
    ];

    let missingLabel = '';
    for (const field of requiredFields) {
      if (!formData[field.name] || (typeof formData[field.name] === 'string' && !formData[field.name].trim())) {
        missingLabel = field.label;
        break;
      }
    }

    if (missingLabel) {
      showPromptMessage(`Please fill in all fields: ${missingLabel} is missing.`);
      return;
    }

    const requiredDocs = [
      { name: 'mayorCOE_photo', profileField: 'enrollment_certificate_doc', label: 'COE Photo' },
      { name: 'mayorGrades_photo', profileField: 'grades_doc', label: 'Grades Photo' },
      { name: 'mayorIndigency_photo', profileField: 'indigency_doc', label: 'Indigency Photo' }
    ];

    let missingDocLabel = '';
    for (const doc of requiredDocs) {
      const hasPhoto = formData[doc.name] || photos[doc.name];
      if (!hasPhoto) {
        missingDocLabel = doc.label;
        break;
      }
    }

    if (missingDocLabel) {
      showPromptMessage(`Please upload the document: ${missingDocLabel}.`);
      return;
    }

    if (
      (!schoolIdPhotos.front) ||
      (!schoolIdPhotos.back) ||
      (!photos.face_photo && !userProfile?.profile_picture)
    ) {
      showPromptMessage('Please complete Identity Verification: Upload Front/Back School ID and a Face Photo.');
      return;
    }

    if (!formData.dataCertifyConsent) {
      showPromptMessage('Please certify that the information provided is correct.');
      return;
    }

    if (!signaturePreview && !drawnSignature && !formData.applicantSignatureName) {
      showPromptMessage('Please either upload a signature photo or draw your signature.');
      return;
    }

    let reqNo = searchParams.get('reqNo');
    if (!reqNo || isNaN(parseInt(reqNo))) {
      reqNo = searchParams.get('scholarship_id');
    }

    if (!reqNo || isNaN(parseInt(reqNo))) {
      showPromptMessage('Scholarship ID missing or invalid.');
      return;
    }

    const numericReqNo = parseInt(reqNo, 10);
    localStorage.setItem('last_submitted_scholarship_id', numericReqNo.toString());
    setIsSubmitting(true);

    try {
      const skipVerification = true;

      console.log(`Submitting application (faceVerified: ${faceVerified})...`);

      await saveCurrentStepProgress(4);

      const submissionData = new FormData();

      const fullAddress = formData.barangay || formData.streetBarangay || '';
      submissionData.append('streetBarangay', fullAddress);

      const imageKeys = [
        'profile_picture', 'id_front', 'id_back', 'face_photo',
        'mayorCOE_photo', 'mayorGrades_photo', 'mayorIndigency_photo',
        'applicantSignatureName', 'signature_data', 'barangay', 'streetBarangay'
      ];

      Object.keys(formData).forEach(key => {
        if (!imageKeys.includes(key) && formData[key] !== null && formData[key] !== undefined) {
          submissionData.append(key, formData[key]);
        }
      });

      // Upload profile picture to Supabase Storage and send only the URL to the backend.
      // This matches how the profile-update flow works and prevents bytea storage.
      if (rawProfilePictureFile) {
        try {
          console.log('[SUBMIT] Uploading profile picture to storage...');
          const profilePicUrl = await uploadProfilePicture(rawProfilePictureFile);
          console.log('[SUBMIT] Profile picture URL:', profilePicUrl);
          submissionData.append('profile_picture', profilePicUrl);
        } catch (uploadErr) {
          console.error('[SUBMIT] Failed to upload profile picture:', uploadErr);
          throw new Error(`Profile picture upload failed: ${uploadErr.message}`);
        }
      } else if (idPicturePreview && (idPicturePreview.startsWith('http://') || idPicturePreview.startsWith('https://'))) {
        // Pre-existing picture already stored as a URL — send it as-is
        submissionData.append('profile_picture', idPicturePreview);
      } else if (userProfile?.profile_picture && (userProfile.profile_picture.startsWith('http://') || userProfile.profile_picture.startsWith('https://'))) {
        // Reuse the existing profile picture URL from the user's profile
        submissionData.append('profile_picture', userProfile.profile_picture);
      }
      if (photos.id_front || schoolIdPhotos.front) submissionData.append('id_front', photos.id_front || schoolIdPhotos.front);
      if (photos.id_back || schoolIdPhotos.back) submissionData.append('id_back', photos.id_back || schoolIdPhotos.back);
      if (photos.face_photo) submissionData.append('face_photo', photos.face_photo);

      const finalSignature = signaturePreview || drawnSignature || formData.applicantSignatureName;
      if (finalSignature) {
        submissionData.append('signature_data', finalSignature);
      }

      const docKeys = ['mayorCOE', 'mayorGrades', 'mayorIndigency'];
      docKeys.forEach(key => {
        const fileKey = `${key}_photo`;
        if (photos[fileKey]) {
          submissionData.append(fileKey, photos[fileKey]);
        } else if (formData[fileKey] && typeof formData[fileKey] === 'string') {
          submissionData.append(fileKey, formData[fileKey]);
        }

        const videoKey = `${key}_video`;
        const videoVal = documentVideos[videoKey];
        if (videoVal) {
          if (typeof videoVal === 'string' && videoVal.startsWith('http')) {
            submissionData.append(videoKey, videoVal);
          } else {
            submissionData.append(videoKey, videoVal, `${videoKey}.webm`);
          }
        }
      });

      if (documentVideos.face_video) {
        if (typeof documentVideos.face_video === 'string' && documentVideos.face_video.startsWith('http')) {
          submissionData.append('face_video', documentVideos.face_video);
        } else {
          submissionData.append('face_video', documentVideos.face_video, 'face_video.webm');
        }
      }

      ['schoolIdFront_video', 'schoolIdBack_video'].forEach((videoField) => {
        const videoValue = documentVideos[videoField];
        if (!videoValue) {
          return;
        }

        if (typeof videoValue === 'string' && videoValue.startsWith('http')) {
          submissionData.append(videoField, videoValue);
        } else {
          submissionData.append(videoField, videoValue, `${videoField}.webm`);
        }
      });

      const result = await applicationAPI.submit(numericReqNo, submissionData, skipVerification);
      console.log('Submission result:', result);

      clearDraft();
      setShowSubmissionModal(true);
      setTimeout(() => {
        navigate('/portal');
      }, 3000);
    } catch (err) {
      console.error('Submission error:', err);
      showPromptMessage(`Error: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

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
          --border: #e2e8f0;
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
          gap: 2.5rem;
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

        .form-container {
          max-width: 900px;
          margin: 0 auto;
          padding: 2rem 5%;
          animation: fadeIn 0.6s ease-out;
        }

        .form-card {
          background: #ffffff;
          padding: 3rem;
          border-radius: 30px;
          border: 1px solid var(--border);
          box-shadow: var(--shadow-md);
          position: relative;
        }

        .section-header {
          text-align: center;
          margin-bottom: 2.5rem;
        }
        .section-header h2 {
          font-size: 1.8rem;
          font-weight: 800;
          color: var(--primary);
          margin-bottom: 0.5rem;
          letter-spacing: -0.5px;
        }
        .section-header p {
          color: var(--text-soft);
          font-size: 1rem;
        }

        .step-indicator {
          display: flex;
          justify-content: space-between;
          margin-bottom: 3.5rem;
          position: relative;
          padding: 0 10px;
        }
        .step-indicator::before {
          content: '';
          position: absolute;
          top: 21px;
          left: 0;
          width: 100%;
          height: 2px;
          background: #e0e0e0;
          z-index: 1;
        }
        .progress-bar {
          position: absolute;
          top: 21px;
          left: 0;
          height: 2px;
          background: var(--primary);
          z-index: 2;
          transition: width 0.3s ease;
        }
        .step-item {
          position: relative;
          z-index: 3;
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 80px;
        }
        .step-circle {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          background: white;
          border: 2px solid #e0e0e0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 800;
          font-size: 1rem;
          color: #999;
          margin-bottom: 0.8rem;
          transition: all 0.3s ease;
          box-shadow: 0 4px 10px rgba(0,0,0,0.05);
        }
        .step-item.active .step-circle {
          border-color: var(--primary);
          color: var(--primary);
          transform: scale(1.1);
        }
        .step-item.completed .step-circle {
          background: var(--primary);
          border-color: var(--primary);
          color: white;
        }
        .step-label {
          font-size: 0.8rem;
          color: #999;
          text-align: center;
          font-weight: 600;
          transition: color 0.3s ease;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .step-item.active .step-label {
          color: var(--primary);
        }

        .step-container {
          display: none;
          animation: slideIn 0.4s ease-out;
        }
        .step-container.active {
          display: block;
        }

        @keyframes slideIn {
          from { opacity: 0; transform: translateX(10px); }
          to { opacity: 1; transform: translateX(0); }
        }

        .form-row {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 1.2rem;
          margin-bottom: 1.2rem;
        }

        .form-group {
          margin-bottom: 1.5rem;
        }

        .form-group label {
          display: block;
          font-weight: 600;
          font-size: 0.85rem;
          margin-bottom: 0.5rem;
          color: #444;
        }

        .form-group input,
        .form-group textarea,
        .form-group select {
          width: 100%;
          padding: 0.9rem 1.2rem;
          border: 1.5px solid var(--gray-2);
          border-radius: 18px;
          font-size: 0.95rem;
          transition: 0.15s;
          background: var(--gray-1);
          font-family: 'Inter', sans-serif;
        }

        .form-group input:focus,
        .form-group textarea:focus,
        .form-group select:focus {
          outline: none;
          border-color: var(--accent);
          background: var(--white);
          box-shadow: 0 0 0 4px rgba(79, 13, 0, 0.08);
        }

        .submit-btn {
          background: var(--primary);
          color: white;
          border: none;
          border-radius: 40px;
          font-weight: 700;
          font-size: 1rem;
          cursor: pointer;
          transition: all 0.2s;
          box-shadow: 0 4px 12px rgba(79, 13, 0, 0.2);
          padding: 1rem 2rem;
        }

        .submit-btn:hover:not(:disabled) {
          background: #3a0a00;
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(79, 13, 0, 0.3);
        }

        .submit-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        .back-to-form-btn {
          color: var(--text-soft);
          border: none;
          background: transparent;
          cursor: pointer;
          font-size: 0.95rem;
          font-weight: 500;
          transition: color 0.2s;
        }

        .back-to-form-btn:hover {
          color: var(--primary);
        }

        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.4);
          backdrop-filter: blur(8px);
          display: none;
          justify-content: center;
          align-items: center;
          z-index: 1000;
        }

        .modal-overlay.active {
          display: flex;
        }

        .submission-modal {
          background: white;
          padding: 2.5rem;
          border-radius: 30px;
          max-width: 500px;
          width: 90%;
          text-align: center;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.15);
        }

        .success-icon-wrapper {
          width: 80px;
          height: 80px;
          background: #e6f7ec;
          color: #28a745;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 2.5rem;
          margin: 0 auto 1.5rem;
        }

        .camera-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.85);
          display: none;
          justify-content: center;
          align-items: center;
          z-index: 2000;
          backdrop-filter: blur(10px);
        }

        .camera-modal-overlay.active {
          display: flex;
        }

        .camera-modal-content {
          background: white;
          padding: 2.5rem;
          border-radius: 32px;
          max-width: 550px;
          width: 90%;
          text-align: center;
        }

        .camera-modal-content video {
          width: 100%;
          border-radius: 20px;
          margin-bottom: 2rem;
          background: #000;
        }

        .signature-preview-box {
          position: relative;
          background: #fff;
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 10px;
          margin-top: 10px;
        }

        .signature-preview-box img {
          max-width: 100%;
          max-height: 150px;
          object-fit: contain;
        }

        /* Floating Prompt Alert */
        .prompt-alert {
          position: fixed;
          bottom: 30px;
          left: 50%;
          transform: translateX(-50%) translateY(20px);
          background: rgba(0, 0, 0, 0.85);
          backdrop-filter: blur(10px);
          color: white;
          padding: 14px 28px;
          border-radius: 50px;
          z-index: 10000;
          display: flex;
          align-items: center;
          gap: 12px;
          box-shadow: 0 15px 35px rgba(0,0,0,0.4);
          transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
          opacity: 0;
          pointer-events: none;
          border: 1px solid rgba(255,255,255,0.1);
        }

        .prompt-alert.active {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
          pointer-events: auto;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .redirect-status {
          font-size: 0.9rem;
          color: #999;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          margin-top: 2rem;
        }

        .loader-dots {
          display: flex;
          gap: 4px;
        }

        .dot {
          width: 6px;
          height: 6px;
          background: var(--primary);
          border-radius: 50%;
          animation: dotLoading 1.4s infinite;
        }

        .dot:nth-child(2) { animation-delay: 0.2s; }
        .dot:nth-child(3) { animation-delay: 0.4s; }

        @keyframes dotLoading {
          0%, 80%, 100% { transform: scale(0); opacity: 0; }
          40% { transform: scale(1); opacity: 1; }
        }

        /* Requirement Card & Media Styling */
        .requirement-card {
          margin-bottom: 2rem;
          background: #ffffff;
          padding: 1.8rem;
          border-radius: 28px;
          border: 1px solid #f1f5f9;
          box-shadow: 0 10px 30px -10px rgba(0,0,0,0.04);
          transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .requirement-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 20px 40px -12px rgba(0,0,0,0.07);
        }
        .media-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 1.5rem;
          margin-top: 1.2rem;
        }
        .preview-box {
          background: #f8fafc;
          border-radius: 20px;
          border: 1.5px dashed #e2e8f0;
          padding: 1rem;
          height: 100%;
          display: flex;
          flex-direction: column;
          transition: all 0.2s;
        }
        .preview-box:hover {
          border-color: var(--primary);
          background: #fff;
        }
        .image-container {
          width: 100%;
          height: 220px;
          border-radius: 16px;
          overflow: hidden;
          background: #000;
          position: relative;
          cursor: zoom-in;
          box-shadow: 0 4px 12px rgba(0,0,0,0.08);
        }
        .image-container img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          transition: transform 0.5s;
        }
        .image-container:hover img {
          transform: scale(1.05);
        }
        
        /* Validation UI - Premium Status Card */
        .validation-status-card {
          margin-top: 1.2rem;
          padding: 1.2rem;
          border-radius: 20px;
          display: flex;
          align-items: flex-start;
          gap: 14px;
          animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
          border: 1px solid transparent;
        }
        .validation-status-card.success {
          background: #f0fdf4;
          border-color: #bbf7d0;
          color: #166534;
        }
        .validation-status-card.failed {
          background: #fef2f2;
          border-color: #fecaca;
          color: #991b1b;
        }
        .validation-status-card.processing {
          background: #eff6ff;
          border-color: #bfdbfe;
          color: #1e40af;
        }
        .status-icon {
          width: 32px;
          height: 32px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1rem;
          flex-shrink: 0;
        }
        .status-icon.success { background: #22c55e; color: white; }
        .status-icon.failed { background: #ef4444; color: white; }
        .status-icon.processing { background: #3b82f6; color: white; }

        @keyframes slideUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* Scanning Laser Effect */
        .scanning-laser {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 4px;
          background: linear-gradient(to right, transparent, var(--primary), transparent);
          box-shadow: 0 0 15px var(--primary);
          z-index: 10;
          animation: scanLaser 2s linear infinite;
        }

        @keyframes scanLaser {
          0% { top: 0; }
          50% { top: 100%; }
          100% { top: 0; }
        }

        .scanning-container {
          position: relative;
          overflow: hidden;
          border-radius: 16px;
        }

        @media (max-width: 768px) {
          .step-label { display: none; }
          .form-card { padding: 1.25rem 1rem !important; }
          .navbar { padding: 1rem 5%; }
          .media-grid { grid-template-columns: 1fr; }
          .form-group-row, .grid-2, .grid-3 {
            grid-template-columns: 1fr !important;
            flex-direction: column !important;
            gap: 0.75rem !important;
          }
          .wizard-steps {
            overflow-x: auto;
            padding-bottom: 0.5rem;
            -webkit-overflow-scrolling: touch;
          }
        }

        @media (max-width: 480px) {
          .form-header h2 {
            font-size: 1.35rem !important;
          }
          .form-card {
            border-radius: 16px !important;
          }
          .btn-primary, .btn-secondary, .btn-submit {
            width: 100% !important;
            padding: 0.85rem 1rem !important;
          }
        }
      `}</style>

      {/* Dev Debug & Global Requirements Checklist Toggle */}
      <div style={{
        position: 'fixed',
        bottom: '20px',
        left: '20px',
        zIndex: 9999,
        background: '#1e293b',
        color: '#fff',
        padding: '12px 16px',
        borderRadius: '18px',
        boxShadow: '0 10px 25px rgba(0,0,0,0.25)',
        fontSize: '0.75rem',
        fontWeight: 'bold',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        border: '1px solid #334155'
      }}>
        {/* Alt Account Check Row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: localStorage.getItem('debug_skip_alternate_check') === 'true' ? '#10b981' : '#ef4444' }}>●</span>
          <span>Alt Account Check: {localStorage.getItem('debug_skip_alternate_check') === 'true' ? 'Bypassed' : 'Enabled'}</span>
          <button 
            type="button"
            onClick={() => {
              const isBypassed = localStorage.getItem('debug_skip_alternate_check') === 'true';
              localStorage.setItem('debug_skip_alternate_check', isBypassed ? 'false' : 'true');
              window.location.reload();
            }}
            style={{
              background: '#3b82f6',
              color: 'white',
              border: 'none',
              padding: '4px 8px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.7rem',
              fontWeight: '700'
            }}
          >
            Toggle
          </button>
        </div>

        {/* Global Requirements Checklist Toggle Button (Below Alt Account Check) */}
        <button
          type="button"
          onClick={() => setShowAllRequirementsChecklist(prev => !prev)}
          style={{
            width: '100%',
            background: showAllRequirementsChecklist ? '#6366f1' : '#475569',
            color: 'white',
            border: 'none',
            padding: '7px 12px',
            borderRadius: '10px',
            cursor: 'pointer',
            fontSize: '0.75rem',
            fontWeight: '800',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
          }}
        >
          <i className={`fas ${showAllRequirementsChecklist ? 'fa-eye-slash' : 'fa-eye'}`}></i>
          {showAllRequirementsChecklist ? 'Hide Requirements Info (All)' : 'Show Requirements Info (All)'}
        </button>
      </div>

      <nav className="navbar">
        <Link to="/portal" className="navbar-brand">iskoMats</Link>
        <div className="navbar-menu">
          <span>{currentUser}</span>
          <button className="logout-btn" onClick={() => {
            localStorage.removeItem('currentUser');
            navigate('/login');
          }}>
            <i className="fas fa-sign-out-alt" style={{ marginRight: '6px' }}></i>Logout
          </button>
        </div>
      </nav>



      <div className="form-container">
        {/* Back to FindScholarship Button */}
        <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
          <Link to="/findscholarship" className="back-button" style={{ textDecoration: 'none', border: '1.5px solid var(--gray-2)', padding: '0.5rem 1.5rem', borderRadius: '40px', fontWeight: 600, color: 'var(--text-soft)', display: 'inline-block', marginTop: 0 }}>
            <i className="fas fa-arrow-left" style={{ marginRight: '8px' }}></i> Back to Find Scholarships
          </Link>
        </div>
        <div className="form-card">
          <div className="section-header">
            <img src="/iskologo.png" alt="Logo" style={{ height: '50px', marginBottom: '1rem', filter: 'grayscale(1) contrast(1.2)' }} />
            <h2>{scholarshipName}</h2>
            <p>Step {currentStep} of 4: {
              currentStep === 1 ? 'Personal Information' :
                currentStep === 2 ? 'Family Background' :
                  currentStep === 3 ? 'Educational Information' :
                    'Certification & Verification'
            }</p>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '1rem',
            marginBottom: '1.75rem'
          }}>
            <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '18px', padding: '1rem 1.1rem' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9a3412', marginBottom: '0.4rem' }}>Profile Snapshot</div>
              <div style={{ fontSize: '1rem', fontWeight: '700', color: '#431407' }}>{[formData.firstName, formData.middleName, formData.lastName].filter(Boolean).join(' ') || currentUser}</div>
              <div style={{ fontSize: '0.82rem', color: '#7c2d12', marginTop: '0.35rem' }}>{formData.schoolName || 'School not set yet'}</div>
            </div>
            <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '18px', padding: '1rem 1.1rem' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#1d4ed8', marginBottom: '0.4rem' }}>Find Scholarship Data</div>
              <div style={{ fontSize: '0.92rem', color: '#1e3a8a' }}>GPA: <strong>{scholarshipSearchSnapshot.gpa || 'Not provided'}</strong></div>
              <div style={{ fontSize: '0.82rem', color: '#1e40af', marginTop: '0.35rem' }}>Income: <strong>{formatCurrencyPreview(scholarshipSearchSnapshot.income)}</strong></div>
            </div>
          </div>

          <div className="step-indicator">
            <div className="progress-bar" style={{ width: `${((currentStep - 1) / 3) * 100}%` }}></div>
            {[1, 2, 3, 4].map(step => (
              <div key={step} className={`step-item ${currentStep === step ? 'active' : ''} ${currentStep > step ? 'completed' : ''}`}>
                <div className="step-circle">{currentStep > step ? <i className="fas fa-check"></i> : step}</div>
                <div className="step-label">{
                  step === 1 ? 'Personal' :
                    step === 2 ? 'Family' :
                      step === 3 ? 'Education' :
                        'Verify'
                }</div>
              </div>
            ))}
          </div>

          <form onSubmit={handleApplicationSubmit} noValidate>
            <fieldset disabled={isAnyScanning || isSavingStep} style={{ border: 'none', padding: 0, margin: 0 }}>

              {/* Step 1: Personal Information */}
              <div className={`step-container ${currentStep === 1 ? 'active' : ''}`}>
                <h3 style={{ marginBottom: '1.5rem', fontSize: '1.2rem', color: 'var(--primary)', fontWeight: '700', borderBottom: '2px solid var(--accent-soft)', paddingBottom: '0.5rem', display: 'flex', alignItems: 'center' }}>
                  <i className="fas fa-user" style={{ marginRight: '12px', fontSize: '1.1rem' }}></i>1. Personal Information
                </h3>

                {/* 2x2 ID Picture */}
                <div style={{ marginBottom: '2rem', textAlign: 'center' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600' }}>
                    2x2 ID Picture <span style={{ color: '#e74c3c' }}>*</span>
                  </label>
                  <div style={{ border: '2px dashed #ccc', borderRadius: '12px', height: '130px', width: '130px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'white', position: 'relative', overflow: 'hidden' }}>
                    <input
                      type="file"
                      name="profile_picture"
                      accept="image/*"
                      onChange={handleIdPictureUpload}
                      style={{ position: 'absolute', width: '100%', height: '100%', opacity: '0', cursor: 'pointer', zIndex: '2' }}
                    />
                    <div style={{ textAlign: 'center', color: '#999', fontSize: '0.85rem', pointerEvents: 'none' }}>
                      {idPicturePreview ? (
                        <img src={idPicturePreview} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '10px' }} alt="ID Preview" />
                      ) : (
                        <>
                          <i className="fas fa-camera" style={{ fontSize: '2rem', marginBottom: '0.5rem', display: 'block' }}></i>
                          <span>Upload 2x2 ID Picture</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Last Name <span style={{ color: '#e74c3c' }}>*</span></label>
                    <input type="text" name="lastName" value={formData.lastName} onChange={handleInputChange} placeholder="Dela Cruz" required />
                  </div>
                  <div className="form-group">
                    <label>First Name <span style={{ color: '#e74c3c' }}>*</span></label>
                    <input type="text" name="firstName" value={formData.firstName} onChange={handleInputChange} placeholder="Juan" required />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Middle Name <span style={{ color: '#e74c3c' }}>*</span></label>
                    <input type="text" name="middleName" value={formData.middleName} onChange={handleInputChange} placeholder="Santos" required />
                  </div>
                  <div className="form-group">
                    <label>Maiden Name (for married women)</label>
                    <input type="text" name="maidenName" value={formData.maidenName} onChange={handleInputChange} placeholder="Maiden Name" />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Date of Birth <span style={{ color: '#e74c3c' }}>*</span></label>
                    <input type="date" name="dateOfBirth" value={formData.dateOfBirth} onChange={handleInputChange} required />
                  </div>
                  <div className="form-group">
                    <label>Place of Birth <span style={{ color: '#e74c3c' }}>*</span></label>
                    <input type="text" name="placeOfBirth" value={formData.placeOfBirth} onChange={handleInputChange} placeholder="City/Municipality" required />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Sex <span style={{ color: '#e74c3c' }}>*</span></label>
                    <select name="sex" value={formData.sex} onChange={handleInputChange} required>
                      <option value="">Select Sex</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Citizenship <span style={{ color: '#e74c3c' }}>*</span></label>
                    <input type="text" name="citizenship" value={formData.citizenship} onChange={handleInputChange} placeholder="Filipino" required />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Barangay <span style={{ color: '#e74c3c' }}>*</span></label>
                    <select
                      id="barangay-select"
                      name="barangay"
                      value={formData.barangay}
                      onChange={handleInputChange}
                      required={currentStep === 1}
                    >
                      <option value="">Select Barangay</option>
                      {BARANGAYS.map(brgy => (
                        <option key={brgy} value={brgy}>{brgy}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Town / City / Municipality <span style={{ color: '#e74c3c' }}>*</span></label>
                    <input
                      id="town-city-input"
                      type="text"
                      name="townCityMunicipality"
                      value={formData.townCityMunicipality}
                      readOnly
                      style={{ backgroundColor: '#f8fafc', color: '#64748b', cursor: 'not-allowed' }}
                      placeholder="Lipa City"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Province <span style={{ color: '#e74c3c' }}>*</span></label>
                    <input
                      type="text"
                      name="province"
                      value={formData.province}
                      readOnly
                      style={{ backgroundColor: '#f8fafc', color: '#64748b', cursor: 'not-allowed' }}
                      placeholder="Batangas"
                      required
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Zip Code <span style={{ color: '#e74c3c' }}>*</span></label>
                    <input
                      type="text"
                      name="zipCode"
                      value={formData.zipCode}
                      readOnly
                      style={{ backgroundColor: '#f8fafc', color: '#64748b', cursor: 'not-allowed' }}
                      placeholder="4217"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Mobile Number <span style={{ color: '#e74c3c' }}>*</span></label>
                    <input type="tel" name="mobileNumber" value={formData.mobileNumber} onChange={handleInputChange} placeholder="09XXXXXXXXX" required />
                  </div>
                </div>

                {/* Documentary Requirement: Indigency */}
                <div className="requirement-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem' }}>
                    <div>
                      <h4 style={{ fontSize: '1.15rem', color: '#1a202c', fontWeight: '800', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ width: '36px', height: '36px', background: 'var(--accent-soft)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <i className="fas fa-home" style={{ color: 'var(--primary)', fontSize: '1.1rem' }}></i>
                        </div>
                        Certificate of Indigency <span style={{ color: '#e74c3c' }}>*</span>
                      </h4>
                      <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '6px', marginLeft: '46px' }}>Verify residency eligibility via Barangay Indigency document</p>
                    </div>
                    {(photos.mayorIndigency_photo || formData.mayorIndigency_photo || userProfile?.indigency_doc) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: '#059669', fontWeight: '700', padding: '6px 14px', background: '#ecfdf5', borderRadius: '20px', border: '1px solid #a7f3d0' }}>
                        <i className="fas fa-check-circle"></i> Upload Ready
                      </div>
                    )}
                  </div>

                  <div className="preview-box" style={{ background: '#fff', borderStyle: 'solid' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                      <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', color: '#334155' }}>Document Media Check</label>
                      <div style={{ fontSize: '0.65rem', color: '#ef4444', fontWeight: '800', background: '#fef2f2', padding: '3px 8px', borderRadius: '6px', border: '1px solid #fecaca' }}>PHOTO + VIDEO</div>
                    </div>

                    {renderDocumentMediaPicker({
                      photoId: 'photo_mayorIndigency_photo',
                      photoName: 'mayorIndigency_photo',
                      photoValue: photos.mayorIndigency_photo || formData.mayorIndigency_photo,
                      onPhotoChange: handleInputChange,
                      videoId: 'video_mayorIndigency_video',
                      videoName: 'mayorIndigency_video',
                      videoValue: documentVideos.mayorIndigency_video || formData.mayorIndigency_video,
                      onVideoChange: handleVideoUpload,
                      isUploadingVideo: Boolean(uploadingFields['mayorIndigency_video']),
                      isVerifying: ocrVerified === 'verifying'
                    })}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '1.2rem' }}>
                      <div className="scanning-container">
                        <div className="image-container" style={{ height: '240px' }} onClick={() => (photos.mayorIndigency_photo || formData.mayorIndigency_photo) && setLightboxSrc(photos.mayorIndigency_photo || formData.mayorIndigency_photo)}>
                          {(photos.mayorIndigency_photo || formData.mayorIndigency_photo) ? (
                            <>
                              <img src={photos.mayorIndigency_photo || formData.mayorIndigency_photo} style={{ objectFit: 'contain', background: '#000' }} alt="Indigency Preview" />
                              <div style={{ position: 'absolute', bottom: '12px', right: '12px', background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '6px 10px', borderRadius: '10px', fontSize: '0.7rem', backdropFilter: 'blur(4px)' }}>
                                <i className="fas fa-expand-alt" style={{ marginRight: '6px' }}></i> Tap to view
                              </div>
                            </>
                          ) : (
                            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', background: '#f8fafc' }}>
                              <i className="fas fa-image" style={{ fontSize: '2rem', marginBottom: '8px' }}></i>
                              <span style={{ fontSize: '0.7rem' }}>No Photo</span>
                            </div>
                          )}
                          {ocrVerified === 'verifying' && <div className="scanning-laser"></div>}
                        </div>
                      </div>

                      <VideoRecorder
                        label="Verification Video"
                        onRecordComplete={(blob) => handleVideoUpload('mayorIndigency_video', blob)}
                        initialVideoUrl={documentVideos.mayorIndigency_video || formData.mayorIndigency_video}
                        isUploading={Boolean(uploadingFields['mayorIndigency_video'])}
                        uploadProgress={uploadProgress['mayorIndigency_video']}
                        disabled={isAnyScanning || isSavingStep}
                        hideButton={true}
                        containerStyle={{ height: '240px', padding: '0.5rem', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
                        fieldName="mayorIndigency_video"
                      />
                    </div>

                    {(photos.mayorIndigency_photo || formData.mayorIndigency_photo) && (
                      <>
                        <button
                          type="button"
                          onClick={handleIndigencyScan}
                          disabled={isSavingStep || ocrVerified === 'verifying' || isAnyVideoUploading || !(documentVideos.mayorIndigency_video || formData.mayorIndigency_video)}
                          style={{
                            width: '100%',
                            padding: '0.9rem',
                            borderRadius: '16px',
                            background: ocrVerified === 'success' ? '#10b981' : (ocrVerified === 'verifying' ? '#3b82f6' : 'var(--primary)'),
                            color: 'white',
                            border: 'none',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '10px',
                            fontSize: '0.95rem',
                            fontWeight: '800',
                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                            boxShadow: ocrVerified === 'success' ? '0 10px 20px -5px rgba(16, 185, 129, 0.3)' : '0 10px 20px -5px rgba(79, 13, 0, 0.3)',
                            textTransform: 'uppercase',
                            letterSpacing: '1px',
                            marginTop: '1rem'
                          }}
                        >
                          <i className={`fas ${ocrVerified === 'verifying' ? 'fa-sync fa-spin' : 'fa-bolt'}`}></i>
                          {ocrVerified === 'verifying' ? 'Analyzing...' : (ocrVerified === 'success' ? 'Identity Verified' : 'Instant Scan & Validate')}
                        </button>

                        {ocrVerified === 'verifying' && (
                          <div style={{ width: '100%', height: '10px', background: '#f1f5f9', borderRadius: '10px', position: 'relative', overflow: 'hidden', border: '1px solid #e2e8f0', marginTop: '1rem' }}>
                            <div style={{ position: 'absolute', height: '100%', background: 'linear-gradient(90deg, var(--primary), #ff4d4d)', width: `${scanProgress}%`, transition: 'width 0.2s ease', borderRadius: '10px' }}></div>
                          </div>
                        )}

                        {ocrStatus && (
                          <div className={`validation-status-card ${ocrVerified === 'success' ? 'success' : (ocrVerified === 'failed' ? 'failed' : 'processing')}`} style={{ marginTop: '1rem' }}>
                            <div className={`status-icon ${ocrVerified === 'success' ? 'success' : (ocrVerified === 'failed' ? 'failed' : 'processing')}`}>
                              <i className={`fas ${ocrVerified === 'success' ? 'fa-check' : (ocrVerified === 'failed' ? 'fa-circle-xmark' : 'fa-magnifying-glass')}`}></i>
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                <p style={{ fontSize: '0.85rem', fontWeight: '700', margin: 0 }}>Verification Feedback</p>
                                {indigencyResults.length > 0 && (
                                  <div style={{
                                    fontSize: '0.75rem',
                                    fontWeight: '800',
                                    padding: '4px 10px',
                                    borderRadius: '10px',
                                    background: calculateVerificationPercentage(indigencyResults) === 100 ? '#dcfce7' : '#fee2e2',
                                    color: calculateVerificationPercentage(indigencyResults) === 100 ? '#15803d' : '#b91c1c'
                                  }}>
                                    {calculateVerificationPercentage(indigencyResults)}% Match
                                  </div>
                                )}
                              </div>
                              <p style={{ fontSize: '0.8rem', fontWeight: '500', opacity: 0.9, margin: 0, lineHeight: '1.5' }}>{ocrStatus}</p>
                              {renderInlineRequirementsChecklist('Indigency')}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="submit-btn"
                    onClick={handleNextStep}
                    disabled={isSavingStep || ocrVerified === 'verifying' || !isStep1DocumentsVerified}
                    style={{ width: 'auto', padding: '0.8rem 2.5rem', borderRadius: '40px' }}
                  >
                    Next: Family Background <i className="fas fa-arrow-right" style={{ marginLeft: '8px' }}></i>
                  </button>
                </div>
              </div>

              {/* Step 2: Family Background */}
              <div className={`step-container ${currentStep === 2 ? 'active' : ''}`}>
                <h3 style={{ marginBottom: '1.5rem', fontSize: '1.2rem', color: 'var(--primary)', fontWeight: '700', borderBottom: '2px solid var(--accent-soft)', paddingBottom: '0.5rem', display: 'flex', alignItems: 'center' }}>
                  <i className="fas fa-users" style={{ marginRight: '12px', fontSize: '1.1rem' }}></i>2. Family Background
                </h3>

                {/* Father Information */}
                <div style={{ marginBottom: '2rem' }}>
                  <h4 style={{ fontSize: '1rem', color: '#333', fontWeight: '600', marginBottom: '1rem', borderLeft: '3px solid var(--primary)', paddingLeft: '10px' }}>
                    Father's Information
                  </h4>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Status <span style={{ color: '#e74c3c' }}>*</span></label>
                      <select name="fatherStatus" value={formData.fatherStatus} onChange={handleInputChange} required={currentStep === 2}>
                        <option value="">Select Status</option>
                        <option value="Living">Living</option>
                        <option value="Deceased">Deceased</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Name <span style={{ color: '#e74c3c' }}>*</span></label>
                      <input type="text" name="fatherName" value={formData.fatherName} onChange={handleInputChange} placeholder="Full Name" required={currentStep === 2} />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Occupation <span style={{ color: '#e74c3c' }}>*</span></label>
                      <input type="text" name="fatherOccupation" value={formData.fatherOccupation} onChange={handleInputChange} placeholder="Occupation" required={currentStep === 2} />
                    </div>
                    <div className="form-group">
                      <label>Phone Number <span style={{ color: '#e74c3c' }}>*</span></label>
                      <input type="tel" name="fatherPhoneNumber" value={formData.fatherPhoneNumber} onChange={handleInputChange} placeholder="09XXXXXXXXX" required={currentStep === 2} />
                    </div>
                  </div>
                </div>

                {/* Mother Information */}
                <div style={{ marginBottom: '2rem' }}>
                  <h4 style={{ fontSize: '1rem', color: '#333', fontWeight: '600', marginBottom: '1rem', borderLeft: '3px solid var(--primary)', paddingLeft: '10px' }}>
                    Mother's Information
                  </h4>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Status <span style={{ color: '#e74c3c' }}>*</span></label>
                      <select name="motherStatus" value={formData.motherStatus} onChange={handleInputChange} required={currentStep === 2}>
                        <option value="">Select Status</option>
                        <option value="Living">Living</option>
                        <option value="Deceased">Deceased</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Name <span style={{ color: '#e74c3c' }}>*</span></label>
                      <input type="text" name="motherName" value={formData.motherName} onChange={handleInputChange} placeholder="Full Name" required={currentStep === 2} />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Occupation <span style={{ color: '#e74c3c' }}>*</span></label>
                      <input type="text" name="motherOccupation" value={formData.motherOccupation} onChange={handleInputChange} placeholder="Occupation" required={currentStep === 2} />
                    </div>
                    <div className="form-group">
                      <label>Phone Number <span style={{ color: '#e74c3c' }}>*</span></label>
                      <input type="tel" name="motherPhoneNumber" value={formData.motherPhoneNumber} onChange={handleInputChange} placeholder="09XXXXXXXXX" required={currentStep === 2} />
                    </div>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Number of Siblings <span style={{ color: '#e74c3c' }}>*</span></label>
                    <input type="number" name="numberOfSiblings" value={formData.numberOfSiblings} onChange={handleInputChange} placeholder="0" required={currentStep === 2} />
                  </div>
                  <div className="form-group">
                    <label>Parents' Gross Income <span style={{ color: '#e74c3c' }}>*</span></label>
                    <input type="number" name="parentsGrossIncome" value={formData.parentsGrossIncome} onChange={handleInputChange} placeholder="30000" min="0" required={currentStep === 2} />
                  </div>
                </div>


                <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'space-between' }}>
                  <button type="button" className="back-to-form-btn" onClick={handlePrevStep}>
                    <i className="fas fa-arrow-left" style={{ marginRight: '8px' }}></i> Back: Personal Info
                  </button>
                  <button type="button" className="submit-btn" onClick={handleNextStep} disabled={isSavingStep} style={{ width: 'auto', padding: '0.8rem 2.5rem', borderRadius: '40px' }}>
                    Next: Educational Info <i className="fas fa-arrow-right" style={{ marginLeft: '8px' }}></i>
                  </button>
                </div>
              </div>

              {/* Step 3: Educational Information */}
              <div className={`step-container ${currentStep === 3 ? 'active' : ''}`}>
                <h3 style={{ marginBottom: '1.5rem', fontSize: '1.2rem', color: 'var(--primary)', fontWeight: '700', borderBottom: '2px solid var(--accent-soft)', paddingBottom: '0.5rem', display: 'flex', alignItems: 'center' }}>
                  <i className="fas fa-graduation-cap" style={{ marginRight: '12px', fontSize: '1.1rem' }}></i>3. Educational Information
                </h3>

                <div className="form-row">
                  <div className="form-group">
                    <label>Full Name</label>
                    <input
                      type="text"
                      value={[formData.firstName, formData.middleName, formData.lastName].filter(Boolean).join(' ')}
                      readOnly
                      style={{ backgroundColor: '#f8fafc', color: '#64748b', cursor: 'not-allowed' }}
                    />
                  </div>
                </div>


                <div className="form-row">
                  <div className="form-group">
                    <label>School ID Number <span style={{ color: '#e74c3c' }}>*</span></label>
                    <input type="text" name="schoolIdNumber" value={formData.schoolIdNumber} onChange={handleInputChange} placeholder="ID Number" required={currentStep === 3} />
                  </div>
                  <div className="form-group">
                    <label>Name of School <span style={{ color: '#e74c3c' }}>*</span></label>
                    <input
                      type="text"
                      name="schoolName"
                      value={formData.schoolName}
                      readOnly
                      style={{ backgroundColor: '#f8fafc', color: '#64748b', cursor: 'not-allowed' }}
                      placeholder="School Name"
                      required={currentStep === 3}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>School Address <span style={{ color: '#e74c3c' }}>*</span></label>
                  <input type="text" name="schoolAddress" value={formData.schoolAddress} onChange={handleInputChange} placeholder="Complete School Address" required={currentStep === 3} />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>School Sector <span style={{ color: '#e74c3c' }}>*</span></label>
                    <select name="schoolSector" value={formData.schoolSector} onChange={handleInputChange} required={currentStep === 3}>
                      <option value="">Select Sector</option>
                      <option value="Public">Public</option>
                      <option value="Private">Private</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Year Level <span style={{ color: '#e74c3c' }}>*</span></label>
                    <select name="yearLevel" value={formData.yearLevel} onChange={handleInputChange} required={currentStep === 3}>
                      <option value="">Select Year</option>
                      {[1, 2, 3, 4, 5].map(yr => <option key={yr} value={`${yr}${yr === 1 ? 'st' : yr === 2 ? 'nd' : yr === 3 ? 'rd' : 'th'} Year`}>{yr}{yr === 1 ? 'st' : yr === 2 ? 'nd' : yr === 3 ? 'rd' : 'th'} Year</option>)}
                    </select>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Course/Program <span style={{ color: '#e74c3c' }}>*</span></label>
                    <input
                      type="text"
                      name="course"
                      value={formData.course}
                      onChange={handleInputChange}
                      placeholder="e.g. BS Information Technology"
                      required={currentStep === 3}
                    />
                  </div>
                  <div className="form-group">
                    <label>General Weighted Average / GPA <span style={{ color: '#e74c3c' }}>*</span></label>
                    <input
                      type="number"
                      name="gpa"
                      value={formData.gpa}
                      readOnly
                      style={{ backgroundColor: '#f8fafc', color: '#64748b', cursor: 'not-allowed' }}
                      placeholder="GPA pre-filled from profile"
                      step="0.01"
                      required={currentStep === 3}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Merits and Awards Received <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 'normal' }}>(Optional)</span></label>
                    <textarea
                      name="meritsAwardsReceived"
                      value={formData.meritsAwardsReceived}
                      onChange={handleInputChange}
                      placeholder="List your academic awards, leadership roles, or special recognitions here..."
                      style={{
                        width: '100%',
                        minHeight: '80px',
                        padding: '0.8rem',
                        borderRadius: '12px',
                        border: '1px solid #cbd5e1',
                        fontSize: '0.9rem',
                        fontFamily: 'inherit',
                        resize: 'vertical'
                      }}
                    />
                  </div>
                </div>

                <div style={{
                  marginBottom: '1.5rem',
                  padding: '1rem 1.1rem',
                  borderRadius: '18px',
                  background: 'linear-gradient(135deg, #fff7ed, #ffffff)',
                  border: '1px solid #fed7aa',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: '0.85rem'
                }}>
                  {[
                    '1. Upload front and back ID photos.',
                    '2. Record a clear front and back ID video.',
                    '3. Run the ID scan to unlock COE and Grades.',
                    '4. Re-scan if name, ID number, year, or location changes.'
                  ].map((item) => (
                    <div key={item} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                      <i className="fas fa-circle-check" style={{ color: 'var(--primary)', marginTop: '3px' }}></i>
                      <span style={{ fontSize: '0.78rem', color: '#7c2d12', lineHeight: '1.45', fontWeight: '700' }}>{item}</span>
                    </div>
                  ))}
                </div>

                <div className="requirement-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem' }}>
                    <div>
                      <div className="step-subtitle">
                        Identity Verification (ID) <span style={{ color: '#e74c3c' }}>*</span>
                      </div>
                      <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '6px' }}>Current academic year ID for identity verification</p>
                    </div>
                    {(schoolIdPhotos.front || schoolIdPhotos.back) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: '#059669', fontWeight: '700', padding: '6px 14px', background: '#ecfdf5', borderRadius: '20px', border: '1px solid #a7f3d0' }}>
                        <i className="fas fa-check-circle"></i> Upload Ready
                      </div>
                    )}
                  </div>

                  <div className="media-grid">
                    {/* FRONT SIDE SECTION */}
                    <div className="preview-box" style={{ background: '#fff', borderStyle: 'solid' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem', paddingBottom: '0.8rem', borderBottom: '1px solid #f1f5f9' }}>
                        <h5 style={{ margin: 0, fontSize: '0.95rem', fontWeight: '800', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <i className="fas fa-id-card"></i> Front ID
                        </h5>
                        <div style={{ fontSize: '0.65rem', color: '#3b82f6', fontWeight: '800', background: '#eff6ff', padding: '3px 8px', borderRadius: '6px', border: '1px solid #bfdbfe' }}>REQUIRED</div>
                      </div>

                      {renderDocumentMediaPicker({
                        photoLabel: 'Front ID',
                        photoId: 'school_id_front_photo',
                        photoValue: schoolIdPhotos.front || formData.schoolIdFront,
                        onPhotoChange: (e) => handleSchoolIdPhotoUpload('front', e),
                        videoId: 'video_schoolIdFront_video',
                        videoName: 'schoolIdFront_video',
                        videoValue: documentVideos.schoolIdFront_video || formData.schoolIdFront_video,
                        onVideoChange: handleVideoUpload,
                        isUploadingVideo: Boolean(uploadingFields['schoolIdFront_video']),
                        isVerifying: idVerified === 'verifying'
                      })}

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '1.2rem' }}>
                        {/* Front Photo Preview */}
                        <div className="scanning-container">
                          <div className="image-container" style={{ height: '240px' }} onClick={() => setLightboxSrc(schoolIdPhotos.front || formData.schoolIdFront)}>
                            {(schoolIdPhotos.front || formData.schoolIdFront) ? (
                              <img src={schoolIdPhotos.front || formData.schoolIdFront} alt="Front ID" />
                            ) : (
                              <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', background: '#f8fafc' }}>
                                <i className="fas fa-image" style={{ fontSize: '2rem', marginBottom: '8px' }}></i>
                                <span style={{ fontSize: '0.7rem' }}>No Photo</span>
                              </div>
                            )}
                            {idVerified === 'verifying' && <div className="scanning-laser"></div>}
                          </div>
                        </div>

                        {/* Front Video Preview */}
                        <VideoRecorder
                          label="Front Check Video"
                          onRecordComplete={(blob) => handleVideoUpload('schoolIdFront_video', blob)}
                          initialVideoUrl={documentVideos.schoolIdFront_video || formData.schoolIdFront_video}
                          isUploading={Boolean(uploadingFields['schoolIdFront_video'])}
                          uploadProgress={uploadProgress['schoolIdFront_video']}
                          disabled={isAnyScanning || isSavingStep}
                          hideButton={true}
                          containerStyle={{ height: '240px', padding: '0.5rem', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
                          fieldName="schoolIdFront_video"
                        />
                      </div>

                      <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '14px', border: '1px solid #e2e8f0', display: 'flex', gap: '10px' }}>
                        <i className="fas fa-user-check" style={{ color: '#2563eb', fontSize: '1rem', marginTop: '2px' }}></i>
                        <p style={{ fontSize: '0.72rem', color: '#1e3a8a', margin: 0, lineHeight: '1.4' }}>
                          <b>Front side:</b> Keep your name area visible. This helps us confirm the student identity matches your profile.
                        </p>
                      </div>
                    </div>

                    {/* BACK SIDE SECTION */}
                    <div className="preview-box" style={{ background: '#fff', borderStyle: 'solid' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem', paddingBottom: '0.8rem', borderBottom: '1px solid #f1f5f9' }}>
                        <h5 style={{ margin: 0, fontSize: '0.95rem', fontWeight: '800', color: '#9a3412', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <i className="fas fa-id-card"></i> Back ID
                        </h5>
                        <div style={{ fontSize: '0.65rem', color: '#d97706', fontWeight: '800', background: '#fffbeb', padding: '3px 8px', borderRadius: '6px', border: '1px solid #fef3c7' }}>REQUIRED</div>
                      </div>

                      {renderDocumentMediaPicker({
                        photoId: 'school_id_back_photo',
                        photoValue: schoolIdPhotos.back || formData.schoolIdBack,
                        onPhotoChange: (e) => handleSchoolIdPhotoUpload('back', e),
                        videoId: 'video_schoolIdBack_video',
                        videoName: 'schoolIdBack_video',
                        videoValue: documentVideos.schoolIdBack_video || formData.schoolIdBack_video,
                        onVideoChange: handleVideoUpload,
                        isUploadingVideo: Boolean(uploadingFields['schoolIdBack_video']),
                        isVerifying: idVerified === 'verifying'
                      })}

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '1.2rem' }}>
                        {/* Back Photo Preview */}
                        <div className="scanning-container">
                          <div className="image-container" style={{ height: '240px' }} onClick={() => setLightboxSrc(schoolIdPhotos.back || formData.schoolIdBack)}>
                            {(schoolIdPhotos.back || formData.schoolIdBack) ? (
                              <img src={schoolIdPhotos.back || formData.schoolIdBack} alt="Back ID" />
                            ) : (
                              <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', background: '#f8fafc' }}>
                                <i className="fas fa-image" style={{ fontSize: '2rem', marginBottom: '8px' }}></i>
                                <span style={{ fontSize: '0.7rem' }}>No Photo</span>
                              </div>
                            )}
                            {idVerified === 'verifying' && <div className="scanning-laser"></div>}
                          </div>
                        </div>

                        {/* Back Video Preview */}
                        <VideoRecorder
                          label="Back Check Video"
                          onRecordComplete={(blob) => handleVideoUpload('schoolIdBack_video', blob)}
                          initialVideoUrl={documentVideos.schoolIdBack_video || formData.schoolIdBack_video}
                          isUploading={Boolean(uploadingFields['schoolIdBack_video'])}
                          uploadProgress={uploadProgress['schoolIdBack_video']}
                          disabled={isAnyScanning || isSavingStep}
                          hideButton={true}
                          containerStyle={{ height: '240px', padding: '0.5rem', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
                          fieldName="schoolIdBack_video"
                        />
                      </div>

                      <div style={{ padding: '12px', background: '#fffbeb', borderRadius: '14px', border: '1px solid #fef3c7', display: 'flex', gap: '10px' }}>
                        <i className="fas fa-school" style={{ color: '#d97706', fontSize: '1rem', marginTop: '2px' }}></i>
                        <p style={{ fontSize: '0.72rem', color: '#92400e', margin: 0, lineHeight: '1.4' }}>
                          <b>Back side:</b> Keep the year level or current validity details readable so we can confirm the ID is for your present school year.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* ID Action Footer (Button & Status) */}
                  <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px dashed #e2e8f0' }}>
                    <button
                      type="button"
                      onClick={handleIdScan}
                      disabled={
                        isSavingStep || idVerified === 'verifying' || isAnyVideoUploading ||
                        !(schoolIdPhotos.front || formData.schoolIdFront) ||
                        !(schoolIdPhotos.back || formData.schoolIdBack) ||
                        !(documentVideos.schoolIdFront_video || formData.schoolIdFront_video) ||
                        !(documentVideos.schoolIdBack_video || formData.schoolIdBack_video)
                      }
                      style={{
                        width: '100%',
                        padding: '1rem',
                        borderRadius: '18px',
                        background: idVerified === 'success' ? '#10b981' : (idVerified === 'verifying' ? '#3b82f6' : 'var(--primary)'),
                        color: 'white',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '12px',
                        fontSize: '1rem',
                        fontWeight: '800',
                        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                        boxShadow: idVerified === 'success' ? '0 10px 25px -5px rgba(16, 185, 129, 0.3)' : '0 10px 25px -5px rgba(79, 13, 0, 0.3)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}
                    >
                      <i className={`fas ${idVerified === 'verifying' ? 'fa-sync fa-spin' : 'fa-bolt-lightning'}`}></i>
                      {idVerified === 'verifying' ? 'Analyzing Front & Back ID...' : (idVerified === 'success' ? 'Identity Verified Successfully' : 'Start Front & Back ID Scan')}
                    </button>

                    {idVerified === 'verifying' && (
                      <div style={{ width: '100%', height: '8px', background: '#f1f5f9', borderRadius: '10px', marginTop: '1rem', position: 'relative', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                        <div style={{ position: 'absolute', height: '100%', background: 'linear-gradient(90deg, var(--primary), #ff4d4d)', width: `${scanProgress}%`, transition: 'width 0.2s ease', borderRadius: '10px' }}></div>
                      </div>
                    )}

                    {idStatus && (
                      <div className={`validation-status-card ${idVerified === 'success' ? 'success' : (idVerified === 'failed' ? 'failed' : 'processing')}`} style={{ marginTop: '1.2rem' }}>
                        <div className={`status-icon ${idVerified === 'success' ? 'success' : (idVerified === 'failed' ? 'failed' : 'processing')}`}>
                          <i className={`fas ${idVerified === 'success' ? 'fa-check' : (idVerified === 'failed' ? 'fa-circle-xmark' : 'fa-magnifying-glass')}`}></i>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                            <p style={{ fontSize: '0.85rem', fontWeight: '800', margin: 0 }}>Verification Engine Result</p>
                            {idResults.length > 0 && (
                              <div style={{
                                fontSize: '0.75rem',
                                fontWeight: '800',
                                padding: '4px 10px',
                                borderRadius: '10px',
                                background: calculateVerificationPercentage(idResults) === 100 ? '#dcfce7' : '#fee2e2',
                                color: calculateVerificationPercentage(idResults) === 100 ? '#15803d' : '#b91c1c'
                              }}>
                                {calculateVerificationPercentage(idResults)}% Match
                              </div>
                            )}
                          </div>
                          <p style={{ fontSize: '0.8rem', fontWeight: '500', opacity: 0.9, margin: 0, lineHeight: '1.5' }}>{idStatus}</p>
                          {renderInlineRequirementsChecklist('SchoolID')}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Documentary Requirements: COE and Grades */}
                {idVerified === 'success' ? (
                  <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                    <div className="requirement-card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem' }}>
                        <div>
                          <h4 style={{ fontSize: '1.15rem', color: '#1a202c', fontWeight: '800', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div style={{ width: '36px', height: '36px', background: 'var(--accent-soft)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <i className="fas fa-file-signature" style={{ color: 'var(--primary)', fontSize: '1.1rem' }}></i>
                            </div>
                            Certificate of Enrollment <span style={{ color: '#e74c3c' }}>*</span>
                          </h4>
                          <p style={{ fontSize: '0.85rem', color: '#e74c3c', marginTop: '6px', marginLeft: '46px' }}>Note: Current semester registration form or COE</p>
                        </div>
                        {(photos.mayorCOE_photo || formData.mayorCOE_photo) && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: '#059669', fontWeight: '700', padding: '6px 14px', background: '#ecfdf5', borderRadius: '20px', border: '1px solid #a7f3d0' }}>
                            <i className="fas fa-check-circle"></i> Upload Ready
                          </div>
                        )}
                      </div>

                      <div className="preview-box" style={{ background: '#fff', borderStyle: 'solid' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', color: '#334155' }}>COE Media Check</label>
                          <div style={{ fontSize: '0.65rem', color: '#ef4444', fontWeight: '800', background: '#fef2f2', padding: '3px 8px', borderRadius: '6px', border: '1px solid #fecaca' }}>PHOTO + VIDEO</div>
                        </div>

                        {renderDocumentMediaPicker({
                          photoId: 'photo_mayorCOE_photo',
                          photoName: 'mayorCOE_photo',
                          photoValue: photos.mayorCOE_photo || formData.mayorCOE_photo,
                          onPhotoChange: handleInputChange,
                          videoId: 'video_mayorCOE_video',
                          videoName: 'mayorCOE_video',
                          videoValue: documentVideos.mayorCOE_video || formData.mayorCOE_video,
                          onVideoChange: handleVideoUpload,
                          isUploadingVideo: Boolean(uploadingFields['mayorCOE_video']),
                          isVerifying: coeVerified === 'verifying'
                        })}

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '1.2rem' }}>
                          <div className="scanning-container">
                            <div className="image-container" style={{ height: '240px' }} onClick={() => (photos.mayorCOE_photo || formData.mayorCOE_photo) && setLightboxSrc(photos.mayorCOE_photo || formData.mayorCOE_photo)}>
                              {(photos.mayorCOE_photo || formData.mayorCOE_photo) ? (
                                <img src={photos.mayorCOE_photo || formData.mayorCOE_photo} style={{ objectFit: 'contain', background: '#000' }} alt="COE Preview" />
                              ) : (
                                <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', background: '#f8fafc' }}>
                                  <i className="fas fa-image" style={{ fontSize: '2rem', marginBottom: '8px' }}></i>
                                  <span style={{ fontSize: '0.7rem' }}>No Photo</span>
                                </div>
                              )}
                              {coeVerified === 'verifying' && <div className="scanning-laser"></div>}
                            </div>
                          </div>

                          <VideoRecorder
                            label="COE Verification Video"
                            onRecordComplete={(blob) => handleVideoUpload('mayorCOE_video', blob)}
                            initialVideoUrl={documentVideos.mayorCOE_video || formData.mayorCOE_video}
                            isUploading={Boolean(uploadingFields['mayorCOE_video'])}
                            uploadProgress={uploadProgress['mayorCOE_video']}
                            disabled={isAnyScanning || isSavingStep}
                            hideButton={true}
                            containerStyle={{ height: '240px', padding: '0.5rem', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
                            fieldName="mayorCOE_video"
                          />
                        </div>

                        {(photos.mayorCOE_photo || formData.mayorCOE_photo) && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <button
                              type="button"
                              onClick={handleCOEScan}
                              disabled={isSavingStep || coeVerified === 'verifying' || isAnyVideoUploading || !(documentVideos.mayorCOE_video || formData.mayorCOE_video)}
                              style={{
                                width: '100%',
                                padding: '0.85rem',
                                borderRadius: '14px',
                                background: coeVerified === 'success' ? '#10b981' : (coeVerified === 'verifying' ? '#3b82f6' : 'var(--primary)'),
                                color: 'white',
                                border: 'none',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '10px',
                                fontSize: '0.9rem',
                                fontWeight: '800',
                                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                boxShadow: coeVerified === 'success' ? '0 10px 15px -5px rgba(16, 185, 129, 0.2)' : '0 10px 15px -5px rgba(79, 13, 0, 0.2)',
                                textTransform: 'uppercase'
                              }}
                            >
                              <i className={`fas ${coeVerified === 'verifying' ? 'fa-sync fa-spin' : 'fa-magnifying-glass'}`}></i>
                              {coeVerified === 'verifying' ? 'Reviewing...' : (coeVerified === 'success' ? 'COE Verified' : 'Rapid COE Scan')}
                            </button>

                            {coeVerified === 'verifying' && (
                              <div style={{ width: '100%', height: '10px', background: '#f1f5f9', borderRadius: '10px', position: 'relative', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                                <div style={{ position: 'absolute', height: '100%', background: 'linear-gradient(90deg, var(--primary), #ff4d4d)', width: `${scanProgress}%`, transition: 'width 0.2s ease', borderRadius: '10px' }}></div>
                              </div>
                            )}

                            {coeStatus && (
                              <div className={`validation-status-card ${coeVerified === 'success' ? 'success' : (coeVerified === 'failed' ? 'failed' : 'processing')}`}>
                                <div className={`status-icon ${coeVerified === 'success' ? 'success' : (coeVerified === 'failed' ? 'failed' : 'processing')}`}>
                                  <i className={`fas ${coeVerified === 'success' ? 'fa-check' : (coeVerified === 'failed' ? 'fa-circle-xmark' : 'fa-info-circle')}`}></i>
                                </div>
                                <div style={{ flex: 1 }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                    <p style={{ fontSize: '0.8rem', fontWeight: '700', margin: 0 }}>Verification Result</p>
                                    {coeResults.length > 0 && (
                                      <div style={{
                                        fontSize: '0.75rem',
                                        fontWeight: '800',
                                        padding: '4px 10px',
                                        borderRadius: '10px',
                                        background: calculateVerificationPercentage(coeResults) === 100 ? '#dcfce7' : '#fee2e2',
                                        color: calculateVerificationPercentage(coeResults) === 100 ? '#15803d' : '#b91c1c'
                                      }}>
                                        {calculateVerificationPercentage(coeResults)}% Match
                                      </div>
                                    )}
                                  </div>
                                  <p style={{ fontSize: '0.8rem', fontWeight: '500', opacity: 0.9, margin: 0, lineHeight: '1.4' }}>{coeStatus}</p>
                                  {renderInlineRequirementsChecklist('Enrollment')}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {coeVerified === 'success' ? (
                      <div className="requirement-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem' }}>
                          <div>
                            <h4 style={{ fontSize: '1.15rem', color: '#1a202c', fontWeight: '800', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <div style={{ width: '36px', height: '36px', background: 'var(--accent-soft)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <i className="fas fa-star" style={{ color: 'var(--primary)', fontSize: '1.1rem' }}></i>
                              </div>
                              Academic Grades <span style={{ color: '#e74c3c' }}>*</span>
                            </h4>
                            <p style={{ fontSize: '0.85rem', color: '#e74c3c', marginTop: '6px', marginLeft: '46px' }}>Note: Previous semester report card or transcript</p>
                          </div>
                          {(photos.mayorGrades_photo || formData.mayorGrades_photo) && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: '#059669', fontWeight: '700', padding: '6px 14px', background: '#ecfdf5', borderRadius: '20px', border: '1px solid #a7f3d0' }}>
                              <i className="fas fa-check-circle"></i> Upload Ready
                            </div>
                          )}
                        </div>

                        <div className="preview-box" style={{ background: '#fff', borderStyle: 'solid' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', color: '#334155' }}>Academic Media Check</label>
                            <div style={{ fontSize: '0.65rem', color: '#ef4444', fontWeight: '800', background: '#fef2f2', padding: '3px 8px', borderRadius: '6px', border: '1px solid #fecaca' }}>PHOTO + VIDEO</div>
                          </div>

                          {renderDocumentMediaPicker({
                            photoId: 'photo_mayorGrades_photo',
                            photoName: 'mayorGrades_photo',
                            photoValue: photos.mayorGrades_photo || formData.mayorGrades_photo,
                            onPhotoChange: handleInputChange,
                            videoId: 'video_mayorGrades_video',
                            videoName: 'mayorGrades_video',
                            videoValue: documentVideos.mayorGrades_video || formData.mayorGrades_video,
                            onVideoChange: handleVideoUpload,
                            isUploadingVideo: Boolean(uploadingFields['mayorGrades_video']),
                            isVerifying: gradesVerified === 'verifying'
                          })}

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '1.2rem' }}>
                            <div className="scanning-container">
                              <div className="image-container" style={{ height: '240px' }} onClick={() => (photos.mayorGrades_photo || formData.mayorGrades_photo) && setLightboxSrc(photos.mayorGrades_photo || formData.mayorGrades_photo)}>
                                {(photos.mayorGrades_photo || formData.mayorGrades_photo) ? (
                                  <img src={photos.mayorGrades_photo || formData.mayorGrades_photo} style={{ objectFit: 'contain', background: '#000' }} alt="Grades Preview" />
                                ) : (
                                  <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', background: '#f8fafc' }}>
                                    <i className="fas fa-image" style={{ fontSize: '2rem', marginBottom: '8px' }}></i>
                                    <span style={{ fontSize: '0.7rem' }}>No Photo</span>
                                  </div>
                                )}
                                {gradesVerified === 'verifying' && <div className="scanning-laser"></div>}
                              </div>
                            </div>

                            <VideoRecorder
                              label="Grades Verification Video"
                              onRecordComplete={(blob) => handleVideoUpload('mayorGrades_video', blob)}
                              initialVideoUrl={documentVideos.mayorGrades_video || formData.mayorGrades_video}
                              isUploading={Boolean(uploadingFields['mayorGrades_video'])}
                              uploadProgress={uploadProgress['mayorGrades_video']}
                              disabled={isAnyScanning || isSavingStep}
                              hideButton={true}
                              containerStyle={{ height: '240px', padding: '0.5rem', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
                              fieldName="mayorGrades_video"
                            />
                          </div>

                          {(photos.mayorGrades_photo || formData.mayorGrades_photo) && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                              <button
                                type="button"
                                onClick={handleGradesScan}
                                disabled={isSavingStep || gradesVerified === 'verifying' || isAnyVideoUploading || !(documentVideos.mayorGrades_video || formData.mayorGrades_video)}
                                style={{
                                  width: '100%',
                                  padding: '0.85rem',
                                  borderRadius: '14px',
                                  background: gradesVerified === 'success' ? '#10b981' : (gradesVerified === 'verifying' ? '#3b82f6' : 'var(--primary)'),
                                  color: 'white',
                                  border: 'none',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '10px',
                                  fontSize: '0.9rem',
                                  fontWeight: '800',
                                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                  boxShadow: gradesVerified === 'success' ? '0 10px 15px -5px rgba(16, 185, 129, 0.2)' : '0 10px 15px -5px rgba(79, 13, 0, 0.2)',
                                  textTransform: 'uppercase'
                                }}
                              >
                                <i className={`fas ${gradesVerified === 'verifying' ? 'fa-sync fa-spin' : 'fa-clipboard-check'}`}></i>
                                {gradesVerified === 'verifying' ? 'Analyzing...' : (gradesVerified === 'success' ? 'Grades Verified' : 'Rapid Grades Scan')}
                              </button>

                              {gradesVerified === 'verifying' && (
                                <div style={{ width: '100%', height: '10px', background: '#f1f5f9', borderRadius: '10px', position: 'relative', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                                  <div style={{ position: 'absolute', height: '100%', background: 'linear-gradient(90deg, var(--primary), #ff4d4d)', width: `${scanProgress}%`, transition: 'width 0.2s ease', borderRadius: '10px' }}></div>
                                </div>
                              )}

                              {gradesStatus && (
                                <div className={`validation-status-card ${gradesVerified === 'success' ? 'success' : (gradesVerified === 'failed' ? 'failed' : 'processing')}`}>
                                  <div className={`status-icon ${gradesVerified === 'success' ? 'success' : (gradesVerified === 'failed' ? 'failed' : 'processing')}`}>
                                    <i className={`fas ${gradesVerified === 'success' ? 'fa-check' : (gradesVerified === 'failed' ? 'fa-circle-xmark' : 'fa-info-circle')}`}></i>
                                  </div>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                      <p style={{ fontSize: '0.8rem', fontWeight: '700', margin: 0 }}>Verification Result</p>
                                      {gradesResults.length > 0 && (
                                        <div style={{
                                          fontSize: '0.75rem',
                                          fontWeight: '800',
                                          padding: '4px 10px',
                                          borderRadius: '10px',
                                          background: calculateVerificationPercentage(gradesResults) === 100 ? '#dcfce7' : '#fee2e2',
                                          color: calculateVerificationPercentage(gradesResults) === 100 ? '#15803d' : '#b91c1c'
                                        }}>
                                          {calculateVerificationPercentage(gradesResults)}% Match
                                        </div>
                                      )}
                                    </div>
                                    <p style={{ fontSize: '0.8rem', fontWeight: '500', opacity: 0.9, margin: 0, lineHeight: '1.4' }}>{gradesStatus}</p>
                                    {renderInlineRequirementsChecklist('Grades')}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div style={{
                        marginTop: '0.5rem',
                        padding: '2.5rem 1.5rem',
                        background: '#f8fafc',
                        borderRadius: '28px',
                        border: '1.5px dashed #e2e8f0',
                        textAlign: 'center',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '12px',
                        animation: 'fadeIn 0.5s ease'
                      }}>
                        <div style={{ width: '64px', height: '64px', background: 'white', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 16px rgba(0,0,0,0.04)', marginBottom: '4px' }}>
                          <i className="fas fa-file-shield" style={{ color: '#94a3b8', fontSize: '1.4rem' }}></i>
                        </div>
                        <h4 style={{ fontSize: '1.1rem', color: '#334155', fontWeight: '800', margin: 0 }}>Grades Locked</h4>
                        <p style={{ fontSize: '0.85rem', color: '#64748b', maxWidth: '320px', margin: 0, lineHeight: '1.5' }}>
                          Please complete the <b>Certificate of Enrollment verification</b> above before submitting your Grades.
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{
                    marginTop: '1.5rem',
                    padding: '2.5rem 1.5rem',
                    background: '#f8fafc',
                    borderRadius: '28px',
                    border: '1.5px dashed #e2e8f0',
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '12px',
                    animation: 'fadeIn 0.5s ease'
                  }}>
                    <div style={{ width: '64px', height: '64px', background: 'white', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 16px rgba(0,0,0,0.04)', marginBottom: '4px' }}>
                      <i className="fas fa-file-shield" style={{ color: '#94a3b8', fontSize: '1.4rem' }}></i>
                    </div>
                    <h4 style={{ fontSize: '1.1rem', color: '#334155', fontWeight: '800', margin: 0 }}>Document Uploads Locked</h4>
                    <p style={{ fontSize: '0.85rem', color: '#64748b', maxWidth: '320px', margin: 0, lineHeight: '1.5' }}>
                      Please complete the <b>Updated School ID verification</b> above first. Once verified, the COE and Academic Grades sections will automatically appear.
                    </p>
                  </div>
                )}

                <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'space-between' }}>
                  <button type="button" className="back-to-form-btn" onClick={handlePrevStep}>
                    <i className="fas fa-arrow-left" style={{ marginRight: '8px' }}></i> Back: Family Background
                  </button>
                  <button
                    type="button"
                    className="submit-btn"
                    onClick={handleNextStep}
                    disabled={isSavingStep || coeVerified === 'verifying' || gradesVerified === 'verifying' || idVerified === 'verifying' || !isStep3DocumentsVerified}
                    style={{ width: 'auto', padding: '0.8rem 2.5rem', borderRadius: '40px' }}
                  >
                    Next: Certification & Verification <i className="fas fa-arrow-right" style={{ marginLeft: '8px' }}></i>
                  </button>
                </div>
              </div>

              {/* Step 4: Certification and Verification */}
              <div className={`step-container ${currentStep === 4 ? 'active' : ''}`}>
                <h3 style={{ marginBottom: '1.5rem', fontSize: '1.2rem', color: 'var(--primary)', fontWeight: '700', borderBottom: '2px solid var(--accent-soft)', paddingBottom: '0.5rem', display: 'flex', alignItems: 'center' }}>
                  <i className="fas fa-check-double" style={{ marginRight: '12px', fontSize: '1.1rem' }}></i>4. Certification & Verification
                </h3>

                <div style={{ background: '#f8f9fa', padding: '1.5rem', borderRadius: '16px', marginBottom: '2rem', border: '1px solid #e9ecef' }}>
                  <h4 style={{ fontSize: '0.95rem', fontWeight: '700', color: '#333', marginBottom: '1rem' }}>Privacy Consent & Certification</h4>
                  <div style={{ fontSize: '0.85rem', color: '#555', lineHeight: '1.6', maxHeight: '150px', overflowY: 'auto', paddingRight: '10px', marginBottom: '1rem' }}>
                    I hereby certify that all information provided in this application is true and correct to the best of my knowledge and belief. I understand that any false statement or simulation of information shall be a ground for the reproduction or cancellation of my scholarship. I also authorize the scholarship committee to verify the information provided herein.
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.9rem', color: '#333', cursor: 'pointer', fontWeight: '600', marginTop: '10px' }}>
                    <input type="checkbox" name="dataCertifyConsent" checked={formData.dataCertifyConsent} onChange={handleInputChange} style={{ width: '18px', height: '18px' }} required={currentStep === 4} />
                    I certify that the information provided is correct
                  </label>
                </div>

                {/* Signature Section */}
                <div style={{ marginBottom: '2rem' }}>
                  <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: '700', color: '#333', marginBottom: '1rem' }}>
                    Signature & Additional Identification <span style={{ color: '#e74c3c' }}>*</span>
                  </label>

                  {/* Reference Back ID Card */}
                  <div style={{ background: '#fff', padding: '1.2rem', borderRadius: '16px', border: '1px solid #e1e8f0', marginBottom: '1.5rem', boxShadow: '0 4px 15px rgba(0,0,0,0.03)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                      <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '800', color: '#1a202c' }}>REFERENCE SOURCE</label>
                      <div style={{ fontSize: '0.65rem', color: '#6366f1', fontWeight: '800', background: '#eef2ff', padding: '3px 8px', borderRadius: '6px' }}>BACK ID</div>
                    </div>
                    <div style={{ height: '220px', border: '2px dashed #cbd5e1', borderRadius: '15px', overflow: 'hidden', background: '#f8fafc', position: 'relative' }}>
                      {(schoolIdPhotos.back || formData.schoolIdBack) ? (
                        <img src={schoolIdPhotos.back || formData.schoolIdBack} style={{ width: '100%', height: '100%', objectFit: 'contain' }} alt="Reference Back ID" />
                      ) : (
                        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', textAlign: 'center', padding: '1rem' }}>
                          <i className="fas fa-id-card" style={{ fontSize: '2rem', marginBottom: '10px' }}></i>
                          <p style={{ fontSize: '0.75rem', fontWeight: '600', margin: 0 }}>Back ID Not Available<br /><span style={{ fontSize: '0.65rem', fontWeight: 'normal' }}>Please upload in Step 3</span></p>
                        </div>
                      )}
                    </div>
                    <p style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.75rem', fontStyle: 'italic', textAlign: 'center' }}>We will match your drawn signature against the official signature on the back of your ID.</p>
                  </div>

                  <div style={{ display: 'block' }}>
                    {/* Signature Column */}
                    <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: '16px', padding: '1.5rem', textAlign: 'center', width: '100%' }}>
                      <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', color: '#666', marginBottom: '1rem' }}>Drawer Signature</label>
                      {!showSignaturePad && !formData.applicantSignatureName ? (
                        <button type="button" onClick={() => setShowSignaturePad(true)} className="photo-option-btn" style={{ margin: '0 auto' }}>
                          <i className="fas fa-pen-nib"></i> Sign Application
                        </button>
                      ) : showSignaturePad ? (
                        <div style={{ width: '100%', maxWidth: '800px', margin: '0 auto' }}>
                          <div ref={signatureContainerRef} style={{ border: '1.5px solid #eee', borderRadius: '12px', background: '#fcfcfc', marginBottom: '1rem', overflow: 'hidden', height: '180px' }}>
                            <SignaturePad
                              ref={sigPad}
                              canvasProps={{
                                className: 'sigCanvas',
                                style: { width: '100%', height: '100%', display: 'block' }
                              }}
                            />
                          </div>
                          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                            <button type="button" onClick={clearSignature} className="back-to-form-btn" style={{ padding: '0.4rem 1rem', fontSize: '0.8rem' }}>Clear</button>
                            <button type="button" onClick={saveSignature} className="submit-btn" style={{ width: 'auto', padding: '0.4rem 1.2rem', height: 'auto', fontSize: '0.8rem' }}>Save</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ width: '100%', maxWidth: '800px', margin: '0 auto' }}>
                          <div className="signature-preview-box" style={{ maxWidth: '100%' }}>
                            <img src={formData.applicantSignatureName} alt="Signature" style={{ maxHeight: '120px' }} />
                            {!isAnyScanning && <button type="button" onClick={() => setShowSignaturePad(true)} style={{ position: 'absolute', top: '5px', right: '5px', background: 'rgba(0,0,0,0.5)', color: 'white', border: 'none', borderRadius: '50%', width: '24px', height: '24px', cursor: 'pointer' }}><i className="fas fa-undo"></i></button>}
                          </div>

                          <div style={{ marginTop: '1rem' }}>
                            <button
                              type="button"
                              onClick={handleSignatureScan}
                              disabled={signatureVerified === 'verifying' || !(schoolIdPhotos.back || formData.schoolIdBack)}
                              style={{
                                width: '100%',
                                padding: '0.6rem',
                                borderRadius: '10px',
                                background: signatureVerified === 'success' ? '#10b981' : (signatureVerified === 'verifying' ? '#3b82f6' : 'var(--primary)'),
                                color: 'white',
                                border: 'none',
                                cursor: 'pointer',
                                fontSize: '0.8rem',
                                fontWeight: '700',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                transition: 'all 0.2s ease'
                              }}
                            >
                              <i className={`fas ${signatureVerified === 'verifying' ? 'fa-spinner fa-spin' : (signatureVerified === 'success' ? 'fa-check-circle' : 'fa-signature')}`}></i>
                              {signatureVerified === 'verifying' ? 'Matching...' : (signatureVerified === 'success' ? 'Verified!' : 'Verify Handwriting')}
                            </button>

                            {signatureResults && (
                              <div style={{
                                marginTop: '20px',
                                background: '#f8fafc',
                                border: '1px solid #e2e8f0',
                                borderRadius: '16px',
                                padding: '1.2rem',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
                              }}>
                                <h5 style={{ margin: '0 0 10px 0', fontSize: '0.85rem', fontWeight: '800', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <i className="fas fa-signature" style={{ color: 'var(--primary)' }}></i> AUTHENTICITY ANALYSIS
                                </h5>

                                <div style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '10px',
                                  marginBottom: '15px'
                                }}>
                                  <div style={{
                                    background: signatureResults.verified ? '#10b981' : '#ef4444',
                                    color: 'white',
                                    fontSize: '0.65rem',
                                    fontWeight: '900',
                                    padding: '4px 10px',
                                    borderRadius: '20px',
                                    letterSpacing: '0.5px'
                                  }}>
                                    {signatureResults.verified ? 'VERIFIED' : 'MISMATCH'}
                                  </div>
                                  <div style={{ fontSize: '0.75rem', fontWeight: '700', color: '#64748b' }}>
                                    Confidence Score: {signatureResults.confidence.toFixed(1)}%
                                  </div>
                                </div>

                                <div style={{
                                  display: 'grid',
                                  gridTemplateColumns: '1fr 1fr',
                                  gap: '12px',
                                  marginBottom: '15px'
                                }}>
                                  <div style={{ textAlign: 'center' }}>
                                    <span style={{ fontSize: '0.6rem', color: '#94a3b8', display: 'block', marginBottom: '4px', fontWeight: '700' }}>ORIGINAL (ID)</span>
                                    <div style={{ background: 'white', border: '1px solid #f1f5f9', borderRadius: '8px', padding: '6px', height: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                      <img src={signatureResults.extracted_signature} alt="ID Signature" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                                    </div>
                                  </div>
                                  <div style={{ textAlign: 'center' }}>
                                    <span style={{ fontSize: '0.6rem', color: '#94a3b8', display: 'block', marginBottom: '4px', fontWeight: '700' }}>LIVE CAPTURE</span>
                                    <div style={{ background: 'white', border: '1px solid #f1f5f9', borderRadius: '8px', padding: '6px', height: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                      <img src={signatureResults.processed_submitted} alt="Live Signature" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                                    </div>
                                  </div>
                                </div>

                                <div style={{ marginBottom: '15px' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                    <span style={{ fontSize: '0.65rem', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>MATCHER ZOOM (Normalized for comparison)</span>
                                    <div style={{ fontSize: '0.6rem', color: '#3b82f6', background: '#eff6ff', padding: '2px 6px', borderRadius: '4px', fontWeight: '700' }}>ALGORITHM VIEW</div>
                                  </div>
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px', textAlign: 'center' }}>
                                      <p style={{ fontSize: '0.55rem', color: '#94a3b8', marginBottom: '4px', fontWeight: '700' }}>SUBMITTED</p>
                                      {signatureResults.matcher_submitted ? (
                                        <img src={signatureResults.matcher_submitted} alt="Matcher Sub" style={{ width: '100%', height: '50px', objectFit: 'contain' }} />
                                      ) : <div style={{ height: '50px', background: '#eee' }}></div>}
                                    </div>
                                    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px', textAlign: 'center' }}>
                                      <p style={{ fontSize: '0.55rem', color: '#94a3b8', marginBottom: '4px', fontWeight: '700' }}>REFERENCE</p>
                                      {signatureResults.matcher_reference ? (
                                        <img src={signatureResults.matcher_reference} alt="Matcher Ref" style={{ width: '100%', height: '50px', objectFit: 'contain' }} />
                                      ) : <div style={{ height: '50px', background: '#eee' }}></div>}
                                    </div>
                                  </div>
                                </div>

                                <div style={{
                                  background: 'white',
                                  padding: '10px',
                                  borderRadius: '10px',
                                  borderLeft: `3px solid ${signatureResults.verified ? '#10b981' : '#ef4444'}`,
                                  fontSize: '0.7rem',
                                  color: '#475569',
                                  lineHeight: '1.4',
                                  marginBottom: '15px'
                                }}>
                                  {signatureResults.message}
                                </div>

                                {/* Complexity Metrics */}
                                <div style={{ marginBottom: '15px' }}>
                                  <span style={{ fontSize: '0.65rem', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: '8px', textAlign: 'left' }}>Complexity Metrics</span>
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '6px 10px', textAlign: 'center' }}>
                                      <p style={{ fontSize: '0.55rem', color: '#94a3b8', margin: '0 0 2px 0', fontWeight: '700' }}>INK MASS</p>
                                      <p style={{ fontSize: '0.75rem', fontWeight: '700', color: '#1e293b', margin: 0 }}>{signatureStats.inkMass} px</p>
                                    </div>
                                    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '6px 10px', textAlign: 'center' }}>
                                      <p style={{ fontSize: '0.55rem', color: '#94a3b8', margin: '0 0 2px 0', fontWeight: '700' }}>JUNCTIONS</p>
                                      <p style={{ fontSize: '0.75rem', fontWeight: '700', color: '#1e293b', margin: 0 }}>{signatureStats.junctions}</p>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Face Verification Section */}
                {signatureVerified === 'success' ? (
                  <div style={{ marginBottom: '2rem', background: '#f0f7ff', padding: '1.5rem', borderRadius: '20px', border: '1px solid #e1e8f0', animation: 'fadeIn 0.5s ease' }}>
                    <h4 style={{ fontSize: '1rem', color: '#333', fontWeight: '700', marginBottom: '0.5rem', borderLeft: '4px solid var(--primary)', paddingLeft: '12px' }}>
                      Final Identity Verification <span style={{ color: '#e74c3c' }}>*</span>
                    </h4>
                    <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '1.2rem', paddingLeft: '16px' }}>Match captured photo with your School ID</p>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2rem', alignItems: 'flex-start' }}>
                      {/* Reference ID Column */}
                      <div style={{ background: '#fff', padding: '1.2rem', borderRadius: '20px', border: '1px solid #e1e8f0', boxShadow: '0 4px 15px rgba(0,0,0,0.03)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '800', color: '#1a202c' }}>REFERENCE SOURCE</label>
                          <div style={{ fontSize: '0.65rem', color: '#6366f1', fontWeight: '800', background: '#eef2ff', padding: '3px 8px', borderRadius: '6px' }}>FRONT ID</div>
                        </div>
                        <div style={{ height: '240px', border: '2px dashed #cbd5e1', borderRadius: '15px', overflow: 'hidden', background: '#f8fafc', position: 'relative' }}>
                          {(schoolIdPhotos.front || formData.schoolIdFront) ? (
                            <img src={schoolIdPhotos.front || formData.schoolIdFront} style={{ width: '100%', height: '100%', objectFit: 'contain' }} alt="Reference ID" />
                          ) : (
                            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', textAlign: 'center', padding: '1rem' }}>
                              <i className="fas fa-id-card" style={{ fontSize: '2rem', marginBottom: '10px' }}></i>
                              <p style={{ fontSize: '0.75rem', fontWeight: '600', margin: 0 }}>ID Not Available<br /><span style={{ fontSize: '0.65rem', fontWeight: 'normal' }}>Please upload in Step 3</span></p>
                            </div>
                          )}
                        </div>
                        <p style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '1rem', fontStyle: 'italic', textAlign: 'center' }}>We will match your live photo against this ID face.</p>
                      </div>

                      {/* Media Picker and Preview Column */}
                      <div style={{ background: '#fff', padding: '1.2rem', borderRadius: '20px', border: '1px solid #e1e8f0', boxShadow: '0 4px 15px rgba(0,0,0,0.03)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '800', color: '#1a202c' }}>LIVE CAPTURE</label>
                          <div style={{ fontSize: '0.65rem', color: '#3b82f6', fontWeight: '800', background: '#eff6ff', padding: '3px 8px', borderRadius: '6px' }}>PHOTO</div>
                        </div>

                        <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '1rem', textAlign: 'center' }}>Take a live photo using your camera to verify your identity.</p>

                        <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'center' }}>
                          <div style={{ 
                            border: '2px solid #fff', 
                            borderRadius: '15px', 
                            width: '220px', 
                            height: '240px', 
                            display: 'flex', 
                            flexDirection: 'column',
                            alignItems: 'center', 
                            justifyContent: 'center', 
                            background: '#e1e8f0', 
                            position: 'relative', 
                            overflow: 'hidden', 
                            boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.05)',
                            padding: photos.face_photo ? '0' : '1.5rem'
                          }}>
                            {photos.face_photo ? (
                              <>
                                <img src={photos.face_photo} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="Face Verification" />
                                <div style={{ position: 'absolute', bottom: '10px', left: '0', right: '0', display: 'flex', justifyContent: 'center', gap: '8px', padding: '0 10px' }}>
                                  <button 
                                    type="button" 
                                    onClick={() => openCamera('face_photo')} 
                                    style={{ background: 'rgba(255,255,255,0.9)', color: 'var(--primary)', border: 'none', borderRadius: '10px', padding: '6px 12px', fontSize: '0.75rem', fontWeight: '800', cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', gap: '5px' }}
                                  >
                                    <i className="fas fa-camera"></i> Retake
                                  </button>
                                  <button 
                                    type="button" 
                                    onClick={() => { removePhoto('face_photo'); setFaceMatchResult(null); }} 
                                    style={{ background: 'rgba(255,0,0,0.8)', color: 'white', border: 'none', borderRadius: '10px', padding: '6px 12px', fontSize: '0.75rem', fontWeight: '800', cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', gap: '5px' }}
                                  >
                                    <i className="fas fa-trash"></i> Remove
                                  </button>
                                </div>
                              </>
                            ) : (
                              <button 
                                type="button" 
                                onClick={() => openCamera('face_photo')} 
                                style={{ 
                                  border: '2px solid var(--primary)', 
                                  background: 'white', 
                                  color: 'var(--primary)', 
                                  cursor: 'pointer', 
                                  display: 'flex', 
                                  flexDirection: 'column', 
                                  alignItems: 'center', 
                                  justifyContent: 'center',
                                  gap: '12px',
                                  padding: '1.5rem',
                                  borderRadius: '18px',
                                  width: '100%',
                                  transition: 'all 0.2s ease'
                                }}
                                className="hover-pop"
                              >
                                <i className="fas fa-camera" style={{ fontSize: '2.5rem' }}></i>
                                <span style={{ fontSize: '0.9rem', fontWeight: '800', textTransform: 'uppercase' }}>Open Camera</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div style={{ width: '100%', textAlign: 'center', marginTop: '1.5rem' }}>
                      {photos.face_photo && (
                        <div style={{ width: '100%', maxWidth: '300px', margin: '0 auto' }}>
                          {!faceMatchResult ? (
                            <button type="button" onClick={async () => {
                              const idImg = schoolIdPhotos.front || formData.schoolIdFront;
                              if (!idImg) {
                                showPromptMessage('Please upload your School ID in Step 3 first.');
                                return;
                              }

                              setIsFaceMatching(true);
                              setLoadingMessage({ title: 'Matching Face', message: 'Comparing captured photo with your School ID...' });

                              try {
                                const faceImage = await normalizeVerificationImage(photos.face_photo);
                                const normalizedIdImage = await normalizeVerificationImage(idImg);
                                const result = await applicantAPI.verifyFaceAgainstId(faceImage, normalizedIdImage);
                                setFaceMatchResult(result);
                                if (result.verified) {
                                  setFaceVerified('success');
                                  showPromptMessage('Face successfully matched with ID!');
                                } else {
                                  showPromptMessage(`Face Match Issue: ${result.message || 'Face does not match the ID.'}`);
                                }
                              } catch (err) {
                                console.error('Match error:', err);
                                showPromptMessage('Verification service issue. Please try again with a clearer photo.');
                                setFaceMatchResult({ verified: false, technical_unavailable: true });
                              } finally {
                                setIsFaceMatching(false);
                              }
                            }} className="submit-btn" disabled={isFaceMatching} style={{ width: '100%', background: 'var(--primary)', borderRadius: '12px' }}>
                              {isFaceMatching ? <><i className="fas fa-spinner fa-spin"></i> Matching...</> : <><i className="fas fa-user-check"></i> Verify Match with ID</>}
                            </button>
                          ) : (
                            <div style={{
                              padding: '1rem',
                              borderRadius: '12px',
                              background: faceMatchResult.verified ? '#f0fff4' : '#fff5f5',
                              border: `1px solid ${faceMatchResult.verified ? '#c6f6d5' : '#fed7d7'}`,
                              display: 'flex',
                              alignItems: 'start',
                              gap: '12px',
                              textAlign: 'left'
                            }}>
                              <div style={{
                                width: '24px',
                                height: '24px',
                                borderRadius: '50%',
                                background: faceMatchResult.verified ? '#27ae60' : '#e74c3c',
                                color: 'white',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.7rem',
                                flexShrink: 0,
                                marginTop: '2px'
                              }}>
                                <i className={`fas ${faceMatchResult.verified ? 'fa-user-check' : 'fa-user-times'}`}></i>
                              </div>
                              <div>
                                <h5 style={{ margin: '0 0 2px 0', fontSize: '0.85rem', color: '#333', fontWeight: '700' }}>
                                  {faceMatchResult.verified ? 'Identity Verified' : 'Identity Mismatch'}
                                </h5>
                                <p style={{
                                  fontSize: '0.8rem',
                                  color: faceMatchResult.verified ? '#2f855a' : '#c53030',
                                  margin: 0,
                                  lineHeight: '1.4'
                                }}>
                                  {faceMatchResult.verified ? (faceMatchResult.technical_unavailable ? 'Service issue (Manual Check needed)' : 'Facial identity verified!') : faceMatchResult.message || 'Face identity mismatch.'}
                                </p>
                                {!faceMatchResult.verified && (
                                  <button type="button" onClick={() => setFaceMatchResult(null)} style={{ background: 'none', border: 'none', color: '#c53030', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.75rem', padding: 0, marginTop: '5px', fontWeight: '700' }}>Retry Capture</button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div style={{
                    marginTop: '1.5rem',
                    marginBottom: '2rem',
                    padding: '2.5rem 1.5rem',
                    background: '#f8fafc',
                    borderRadius: '28px',
                    border: '1.5px dashed #e2e8f0',
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '12px',
                    animation: 'fadeIn 0.5s ease'
                  }}>
                    <div style={{ width: '64px', height: '64px', background: 'white', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 16px rgba(0,0,0,0.04)', marginBottom: '4px' }}>
                      <i className="fas fa-lock" style={{ color: '#94a3b8', fontSize: '1.4rem' }}></i>
                    </div>
                    <h4 style={{ fontSize: '1.1rem', color: '#334155', fontWeight: '800', margin: 0 }}>Face Verification & Front ID Locked</h4>
                    <p style={{ fontSize: '0.85rem', color: '#64748b', maxWidth: '380px', margin: 0, lineHeight: '1.5' }}>
                      Please complete and verify your <b>Handwriting Signature Verification</b> above first. Once verified against your Back ID, the Front ID and Face Verification section will automatically unlock.
                    </p>
                  </div>
                )}

                <div style={{ marginTop: '3rem', display: 'flex', justifyContent: 'space-between' }}>
                  <button type="button" className="back-to-form-btn" onClick={handlePrevStep}>
                    <i className="fas fa-arrow-left" style={{ marginRight: '8px' }}></i> Back: Education
                  </button>
                  <button
                    type="submit"
                    className="submit-btn"
                    disabled={isSubmitting || isSavingStep || !faceMatchResult?.verified}
                    style={{ width: 'auto', padding: '0.8rem 3.5rem', borderRadius: '40px', background: 'var(--success)', border: 'none' }}
                  >
                    {isSubmitting ? (
                      <><i className="fas fa-spinner fa-spin" style={{ marginRight: '10px' }}></i>Submitting...</>
                    ) : (
                      <><i className="fas fa-paper-plane" style={{ marginRight: '10px' }}></i>Submit Application</>
                    )}
                  </button>
                </div>
              </div>
            </fieldset>
          </form>
        </div>

        <div className="redirect-status">
          All data is transmitted securely via 256-bit SSL encryption.
        </div>
      </div>

      {/* Success Modal */}
      <div className={`modal-overlay ${showSubmissionModal ? 'active' : ''}`}>
        <div className="submission-modal">
          <div className="success-icon-wrapper">
            <i className="fas fa-check"></i>
          </div>
          <h2>Application submitted!</h2>
          <p>Your application for <strong>{scholarshipName}</strong> has been received. Please wait for an email regarding your status.</p>
          <div className="redirect-status">
            Redirecting to portal...
            <div className="loader-dots">
              <div className="dot"></div><div className="dot"></div><div className="dot"></div>
            </div>
          </div>
          <button className="submit-btn" onClick={() => navigate('/portal')} style={{ marginTop: '1.5rem', width: '100%' }}>
            Return to Portal
          </button>
        </div>
      </div>

      {/* Camera Modal Overlay */}
      <div className={`camera-modal-overlay ${showCameraModal ? 'active' : ''}`}>
        <div className="camera-modal-content">
          <h3 style={{ marginBottom: '1rem', color: 'var(--primary)' }}>Face Verification</h3>
          <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '1.5rem' }}>Position your face within the frame and click capture.</p>
          <div style={{ position: 'relative', width: '100%', background: '#000', borderRadius: '20px', overflow: 'hidden', marginBottom: '2rem' }}>
            <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', transform: usingFrontCamera ? 'scaleX(-1)' : 'none' }} />
            {cameraInitializing && (
              <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', color: 'white' }}>
                <i className="fas fa-spinner fa-spin" style={{ fontSize: '2rem' }}></i>
              </div>
            )}
            {cameraError && (
              <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.8)', color: 'white', padding: '2rem' }}>
                <i className="fas fa-exclamation-triangle" style={{ fontSize: '2rem', marginBottom: '1rem', color: '#ffcc00' }}></i>
                <p>{cameraError.message}</p>
                <button onClick={() => openCamera(activeCameraField)} className="submit-btn" style={{ marginTop: '1rem', padding: '0.5rem 1.5rem', height: 'auto' }}>Retry</button>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '15px', justifyContent: 'center' }}>
            <button type="button" onClick={closeCamera} className="back-to-form-btn">Cancel</button>
            <button type="button" onClick={capturePhoto} className="submit-btn" disabled={!cameraReady} style={{ width: 'auto', padding: '0.8rem 2rem', height: 'auto', borderRadius: '30px' }}>
              <i className="fas fa-camera" style={{ marginRight: '8px' }}></i> Capture
            </button>
          </div>
        </div>
      </div>

      {/* Loading overlay */}
      <div className={`loading-overlay ${isSubmitting || isSavingStep || isInitialLoading ? 'active' : ''}`}>
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

      {/* Image Lightbox */}
      {lightboxSrc && (
        <div
          onClick={() => setLightboxSrc(null)}
          style={{
            position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
            background: 'rgba(0,0,0,0.92)', zIndex: 9500,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'zoom-out'
          }}
        >
          <img
            src={lightboxSrc}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '90vw', maxHeight: '90vh',
              objectFit: 'contain', borderRadius: '12px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.6)'
            }}
            alt="Full preview"
          />
          <button
            type="button"
            onClick={() => setLightboxSrc(null)}
            style={{
              position: 'absolute', top: '20px', right: '20px',
              background: 'rgba(255,255,255,0.15)', border: 'none',
              color: 'white', width: '42px', height: '42px',
              borderRadius: '50%', fontSize: '1.2rem', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
          >
            <i className="fas fa-times"></i>
          </button>
        </div>
      )}

      {/* Floating Prompt Alert */}
      <div className={`prompt-alert ${showPrompt ? 'active' : ''}`} style={{
        position: 'fixed',
        bottom: '30px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(0, 0, 0, 0.85)',
        color: 'white',
        padding: '12px 24px',
        borderRadius: '50px',
        zIndex: '10000',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
        transition: 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
        opacity: showPrompt ? 1 : 0,
        pointerEvents: showPrompt ? 'all' : 'none',
        marginBottom: showPrompt ? '0' : '-20px'
      }}>
        <div style={{
          fontSize: '1rem',
          fontWeight: '500'
        }}>
          {promptMessage}
        </div>
      </div>

    </>
  );
};

export default StudentInfo;
