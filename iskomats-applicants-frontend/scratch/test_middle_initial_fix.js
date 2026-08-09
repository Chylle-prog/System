function testMiddleNameMatching(middleInput, docText) {
  if (!middleInput) return true;
  const normMid = middleInput.toLowerCase().replace(/[^a-z]/g, '');
  if (!normMid) return true;

  const normText = docText.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');

  // 1. Direct word match (e.g. "Linatoc" in "MIKAELA YSABEL LINATOC LANTAFE")
  const words = normText.split(/\s+/).filter(w => w.length >= 1);
  if (words.some(w => w === normMid || (w.length >= 4 && normMid.length >= 4 && (w.startsWith(normMid) || normMid.startsWith(w))))) {
    return true;
  }

  // 2. Initial match in either direction:
  // - Input is initial "L" or "L." matching document word "LINATOC"
  // - Input is full name "Linatoc" matching document initial "L" or "L."
  const initialChar = normMid[0];
  const hasMatchingInitial = words.some(w => {
    if (w.length === 1 && w === initialChar) return true;
    if (w.length >= 2 && w.startsWith(initialChar)) return true;
    return false;
  });

  return hasMatchingInitial;
}

const residencyDocText = "REPUBLIC OF THE PHILIPPINES PROVINCE OF BATANGAS CITY OF LIPA BARANGAY INOSLUBAN CERTIFICATE OF RESIDENCY THIS IS TO CERTIFY THAT MIKAELA YSABEL L. LANTAFE IS A BONAFIDE RESIDENT OF BARANGAY INOSLUBAN LIPA CITY BATANGAS";

console.log("Input 'Linatoc' vs Doc 'MIKAELA YSABEL L. LANTAFE':", testMiddleNameMatching("Linatoc", residencyDocText));
console.log("Input 'L.' vs Doc 'MIKAELA YSABEL LINATOC LANTAFE':", testMiddleNameMatching("L.", residencyDocText));
console.log("Input 'Santos' vs Doc 'MIKAELA YSABEL L. LANTAFE':", testMiddleNameMatching("Santos", residencyDocText));
