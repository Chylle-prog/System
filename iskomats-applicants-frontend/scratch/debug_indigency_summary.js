function isSimilarWord(expected, actual) {
  if (!expected || !actual) return false;
  const expNorm = expected.toLowerCase().trim();
  const actNorm = actual.toLowerCase().trim();
  if (expNorm === actNorm) return true;
  return false;
}

function checkReverseLast(last, normCandLast) {
  const stopWords = ['mr', 'ms', 'mrs', 'student', 'name', 'certify', 'resident', 'bonafide', 'officer', 'barangay', 'office', 'reg', 'no', 'tran', 'republic', 'philippines', 'this', 'that', 'years', 'age', 'college', 'course', 'degree', 'year', 'level', 'scholarship', 'discount', 'subject', 'assessed', 'fees', 'units', 'pay', 'type', 'section', 'bldg', 'room', 'faculty', 'days', 'time', 'first', 'second', 'semester', 'sem', 'ay', 'sy'];

  let inputLastIsStopWord = false;
  if (last) {
    const cleanInputLast = last.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
    if (stopWords.includes(cleanInputLast) || /^\d+$/.test(cleanInputLast)) {
      inputLastIsStopWord = true;
    }
  }

  let reverseLastOk = true;
  if (normCandLast && normCandLast.length >= 2 && !stopWords.includes(normCandLast.toLowerCase())) {
    const userInputLastNorm = (last || '').toLowerCase().trim();
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

  const finalLastOk = reverseLastOk && !inputLastIsStopWord;
  return { reverseLastOk, inputLastIsStopWord, finalLastOk };
}

console.log("Test 'age' vs 'LANTAFE':", checkReverseLast("age", "lantafe"));
console.log("Test 'Santos' vs 'LANTAFE':", checkReverseLast("Santos", "lantafe"));
console.log("Test 'Lantafe' vs 'LANTAFE':", checkReverseLast("Lantafe", "lantafe"));
