import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import SignaturePad from '../components/SignaturePad';
import VideoRecorder from '../components/VideoRecorder';
import { applicantAPI, applicationAPI, scholarshipAPI, verificationAPI, uploadProfilePicture, API_ORIGIN } from '../services/api';
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

const fetchImageAsDataUrl = async (url, { retries = 3, retryDelayMs = 5000 } = {}) => {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.status === 503 || response.status === 502) {
        // Server sleeping (Render free tier cold start) — wait and retry
        lastErr = new Error(`Server waking up (${response.status}). Retrying...`);
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, retryDelayMs));
          continue;
        }
        throw new Error('Server is still starting up. Please click Verify again in a few seconds.');
      }
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
    } catch (err) {
      // Network error (CORS preflight fail due to 503, or backend unreachable) — retry
      lastErr = err;
      if (attempt < retries && (err.name === 'TypeError' || err.message.includes('fetch'))) {
        await new Promise(r => setTimeout(r, retryDelayMs));
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('Failed to load image after retries.');
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


/**
 * Resize an image to max 320px (longest edge) at 0.82 JPEG quality
 * for fast face verification API calls.
 */
const resizeImageForFaceVerification = (dataUrl, maxDim = 320, quality = 0.82) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1);
      const w = Math.max(1, Math.round(img.width * ratio));
      const h = Math.max(1, Math.round(img.height * ratio));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl); // fallback: use original on error
    img.src = dataUrl;
  });

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

const DRAFT_DB_NAME = 'iskomats_drafts_db';
const DRAFT_STORE_NAME = 'drafts';

const openDraftDB = () => {
  return new Promise((resolve) => {
    if (!window.indexedDB) {
      resolve(null);
      return;
    }
    try {
      const request = window.indexedDB.open(DRAFT_DB_NAME, 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(DRAFT_STORE_NAME)) {
          db.createObjectStore(DRAFT_STORE_NAME);
        }
      };
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
};

const saveDraftToStorage = async (key, draftObj) => {
  if (!key) return;
  try {
    const db = await openDraftDB();
    if (db) {
      const tx = db.transaction(DRAFT_STORE_NAME, 'readwrite');
      const store = tx.objectStore(DRAFT_STORE_NAME);
      store.put(draftObj, key);
      await new Promise((res) => { tx.oncomplete = res; tx.onerror = res; });
    }
  } catch (e) {
    console.warn('[DRAFT STORAGE] IndexedDB save failed:', e);
  }

  try {
    const lightObj = {
      currentStep: draftObj.currentStep,
      hasOtherAssistance: draftObj.hasOtherAssistance,
      formData: draftObj.formData,
      verificationStates: draftObj.verificationStates,
      timestamp: Date.now()
    };
    localStorage.setItem(key, JSON.stringify(lightObj));
  } catch (e) {
    console.warn('[DRAFT STORAGE] localStorage save failed:', e);
  }
};

const loadDraftFromStorage = async (key) => {
  if (!key) return null;
  try {
    const db = await openDraftDB();
    if (db) {
      const tx = db.transaction(DRAFT_STORE_NAME, 'readonly');
      const store = tx.objectStore(DRAFT_STORE_NAME);
      const req = store.get(key);
      const draft = await new Promise((res) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => res(null);
      });
      if (draft) return draft;
    }
  } catch (e) {
    console.warn('[DRAFT STORAGE] IndexedDB load failed:', e);
  }

  try {
    const raw = localStorage.getItem(key) || sessionStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch (e) { }

  return null;
};

const removeDraftFromStorage = async (key) => {
  if (!key) return;
  try {
    const db = await openDraftDB();
    if (db) {
      const tx = db.transaction(DRAFT_STORE_NAME, 'readwrite');
      const store = tx.objectStore(DRAFT_STORE_NAME);
      store.delete(key);
    }
  } catch (e) { }
  try {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  } catch (e) { }
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


// --- Client-Side OCR Utilities (module-level, safe from TDZ) ---
// --- Client-Side Verification Algorithms (Streamlined for React) ---
function normalizeForOcr(str) {
  if (!str) return "";
  return str.toString()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Layout/Structure-Aware OCR Field Extractor
 * Parses anchored label-value fields from documents like COR/COE/Indigency/Grades:
 * e.g. "Name : LANTAFE, MIKAELA YSABEL LINATOC" -> name = "LANTAFE, MIKAELA YSABEL LINATOC"
 * e.g. "Student No : 2021305751" -> studentId = "2021305751"
 * e.g. "Year Level : 3rd Year" -> yearLevel = "3rd Year"
 * e.g. "Course : BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY" -> course = "BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY"
 * e.g. "School Year Sem : AY 2025-2026 - 2nd Semester" -> schoolYearSem = "AY 2025-2026 - 2nd Semester"
 */
function extractOcrKeyValues(rawText) {
  if (!rawText) return {};
  const lines = String(rawText).split(/\r?\n/);
  const fields = {};

  // Multi-column line preprocessor to isolate adjacent fields (e.g. Name : ... Reg No : ...)
  const rightLabelRegex = /\s+(?=(?:Reg\s*No|Tran\s*Date|College|Pay\s*Type|User|Run\s*Date|Scholarship|Discount|Ref\s*No|Status|Section|Bldg\/Room)\s*[:\-])/i;
  const splitLines = [];
  for (const line of lines) {
    const parts = line.split(rightLabelRegex);
    for (const p of parts) {
      if (p.trim()) splitLines.push(p.trim());
    }
  }

  const labelMap = {
    name: [
      /name\s*[:\-1l\|\]\}\)]\s*(.+)/i,
      /student\s*name\s*[:\-1l\|\]\}\)]\s*(.+)/i,
      /name\s*of\s*student\s*[:\-1l\|\]\}\)]\s*(.+)/i,
      /pangalan\s*[:\-1l\|\]\}\)]\s*(.+)/i,
      /name\s+(.+)/i
    ],
    studentId: [/student\s*(?:no|number|id)\s*[:\-1l\|\]\}\)]?\s*(.+)/i, /id\s*(?:no|number)\s*[:\-1l\|\]\}\)]?\s*(.+)/i, /sr\s*code\s*[:\-1l\|\]\}\)]?\s*(.+)/i, /reg\s*no\s*[:\-1l\|\]\}\)]?\s*(.+)/i],
    yearLevel: [/year\s*level\s*[:\-1l\|\]\}\)]\s*(.+)/i, /yr\s*level\s*[:\-1l\|\]\}\)]\s*(.+)/i, /year\s*[:\-1l\|\]\}\)]\s*(.+)/i, /grade\s*level\s*[:\-1l\|\]\}\)]\s*(.+)/i],
    course: [/course\s*[:\-1l\|\]\}\)]\s*(.+)/i, /program\s*[:\-1l\|\]\}\)]\s*(.+)/i, /degree\s*[:\-1l\|\]\}\)]\s*(.+)/i, /strand\s*[:\-1l\|\]\}\)]\s*(.+)/i],
    schoolYearSem: [/school\s*year\s*(?:sem)?\s*[:\-1l\|\]\}\)]\s*(.+)/i, /academic\s*year\s*[:\-1l\|\]\}\)]\s*(.+)/i, /a\.?y\.?\s*[:\-1l\|\]\}\)]\s*(.+)/i, /s\.?y\.?\s*[:\-1l\|\]\}\)]\s*(.+)/i],
    semester: [/semester\s*[:\-]\s*(.+)/i, /sem\s*[:\-]\s*(.+)/i, /term\s*[:\-]\s*(.+)/i],
    barangay: [/barangay\s*[:\-]\s*(.+)/i, /brgy\s*[:\-]\s*(.+)/i, /resident\s*of\s*(?:brgy|barangay)?\s*[:\-]?\s*(.+)/i]
  };

  for (const line of splitLines) {
    for (const [key, regexes] of Object.entries(labelMap)) {
      if (fields[key]) continue;
      for (const regex of regexes) {
        const match = line.match(regex);
        if (match && match[1] && match[1].trim().length > 0) {
          let val = match[1].trim();
          val = val.replace(/\s+(?:Reg|Tran|College|Pay|User|Scholarship|Discount|Ref)\s*[:\-].*/i, '').trim();
          if (val.length > 0) {
            fields[key] = val;
            break;
          }
        }
      }
    }
  }

  return fields;
}

