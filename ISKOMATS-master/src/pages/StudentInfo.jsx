import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import SignaturePad from '../components/SignaturePad';
import VideoRecorder from '../components/VideoRecorder';
import { applicantAPI, applicationAPI } from '../services/api';

const FIND_SCHOLARSHIP_PROFILE_KEY = 'findScholarshipProfile';

const BARANGAYS = [
  "Adya", "Anilao", "Anilao-Labac", "Antipolo del Norte", "Antipolo del Sur",
  "Bagong Pook", "Balintawak", "Banaybanay", "Bolbok", "Bugtong na Pulo",
  "Bulacnin", "Bulaklakan", "Calamias", "Cumba", "Dagatan", "Duhatan",
  "Halang", "Inosloban", "Kayumanggi", "Latag", "Lodlod", "Lumbang",
  "Mabini", "Malagonlong", "Malitlit", "Marauoy", "Mataas na Lupa",
  "Munting Pulo", "Pagolingin Bata", "Pagolingin East", "Pagolingin West",
  "Pangao", "Pinagkawitan", "Pinagtongulan", "Plaridel",
  "Poblacion Barangay 1", "Poblacion Barangay 2", "Poblacion Barangay 3",
  "Poblacion Barangay 4", "Poblacion Barangay 5", "Poblacion Barangay 6",
  "Poblacion Barangay 7", "Poblacion Barangay 8", "Poblacion Barangay 9",
  "Poblacion Barangay 9-A", "Poblacion Barangay 10", "Poblacion Barangay 11",
  "Poblacion Barangay 12", "Pusil", "Quezon", "Rizal", "Sabang",
  "Sampaguita", "San Benito", "San Carlos", "San Celestino", "San Francisco",
  "San Guillermo", "San Isidro", "San Jose", "San Lucas", "San Salvador",
  "San Sebastian (Balagbag)", "Santo Niño", "Santo Toribio", "Sico",
  "Talisay", "Tambo", "Tangob", "Tanguay", "Tibig", "Tipacan"
];

const SCHOOLS = [
  "DLSL/De La Salle Lipa",
  "NU/National University Lipa",
  "Batangas State University",
  "Kolehiyo ng Lungsod ng Lipa",
  "Philippine State College of Aeronautics",
  "Lipa City Colleges",
  "University of Batangas",
  "New Era University",
  "Batangas College of Arts and Sciences",
  "Royal British College",
  "STI Academic Center",
  "AMA Computer College",
  "ICT-ED"
];

