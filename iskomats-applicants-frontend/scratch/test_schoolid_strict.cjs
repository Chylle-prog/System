const fs = require('fs');

function normalizeForOcr(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeNameConfusions(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    .replace(/1/g, 'i')
    .replace(/l/g, 'i')
    .replace(/\|/g, 'i')
    .replace(/0/g, 'o')
    .replace(/5/g, 's')
    .replace(/3/g, 'e')
    .replace(/8/g, 'b')
    .replace(/4/g, 'a')
    .replace(/rn/g, 'm')
    .replace(/cl/g, 'd')
    .replace(/vv/g, 'w')
    .replace(/y/g, 'i')
    .replace(/j/g, 'i')
    .replace(/u/g, 'v');
}

function isSimilarWord(expected, actual) {
  if (!expected || !actual) return false;
  const expNorm = expected.toLowerCase().trim();
  const actNorm = actual.toLowerCase().trim();
  if (expNorm === actNorm) return true;

  if (expNorm.length === actNorm.length) {
    const expConf = normalizeNameConfusions(expNorm);
    const actConf = normalizeNameConfusions(actNorm);
    if (expConf && expConf === actConf) return true;
  }

  return false;
}

function extractOcrKeyValues(text) {
  return {};
}

function studentNameMatchesText(text, first, middle, last) {
  const normText = normalizeForOcr(text);
  if (!normText) return { success: false, details: { first_ok: false, middle_ok: false, last_ok: false } };

  const kv = extractOcrKeyValues(text);
  const targetText = kv.name ? normalizeForOcr(kv.name) : normText;

  const normFirst = normalizeForOcr(first || '');
  const normLast = normalizeForOcr(last || '');

  const checkNameWordGroup = (nameStr, searchText) => {
    if (!nameStr) return true;
    const words = normalizeForOcr(nameStr).split(' ').filter(w => w.length >= 2);
    if (words.length === 0) return true;
    const ocrWords = searchText.split(/\s+/).filter(w => w.length >= 1);

    const matchResults = words.map(word => {
      const normW = normalizeForOcr(word);
      const confW = normalizeNameConfusions(word);
      if (!normW) return true;

      if (new RegExp('\\b' + normW.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(searchText)) return true;

      const foundFullWord = ocrWords.some(ocrW => {
        const normOcr = normalizeForOcr(ocrW);
        if (!normOcr || normOcr.length < 2) return false;
        if (isSimilarWord(normW, normOcr)) return true;
        if (confW.length >= 3 && normalizeNameConfusions(ocrW) === confW) return true;
        return false;
      });
      return foundFullWord;
    });

    return matchResults.every(Boolean);
  };

  const firstOk = checkNameWordGroup(first, targetText) || checkNameWordGroup(first, normText);
  const lastOk = checkNameWordGroup(last, targetText) || checkNameWordGroup(last, normText);
  let middleOk = true;

  let reverseFirstOk = true;
  let reverseLastOk = true;
  let candidateNameStr = kv.name || null;
  if (!candidateNameStr) {
    const certPatterns = [
      /(?:certify|certifies|cently|certifye|certiy)\s+(?:that\s+)?[_\W]*([A-Za-z\s,\.\-]{3,60})(?=\s*(?:is\s+a|\d+\s*years|of\s*legal\s*age|single|married|widow|separated|divorced|filipino|pilipino|citizen|resident|bonafide|purok|barangay|\n|$))/gi,
      /(?:this\s+is\s+to|sto)\s+[a-z]{3,10}\s+that\s+[_\W]*([A-Za-z\s,\.\-]{3,60})(?=\s*(?:is\s+a|\d+\s*years|of\s*legal\s*age|single|married|widow|separated|filipino|citizen|resident|bonafide|purok|barangay|\n|$))/gi,
      /that\s+[_\W]*([A-Z\s,\.\-]{5,60})(?=\s*(?:is\s+a|\d+\s*years|of\s*legal\s*age|single|married|widow|separated|filipino|citizen|resident|bonafide|purok|barangay|\n|$))/gi,
      /(?:^|\n|\r|\:)\s*([A-Z]{2,20}\s*,\s*[A-Z\s]{3,50})/gi,
      /(?:student\s*name|name\s*of\s*student)\s*[:\-1l\|\]\}\)]*\s*([A-Za-z\s,\.\-]{3,60})/gi,
      /(?:name|pangalan)\s*[:\-]?\s*([A-Za-z\s,\.\-]+?)/gi,
      /\b([A-Za-z]{2,20}\s*,\s*[A-Za-z ]{3,40})\b/g
    ];

    const addressNoise = /CITY|BATANGAS|PHILIPPINES|HIGHWAY|STREET|ROAD|ADDRESS|BARANGAY|PROVINCE|TEL|TELEFAX|WWW|OFFICE|REGISTRAR|COLLEGE|UNIVERSITY/i;

    for (const pat of certPatterns) {
      let match;
      while ((match = pat.exec(text)) !== null) {
        if (match && match[1]) {
          const rawCand = match[1].replace(/^[^a-zA-Z]+/, '').trim();
          if (rawCand.length >= 3 && rawCand.includes(' ') && !addressNoise.test(rawCand)) {
            candidateNameStr = rawCand;
            break;
          }
        }
      }
      if (candidateNameStr) break;
    }
  }

  if (!candidateNameStr) {
    const rawLines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const stopHeader = /COLLEGE|UNIVERSITY|DE LA SALLE|LIPA|REPUBLIC|PHILIPPINES|STUDENT|SIGNATURE|VALID|UNTIL|CHANCELLOR|REGISTRAR|SECTION|COURSE|DEGREE|YEAR|LEVEL|GRADE/i;
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      const words = line.split(/\s+/).filter(w => /^[A-Za-z\.\,]+$/.test(w));
      if (words.length >= 2 && !stopHeader.test(line)) {
        const prevLine = i > 0 ? rawLines[i - 1] : '';
        if (prevLine && /^[A-Za-z]{2,20}$/.test(prevLine) && !stopHeader.test(prevLine)) {
          candidateNameStr = `${prevLine}, ${line}`;
        } else {
          candidateNameStr = line;
        }
        break;
      }
    }
  }

  if (candidateNameStr) {
    candidateNameStr = candidateNameStr.replace(/(?:is\s+a\s+|bonafide|resident|indigent|citizen|filipino|single|married|widow|separated|divorced|of\s+legal\s+age|\d+\s*years|purok|barangay|bayan|lipa|batangas|punong|kagawad|seal|signature|date|issued|total|student|course|reg|scholarship|academic|section|units|failure|incomplete|blank|drp|status|pay|discount)[\s\S]*/i, '').trim();
  }

  if (candidateNameStr && (/\d/.test(candidateNameStr) || /AY\s*\d|School\s*Year|Semester|1st|2nd|3rd|Official|Certificate|Registration/i.test(candidateNameStr))) {
    candidateNameStr = null;
  }

  if (candidateNameStr) {
    let cleanCandStr = candidateNameStr.replace(/(?:reg\s*no|student\s*no|id|tran\s*date|status|sec|bldg|college|course|year|level|pay|user|scholarship|discount|ref\s*no|subject|assessed|fees|units|pay\s*type|room|faculty|days|time)[\s\S]*/i, '');

    let candFirstStr = cleanCandStr;
    let candLastStr = '';

    if (cleanCandStr.includes(',')) {
      const commaParts = cleanCandStr.split(',');
      candLastStr = commaParts[0];
      candFirstStr = commaParts.slice(1).join(' ');
    } else {
      const words = cleanCandStr.trim().split(/\s+/);
      if (words.length >= 2) {
        candLastStr = words[words.length - 1];
        candFirstStr = words.slice(0, words.length - 1).join(' ');
      }
    }

    const normCandFirst = normalizeForOcr(candFirstStr.replace(/[^a-zA-Z\s]/g, ' '));
    const normCandLast = normalizeForOcr(candLastStr.replace(/[^a-zA-Z\s]/g, ' '));
    const stopWords = ['mr', 'ms', 'mrs', 'student', 'name', 'certify', 'resident', 'bonafide', 'officer', 'barangay', 'office', 'reg', 'no', 'tran', 'republic', 'philippines', 'this', 'that', 'years', 'age', 'college', 'course', 'degree', 'year', 'level', 'scholarship', 'discount', 'subject', 'assessed', 'fees', 'units', 'pay', 'type', 'section', 'bldg', 'room', 'faculty', 'days', 'time', 'first', 'second', 'semester', 'sem', 'ay', 'sy', 'is', 'a', 'indigent'];

    const candFirstWords = normCandFirst.split(/\s+/).filter(w => {
      if (w.length < 2 || stopWords.includes(w.toLowerCase())) return false;
      const userInputLastNorm = normalizeForOcr(last || '');
      if (isSimilarWord(w, userInputLastNorm) || isSimilarWord(userInputLastNorm, w)) return false;
      if (normCandLast && (isSimilarWord(w, normCandLast) || isSimilarWord(normCandLast, w))) return false;
      return true;
    });

    if (candFirstWords.length >= 2) {
      const userInputFirstNorm = normalizeForOcr(`${first || ''} ${middle || ''}`);
      const inputFirstWords = userInputFirstNorm.split(/\s+/).filter(w => w.length >= 1);

      const missingDocFirstWords = candFirstWords.filter(docW => {
        return !inputFirstWords.some(inpW => isSimilarWord(docW, inpW) || isSimilarWord(inpW, docW) || (inpW.length === 1 && docW.toLowerCase().startsWith(inpW.toLowerCase())));
      });
      if (missingDocFirstWords.length > 0) {
        reverseFirstOk = false;
      }
    }

    if (normCandLast && normCandLast.length >= 2 && !stopWords.includes(normCandLast.toLowerCase())) {
      const userInputLastNorm = normalizeForOcr(last || '');
      if (userInputLastNorm) {
        const lastWords = userInputLastNorm.split(/\s+/).filter(w => w.length >= 2);
        const matchesLast = lastWords.some(w => isSimilarWord(w, normCandLast) || isSimilarWord(normCandLast, w)) ||
                            isSimilarWord(userInputLastNorm, normCandLast) ||
                            isSimilarWord(normCandLast, userInputLastNorm) ||
                            new RegExp('\\b' + normCandLast.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(userInputLastNorm);
        if (!matchesLast) {
          reverseLastOk = false;
        }
      }
    }
  }

  const finalFirstOk = firstOk && reverseFirstOk;
  const finalLastOk = lastOk && reverseLastOk;
  const success = finalFirstOk && finalLastOk && middleOk;

  return { success, details: { first_ok: finalFirstOk, middle_ok: middleOk, last_ok: finalLastOk } };
}