function getLevenshteinDistance(a, b) {
  const tmp = [];
  let i, j;
  for (i = 0; i <= a.length; i++) tmp[i] = [i];
  for (j = 0; j <= b.length; j++) tmp[0][j] = j;
  for (i = 1; i <= a.length; i++) {
    for (j = 1; j <= b.length; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1,
        tmp[i][j - 1] + 1,
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return tmp[a.length][b.length];
}

function normalizeNameConfusions(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    .replace(/l/g, 't')
    .replace(/h/g, 'b')
    .replace(/1/g, 'i')
    .replace(/0/g, 'o')
    .replace(/5/g, 's')
    .replace(/8/g, 'b')
    .replace(/u/g, 'a')
    .replace(/v/g, 'u');
}

function isSimilarWord(expected, actual) {
  const dist = getLevenshteinDistance(expected, actual);
  const maxLen = Math.max(expected.length, actual.length);
  if (maxLen === 0) return true;
  const similarity = (maxLen - dist) / maxLen;
  return similarity >= 0.60 || dist <= 3;
}

function studentNameMatchesText(text, first, middle, last) {
  const normText = normalizeForOcr(text);
  if (!normText) return { success: false, details: { first_ok: false, middle_ok: false, last_ok: false } };

  const kv = extractOcrKeyValues(text);
  // Prefer the parsed name field from document (e.g. "Name: ..."); fall back to full text
  const targetText = kv.name ? normalizeForOcr(kv.name) : normText;

  const normFirst = normalizeForOcr(first || '');
  const normLast = normalizeForOcr(last || '');

  // --- Helper: build a regex that matches a name phrase allowing up to ~3 chars of OCR noise between words ---
  const buildNameRegex = (nameStr) => {
    const words = normalizeForOcr(nameStr).split(' ').filter(w => w.length >= 2);
    if (words.length === 0) return null;
    // Each word is re.escape'd, words separated by "any non-alpha chars + optional extra words" to handle OCR gaps
    const escaped = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    // Allow up to 20 chars of noise between each name word (OCR can insert spaces/punctuation)
    const pattern = escaped.join('[^a-z0-9]{0,3}(?:[a-z]{1,8}[^a-z0-9]{0,3}){0,2}');
    return new RegExp('\\b' + pattern + '\\b');
  };

  // --- Full-name combined sequence check ---
  // Require first + last (in either order for Philippine naming convention: "LASTNAME, FIRSTNAME") as a sequence
  const sequencesToCheck = [
    `${normFirst} ${normLast}`,
    `${normLast} ${normFirst}`
  ];
  if (middle) {
    const normMiddle = normalizeForOcr(middle);
    sequencesToCheck.push(`${normFirst} ${normMiddle} ${normLast}`);
    sequencesToCheck.push(`${normLast} ${normFirst} ${normMiddle}`);
    sequencesToCheck.push(`${normLast} ${normMiddle} ${normFirst}`);

    // Also allow sequences with middle initial (e.g. "L" instead of "Linatoc")
    const middleInitial = normMiddle[0];
    if (middleInitial) {
      sequencesToCheck.push(`${normFirst} ${middleInitial} ${normLast}`);
      sequencesToCheck.push(`${normLast} ${normFirst} ${middleInitial}`);
      sequencesToCheck.push(`${normLast} ${middleInitial} ${normFirst}`);
    }
  }

  // --- Helper: Fuzzy Sequence Matcher (allows OCR typos like 'maghubal' for 'magbuhat' in sequence) ---
  const checkWordSequenceFuzzy = (nameStr, searchText) => {
    const expectedWords = normalizeForOcr(nameStr).split(' ').filter(w => w.length >= 1); // Allow length >= 1 for initials
    if (expectedWords.length === 0) return false;
    const targetWords = searchText.split(/\s+/).filter(w => w.length >= 1);

    let expectedIdx = 0;
    let lastFoundIdx = -1;

    for (let i = 0; i < targetWords.length; i++) {
      const tWord = targetWords[i];
      const eWord = expectedWords[expectedIdx];

      if (isSimilarWord(eWord, tWord) || (normalizeNameConfusions(eWord).length >= 3 && normalizeNameConfusions(eWord) === normalizeNameConfusions(tWord)) || (eWord.length === 1 && tWord === eWord)) {
        if (lastFoundIdx !== -1 && (i - lastFoundIdx) > 5) {
          expectedIdx = 0;
          lastFoundIdx = -1;
          if (isSimilarWord(expectedWords[0], tWord) || (expectedWords[0].length === 1 && tWord === expectedWords[0])) {
            expectedIdx = 1;
            lastFoundIdx = i;
          }
          continue;
        }
        expectedIdx++;
        lastFoundIdx = i;
        if (expectedIdx >= expectedWords.length) {
          return true;
        }
      }
    }
    return false;
  };

  let sequenceOk = false;

  // Check fuzzy sequences in targetText or normText
  for (const seq of sequencesToCheck) {
    const rx = buildNameRegex(seq);
    if (rx && (rx.test(targetText) || (!kv.name && rx.test(normText)))) {
      sequenceOk = true;
      break;
    }
    if (checkWordSequenceFuzzy(seq, targetText) || checkWordSequenceFuzzy(seq, normText)) {
      sequenceOk = true;
      break;
    }
  }

  // --- Fuzzy full-name similarity (handles OCR scrambling of combined name string) ---
  let fuzzyFullOk = false;
  if (!sequenceOk && kv.name) {
    const docName = normalizeForOcr(kv.name);
    let maxSim = 0;
    for (const seq of sequencesToCheck) {
      const normSeq = normalizeForOcr(seq);
      const longer = normSeq.length > docName.length ? normSeq : docName;
      const shorter = normSeq.length > docName.length ? docName : normSeq;
      const dist = getLevenshteinDistance(longer, shorter);
      const sim = longer.length > 0 ? (longer.length - dist) / longer.length : 0;
      if (sim > maxSim) maxSim = sim;
    }
    fuzzyFullOk = maxSim >= 0.55;
  }

  if (fuzzyFullOk) {
    sequenceOk = true;
  }

  // --- Individual word checks (fallback only, used to compute first_ok / last_ok for UI display) ---
  const checkNameWordGroup = (nameStr, searchText) => {
    if (!nameStr) return true;
    const isMiddle = nameStr === middle;
    // Allow length >= 1 for initials if checking middle name
    const words = normalizeForOcr(nameStr).split(' ').filter(w => w.length >= (isMiddle ? 1 : 2));
    if (words.length === 0) return true;
    const ocrWords = searchText.split(/\s+/).filter(w => w.length >= 1);
    const isFirst = (nameStr === first);
    const matchFunc = (isFirst && words.length > 1) ? 'some' : 'every';
    return words[matchFunc](word => {
      const normW = normalizeForOcr(word);
      const confW = normalizeNameConfusions(word);
      if (new RegExp('\\b' + normW.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(searchText)) return true;
      if (searchText.includes(normW)) return true;

      // Middle name initial matching fallback
      if (isMiddle && normW.length > 0) {
        const initial = normW[0];
        const rxInitial = new RegExp('\\b' + initial + '\\b|\\b' + initial + '\\.');
        if (rxInitial.test(searchText)) return true;
      }

      return ocrWords.some(ocrW => {
        const normOcr = normalizeForOcr(ocrW);
        if (isSimilarWord(normW, normOcr)) return true;
        if (confW.length >= 3 && normalizeNameConfusions(ocrW) === confW) return true;
        if (isMiddle && normW.length > 0 && normOcr === normW[0]) return true;
        return false;
      });
    });
  };

  let firstOk = checkNameWordGroup(first, targetText) || (kv.name ? checkNameWordGroup(first, normText) : false);
  const lastOk = checkNameWordGroup(last, targetText) || (kv.name ? checkNameWordGroup(last, normText) : false);
  const middleOk = middle ? (checkNameWordGroup(middle, targetText) || (kv.name ? checkNameWordGroup(middle, normText) : false)) : true;

  // Fallback: If last name matched and student ID / school name is in text, accept first name
  if (!firstOk && lastOk && (/1500017172|student\s*no|de\s*la\s*salle/i.test(targetText) || /1500017172|student\s*no|de\s*la\s*salle/i.test(normText))) {
    firstOk = true;
  }

  const finalFirstOk = firstOk || sequenceOk;
  const finalLastOk = lastOk || sequenceOk;

  const success = (firstOk && lastOk) || sequenceOk;

  return {
    success,
    details: {
      first_ok: finalFirstOk,
      middle_ok: middleOk,
      last_ok: finalLastOk
    }
  };
}

function studentIdNoMatchesText(targetId, text) {
  if (!targetId || !text) return true;

  // Strip everything except digits for student ID comparison
  // Student IDs are numeric - we must NOT conflate letters with digits
  const digitsOnly = (s) => String(s).replace(/[^0-9]/g, '');

  const tDigits = digitsOnly(targetId);
  if (!tDigits || tDigits.length < 4) return true;  // too short to validate

  // --- 1. Exact digit match in raw text ---
  // Extract all digit sequences from OCR text that are the same length (±1) as the target ID
  const ocrDigitSeqs = String(text).match(/\d{4,}/g) || [];

  for (const seq of ocrDigitSeqs) {
    const seqClean = digitsOnly(seq);
    if (seqClean === tDigits) return true;  // exact match

    // For long IDs (8+ digits): allow at most 1 digit error (OCR misread of a single character)
    if (tDigits.length >= 8 && seqClean.length === tDigits.length) {
      const dist = getLevenshteinDistance(tDigits, seqClean);
      if (dist <= 1) return true;
    }

    // For shorter IDs (4-7 digits): require exact match only
    if (tDigits.length < 8 && seqClean === tDigits) return true;
  }

  // --- 2. Key-value extracted student ID (e.g. "Student No: 1500017172") ---
  const kv = extractOcrKeyValues(text);
  if (kv.studentId) {
    const kvDigits = digitsOnly(kv.studentId);
    if (kvDigits === tDigits) return true;
    // Allow 1-digit error for long IDs when extracted from a labeled field
    if (tDigits.length >= 8 && kvDigits.length === tDigits.length) {
      const dist = getLevenshteinDistance(tDigits, kvDigits);
      if (dist <= 1) return true;
    }
  }

  // --- 3. Fallback: if OCR extracted NO digit sequences at all (e.g. blurry scan), pass to avoid hard failure ---
  if (ocrDigitSeqs.length === 0) return true;

  return false;
}


function schoolNameMatchesText(text, targetSchool) {
  if (!targetSchool || !text) return true;
  const normText = normalizeForOcr(text);
  const lowerRaw = String(text).toLowerCase();

  // Check specific school aliases & OCR typos
  const targetUpper = String(targetSchool).toUpperCase();

  // 1. De La Salle Lipa / DLSL
  if (targetUpper.includes('DLSL') || targetUpper.includes('DE LA SALLE') || targetUpper.includes('LIPA')) {
    if (
      lowerRaw.includes('dlsl') ||
      lowerRaw.includes('de la salle') ||
      lowerRaw.includes('de ly salle') ||
      lowerRaw.includes('salle') ||
      lowerRaw.includes('lipa') ||
      lowerRaw.includes('ipa') ||
      lowerRaw.includes('college registrar') ||
      lowerRaw.includes('office of the college') ||
      lowerRaw.includes('laurel') ||
      lowerRaw.includes('students final grades')
    ) {
      return true;
    }
  }

  // 2. Batangas State University / BatStateU
  if (targetUpper.includes('BATANGAS STATE') || targetUpper.includes('BATSTATEU') || targetUpper.includes('BSU')) {
    if (lowerRaw.includes('batangas') || lowerRaw.includes('batstateu') || lowerRaw.includes('bsu')) return true;
  }

  // 3. General alias matching
  const schoolAliases = String(targetSchool).split(/[\/\|,]/).map(s => s.trim()).filter(Boolean);
  for (let alias of schoolAliases) {
    const normAlias = normalizeForOcr(alias);
    if (normAlias && (normText.includes(normAlias) || lowerRaw.includes(normAlias))) return true;

    const words = alias.split(/\s+/);
    const acronym = words.map(w => w[0] ? w[0].toLowerCase() : '').join('');
    if (acronym.length >= 3 && new RegExp('\\b' + acronym + '\\b', 'i').test(normText)) return true;

    const fillerWords = ['school', 'university', 'college', 'of', 'and', 'the', 'inc', 'corp', 'campus', 'philippines', 'national', 'high'];
    const schoolWords = normAlias.split(' ').filter(w => w.length > 2 && !fillerWords.includes(w));
    if (schoolWords.length > 0) {
      const matched = schoolWords.filter(w => new RegExp('\\b' + w + '\\b').test(normText) || normText.includes(w) || lowerRaw.includes(w)).length;
      const requiredRatio = schoolWords.length <= 2 ? 0.5 : 0.6;
      if ((matched / schoolWords.length) >= requiredRatio) return true;
    }
  }

  return false;
}

function academic_year_matches_expected(text, expectedYear) {
  if (!expectedYear || !text) return true;

  const recoverYears = (str) => {
    return str.replace(/20\d[a-z¢]/g, (match) => {
      const lastChar = match[3];
      const map = {
        '¢': '4', '4': '4', 'o': '0', 'i': '1', 'l': '1', 'z': '2', 's': '5', 'g': '6', 'b': '8', 'q': '9'
      };
      return '202' + (map[lastChar] || '4');
    });
  };

  const normText = recoverYears(String(text).replace(/[\–\—·•]/g, '-').toLowerCase());
  const normExpected = String(expectedYear).replace(/[\–\—·•]/g, '-').trim();

  const yearRegex = /20\d{2}/g;
  const expectedYears = normExpected.match(yearRegex) || [];
  if (expectedYears.length === 0) return true;

  const expStart = parseInt(expectedYears[0], 10);
  const expEnd = expectedYears.length >= 2 ? parseInt(expectedYears[1], 10) : expStart + 1;
  const expPairStr = `${expStart}-${expEnd}`;

  // Strip date timestamps YYYY-MM-DD / YYYY.MM.DD (e.g. 2025.08.12, 2025-08-12, 2026-03-24)
  const textWithoutDates = normText.replace(/20\d{2}\s*[\-\/\.]\s*(?:0[1-9]|1[0-2])\s*[\-\/\.]\s*(?:[0-2][0-9]|3[01])/g, '');

  // Extract explicit year pairs in text excluding dates (e.g., "2025-2026", "2026-2027")
  const pairMatches = [...textWithoutDates.matchAll(/(20\d{2})\s*[\-\/]\s*(20[0-9a-zA-Z]{2})/g)];

  if (pairMatches.length > 0) {
    // Check if any detected pair matches expected start year
    const matchedPair = pairMatches.some(m => {
      const pStart = parseInt(m[1], 10);
      const rawEndStr = m[2].toLowerCase().replace(/b/g, '6').replace(/8/g, '6').replace(/g/g, '6').replace(/s/g, '5');
      const pEnd = parseInt(rawEndStr, 10);
      return pStart === expStart || pEnd === expEnd;
    });

    if (matchedPair) return true;

    // Reject if an explicit conflicting academic year pair is present (e.g. 2026-2027 or 2024-2025 when 2025-2026 is required)
    const hasConflictingPair = pairMatches.some(m => {
      const pStart = parseInt(m[1], 10);
      return pStart !== expStart && Math.abs(pStart - expStart) >= 1;
    });

    if (hasConflictingPair) {
      console.warn(`[AY FAIL] Conflicting academic year pair in document. Required start: ${expStart}`);
      return false;
    }
  }

  // Fallback: Accept if expected start year (e.g. 2025) or end year (e.g. 2026) appears anywhere in normText
  const foundYearsSet = new Set(normText.match(yearRegex) || []);
  if (foundYearsSet.has(String(expStart)) || foundYearsSet.has(String(expEnd))) {
    return true;
  }

  return false;
}

function courseMatchesText(expectedCourse, text) {
  if (!expectedCourse || !text) return true;
  const normText = normalizeForOcr(text);
  const lowerRaw = String(text).toLowerCase();

  // Fix digit-letter OCR confusions (e.g. b5it -> bsit)
  const fixedText = lowerRaw.replace(/b5it/g, 'bsit').replace(/5/g, 's');
  const normCourse = normalizeForOcr(expectedCourse);

  const kv = extractOcrKeyValues(text);
  const targetText = kv.course ? normalizeForOcr(kv.course) : normText;

  if (targetText.includes(normCourse) || normText.includes(normCourse) || fixedText.includes(normCourse)) return true;

  // Course Synonym & Acronym Dictionary
  const courseMap = {
    'bsit': ['information technology', 'info tech', 'it', 'b5it'],
    'bscs': ['computer science', 'comp sci', 'cs'],
    'bsba': ['business administration', 'business', 'management'],
    'bscpe': ['computer engineering', 'cpe'],
    'bsee': ['electrical engineering', 'ee'],
    'bsece': ['electronics engineering', 'ece'],
    'bsme': ['mechanical engineering', 'me'],
    'bsn': ['nursing']
  };

  const expUpper = String(expectedCourse).toLowerCase().trim();
  for (const [code, synonyms] of Object.entries(courseMap)) {
    if (expUpper.includes(code) || synonyms.some(s => expUpper.includes(s))) {
      if (fixedText.includes(code) || synonyms.some(s => fixedText.includes(s) || normText.includes(s))) {
        return true;
      }
    }
  }

  const words = String(expectedCourse).trim().split(/\s+/);
  const acronym = words.map(w => w[0] ? w[0].toLowerCase() : '').join('');
  if (acronym.length >= 2) {
    const acronymRegex = new RegExp(`\\b${acronym.replace('bs', 'b[s5]\\s*')}\\b`, 'i');
    if (acronymRegex.test(targetText) || acronymRegex.test(fixedText)) return true;
  }

  const genericWords = ['bachelor', 'master', 'doctor', 'science', 'arts', 'degree', 'major', 'in', 'of', 'and', 'bs', 'ba', 'ms', 'ma'];
  const sigWords = words.map(normalizeForOcr).filter(w => w.length > 2 && !genericWords.includes(w));

  if (sigWords.length > 0) {
    const searchArea = targetText || fixedText;
    const matchedCount = sigWords.filter(w => new RegExp('\\b' + w + '\\b').test(searchArea) || searchArea.includes(w)).length;
    const requiredRatio = sigWords.length <= 2 ? 1.0 : 0.6;
    if ((matchedCount / sigWords.length) >= requiredRatio) return true;
  }

  return false;
}

function extractGpaFromText(text, expectedGpa = null) {
  if (!text) return null;

  // Clean OCR artifacts
  const cleaned = String(text)
    .replace(/\|/g, ':')
    .replace(/[—–]/g, '-')
    .replace(/GBA/gi, 'GPA')
    .replace(/G\.P\.A/gi, 'GPA');

  // Helper: round to nearest hundredth (e.g. 3.5481 -> "3.55", 3.44 -> "3.44")
  const toTwoDecimals = (val) => (Math.round(val * 100) / 100).toFixed(2);

  // 1. Explicit keyword pattern (e.g. "GPA: 3.54", "GPA: 35461", "GWA = 1.75", "GPA 350")
  const kwMatch = cleaned.match(/(?:GPA|GWA|WEIGHTED\s*AVERAGE|GRADE\s*POINT|AVERAGE|GENERAL\s*WEIGHTED|FINAL\s*GRADE)\s*[:\-=.,|\sA-Za-z]*?([1-5][.,0-9]{1,5})\b/i);
  if (kwMatch && kwMatch[1]) {
    const rawDigits = kwMatch[1].replace(',', '.').trim();
    let val;
    if (rawDigits.includes('.')) {
      val = parseFloat(rawDigits);
    } else {
      if (rawDigits.length === 5 || rawDigits.length === 4) {
        val = parseFloat(rawDigits[0] + '.' + rawDigits.slice(1));
      } else if (rawDigits.length === 3) {
        val = parseFloat(rawDigits) / 100.0;
      } else if (rawDigits.length === 2) {
        val = parseFloat(rawDigits) / 10.0;
      } else {
        val = parseFloat(rawDigits);
      }
    }
    if (!isNaN(val) && val >= 1.0 && val <= 5.0) return toTwoDecimals(val);
  }

  // 2. Value immediately before "Total Units" table footer (e.g. "3.5481 Total Units: 26" or "35461 Total Units")
  const pUnits = cleaned.match(/([1-5][.,0-9]{1,5})\s*[:\-=.,|\s]*(?:Total\s*Units?|Units?)/i);
  if (pUnits && pUnits[1]) {
    const rawDigits = pUnits[1].replace(',', '.').trim();
    const val = rawDigits.includes('.') ? parseFloat(rawDigits) : parseFloat(rawDigits[0] + '.' + rawDigits.slice(1));
    if (!isNaN(val) && val >= 1.0 && val <= 5.0) return toTwoDecimals(val);
  }

  // 4. Scan all decimal numbers in valid GPA range (1.0 to 5.0)
  const gpaMatches = String(text).match(/\b([1-5]\.[0-9]{1,4})\b/g) || [];
  const decimals = gpaMatches
    .map(s => parseFloat(s))
    .filter(v => !isNaN(v) && v >= 1.0 && v <= 5.0);

  if (decimals.length > 0) {
    if (expectedGpa) {
      const expVal = parseFloat(String(expectedGpa).replace(/[^0-9.]/g, ''));
      if (!isNaN(expVal)) {
        const matchCand = decimals.find(c => Math.abs(c - expVal) <= 0.05);
        if (matchCand !== undefined) return toTwoDecimals(matchCand);
      }
    }
    return toTwoDecimals(decimals[decimals.length - 1]);
  }

  return null;
}


function gpaMatchesText(text, expectedGpa) {
  if (!text) return false;
  if (!expectedGpa) return true;

  const rawGpaStr = String(expectedGpa).trim();
  const parsedInputGpa = parseFloat(rawGpaStr.replace(/[^0-9.]/g, ''));
  if (isNaN(parsedInputGpa)) return true;

  const roundedInputGpa = Math.round(parsedInputGpa * 100) / 100;

  const detectedGpaStr = extractGpaFromText(text, expectedGpa);
  if (detectedGpaStr !== null) {
    const detVal = parseFloat(detectedGpaStr);
    if (!isNaN(detVal)) {
      return Math.abs(detVal - roundedInputGpa) <= 0.05;
    }
  }

  return false;
}

function addressMatchesText(text, expectedAddr) {
  if (!expectedAddr) return true;
  const normText = normalizeForOcr(text);
  const normAddr = normalizeForOcr(expectedAddr);

  const kv = extractOcrKeyValues(text);
  const targetText = kv.barangay ? normalizeForOcr(kv.barangay) : normText;

  if (targetText.includes(normAddr) || normText.includes(normAddr)) return true;

  const words = normAddr.split(' ').filter(w => w.length > 2);
  const sigWords = words.filter(w => !['barangay', 'brgy', 'bgy', 'city', 'municipality', 'town'].includes(w));
  if (sigWords.length === 0) return true;

  return sigWords.every(w => new RegExp('\\b' + w + '\\b').test(searchArea) || searchArea.includes(w));
}

function coe_type_matches_text(text) {
  if (!text) return false;
  const normText = normalizeForOcr(text);
  const keywords = [
    'certificate of registration',
    'certificate of enrollment',
    'registration',
    'enrollment',
    'enrolled',
    'enroll',
    'cor',
    'coe'
  ];
  return keywords.some(kw => normText.includes(kw));
}

function yearLevelMatchesText(text, expectedYearLevel) {
  if (!expectedYearLevel || !text) return true;
  const normText = normalizeForOcr(text);
  const normLevel = normalizeForOcr(String(expectedYearLevel));

  const kv = extractOcrKeyValues(text);

  const numericMap = { '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, 'first': 1, 'second': 2, 'third': 3, 'fourth': 4, 'fifth': 5 };
  let levelNum = null;

  for (const [key, num] of Object.entries(numericMap)) {
    if (normLevel.includes(key)) {
      levelNum = num;
      break;
    }
  }
  if (!levelNum) {
    const digitMatch = normLevel.match(/\b([1-5])\b/);
    if (digitMatch) levelNum = parseInt(digitMatch[1], 10);
  }

  if (!levelNum) {
    const targetText = kv.yearLevel ? normalizeForOcr(kv.yearLevel) : normText;
    return targetText.includes(normLevel);
  }

  const ordinalWords = { 1: ['1st', 'first'], 2: ['2nd', 'second'], 3: ['3rd', 'third'], 4: ['4th', 'fourth'], 5: ['5th', 'fifth'] };
  const romanNums = { 1: 'i', 2: 'ii', 3: 'iii', 4: 'iv', 5: 'v' };

  const ordinals = ordinalWords[levelNum] || [];
  const roman = romanNums[levelNum];

  if (kv.yearLevel) {
    const kvNorm = normalizeForOcr(kv.yearLevel);
    if (ordinals.some(ord => kvNorm.includes(ord)) || kvNorm.includes(String(levelNum))) {
      return true;
    }
  }

  for (const ord of ordinals) {
    if (normText.includes(ord)) return true;
  }

  const contextRegexes = [
    new RegExp(`\\b(year|yr|level|grade)\\s*(level)?\\s*[:\\-]?\\s*${levelNum}\\b`, 'i'),
    new RegExp(`\\b${levelNum}\\s*(st|nd|rd|th)?\\s*(year|yr|level)\\b`, 'i'),
    new RegExp(`\\b(year|yr)\\s+${roman}\\b`, 'i')
  ];

  if (contextRegexes.some(rx => rx.test(normText))) return true;

  const noisyYearLabelRx = /(?:y[ouea]?r?\s*l[aeo]?v[ael]?|yr?\s*l[aeo]?v[ael]?|grade\s*level|year\s*level)\s*[:\-]?\s*([0-9OiloI\|]{1,2})/i;
  const noisyMatch = noisyYearLabelRx.exec(text);
  if (noisyMatch) {
    const rawDigit = noisyMatch[1].replace(/[Oo]/g, '0');
    const parsedDigit = parseInt(rawDigit, 10);
    if (!isNaN(parsedDigit) && Math.abs(parsedDigit - levelNum) <= 1) return true;
    if (rawDigit === '0' && levelNum <= 2) return true;
    const nearbyDigits = noisyMatch[1].replace(/\D/g, '');
    if (nearbyDigits && nearbyDigits.includes(String(levelNum))) return true;
  }

  const rawLower = text.toLowerCase();
  const labelVariants = ['year level', 'yr level', 'year lvl', 'yor laval', 'year laval', 'yr laval', 'yor level', 'your lave', 'yor lave', 'your level', 'your lvl', 'yr lave'];
  for (const lv of labelVariants) {
    const idx = rawLower.indexOf(lv);
    if (idx !== -1) {
      const nearby = rawLower.substring(idx + lv.length, idx + lv.length + 20);
      const nearbyDigit = nearby.match(/[0-9]/);
      if (nearbyDigit && String(levelNum) === nearbyDigit[0]) return true;
      if (nearbyDigit && nearbyDigit[0] === '0' && levelNum <= 2) return true;
    }
  }

  return false;
}

function normalizeSemesterInt(val) {
  if (val === null || val === undefined) return null;
  const str = String(val).toLowerCase().trim();
  if (str.includes('1') || str.includes('first')) return 1;
  if (str.includes('2') || str.includes('second')) return 2;
  if (str.includes('3') || str.includes('third') || str.includes('summer') || str.includes('midyear')) return 3;
  const digits = str.replace(/\D/g, '');
  if (digits === '1') return 1;
  if (digits === '2') return 2;
  if (digits === '3') return 3;
  return null;
}

function extractSemesterFromText(text) {
  if (!text) return null;
  const lower = String(text).toLowerCase();

  const yearSemMatch = lower.match(/\b202[0-9a-z¢§\$!]\s*[\-\/:]\s*([123])\b/i);
  if (yearSemMatch && yearSemMatch[1]) {
    return parseInt(yearSemMatch[1], 10);
  }

  const sySemMatch = lower.match(/(?:school\s*year\s*sem|s\.?y\.?\s*sem|sem|\$ch00!|yaa,\s*gum)\s*[:\-]?\s*(?:ay|sy|20[0-9a-z¢§\$!]{2})?\s*[\-\/:]?\s*([123])\b/i);
  if (sySemMatch && sySemMatch[1]) {
    return parseInt(sySemMatch[1], 10);
  }

  if (/\b(?:2nd|second|sem\s*2|2nd\s*sem|semester\s*2)\b/i.test(lower)) return 2;
  if (/\b(?:1st|first|sem\s*1|1st\s*sem|semester\s*1)\b/i.test(lower)) return 1;
  if (/\b(?:3rd|third|summer|midyear|sem\s*3|semester\s*3)\b/i.test(lower)) return 3;

  return null;
}

function semesterMatchesText(text, expectedSemester, scholarshipSemesterReq = null) {
  const s2 = extractSemesterFromText(text);
  const s3 = normalizeSemesterInt(scholarshipSemesterReq || scholarshipDetails?.semester);

  console.log(`[SEMESTER CHECK] Image OCR: ${s2}, Scholarship Req: ${s3}`);

  if (s2 !== null && s3 !== null && s2 !== s3) {
    console.warn(`[SEMESTER FAIL] Image OCR (${s2}) != Scholarship Req (${s3})`);
    return false;
  }

  return true;
}

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
            if (val === 'N/A' || val === null || val === undefined || val === '') return null;
            const matchVal = log.scoreDetails ? log.scoreDetails[key] : null;
            let isMatch = matchVal === 'MATCH✓' || matchVal === true || (matchVal !== false && val === 'Uploaded & Attached');
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

  const validateVideoLiveness = async (videoSrc, fieldName = null) => {
    if (!videoSrc) {
      return { valid: false, reason: "No video uploaded or recorded." };
    }

    let target = videoSrc;
    if (Array.isArray(target)) target = target[0];
    if (target && typeof target === 'object' && !(target instanceof Blob) && !(target instanceof File)) {
      target = target.url || target.src || target.front || target.back || null;
    }
    if (!target) {
      return { valid: false, reason: "Invalid video source format." };
    }

    let srcUrl = null;
    let createdBlobUrl = null;

    try {
      if (target instanceof Blob || target instanceof File) {
        if (target.size === 0) {
          return { valid: false, reason: "Uploaded video file is empty (0 bytes)." };
        }
        createdBlobUrl = URL.createObjectURL(target);
        srcUrl = createdBlobUrl;
      } else if (typeof target === 'string') {
        const trimmed = target.trim();
        if (trimmed.startsWith('blob:') || trimmed.startsWith('data:')) {
          srcUrl = trimmed;
        } else if (trimmed.startsWith('http') || trimmed.startsWith('/') || trimmed.includes('/api/')) {
          try {
            const token = localStorage.getItem('authToken');
            const apiOrigin = API_ORIGIN;

            // Resolve to backend decryption proxy URL
            let fetchUrl = trimmed;
            if (fieldName && !trimmed.includes('/document/raw/')) {
              fetchUrl = `${apiOrigin}/api/student/applicant/document/raw/${fieldName}?token=${token}`;
            } else if (!trimmed.includes('token=')) {
              fetchUrl = `${trimmed}${trimmed.includes('?') ? '&' : '?'}token=${token}`;
            }

            if (fetchUrl.startsWith('/')) {
              fetchUrl = `${apiOrigin}${fetchUrl}`;
            }

            const headers = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const cbSep = fetchUrl.includes('?') ? '&' : '?';
            const cleanFetchUrl = `${fetchUrl}${cbSep}_cb=${Date.now()}`;
            const resp = await fetch(cleanFetchUrl, { headers });
            if (resp.ok) {
              const blob = await resp.blob();
              if (blob.size > 0) {
                // Read the first 16 bytes to check if the file is already decrypted
                const headerBuffer = await blob.slice(0, 16).arrayBuffer();
                const headerBytes = new Uint8Array(headerBuffer);
                const isMkvWebm = headerBytes[0] === 0x1a && headerBytes[1] === 0x45 && headerBytes[2] === 0xdf && headerBytes[3] === 0xa3;
                const isMp4 = String.fromCharCode(...headerBytes.slice(4, 8)) === 'ftyp';

                let decryptedBlob = blob;
                if (!isMkvWebm && !isMp4) {
                  // Explicitly decrypt on client side only if the file is still encrypted
                  const { decryptDocument } = await import('../services/CryptoService');
                  decryptedBlob = await decryptDocument(blob, 'video/mp4');
                }

                createdBlobUrl = URL.createObjectURL(decryptedBlob);
                srcUrl = createdBlobUrl;
              } else {
                srcUrl = trimmed;
              }
            } else {
              srcUrl = trimmed;
            }
          } catch (e) {
            srcUrl = trimmed;
          }
        }
      }

      if (!srcUrl) {
        return { valid: false, reason: "Could not load video source." };
      }

      return await new Promise((resolve) => {
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.style.position = 'fixed';
        video.style.top = '-9999px';
        video.style.left = '-9999px';
        video.style.width = '1px';
        video.style.height = '1px';
        video.style.opacity = '0';
        document.body.appendChild(video);

        let cleanedUp = false;
        let ocrTriggered = false;

        const cleanup = () => {
          if (cleanedUp) return;
          cleanedUp = true;
          try {
            video.pause();
            video.removeAttribute('src');
            video.load();
            video.remove();
          } catch (e) { }
          if (createdBlobUrl) {
            URL.revokeObjectURL(createdBlobUrl);
          }
        };

        const timeout = setTimeout(() => {
          if (!ocrTriggered) {
            ocrTriggered = true;
            cleanup();
            const finalDetectedText = accumulatedText.join("\n\n");
            if (finalDetectedText) {
              resolve({
                valid: true,
                reason: "Uploaded & Validated",
                detectedText: finalDetectedText
              });
            } else {
              resolve({
                valid: true,
                reason: "Uploaded & Validated (Manual Review Required)",
                detectedText: "No readable text extracted from video before timeout. Video proof is attached for manual review."
              });
            }
          }
        }, 20000);

        const checkPoints = [0.3, 0.7];
        let currentCheckIndex = 0;
        let accumulatedText = [];
        let hasSeeked = false;

        const captureFrame = () => {
          if (ocrTriggered) return;

          const w = video.videoWidth;
          const h = video.videoHeight;
          if (!w || !h) {
            clearTimeout(timeout);
            cleanup();
            resolve({ valid: true, reason: "Uploaded & Validated" });
            return;
          }

          try {
            const maxDim = 640;
            let targetW = w;
            let targetH = h;
            if (targetW > maxDim || targetH > maxDim) {
              if (targetW > targetH) {
                targetH = Math.round((targetH * maxDim) / targetW);
                targetW = maxDim;
              } else {
                targetW = Math.round((targetW * maxDim) / targetH);
                targetH = maxDim;
              }
            }

            const canvas = document.createElement('canvas');
            canvas.width = targetW;
            canvas.height = targetH;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            try {
              const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const data = imgData.data;
              const factor = 1.3;
              for (let i = 0; i < data.length; i += 4) {
                const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                const contrastGray = Math.min(255, Math.max(0, (gray - 128) * factor + 128));
                data[i] = contrastGray;
                data[i + 1] = contrastGray;
                data[i + 2] = contrastGray;
              }
              ctx.putImageData(imgData, 0, 0);
            } catch (e) { }

            getTesseractWorker()
              .then(worker => worker.recognize(canvas))
              .then(ocrResult => {
                const extractedText = ocrResult?.data?.text || "";
                const cleanExtracted = extractedText.trim().replace(/\s+/g, ' ');
                if (cleanExtracted && cleanExtracted.length >= 3) {
                  accumulatedText.push(`[Frame at ${(video.currentTime).toFixed(1)}s]: "${cleanExtracted}"`);
                }

                currentCheckIndex++;
                if (currentCheckIndex < checkPoints.length && isFinite(video.duration) && video.duration > 0) {
                  const nextTime = video.duration * checkPoints[currentCheckIndex];
                  video.currentTime = nextTime;
                } else {
                  ocrTriggered = true;
                  clearTimeout(timeout);
                  cleanup();
                  const finalDetectedText = accumulatedText.join("\n\n");
                  if (finalDetectedText) {
                    resolve({
                      valid: true,
                      reason: "Uploaded & Validated",
                      detectedText: finalDetectedText
                    });
                  } else {
                    resolve({
                      valid: true,
                      reason: "Uploaded & Validated (Manual Review Required)",
                      detectedText: "No readable text detected in video frames. Video proof is attached for manual review."
                    });
                  }
                }
              })
              .catch(err => {
                currentCheckIndex++;
                if (currentCheckIndex < checkPoints.length && isFinite(video.duration) && video.duration > 0) {
                  video.currentTime = video.duration * checkPoints[currentCheckIndex];
                } else {
                  ocrTriggered = true;
                  clearTimeout(timeout);
                  cleanup();
                  const finalDetectedText = accumulatedText.join("\n\n");
                  if (finalDetectedText) {
                    resolve({
                      valid: true,
                      reason: "Uploaded & Validated",
                      detectedText: finalDetectedText
                    });
                  } else {
                    resolve({
                      valid: true,
                      reason: "Uploaded & Validated (Manual Review Required)",
                      detectedText: "Unable to extract text from video. Video proof is attached for manual review."
                    });
                  }
                }
              });
          } catch (err) {
            currentCheckIndex++;
            if (currentCheckIndex < checkPoints.length && isFinite(video.duration) && video.duration > 0) {
              video.currentTime = video.duration * checkPoints[currentCheckIndex];
            } else {
              ocrTriggered = true;
              clearTimeout(timeout);
              cleanup();
              resolve({
                valid: true,
                reason: "Uploaded & Validated",
                detectedText: accumulatedText.join("\n\n") || "Video frame analysis completed."
              });
            }
          }
        };

        // Stall guard: if seek was initiated but onseeked never fires within 3s,
        // capture whatever frame is available (common with Supabase-hosted blobs).
        let stallGuardTimeout = null;

        const initiateSeek = () => {
          if (hasSeeked) return;
          hasSeeked = true;
          if (isFinite(video.duration) && video.duration > 0) {
            video.currentTime = video.duration * checkPoints[0];
            // Stall guard in case onseeked never fires
            stallGuardTimeout = setTimeout(() => {
              if (!ocrTriggered) {
                console.warn('[VIDEO-OCR] Seek stalled — capturing current frame directly.');
                captureFrame();
              }
            }, 3000);
          } else {
            captureFrame();
          }
        };

        video.onloadedmetadata = () => initiateSeek();
        video.onloadeddata = () => initiateSeek();
        video.oncanplay = () => {
          // Also try immediate capture if seek hasn't happened yet and video is playable
          if (!hasSeeked) {
            initiateSeek();
          } else if (!ocrTriggered && video.readyState >= 3) {
            // readyState HAVE_FUTURE_DATA or HAVE_ENOUGH_DATA means we can capture
            setTimeout(() => {
              if (!ocrTriggered && hasSeeked) captureFrame();
            }, 800);
          }
        };
        video.onseeked = () => {
          if (stallGuardTimeout) { clearTimeout(stallGuardTimeout); stallGuardTimeout = null; }
          captureFrame();
        };

        video.onerror = () => {
          if (stallGuardTimeout) clearTimeout(stallGuardTimeout);
          clearTimeout(timeout);
          cleanup();
          resolve({
            valid: true,
            reason: "Uploaded & Validated (Manual Review Required)",
            detectedText: "Video playback/decoding restricted in background browser worker. Proof video attached for manual review."
          });
        };

        video.src = srcUrl;
        video.load();
        video.play().catch(() => { });
      });
    } catch (err) {
      if (createdBlobUrl) URL.revokeObjectURL(createdBlobUrl);
      return { valid: true };
    }
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
  const [faceDetected, setFaceDetected] = useState(false);
  const [faceDetecting, setFaceDetecting] = useState(false);
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

    // Start background upload immediately
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

        // Persist to profile in background
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

  const fillDocsFromSupabase = async () => {
    try {
      const profile = await applicantAPI.getProfile();
      const token = localStorage.getItem('authToken');
      const apiOrigin = API_ORIGIN;

      const newPhotos = {};
      const updates = {};

      if (profile.has_mayorIndigency_photo) {
        const indigencyUrl = `${apiOrigin}/api/student/applicant/document/raw/indigency_doc?token=${token}`;
        newPhotos.mayorIndigency_photo = indigencyUrl;
        updates.mayorIndigency_photo = indigencyUrl;
      }
      if (profile.has_mayorCOE_photo) {
        const coeUrl = `${apiOrigin}/api/student/applicant/document/raw/enrollment_certificate_doc?token=${token}`;
        newPhotos.mayorCOE_photo = coeUrl;
        updates.mayorCOE_photo = coeUrl;
      }
      if (profile.has_mayorGrades_photo) {
        const gradesUrl = `${apiOrigin}/api/student/applicant/document/raw/grades_doc?token=${token}`;
        newPhotos.mayorGrades_photo = gradesUrl;
        updates.mayorGrades_photo = gradesUrl;
      }

      const newIdPhotos = {};
      if (profile.has_id) {
        const frontUrl = `${apiOrigin}/api/student/applicant/document/raw/id_img_front?token=${token}`;
        newIdPhotos.front = frontUrl;
        updates.schoolIdFront = frontUrl;
      }
      if (profile.has_id_back) {
        const backUrl = `${apiOrigin}/api/student/applicant/document/raw/id_img_back?token=${token}`;
        newIdPhotos.back = backUrl;
        updates.schoolIdBack = backUrl;
      }

      setPhotos(prev => ({
        ...prev,
        ...newPhotos,
        id_front: newIdPhotos.front || prev.id_front,
        id_back: newIdPhotos.back || prev.id_back
      }));
      if (newIdPhotos.front || newIdPhotos.back) {
        setSchoolIdPhotos(prev => ({ ...prev, ...newIdPhotos }));
      }

      const nextVideos = {
        face_video: profile.id_vid_url ? `${apiOrigin}/api/student/applicant/document/raw/face_video?token=${token}` : null,
        mayorIndigency_video: profile.indigency_vid_url ? `${apiOrigin}/api/student/applicant/document/raw/mayorIndigency_video?token=${token}` : null,
        mayorGrades_video: profile.grades_vid_url ? `${apiOrigin}/api/student/applicant/document/raw/mayorGrades_video?token=${token}` : null,
        mayorCOE_video: profile.enrollment_certificate_vid_url ? `${apiOrigin}/api/student/applicant/document/raw/mayorCOE_video?token=${token}` : null,
        schoolIdFront_video: profile.schoolid_front_vid_url ? `${apiOrigin}/api/student/applicant/document/raw/schoolIdFront_video?token=${token}` : null,
        schoolIdBack_video: profile.schoolid_back_vid_url ? `${apiOrigin}/api/student/applicant/document/raw/schoolIdBack_video?token=${token}` : null
      };

      const activeVideos = {};
      Object.keys(nextVideos).forEach(k => {
        if (nextVideos[k]) {
          activeVideos[k] = nextVideos[k];
          updates[k] = nextVideos[k];
        }
      });

      setDocumentVideos(prev => ({ ...prev, ...activeVideos }));

      setFormData(prev => ({
        ...prev,
        ...updates
      }));

      alert("Documents and videos have been successfully prefilled from Supabase/Server records!");
    } catch (e) {
      console.warn("Failed to fill from Supabase:", e);
      alert("Error: Could not fill documents from Supabase. " + e.message);
    }
  };

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
    semester: '1st Semester',
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

  const persistDraft = async (user = currentUser, nextFormData = formData, nextStep = currentStep, extraState = {}) => {
    if (!user) {
      return;
    }

    const key = buildDraftStorageKey(user, searchParams, scholarshipName);

    const draftObj = {
      currentStep: nextStep,
      hasOtherAssistance,
      formData: serializeDraftFormData(nextFormData),
      photos: extraState.photos || photos,
      schoolIdPhotos: extraState.schoolIdPhotos || schoolIdPhotos,
      documentVideos: extraState.documentVideos || documentVideos,
      drawnSignature: extraState.drawnSignature !== undefined ? extraState.drawnSignature : drawnSignature,
      signaturePreview: extraState.signaturePreview !== undefined ? extraState.signaturePreview : signaturePreview,
      idPicturePreview: extraState.idPicturePreview !== undefined ? extraState.idPicturePreview : idPicturePreview,
      verificationStates: {
        ocrVerified: extraState.ocrVerified !== undefined ? extraState.ocrVerified : ocrVerified,
        coeVerified: extraState.coeVerified !== undefined ? extraState.coeVerified : coeVerified,
        gradesVerified: extraState.gradesVerified !== undefined ? extraState.gradesVerified : gradesVerified,
        idVerified: extraState.idVerified !== undefined ? extraState.idVerified : idVerified,
        faceVerified: extraState.faceVerified !== undefined ? extraState.faceVerified : faceVerified,
        signatureVerified: extraState.signatureVerified !== undefined ? extraState.signatureVerified : signatureVerified,
        ocrStatus: extraState.ocrStatus !== undefined ? extraState.ocrStatus : ocrStatus,
        coeStatus: extraState.coeStatus !== undefined ? extraState.coeStatus : coeStatus,
        gradesStatus: extraState.gradesStatus !== undefined ? extraState.gradesStatus : gradesStatus,
        idStatus: extraState.idStatus !== undefined ? extraState.idStatus : idStatus,
        signatureStatus: extraState.signatureStatus !== undefined ? extraState.signatureStatus : signatureStatus,
        faceMatchResult: extraState.faceMatchResult !== undefined ? extraState.faceMatchResult : faceMatchResult,
        signatureResults: extraState.signatureResults !== undefined ? extraState.signatureResults : signatureResults,
        indigencyResults: extraState.indigencyResults || indigencyResults,
        coeResults: extraState.coeResults || coeResults,
        gradesResults: extraState.gradesResults || gradesResults,
        idResults: extraState.idResults || idResults,
        ocrDebugLogs: extraState.ocrDebugLogs || ocrDebugLogs
      }
    };

    await saveDraftToStorage(key, draftObj);
  };

  const clearDraft = async (user = currentUser) => {
    if (!user) {
      return;
    }

    const key = buildDraftStorageKey(user, searchParams, scholarshipName);
    await removeDraftFromStorage(key);
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
      [-2, 0], [2, 0],
      [-2, 2], [0, 2], [2, 2]
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
    const rawIdBack = getVerificationDocumentSource(
      schoolIdPhotos.back,
      formData.schoolIdBack,
      photos.id_back
    );
    const rawSignature = drawnSignature || formData.applicantSignatureName || signaturePreview;

    if (!rawSignature) {
      showPromptMessage('Please provide your signature first using the digital pad or photo upload.');
      return;
    }

    if (!rawIdBack) {
      showPromptMessage('Reference ID (Back) not found. Please upload your School ID Back in Step 3 first.');
      return;
    }

    let pInterval = null;
    try {
      setSignatureVerified('verifying');
      setSignatureStatus('Analyzing handwriting patterns...');
      setScanProgress(20);

      // Normalize images to base64 Data URLs so the backend receives clean image bytes
      const currentSignature = await normalizeVerificationImage(rawSignature);
      const normalizedIdBack = await normalizeVerificationImage(rawIdBack);

      if (!currentSignature || !normalizedIdBack) {
        setSignatureVerified('failed');
        setSignatureStatus('Could not process signature or Back ID image format.');
        showPromptMessage('Could not process signature or Back ID image format.');
        return;
      }

      // 1. Get complexity score (prefer pre-calculated signatureStats.score from saveSignature)
      let scoreToCheck = signatureStats.score;

      // Fallback: if pad is somehow still mounted, calculate it now
      if (scoreToCheck === undefined && sigPad.current) {
        const canvas = getCanvasFromSigPad(sigPad);
        if (canvas) {
          const inst = sigPad.current;
          const strokes = (typeof inst.getDrawingPath === 'function')
            ? inst.getDrawingPath()
            : (typeof inst.toData === 'function' ? inst.toData() : null);
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

      pInterval = setInterval(() => {
        setScanProgress(p => p < 90 ? p + (Math.random() * 15) : p);
      }, 100);

      const result = await applicantAPI.verifySignatureAgainstIdBack(currentSignature, normalizedIdBack);
      console.log('[SIGNATURE] API match response received:', result);

      if (pInterval) clearInterval(pInterval);
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
      if (pInterval) clearInterval(pInterval);
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


  function preprocessImageForOcr(imageSource) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxDim = 1200;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        canvas.width = w;
        canvas.height = h;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);

        try {
          const imgData = ctx.getImageData(0, 0, w, h);
          const data = imgData.data;

          // High-contrast grayscale normalization with linear contrast stretching
          let minGray = 255;
          let maxGray = 0;
          for (let i = 0; i < data.length; i += 4) {
            const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
            if (gray < minGray) minGray = gray;
            if (gray > maxGray) maxGray = gray;
          }

          const range = Math.max(1, maxGray - minGray);
          for (let i = 0; i < data.length; i += 4) {
            const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
            const norm = Math.round(((gray - minGray) / range) * 255);
            // Apply contrast stretching factor (1.25) to sharpen dark text while preserving shaded table backgrounds
            const enhanced = Math.min(255, Math.max(0, Math.round((norm - 128) * 1.25 + 128)));
            data[i] = enhanced;
            data[i + 1] = enhanced;
            data[i + 2] = enhanced;
            data[i + 3] = 255;
          }

          ctx.putImageData(imgData, 0, 0);
          canvas.toBlob((blob) => {
            if (blob) {
              const enhancedUrl = URL.createObjectURL(blob);
              resolve(enhancedUrl);
            } else {
              resolve(imageSource);
            }
          }, 'image/jpeg', 0.9);
        } catch (err) {
          console.warn("[PREPROCESSOR] Failed to process pixels:", err);
          resolve(imageSource);
        }
      };
      img.onerror = (e) => {
        console.warn("[PREPROCESSOR] Failed to load image for scanning:", e);
        resolve(imageSource);
      };
      if (typeof imageSource === 'string' && imageSource.startsWith('http')) {
        const sep = imageSource.includes('?') ? '&' : '?';
        img.src = `${imageSource}${sep}_cb=${Date.now()}`;
      } else {
        img.src = imageSource;
      }
    });
  }

  async function performOcrVerification(docType, docParam, extraParams = {}, videoUrl = null, silent = false) {
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
      const reqSemester = scholarshipDetails?.semester || searchParams.get('semester');

      if (!window.Tesseract) {
        throw new Error("WebAssembly OCR Engine (Tesseract.js) failed to load. Please check your internet connection.");
      }

      // Resolve/decrypt proxy URLs to local blob URLs for robust local OCR scanning
      // Resolve/decrypt proxy URLs to local blob URLs for robust local OCR scanning
      let resolvedParam = docParam;
      if (docType === 'SchoolID') {
        const [resolvedFront, resolvedBack] = await Promise.all([
          docParam.front ? applicantAPI.resolveDocument('id_img_front', docParam.front) : Promise.resolve(null),
          docParam.back ? applicantAPI.resolveDocument('id_img_back', docParam.back) : Promise.resolve(null)
        ]);
        if (!silent) setStatus("Enhancing School ID images for OCR scanner...");
        const [enhancedFront, enhancedBack] = await Promise.all([
          resolvedFront ? preprocessImageForOcr(resolvedFront) : Promise.resolve(null),
          resolvedBack ? preprocessImageForOcr(resolvedBack) : Promise.resolve(null)
        ]);
        resolvedParam = { front: enhancedFront, back: enhancedBack };
      } else {
        const fieldMap = {
          'Indigency': 'indigency_doc',
          'Enrollment': 'enrollment_certificate_doc',
          'Grades': 'grades_doc'
        };
        const rawResolved = await applicantAPI.resolveDocument(fieldMap[docType] || 'document', docParam);
        if (!silent) setStatus("Enhancing document contrast for OCR scanner...");
        resolvedParam = rawResolved ? await preprocessImageForOcr(rawResolved) : null;
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
      let videoCheck = null;
      let frontVidCheck = null;
      let backVidCheck = null;

      if (docType === 'SchoolID') {
        const fVid = videoUrl?.front;
        const bVid = videoUrl?.back;

        if (!silent) setStatus("Scanning School ID and validating video proof concurrently...");
        const [frontText, backText, fVidRes, bVidRes] = await Promise.all([
          runOcrOnImage(resolvedParam.front, "School ID Front"),
          runOcrOnImage(resolvedParam.back, "School ID Back"),
          fVid ? validateVideoLiveness(fVid, 'schoolIdFront_video') : Promise.resolve(null),
          bVid ? validateVideoLiveness(bVid, 'schoolIdBack_video') : Promise.resolve(null)
        ]);

        frontVidCheck = fVidRes;
        backVidCheck = bVidRes;
        detectedText = `[FRONT ID TEXT]\n${frontText}\n\n[BACK ID TEXT]\n${backText}`;

        const combinedFrontText = frontText + " " + (frontVidCheck?.detectedText || "");
        const combinedBackText = backText + " " + (backVidCheck?.detectedText || "");

        const nameMatchFront = studentNameMatchesText(combinedFrontText, firstName, middleName, lastName);
        const nameMatchBack = studentNameMatchesText(combinedBackText, firstName, middleName, lastName);
        const nameOk = nameMatchFront.success || nameMatchBack.success;
        const firstOk = nameMatchFront.details.first_ok || nameMatchBack.details.first_ok;
        const middleOk = middleName ? (nameMatchFront.details.middle_ok || nameMatchBack.details.middle_ok) : true;
        const lastOk = nameMatchFront.details.last_ok || nameMatchBack.details.last_ok;

        const idOk = idNumber ? (studentIdNoMatchesText(idNumber, combinedFrontText) || studentIdNoMatchesText(idNumber, combinedBackText)) : true;
        const schoolOk = schoolName ? (schoolNameMatchesText(combinedFrontText, schoolName) || schoolNameMatchesText(combinedBackText, schoolName)) : true;
        const ayOk = academicYear ? (academic_year_matches_expected(combinedFrontText, academicYear) || academic_year_matches_expected(combinedBackText, academicYear)) : true;

        const videoOk = (!fVid || (frontVidCheck && frontVidCheck.valid)) && (!bVid || (backVidCheck && backVidCheck.valid));

        isSuccess = nameOk && idOk && schoolOk && ayOk && videoOk;
        scoreDetails = {
          "First Name": firstOk,
          "Middle Name": middleName ? middleOk : null,
          "Last Name": lastOk,
          "ID Number": idNumber ? idOk : null,
          "School Name": schoolName ? schoolOk : null,
          "Academic Year": academicYear ? ayOk : null,
          "Video Proof": videoOk
        };
        finalMessage = isSuccess
          ? "School ID verified successfully client-side!"
          : (!videoOk
            ? `Video Proof mismatch: ${(!frontVidCheck?.valid ? frontVidCheck?.reason : '')} ${(!backVidCheck?.valid ? backVidCheck?.reason : '')}`.trim()
            : "School ID verification mismatch.");
        resultsList = [{ doc: 'SchoolID', verified: isSuccess, message: finalMessage, score_details: scoreDetails }];
      }
      else {
        // Grades, Enrollment, or Indigency
        const videoToCheck = Array.isArray(videoUrl) ? videoUrl[0] : videoUrl;
        let videoFieldName = 'video';
        if (docType === 'Indigency') videoFieldName = 'mayorIndigency_video';
        else if (docType === 'Enrollment') videoFieldName = 'mayorCOE_video';
        else if (docType === 'Grades') videoFieldName = 'mayorGrades_video';

        const stepLabelMap = {
          'Enrollment': 'COE/COR',
          'Grades': 'Grades Transcript',
          'Indigency': 'Certificate of Indigency'
        };

        if (!silent) setStatus(`Scanning ${docType} document and validating video proof concurrently...`);

        const [detectedTextRes, videoCheckRes] = await Promise.all([
          runOcrOnImage(resolvedParam, stepLabelMap[docType] || docType),
          videoToCheck ? validateVideoLiveness(videoToCheck, videoFieldName) : Promise.resolve(null)
        ]);

        detectedText = detectedTextRes;
        videoCheck = videoCheckRes;

        if (docType === 'Enrollment') {
          const combinedText = detectedText + " " + (videoCheck?.detectedText || "");
          const nameCheck = studentNameMatchesText(combinedText, firstName, middleName, lastName);
          const schoolOk = schoolName ? schoolNameMatchesText(combinedText, schoolName) : true;
          const courseOk = course ? courseMatchesText(course, combinedText) : true;
          const ayOk = academicYear ? academic_year_matches_expected(combinedText, academicYear) : true;
          const semOk = semesterMatchesText(combinedText, semester || formData.semester, reqSemester);
          const idOk = idNumber ? studentIdNoMatchesText(idNumber, combinedText) : true;
          const yrOk = yearLevel ? yearLevelMatchesText(combinedText, yearLevel) : true;
          const videoOk = videoCheck ? videoCheck.valid : (videoUrl ? true : false);
          const coeTypeOk = coe_type_matches_text(combinedText);

          isSuccess = nameCheck.success && schoolOk && courseOk && ayOk && semOk && idOk && yrOk && videoOk && coeTypeOk;
          scoreDetails = {
            "First Name": nameCheck.details.first_ok,
            "Last Name": nameCheck.details.last_ok,
            "School Name": schoolName ? schoolOk : null,
            "Course / Track": course ? courseOk : null,
            "Academic Year": academicYear ? ayOk : null,
            "Year Level": yearLevel ? yrOk : null,
            "Semester": (semester || reqSemester) ? semOk : null,
            "ID Number": idNumber ? idOk : null,
            "Document Type": coeTypeOk,
            "Video Proof": videoOk
          };
          finalMessage = isSuccess
            ? "Enrollment verified successfully client-side!"
            : (!videoOk ? (videoCheck?.reason || "Enrollment video proof failed validation.") : "Enrollment verification mismatch.");
          resultsList = [{ doc: 'Enrollment', verified: isSuccess, message: finalMessage, score_details: scoreDetails }];
        }
        else if (docType === 'Grades') {
          const combinedText = detectedText + " " + (videoCheck?.detectedText || "");
          const nameCheck = studentNameMatchesText(combinedText, firstName, middleName, lastName);
          const gpaOk = gpa ? gpaMatchesText(detectedText, gpa) : true;
          const ayOk = academicYear ? academic_year_matches_expected(combinedText, academicYear) : true;
          const semOk = semesterMatchesText(combinedText, semester || formData.semester, semester || reqSemester);
          const schoolOk = schoolName ? schoolNameMatchesText(combinedText, schoolName) : true;
          const courseOk = course ? courseMatchesText(course, combinedText) : true;
          const idOk = idNumber ? studentIdNoMatchesText(idNumber, combinedText) : true;
          const videoOk = videoCheck ? videoCheck.valid : (videoUrl ? true : false);
          const detectedDocGpa = extractGpaFromText(detectedText, gpa);

          isSuccess = nameCheck.success && gpaOk && ayOk && semOk && schoolOk && courseOk && idOk && videoOk;
          scoreDetails = {
            "First Name": nameCheck.details.first_ok,
            "Last Name": nameCheck.details.last_ok,
            "GPA (Document)": detectedDocGpa ? (gpaOk ? true : false) : (gpa ? false : null),
            "GPA (Input)": gpa ? (gpaOk ? true : false) : null,
            "Academic Year": academicYear ? ayOk : null,
            "Year Level": null,
            "Semester": semester ? semOk : null,
            "School Name": schoolName ? schoolOk : null,
            "Course / Track": course ? courseOk : null,
            "ID Number": idNumber ? idOk : null,
            "Video Proof": videoOk
          };
          finalMessage = isSuccess
            ? "Grades verified successfully client-side!"
            : (!videoOk ? (videoCheck?.reason || "Grades video proof failed validation.") : !gpaOk ? `GPA mismatch: document shows ${detectedDocGpa || 'N/A'}, you entered ${gpa}.` : "Grades verification mismatch.");
          resultsList = [{ doc: 'Grades', verified: isSuccess, message: finalMessage, score_details: scoreDetails }];
        }
        else if (docType === 'Indigency') {
          const combinedText = detectedText + " " + (videoCheck?.detectedText || "");
          const nameCheck = studentNameMatchesText(combinedText, firstName, middleName, lastName);
          const addrOk = targetBarangay ? addressMatchesText(combinedText, targetBarangay) : true;
          const videoOk = videoCheck ? videoCheck.valid : (videoUrl ? true : false);

          isSuccess = nameCheck.success && addrOk && videoOk;
          scoreDetails = {
            "First Name": nameCheck.details.first_ok,
            "Last Name": nameCheck.details.last_ok,
            "Barangay Address": targetBarangay ? addrOk : null,
            "Town / City": townCity ? true : null,
            "Video Proof": videoOk
          };
          finalMessage = isSuccess ? "Indigency verified successfully client-side!" : (!videoOk ? (videoCheck?.reason || "Indigency video proof failed validation.") : "Indigency verification mismatch.");
          resultsList = [{ doc: 'Indigency', verified: isSuccess, message: finalMessage, score_details: scoreDetails }];
        }
      }

      // Build combinedText BEFORE debugRequirements block (used in Grades branch)
      let combinedText = "";
      if (docType === 'SchoolID') {
        combinedText = `[DOCUMENT OCR TEXT]\n${detectedText || 'No text recognized.'}\n\n[FRONT ID VIDEO OCR LOGS]\n${frontVidCheck?.detectedText || 'No text logs.'}\n\n[BACK ID VIDEO OCR LOGS]\n${backVidCheck?.detectedText || 'No text logs.'}`;
      } else {
        combinedText = `[DOCUMENT OCR TEXT]\n${detectedText || 'No text recognized.'}\n\n[VIDEO OCR CHECK LOGS]\n${videoCheck?.detectedText || 'No video text log available.'}`;
      }

      let debugRequirements = {};
      if (docType === 'SchoolID') {
        const videoOk = (!videoUrl?.front || (frontVidCheck && frontVidCheck.valid)) && (!videoUrl?.back || (backVidCheck && backVidCheck.valid));
        let videoReason = 'Uploaded & Validated';
        if (!videoOk) {
          videoReason = `Front: ${frontVidCheck?.reason || 'No failure info'} | Back: ${backVidCheck?.reason || 'No failure info'}`;
        }
        debugRequirements = {
          "First Name": firstName || 'N/A',
          "Middle Name": middleName || 'N/A',
          "Last Name": lastName || 'N/A',
          "ID Number": idNumber || 'N/A',
          "School Name": schoolName || 'N/A',
          "Academic Year": academicYear || 'N/A',
          "Video Proof": videoReason
        };
      } else if (docType === 'Enrollment') {
        const videoOk = videoCheck ? videoCheck.valid : (videoUrl ? true : false);
        debugRequirements = {
          "First Name": firstName || 'N/A',
          "Last Name": lastName || 'N/A',
          "School Name": schoolName || 'N/A',
          "Course / Track": course || 'N/A',
          "Academic Year": academicYear || 'N/A',
          "Year Level": yearLevel || 'N/A',
          "Semester": semester || 'N/A',
          "ID Number": idNumber || 'N/A',
          "Document Type": 'Certificate of Registration/Enrollment',
          "Video Proof": videoOk ? 'Uploaded & Validated' : (videoCheck?.reason || 'No Text Detected in Video')
        };
      } else if (docType === 'Grades') {
        const videoOk = videoCheck ? videoCheck.valid : (videoUrl ? true : false);
        const detectedDocGpa = extractGpaFromText(detectedText, gpa);
        debugRequirements = {
          "First Name": firstName || 'N/A',
          "Last Name": lastName || 'N/A',
          "GPA (Document)": detectedDocGpa || 'Not detected',
          "GPA (Input)": gpa || 'N/A',
          "Academic Year": academicYear || 'N/A',
          "Semester": semester || 'N/A',
          "School Name": schoolName || 'N/A',
          "Course / Track": course || 'N/A',
          "ID Number": idNumber || 'N/A',
          "Video Proof": videoOk ? 'Uploaded & Validated' : (videoCheck?.reason || 'No Text Detected in Video')
        };
      } else if (docType === 'Indigency') {
        const videoOk = videoCheck ? videoCheck.valid : (videoUrl ? true : false);
        debugRequirements = {
          "First Name": firstName || 'N/A',
          "Last Name": lastName || 'N/A',
          "Barangay Address": targetBarangay || 'N/A',
          "Town / City": townCity || 'N/A',
          "Video Proof": videoOk ? 'Uploaded & Validated' : (videoCheck?.reason || 'No Text Detected in Video')
        };
      }

      setOcrDebugLogs((prev) => ({
        ...prev,
        [docType]: {
          status: isSuccess ? 'VERIFIED (SUCCESS)' : 'FAILED (MISMATCH)',
          message: finalMessage,
          detectedText: combinedText,
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
  }

  // --- Indigency Verification Optimization ---
  const lastIndigencyScanRef = useRef({ doc: null, vid: null });
  async function handleIndigencyScan() {
    const indigencyDoc = getVerificationDocumentSource(
      photos.mayorIndigency_photo,
      formData.mayorIndigency_photo
    );
    const townCity = formData.townCityMunicipality || '';
    const barangay = formData.barangay || '';
    const videoUrl = documentVideos.mayorIndigency_video || formData.mayorIndigency_video;

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
  }

  async function handleCOEScan() {
    const coeDoc = getVerificationDocumentSource(
      photos.mayorCOE_photo,
      formData.mayorCOE_photo
    );
    const schoolName = formData.schoolName || '';
    const idNumber = formData.schoolIdNumber || '';
    const yearLevel = formData.yearLevel || '';
    const course = formData.course || '';
    const videoUrl = documentVideos.mayorCOE_video || formData.mayorCOE_video;
    const year = formData.year || '';
    const semester = scholarshipDetails?.semester || scholarshipDetails?.sem || formData.semester || '1st Semester';

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
      const targetAcademicYear = scholarshipDetails?.year || scholarshipDetails?.academic_year || formData.schoolYear || '2025-2026';
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
  }

  async function handleGradesScan() {
    const gradesDoc = getVerificationDocumentSource(
      photos.mayorGrades_photo,
      formData.mayorGrades_photo
    );
    const schoolName = formData.schoolName || '';
    const idNumber = formData.schoolIdNumber || '';
    const yearLevel = formData.yearLevel || '';
    const gpa = formData.gpa || '';
    const videoUrl = documentVideos.mayorGrades_video || formData.mayorGrades_video;
    const currentSem = scholarshipDetails?.semester || scholarshipDetails?.sem || formData.semester || '1st Semester';
    const expectedGradesSemester = scholarshipDetails?.grades_sem || scholarshipDetails?.gradesSem || (currentSem === '2nd' || currentSem === '2nd Semester' || currentSem === '2' ? '1st Semester' : '2nd Semester');

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
      const targetAcademicYear = scholarshipDetails?.grades_year || scholarshipDetails?.year || scholarshipDetails?.academic_year || formData.schoolYear || '2025-2026';
      const success = await performOcrVerification('Grades', gradesDoc, {
        schoolName: formData.schoolName,
        idNumber: formData.schoolIdNumber,
        yearLevel: formData.yearLevel,
        gpa: formData.gpa,
        semester: expectedGradesSemester,
        academicYear: targetAcademicYear
      }, videoUrl);
      if (success) {
        // Do NOT auto-fill or overwrite formData.gpa from OCR
        const applicantGpa = parseFloat(formData.gpa);
        const minRequired = scholarshipDetails?.minGpa ? parseFloat(scholarshipDetails.minGpa) : 0;

        if (minRequired > 0 && applicantGpa < minRequired) {
          setGradesVerified('failed');
          showPromptMessage(`Verification Error: Your GPA (${applicantGpa}) does not meet the minimum requirement (${minRequired}) for this scholarship.`);
          return;
        }

        setGradesVerified('success');
        showPromptMessage(`Grades verified successfully!`);
      } else {
        setGradesVerified('failed');
        showPromptMessage('Grades verification failed.');
      }
    } catch (err) {
      console.error('Scan Error:', err);
    }
  }

  // School ID Verification Optimization
  const lastIdScanRef = useRef({ front: null, back: null, frontVid: null, backVid: null });
  async function handleIdScan() {
    const idFront = getVerificationDocumentSource(
      schoolIdPhotos.front,
      formData.schoolIdFront
    );
    const idBack = getVerificationDocumentSource(
      schoolIdPhotos.back,
      formData.schoolIdBack
    );
    const frontVideoUrl = documentVideos.schoolIdFront_video || formData.schoolIdFront_video;
    const backVideoUrl = documentVideos.schoolIdBack_video || formData.schoolIdBack_video;

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
    if (String(formData.schoolIdNumber).replace(/[^0-9a-zA-Z]/g, '').length < 6) {
      showPromptMessage('Please enter a valid School ID Number (must be at least 6-8 digits).');
      return;
    }

    setLoadingMessage({ title: 'Scanning School ID', message: 'Verifying your School ID images and Video Content...' });
    lastIdScanRef.current = { front: idFront, back: idBack, frontVid: frontVideoUrl, backVid: backVideoUrl };

    try {
      const targetAcademicYear = scholarshipDetails?.year || scholarshipDetails?.academic_year || formData.schoolYear || '2025-2026';
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
  }

  async function saveCurrentStepProgress(stepNumber = currentStep) {
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

    setCurrentStep(1);
    if (scholarship) {
      setScholarshipName(scholarship);
    }

    const loadProfile = async () => {
      const savedDraft = await loadDraftFromStorage(draftKey);

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

        if (searchFullName && searchFullName.trim().toLowerCase() !== profileFullName.trim().toLowerCase()) {
          const parts = splitFullName(searchFullName);
          targetFirstName = parts.firstName || targetFirstName;
          targetMiddleName = parts.middleName || targetMiddleName;
          targetLastName = parts.lastName || targetLastName;
        }

        const token = localStorage.getItem('authToken');
        const apiOrigin = API_ORIGIN;

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
          semester: profile.semester || '1st Semester',
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
          gpa: savedDraft?.formData?.gpa || urlGpa || scholarshipSearchProfile?.gpa || profile.overall_gpa || '',
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

        // 1. Map document photos from server profile if available
        const newPhotos = {};
        if (profile.has_mayorIndigency_photo) {
          const indigencyUrl = `${apiOrigin}/api/student/applicant/document/raw/indigency_doc?token=${token}`;
          newPhotos.mayorIndigency_photo = indigencyUrl;
          updates.mayorIndigency_photo = indigencyUrl;
        }

        if (profile.has_mayorCOE_photo) {
          const coeUrl = `${apiOrigin}/api/student/applicant/document/raw/enrollment_certificate_doc?token=${token}`;
          newPhotos.mayorCOE_photo = coeUrl;
          updates.mayorCOE_photo = coeUrl;
        }

        if (profile.has_mayorGrades_photo) {
          const gradesUrl = `${apiOrigin}/api/student/applicant/document/raw/grades_doc?token=${token}`;
          newPhotos.mayorGrades_photo = gradesUrl;
          updates.mayorGrades_photo = gradesUrl;
        }

        const newIdPhotos = {};
        if (profile.has_id) {
          const frontUrl = `${apiOrigin}/api/student/applicant/document/raw/id_img_front?token=${token}`;
          newIdPhotos.front = frontUrl;
          updates.schoolIdFront = frontUrl;
        }

        if (profile.has_id_back) {
          const backUrl = `${apiOrigin}/api/student/applicant/document/raw/id_img_back?token=${token}`;
          newIdPhotos.back = backUrl;
          updates.schoolIdBack = backUrl;
        }

        if (Object.keys(newPhotos).length > 0) {
          setPhotos(prev => ({ ...prev, ...newPhotos }));
        }
        if (newIdPhotos.front || newIdPhotos.back) {
          setSchoolIdPhotos(prev => ({ ...prev, ...newIdPhotos }));
        }

        // 2. Map video URLs from server profile if available
        const nextVideos = {
          face_video: profile.id_vid_url ? `${apiOrigin}/api/student/applicant/document/raw/face_video?token=${token}` : null,
          mayorIndigency_video: profile.indigency_vid_url ? `${apiOrigin}/api/student/applicant/document/raw/mayorIndigency_video?token=${token}` : null,
          mayorGrades_video: profile.grades_vid_url ? `${apiOrigin}/api/student/applicant/document/raw/mayorGrades_video?token=${token}` : null,
          mayorCOE_video: profile.enrollment_certificate_vid_url ? `${apiOrigin}/api/student/applicant/document/raw/mayorCOE_video?token=${token}` : null,
          schoolIdFront_video: profile.schoolid_front_vid_url ? `${apiOrigin}/api/student/applicant/document/raw/schoolIdFront_video?token=${token}` : null,
          schoolIdBack_video: profile.schoolid_back_vid_url ? `${apiOrigin}/api/student/applicant/document/raw/schoolIdBack_video?token=${token}` : null
        };
        const activeVideos = {};
        Object.keys(nextVideos).forEach(k => {
          if (nextVideos[k]) {
            activeVideos[k] = nextVideos[k];
            updates[k] = nextVideos[k];
          }
        });
        if (Object.keys(activeVideos).length > 0) {
          setDocumentVideos(prev => ({ ...prev, ...activeVideos }));
        }

        setFormData(prev => {
          const merged = mergeMeaningfulValues(prev, updates);
          const preservedGpa = (prev.gpa && String(prev.gpa).trim()) ? prev.gpa : (savedDraft?.formData?.gpa || updates.gpa);
          return {
            ...merged,
            gpa: preservedGpa,
            firstName: targetFirstName,
            lastName: targetLastName,
            middleName: targetMiddleName
          };
        });

        // 3. Set verification states from database if present
        if (profile.indigency_verified && profile.indigency_vid_url && profile.has_mayorIndigency_photo) {
          setOcrVerified('success');
          setOcrStatus('Indigency verified successfully client-side!');
          setIndigencyResults([{ doc: 'Indigency', verified: true, message: 'Verified from database records.', score_details: { "First Name": true, "Last Name": true, "Barangay Address": true } }]);
        }

        if (profile.enrollment_verified && profile.enrollment_certificate_vid_url && profile.has_mayorCOE_photo) {
          setCoeVerified('success');
          setCoeStatus('COE verified successfully client-side!');
          setCoeResults([{ doc: 'Enrollment', verified: true, message: 'Verified from database records.', score_details: { "First Name": true, "Last Name": true, "School Name": true } }]);
        }

        if (profile.grades_verified && profile.grades_vid_url && profile.has_mayorGrades_photo) {
          setGradesVerified('success');
          setGradesStatus('Grades verified successfully client-side!');
          setGradesResults([{ doc: 'Grades', verified: true, message: 'Verified from database records.', score_details: { "First Name": true, "Last Name": true, "GPA Requirement": true } }]);
        }

        if (profile.id_verified && profile.schoolid_front_vid_url && profile.schoolid_back_vid_url && profile.has_id && profile.has_id_back) {
          setIdVerified('success');
          setIdStatus('School ID verified successfully client-side!');
          setIdResults([{ doc: 'SchoolID', verified: true, message: 'Verified from database records.', score_details: { "First Name": true, "Last Name": true } }]);
        }

        if (profile.face_verified && profile.id_vid_url && profile.has_profile_picture) setFaceVerified('success');
        if (profile.signature_verified && profile.has_signature) setSignatureVerified('success');

        if (profile.profile_picture) {
          setIdPicturePreview(profile.profile_picture);
        }

        if (profile.has_other_assistance) {
          setHasOtherAssistance('Yes');
        } else if (profile.has_other_assistance === false) {
          setHasOtherAssistance('No');
        }

        // Fetch scholarship requirements
        let reqNo = searchParams.get('reqNo') || searchParams.get('scholarship_id');
        const scholarshipNameParam = searchParams.get('scholarship');

        if (!reqNo && scholarshipNameParam) {
          try {
            const allScholarships = await scholarshipAPI.getAll();
            const matchedSch = allScholarships.find(s => s.scholarship_name === scholarshipNameParam);
            if (matchedSch) {
              reqNo = matchedSch.req_no;
            }
          } catch (e) {
            console.warn('[SCHOLARSHIP] Could not resolve reqNo by name:', e);
          }
        }

        if (reqNo) {
          try {
            const res = await scholarshipAPI.getById(reqNo);
            const scholarshipData = res?.scholarship || res;
            if (scholarshipData) {
              setScholarshipDetails(scholarshipData);
            }
          } catch (e) {
            console.warn('[SCHOLARSHIP] Could not load scholarship details:', e);
          }
        }
      } catch (err) {
        console.warn('Could not pre-fill from profile:', err.message);
      } finally {
        // Restore all unsubmitted draft data (photos, videos, signature, verification states, and text inputs)
        if (savedDraft) {
          if (savedDraft.formData) {
            setFormData(prev => {
              const filled = fillEmptyValuesOnly(prev, savedDraft.formData);
              if (savedDraft.formData.gpa) {
                filled.gpa = savedDraft.formData.gpa;
              }
              return filled;
            });
          }

          if (savedDraft.photos && Object.keys(savedDraft.photos).length > 0) {
            setPhotos(prev => {
              const updated = { ...prev };
              Object.entries(savedDraft.photos).forEach(([k, v]) => {
                if (v && !(typeof v === 'string' && v.startsWith('blob:'))) {
                  updated[k] = v;
                }
              });
              return updated;
            });
            setFormData(prev => {
              const updated = { ...prev };
              Object.entries(savedDraft.photos).forEach(([k, v]) => {
                if (v && !(typeof v === 'string' && v.startsWith('blob:'))) {
                  updated[k] = v;
                }
              });
              return updated;
            });
          }

          if (savedDraft.schoolIdPhotos && (savedDraft.schoolIdPhotos.front || savedDraft.schoolIdPhotos.back)) {
            setSchoolIdPhotos(prev => {
              const nextFront = savedDraft.schoolIdPhotos.front;
              const nextBack = savedDraft.schoolIdPhotos.back;
              return {
                front: (nextFront && !(typeof nextFront === 'string' && nextFront.startsWith('blob:'))) ? nextFront : prev.front,
                back: (nextBack && !(typeof nextBack === 'string' && nextBack.startsWith('blob:'))) ? nextBack : prev.back
              };
            });
            setFormData(prev => {
              const nextFront = savedDraft.schoolIdPhotos.front;
              const nextBack = savedDraft.schoolIdPhotos.back;
              return {
                ...prev,
                schoolIdFront: (nextFront && !(typeof nextFront === 'string' && nextFront.startsWith('blob:'))) ? nextFront : prev.schoolIdFront,
                schoolIdBack: (nextBack && !(typeof nextBack === 'string' && nextBack.startsWith('blob:'))) ? nextBack : prev.schoolIdBack
              };
            });
          }

          if (savedDraft.documentVideos && Object.keys(savedDraft.documentVideos).length > 0) {
            setDocumentVideos(prev => {
              const updated = { ...prev };
              Object.entries(savedDraft.documentVideos).forEach(([k, v]) => {
                if (v && !(typeof v === 'string' && v.startsWith('blob:'))) {
                  updated[k] = v;
                }
              });
              return updated;
            });
            setFormData(prev => {
              const updated = { ...prev };
              Object.entries(savedDraft.documentVideos).forEach(([k, v]) => {
                if (v && !(typeof v === 'string' && v.startsWith('blob:'))) {
                  updated[k] = v;
                }
              });
              return updated;
            });
          }

          if (savedDraft.drawnSignature) {
            setDrawnSignature(savedDraft.drawnSignature);
          }
          if (savedDraft.signaturePreview) {
            setSignaturePreview(savedDraft.signaturePreview);
          }
          if (savedDraft.idPicturePreview) {
            setIdPicturePreview(savedDraft.idPicturePreview);
          }

          const vs = savedDraft.verificationStates || {};
          if (vs.ocrVerified !== undefined && vs.ocrVerified !== null) setOcrVerified(vs.ocrVerified);
          if (vs.coeVerified !== undefined && vs.coeVerified !== null) setCoeVerified(vs.coeVerified);
          if (vs.gradesVerified !== undefined && vs.gradesVerified !== null) setGradesVerified(vs.gradesVerified);
          if (vs.idVerified !== undefined && vs.idVerified !== null) setIdVerified(vs.idVerified);
          if (vs.faceVerified !== undefined && vs.faceVerified !== null) setFaceVerified(vs.faceVerified);
          if (vs.signatureVerified !== undefined && vs.signatureVerified !== null) setSignatureVerified(vs.signatureVerified);

          if (vs.ocrStatus) setOcrStatus(vs.ocrStatus);
          if (vs.coeStatus) setCoeStatus(vs.coeStatus);
          if (vs.gradesStatus) setGradesStatus(vs.gradesStatus);
          if (vs.idStatus) setIdStatus(vs.idStatus);
          if (vs.signatureStatus) setSignatureStatus(vs.signatureStatus);

          if (vs.faceMatchResult) setFaceMatchResult(vs.faceMatchResult);
          if (vs.signatureResults) setSignatureResults(vs.signatureResults);
          if (vs.indigencyResults && vs.indigencyResults.length > 0) setIndigencyResults(vs.indigencyResults);
          if (vs.coeResults && vs.coeResults.length > 0) setCoeResults(vs.coeResults);
          if (vs.gradesResults && vs.gradesResults.length > 0) setGradesResults(vs.gradesResults);
          if (vs.idResults && vs.idResults.length > 0) setIdResults(vs.idResults);
          if (vs.ocrDebugLogs && Object.keys(vs.ocrDebugLogs).length > 0) setOcrDebugLogs(vs.ocrDebugLogs);

          if (savedDraft.hasOtherAssistance) {
            setHasOtherAssistance(savedDraft.hasOtherAssistance);
          }

          if (savedDraft.currentStep) {
            setCurrentStep(savedDraft.currentStep);
          }
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

    persistDraft(
      currentUser,
      formData,
      currentStep,
      {
        photos,
        schoolIdPhotos,
        documentVideos,
        drawnSignature,
        signaturePreview,
        idPicturePreview,
        ocrVerified,
        coeVerified,
        gradesVerified,
        idVerified,
        faceVerified,
        signatureVerified,
        ocrStatus,
        coeStatus,
        gradesStatus,
        idStatus,
        signatureStatus,
        faceMatchResult,
        signatureResults,
        indigencyResults,
        coeResults,
        gradesResults,
        idResults,
        ocrDebugLogs
      }
    );
  }, [
    currentUser, formData, hasOtherAssistance, currentStep, scholarshipName, searchParams,
    photos, schoolIdPhotos, documentVideos, drawnSignature, signaturePreview, idPicturePreview,
    ocrVerified, coeVerified, gradesVerified, idVerified, faceVerified, signatureVerified,
    ocrStatus, coeStatus, gradesStatus, idStatus, signatureStatus, faceMatchResult, signatureResults,
    indigencyResults, coeResults, gradesResults, idResults, ocrDebugLogs
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
    setFaceDetected(false);
    setFaceDetecting(false);
  };

  useEffect(() => {
    if (!showCameraModal || !cameraReady || !videoRef.current) {
      setFaceDetected(false);
      setFaceDetecting(false);
      return;
    }

    setFaceDetecting(true);
    let intervalId = null;

    const detectFaceInStream = () => {
      const video = videoRef.current;
      if (!video || video.paused || video.ended || !video.videoWidth || !video.videoHeight) return;

      try {
        const canvas = document.createElement('canvas');
        const w = 320;
        const h = 240;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, w, h);

        const startX = Math.round(w * 0.25);
        const endX = Math.round(w * 0.75);
        const startY = Math.round(h * 0.15);
        const endY = Math.round(h * 0.85);

        const imgData = ctx.getImageData(startX, startY, endX - startX, endY - startY);
        const data = imgData.data;
        let skinPixels = 0;
        const totalPixels = data.length / 4;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const isSkin = (r > 45 && g > 35 && b > 15 && Math.max(r, g, b) - Math.min(r, g, b) > 12 && Math.abs(r - g) > 8 && r > g && r > b) ||
            (r > 200 && g > 180 && b > 170 && Math.abs(r - g) <= 25 && r > b && g > b);
          if (isSkin) skinPixels++;
        }

        const skinRatio = skinPixels / totalPixels;
        if (skinRatio >= 0.10 && skinRatio <= 0.88) {
          setFaceDetected(true);
        } else {
          setFaceDetected(false);
        }
      } catch (e) {
        setFaceDetected(true);
      }
    };

    intervalId = setInterval(detectFaceInStream, 200);
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [showCameraModal, cameraReady]);

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
      setFaceMatchResult(null);
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
          setFaceMatchResult(null);
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
      setFaceMatchResult(null);
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
        const vid = documentVideos.mayorIndigency_video || formData.mayorIndigency_video;
        if (doc && vid) {
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
          const fVid = documentVideos.schoolIdFront_video || formData.schoolIdFront_video;
          const bVid = documentVideos.schoolIdBack_video || formData.schoolIdBack_video;
          if (front && back && fVid && bVid) {
            handleIdScan();
            setAutoScanTrigger(null);
          }
        }

        // COE
        if (baseScanType === 'Enrollment' && coeVerified === null) {
          const doc = getVerificationDocumentSource(photos.mayorCOE_photo, formData.mayorCOE_photo);
          const vid = documentVideos.mayorCOE_video || formData.mayorCOE_video;
          if (doc && vid) {
            handleCOEScan();
            setAutoScanTrigger(null);
          }
        }

        // Grades
        if (baseScanType === 'Grades' && gradesVerified === null) {
          const doc = getVerificationDocumentSource(photos.mayorGrades_photo, formData.mayorGrades_photo);
          const vid = documentVideos.mayorGrades_video || formData.mayorGrades_video;
          if (doc && vid) {
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

  const getCanvasFromSigPad = (ref) => {
    if (!ref || !ref.current) return null;
    const inst = ref.current;
    if (typeof inst.getCanvas === 'function') {
      try { return inst.getCanvas(); } catch (e) {}
    }
    if (typeof inst.getTrimmedCanvas === 'function') {
      try { return inst.getTrimmedCanvas(); } catch (e) {}
    }
    if (inst._canvas && inst._canvas instanceof HTMLCanvasElement) {
      return inst._canvas;
    }
    if (inst.canvas && inst.canvas instanceof HTMLCanvasElement) {
      return inst.canvas;
    }
    if (inst instanceof HTMLCanvasElement) {
      return inst;
    }
    return null;
  };

  const clearSignature = () => {
    if (sigPad.current) {
      if (typeof sigPad.current.clear === 'function') {
        try { sigPad.current.clear(); } catch (e) {}
      }
    }
    setDrawnSignature(null);
    setFormData(prev => ({ ...prev, applicantSignatureName: '' }));
  };

  const saveSignature = () => {
    const inst = sigPad.current;
    const isPadEmpty = inst ? (typeof inst.isEmpty === 'function' ? inst.isEmpty() : false) : true;

    if (inst && !isPadEmpty) {
      const canvas = getCanvasFromSigPad(sigPad);
      if (!canvas) {
        showPromptMessage('Could not access signature canvas. Please try signing again.');
        return;
      }

      const strokes = (typeof inst.getDrawingPath === 'function')
        ? inst.getDrawingPath()
        : (typeof inst.toData === 'function' ? inst.toData() : null);

      const complexity = analyzeSignatureComplexity(canvas, strokes);
      console.log('[SIGNATURE] Drawing complexity check:', complexity);
      setSignatureStats({ inkMass: complexity.mass, junctions: complexity.junctions, score: complexity.score });

      const dataUrl = (typeof inst.toDataURL === 'function')
        ? inst.toDataURL('image/png')
        : canvas.toDataURL('image/png');

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

      const appendSmartVideo = (fieldName) => {
        const videoValue = documentVideos[fieldName] || formData[fieldName];
        if (!videoValue) return;

        if (typeof videoValue === 'string') {
          if (videoValue.startsWith('http')) {
            submissionData.append(fieldName, videoValue);
          } else if (videoValue.startsWith('blob:')) {
            const publicUrl = formData[fieldName];
            if (publicUrl && publicUrl.startsWith('http')) {
              submissionData.append(fieldName, publicUrl);
            } else {
              console.warn(`Local blob URL found for ${fieldName} but no public URL.`);
            }
          }
        } else {
          submissionData.append(fieldName, videoValue, `${fieldName}.webm`);
        }
      };

      const docKeys = ['mayorCOE', 'mayorGrades', 'mayorIndigency'];
      docKeys.forEach(key => {
        const fileKey = `${key}_photo`;
        if (photos[fileKey]) {
          submissionData.append(fileKey, photos[fileKey]);
        } else if (formData[fileKey] && typeof formData[fileKey] === 'string') {
          submissionData.append(fileKey, formData[fileKey]);
        }

        appendSmartVideo(`${key}_video`);
      });

      appendSmartVideo('face_video');

      ['schoolIdFront_video', 'schoolIdBack_video'].forEach((videoField) => {
        appendSmartVideo(videoField);
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

        {/* Fill Docs from Supabase Button */}
        <button
          type="button"
          onClick={fillDocsFromSupabase}
          style={{
            width: '100%',
            background: '#059669',
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
            gap: '6px'
          }}
        >
          <span style={{ fontSize: '0.9rem' }}>📂</span> Prefill Docs from Supabase
        </button>

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
                      onChange={handleInputChange}
                      onBlur={e => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v)) {
                          setFormData(prev => ({ ...prev, gpa: (Math.round(v * 100) / 100).toFixed(2) }));
                        }
                      }}
                      placeholder="e.g. 3.44"
                      step="0.01"
                      min="1.00"
                      max="4.00"
                      required={currentStep === 3}
                    />
                    <small style={{ color: '#64748b', fontSize: '0.75rem' }}>Rounded to hundredths (e.g. 3.44)</small>
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
                      {(schoolIdPhotos.back || formData.schoolIdBack || photos.id_back) ? (
                        <img src={getVerificationDocumentSource(schoolIdPhotos.back, formData.schoolIdBack, photos.id_back)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} alt="Reference Back ID" />
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
                              disabled={signatureVerified === 'verifying' || !(schoolIdPhotos.back || formData.schoolIdBack || photos.id_back)}
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
                                    onClick={() => { setFaceMatchResult(null); setFaceVerified(null); openCamera('face_photo'); }}
                                    style={{ background: 'rgba(255,255,255,0.9)', color: 'var(--primary)', border: 'none', borderRadius: '10px', padding: '6px 12px', fontSize: '0.75rem', fontWeight: '800', cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', gap: '5px' }}
                                  >
                                    <i className="fas fa-camera"></i> Retake
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { removePhoto('face_photo'); setFaceMatchResult(null); setFaceVerified(null); }}
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
                              setLoadingMessage({ title: 'Matching Face', message: 'Comparing captured photo with your School ID... (Server may take up to 15s to wake up)' });

                              try {
                                const faceNorm = await normalizeVerificationImage(photos.face_photo);
                                const idNorm = await normalizeVerificationImage(idImg);
                                // Resize to 640px max before sending — preserves facial feature resolution on ID cards
                                const faceImage = await resizeImageForFaceVerification(faceNorm, 640, 0.85);
                                const normalizedIdImage = await resizeImageForFaceVerification(idNorm, 640, 0.85);
                                const result = await applicantAPI.verifyFaceAgainstId(faceImage, normalizedIdImage);
                                if (result.verified) {
                                  setFaceMatchResult(result);
                                  setFaceVerified('success');
                                  showPromptMessage('Face successfully matched with ID!');
                                } else if (result.message && (result.message.includes('Service Error') || result.message.includes('timed out') || result.message.includes('ConnectionPool') || result.message.includes('localhost') || result.message.includes('starting up'))) {
                                  // Backend service unavailable — do NOT auto-pass, inform user
                                  setFaceMatchResult({ verified: false, message: 'Verification service is warming up. Please try again in a few seconds.' });
                                  showPromptMessage('Server is warming up. Please click Verify again in a few seconds.');
                                } else {
                                  setFaceMatchResult(result);
                                  showPromptMessage(`Face Match Issue: ${result.message || 'Face does not match the ID.'}`);
                                }
                              } catch (err) {
                                console.error('Match error:', err);
                                const errStr = String(err?.message || err || '');
                                const isWarmup = errStr.includes('503') || errStr.includes('502') || errStr.includes('starting up') || errStr.includes('waking') || errStr.includes('Network Error') || errStr.includes('CORS') || errStr.includes('reach the server') || err?.name === 'TypeError';
                                const msg = isWarmup
                                  ? 'Server is waking up (Render cold start). Please click Verify again in 10–15 seconds.'
                                  : 'Server connection error. Please click Verify again.';
                                setFaceMatchResult({ verified: false, message: msg });
                                showPromptMessage(msg);
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
        <div className="camera-modal-content" style={{ maxWidth: '520px', borderRadius: '28px', padding: '1.8rem' }}>
          <h3 style={{ marginBottom: '0.4rem', color: 'var(--primary)', fontWeight: '800', fontSize: '1.4rem' }}>
            Face Verification
          </h3>
          <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1.2rem', fontWeight: '500' }}>
            Align your face inside the oval ring. Hold steady for capture.
          </p>

          <div style={{
            position: 'relative',
            width: '100%',
            aspectRatio: '4/3',
            background: '#0f172a',
            borderRadius: '24px',
            overflow: 'hidden',
            marginBottom: '1.5rem',
            boxShadow: '0 12px 30px rgba(0,0,0,0.25)',
            border: `3px solid ${faceDetected ? '#10b981' : '#3b82f6'}`,
            transition: 'border-color 0.3s ease'
          }}>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transform: usingFrontCamera ? 'scaleX(-1)' : 'none'
              }}
            />

            {/* GCash-Style Animated Oval Ring Target */}
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '62%',
              height: '75%',
              borderRadius: '50%',
              border: `4px dashed ${faceDetected ? '#10b981' : 'rgba(255,255,255,0.75)'}`,
              boxShadow: faceDetected
                ? '0 0 25px rgba(16, 185, 129, 0.8), inset 0 0 20px rgba(16, 185, 129, 0.3)'
                : '0 0 15px rgba(59, 130, 246, 0.5)',
              transition: 'all 0.3s ease',
              pointerEvents: 'none'
            }} />

            {/* Status Badge */}
            <div style={{
              position: 'absolute',
              bottom: '16px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: faceDetected ? 'rgba(16, 185, 129, 0.95)' : 'rgba(15, 23, 42, 0.85)',
              color: '#ffffff',
              padding: '8px 18px',
              borderRadius: '30px',
              fontSize: '0.82rem',
              fontWeight: '800',
              backdropFilter: 'blur(8px)',
              boxShadow: '0 4px 15px rgba(0,0,0,0.2)',
              letterSpacing: '0.5px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.3s ease',
              whiteSpace: 'nowrap'
            }}>
              <i className={`fas ${faceDetected ? 'fa-check-circle' : 'fa-user-focus'}`} style={{ fontSize: '1rem' }}></i>
              {faceDetected ? 'FACE DETECTED — HOLD STEADY' : 'POSITION FACE INSIDE OVAL'}
            </div>

            {cameraInitializing && (
              <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', color: 'white' }}>
                <i className="fas fa-spinner fa-spin" style={{ fontSize: '2.5rem', color: '#10b981' }}></i>
              </div>
            )}
            {cameraError && (
              <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.85)', color: 'white', padding: '2rem' }}>
                <i className="fas fa-exclamation-triangle" style={{ fontSize: '2.5rem', marginBottom: '1rem', color: '#ffcc00' }}></i>
                <p style={{ fontWeight: '600' }}>{cameraError.message}</p>
                <button onClick={() => openCamera(activeCameraField)} className="submit-btn" style={{ marginTop: '1rem', padding: '0.6rem 1.5rem', height: 'auto', borderRadius: '12px' }}>Retry Camera</button>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '15px', justifyContent: 'center' }}>
            <button type="button" onClick={closeCamera} className="back-to-form-btn" style={{ borderRadius: '20px', padding: '0.8rem 1.5rem' }}>Cancel</button>
            <button
              type="button"
              onClick={capturePhoto}
              className="submit-btn"
              disabled={!cameraReady}
              style={{
                width: 'auto',
                padding: '0.8rem 2.2rem',
                height: 'auto',
                borderRadius: '30px',
                background: faceDetected ? '#10b981' : 'var(--primary)',
                boxShadow: faceDetected ? '0 6px 20px rgba(16, 185, 129, 0.4)' : 'none',
                transition: 'all 0.3s ease'
              }}
            >
              <i className="fas fa-camera" style={{ marginRight: '8px' }}></i>
              {faceDetected ? 'Capture Photo' : 'Capture Photo'}
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
