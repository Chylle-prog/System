const corText = `OFFICIAL CERTIFICATE OF REGISTRATION
De La Salle Lipa Certificate Of Registration
Run Date : 3/24/2026 User : Myleen Ramiro
School Year Sem : AY 2025-2026 - 2nd Semester Reg No : 38927
Student No : 2021305751 Tran Date : 12/2/2025
Name : LANTAFE, MIKAELA YSABEL LINATOC College : COLLEGE OF INFORMATION, TECHNOLOGY, AND ENGINEERING
Course : BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY
Year Level : 3rd Year
Scholarship/Discount : Pay Type : PLAN B-Colleges 2nd Sem SY25-26
Subject Units Section Bldg/Room Faculty Days Time
Itelect3 IT Elective 3 3 IT3B MB 412 S 2:30 PM - 5:30 PM
TOTAL UNITS : 27
ASSESSED FEES
TUITION FEE 41,375.00
SCHEDULE OF PAYMENTS`;

const gradesText = `DE LA SALLE LIPA
OFFICE OF THE COLLEGE REGISTRAR
STUDENT'S FINAL GRADES
SY/Sem : 2025-2026 1st Semester Total Units Enrolled : 128
Student No : 2021305751 Total Units of Failure (0.00) : 0
Student Name : LANTAFE, MIKAELA YSABEL LINATOC
Section Subject Subject Description Instructor Grade Units Posted
IT3B Ethikos Ethics Sauz, John Karlo 3.75 3.0 Y
GPA: 3.4375 Total Units: 24
GRADING SYSTEM:
98-100 - 4.00`;

function normalizeForOcr(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function isExplicitCorDoc(text) {
  if (!text) return false;
  const norm = normalizeForOcr(text);
  return (
    norm.includes('certificate of registration') ||
    norm.includes('official certificate of registration') ||
    norm.includes('certificate of enrollment') ||
    norm.includes('certification of registration') ||
    (norm.includes('assessed fees') && norm.includes('schedule of payments')) ||
    (norm.includes('tuition fee') && norm.includes('schedule of payments'))
  );
}

function isExplicitGradesDoc(text) {
  if (!text) return false;
  const norm = normalizeForOcr(text);
  return (
    norm.includes('student s final grades') ||
    norm.includes('students final grades') ||
    norm.includes('final grades') ||
    norm.includes('transcript of record') ||
    norm.includes('transcript of records') ||
    norm.includes('official transcript') ||
    norm.includes('scholastic record') ||
    norm.includes('evaluation of grades') ||
    norm.includes('report card') ||
    norm.includes('grading system') ||
    /\bgpa\b|\bgwa\b|\bcwa\b|\bqpi\b/.test(norm) ||
    (norm.includes('subject') && norm.includes('instructor') && norm.includes('grade'))
  );
}

function grades_type_matches_text(text) {
  if (!text) return false;
  const isCor = isExplicitCorDoc(text);
  const isGrades = isExplicitGradesDoc(text);

  if (isCor && !isGrades) {
    return false; // Reject COR documents uploaded for Grades requirement!
  }

  return isGrades;
}

function coe_type_matches_text(text) {
  if (!text) return false;
  const isCor = isExplicitCorDoc(text);
  const isGrades = isExplicitGradesDoc(text);

  if (isGrades && !isCor) {
    return false; // Reject Grades documents uploaded for COR requirement!
  }

  return isCor || normalizeForOcr(text).includes('enroll') || normalizeForOcr(text).includes('registration');
}

console.log("COR doc evaluated for Grades requirement:", grades_type_matches_text(corText)); // Should be FALSE
console.log("Grades doc evaluated for Grades requirement:", grades_type_matches_text(gradesText)); // Should be TRUE

console.log("COR doc evaluated for COE requirement:", coe_type_matches_text(corText)); // Should be TRUE
console.log("Grades doc evaluated for COE requirement:", coe_type_matches_text(gradesText)); // Should be FALSE
