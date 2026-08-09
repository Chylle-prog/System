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

function studentNameMatchesText(text, first, middle, last) {
  if (!text) return { success: false, details: { first_ok: false, middle_ok: false, last_ok: false, sequence_ok: false } };

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

  let candidateNameStr = null;
  const certPatterns = [
    /(?:student\s*name|name\s*of\s*student)\s*[:\-1l\|\]\}\)]\s*([A-Za-z\s,\.\-]{3,60})(?=\s*(?:total|student|course|reg|scholarship|academic|section|units|\n|$))/i,
    /(?:certify|certifies|cently|certifye|certiy|patunay|katibayan)\s+(?:that\s+)?[_\W]*([A-Za-z\s,\.\-]{3,60})(?=\s*(?:\d+\s*years|of\s*legal\s*age|single|married|widow|separated|divorced|filipino|pilipino|citizen|is\s+a\s+resident|resident|bonafide|\n|$))/i,
    /(?:this\s+is\s+to|sto)\s+[a-z]{3,10}\s+that\s+[_\W]*([A-Za-z\s,\.\-]{3,60})(?=\s*(?:\d+\s*years|of\s*legal\s*age|single|married|widow|separated|filipino|citizen|resident|bonafide|\n|$))/i,
    /\b([A-Za-z]{2,20}\s*,\s*[A-Za-z ]{3,40})\b/
  ];

  for (const pat of certPatterns) {
    const m = text.match(pat);
    if (m && m[1]) {
      const rawCand = m[1].replace(/^[^a-zA-Z]+/, '').trim();
      if (rawCand.length >= 3 && rawCand.includes(' ')) {
        candidateNameStr = rawCand;
        break;
      }
    }
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

const gradesText = `DE LA SALLE LIPA
OFFICE OF THE COLLEGE REGISTRAR
STUDENT'S FINAL GRADES
SY/Sem : 2025-2026 1st Semester Total Units Enrolled : 128
Student No : 2021305751
Student Name : LANTAFE, MIKAELA YSABEL LINATOC
Course : BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY`;

console.log("Grades: First='Mikaela' vs Doc 'MIKAELA YSABEL LINATOC':", studentNameMatchesText(gradesText, "Mikaela", "", "Lantafe"));
console.log("Grades: First='Mikaela Ysabel' vs Doc 'MIKAELA YSABEL LINATOC':", studentNameMatchesText(gradesText, "Mikaela Ysabel", "L", "Lantafe"));
console.log("Grades: First='Mikaela Ysabel Ana' vs Doc 'MIKAELA YSABEL LINATOC':", studentNameMatchesText(gradesText, "Mikaela Ysabel Ana", "L", "Lantafe"));