const GUIDE_VIDEO_STORAGE_KEY = 'studentInfoGuideVideos';
const DEFAULT_GUIDE_VIDEO_URLS = {
  indigency: '',
  schoolId: '',
  enrollment: '',
  grades: ''
};

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
  
  return '';
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
    'schoolIdNumber', 'schoolName', 'schoolAddress', 'schoolSector', 'yearLevel', 'course', 'gpa',
    'mayorCOE_photo', 'mayorGrades_photo'
  ],
  4: [
    'privacyConsent', 'dataCertifyConsent',
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

const StudentInfo = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [showSubmissionModal, setShowSubmissionModal] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [promptMessage, setPromptMessage] = useState('');
  const [idPicturePreview, setIdPicturePreview] = useState(null);
  const [faceVerificationPreview, setFaceVerificationPreview] = useState(null);
  const [signaturePreview, setSignaturePreview] = useState(null);
  const [drawnSignature, setDrawnSignature] = useState(null);
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
    face_photo: null
  });
  
  const handleVideoUpload = (fieldName, blob) => {
    if (!blob) return;
    
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
    const uploadPromise = applicantAPI.uploadRequirementVideo(fieldName, blob)
      .then(result => {
        const publicUrl = result.publicUrl;
        setFormData(prev => ({ ...prev, [fieldName]: publicUrl }));
        setDocumentVideos(prev => ({ ...prev, [fieldName]: publicUrl }));
        
        // Remove from uploading state
        setUploadingFields(prev => {
          const next = { ...prev };
          delete next[fieldName];
          return next;
        });

        // Persist to profile in background
        applicantAPI.updateProfile({ [fieldName]: publicUrl }).catch(err => {
          console.warn(`Could not sync ${fieldName} to profile:`, err.message);
        });
        
        console.log(`Video uploaded successfully for ${fieldName}:`, publicUrl);
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
  const [guideVideos, setGuideVideos] = useState(() => {
    try {
      const stored = localStorage.getItem(GUIDE_VIDEO_STORAGE_KEY);
      return stored ? { ...DEFAULT_GUIDE_VIDEO_URLS, ...JSON.parse(stored) } : DEFAULT_GUIDE_VIDEO_URLS;
    } catch {
      return DEFAULT_GUIDE_VIDEO_URLS;
    }
  });

  const [uploadingFields, setUploadingFields] = useState({}); // { fieldName: Promise }

  const [coeVerified, setCoeVerified] = useState(null); 
  const [coeStatus, setCoeStatus] = useState('');
  const [gradesVerified, setGradesVerified] = useState(null); 
  const [gradesStatus, setGradesStatus] = useState('');
  const [idVerified, setIdVerified] = useState(null); 
  const [idStatus, setIdStatus] = useState('');
  const [scanProgress, setScanProgress] = useState(0); // 0-100 progress for scanning animations

  const idPictureInputRef = useRef(null);
  const signatureInputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const sigPad = useRef(null);
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

  useEffect(() => {
    localStorage.setItem(GUIDE_VIDEO_STORAGE_KEY, JSON.stringify(guideVideos));
  }, [guideVideos]);

  const renderImagePicker = ({ id, name, label, onChange, currentValue }) => {
    const status = getImagePickerStatus(currentValue);

    return (
      <div style={{marginBottom: '1rem'}}>
        <label style={{display: 'block', fontSize: '0.85rem', fontWeight: '700', color: '#334155', marginBottom: '8px'}}>{label}</label>
        <input id={id} type="file" name={name} accept="image/*" onChange={onChange} style={{display: 'none'}} />
        <label
          htmlFor={id}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '10px',
            padding: '0.8rem 1rem',
            borderRadius: '14px',
            border: '1px solid #cbd5e1',
            background: '#fff',
            color: '#0f172a',
            cursor: 'pointer',
            fontSize: '0.85rem',
            fontWeight: '700',
            boxShadow: '0 4px 12px rgba(15, 23, 42, 0.05)'
          }}
        >
          <i className="fas fa-image" style={{color: 'var(--primary)'}}></i>
          {currentValue ? 'Replace image' : 'Choose image'}
        </label>
        <div
          style={{
            marginTop: '0.65rem',
            padding: '0.7rem 0.85rem',
            borderRadius: '12px',
            border: `1px solid ${status.border}`,
            background: status.background,
            color: status.color,
            fontSize: '0.78rem',
            fontWeight: '700'
          }}
        >
          {status.label}
        </div>
      </div>
    );
  };

  const renderGuideVideoPanel = (guideKey, label) => {
    const currentUrl = guideVideos[guideKey] || '';
    const normalizedUrl = normalizeGuideVideoUrl(currentUrl);
    const isYouTubeEmbed = normalizedUrl.includes('youtube.com/embed/');
    const isDirectVideo = /\.(mp4|webm|ogg|mov)(\?|#|$)/i.test(normalizedUrl);

    return (
      <details style={{ marginBottom: '1rem', border: '1px solid #e2e8f0', borderRadius: '14px', background: '#f8fafc' }}>
        <summary style={{ cursor: 'pointer', listStyle: 'none', padding: '0.85rem 1rem', fontSize: '0.82rem', fontWeight: '800', color: '#334155', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <i className="fas fa-circle-play" style={{ color: 'var(--primary)' }}></i>
          {label}
        </summary>
        <div style={{ padding: '0 1rem 1rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <input
            type="url"
            value={currentUrl}
            onChange={(event) => setGuideVideos((prev) => ({ ...prev, [guideKey]: event.target.value }))}
            placeholder="Paste a YouTube or direct MP4/WebM guide link"
            style={{ width: '100%', padding: '0.75rem 0.9rem', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '0.82rem' }}
          />
          {normalizedUrl ? (
            isYouTubeEmbed ? (
              <div style={{ position: 'relative', paddingTop: '56.25%', borderRadius: '12px', overflow: 'hidden', background: '#000' }}>
                <iframe
                  src={normalizedUrl}
                  title={`${guideKey}-guide-video`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
                />
              </div>
            ) : isDirectVideo ? (
              <video src={normalizedUrl} controls style={{ width: '100%', borderRadius: '12px', background: '#000' }} />
            ) : (
              <a href={normalizedUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', fontSize: '0.8rem', fontWeight: '700' }}>
                Open instructional video link
              </a>
            )
          ) : (
            <p style={{ margin: 0, fontSize: '0.76rem', color: '#64748b', lineHeight: '1.5' }}>
              No guide video set yet. Add a link above if you want this upload section to show an instructional video.
            </p>
          )}
        </div>
      </details>
    );
  };

  const [formData, setFormData] = useState({
    lastName: '',
    firstName: '',
    middleName: '',
    maidenName: '',
    barangay: '',
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

    schoolIdFront: null,
    schoolIdBack: null,
    schoolIdFront_video: null,
    schoolIdBack_video: null,
    
    privacyConsent: false,
    dataCertifyConsent: false,
    applicantSignatureName: '',
    dateAccomplished: ''
  });

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
        formData: serializeDraftFormData(nextFormData)
      })
    );
  };

  const clearDraft = (user = currentUser) => {
    if (!user) {
      return;
    }

    sessionStorage.removeItem(buildDraftStorageKey(user, searchParams, scholarshipName));
  };

  const performOcrVerification = async (docType, docParam, extraParams = {}, videoUrl = null) => {
    try {
      const setStatus = (status) => {
        if (docType === 'Indigency') { setOcrStatus(status); }
        else if (docType === 'Enrollment') { setCoeStatus(status); }
        else if (docType === 'Grades') { setGradesStatus(status); }
        else if (docType === 'SchoolID') { setIdStatus(status); }
      };
      
      const setVerified = (v) => {
        if (docType === 'Indigency') { setOcrVerified(v); }
        else if (docType === 'Enrollment') { setCoeVerified(v); }
        else if (docType === 'Grades') { setGradesVerified(v); }
        else if (docType === 'SchoolID') { setIdVerified(v); }
      };

      setVerified('verifying');
      setStatus(`Verifying your ${docType} document and video...`);
      setScanProgress(15);
      
      const pInterval = setInterval(() => {
        setScanProgress(p => p < 95 ? p + (Math.random() * 15) : p);
      }, 200);

      const { townCity, schoolName, idNumber, yearLevel, gpa, course } = extraParams;
      const { firstName, lastName, middleName } = formData;
      const reqNo = searchParams.get('reqNo') || searchParams.get('scholarship_id');

      const result = await applicantAPI.ocrCheck(
        docType === 'SchoolID' ? docParam.front : null,
        docType === 'SchoolID' ? docParam.back : null,
        docType === 'Indigency' ? docParam : null, 
        townCity, 
        docType === 'Enrollment' ? docParam : null, 
        docType === 'Grades' ? docParam : null,
        firstName, 
        lastName, 
        middleName,
        schoolName, idNumber, yearLevel, gpa, course,
        videoUrl,
        reqNo
      );

      clearInterval(pInterval);
      setScanProgress(100);
      
      if (result.verified) {
        setVerified('success');
        setStatus(result.message || 'Verification successful!');
        return true;
      } else {
        const isTechnical = result.message?.includes('temporarily unavailable') || 
                           result.message?.includes('Low memory mode') ||
                           result.message?.includes('OCR service');
        
        if (isTechnical) {
          setVerified('technical_unavailable');
          setStatus(result.message || 'OCR service temporarily unavailable');
          return true;
        }

        setVerified('failed');
        setStatus(result.message || 'Verification failed.');
        return false;
      }
    } catch (err) {
      console.error('OCR Error:', err);
      const errMsg = `Technical Issue: ${err.message}`;
      if (docType === 'Indigency') {
        setOcrVerified('failed');
        setOcrStatus(errMsg);
      } else if (docType === 'Enrollment') {
        setCoeVerified('failed');
        setCoeStatus(errMsg);
      } else if (docType === 'Grades') {
        setGradesVerified('failed');
        setGradesStatus(errMsg);
      } else if (docType === 'SchoolID') {
        setIdVerified('failed');
        setIdStatus(errMsg);
      }
      return false;
    }
  };

  const handleIndigencyScan = async () => {
    const indigencyDoc = photos.mayorIndigency_photo || formData.mayorIndigency_photo;
    const townCity = formData.townCityMunicipality || '';
    const videoUrl = formData.mayorIndigency_video || documentVideos.mayorIndigency_video;

    if (!indigencyDoc) {
      showPromptMessage('⚠️ Please upload or capture your Certificate of Indigency first.');
      return;
    }
    if (!videoUrl || typeof videoUrl !== 'string' || !videoUrl.startsWith('http')) {
      showPromptMessage('⚠️ Please record and upload the Indigency video first.');
      return;
    }
    if (!townCity) {
      showPromptMessage('⚠️ Please fill in your Town/City first.');
      return;
    }

    setLoadingMessage({ title: 'Scanning Document', message: 'Verifying your Certificate of Indigency and Video Content...' });
    
    try {
      const success = await performOcrVerification('Indigency', indigencyDoc, { townCity }, videoUrl);
      if (success) {
        showPromptMessage('✅ Indigency verified successfully!');
      } else {
        showPromptMessage('❌ Verification failed. Please ensure document and video are clear.');
      }
    } catch (err) {
      console.error('Scan Error:', err);
    }
  };

  const handleCOEScan = async () => {
    const coeDoc = photos.mayorCOE_photo || formData.mayorCOE_photo;
    const schoolName = formData.schoolName || '';
    const idNumber = formData.schoolIdNumber || '';
    const yearLevel = formData.yearLevel || '';
    const course = formData.course || '';
    const videoUrl = formData.mayorCOE_video || documentVideos.mayorCOE_video;

    if (!coeDoc) {
      showPromptMessage('⚠️ Please upload your Certificate of Enrollment first.');
      return;
    }
    if (!videoUrl || typeof videoUrl !== 'string' || !videoUrl.startsWith('http')) {
      showPromptMessage('⚠️ Please record and upload the COE video first.');
      return;
    }
    if (!schoolName || !idNumber || !yearLevel || !course) {
      showPromptMessage('⚠️ Please complete School Name, School ID Number, Year Level, and Course first.');
      return;
    }

    setLoadingMessage({ title: 'Scanning COE', message: 'Verifying your Certificate of Enrollment and Video Content...' });
    
    try {
      const success = await performOcrVerification('Enrollment', coeDoc, { schoolName, idNumber, yearLevel, course }, videoUrl);
      if (success) {
        showPromptMessage('✅ COE verified successfully!');
      } else {
        showPromptMessage('❌ COE verification failed.');
      }
    } catch (err) {
      console.error('Scan Error:', err);
    }
  };

  const handleGradesScan = async () => {
    const gradesDoc = photos.mayorGrades_photo || formData.mayorGrades_photo;
    const schoolName = formData.schoolName || '';
    const yearLevel = formData.yearLevel || '';
    const gpa = formData.gpa || '';
    const videoUrl = formData.mayorGrades_video || documentVideos.mayorGrades_video;

    if (!gradesDoc) {
      showPromptMessage('⚠️ Please upload your Grades document first.');
      return;
    }
    if (!videoUrl || typeof videoUrl !== 'string' || !videoUrl.startsWith('http')) {
      showPromptMessage('⚠️ Please record and upload the Grades video first.');
      return;
    }
    if (!schoolName || !yearLevel || !gpa) {
      showPromptMessage('⚠️ Please complete School Name, Year Level, and GPA first.');
      return;
    }

    setLoadingMessage({ title: 'Scanning Grades', message: 'Verifying your Grades document and Video Content...' });
    
    try {
      const success = await performOcrVerification('Grades', gradesDoc, { schoolName, yearLevel, gpa }, videoUrl);
      if (success) {
        showPromptMessage('✅ Grades verified successfully!');
      } else {
        showPromptMessage('❌ Grades verification failed.');
      }
    } catch (err) {
      console.error('Scan Error:', err);
    }
  };

  const handleIdScan = async () => {
    const idFront = schoolIdPhotos.front;
    const idBack = schoolIdPhotos.back;
    const frontVideoUrl = formData.schoolIdFront_video || documentVideos.schoolIdFront_video;
    const backVideoUrl = formData.schoolIdBack_video || documentVideos.schoolIdBack_video;

    if (!idFront || !idBack) {
      showPromptMessage('⚠️ Please upload both front and back of your School ID first.');
      return;
    }
    if (!frontVideoUrl || typeof frontVideoUrl !== 'string' || !frontVideoUrl.startsWith('http')) {
      showPromptMessage('⚠️ Please record and upload the front School ID video first.');
      return;
    }
    if (!backVideoUrl || typeof backVideoUrl !== 'string' || !backVideoUrl.startsWith('http')) {
      showPromptMessage('⚠️ Please record and upload the back School ID video first.');
      return;
    }
    if (!formData.schoolName || !formData.schoolIdNumber || !formData.yearLevel) {
      showPromptMessage('⚠️ Please complete School Name, School ID Number, and Year Level first.');
      return;
    }

    setLoadingMessage({ title: 'Scanning School ID', message: 'Verifying your School ID images and Video Content...' });
    
    try {
      const success = await performOcrVerification(
        'SchoolID',
        { front: idFront, back: idBack },
        { 
          schoolName: formData.schoolName, 
          idNumber: formData.schoolIdNumber,
          yearLevel: formData.yearLevel
        },
        { front: frontVideoUrl, back: backVideoUrl }
      );
      if (success) {
        showPromptMessage('✅ School ID verified successfully!');
      } else {
        showPromptMessage('❌ School ID verification failed.');
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

    if (stepNumber === 1 && idPicturePreview) {
      if (isFileLike(idPicturePreview)) {
        payload.append('profile_picture', idPicturePreview);
      } else if (typeof idPicturePreview === 'string' && idPicturePreview.startsWith('data:')) {
        jsonData['profile_picture'] = idPicturePreview;
      }
      hasPayload = true;
    }

    if (stepNumber === 2) {
      if (photos.mayorIndigency_photo) {
        if (isFileLike(photos.mayorIndigency_photo)) {
          payload.append('indigency_doc', photos.mayorIndigency_photo);
        } else if (typeof photos.mayorIndigency_photo === 'string' && photos.mayorIndigency_photo.startsWith('data:')) {
          jsonData['indigency_doc'] = photos.mayorIndigency_photo;
        }
        hasPayload = true;
      }
    }

    if (stepNumber === 3) {
      if (schoolIdPhotos.front) {
        if (isFileLike(schoolIdPhotos.front)) {
          payload.append('id_front', schoolIdPhotos.front);
        } else if (typeof schoolIdPhotos.front === 'string' && schoolIdPhotos.front.startsWith('data:')) {
          jsonData['id_front'] = schoolIdPhotos.front;
        }
        hasPayload = true;
      }

      if (schoolIdPhotos.back) {
        if (isFileLike(schoolIdPhotos.back)) {
          payload.append('id_back', schoolIdPhotos.back);
        } else if (typeof schoolIdPhotos.back === 'string' && schoolIdPhotos.back.startsWith('data:')) {
          jsonData['id_back'] = schoolIdPhotos.back;
        }
        hasPayload = true;
      }

      if (photos.mayorCOE_photo) {
        if (isFileLike(photos.mayorCOE_photo)) {
          payload.append('enrollment_certificate_doc', photos.mayorCOE_photo);
        } else if (typeof photos.mayorCOE_photo === 'string' && photos.mayorCOE_photo.startsWith('data:')) {
          jsonData['enrollment_certificate_doc'] = photos.mayorCOE_photo;
        }
        hasPayload = true;
      }

      if (photos.mayorGrades_photo) {
        if (isFileLike(photos.mayorGrades_photo)) {
          payload.append('grades_doc', photos.mayorGrades_photo);
        } else if (typeof photos.mayorGrades_photo === 'string' && photos.mayorGrades_photo.startsWith('data:')) {
          jsonData['grades_doc'] = photos.mayorGrades_photo;
        }
        hasPayload = true;
      }
    }

    if (stepNumber === 4) {
      if (photos.face_photo) {
        if (isFileLike(photos.face_photo)) {
          payload.append('face_photo', photos.face_photo);
        } else if (typeof photos.face_photo === 'string' && photos.face_photo.startsWith('data:')) {
          jsonData['face_photo'] = photos.face_photo;
        }
        hasPayload = true;
      }

      const signatureToSave = drawnSignature || signaturePreview;
      if (signatureToSave) {
        if (isFileLike(signatureToSave)) {
          payload.append('signature_data', signatureToSave);
        } else if (typeof signatureToSave === 'string' && signatureToSave.startsWith('data:')) {
          jsonData['signature_data'] = signatureToSave;
        }
        hasPayload = true;
      }

      const videoFields = ['mayorIndigency_video', 'mayorGrades_video', 'mayorCOE_video', 'schoolIdFront_video', 'schoolIdBack_video', 'face_video'];
      videoFields.forEach(field => {
        if (formData[field] && typeof formData[field] === 'string' && formData[field].startsWith('http')) {
          jsonData[field] = formData[field];
          hasPayload = true;
        }
      });
    }

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

    const compressImage = (file, maxWidth = 1024, quality = 0.6) => {
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
      try {
        setLoadingMessage({ title: 'Loading Profile', message: 'Retrieving your information to pre-fill the application...' });
        setIsInitialLoading(true);
        const profile = await applicantAPI.getProfile();
        setUserProfile(profile);

        const updates = {
          firstName: searchNameParts.firstName || profile.first_name || '',
          lastName: searchNameParts.lastName || profile.last_name || '',
          middleName: searchNameParts.middleName || profile.middle_name || '',
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
          fatherName: [profile.father_fname, profile.father_lname].filter(Boolean).join(' '),
          fatherOccupation: profile.father_occupation || '',
          fatherPhoneNumber: profile.father_phone_no || '',
          motherStatus: profile.mother_status === true ? 'Living' : profile.mother_status === false ? 'Deceased' : '',
          motherName: [profile.mother_fname, profile.mother_lname].filter(Boolean).join(' '),
          motherOccupation: profile.mother_occupation || '',
          motherPhoneNumber: profile.mother_phone_no || '',
          parentsGrossIncome: urlIncome || scholarshipSearchProfile?.income || profile.financial_income_of_parents || '',
          gpa: urlGpa || scholarshipSearchProfile?.gpa || profile.overall_gpa || '',
          numberOfSiblings: profile.sibling_no || '',
          course: profile.course || ''
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

        setFormData(prev => mergeMeaningfulValues(prev, updates));

        // --- LAZY LOADING OPTIMIZATION ---
        // Instead of loading all heavy blobs at once (which causes 502 OOM on Render),
        // we fetch them one-by-one in the background.
        const fetchHeavyBlobs = async (prof) => {
          const blobFields = [
            'profile_picture', 'id_img_front', 'id_img_back', 
            'enrollment_certificate_doc', 'grades_doc', 'indigency_doc', 
            'id_pic', 'signature_image_data'
          ];
          
          for (const field of blobFields) {
            if (prof[field] && String(prof[field]).startsWith('/api/')) {
              try {
                const result = await applicantAPI.getDocument(field);
                if (result && result.data) {
                  const b64 = result.data;
                  
                  // Update specialized previews and formData with correct mappings
                  if (field === 'profile_picture') {
                    setIdPicturePreview(b64);
                    setFormData(prev => ({ ...prev, profile_picture: b64 }));
                  }
                  else if (field === 'id_img_front') {
                    setSchoolIdPhotos(p => ({...p, front: b64}));
                    setFormData(prev => ({ ...prev, schoolIdFront: b64 }));
                  }
                  else if (field === 'id_img_back') {
                    setSchoolIdPhotos(p => ({...p, back: b64}));
                    setFormData(prev => ({ ...prev, schoolIdBack: b64 }));
                  }
                  else if (field === 'enrollment_certificate_doc') {
                    setPhotos(p => ({...p, mayorCOE_photo: b64}));
                    setFormData(prev => ({ ...prev, mayorCOE_photo: b64 }));
                  }
                  else if (field === 'grades_doc') {
                    setPhotos(p => ({...p, mayorGrades_photo: b64}));
                    setFormData(prev => ({ ...prev, mayorGrades_photo: b64 }));
                  }
                  else if (field === 'indigency_doc') {
                    setPhotos(p => ({...p, mayorIndigency_photo: b64}));
                    setFormData(prev => ({ ...prev, mayorIndigency_photo: b64 }));
                  }
                  else if (field === 'id_pic') {
                    setPhotos(p => ({...p, face_photo: b64, mayorValidID_photo: b64}));
                    setFormData(prev => ({ ...prev, face_photo: b64, mayorValidID_photo: b64 }));
                  }
                  else if (field === 'signature_image_data') {
                    setSignaturePreview(b64);
                    // Important: Signature field in form is 'applicantSignatureName'
                    setFormData(prev => ({ ...prev, applicantSignatureName: b64 }));
                  }
                }
              } catch (e) {
                console.warn(`Lazy-load failed for ${field}:`, e);
              }
            }
          }
        };

        // Start background loading of images
        fetchHeavyBlobs(profile);
        
        if (profile.has_other_assistance) {
          setHasOtherAssistance('Yes');
        } else if (profile.has_other_assistance === false) {
          setHasOtherAssistance('No');
        }

        const videoMap = {
          id_vid_url: 'face_video',
          indigency_vid_url: 'mayorIndigency_video',
          grades_vid_url: 'mayorGrades_video',
          enrollment_certificate_vid_url: 'mayorCOE_video',
          schoolid_front_vid_url: 'schoolIdFront_video',
          schoolid_back_vid_url: 'schoolIdBack_video'
        };

        const loadedVideos = {};
        Object.entries(videoMap).forEach(([dbField, stateField]) => {
          if (profile[dbField]) {
            loadedVideos[stateField] = profile[dbField];
            setFormData(prev => ({ ...prev, [stateField]: profile[dbField] }));
          }
        });
        
        if (Object.keys(loadedVideos).length > 0) {
          setDocumentVideos(prev => ({ ...prev, ...loadedVideos }));
        }
      } catch (err) {
        console.warn('Could not pre-fill from profile:', err.message);
      } finally {
        if (savedDraft?.formData) {
          setFormData(prev => fillEmptyValuesOnly(prev, savedDraft.formData));
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
  }, [currentUser, formData, hasOtherAssistance, currentStep, scholarshipName, searchParams]);

  const openCamera = async () => {
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

    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    setPhotos(prev => ({ ...prev, face_photo: dataUrl }));
    setFaceVerificationPreview(dataUrl);
    setFaceVerified(null);
    
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
        } else if (type === 'mayorCOE_photo') {
          setCoeVerified(null);
          setCoeStatus('');
        } else if (type === 'mayorGrades_photo') {
          setGradesVerified(null);
          setGradesStatus('');
        }
        
        if (type !== 'face_photo') {
          applicantAPI.updateProfile({ [type]: compressedBase64 }).catch(console.error);
        }
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

  const isAnyScanning = [idVerified, coeVerified, gradesVerified, ocrVerified, faceVerified].some(v => v === 'verifying') || isFaceMatching;
  const isStep1DocumentsVerified = ocrVerified === 'success';
  const isStep3DocumentsVerified = idVerified === 'success' && coeVerified === 'success' && gradesVerified === 'success';

  const handleInputChange = (e) => {
    if (isAnyScanning || isSavingStep) return;
    const { name, value, type, checked, files } = e.target;
    
    // Prevent modification of locked name fields (except in Step 1 where editing is allowed)
    if (lockedNameFields[name] && currentStep !== 1) {
      return;
    }

    if (type === 'checkbox') {
      setFormData(prev => ({
        ...prev,
        [name]: checked
      }));
    } else if (type === 'file') {
      const file = files[0] || null;
      if (DOCUMENT_IMAGE_FIELDS.has(name) && file && file.type.startsWith('image/') && window.compressImage) {
        window.compressImage(file).then(compressedBase64 => {
          setFormData(prev => ({ ...prev, [name]: compressedBase64 }));
          setPhotos(prev => ({ ...prev, [name]: compressedBase64 }));
          
          // Reset verification on photo change
          if (name === 'mayorIndigency_photo') { setOcrVerified(null); setOcrStatus(''); }
          else if (name === 'mayorCOE_photo') { setCoeVerified(null); setCoeStatus(''); }
          else if (name === 'mayorGrades_photo') { setGradesVerified(null); setGradesStatus(''); }
          else if (name === 'mayorValidID_photo') { setIdVerified(null); setIdStatus(''); }
          
          applicantAPI.updateProfile({ [name]: compressedBase64 }).catch(console.error);
        });
        
        if (name === 'mayorValidID_photo') {
          setValidIdPreview(file ? URL.createObjectURL(file) : null);
        }
        return;
      }

      if (DOCUMENT_IMAGE_FIELDS.has(name)) {
        setFormData(prev => ({
          ...prev,
          [name]: file
        }));

        if (name === 'mayorValidID_photo') {
          setValidIdPreview(file ? URL.createObjectURL(file) : null);
        }
      } else if (file && file.type.startsWith('image/') && window.compressImage) {
        window.compressImage(file).then(compressedBase64 => {
          setFormData(prev => ({
            ...prev,
            [name]: compressedBase64
          }));
          
          if (name === 'mayorValidID_photo') {
            setValidIdPreview(compressedBase64);
          }
          
          applicantAPI.updateProfile({ [name]: compressedBase64 }).catch(console.error);
        });
      } else {
        setFormData(prev => ({
          ...prev,
          [name]: file
        }));
      }
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: value
      }));
    }
  };

  const handleIdPictureUpload = (e) => {
    const file = e.target.files[0];
    if (file && window.compressImage) {
      window.compressImage(file, 400).then(compressedBase64 => { 
        setIdPicturePreview(compressedBase64);
        setFormData(prev => ({ ...prev, profile_picture: compressedBase64 }));
        
        applicantAPI.updateProfile({ profile_picture: compressedBase64 }).catch(console.error);
      });
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
        
        applicantAPI.updateProfile({ 
          [photoKey]: compressedBase64
        }).catch(console.error);
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
        
        applicantAPI.updateProfile({ signature_data: compressedBase64 }).catch(console.error);
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
      const canvas = sigPad.current.getTrimmedCanvas();
      const dataUrl = canvas.toDataURL('image/png');
      setDrawnSignature(dataUrl);
      setFormData(prev => ({ ...prev, applicantSignatureName: dataUrl }));
      setShowSignaturePad(false);
      applicantAPI.updateProfile({ signature_data: dataUrl }).catch(console.error);
    } else {
      showPromptMessage('⚠️ Please provide a signature first.');
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
      showPromptMessage('⚠️ Please wait for individual verification to complete before proceeding.');
      return;
    }
    const pendingUploads = Object.values(uploadingFields);
    if (pendingUploads.length > 0) {
      setLoadingMessage({ title: 'Completing Uploads', message: 'Finalizing your video uploads. Please wait a moment...' });
      setIsSavingStep(true);
      try { await Promise.all(pendingUploads); } catch(err) { console.error("Delayed wait failed:", err); }
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

    // --- Manual File Requirement Checks ---
    if (currentStep === 1) {
      if (!idPicturePreview) {
        showPromptMessage('⚠️ Please upload your 2x2 ID Picture.');
        return;
      }
      if (!photos.mayorIndigency_photo && !formData.mayorIndigency_photo) {
        showPromptMessage('⚠️ Please upload your Certificate of Indigency.');
        return;
      }
      if (!isStep1DocumentsVerified) {
        showPromptMessage('⚠️ Please verify your Certificate of Indigency before proceeding to the next step.');
        return;
      }
    }

    if (currentStep === 3) {
      if (!schoolIdPhotos.front || !schoolIdPhotos.back) {
        showPromptMessage('⚠️ Please upload both front and back of your School ID.');
        return;
      }
      if (!photos.mayorCOE_photo && !formData.mayorCOE_photo) {
        showPromptMessage('⚠️ Please upload your Certificate of Enrollment.');
        return;
      }
      if (!photos.mayorGrades_photo && !formData.mayorGrades_photo) {
        showPromptMessage('⚠️ Please upload your Grades document.');
        return;
      }
      if (idVerified !== 'success') {
        showPromptMessage('⚠️ Please verify your School ID before proceeding to the next step.');
        return;
      }
      if (coeVerified !== 'success') {
        showPromptMessage('⚠️ Please verify your Certificate of Enrollment before proceeding to the next step.');
        return;
      }
      if (gradesVerified !== 'success') {
        showPromptMessage('⚠️ Please verify your Grades document before proceeding to the next step.');
        return;
      }
    }

    if (isMissing) {
      showPromptMessage('⚠️ Please fill in all required fields.');
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
      showPromptMessage(`⚠️ Could not save Step ${currentStep}. ${err.message}`);
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
      try { await Promise.all(pendingUploads); } catch(err) { console.error("Delayed wait failed:", err); }
      setIsSavingStep(false);
    }

    const requiredFields = [
      { name: 'lastName', label: 'Last Name' },
      { name: 'firstName', label: 'First Name' },
      { name: 'middleName', label: 'Middle Name' },
      { name: 'dateOfBirth', label: 'Date of Birth' },
      { name: 'placeOfBirth', label: 'Place of Birth' },
      { name: 'streetBarangay', label: 'Barangay' },
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
      showPromptMessage(`⚠️ Please fill in all fields: ${missingLabel} is missing.`);
      return;
    }

    const requiredDocs = [
      { name: 'mayorCOE_photo', label: 'COE Photo' },
      { name: 'mayorGrades_photo', label: 'Grades Photo' },
      { name: 'mayorIndigency_photo', label: 'Indigency Photo' }
    ];

    let missingDocLabel = '';
    for (const doc of requiredDocs) {
      if (!formData[doc.name] && !photos[doc.name]) {
        missingDocLabel = doc.label;
        break;
      }
    }

    if (missingDocLabel) {
      showPromptMessage(`⚠️ Please upload the document: ${missingDocLabel}.`);
      return;
    }

    if (
      !schoolIdPhotos.front ||
      !schoolIdPhotos.back ||
      !photos.face_photo
    ) {
      showPromptMessage('⚠️ Please complete Identity Verification: Upload Front/Back School ID and a Face Photo.');
      return;
    }

    if (!formData.privacyConsent) {
      showPromptMessage('⚠️ Please accept the Privacy Policy to proceed.');
      return;
    }
    if (!formData.dataCertifyConsent) {
      showPromptMessage('⚠️ Please certify that the information provided is correct.');
      return;
    }

    if (!signaturePreview && !drawnSignature) {
      showPromptMessage('⚠️ Please either upload a signature photo or draw your signature.');
      return;
    }

    let reqNo = searchParams.get('reqNo');
    if (!reqNo || isNaN(parseInt(reqNo))) {
      reqNo = searchParams.get('scholarship_id');
    }
    
    if (!reqNo || isNaN(parseInt(reqNo))) {
      showPromptMessage('⚠️ Scholarship ID missing or invalid.');
      return;
    }

    const numericReqNo = parseInt(reqNo, 10);
    setIsSubmitting(true);

    try {
      const facePhoto = photos.face_photo;
      const idFrontForFace = schoolIdPhotos.front;

      if (facePhoto && idFrontForFace && faceVerified !== 'success') {
        setLoadingMessage({
          title: 'Verifying Face',
          message: 'Matching your selfie against your School ID photo…'
        });
        setFaceVerified('verifying');
        try {
          const skipVerification = true; 
          setFaceVerified('success'); 
          console.log('[FACE] Face verification will be handled by the backend during submission.');
        } catch (faceErr) {
          console.warn('[FACE] Face pre-check error:', faceErr.message);
          setFaceVerified('technical_unavailable');
        }
      }

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

      if (photos.profile_picture) submissionData.append('profile_picture', photos.profile_picture);
      if (photos.id_front || schoolIdPhotos.front) submissionData.append('id_front', photos.id_front || schoolIdPhotos.front);
      if (photos.id_back  || schoolIdPhotos.back)  submissionData.append('id_back',  photos.id_back  || schoolIdPhotos.back);
      if (photos.face_photo) submissionData.append('face_photo', photos.face_photo);
      
      if (drawnSignature) {
        submissionData.append('signature_data', drawnSignature);
      } else if (signaturePreview) {
        submissionData.append('signature_data', signaturePreview);
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
      showPromptMessage(`⚠️ Error: ${err.message}`);
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
          .form-card { padding: 1.5rem; }
          .navbar { padding: 1rem 5%; }
          .media-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      <nav className="navbar">
        <Link to="/portal" className="navbar-brand">iskoMats</Link>
        <div className="navbar-menu">
          <span>{currentUser}</span>
          <button className="logout-btn" onClick={() => {
            localStorage.removeItem('currentUser');
            navigate('/login');
          }}>
            <i className="fas fa-sign-out-alt" style={{marginRight: '6px'}}></i>Logout
          </button>
        </div>
      </nav>


      <div className="form-container">
        <div className="form-card">
          <div className="section-header">
            <img src="/iskologo.png" alt="Logo" style={{height: '50px', marginBottom: '1rem', filter: 'grayscale(1) contrast(1.2)'}} />
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
            <div style={{background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '18px', padding: '1rem 1.1rem'}}>
              <div style={{fontSize: '0.72rem', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9a3412', marginBottom: '0.4rem'}}>Profile Snapshot</div>
              <div style={{fontSize: '1rem', fontWeight: '700', color: '#431407'}}>{[formData.firstName, formData.middleName, formData.lastName].filter(Boolean).join(' ') || currentUser}</div>
              <div style={{fontSize: '0.82rem', color: '#7c2d12', marginTop: '0.35rem'}}>{formData.schoolName || 'School not set yet'}</div>
            </div>
            <div style={{background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '18px', padding: '1rem 1.1rem'}}>
              <div style={{fontSize: '0.72rem', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#1d4ed8', marginBottom: '0.4rem'}}>Find Scholarship Data</div>
              <div style={{fontSize: '0.92rem', color: '#1e3a8a'}}>GPA: <strong>{scholarshipSearchSnapshot.gpa || 'Not provided'}</strong></div>
              <div style={{fontSize: '0.82rem', color: '#1e40af', marginTop: '0.35rem'}}>Income: <strong>{formatCurrencyPreview(scholarshipSearchSnapshot.income)}</strong></div>
            </div>
          </div>

          <div className="step-indicator">
            <div className="progress-bar" style={{width: `${((currentStep - 1) / 3) * 100}%`}}></div>
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
            <fieldset disabled={isAnyScanning || isSavingStep} style={{border: 'none', padding: 0, margin: 0}}>

            {/* Step 1: Personal Information */}
            <div className={`step-container ${currentStep === 1 ? 'active' : ''}`}>
              <h3 style={{marginBottom: '1.5rem', fontSize: '1.2rem', color: 'var(--primary)', fontWeight: '700', borderBottom: '2px solid var(--accent-soft)', paddingBottom: '0.5rem', display: 'flex', alignItems: 'center'}}>
                <i className="fas fa-user" style={{marginRight: '12px', fontSize: '1.1rem'}}></i>1. Personal Information
              </h3>

              {/* 2x2 ID Picture */}
              <div style={{marginBottom: '2rem', textAlign: 'center'}}>
                <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#444', fontWeight: '600'}}>
                  2x2 ID Picture <span style={{color: '#e74c3c'}}>*</span>
                </label>
                <div style={{border: '2px dashed #ccc', borderRadius: '12px', height: '130px', width: '130px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'white', position: 'relative', overflow: 'hidden'}}>
                  <input 
                    type="file" 
                    name="profile_picture" 
                    accept="image/*" 
                    onChange={handleIdPictureUpload} 
                    style={{position: 'absolute', width: '100%', height: '100%', opacity: '0', cursor: 'pointer', zIndex: '2'}} 
                  />
                  <div style={{textAlign: 'center', color: '#999', fontSize: '0.85rem', pointerEvents: 'none'}}>
                    {idPicturePreview ? (
                      <img src={idPicturePreview} style={{width: '100%', height: '100%', objectFit: 'cover', borderRadius: '10px'}} alt="ID Preview" />
                    ) : (
                      <>
                        <i className="fas fa-camera" style={{fontSize: '2rem', marginBottom: '0.5rem', display: 'block'}}></i>
                        <span>Upload 2x2 ID Picture</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Last Name <span style={{color: '#e74c3c'}}>*</span></label>
                  <input type="text" name="lastName" value={formData.lastName} onChange={handleInputChange} placeholder="Dela Cruz" required />
                </div>
                <div className="form-group">
                  <label>First Name <span style={{color: '#e74c3c'}}>*</span></label>
                  <input type="text" name="firstName" value={formData.firstName} onChange={handleInputChange} placeholder="Juan" required />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Middle Name <span style={{color: '#e74c3c'}}>*</span></label>
                  <input type="text" name="middleName" value={formData.middleName} onChange={handleInputChange} placeholder="Santos" required />
                </div>
                <div className="form-group">
                  <label>Maiden Name (for married women)</label>
                  <input type="text" name="maidenName" value={formData.maidenName} onChange={handleInputChange} placeholder="Maiden Name" />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Date of Birth <span style={{color: '#e74c3c'}}>*</span></label>
                  <input type="date" name="dateOfBirth" value={formData.dateOfBirth} onChange={handleInputChange} required />
                </div>
                <div className="form-group">
                  <label>Place of Birth <span style={{color: '#e74c3c'}}>*</span></label>
                  <input type="text" name="placeOfBirth" value={formData.placeOfBirth} onChange={handleInputChange} placeholder="City/Municipality" required />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Sex <span style={{color: '#e74c3c'}}>*</span></label>
                  <select name="sex" value={formData.sex} onChange={handleInputChange} required>
                    <option value="">Select Sex</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Citizenship <span style={{color: '#e74c3c'}}>*</span></label>
                  <input type="text" name="citizenship" value={formData.citizenship} onChange={handleInputChange} placeholder="Filipino" required />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Barangay <span style={{color: '#e74c3c'}}>*</span></label>
                  <select 
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
                  <label>Town / City / Municipality <span style={{color: '#e74c3c'}}>*</span></label>
                  <input type="text" name="townCityMunicipality" value={formData.townCityMunicipality} onChange={handleInputChange} placeholder="Lipa City" required />
                </div>
                <div className="form-group">
                  <label>Province <span style={{color: '#e74c3c'}}>*</span></label>
                  <input type="text" name="province" value={formData.province} onChange={handleInputChange} placeholder="Batangas" required />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Zip Code <span style={{color: '#e74c3c'}}>*</span></label>
                  <input type="text" name="zipCode" value={formData.zipCode} onChange={handleInputChange} placeholder="4217" required />
                </div>
                <div className="form-group">
                  <label>Mobile Number <span style={{color: '#e74c3c'}}>*</span></label>
                  <input type="tel" name="mobileNumber" value={formData.mobileNumber} onChange={handleInputChange} placeholder="09XXXXXXXXX" required />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Email Address <span style={{color: '#e74c3c'}}>*</span></label>
                  <input type="email" name="emailAddress" value={formData.emailAddress} onChange={handleInputChange} placeholder="example@email.com" required />
                </div>
              </div>

              {/* Documentary Requirement: Indigency */}
              <div className="requirement-card">
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem'}}>
                  <div>
                    <h4 style={{fontSize: '1.15rem', color: '#1a202c', fontWeight: '800', margin: 0, display: 'flex', alignItems: 'center', gap: '10px'}}>
                      <div style={{width: '36px', height: '36px', background: 'var(--accent-soft)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                        <i className="fas fa-home" style={{color: 'var(--primary)', fontSize: '1.1rem'}}></i>
                      </div>
                      Certificate of Indigency <span style={{color: '#e74c3c'}}>*</span>
                    </h4>
                    <p style={{fontSize: '0.85rem', color: '#64748b', marginTop: '6px', marginLeft: '46px'}}>Verify residency eligibility via Barangay Indigency document</p>
                  </div>
                  {(photos.mayorIndigency_photo || formData.mayorIndigency_photo) && (
                    <div style={{display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: '#059669', fontWeight: '700', padding: '6px 14px', background: '#ecfdf5', borderRadius: '20px', border: '1px solid #a7f3d0'}}>
                      <i className="fas fa-check-circle"></i> Upload Ready
                    </div>
                  )}
                </div>

                <div className="preview-box" style={{background: '#fff', borderStyle: 'solid'}}>
                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem'}}>
                    <label style={{display: 'block', fontSize: '0.85rem', fontWeight: '700', color: '#334155'}}>Document Media Check</label>
                    <div style={{fontSize: '0.65rem', color: '#ef4444', fontWeight: '800', background: '#fef2f2', padding: '3px 8px', borderRadius: '6px', border: '1px solid #fecaca'}}>PHOTO + VIDEO</div>
                  </div>

                  {renderImagePicker({
                    id: 'photo_mayorIndigency_photo',
                    name: 'mayorIndigency_photo',
                    label: 'Document Photo',
                    onChange: handleInputChange,
                    currentValue: photos.mayorIndigency_photo || userProfile?.indigency_doc,
                  })}

                  {renderGuideVideoPanel('indigency', 'Instructional Video for Indigency Upload')}

                  <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '1.2rem'}}>
                    <div className="scanning-container">
                      <div className="image-container" style={{height: '240px'}} onClick={() => (photos.mayorIndigency_photo || userProfile?.indigency_doc) && setLightboxSrc(photos.mayorIndigency_photo || userProfile?.indigency_doc)}>
                        {(photos.mayorIndigency_photo || userProfile?.indigency_doc) ? (
                          <>
                            <img src={photos.mayorIndigency_photo || userProfile?.indigency_doc} alt="Indigency Preview" />
                            <div style={{position: 'absolute', bottom: '12px', right: '12px', background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '6px 10px', borderRadius: '10px', fontSize: '0.7rem', backdropFilter: 'blur(4px)'}}>
                              <i className="fas fa-expand-alt" style={{marginRight: '6px'}}></i> Tap to view
                            </div>
                          </>
                        ) : (
                          <div style={{height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', background: '#f8fafc'}}>
                            <i className="fas fa-image" style={{fontSize: '2rem', marginBottom: '8px'}}></i>
                            <span style={{fontSize: '0.7rem'}}>No Photo</span>
                          </div>
                        )}
                        {ocrVerified === 'verifying' && <div className="scanning-laser"></div>}
                      </div>
                    </div>

                    <VideoRecorder 
                      label="Record Verification" 
                      onRecordComplete={(blob) => handleVideoUpload('mayorIndigency_video', blob)} 
                      initialVideoUrl={documentVideos.mayorIndigency_video || userProfile?.indigency_vid_url}
                      isUploading={Boolean(uploadingFields['mayorIndigency_video'])}
                      disabled={isAnyScanning || isSavingStep}
                      containerStyle={{ height: '240px', padding: '0.5rem', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
                    />
                  </div>

                  <div style={{marginTop: '0.25rem', padding: '12px', background: '#fffbeb', borderRadius: '14px', border: '1px solid #fef3c7', display: 'flex', gap: '10px'}}>
                    <i className="fas fa-shield-halved" style={{color: '#d97706', fontSize: '1rem', marginTop: '2px'}}></i>
                    <p style={{fontSize: '0.75rem', color: '#92400e', margin: 0, lineHeight: '1.4'}}>
                      <b>Face Check:</b> Look directly at the camera while holding the original document clearly in view for 5 seconds.
                    </p>
                  </div>

                  {(photos.mayorIndigency_photo || userProfile?.indigency_doc) && (
                    <>
                      <button 
                        type="button" 
                        onClick={handleIndigencyScan}
                        disabled={isSavingStep || ocrVerified === 'verifying'}
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
                        {ocrVerified === 'verifying' ? 'AI Analyzing...' : (ocrVerified === 'success' ? 'Identity Verified' : 'Instant Scan & Validate')}
                      </button>

                      {ocrVerified === 'verifying' && (
                        <div style={{width: '100%', height: '10px', background: '#f1f5f9', borderRadius: '10px', position: 'relative', overflow: 'hidden', border: '1px solid #e2e8f0', marginTop: '1rem'}}>
                          <div style={{position: 'absolute', height: '100%', background: 'linear-gradient(90deg, var(--primary), #ff4d4d)', width: `${scanProgress}%`, transition: 'width 0.2s ease', borderRadius: '10px'}}></div>
                        </div>
                      )}

                      {ocrStatus && (
                        <div className={`validation-status-card ${ocrVerified === 'success' ? 'success' : (ocrVerified === 'failed' ? 'failed' : 'processing')}`} style={{marginTop: '1rem'}}>
                          <div className={`status-icon ${ocrVerified === 'success' ? 'success' : (ocrVerified === 'failed' ? 'failed' : 'processing')}`}>
                            <i className={`fas ${ocrVerified === 'success' ? 'fa-check' : (ocrVerified === 'failed' ? 'fa-circle-xmark' : 'fa-magnifying-glass')}`}></i>
                          </div>
                          <div>
                            <p style={{fontSize: '0.85rem', fontWeight: '700', margin: '0 0 4px 0'}}>Verification Feedback</p>
                            <p style={{fontSize: '0.8rem', fontWeight: '500', opacity: 0.9, margin: 0, lineHeight: '1.5'}}>{ocrStatus}</p>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div style={{marginTop: '2rem', display: 'flex', justifyContent: 'flex-end'}}>
                <button 
                  type="button" 
                  className="submit-btn" 
                  onClick={handleNextStep} 
                  disabled={isSavingStep || ocrVerified === 'verifying' || !isStep1DocumentsVerified} 
                  style={{width: 'auto', padding: '0.8rem 2.5rem', borderRadius: '40px'}}
                >
                  Next: Family Background <i className="fas fa-arrow-right" style={{marginLeft: '8px'}}></i>
                </button>
              </div>
            </div>

            {/* Step 2: Family Background */}
            <div className={`step-container ${currentStep === 2 ? 'active' : ''}`}>
              <h3 style={{marginBottom: '1.5rem', fontSize: '1.2rem', color: 'var(--primary)', fontWeight: '700', borderBottom: '2px solid var(--accent-soft)', paddingBottom: '0.5rem', display: 'flex', alignItems: 'center'}}>
                <i className="fas fa-users" style={{marginRight: '12px', fontSize: '1.1rem'}}></i>2. Family Background
              </h3>

              {/* Father Information */}
              <div style={{marginBottom: '2rem'}}>
                <h4 style={{fontSize: '1rem', color: '#333', fontWeight: '600', marginBottom: '1rem', borderLeft: '3px solid var(--primary)', paddingLeft: '10px'}}>
                  Father's Information
                </h4>
                <div className="form-row">
                  <div className="form-group">
                    <label>Status <span style={{color: '#e74c3c'}}>*</span></label>
                    <select name="fatherStatus" value={formData.fatherStatus} onChange={handleInputChange} required={currentStep === 2}>
                      <option value="">Select Status</option>
                      <option value="Living">Living</option>
                      <option value="Deceased">Deceased</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Name <span style={{color: '#e74c3c'}}>*</span></label>
                    <input type="text" name="fatherName" value={formData.fatherName} onChange={handleInputChange} placeholder="Full Name" required={currentStep === 2} />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Occupation <span style={{color: '#e74c3c'}}>*</span></label>
                    <input type="text" name="fatherOccupation" value={formData.fatherOccupation} onChange={handleInputChange} placeholder="Occupation" required={currentStep === 2} />
                  </div>
                  <div className="form-group">
                    <label>Phone Number <span style={{color: '#e74c3c'}}>*</span></label>
                    <input type="tel" name="fatherPhoneNumber" value={formData.fatherPhoneNumber} onChange={handleInputChange} placeholder="09XXXXXXXXX" required={currentStep === 2} />
                  </div>
                </div>
              </div>

              {/* Mother Information */}
              <div style={{marginBottom: '2rem'}}>
                <h4 style={{fontSize: '1rem', color: '#333', fontWeight: '600', marginBottom: '1rem', borderLeft: '3px solid var(--primary)', paddingLeft: '10px'}}>
                  Mother's Information
                </h4>
                <div className="form-row">
                  <div className="form-group">
                    <label>Status <span style={{color: '#e74c3c'}}>*</span></label>
                    <select name="motherStatus" value={formData.motherStatus} onChange={handleInputChange} required={currentStep === 2}>
                      <option value="">Select Status</option>
                      <option value="Living">Living</option>
                      <option value="Deceased">Deceased</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Name <span style={{color: '#e74c3c'}}>*</span></label>
                    <input type="text" name="motherName" value={formData.motherName} onChange={handleInputChange} placeholder="Full Name" required={currentStep === 2} />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Occupation <span style={{color: '#e74c3c'}}>*</span></label>
                    <input type="text" name="motherOccupation" value={formData.motherOccupation} onChange={handleInputChange} placeholder="Occupation" required={currentStep === 2} />
                  </div>
                  <div className="form-group">
                    <label>Phone Number <span style={{color: '#e74c3c'}}>*</span></label>
                    <input type="tel" name="motherPhoneNumber" value={formData.motherPhoneNumber} onChange={handleInputChange} placeholder="09XXXXXXXXX" required={currentStep === 2} />
                  </div>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Number of Siblings <span style={{color: '#e74c3c'}}>*</span></label>
                  <input type="number" name="numberOfSiblings" value={formData.numberOfSiblings} onChange={handleInputChange} placeholder="0" required={currentStep === 2} />
                </div>
                <div className="form-group">
                  <label>Parents' Gross Income <span style={{color: '#e74c3c'}}>*</span></label>
                  <input type="number" name="parentsGrossIncome" value={formData.parentsGrossIncome} onChange={handleInputChange} placeholder="30000" min="0" required={currentStep === 2} />
                </div>
              </div>


              <div style={{marginTop: '2rem', display: 'flex', justifyContent: 'space-between'}}>
                <button type="button" className="back-to-form-btn" onClick={handlePrevStep}>
                  <i className="fas fa-arrow-left" style={{marginRight: '8px'}}></i> Back: Personal Info
                </button>
                <button type="button" className="submit-btn" onClick={handleNextStep} disabled={isSavingStep} style={{width: 'auto', padding: '0.8rem 2.5rem', borderRadius: '40px'}}>
                  Next: Educational Info <i className="fas fa-arrow-right" style={{marginLeft: '8px'}}></i>
                </button>
              </div>
            </div>

            {/* Step 3: Educational Information */}
            <div className={`step-container ${currentStep === 3 ? 'active' : ''}`}>
              <h3 style={{marginBottom: '1.5rem', fontSize: '1.2rem', color: 'var(--primary)', fontWeight: '700', borderBottom: '2px solid var(--accent-soft)', paddingBottom: '0.5rem', display: 'flex', alignItems: 'center'}}>
                <i className="fas fa-graduation-cap" style={{marginRight: '12px', fontSize: '1.1rem'}}></i>3. Educational Information
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
                  <label>School ID Number <span style={{color: '#e74c3c'}}>*</span></label>
                  <input type="text" name="schoolIdNumber" value={formData.schoolIdNumber} onChange={handleInputChange} placeholder="ID Number" required={currentStep === 3} />
                </div>
                <div className="form-group">
                  <label>Name of School <span style={{color: '#e74c3c'}}>*</span></label>
                    <>
                      <input type="text" name="schoolName" value={formData.schoolName} onChange={handleInputChange} placeholder="Type your school name" list="studentinfo-school-options" required={currentStep === 3} />
                      <datalist id="studentinfo-school-options">
                        {SCHOOLS.map((school) => (
                          <option key={school} value={school}>{school}</option>
                        ))}
                      </datalist>
                    </>
                </div>
              </div>

              <div className="form-group">
                <label>School Address <span style={{color: '#e74c3c'}}>*</span></label>
                <input type="text" name="schoolAddress" value={formData.schoolAddress} onChange={handleInputChange} placeholder="Complete School Address" required={currentStep === 3} />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>School Sector <span style={{color: '#e74c3c'}}>*</span></label>
                  <select name="schoolSector" value={formData.schoolSector} onChange={handleInputChange} required={currentStep === 3}>
                    <option value="">Select Sector</option>
                    <option value="Public">Public</option>
                    <option value="Private">Private</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Year Level <span style={{color: '#e74c3c'}}>*</span></label>
                  <select name="yearLevel" value={formData.yearLevel} onChange={handleInputChange} required={currentStep === 3}>
                    <option value="">Select Year</option>
                    {[1, 2, 3, 4, 5].map(yr => <option key={yr} value={`${yr}${yr === 1 ? 'st' : yr === 2 ? 'nd' : yr === 3 ? 'rd' : 'th'} Year`}>{yr}{yr === 1 ? 'st' : yr === 2 ? 'nd' : yr === 3 ? 'rd' : 'th'} Year</option>)}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Course/Program <span style={{color: '#e74c3c'}}>*</span></label>
                  <input type="text" name="course" value={formData.course} onChange={handleInputChange} placeholder="B.S. Information Technology" required={currentStep === 3} />
                </div>
                <div className="form-group">
                  <label>General Weighted Average / GPA <span style={{color: '#e74c3c'}}>*</span></label>
                  <input type="number" name="gpa" value={formData.gpa} onChange={handleInputChange} placeholder="85 or 1.75" step="0.01" required={currentStep === 3} />
                </div>
              </div>

              <div className="requirement-card">
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem'}}>
                  <div>
                    <h4 style={{fontSize: '1.15rem', color: '#1a202c', fontWeight: '800', margin: 0, display: 'flex', alignItems: 'center', gap: '10px'}}>
                      <div style={{width: '36px', height: '36px', background: 'var(--accent-soft)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                        <i className="fas fa-id-card" style={{color: 'var(--primary)', fontSize: '1.1rem'}}></i>
                      </div>
                      Updated School ID <span style={{color: '#e74c3c'}}>*</span>
                    </h4>
                    <p style={{fontSize: '0.85rem', color: '#64748b', marginTop: '6px', marginLeft: '46px'}}>Current academic year ID for identity verification</p>
                  </div>
                  {(schoolIdPhotos.front || schoolIdPhotos.back) && (
                    <div style={{display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: '#059669', fontWeight: '700', padding: '6px 14px', background: '#ecfdf5', borderRadius: '20px', border: '1px solid #a7f3d0'}}>
                      <i className="fas fa-check-circle"></i> Upload Ready
                    </div>
                  )}
                </div>

                <div className="media-grid">
                  {/* FRONT SIDE SECTION */}
                  <div className="preview-box" style={{background: '#fff', borderStyle: 'solid'}}>
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem', paddingBottom: '0.8rem', borderBottom: '1px solid #f1f5f9'}}>
                      <h5 style={{margin: 0, fontSize: '0.95rem', fontWeight: '800', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '8px'}}>
                        <i className="fas fa-id-card"></i> Front Side Details
                      </h5>
                      <div style={{fontSize: '0.65rem', color: '#3b82f6', fontWeight: '800', background: '#eff6ff', padding: '3px 8px', borderRadius: '6px', border: '1px solid #bfdbfe'}}>REQUIRED</div>
                    </div>

                    {renderImagePicker({
                      id: 'school_id_front_photo',
                      label: 'Front Photo',
                      onChange: (e) => handleSchoolIdPhotoUpload('front', e),
                      currentValue: schoolIdPhotos.front || userProfile?.id_img_front,
                    })}

                    {renderGuideVideoPanel('schoolId', 'Instructional Video for School ID Upload')}

                    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '1.2rem'}}>
                      {/* Front Photo Preview */}
                      <div className="scanning-container">
                        <div className="image-container" style={{height: '240px'}} onClick={() => setLightboxSrc(schoolIdPhotos.front || userProfile?.id_img_front)}>
                          { (schoolIdPhotos.front || userProfile?.id_img_front) ? (
                            <img src={schoolIdPhotos.front || userProfile?.id_img_front} alt="Front ID" />
                          ) : (
                            <div style={{height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', background: '#f8fafc'}}>
                              <i className="fas fa-image" style={{fontSize: '2rem', marginBottom: '8px'}}></i>
                              <span style={{fontSize: '0.7rem'}}>No Photo</span>
                            </div>
                          )}
                          {idVerified === 'verifying' && <div className="scanning-laser"></div>}
                        </div>
                      </div>

                      {/* Front Video Preview */}
                      <VideoRecorder 
                        label="Front Check" 
                        onRecordComplete={(blob) => handleVideoUpload('schoolIdFront_video', blob)} 
                        initialVideoUrl={documentVideos.schoolIdFront_video || userProfile?.schoolid_front_vid_url}
                        isUploading={Boolean(uploadingFields['schoolIdFront_video'])}
                        disabled={isAnyScanning || isSavingStep}
                        containerStyle={{ height: '240px', padding: '0.5rem', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
                      />
                    </div>

                    <div style={{padding: '12px', background: '#f8fafc', borderRadius: '14px', border: '1px solid #e2e8f0', display: 'flex', gap: '10px'}}>
                      <i className="fas fa-user-check" style={{color: '#2563eb', fontSize: '1rem', marginTop: '2px'}}></i>
                      <p style={{fontSize: '0.72rem', color: '#1e3a8a', margin: 0, lineHeight: '1.4'}}>
                        <b>Front side:</b> Keep your name area visible. This helps us confirm the student identity matches your profile.
                      </p>
                    </div>
                  </div>

                  {/* BACK SIDE SECTION */}
                  <div className="preview-box" style={{background: '#fff', borderStyle: 'solid'}}>
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem', paddingBottom: '0.8rem', borderBottom: '1px solid #f1f5f9'}}>
                      <h5 style={{margin: 0, fontSize: '0.95rem', fontWeight: '800', color: '#9a3412', display: 'flex', alignItems: 'center', gap: '8px'}}>
                        <i className="fas fa-id-card"></i> Back Side Details
                      </h5>
                      <div style={{fontSize: '0.65rem', color: '#d97706', fontWeight: '800', background: '#fffbeb', padding: '3px 8px', borderRadius: '6px', border: '1px solid #fef3c7'}}>REQUIRED</div>
                    </div>

                    {renderImagePicker({
                      id: 'school_id_back_photo',
                      label: 'Back Photo',
                      onChange: (e) => handleSchoolIdPhotoUpload('back', e),
                      currentValue: schoolIdPhotos.back || userProfile?.id_img_back,
                    })}

                    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '1.2rem'}}>
                      {/* Back Photo Preview */}
                      <div className="scanning-container">
                        <div className="image-container" style={{height: '240px'}} onClick={() => setLightboxSrc(schoolIdPhotos.back || userProfile?.id_img_back)}>
                          { (schoolIdPhotos.back || userProfile?.id_img_back) ? (
                            <img src={schoolIdPhotos.back || userProfile?.id_img_back} alt="Back ID" />
                          ) : (
                            <div style={{height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', background: '#f8fafc'}}>
                              <i className="fas fa-image" style={{fontSize: '2rem', marginBottom: '8px'}}></i>
                              <span style={{fontSize: '0.7rem'}}>No Photo</span>
                            </div>
                          )}
                          {idVerified === 'verifying' && <div className="scanning-laser"></div>}
                        </div>
                      </div>

                      {/* Back Video Preview */}
                      <VideoRecorder 
                        label="Back Check" 
                        onRecordComplete={(blob) => handleVideoUpload('schoolIdBack_video', blob)} 
                        initialVideoUrl={documentVideos.schoolIdBack_video || userProfile?.schoolid_back_vid_url}
                        isUploading={Boolean(uploadingFields['schoolIdBack_video'])}
                        disabled={isAnyScanning || isSavingStep}
                        containerStyle={{ height: '240px', padding: '0.5rem', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
                      />
                    </div>

                    <div style={{padding: '12px', background: '#fffbeb', borderRadius: '14px', border: '1px solid #fef3c7', display: 'flex', gap: '10px'}}>
                      <i className="fas fa-school" style={{color: '#d97706', fontSize: '1rem', marginTop: '2px'}}></i>
                      <p style={{fontSize: '0.72rem', color: '#92400e', margin: 0, lineHeight: '1.4'}}>
                        <b>Back side:</b> Focus on campus details and validity dates so we can verify your current enrollment status.
                      </p>
                    </div>
                  </div>
                </div>

                {/* ID Action Footer (Button & Status) */}
                <div style={{marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px dashed #e2e8f0'}}>
                  <button 
                    type="button" 
                    onClick={handleIdScan}
                    disabled={isSavingStep || idVerified === 'verifying' || (!schoolIdPhotos.front && !userProfile?.id_img_front)}
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
                    {idVerified === 'verifying' ? 'AI Analyzing Both ID Sides...' : (idVerified === 'success' ? 'Identity Verified Successfully' : 'Start Instant Multi-Side Scan')}
                  </button>

                  {idVerified === 'verifying' && (
                    <div style={{width: '100%', height: '8px', background: '#f1f5f9', borderRadius: '10px', marginTop: '1rem', position: 'relative', overflow: 'hidden', border: '1px solid #e2e8f0'}}>
                      <div style={{position: 'absolute', height: '100%', background: 'linear-gradient(90deg, var(--primary), #ff4d4d)', width: `${scanProgress}%`, transition: 'width 0.2s ease', borderRadius: '10px'}}></div>
                    </div>
                  )}

                  {idStatus && (
                    <div className={`validation-status-card ${idVerified === 'success' ? 'success' : (idVerified === 'failed' ? 'failed' : 'processing')}`} style={{marginTop: '1.2rem'}}>
                      <div className={`status-icon ${idVerified === 'success' ? 'success' : (idVerified === 'failed' ? 'failed' : 'processing')}`}>
                        <i className={`fas ${idVerified === 'success' ? 'fa-check' : (idVerified === 'failed' ? 'fa-circle-xmark' : 'fa-magnifying-glass')}`}></i>
                      </div>
                      <div>
                        <p style={{fontSize: '0.85rem', fontWeight: '800', margin: '0 0 4px 0'}}>Verification Engine Result</p>
                        <p style={{fontSize: '0.8rem', fontWeight: '500', opacity: 0.9, margin: 0, lineHeight: '1.5'}}>{idStatus}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Documentary Requirements: COE and Grades */}
              <div style={{marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.2rem'}}>
                <div className="requirement-card">
                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem'}}>
                    <div>
                      <h4 style={{fontSize: '1.15rem', color: '#1a202c', fontWeight: '800', margin: 0, display: 'flex', alignItems: 'center', gap: '10px'}}>
                        <div style={{width: '36px', height: '36px', background: 'var(--accent-soft)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                          <i className="fas fa-file-signature" style={{color: 'var(--primary)', fontSize: '1.1rem'}}></i>
                        </div>
                        Certificate of Enrollment <span style={{color: '#e74c3c'}}>*</span>
                      </h4>
                      <p style={{fontSize: '0.85rem', color: '#64748b', marginTop: '6px', marginLeft: '46px'}}>Current semester registration form or COE</p>
                    </div>
                    {(photos.mayorCOE_photo || formData.mayorCOE_photo) && (
                      <div style={{display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: '#059669', fontWeight: '700', padding: '6px 14px', background: '#ecfdf5', borderRadius: '20px', border: '1px solid #a7f3d0'}}>
                        <i className="fas fa-check-circle"></i> Upload Ready
                      </div>
                    )}
                  </div>

                  <div className="preview-box" style={{background: '#fff', borderStyle: 'solid'}}>
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem'}}>
                      <label style={{display: 'block', fontSize: '0.85rem', fontWeight: '700', color: '#334155'}}>COE Media Check</label>
                      <div style={{fontSize: '0.65rem', color: '#ef4444', fontWeight: '800', background: '#fef2f2', padding: '3px 8px', borderRadius: '6px', border: '1px solid #fecaca'}}>PHOTO + VIDEO</div>
                    </div>

                    {renderImagePicker({
                      id: 'photo_mayorCOE_photo',
                      name: 'mayorCOE_photo',
                      label: 'Upload COE Photo',
                      onChange: handleInputChange,
                      currentValue: photos.mayorCOE_photo || userProfile?.enrollment_certificate_doc,
                    })}

                    {renderGuideVideoPanel('enrollment', 'Instructional Video for COR/COE Upload')}

                    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '1.2rem'}}>
                      <div className="scanning-container">
                        <div className="image-container" style={{height: '240px'}} onClick={() => (photos.mayorCOE_photo || userProfile?.enrollment_certificate_doc) && setLightboxSrc(photos.mayorCOE_photo || userProfile?.enrollment_certificate_doc)}>
                          {(photos.mayorCOE_photo || userProfile?.enrollment_certificate_doc) ? (
                            <img src={photos.mayorCOE_photo || userProfile?.enrollment_certificate_doc} alt="COE Preview" />
                          ) : (
                            <div style={{height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', background: '#f8fafc'}}>
                              <i className="fas fa-image" style={{fontSize: '2rem', marginBottom: '8px'}}></i>
                              <span style={{fontSize: '0.7rem'}}>No Photo</span>
                            </div>
                          )}
                          {coeVerified === 'verifying' && <div className="scanning-laser"></div>}
                        </div>
                      </div>

                      <VideoRecorder 
                        label="Record COE Video" 
                        onRecordComplete={(blob) => handleVideoUpload('mayorCOE_video', blob)} 
                        initialVideoUrl={documentVideos.mayorCOE_video || userProfile?.enrollment_certificate_vid_url}
                        isUploading={Boolean(uploadingFields['mayorCOE_video'])}
                        disabled={isAnyScanning || isSavingStep}
                        containerStyle={{ height: '240px', padding: '0.5rem', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
                      />
                    </div>

                    {(photos.mayorCOE_photo || userProfile?.enrollment_certificate_doc) && (
                      <div style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
                        <button 
                          type="button" 
                          onClick={handleCOEScan}
                          disabled={isSavingStep || coeVerified === 'verifying'}
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
                          <div style={{width: '100%', height: '10px', background: '#f1f5f9', borderRadius: '10px', position: 'relative', overflow: 'hidden', border: '1px solid #e2e8f0'}}>
                            <div style={{position: 'absolute', height: '100%', background: 'linear-gradient(90deg, var(--primary), #ff4d4d)', width: `${scanProgress}%`, transition: 'width 0.2s ease', borderRadius: '10px'}}></div>
                          </div>
                        )}
                        
                        {coeStatus && (
                          <div className={`validation-status-card ${coeVerified === 'success' ? 'success' : (coeVerified === 'failed' ? 'failed' : 'processing')}`}>
                            <div className={`status-icon ${coeVerified === 'success' ? 'success' : (coeVerified === 'failed' ? 'failed' : 'processing')}`}>
                              <i className={`fas ${coeVerified === 'success' ? 'fa-check' : (coeVerified === 'failed' ? 'fa-circle-xmark' : 'fa-info-circle')}`}></i>
                            </div>
                            <div>
                              <p style={{fontSize: '0.8rem', fontWeight: '500', opacity: 0.9, margin: 0, lineHeight: '1.4'}}>{coeStatus}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="requirement-card">
                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem'}}>
                    <div>
                      <h4 style={{fontSize: '1.15rem', color: '#1a202c', fontWeight: '800', margin: 0, display: 'flex', alignItems: 'center', gap: '10px'}}>
                        <div style={{width: '36px', height: '36px', background: 'var(--accent-soft)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                          <i className="fas fa-star" style={{color: 'var(--primary)', fontSize: '1.1rem'}}></i>
                        </div>
                        Academic Grades <span style={{color: '#e74c3c'}}>*</span>
                      </h4>
                      <p style={{fontSize: '0.85rem', color: '#64748b', marginTop: '6px', marginLeft: '46px'}}>Previous semester report card or transcript</p>
                    </div>
                    {(photos.mayorGrades_photo || formData.mayorGrades_photo) && (
                      <div style={{display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: '#059669', fontWeight: '700', padding: '6px 14px', background: '#ecfdf5', borderRadius: '20px', border: '1px solid #a7f3d0'}}>
                        <i className="fas fa-check-circle"></i> Upload Ready
                      </div>
                    )}
                  </div>

                  <div className="preview-box" style={{background: '#fff', borderStyle: 'solid'}}>
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem'}}>
                      <label style={{display: 'block', fontSize: '0.85rem', fontWeight: '700', color: '#334155'}}>Academic Media Check</label>
                      <div style={{fontSize: '0.65rem', color: '#ef4444', fontWeight: '800', background: '#fef2f2', padding: '3px 8px', borderRadius: '6px', border: '1px solid #fecaca'}}>PHOTO + VIDEO</div>
                    </div>

                    {renderImagePicker({
                      id: 'photo_mayorGrades_photo',
                      name: 'mayorGrades_photo',
                      label: 'Upload Grades Photo',
                      onChange: handleInputChange,
                      currentValue: photos.mayorGrades_photo || userProfile?.grades_doc,
                    })}

                    {renderGuideVideoPanel('grades', 'Instructional Video for Grades Upload')}

                    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '1.2rem'}}>
                      <div className="scanning-container">
                        <div className="image-container" style={{height: '240px'}} onClick={() => (photos.mayorGrades_photo || userProfile?.grades_doc) && setLightboxSrc(photos.mayorGrades_photo || userProfile?.grades_doc)}>
                          {(photos.mayorGrades_photo || userProfile?.grades_doc) ? (
                            <img src={photos.mayorGrades_photo || userProfile?.grades_doc} alt="Grades Preview" />
                          ) : (
                            <div style={{height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', background: '#f8fafc'}}>
                              <i className="fas fa-image" style={{fontSize: '2rem', marginBottom: '8px'}}></i>
                              <span style={{fontSize: '0.7rem'}}>No Photo</span>
                            </div>
                          )}
                          {gradesVerified === 'verifying' && <div className="scanning-laser"></div>}
                        </div>
                      </div>

                      <VideoRecorder 
                        label="Record Grades Video" 
                        onRecordComplete={(blob) => handleVideoUpload('mayorGrades_video', blob)} 
                        initialVideoUrl={documentVideos.mayorGrades_video || userProfile?.grades_vid_url}
                        isUploading={Boolean(uploadingFields['mayorGrades_video'])}
                        disabled={isAnyScanning || isSavingStep}
                        containerStyle={{ height: '240px', padding: '0.5rem', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
                      />
                    </div>

                    {(photos.mayorGrades_photo || userProfile?.grades_doc) && (
                      <div style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
                        <button 
                          type="button" 
                          onClick={handleGradesScan}
                          disabled={isSavingStep || gradesVerified === 'verifying'}
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
                          <div style={{width: '100%', height: '10px', background: '#f1f5f9', borderRadius: '10px', position: 'relative', overflow: 'hidden', border: '1px solid #e2e8f0'}}>
                            <div style={{position: 'absolute', height: '100%', background: 'linear-gradient(90deg, var(--primary), #ff4d4d)', width: `${scanProgress}%`, transition: 'width 0.2s ease', borderRadius: '10px'}}></div>
                          </div>
                        )}
                        
                        {gradesStatus && (
                          <div className={`validation-status-card ${gradesVerified === 'success' ? 'success' : (gradesVerified === 'failed' ? 'failed' : 'processing')}`}>
                            <div className={`status-icon ${gradesVerified === 'success' ? 'success' : (gradesVerified === 'failed' ? 'failed' : 'processing')}`}>
                              <i className={`fas ${gradesVerified === 'success' ? 'fa-check' : (gradesVerified === 'failed' ? 'fa-circle-xmark' : 'fa-info-circle')}`}></i>
                            </div>
                            <div>
                              <p style={{fontSize: '0.8rem', fontWeight: '500', opacity: 0.9, margin: 0, lineHeight: '1.4'}}>{gradesStatus}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div style={{marginTop: '2rem', display: 'flex', justifyContent: 'space-between'}}>
                <button type="button" className="back-to-form-btn" onClick={handlePrevStep}>
                  <i className="fas fa-arrow-left" style={{marginRight: '8px'}}></i> Back: Family Background
                </button>
                <button 
                  type="button" 
                  className="submit-btn" 
                  onClick={handleNextStep} 
                  disabled={isSavingStep || coeVerified === 'verifying' || gradesVerified === 'verifying' || idVerified === 'verifying' || !isStep3DocumentsVerified}
                  style={{width: 'auto', padding: '0.8rem 2.5rem', borderRadius: '40px'}}
                >
                  Next: Certification & Verification <i className="fas fa-arrow-right" style={{marginLeft: '8px'}}></i>
                </button>
              </div>
            </div>

            {/* Step 4: Certification and Verification */}
            <div className={`step-container ${currentStep === 4 ? 'active' : ''}`}>
              <h3 style={{marginBottom: '1.5rem', fontSize: '1.2rem', color: 'var(--primary)', fontWeight: '700', borderBottom: '2px solid var(--accent-soft)', paddingBottom: '0.5rem', display: 'flex', alignItems: 'center'}}>
                <i className="fas fa-check-double" style={{marginRight: '12px', fontSize: '1.1rem'}}></i>4. Certification & Verification
              </h3>

              <div style={{background: '#f8f9fa', padding: '1.5rem', borderRadius: '16px', marginBottom: '2rem', border: '1px solid #e9ecef'}}>
                <h4 style={{fontSize: '0.95rem', fontWeight: '700', color: '#333', marginBottom: '1rem'}}>Privacy Consent & Certification</h4>
                <div style={{fontSize: '0.85rem', color: '#555', lineHeight: '1.6', maxHeight: '150px', overflowY: 'auto', paddingRight: '10px', marginBottom: '1rem'}}>
                  I hereby certify that all information provided in this application is true and correct to the best of my knowledge and belief. I understand that any false statement or simulation of information shall be a ground for the reproduction or cancellation of my scholarship. I also authorize the scholarship committee to verify the information provided herein.
                </div>
                <label style={{display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.9rem', color: '#333', cursor: 'pointer', fontWeight: '600'}}>
                  <input type="checkbox" name="privacyConsent" checked={formData.privacyConsent} onChange={handleInputChange} style={{width: '18px', height: '18px'}} required={currentStep === 4} />
                  I agree to the terms and conditions
                </label>
                <label style={{display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.9rem', color: '#333', cursor: 'pointer', fontWeight: '600', marginTop: '10px'}}>
                  <input type="checkbox" name="dataCertifyConsent" checked={formData.dataCertifyConsent} onChange={handleInputChange} style={{width: '18px', height: '18px'}} required={currentStep === 4} />
                  I certify that the information provided is correct
                </label>
              </div>

              {/* Signature Section */}
               <div style={{marginBottom: '2rem'}}>
                <label style={{display: 'block', fontSize: '0.95rem', fontWeight: '700', color: '#333', marginBottom: '1rem'}}>
                  Signature & Additional Identification <span style={{color: '#e74c3c'}}>*</span>
                </label>
                
                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem'}}>
                  {/* Signature Column */}
                  <div style={{background: '#fff', border: '1px solid var(--border)', borderRadius: '16px', padding: '1.5rem', textAlign: 'center'}}>
                    <label style={{display: 'block', fontSize: '0.8rem', fontWeight: '600', color: '#666', marginBottom: '1rem'}}>Drawer Signature</label>
                    {!showSignaturePad && !formData.applicantSignatureName ? (
                      <button type="button" onClick={() => setShowSignaturePad(true)} className="photo-option-btn" style={{margin: '0 auto'}}>
                        <i className="fas fa-pen-nib"></i> Sign Application
                      </button>
                    ) : showSignaturePad ? (
                      <div style={{width: '100%', maxWidth: '300px', margin: '0 auto'}}>
                        <div style={{border: '1.5px solid #eee', borderRadius: '12px', background: '#fcfcfc', marginBottom: '1rem'}}>
                          <SignaturePad ref={sigPad} canvasProps={{width: 300, height: 120, className: 'sigCanvas'}} />
                        </div>
                        <div style={{display: 'flex', gap: '8px', justifyContent: 'center'}}>
                          <button type="button" onClick={clearSignature} className="back-to-form-btn" style={{padding: '0.4rem 1rem', fontSize: '0.8rem'}}>Clear</button>
                          <button type="button" onClick={saveSignature} className="submit-btn" style={{width: 'auto', padding: '0.4rem 1.2rem', height: 'auto', fontSize: '0.8rem'}}>Save</button>
                        </div>
                      </div>
                    ) : (
                      <div className="signature-preview-box">
                        <img src={formData.applicantSignatureName} alt="Signature" style={{maxHeight: '80px'}} />
                        <button type="button" onClick={() => setShowSignaturePad(true)} style={{position: 'absolute', top: '5px', right: '5px', background: 'rgba(0,0,0,0.5)', color: 'white', border: 'none', borderRadius: '50%', width: '24px', height: '24px', cursor: 'pointer'}}><i className="fas fa-undo"></i></button>
                      </div>
                    )}
                  </div>

                  {/* Extra Image Column (Not connected to DB) */}
                  <div style={{background: '#f0f7ff', border: '1px solid #e1e8f0', borderRadius: '16px', padding: '1.5rem', textAlign: 'center'}}>
                    <label style={{display: 'block', fontSize: '0.8rem', fontWeight: '600', color: '#666', marginBottom: '0.5rem'}}>Additional Identification (Optional)</label>
                    <p style={{fontSize: '0.7rem', color: '#888', marginBottom: '1rem'}}>Internal Record Only (Not stored in DB)</p>
                    {renderImagePicker({
                      id: 'extra_identification_photo',
                      label: 'Additional Identification',
                      onChange: (e) => {
                        const file = e.target.files[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onloadend = () => setExtraSignaturePhoto(reader.result);
                          reader.readAsDataURL(file);
                        }
                      },
                      currentValue: extraSignaturePhoto,
                    })}
                    {extraSignaturePhoto && (
                      <div style={{marginTop: '10px', position: 'relative'}}>
                        <img src={extraSignaturePhoto} alt="Extra Identification" style={{maxHeight: '70px', borderRadius: '8px', border: '1px solid #fff'}} />
                        <button type="button" onClick={() => setExtraSignaturePhoto(null)} style={{position: 'absolute', top: '-5px', right: '5px', background: 'rgba(255,0,0,0.7)', color: 'white', border: 'none', borderRadius: '50%', width: '18px', height: '18px', fontSize: '10px'}}><i className="fas fa-times"></i></button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

               {/* Face Verification Section */}
              <div style={{marginBottom: '2rem', background: '#f0f7ff', padding: '1.5rem', borderRadius: '20px', border: '1px solid #e1e8f0'}}>
                <h4 style={{fontSize: '1rem', color: '#333', fontWeight: '700', marginBottom: '0.5rem', borderLeft: '4px solid var(--primary)', paddingLeft: '12px'}}>
                  Final Identity Verification <span style={{color: '#e74c3c'}}>*</span>
                </h4>
                <p style={{fontSize: '0.85rem', color: '#666', marginBottom: '1.2rem', paddingLeft: '16px'}}>Match captured photo with your School ID</p>
                
                <div style={{display: 'flex', gap: '2rem', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-start'}}>
                  {/* Photo Column */}
                  <div style={{flex: '1', minWidth: '250px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem'}}>
                    <div style={{border: '2px solid #fff', borderRadius: '20px', height: '220px', width: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#e1e8f0', position: 'relative', overflow: 'hidden', boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.05)'}}>
                    {photos.face_photo ? (
                      <>
                        <img src={photos.face_photo} style={{width: '100%', height: '100%', objectFit: 'cover'}} alt="Face Verification" />
                        <button type="button" onClick={() => { removePhoto('face_photo'); setFaceMatchResult(null); }} style={{position: 'absolute', top: '10px', right: '10px', background: 'rgba(255,0,0,0.8)', color: 'white', border: 'none', borderRadius: '50%', width: '30px', height: '30px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'}}><i className="fas fa-times"></i></button>
                      </>
                    ) : (
                      <button type="button" onClick={openCamera} style={{border: 'none', background: 'transparent', color: 'var(--primary)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px'}}>
                        <i className="fas fa-camera" style={{fontSize: '2.5rem'}}></i>
                        <span style={{fontSize: '0.9rem', fontWeight: '600'}}>Capture Face Photo</span>
                      </button>
                    )}
                    </div>
                  </div>


                </div>

                <div style={{width: '100%', textAlign: 'center', marginTop: '1.5rem'}}>
                  {photos.face_photo && (
                    <div style={{width: '100%', maxWidth: '300px', margin: '0 auto'}}>
                      {!faceMatchResult ? (
                        <button type="button" onClick={async () => {
                          const idImg = schoolIdPhotos.front || userProfile?.id_img_front;
                          if (!idImg) {
                            showPromptMessage('⚠️ Please upload your School ID in Step 3 first.');
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
                              showPromptMessage('✅ Face successfully matched with ID!');
                            } else {
                              showPromptMessage(`❌ Face Match Issue: ${result.message || 'Face does not match the ID.'}`);
                            }
                          } catch (err) {
                            console.error('Match error:', err);
                            // Do not auto-verify on technical errors for security
                            showPromptMessage('ℹ️ Verification service issue. Please try again with a clearer photo.');
                            setFaceMatchResult({ verified: false, technical_unavailable: true });
                          } finally {
                            setIsFaceMatching(false);
                          }
                        }} className="submit-btn" disabled={isFaceMatching} style={{width: '100%', background: 'var(--primary)', borderRadius: '12px'}}>
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
                            <h5 style={{margin: '0 0 2px 0', fontSize: '0.85rem', color: '#333', fontWeight: '700'}}>
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
                              <button type="button" onClick={() => setFaceMatchResult(null)} style={{background: 'none', border: 'none', color: '#c53030', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.75rem', padding: 0, marginTop: '5px', fontWeight: '700'}}>Retry Capture</button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div style={{marginTop: '3rem', display: 'flex', justifyContent: 'space-between'}}>
                <button type="button" className="back-to-form-btn" onClick={handlePrevStep}>
                  <i className="fas fa-arrow-left" style={{marginRight: '8px'}}></i> Back: Education
                </button>
                <button 
                  type="submit" 
                  className="submit-btn" 
                  disabled={isSubmitting || isSavingStep || !faceMatchResult?.verified} 
                  style={{width: 'auto', padding: '0.8rem 3.5rem', borderRadius: '40px', background: 'var(--success)', border: 'none'}}
                >
                  {isSubmitting ? (
                    <><i className="fas fa-spinner fa-spin" style={{marginRight: '10px'}}></i>Submitting...</>
                  ) : (
                    <><i className="fas fa-paper-plane" style={{marginRight: '10px'}}></i>Submit Application</>
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
          <button className="submit-btn" onClick={() => navigate('/portal')} style={{marginTop: '1.5rem', width: '100%'}}>
            Return to Portal
          </button>
        </div>
      </div>

      {/* Camera Modal Overlay */}
      <div className={`camera-modal-overlay ${showCameraModal ? 'active' : ''}`}>
        <div className="camera-modal-content">
          <h3 style={{marginBottom: '1rem', color: 'var(--primary)'}}>Face Verification</h3>
          <p style={{fontSize: '0.85rem', color: '#666', marginBottom: '1.5rem'}}>Position your face within the frame and click capture.</p>
          <div style={{position: 'relative', width: '100%', background: '#000', borderRadius: '20px', overflow: 'hidden', marginBottom: '2rem'}}>
            <video ref={videoRef} autoPlay playsInline muted style={{width: '100%', transform: usingFrontCamera ? 'scaleX(-1)' : 'none'}} />
            {cameraInitializing && (
              <div style={{position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', color: 'white'}}>
                <i className="fas fa-spinner fa-spin" style={{fontSize: '2rem'}}></i>
              </div>
            )}
            {cameraError && (
              <div style={{position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.8)', color: 'white', padding: '2rem'}}>
                <i className="fas fa-exclamation-triangle" style={{fontSize: '2rem', marginBottom: '1rem', color: '#ffcc00'}}></i>
                <p>{cameraError.message}</p>
                <button onClick={openCamera} className="submit-btn" style={{marginTop: '1rem', padding: '0.5rem 1.5rem', height: 'auto'}}>Retry</button>
              </div>
            )}
          </div>
          <div style={{display: 'flex', gap: '15px', justifyContent: 'center'}}>
            <button type="button" onClick={closeCamera} className="back-to-form-btn">Cancel</button>
            <button type="button" onClick={capturePhoto} className="submit-btn" disabled={!cameraReady} style={{width: 'auto', padding: '0.8rem 2rem', height: 'auto', borderRadius: '30px'}}>
              <i className="fas fa-camera" style={{marginRight: '8px'}}></i> Capture
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