const schoolIdText = `
DE LA SALLE LIPA
COLLEGE
LANTAFE
Mikaela Ysabel L.
2021305751
SY 2025-2026
`;

const corDocText = `
DE LA SALLE LIPA
OFFICE OF THE COLLEGE REGISTRAR
CERTIFICATE OF REGISTRATION
STUDENT NO: 2021305751
NAME: LANTAFE, MIKAELA YSABEL L.
COURSE: BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY
AY: 2025-2026 1st Semester
`;

const gradesDocText = `
DE LA SALLE LIPA
OFFICE OF THE COLLEGE REGISTRAR
OFFICIAL TRANSCRIPT OF RECORDS / GRADES
STUDENT NAME: MIKAELA YSABEL L. LANTAFE
STUDENT NO: 2021305751
GPA: 1.50
`;

const nationalIdText = `
REPUBLIC OF THE PHILIPPINES
PHILIPPINE IDENTIFICATION SYSTEM
PAMBANSANG PAGKAKAKILANLAN
APELIDO / LAST NAME: LANTAFE
MGA PANGALAN / GIVEN NAMES: MIKAELA YSABEL
GITNANG APELIDO / MIDDLE NAME: LINATOC
`;

console.log("=== SCHOOL ID REAL IMPLEMENTATION TEST ===");
console.log("School ID: 'Mikaela Ysabel' ->", studentNameMatchesText(schoolIdText, "Mikaela Ysabel", "", "Lantafe"));
console.log("School ID: 'Mikaela' ->", studentNameMatchesText(schoolIdText, "Mikaela", "", "Lantafe"));
console.log("School ID: 'Mikaela Ysabela' ->", studentNameMatchesText(schoolIdText, "Mikaela Ysabela", "", "Lantafe"));
console.log("School ID: 'Mikaela Ysabe' ->", studentNameMatchesText(schoolIdText, "Mikaela Ysabe", "", "Lantafe"));

