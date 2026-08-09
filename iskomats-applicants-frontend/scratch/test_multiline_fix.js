const multilineGradesText = `DE LA SALLE LIPA
OFFICE OF THE COLLEGE REGISTRAR
1962 J.P. Laurel National Highway 4217 Lipa City, Batangas Philippines
Tel. (+63 43) 756 5555 loc 222 Telefax (+63 43) 981 1781
www.disi.edu.ph
STUDENT'S FINAL GRADES
SY/Sem
Student No
: 2025-2026 1st Semester
Total Units Enrolled
:
128
: 2021305751
Student Name
Course
: LANTAFE, MIKAELA YSABEL LINATOC
Total Units of Failure (0.00)
Total Units of Failure (0.00) %
:
0
0
: BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY
Total Units of Incomplete
:
0`;

function testFixedCandidateExtraction(rawText) {
  let candidateNameStr = null;

  const patterns = [
    // 1. Colon prefix comma format: ": LANTAFE, MIKAELA YSABEL LINATOC"
    /(?:^|\n|\r|\:)\s*([A-Z]{2,20}\s*,\s*[A-Z\s]{3,50})/g,
    // 2. Labeled student name: "Student Name : LANTAFE, MIKAELA..."
    /(?:student\s*name|name\s*of\s*student|name|pangalan)\s*[:\-1l\|\]\}\)]*\s*([A-Za-z\s,\.\-]{3,60})/gi,
    // 3. Certify pattern
    /(?:certify|certifies|cently|certifye|certiy|patunay|katibayan)\s+(?:that\s+)?[_\W]*([A-Za-z\s,\.\-]{3,60})/gi,
    // 4. Any "SURNAME, FIRSTNAME" format excluding address stop words
    /\b([A-Za-z]{2,20}\s*,\s*[A-Za-z ]{3,40})\b/g
  ];

  const addressNoise = /CITY|BATANGAS|PHILIPPINES|HIGHWAY|STREET|ROAD|ADDRESS|BARANGAY|PROVINCE|TEL|TELEFAX|WWW|OFFICE|REGISTRAR|COLLEGE|UNIVERSITY/i;

  for (const pat of patterns) {
    let match;
    while ((match = pat.exec(rawText)) !== null) {
      if (match && match[1]) {
        const rawCand = match[1].replace(/^[^a-zA-Z]+/, '').trim();
        if (rawCand.length >= 3 && rawCand.includes(' ') && !addressNoise.test(rawCand)) {
          candidateNameStr = rawCand;
          break;
        }
      }
    }
    if (candidateNameStr) break;
  }

  console.log("Extracted Candidate Name:", JSON.stringify(candidateNameStr));
  return candidateNameStr;
}

testFixedCandidateExtraction(multilineGradesText);
