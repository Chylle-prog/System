const multilineGradesText = `DE LA SALLE LIPA
OFFICE OF THE COLLEGE REGISTRAR
1962 J.P. Laurel National Highway 4217 Lipa City, Batangas Philippines
Tel. (+63 43) 756 5555 loc 222 Telefax (+63 43) 981 1781
www.disi.edu.ph
STUDENT'S FINAL GRADES
SY/Sem
Student No
: 2025-2026 1st Semester
Total Units Enrolled
:
128
: 2021305751
Student Name
Course
: LANTAFE, MIKAELA YSABEL LINATOC
Total Units of Failure (0.00)
Total Units of Failure (0.00) %
:
0
0
: BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY
Total Units of Incomplete
:
0`;

function normalizeForOcr(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function isSimilarWord(w1, w2) {
  if (!w1 || !w2) return false;
  const a = w1.toLowerCase();
  const b = w2.toLowerCase();
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4) {
    if (a.startsWith(b) || b.startsWith(a)) return true;
  }
  return false;
}

function checkNameWordGroup(expectedWordsStr, text) {
  if (!expectedWordsStr || !text) return false;
  const expWords = normalizeForOcr(expectedWordsStr).split(/\s+/).filter(w => w.length >= 1);
  const normText = normalizeForOcr(text);
  if (!expWords.length || !normText) return false;

  return expWords.every(w => {
    if (w.length === 1) {
      return new RegExp('\\b' + w + '\\b', 'i').test(normText) || normText.split(/\s+/).some(tw => tw.toLowerCase().startsWith(w.toLowerCase()));
    }
    return new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(normText) ||
           normText.split(/\s+/).some(tw => isSimilarWord(tw, w));
  });
}

function extractCandidateNameFromDocument(rawText) {
  if (!rawText) return null;
  let candidateNameStr = null;

  const patterns = [
    /(?:^|\n|\r|\:)\s*([A-Z]{2,20}\s*,\s*[A-Z\s]{3,50})/g,
    /(?:student\s*name|name\s*of\s*student|name|pangalan)\s*[:\-1l\|\]\}\)]*\s*([A-Za-z\s,\.\-]{3,60})/gi,
    /(?:certify|certifies|cently|certifye|certiy|patunay|katibayan)\s+(?:that\s+)?[_\W]*([A-Za-z\s,\.\-]{3,60})/gi,
    /\b([A-Za-z]{2,20}\s*,\s*[A-Za-z ]{3,40})\b/g
  ];

  const addressNoise = /CITY|BATANGAS|PHILIPPINES|HIGHWAY|STREET|ROAD|ADDRESS|BARANGAY|PROVINCE|TEL|TELEFAX|WWW|OFFICE|REGISTRAR|COLLEGE|UNIVERSITY/i;

  for (const pat of patterns) {
    let match;
    while ((match = pat.exec(rawText)) !== null) {
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

  if (candidateNameStr) {
    candidateNameStr = candidateNameStr.replace(/(?:total|student|course|reg|scholarship|academic|section|units|failure|incomplete|blank|drp|status|pay|discount)[\s\S]*/i, '').trim();
  }

  if (candidateNameStr && (/\d/.test(candidateNameStr) || /AY\s*\d|School\s*Year|Semester|1st|2nd|3rd|Official|Certificate|Registration/i.test(candidateNameStr))) {
    candidateNameStr = null;
  }

  return candidateNameStr;
}

function studentNameMatchesText(text, first, middle, last) {
  if (!text) return { success: false, details: { first_ok: false, middle_ok: false, last_ok: false } };

  const normText = normalizeForOcr(text);
  const firstOk = checkNameWordGroup(first, normText);
  const lastOk = checkNameWordGroup(last, normText);

  let middleOk = true;
  if (middle) {
    const normMid = normalizeForOcr(middle);
    if (normMid) {
      const matchDirect = checkNameWordGroup(middle, normText);
      if (matchDirect) {
        middleOk = true;
      } else if (normMid.length <= 2) {
        const allWords = normText.split(/\s+/).filter(w => w.length >= 2);
        middleOk = allWords.some(w => w.toLowerCase().startsWith(normMid[0].toLowerCase()));
      } else {
        middleOk = false;
      }
    }
  }

  let reverseFirstOk = true;
  let reverseLastOk = true;

  let candidateNameStr = extractCandidateNameFromDocument(text);

  if (candidateNameStr) {
    let cleanCandStr = candidateNameStr;

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
    const stopWords = ['mr', 'ms', 'mrs', 'student', 'name', 'certify', 'resident', 'bonafide', 'officer', 'barangay', 'office', 'reg', 'no', 'tran', 'republic', 'philippines', 'this', 'that', 'years', 'age', 'college', 'course', 'degree', 'year', 'level', 'scholarship', 'discount', 'subject', 'assessed', 'fees', 'units', 'pay', 'type', 'section', 'bldg', 'room', 'faculty', 'days', 'time', 'first', 'second', 'semester', 'sem', 'ay', 'sy'];

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
  }

  const finalFirstOk = firstOk && reverseFirstOk;
  const finalLastOk = lastOk && reverseLastOk;
  const success = finalFirstOk && finalLastOk && middleOk;

  return { success, details: { first_ok: finalFirstOk, middle_ok: middleOk, last_ok: finalLastOk } };
}

console.log("Grades User OCR Text: First='Mikaela' vs Doc 'LANTAFE, MIKAELA YSABEL LINATOC':", studentNameMatchesText(multilineGradesText, "Mikaela", "", "Lantafe"));
console.log("Grades User OCR Text: First='Mikaela Ysabel' vs Doc 'LANTAFE, MIKAELA YSABEL LINATOC':", studentNameMatchesText(multilineGradesText, "Mikaela Ysabel", "L", "Lantafe"));
