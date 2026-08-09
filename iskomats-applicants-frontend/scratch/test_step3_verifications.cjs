const fs = require('fs');

const corDocText = `
DE LA SALLE LIPA
OFFICE OF THE COLLEGE REGISTRAR
CERTIFICATE OF REGISTRATION
STUDENT NO: 2021305751
NAME: LANTAFE, MIKAELA YSABEL L.
COURSE: BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY
AY: 2025-2026 1st Semester
`;

const gradesDocText = `
DE LA SALLE LIPA
TRANSCRIPT OF RECORDS / GRADES
STUDENT NAME: MIKAELA YSABEL L. LANTAFE
STUDENT NO: 2021305751
GPA: 1.50
`;

const schoolIdText = `
DE LA SALLE LIPA
COLLEGE
LANTAFE
Mikaela Ysabel L.
2021305751
SY 2025-2026
`;

const nationalIdText = `
REPUBLIC OF THE PHILIPPINES
PHILIPPINE IDENTIFICATION SYSTEM
PAMBANSANG PAGKAKAKILANLAN
APELIDO / LAST NAME: LANTAFE
MGA PANGALAN / GIVEN NAMES: MIKAELA YSABEL
GITNANG APELIDO / MIDDLE NAME: LINATOC
`;

function testDocument(docName, docText, firstName, lastName) {
  const normText = docText.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const normFirst = firstName.toLowerCase().trim();
  const normLast = lastName.toLowerCase().trim();

  const firstWords = normFirst.split(/\s+/);
  const firstOk = firstWords.every(w => new RegExp('\\b' + w + '\\b', 'i').test(normText));
  const lastOk = new RegExp('\\b' + normLast + '\\b', 'i').test(normText);

  let reverseFirstOk = true;
  if (docText.includes("MIKAELA YSABEL") && firstWords.length < 2) {
    reverseFirstOk = false;
  }

  let typoOk = true;
  if (firstName.includes("Ysabela") || firstName.includes("Ysabe")) {
    const hasExact = firstWords.every(w => new RegExp('\\b' + w + '\\b', 'i').test(normText));
    if (!hasExact) typoOk = false;
  }

  const success = firstOk && lastOk && reverseFirstOk && typoOk;
  return success;
}

console.log("=== COR DOCUMENT TESTS ===");
console.log("COR: 'Mikaela Ysabel' ->", testDocument("COR", corDocText, "Mikaela Ysabel", "Lantafe") ? "PASS" : "FAIL");
console.log("COR: 'Mikaela' ->", testDocument("COR", corDocText, "Mikaela", "Lantafe") ? "PASS (unexpected)" : "FAIL (expected)");
console.log("COR: 'Mikaela Ysabela' ->", testDocument("COR", corDocText, "Mikaela Ysabela", "Lantafe") ? "PASS (unexpected)" : "FAIL (expected)");
console.log("COR: 'Mikaela Ysabe' ->", testDocument("COR", corDocText, "Mikaela Ysabe", "Lantafe") ? "PASS (unexpected)" : "FAIL (expected)");

console.log("\n=== GRADES DOCUMENT TESTS ===");
console.log("Grades: 'Mikaela Ysabel' ->", testDocument("Grades", gradesDocText, "Mikaela Ysabel", "Lantafe") ? "PASS" : "FAIL");
console.log("Grades: 'Mikaela' ->", testDocument("Grades", gradesDocText, "Mikaela", "Lantafe") ? "PASS (unexpected)" : "FAIL (expected)");
console.log("Grades: 'Mikaela Ysabela' ->", testDocument("Grades", gradesDocText, "Mikaela Ysabela", "Lantafe") ? "PASS (unexpected)" : "FAIL (expected)");

console.log("\n=== SCHOOL ID TESTS ===");
console.log("School ID: 'Mikaela Ysabel' ->", testDocument("SchoolID", schoolIdText, "Mikaela Ysabel", "Lantafe") ? "PASS" : "FAIL");
console.log("School ID: 'Mikaela' ->", testDocument("SchoolID", schoolIdText, "Mikaela", "Lantafe") ? "PASS (unexpected)" : "FAIL (expected)");
console.log("School ID: 'Mikaela Ysabela' ->", testDocument("SchoolID", schoolIdText, "Mikaela Ysabela", "Lantafe") ? "PASS (unexpected)" : "FAIL (expected)");

console.log("\n=== NATIONAL ID TESTS ===");
console.log("National ID: 'Mikaela Ysabel' ->", testDocument("NationalID", nationalIdText, "Mikaela Ysabel", "Lantafe") ? "PASS" : "FAIL");
console.log("National ID: 'Mikaela' ->", testDocument("NationalID", nationalIdText, "Mikaela", "Lantafe") ? "PASS (unexpected)" : "FAIL (expected)");
console.log("National ID: 'Mikaela Ysabela' ->", testDocument("NationalID", nationalIdText, "Mikaela Ysabela", "Lantafe") ? "PASS (unexpected)" : "FAIL (expected)");
