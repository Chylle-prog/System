function gpaMatchesTextSuperStrict(detectedGpaStr, expectedGpaStr) {
  if (!detectedGpaStr || !expectedGpaStr) return false;

  const rawInputStr = String(expectedGpaStr).trim();
  const parsedInputGpa = parseFloat(rawInputStr.replace(/[^0-9.]/g, ''));
  if (isNaN(parsedInputGpa)) return false;

  const detVal = parseFloat(detectedGpaStr);
  if (isNaN(detVal)) return false;

  // 1. Exact numeric equality (e.g. 3.4375 === 3.4375, 3.44 === 3.4400)
  if (Math.abs(detVal - parsedInputGpa) < 0.00001) {
    return true;
  }

  // 2. Standard mathematical rounding to input's decimal precision
  const inputDecParts = rawInputStr.split('.');
  const inputDecCount = inputDecParts.length > 1 ? inputDecParts[1].length : 0;

  if (inputDecCount > 0) {
    const factor = Math.pow(10, inputDecCount);
    const roundedDetVal = Math.round(detVal * factor) / factor;
    if (Math.abs(roundedDetVal - parsedInputGpa) < 0.00001) {
      return true;
    }
  }

  return false;
}

// Test cases:
console.log("Doc 3.4375 vs Input 3.43  :", gpaMatchesTextSuperStrict("3.4375", "3.43"));   // MUST BE FALSE
console.log("Doc 3.4375 vs Input 3.44  :", gpaMatchesTextSuperStrict("3.4375", "3.44"));   // MUST BE TRUE
console.log("Doc 3.4375 vs Input 3.4375:", gpaMatchesTextSuperStrict("3.4375", "3.4375")); // MUST BE TRUE
console.log("Doc 3.4513 vs Input 3.4512:", gpaMatchesTextSuperStrict("3.4513", "3.4512")); // MUST BE FALSE
console.log("Doc 3.4513 vs Input 3.4513:", gpaMatchesTextSuperStrict("3.4513", "3.4513")); // MUST BE TRUE
console.log("Doc 3.4513 vs Input 3.45  :", gpaMatchesTextSuperStrict("3.4513", "3.45"));   // MUST BE TRUE (3.4513 rounded to 2 decimals is 3.45)
console.log("Doc 3.4513 vs Input 3.46  :", gpaMatchesTextSuperStrict("3.4513", "3.46"));   // MUST BE FALSE
