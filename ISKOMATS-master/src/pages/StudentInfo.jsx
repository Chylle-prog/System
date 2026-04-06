import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import SignaturePad from '../components/SignaturePad';
import { applicantAPI, applicationAPI } from '../services/api';

const STEP_FIELDS = {
  1: [
    'lastName', 'firstName', 'middleName', 'maidenName', 'dateOfBirth', 'placeOfBirth',
    'streetBarangay', 'townCity', 'province', 'zipCode', 'sex', 'citizenship',
    'mobileNumber'
  ],
  2: [
    'fatherStatus', 'fatherName', 'fatherOccupation', 'fatherAddress', 'fatherPhoneNumber',
    'motherStatus', 'motherName', 'motherOccupation', 'motherAddress', 'motherPhoneNumber',
    'parentsGrossIncome', 'numberOfSiblings', 'mayorIndigency_photo'
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

    if (typeof value === 'string' && value.startsWith('data:')) {
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

  // School ID photo states
  const [schoolIdPhotos, setSchoolIdPhotos] = useState({
    front: null,
    back: null
  });

  // Verification States
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [cameraInitializing, setCameraInitializing] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [usingFrontCamera, setUsingFrontCamera] = useState(true);
  const [currentStream, setCurrentStream] = useState(null);
  const [cameraPermissionStatus, setCameraPermissionStatus] = useState('');
  const [ocrError, setOcrError] = useState('');
  const [ocrVerified, setOcrVerified] = useState(null); // null, 'verifying', 'success', 'failed'
  const [ocrStatus, setOcrStatus] = useState('');
  const [photos, setPhotos] = useState({
    id_front: null,
    id_back: null,
    face_photo: null
  });
  const [extraSignaturePhoto, setExtraSignaturePhoto] = useState(null);
  const [isFaceMatching, setIsFaceMatching] = useState(false);
  const [faceMatchResult, setFaceMatchResult] = useState(null); // { verified: boolean, confidence: number }
  const [faceVerified, setFaceVerified] = useState(null); // null | 'verifying' | 'success' | 'failed' | 'technical_unavailable'

  const idPictureInputRef = useRef(null);
  const signatureInputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const sigPad = useRef(null);
  const cameraTimeoutRef = useRef(null);

  const [showSignaturePad, setShowSignaturePad] = useState(false);

  const [formData, setFormData] = useState({
    // Personal Information
    lastName: '',
    firstName: '',
    middleName: '',
    maidenName: '',
    dateOfBirth: '',
    placeOfBirth: '',
    streetBarangay: '',
    townCity: '',
    province: '',
    zipCode: '',
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
    
    // Family Background
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
    
    // Documentary Requirements
    mayorCOE_photo: null,
    mayorGrades_photo: null,
    mayorIndigency_photo: null,

    // School ID Photos
    schoolIdFront: null,
    schoolIdBack: null,
    
    // Certification
    privacyConsent: false,
    dataCertifyConsent: false,
    applicantSignatureName: '',
    dateAccomplished: ''
  });

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

  const saveCurrentStepProgress = async (stepNumber = currentStep) => {
    const payload = new FormData();
    const jsonData = {};
    let hasPayload = false;

    for (const fieldName of STEP_FIELDS[stepNumber] || []) {
      let value = formData[fieldName];

      if (value === undefined || value === null || value === '') {
        continue;
      }

      // Convert display values back to database values
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

      const signatureData = drawnSignature || signaturePreview;
      if (signatureData) {
        if (isFileLike(signatureData)) {
          payload.append('signature_data', signatureData);
        } else if (typeof signatureData === 'string' && signatureData.startsWith('data:')) {
          jsonData['signature_data'] = signatureData;
        }
        hasPayload = true;
      }
    }

    persistDraft(currentUser);

    if (!hasPayload) {
      return;
    }

    // If there's JSON data and no files, use JSON request; otherwise use FormData
    if (Object.keys(jsonData).length > 0 && Array.from(payload.entries()).length === 0) {
      await applicantAPI.updateProfile(jsonData);
    } else if (Object.keys(jsonData).length > 0) {
      // Mix of files and data URIs - append JSON data as string
      Object.entries(jsonData).forEach(([key, value]) => {
        payload.append(key, value);
      });
      await applicantAPI.updateProfile(payload);
    } else {
      await applicantAPI.updateProfile(payload);
    }
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

    // Image Compression Utility
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
            
            // Get compressed base64
            const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
            resolve(compressedBase64);
          };
          img.onerror = reject;
        };
        reader.onerror = reject;
      });
    };
    window.compressImage = compressImage; // Make it available globally in the component scope

    // Load user data
    const user = localStorage.getItem('currentUser');
    
    if (!user) {
      navigate('/login');
      return;
    }

    setCurrentUser(user);

    // Get scholarship name and search criteria from URL params
    const scholarship = searchParams.get('scholarship');
    const urlGpa = searchParams.get('gpa');
    const urlIncome = searchParams.get('income');
    const draftKey = buildDraftStorageKey(user, searchParams, scholarship || scholarshipName);
    let savedDraft = null;

    try {
      const rawDraft = sessionStorage.getItem(draftKey);
      savedDraft = rawDraft ? JSON.parse(rawDraft) : null;
    } catch {
      savedDraft = null;
    }
    
    // Ensure each scholarship form always starts from step 1
    setCurrentStep(1);
    if (scholarship) {
      setScholarshipName(scholarship);
    }

    // Pre-fill profile data from backend API
    const loadProfile = async () => {
      try {
        setLoadingMessage({ title: 'Loading Profile', message: 'Retrieving your information to pre-fill the application...' });
        setIsInitialLoading(true);
        const profile = await applicantAPI.getProfile();
        setUserProfile(profile);

        setFormData(prev => mergeMeaningfulValues(prev, {
          firstName: profile.first_name || '',
          lastName: profile.last_name || '',
          middleName: profile.middle_name || '',
          maidenName: profile.maiden_name || '',
          dateOfBirth: profile.birthdate || '',
          placeOfBirth: profile.birth_place || '',
          streetBarangay: profile.street_brgy || '',
          townCity: profile.town_city_municipality || '',
          province: profile.province || '',
          zipCode: profile.zip_code || '',
          sex: profile.sex === 'M' ? 'Male' : profile.sex === 'F' ? 'Female' : (profile.sex || ''),
          citizenship: profile.citizenship || '',
          schoolIdNumber: profile.school_id_no || '',
          schoolName: profile.school || '',
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
          parentsGrossIncome: urlIncome || profile.financial_income_of_parents || '',
          gpa: urlGpa || profile.overall_gpa || '',
          numberOfSiblings: profile.sibling_no || '',
          course: profile.course || ''
        }));

        // Load profile picture
        if (profile.profile_picture) {
          setIdPicturePreview(profile.profile_picture);
        }
        
        // Load school ID photos (front and back)
        if (profile.id_img_front) {
          setSchoolIdPhotos(prev => ({ ...prev, front: profile.id_img_front }));
        }
        if (profile.id_img_back) {
          setSchoolIdPhotos(prev => ({ ...prev, back: profile.id_img_back }));
        }
        
        // Load documentary requirement photos
        if (profile.enrollment_certificate_doc) {
          setPhotos(prev => ({ ...prev, mayorCOE_photo: profile.enrollment_certificate_doc }));
        }
        if (profile.grades_doc) {
          setPhotos(prev => ({ ...prev, mayorGrades_photo: profile.grades_doc }));
        }
        if (profile.indigency_doc) {
          setPhotos(prev => ({ ...prev, mayorIndigency_photo: profile.indigency_doc }));
        }
        
        // Load final verification ID photo
        if (profile.id_pic) {
          setPhotos(prev => ({ ...prev, mayorValidID_photo: profile.id_pic }));
        }
        
        // Load signature
        if (profile.signature_image_data) {
          setFormData(prev => ({ ...prev, applicantSignatureName: profile.signature_image_data }));
          setSignaturePreview(profile.signature_image_data);
        }
        
        if (profile.has_other_assistance) {
          setHasOtherAssistance('Yes');
        } else if (profile.has_other_assistance === false) {
          setHasOtherAssistance('No');
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
  }, [navigate, searchParams]); // Removed currentStream from dependencies to avoid infinite loops if it changes

  useEffect(() => {
    if (!currentUser) {
      return;
    }

    persistDraft(currentUser);
  }, [currentUser, formData, hasOtherAssistance, currentStep, scholarshipName, searchParams]);

  // Camera functions
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

    // Apply slightly higher quality for face photo as it's critical
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    setPhotos(prev => ({ ...prev, face_photo: dataUrl }));
    setFaceVerificationPreview(dataUrl);
    
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
        if (type === 'face_photo') setFaceVerificationPreview(compressedBase64);
        
        // Keep face verification local; the backend has a single id_pic slot.
        if (type !== 'face_photo') {
          applicantAPI.updateProfile({ [type]: compressedBase64 }).catch(console.error);
        }
      });
    }
  };

  const removePhoto = (type) => {
    setPhotos(prev => ({ ...prev, [type]: null }));
    if (type === 'face_photo') setFaceVerificationPreview(null);
    const fileInput = document.getElementById(`photo_${type}`);
    if (fileInput) fileInput.value = '';
  };

  const logout = () => {
    localStorage.removeItem('currentUser');
    navigate('/');
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked, files } = e.target;
    
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
          
          // Auto-save progress
          applicantAPI.updateProfile({ [name]: compressedBase64 }).catch(console.error);
        });
        
        // Handle previews
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
          
          // Auto-save progress
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
      window.compressImage(file, 400).then(compressedBase64 => { // Smaller size for 2x2 ID
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
        setFormData(prev => ({ 
          ...prev, 
          [`schoolId${side.charAt(0).toUpperCase() + side.slice(1)}`]: compressedBase64
        }));
        // Also update the photos state for Step 5 validation and backend
        const photoKey = side === 'front' ? 'id_front' : 'id_back';
        setPhotos(prev => ({ ...prev, [photoKey]: compressedBase64 }));
        
        // Auto-save progress
        applicantAPI.updateProfile({ 
          [photoKey]: compressedBase64
        }).catch(console.error);
      });
    }
  };

  const performOcrVerification = async (idFront, indigencyDoc) => {
    try {
      setOcrVerified('verifying');
      setOcrStatus('Verifying your identity and address documents...');
      
      const result = await applicantAPI.ocrCheck(idFront, indigencyDoc);
      
      if (result.verified) {
        setOcrVerified('success');
        setOcrStatus(result.message || 'Identity and address verified successfully!');
        return true;
      } else {
        // Handle technical unavailability as a non-blocking "soft" failure
        const isTechnical = result.message?.includes('temporarily unavailable') || 
                           result.message?.includes('Low memory mode') ||
                           result.message?.includes('OCR service');
        
        if (isTechnical) {
          setOcrVerified('technical_unavailable');
          const techMsg = result.message || 'OCR service temporarily unavailable';
          setOcrStatus(techMsg);
          showPromptMessage(`ℹ️ Note: ${techMsg}. You can still proceed to the next step.`);
          return true; // Allow proceeding
        }

        setOcrVerified('failed');
        const errorMsg = result.message || 'Identity verification failed. Please ensure your documents are clear.';
        setOcrStatus(errorMsg);
        showPromptMessage(`❌ Verification Issue: ${errorMsg}`);
        return false;
      }
    } catch (err) {
      console.error('OCR Error:', err);
      
      // Also treat network/server errors as non-blocking technical issues
      setOcrVerified('technical_unavailable');
      const errorMsg = err.message || 'Technical error during verification';
      setOcrStatus(`Technical Issue: ${errorMsg}`);
      showPromptMessage(`⚠️ Note: Verification service issue (${errorMsg}). You can still proceed.`);
      return true; // Allow proceeding despite technical error
    }
  };

  const removeSchoolIdPhoto = (side) => {
    setSchoolIdPhotos(prev => ({ ...prev, [side]: null }));
    setFormData(prev => ({ ...prev, [`schoolId${side.charAt(0).toUpperCase() + side.slice(1)}`]: null }));
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
          const hasSavedFile = Boolean(formData[field.name] || userProfile?.[`has_${field.name}`]);
          if (!hasSavedFile) {
            isMissing = true;
          }
        }
      } else if (!field.value.trim() && field.type !== 'file') {
        isMissing = true;
        field.style.borderColor = '#e74c3c';
      }
    });

    if (currentStep === 1 && !idPicturePreview) {
      showPromptMessage('⚠️ Please upload your 2x2 ID Picture.');
      return;
    }

    if (currentStep === 3) {
      if ((!schoolIdPhotos.front && !userProfile?.has_id_img_front) || (!schoolIdPhotos.back && !userProfile?.has_id_img_back)) {
        showPromptMessage('⚠️ Please upload both front and back of your School ID.');
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
      
      // ── STEP 2: Address OCR verification (indigency photo + townCity) ────────
      if (currentStep === 2) {
        const indigencyDoc = photos.mayorIndigency_photo
          || formData.mayorIndigency_photo
          || userProfile?.indigency_doc;
        // Use the town/city the user filled in (or what's already in the profile)
        const townCity = formData.townCity || userProfile?.town_city_municipality || '';

        if (indigencyDoc && townCity) {
          setLoadingMessage({
            title: 'Verifying Address',
            message: 'Checking your Certificate of Indigency against your registered town/city…'
          });

          // Re-use the existing OCR check endpoint:
          // id_front is not needed here — pass null so the backend only does address matching.
          // We pass the indigency doc as the address image.
          try {
            const result = await applicantAPI.ocrCheck(null, indigencyDoc, townCity);
            const isTechnical = result.message?.includes('temporarily unavailable')
              || result.message?.includes('Low memory mode')
              || result.message?.includes('OCR service');

            if (!result.verified && !isTechnical) {
              setOcrVerified('failed');
              setOcrStatus(result.message || 'Address mismatch: your Certificate of Indigency does not match your registered city/municipality.');
              showPromptMessage(
                `❌ Address mismatch: The city/municipality on your Certificate of Indigency does not match "${townCity}". Please check your document or update your address.`,
                7000
              );
              setIsSavingStep(false);
              return; // Stay on Step 2
            }

            if (isTechnical) {
              setOcrVerified('technical_unavailable');
              setOcrStatus(result.message || 'OCR service temporarily unavailable — you may proceed.');
              showPromptMessage(`ℹ️ OCR unavailable: ${result.message}. You can still continue.`, 4000);
            } else {
              setOcrVerified('success');
              setOcrStatus(result.message || `Address verified — city/municipality matches!`);
            }
          } catch (ocrErr) {
            // Network / server error — treat as technical, allow proceeding
            setOcrVerified('technical_unavailable');
            setOcrStatus(`Address OCR error: ${ocrErr.message}`);
            showPromptMessage(`⚠️ Address verification issue (${ocrErr.message}). You can still continue.`, 4000);
          }
        } else if (!indigencyDoc) {
          // No indigency photo uploaded yet — skip OCR, field validation already blocks empty required docs
          console.log('[OCR] Skipping address verification: no indigency photo yet.');
        }
      }

      // ── STEP 3: No OCR needed here anymore ───────────────────────────────────

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
    setCurrentStep(prev => Math.max(prev - 1, 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleApplicationSubmit = async (e) => {
    e.preventDefault();

    const requiredFields = [
      { name: 'lastName', label: 'Last Name' },
      { name: 'firstName', label: 'First Name' },
      { name: 'middleName', label: 'Middle Name' },
      { name: 'dateOfBirth', label: 'Date of Birth' },
      { name: 'placeOfBirth', label: 'Place of Birth' },
      { name: 'streetBarangay', label: 'Street & Barangay' },
      { name: 'townCity', label: 'Town/City' },
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

    // Validate Required Documents
    const requiredDocs = [
      { name: 'mayorCOE_photo', label: 'COE Photo' },
      { name: 'mayorGrades_photo', label: 'Grades Photo' },
      { name: 'mayorIndigency_photo', label: 'Indigency Photo' }
    ];

    let missingDocLabel = '';
    for (const doc of requiredDocs) {
      if (!formData[doc.name] && !userProfile?.[`has_${doc.name}`]) {
        missingDocLabel = doc.label;
        break;
      }
    }

    if (missingDocLabel) {
      showPromptMessage(`⚠️ Please upload the document: ${missingDocLabel}.`);
      return;
    }

    // Validate Identity Verification
    // Both front/back School ID are still required for the backend
    if (
      (!photos.id_front && !userProfile?.has_id_img_front) ||
      (!photos.id_back && !userProfile?.has_id_img_back) ||
      (!photos.face_photo && !userProfile?.has_face_photo)
    ) {
      showPromptMessage('⚠️ Please complete Identity Verification: Upload Front/Back School ID and a Face Photo.');
      return;
    }

    // Validate Checkboxes
    if (!formData.privacyConsent) {
      showPromptMessage('⚠️ Please accept the Privacy Policy to proceed.');
      return;
    }
    if (!formData.dataCertifyConsent) {
      showPromptMessage('⚠️ Please certify that the information provided is correct.');
      return;
    }

    // Check if either signature image is uploaded or drawn
    if (!signaturePreview && !drawnSignature && !userProfile?.has_signature) {
      showPromptMessage('⚠️ Please either upload a signature photo or draw your signature.');
      return;
    }

    // Try to get numeric ID from URL parameters
    let reqNo = searchParams.get('reqNo');
    if (!reqNo || isNaN(parseInt(reqNo))) {
      reqNo = searchParams.get('scholarship_id');
    }
    
    if (!reqNo || isNaN(parseInt(reqNo))) {
      showPromptMessage('⚠️ Scholarship ID missing or invalid.');
      return;
    }

    const numericReqNo = parseInt(reqNo, 10);

    try {
      // ── Automatic Face Verification ────────────────────────────────────────
      const facePhoto = photos.face_photo;
      const idFrontForFace = schoolIdPhotos.front || userProfile?.id_img_front;

      if (facePhoto && idFrontForFace && faceVerified !== 'success') {
        setLoadingMessage({
          title: 'Verifying Face',
          message: 'Matching your selfie against your School ID photo…'
        });
        setFaceVerified('verifying');
        try {
          // Call the backend OCR-check endpoint which runs DeepFace internally.
          // We send face_photo as id_front and the actual id_front as indigency_doc
          // so the backend can distinguish them — instead, call submit with full data
          // and let the backend do face matching (skip_verification=false).
          // The skipVerification flag only skips if address OCR already passed.
          const skipVerification = false; // Always run, backend handles face matching
          setFaceVerified('success'); // Optimistic — backend will do the real check
          console.log('[FACE] Face verification will be handled by the backend during submission.');
        } catch (faceErr) {
          console.warn('[FACE] Face pre-check error:', faceErr.message);
          setFaceVerified('technical_unavailable');
        }
      }
      // ──────────────────────────────────────────────────────────────────────────

      // If identity was already address-verified in Step 2, skip OCR on submission
      // but always run face matching on the backend
      const skipVerification = false; // always let backend run face matching

      console.log(`Submitting application (faceVerified: ${faceVerified})...`);

      await saveCurrentStepProgress(4);

      const submissionData = new FormData();
      
      // Define image keys to exclude from general formData loop to avoid double-sending
      const imageKeys = [
        'profile_picture', 'id_front', 'id_back', 'face_photo', 
        'mayorCOE_photo', 'mayorGrades_photo', 'mayorIndigency_photo',
        'applicantSignatureName', 'signature_data'
      ];

      // Append all text fields from formData, excluding images
      Object.keys(formData).forEach(key => {
        if (!imageKeys.includes(key) && formData[key] !== null && formData[key] !== undefined) {
          submissionData.append(key, formData[key]);
        }
      });

      // Append photos and documents explicitly once from the photos state
      if (photos.profile_picture) submissionData.append('profile_picture', photos.profile_picture);
      if (photos.id_front || schoolIdPhotos.front) submissionData.append('id_front', photos.id_front || schoolIdPhotos.front);
      if (photos.id_back  || schoolIdPhotos.back)  submissionData.append('id_back',  photos.id_back  || schoolIdPhotos.back);
      if (photos.face_photo) submissionData.append('face_photo', photos.face_photo);
      
      if (drawnSignature) {
        submissionData.append('signature_data', drawnSignature);
      } else if (signaturePreview) {
        submissionData.append('signature_data', signaturePreview);
      }
      
      // Add documentary requirements
      const docKeys = ['mayorCOE', 'mayorGrades', 'mayorIndigency'];
      docKeys.forEach(key => {
        const fileKey = `${key}_photo`;
        if (photos[fileKey]) {
          submissionData.append(fileKey, photos[fileKey]);
        } else if (formData[fileKey] && typeof formData[fileKey] === 'string') {
          submissionData.append(fileKey, formData[fileKey]);
        }
      });

      // Submit application — always run face matching on the backend
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
          max-width: 650px;
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

        .small-prompt {
          position: fixed;
          bottom: 20px;
          right: 20px;
          background: #333;
          color: white;
          padding: 10px 20px;
          border-radius: 30px;
          font-size: 0.9rem;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
          z-index: 3000;
          opacity: 0;
          transition: opacity 0.3s;
          pointer-events: none;
        }

        .small-prompt.show {
          opacity: 1;
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

        @media (max-width: 768px) {
          .step-label { display: none; }
          .form-card { padding: 1.5rem; }
          .navbar { padding: 1rem 5%; }
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

      <div className={`small-prompt ${showPrompt ? 'show' : ''}`}>
        {promptMessage}
      </div>

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

          <form onSubmit={handleApplicationSubmit}>

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
                <div style={{border: '2px dashed #ccc', borderRadius: '12px', height: '150px', width: '150px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'white', position: 'relative', overflow: 'hidden'}}>
                  <input type="file" name="profile_picture" accept="image/*" required onChange={handleIdPictureUpload} style={{position: 'absolute', width: '100%', height: '100%', opacity: '0', cursor: 'pointer', zIndex: '2'}} />
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

              <div className="form-group">
                <label>Permanent Address <span style={{color: '#e74c3c'}}>*</span></label>
                <div className="form-row" style={{gridTemplateColumns: '2fr 1fr 1fr'}}>
                  <input type="text" name="streetBarangay" value={formData.streetBarangay} onChange={handleInputChange} placeholder="Street & Barangay" required />
                  <input type="text" name="townCity" value={formData.townCity} onChange={handleInputChange} placeholder="Town/City" required />
                  <input type="text" name="province" value={formData.province} onChange={handleInputChange} placeholder="Province" required />
                </div>
                <div style={{marginTop: '0.5rem', width: '25%'}}>
                  <input type="text" name="zipCode" value={formData.zipCode} onChange={handleInputChange} placeholder="Zip Code" required />
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
                  <label>Mobile Number <span style={{color: '#e74c3c'}}>*</span></label>
                  <input type="tel" name="mobileNumber" value={formData.mobileNumber} onChange={handleInputChange} placeholder="09XXXXXXXXX" required />
                </div>
                <div className="form-group">
                  <label>Email Address <span style={{color: '#e74c3c'}}>*</span></label>
                  <input type="email" name="emailAddress" value={formData.emailAddress} onChange={handleInputChange} style={{background: '#f8f9fa'}} readOnly />
                </div>
              </div>

              <div style={{marginTop: '2rem', display: 'flex', justifyContent: 'flex-end'}}>
                <button type="button" className="submit-btn" onClick={handleNextStep} disabled={isSavingStep} style={{width: 'auto', padding: '0.8rem 2.5rem', borderRadius: '40px'}}>
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
                <div className="form-group">
                  <label>Address <span style={{color: '#e74c3c'}}>*</span></label>
                  <input type="text" name="fatherAddress" value={formData.fatherAddress} onChange={handleInputChange} placeholder="Permanent Address" required={currentStep === 2} />
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
                <div className="form-group">
                  <label>Address <span style={{color: '#e74c3c'}}>*</span></label>
                  <input type="text" name="motherAddress" value={formData.motherAddress} onChange={handleInputChange} placeholder="Permanent Address" required={currentStep === 2} />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Number of Siblings <span style={{color: '#e74c3c'}}>*</span></label>
                  <input type="number" name="numberOfSiblings" value={formData.numberOfSiblings} onChange={handleInputChange} placeholder="0" required={currentStep === 2} />
                </div>
              </div>

              {/* Documentary Requirement: Indigency */}
              <div style={{marginTop: '1.5rem', background: '#f0f7ff', padding: '1.5rem', borderRadius: '20px', border: '1px solid #e1e8f0'}}>
                <h4 style={{fontSize: '1rem', color: '#333', fontWeight: '700', marginBottom: '0.5rem', borderLeft: '4px solid var(--primary)', paddingLeft: '12px'}}>
                  Certificate of Indigency <span style={{color: '#e74c3c'}}>*</span>
                </h4>
                <p style={{fontSize: '0.85rem', color: '#666', marginBottom: '1rem', paddingLeft: '16px'}}>Photo (.png/jpg)</p>
                <div style={{paddingLeft: '16px'}}>
                  <input type="file" name="mayorIndigency_photo" accept="image/*" onChange={handleInputChange} required={currentStep === 2} />
                  {photos.mayorIndigency_photo && (
                    <div style={{marginTop: '1rem'}}>
                      <img src={photos.mayorIndigency_photo} style={{maxWidth: '200px', borderRadius: '12px', boxShadow: '0 4px 10px rgba(0,0,0,0.1)'}} alt="Indigency Preview" />
                    </div>
                  )}
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
                  <label>School ID Number <span style={{color: '#e74c3c'}}>*</span></label>
                  <input type="text" name="schoolIdNumber" value={formData.schoolIdNumber} onChange={handleInputChange} placeholder="ID Number" required={currentStep === 3} />
                </div>
                <div className="form-group">
                  <label>Name of School <span style={{color: '#e74c3c'}}>*</span></label>
                  <select name="schoolName" value={formData.schoolName} onChange={handleInputChange} required={currentStep === 3}>
                    <option value="">Select School</option>
                    <option value="DLSL/De La Salle Lipa">DLSL/De La Salle Lipa</option>
                    <option value="NU/National University Lipa">NU/National University Lipa</option>
                    <option value="Batangas State University">Batangas State University</option>
                    <option value="Kolehiyo ng Lungsod ng Lipa">Kolehiyo ng Lungsod ng Lipa</option>
                    <option value="Philippine State College of Aeronautics">Philippine State College of Aeronautics</option>
                    <option value="Lipa City Colleges">Lipa City Colleges</option>
                    <option value="University of Batangas">University of Batangas</option>
                    <option value="New Era University">New Era University</option>
                    <option value="Batangas College of Arts and Sciences">Batangas College of Arts and Sciences</option>
                    <option value="Royal British College">Royal British College</option>
                    <option value="STI Academic Center">STI Academic Center</option>
                    <option value="AMA Computer College">AMA Computer College</option>
                    <option value="ICT-ED">ICT-ED</option>
                  </select>
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
              </div>

              <div style={{marginBottom: '2rem', background: '#f0f7ff', padding: '1.5rem', borderRadius: '20px', border: '1px solid #e1e8f0'}}>
                <h4 style={{fontSize: '1rem', color: '#333', fontWeight: '700', marginBottom: '0.5rem', borderLeft: '4px solid var(--primary)', paddingLeft: '12px'}}>
                  Updated School ID (Photo) <span style={{color: '#e74c3c'}}>*</span>
                </h4>
                <p style={{fontSize: '0.85rem', color: '#666', marginBottom: '1.2rem', paddingLeft: '16px'}}>Photo (.png/jpg)</p>
                
                <div className="form-row" style={{paddingLeft: '16px'}}>
                  <div className="form-group">
                    <label style={{fontSize: '0.8rem', color: '#555'}}>Front Side</label>
                    <input type="file" accept="image/*" onChange={(e) => handleSchoolIdPhotoUpload('front', e)} required={currentStep === 3} />
                    {schoolIdPhotos.front && <img src={schoolIdPhotos.front} style={{marginTop: '10px', width: '100%', maxWidth: '150px', borderRadius: '8px'}} alt="Front Preview" />}
                  </div>
                  <div className="form-group">
                    <label style={{fontSize: '0.8rem', color: '#555'}}>Back Side</label>
                    <input type="file" accept="image/*" onChange={(e) => handleSchoolIdPhotoUpload('back', e)} required={currentStep === 3} />
                    {schoolIdPhotos.back && <img src={schoolIdPhotos.back} style={{marginTop: '10px', width: '100%', maxWidth: '150px', borderRadius: '8px'}} alt="Back Preview" />}
                  </div>
                </div>
              </div>

              {/* Documentary Requirements: COE and Grades */}
              <div style={{marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.2rem'}}>
                <div style={{background: '#f0f7ff', padding: '1.5rem', borderRadius: '20px', border: '1px solid #e1e8f0'}}>
                  <h4 style={{fontSize: '1rem', color: '#333', fontWeight: '700', marginBottom: '0.5rem', borderLeft: '4px solid var(--primary)', paddingLeft: '12px'}}>
                    Certificate of Enrollment (Current A.Y) <span style={{color: '#e74c3c'}}>*</span>
                  </h4>
                  <p style={{fontSize: '0.85rem', color: '#666', marginBottom: '1rem', paddingLeft: '16px'}}>Photo (.png/jpg)</p>
                  <div style={{paddingLeft: '16px'}}>
                    <input type="file" name="mayorCOE_photo" accept="image/*" onChange={handleInputChange} required={currentStep === 3} />
                    {photos.mayorCOE_photo && <img src={photos.mayorCOE_photo} style={{marginTop: '10px', maxWidth: '200px', borderRadius: '8px'}} alt="COE Preview" />}
                  </div>
                </div>

                <div style={{background: '#f0f7ff', padding: '1.5rem', borderRadius: '20px', border: '1px solid #e1e8f0'}}>
                  <h4 style={{fontSize: '1rem', color: '#333', fontWeight: '700', marginBottom: '0.5rem', borderLeft: '4px solid var(--primary)', paddingLeft: '12px'}}>
                    Certified True Copy of Grades <span style={{color: '#e74c3c'}}>*</span>
                  </h4>
                  <p style={{fontSize: '0.85rem', color: '#666', marginBottom: '1rem', paddingLeft: '16px'}}>Photo (.png/jpg)</p>
                  <div style={{paddingLeft: '16px'}}>
                    <input type="file" name="mayorGrades_photo" accept="image/*" onChange={handleInputChange} required={currentStep === 3} />
                    {photos.mayorGrades_photo && <img src={photos.mayorGrades_photo} style={{marginTop: '10px', maxWidth: '200px', borderRadius: '8px'}} alt="Grades Preview" />}
                  </div>
                </div>
              </div>

              <div style={{marginTop: '2rem', display: 'flex', justifyContent: 'space-between'}}>
                <button type="button" className="back-to-form-btn" onClick={handlePrevStep}>
                  <i className="fas fa-arrow-left" style={{marginRight: '8px'}}></i> Back: Family Background
                </button>
                <button type="button" className="submit-btn" onClick={handleNextStep} disabled={isSavingStep} style={{width: 'auto', padding: '0.8rem 2.5rem', borderRadius: '40px'}}>
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
                        <img src={formData.applicantSignatureName} alt="Signature" style={{maxHeight: '100px'}} />
                        <button type="button" onClick={() => setShowSignaturePad(true)} style={{position: 'absolute', top: '5px', right: '5px', background: 'rgba(0,0,0,0.5)', color: 'white', border: 'none', borderRadius: '50%', width: '24px', height: '24px', cursor: 'pointer'}}><i className="fas fa-undo"></i></button>
                      </div>
                    )}
                  </div>

                  {/* Extra Image Column (Not connected to DB) */}
                  <div style={{background: '#f0f7ff', border: '1px solid #e1e8f0', borderRadius: '16px', padding: '1.5rem', textAlign: 'center'}}>
                    <label style={{display: 'block', fontSize: '0.8rem', fontWeight: '600', color: '#666', marginBottom: '0.5rem'}}>Additional Identification (Optional)</label>
                    <p style={{fontSize: '0.7rem', color: '#888', marginBottom: '1rem'}}>Internal Record Only (Not stored in DB)</p>
                    <input type="file" accept="image/*" onChange={(e) => {
                      const file = e.target.files[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onloadend = () => setExtraSignaturePhoto(reader.result);
                        reader.readAsDataURL(file);
                      }
                    }} style={{fontSize: '0.75rem', width: '100%'}} />
                    {extraSignaturePhoto && (
                      <div style={{marginTop: '10px', position: 'relative'}}>
                        <img src={extraSignaturePhoto} alt="Extra Identification" style={{maxHeight: '80px', borderRadius: '8px', border: '1px solid #fff'}} />
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
                
                <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem'}}>
                  <div style={{border: '2px solid #fff', borderRadius: '20px', height: '200px', width: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#e1e8f0', position: 'relative', overflow: 'hidden', boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.05)'}}>
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

                  {photos.face_photo && (
                    <div style={{width: '100%', maxWidth: '300px', textAlign: 'center'}}>
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
                            const result = await applicantAPI.verifyFaceAgainstId(photos.face_photo, idImg);
                            setFaceMatchResult(result);
                            if (result.verified) {
                              showPromptMessage('✅ Face successfully matched with ID!');
                            } else {
                              showPromptMessage(`❌ Face Match Issue: ${result.message || 'Face does not match the ID.'}`);
                            }
                          } catch (err) {
                            console.error('Match error:', err);
                            // Generic success for technical issues on matching too
                            showPromptMessage('ℹ️ Verification service issue. Proceeding with manual check.');
                            setFaceMatchResult({ verified: true, technical_unavailable: true });
                          } finally {
                            setIsFaceMatching(false);
                          }
                        }} className="submit-btn" disabled={isFaceMatching} style={{width: '100%', background: 'var(--primary)', borderRadius: '12px'}}>
                          {isFaceMatching ? <><i className="fas fa-spinner fa-spin"></i> Matching...</> : <><i className="fas fa-user-check"></i> Verify Match with ID</>}
                        </button>
                      ) : (
                        <div style={{padding: '10px', borderRadius: '12px', background: faceMatchResult.verified ? '#d4edda' : '#f8d7da', color: faceMatchResult.verified ? '#155724' : '#721c24', border: faceMatchResult.verified ? '1px solid #c3e6cb' : '1px solid #f5c6cb'}}>
                          <i className={`fas ${faceMatchResult.verified ? 'fa-check-circle' : 'fa-exclamation-circle'}`} style={{marginRight: '8px'}}></i>
                          {faceMatchResult.verified ? (faceMatchResult.technical_unavailable ? 'Service issue (Manual Check needed)' : 'Facial identity verified!') : faceMatchResult.message || 'Face identity mismatch.'}
                          {!faceMatchResult.verified && (
                            <button type="button" onClick={() => setFaceMatchResult(null)} style={{background: 'none', border: 'none', color: '#721c24', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.8rem', marginLeft: '10px'}}>Retry</button>
                          )}
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
                <button type="submit" className="submit-btn" disabled={isSubmitting || isSavingStep} style={{width: 'auto', padding: '0.8rem 3.5rem', borderRadius: '40px', background: 'var(--success)', border: 'none'}}>
                  {isSubmitting ? (
                    <><i className="fas fa-spinner fa-spin" style={{marginRight: '10px'}}></i>Submitting...</>
                  ) : (
                    <><i className="fas fa-paper-plane" style={{marginRight: '10px'}}></i>Submit Application</>
                  )}
                </button>
              </div>
            </div>
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
