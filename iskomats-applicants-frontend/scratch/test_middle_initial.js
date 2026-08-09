function normalizeForOcr(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function checkMiddleOk(middleInput, targetText) {
  if (!middleInput) return true;
  const normMiddle = normalizeForOcr(middleInput);
  if (!normMiddle) return true;

  const normTarget = normalizeForOcr(targetText);
  const targetWords = normTarget.split(/\s+/).filter(w => w.length >= 1);

  // 1. Direct word match (e.g. "Linatoc" in targetText)
  if (targetWords.includes(normMiddle) || normTarget.includes(normMiddle)) {
    return true;
  }

  // 2. Initial prefix match (e.g. middleInput "L." / "L" matching "Linatoc")
  if (normMiddle.length <= 2) {
    const initial = normMiddle[0];
    if (targetWords.some(w => w.startsWith(initial))) {
      return true;
    }
  }

  return false;
}

console.log("Middle 'L.' vs 'LANTAFE MIKAELA YSABEL LINATOC':", checkMiddleOk("L.", "LANTAFE MIKAELA YSABEL LINATOC"));
console.log("Middle 'Linatoc' vs 'LANTAFE MIKAELA YSABEL LINATOC':", checkMiddleOk("Linatoc", "LANTAFE MIKAELA YSABEL LINATOC"));
console.log("Middle 'O.' vs 'MAGBUHAT ALEXIE CHYLE ORTEGA':", checkMiddleOk("O.", "MAGBUHAT ALEXIE CHYLE ORTEGA"));
