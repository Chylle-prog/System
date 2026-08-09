const text = `
REPUBLIC OF THE PHILIPPINES
PHILIPPINE IDENTIFICATION SYSTEM
PAMBANSANG PAGKAKAKILANLAN
APELIDO / LAST NAME: LANTAFE
MGA PANGALAN / GIVEN NAMES: MIKAELA YSABEL
GITNANG APELIDO / MIDDLE NAME: LINATOC
`;

function extractOcrKeyValues(rawText) {
  const result = {};
  if (!rawText) return result;

  // National ID / PhilSys field anchors
  const philsysFirstMatch = rawText.match(/(?:mga\s*pangalan|given\s*names?)\s*[:\-\/]*\s*([A-Za-z\s]{2,50})/i);
  if (philsysFirstMatch && philsysFirstMatch[1]) {
    result.first = philsysFirstMatch[1].trim();
  }

  const philsysLastMatch = rawText.match(/(?:apelido|last\s*name|surname)\s*[:\-\/]*\s*([A-Za-z\s]{2,50})/i);
  if (philsysLastMatch && philsysLastMatch[1]) {
    result.last = philsysLastMatch[1].trim();
  }

  if (result.first && result.last) {
    result.name = `${result.last}, ${result.first}`;
  }

  return result;
}

console.log("Extracted Key-Values from National ID:", extractOcrKeyValues(text));
