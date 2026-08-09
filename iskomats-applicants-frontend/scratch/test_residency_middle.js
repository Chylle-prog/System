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

  const success = firstOk && reverseFirstOk && lastOk && reverseLastOk && middleOk;
  return { success, details: { first_ok: firstOk && reverseFirstOk, middle_ok: middleOk, last_ok: lastOk && reverseLastOk } };
}

const residencyDocText = "REPUBLIC OF THE PHILIPPINES PROVINCE OF BATANGAS CITY OF LIPA BARANGAY INOSLUBAN CERTIFICATE OF RESIDENCY THIS IS TO CERTIFY THAT MIKAELA YSABEL L. LANTAFE IS A BONAFIDE RESIDENT OF BARANGAY INOSLUBAN LIPA CITY BATANGAS";

console.log("Residency test with middle='Linatoc':", studentNameMatchesText(residencyDocText, "Mikaela Ysabel", "Linatoc", "Lantafe"));
console.log("Residency test with middle='L':", studentNameMatchesText(residencyDocText, "Mikaela Ysabel", "L", "Lantafe"));
console.log("Residency test with middle='':", studentNameMatchesText(residencyDocText, "Mikaela Ysabel", "", "Lantafe"));
