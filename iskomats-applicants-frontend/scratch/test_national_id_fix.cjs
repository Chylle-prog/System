function extractNationalIdCandidate(text) {
  let candidateNameStr = null;

  const certPatterns = [
    /(?:given\s*names|mga\s*pangalan|first\s*name)\s*[:\-\/]*\s*([A-Za-z\s,\.\-]{3,60})/gi,
    /(?:certify|certifies|cently|certifye|certiy)\s+(?:that\s+)?[_\W]*([A-Za-z\s,\.\-]{3,60})/gi,
    /(?:this\s+is\s+to|sto)\s+[a-z]{3,10}\s+that\s+[_\W]*([A-Za-z\s,\.\-]{3,60})/gi,
    /that\s+[_\W]*([A-Z\s,\.\-]{5,60})/gi,
    /(?:^|\n|\r|\:)\s*([A-Z]{2,20}\s*,\s*[A-Z\s]{3,50})/gi,
    /(?:student\s*name|name\s*of\s*student)\s*[:\-1l\|\]\}\)]*\s*([A-Za-z\s,\.\-]{3,60})/gi,
    /(?:name|pangalan)\s*[:\-]?\s*([A-Za-z\s,\.\-]+?)/gi,
    /\b([A-Za-z]{2,20}\s*,\s*[A-Za-z ]{3,40})\b/g
  ];

  for (const pat of certPatterns) {
    let match;
    while ((match = pat.exec(text)) !== null) {
      if (match && match[1]) {
        let rawCand = match[1].replace(/^[^a-zA-Z]+/, '').trim();
        rawCand = rawCand.replace(/^(?:mga\s*pangalan|given\s*names|apelido|last\s*name|middle\s*name|gitnang\s*apelido)[\s:\-\/]*/i, '').trim();
        if (rawCand.length >= 3 && rawCand.includes(' ')) {
          candidateNameStr = rawCand;
          break;
        }
      }
    }
    if (candidateNameStr) break;
  }

  return candidateNameStr;
}

const nationalIdText = `
REPUBLIC OF THE PHILIPPINES
PHILIPPINE IDENTIFICATION SYSTEM
PAMBANSANG PAGKAKAKILANLAN
APELIDO / LAST NAME: LANTAFE
MGA PANGALAN / GIVEN NAMES: MIKAELA YSABEL
GITNANG APELIDO / MIDDLE NAME: LINATOC
`;

console.log("Extracted candidate from National ID:", extractNationalIdCandidate(nationalIdText));
