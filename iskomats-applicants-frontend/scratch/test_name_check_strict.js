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

function verifyFirstNameMatch(userFirstInput, docNameStr) {
  const normUserFirst = normalizeForOcr(userFirstInput);
  const normDocName = normalizeForOcr(docNameStr);

  let candFirstStr = docNameStr;
  let candLastStr = '';

  if (docNameStr.includes(',')) {
    const commaParts = docNameStr.split(',');
    candLastStr = commaParts[0];
    candFirstStr = commaParts.slice(1).join(' ');
  } else {
    const words = docNameStr.trim().split(/\s+/);
    if (words.length >= 2) {
      candLastStr = words[words.length - 1];
      candFirstStr = words.slice(0, words.length - 1).join(' ');
    }
  }

  const normCandFirst = normalizeForOcr(candFirstStr);
  const candFirstWords = normCandFirst.split(/\s+/).filter(w => w.length >= 2);
  const userFirstWords = normUserFirst.split(/\s+/).filter(w => w.length >= 1);

  // 1. Forward check: every word in userFirstInput MUST exist in document first name
  const forwardOk = userFirstWords.every(userW => {
    return candFirstWords.some(docW => isSimilarWord(userW, docW) || isSimilarWord(docW, userW));
  });

  // 2. Reverse check: ALL words in document first name MUST exist in userFirstInput
  const missingDocWords = candFirstWords.filter(docW => {
    return !userFirstWords.some(userW => isSimilarWord(docW, userW) || isSimilarWord(userW, docW));
  });
  const reverseOk = missingDocWords.length === 0;

  const result = forwardOk && reverseOk;
  return {
    success: result,
    forwardOk,
    reverseOk,
    missingDocWords
  };
}

const docName = "LANTAFE, MIKAELA YSABEL";

console.log("Input 'Mikaela' vs Doc 'MIKAELA YSABEL':", verifyFirstNameMatch("Mikaela", docName));
console.log("Input 'Mikaela Ysabel Ana' vs Doc 'MIKAELA YSABEL':", verifyFirstNameMatch("Mikaela Ysabel Ana", docName));
console.log("Input 'Mikaela Ysabel' vs Doc 'MIKAELA YSABEL':", verifyFirstNameMatch("Mikaela Ysabel", docName));
