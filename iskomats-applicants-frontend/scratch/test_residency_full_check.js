const residencyText = "THIS IS TO CERTIFY THAT MIKAELA YSABEL L. LANTAFE IS A BONAFIDE RESIDENT OF BARANGAY INOSLUBAN LIPA CITY BATANGAS";

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

  const certPatterns = [
    /(?:certify|certifies|cently|certifye|certiy)\s+(?:that\s+)?[_\W]*([A-Za-z\s,\.\-]{3,60})(?=\s*(?:is\s+a|\d+\s*years|of\s*legal\s*age|single|married|widow|separated|divorced|filipino|pilipino|citizen|resident|bonafide|purok|barangay|\n|$))/i,
    /(?:this\s+is\s+to|sto)\s+[a-z]{3,10}\s+that\s+[_\W]*([A-Za-z\s,\.\-]{3,60})(?=\s*(?:is\s+a|\d+\s*years|of\s*legal\s*age|single|married|widow|separated|filipino|citizen|resident|bonafide|purok|barangay|\n|$))/i,
    /that\s+[_\W]*([A-Z\s,\.\-]{5,60})(?=\s*(?:is\s+a|\d+\s*years|of\s*legal\s*age|single|married|widow|separated|filipino|citizen|resident|bonafide|purok|barangay|\n|$))/i,
    /(?:^|\n|\r|\:)\s*([A-Z]{2,20}\s*,\s*[A-Z\s]{3,50})/gi,
    /(?:student\s*name|name\s*of\s*student)\s*[:\-1l\|\]\}\)]*\s*([A-Za-z\s,\.\-]{3,60})/gi,
    /(?:name|pangalan)\s*[:\-]?\s*([A-Za-z\s,\.\-]+?)/gi,
    /\b([A-Za-z]{2,20}\s*,\s*[A-Za-z ]{3,40})\b/g
  ];

  for (const pat of certPatterns) {
    const m = rawText.match(pat);
    if (m && m[1]) {
      const rawCand = m[1].replace(/^[^a-zA-Z]+/, '').trim();
      if (rawCand.length >= 3 && rawCand.includes(' ')) {
        candidateNameStr = rawCand;
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

  return candidateNameStr;
}

function studentNameMatchesText(text, first, middle, last) {
  if (!text) return { success: false, details: { first_ok: false, middle_ok: false, last_ok: false } };

  const normText = normalizeForOcr(text);
  const firstOk = checkNameWordGroup(first, normText);
  const lastOk = checkNameWordGroup(last, normText);
  const middleOk = true;

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
    const stopWords = ['mr', 'ms', 'mrs', 'student', 'name', 'certify', 'resident', 'bonafide', 'officer', 'barangay', 'office', 'reg', 'no', 'tran', 'republic', 'philippines', 'this', 'that', 'years', 'age', 'college', 'course', 'degree', 'year', 'level', 'scholarship', 'discount', 'subject', 'assessed', 'fees', 'units', 'pay', 'type', 'section', 'bldg', 'room', 'faculty', 'days', 'time', 'first', 'second', 'semester', 'sem', 'ay', 'sy', 'is', 'a'];

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

console.log("Residency: First='Mikaela' vs Doc 'MIKAELA YSABEL L. LANTAFE':", studentNameMatchesText(residencyText, "Mikaela", "", "Lantafe"));
console.log("Residency: First='Mikaela Ysabel Ana' vs Doc 'MIKAELA YSABEL L. LANTAFE':", studentNameMatchesText(residencyText, "Mikaela Ysabel Ana", "", "Lantafe"));
console.log("Residency: First='Mikaela Ysabel' vs Doc 'MIKAELA YSABEL L. LANTAFE':", studentNameMatchesText(residencyText, "Mikaela Ysabel", "", "Lantafe"));
