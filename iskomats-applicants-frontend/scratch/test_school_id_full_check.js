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

function extractCandidateNameFromDocument(text) {
  if (!text) return null;

  const labeledPatterns = [
    /(?:student\s*name|name\s*of\s*student)\s*[:\-1l\|\]\}\)]\s*([A-Za-z\s,\.\-]{3,60})(?=\s*(?:total|student|course|reg|scholarship|academic|section|units|\n|$))/i,
    /(?:certify|certifies|cently|certifye|certiy|patunay|katibayan)\s+(?:that\s+)?[_\W]*([A-Za-z\s,\.\-]{3,60})(?=\s*(?:\d+\s*years|of\s*legal\s*age|single|married|widow|separated|divorced|filipino|pilipino|citizen|is\s+a\s+resident|resident|bonafide|\n|$))/i,
    /(?:this\s+is\s+to|sto)\s+[a-z]{3,10}\s+that\s+[_\W]*([A-Za-z\s,\.\-]{3,60})(?=\s*(?:\d+\s*years|of\s*legal\s*age|single|married|widow|separated|filipino|citizen|resident|bonafide|\n|$))/i,
    /(?:name|pangalan)\s*[:\-]?\s*([A-Za-z\s,\.\-]+?)(?=\s+total|\s+reg|\s+student|\s+id|\s+course|\n|$)/i,
    /\b([A-Za-z]{2,20}\s*,\s*[A-Za-z ]{3,40})\b/
  ];

  for (const pat of labeledPatterns) {
    const m = text.match(pat);
    if (m && m[1]) {
      const rawCand = m[1].replace(/^[^a-zA-Z]+/, '').trim();
      if (rawCand.length >= 3 && rawCand.includes(' ')) {
        return rawCand;
      }
    }
  }

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const stopHeader = /COLLEGE|UNIVERSITY|DE LA SALLE|LIPA|REPUBLIC|PHILIPPINES|STUDENT|SIGNATURE|VALID|UNTIL|CHANCELLOR|REGISTRAR|SECTION|COURSE|DEGREE|YEAR|LEVEL|GRADE/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const words = line.split(/\s+/).filter(w => /^[A-Za-z\.\,]+$/.test(w));
    if (words.length >= 2 && !stopHeader.test(line)) {
      const prevLine = i > 0 ? lines[i - 1] : '';
      if (prevLine && /^[A-Za-z]{2,20}$/.test(prevLine) && !stopHeader.test(prevLine)) {
        return `${prevLine}, ${line}`;
      }
      return line;
    }
  }

  return null;
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

const schoolIdText = `COLLEGE
DE LA SALLE LIPA
LANTAFE
Mikaela Ysabel L.
2021305751`;

console.log("School ID: First='Mikaela' vs Doc 'LANTAFE / Mikaela Ysabel L.':", studentNameMatchesText(schoolIdText, "Mikaela", "L", "Lantafe"));
console.log("School ID: First='Mikaela Ysabel' vs Doc 'LANTAFE / Mikaela Ysabel L.':", studentNameMatchesText(schoolIdText, "Mikaela Ysabel", "L", "Lantafe"));