console.log("\n=== COR REAL IMPLEMENTATION TEST ===");
console.log("COR: 'Mikaela Ysabel' ->", studentNameMatchesText(corDocText, "Mikaela Ysabel", "", "Lantafe"));
console.log("COR: 'Mikaela' ->", studentNameMatchesText(corDocText, "Mikaela", "", "Lantafe"));
console.log("COR: 'Mikaela Ysabela' ->", studentNameMatchesText(corDocText, "Mikaela Ysabela", "", "Lantafe"));
console.log("COR: 'Mikaela Ysabe' ->", studentNameMatchesText(corDocText, "Mikaela Ysabe", "", "Lantafe"));

console.log("\n=== GRADES REAL IMPLEMENTATION TEST ===");
console.log("Grades: 'Mikaela Ysabel' ->", studentNameMatchesText(gradesDocText, "Mikaela Ysabel", "", "Lantafe"));
console.log("Grades: 'Mikaela' ->", studentNameMatchesText(gradesDocText, "Mikaela", "", "Lantafe"));
console.log("Grades: 'Mikaela Ysabela' ->", studentNameMatchesText(gradesDocText, "Mikaela Ysabela", "", "Lantafe"));
console.log("Grades: 'Mikaela Ysabe' ->", studentNameMatchesText(gradesDocText, "Mikaela Ysabe", "", "Lantafe"));

console.log("\n=== NATIONAL ID REAL IMPLEMENTATION TEST ===");
console.log("National ID: 'Mikaela Ysabel' ->", studentNameMatchesText(nationalIdText, "Mikaela Ysabel", "", "Lantafe"));
console.log("National ID: 'Mikaela' ->", studentNameMatchesText(nationalIdText, "Mikaela", "", "Lantafe"));
console.log("National ID: 'Mikaela Ysabela' ->", studentNameMatchesText(nationalIdText, "Mikaela Ysabela", "", "Lantafe"));
console.log("National ID: 'Mikaela Ysabe' ->", studentNameMatchesText(nationalIdText, "Mikaela Ysabe", "", "Lantafe"));
