function extractGpaFromTextRaw(text, expectedGpa) {
  if (!text) return null;
  const cleaned = String(text).replace(/\r/g, '');
  const cleanedLines = cleaned.split(/[\r\n]+/).filter(l => !/laurel|highway|telefax|1962|lipa\s*city|national\s*h|j\.?p\.?/i.test(l));
  const cleanedBodyText = cleanedLines.join('\n');

  // 1. Explicit keyword match (supports "GPA: 3.4375", "GPA: 3.44", etc.)
  for (const rawLine of cleanedLines) {
    if (/(?:GPA|GWA|CWA|QPI|WEIGHTED\s*AVERAGE|GENERAL\s*WEIGHTED|FINAL\s*AVERAGE)/i.test(rawLine)) {
      const kwMatch = rawLine.match(/(?:GPA|GWA|CWA|QPI|WEIGHTED\s*AVERAGE|GENERAL\s*WEIGHTED|FINAL\s*AVERAGE)[^\d]*?([1-5](?:[\.,][0-9]{1,4}|[0-9]{2,5}))\b/i);
      if (kwMatch && kwMatch[1]) {
        const rawVal = kwMatch[1].replace(',', '.');
        if (rawVal.includes('.')) {
          const val = parseFloat(rawVal);
          if (!isNaN(val) && val >= 1.0 && val <= 5.0) return rawVal;
        } else if (rawVal.length >= 3 && rawVal.length <= 5) {
          const rawFormatted = rawVal[0] + '.' + rawVal.slice(1);
          const val = parseFloat(rawFormatted);
          if (!isNaN(val) && val >= 1.0 && val <= 5.0) return rawFormatted;
        }
      }
    }
  }

  // 2. High-precision 4-decimal place term GPA on body text (e.g. 3.4375)
  const precisionMatch = cleanedBodyText.match(/\b([1-5]\.[0-9]{3,4})\b/);
  if (precisionMatch && precisionMatch[1]) {
    const val = parseFloat(precisionMatch[1]);
    if (!isNaN(val) && val >= 1.0 && val <= 5.0) return precisionMatch[1];
  }

  // 3. Value immediately before "Total Units" table footer
  const pUnits = cleanedBodyText.match(/([1-5](?:\.[0-9]{1,4}|[0-9]{2,4}))\s*[:\-=.,|\s]*(?:Total\s*Units?|Units?)/i);
  if (pUnits && pUnits[1]) {
    const rawVal = pUnits[1];
    const rawFormatted = rawVal.includes('.') ? rawVal : rawVal[0] + '.' + rawVal.slice(1);
    const val = parseFloat(rawFormatted);
    if (!isNaN(val) && val >= 1.0 && val <= 5.0) return rawFormatted;
  }

  // Fallback: 2-decimal GPA match
  const twoDecMatch = cleanedBodyText.match(/\b([1-5]\.[0-9]{1,2})\b/);
  if (twoDecMatch && twoDecMatch[1]) {
    const val = parseFloat(twoDecMatch[1]);
    if (!isNaN(val) && val >= 1.0 && val <= 5.0) return twoDecMatch[1];
  }

  return null;
}

function gpaMatchesTextStrict(text, expectedGpa) {
  if (!text) return false;
  if (!expectedGpa) return true;

  const rawInputStr = String(expectedGpa).trim();
  const parsedInputGpa = parseFloat(rawInputStr.replace(/[^0-9.]/g, ''));
  if (isNaN(parsedInputGpa)) return true;

  const detectedGpaStr = extractGpaFromTextRaw(text, expectedGpa);
  if (detectedGpaStr === null) return false;

  const detVal = parseFloat(detectedGpaStr);
  if (isNaN(detVal)) return false;

  // 1. Exact numeric equality (e.g. 3.44 === 3.4400)
  if (Math.abs(detVal - parsedInputGpa) < 0.00001) {
    return true;
  }

  // Determine decimal precision of input string
  const inputDecParts = rawInputStr.split('.');
  const inputDecCount = inputDecParts.length > 1 ? inputDecParts[1].length : 0;

  if (inputDecCount > 0) {
    // 2. Truncation match: truncate document GPA to input's decimal count without rounding up
    const detDecParts = detectedGpaStr.split('.');
    if (detDecParts.length > 1) {
      const truncatedDetStr = detDecParts[0] + '.' + detDecParts[1].slice(0, inputDecCount);
      const truncatedDetVal = parseFloat(truncatedDetStr);
      if (!isNaN(truncatedDetVal) && Math.abs(truncatedDetVal - parsedInputGpa) < 0.00001) {
        return true;
      }
    }

    // 3. Rounded match: round document GPA to input's decimal count
    const factor = Math.pow(10, inputDecCount);
    const roundedDetVal = Math.round(detVal * factor) / factor;
    if (Math.abs(roundedDetVal - parsedInputGpa) < 0.00001) {
      return true;
    }
  }

  return false;
}

// Test scenarios:
const sampleText1 = "GPA: 3.4375 Total Units: 24";
const sampleText2 = "GPA: 3.4513 Total Units: 24";

console.log("--- TEST CASES ---");
console.log("Doc GPA 3.4375 vs Input 3.4375:", gpaMatchesTextStrict(sampleText1, "3.4375")); // TRUE
console.log("Doc GPA 3.4375 vs Input 3.43:", gpaMatchesTextStrict(sampleText1, "3.43"));     // TRUE (truncated)
console.log("Doc GPA 3.4375 vs Input 3.44:", gpaMatchesTextStrict(sampleText1, "3.44"));     // TRUE (rounded)
console.log("Doc GPA 3.4513 vs Input 3.4512:", gpaMatchesTextStrict(sampleText2, "3.4512")); // FALSE (strict mismatch)
console.log("Doc GPA 3.4513 vs Input 3.4513:", gpaMatchesTextStrict(sampleText2, "3.4513")); // TRUE
console.log("Doc GPA 3.4513 vs Input 3.45:", gpaMatchesTextStrict(sampleText2, "3.45"));     // TRUE
console.log("Doc GPA 3.4513 vs Input 3.46:", gpaMatchesTextStrict(sampleText2, "3.46"));     // FALSE
