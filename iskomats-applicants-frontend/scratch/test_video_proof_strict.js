function evaluateVideoProofStrict(fieldName, rawCombinedText) {
  const text = String(rawCombinedText || '').toLowerCase();

  const isCoe = fieldName?.includes('COE') || fieldName?.includes('enrollment') || fieldName?.includes('certificate') || fieldName?.includes('mayorCOE') || fieldName?.includes('cor');
  const isGrades = fieldName?.includes('Grades') || fieldName?.includes('grades') || fieldName?.includes('mayorGrades') || fieldName?.includes('reportCard');
  const isIndigency = fieldName?.includes('Indigency') || fieldName?.includes('indigency') || fieldName?.includes('Residency') || fieldName?.includes('residency');

  if (isCoe) {
    const hasCorKeywords = /certificate\s*of\s*registration|certificate\s*of\s*enrollment|certification\s*of\s*registration|official\s*receipt|registration|enrollment|\bcor\b|\bcoe\b|enrolled|units|matriculation|assessment|tuition|student\s*load|schedule\s*of\s*classes/i.test(text);
    if (!hasCorKeywords) {
      return {
        valid: false,
        isMatched: false,
        reason: "Enrollment video proof failed: Video does not contain Certificate of Registration or Enrollment keywords."
      };
    }
  }

  if (isGrades) {
    const hasGradesKeywords = /transcript\s*of\s*records?|scholastic\s*records?|student'?s?\s*final\s*grades?|final\s*grades?|report\s*card|gpa|gwa|cwa|qpi|weighted\s*average|general\s*weighted|\bgrades?\b|remarks|passed|rating|evaluation/i.test(text);
    if (!hasGradesKeywords) {
      return {
        valid: false,
        isMatched: false,
        reason: "Grades video proof failed: Video does not contain Transcript or Grades keywords."
      };
    }
  }

  if (isIndigency) {
    const hasIndigencyKeywords = /certificate\s*of\s*indigency|certificate\s*of\s*residency|punong\s*barangay|office\s*of\s*the\s*punong\s*barangay|indigent|indigency|residency|resident/i.test(text);
    if (!hasIndigencyKeywords) {
      return {
        valid: false,
        isMatched: false,
        reason: "Indigency video proof failed: Video does not contain Certificate of Indigency or Residency keywords."
      };
    }
  }

  return { valid: true, isMatched: true, reason: "Video Proof Verified" };
}

// Test cases:
const schoolIdVideoText = "[Frame at 0.5s]: DE LA SALLE LIPA STUDENT ID 2021305751 LANTAFE MIKAELA YSABEL LINATOC BSIT";
const corVideoText = "[Frame at 0.5s]: DE LA SALLE LIPA CERTIFICATE OF REGISTRATION ENROLLED 2025-2026 1ST SEMESTER TOTAL UNITS 24 BSIT";
const gradesVideoText = "[Frame at 0.5s]: DE LA SALLE LIPA STUDENT'S FINAL GRADES GPA 3.4375 TOTAL UNITS ENROLLED 128 PASSED";

console.log("School ID video uploaded for COE   :", evaluateVideoProofStrict("mayorCOE_video", schoolIdVideoText));
console.log("COR video uploaded for COE         :", evaluateVideoProofStrict("mayorCOE_video", corVideoText));
console.log("School ID video uploaded for Grades:", evaluateVideoProofStrict("mayorGrades_video", schoolIdVideoText));
console.log("Grades video uploaded for Grades   :", evaluateVideoProofStrict("mayorGrades_video", gradesVideoText));
