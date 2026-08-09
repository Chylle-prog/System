const text = `
REPUBLIC OF THE PHILIPPINES
PHILIPPINE IDENTIFICATION SYSTEM
PAMBANSANG PAGKAKAKILANLAN
APELIDO / LAST NAME: LANTAFE
MGA PANGALAN / GIVEN NAMES: MIKAELA YSABEL
GITNANG APELIDO / MIDDLE NAME: LINATOC
`;

function extractOcrKeyValuesFixed(rawText) {
  const result = {};
  if (!rawText) return result;

  const philsysFirstMatch = rawText.match(/(?:mga\s*pangalan\s*[\/\-]\s*given\s*names?|given\s*names?|mga\s*pangalan|first\s*name)\s*[:\-\/]*\s*([A-Za-z\s]{2,50})/i);
  if (philsysFirstMatch && philsysFirstMatch[1]) {
    let val = philsysFirstMatch[1].replace(/^(?:mga\s*pangalan|given\s*names?|[\/\-\:\s])+/i, '').trim();
    val = val.replace(/(?:gitnang|middle|apelido|last|name|sex|date|birth)[\s\S]*/i, '').trim();
    result.first = val;
  }

  const philsysLastMatch = rawText.match(/(?:apelido\s*[\/\-]\s*last\s*name|last\s*name|surname|apelido)\s*[:\-\/]*\s*([A-Za-z\s]{2,50})/i);
  if (philsysLastMatch && philsysLastMatch[1]) {
    let val = philsysLastMatch[1].replace(/^(?:apelido|last\s*name|surname|[\/\-\:\s])+/i, '').trim();
    val = val.replace(/(?:mga|pangalan|given|middle|gitnang|sex|date|birth)[\s\S]*/i, '').trim();
    result.last = val;
  }

  if (result.first && result.last) {
    result.name = `${result.last}, ${result.first}`;
  }

  return result;
}

console.log("Extracted Key-Values from National ID:", extractOcrKeyValuesFixed(text));
