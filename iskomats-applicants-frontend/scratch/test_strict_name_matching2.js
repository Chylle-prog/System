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
    .replace(/u/g, 'v');
}

function isSimilarWordStrict(expected, actual) {
  if (!expected || !actual) return false;
  const expNorm = expected.toLowerCase().trim();
  const actNorm = actual.toLowerCase().trim();

  // 1. Exact case-insensitive match
  if (expNorm === actNorm) return true;

  // 2. Exact length match with common OCR digit/symbol substitutions (e.g. 1 -> i, l -> i)
  // MUST have the exact same length (no extra or missing letters allowed!)
  if (expNorm.length === actNorm.length) {
    const expConf = normalizeNameConfusions(expNorm);
    const actConf = normalizeNameConfusions(actNorm);
    if (expConf && expConf === actConf) return true;
  }

  return false;
}

console.log("Mikaela vs Mikaela:", isSimilarWordStrict("Mikaela", "Mikaela"));
console.log("Ysabel vs Ysabel:", isSimilarWordStrict("Ysabel", "Ysabel"));
console.log("Ysabela vs Ysabel (extra letter 'a'):", isSimilarWordStrict("Ysabela", "Ysabel"));
console.log("Ysabe vs Ysabel (missing letter 'l'):", isSimilarWordStrict("Ysabe", "Ysabel"));
console.log("Mikae1a vs Mikaela (OCR 1 for l):", isSimilarWordStrict("Mikae1a", "Mikaela"));
