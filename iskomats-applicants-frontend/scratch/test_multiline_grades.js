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
0
Scholarship
Academic Status
:
Total Units of Blank Grades
Total Units of DRP Grades
:
0
:
0`;

function testCandidateNameOnMultiline(rawText) {
  let candidateNameStr = null;
  const certPatterns = [
    /(?:student\s*name|name\s*of\s*student)\s*[:\-1l\|\]\}\)]\s*([A-Za-z\s,\.\-]{3,60})(?=\s*(?:total|student|course|reg|scholarship|academic|section|units|\n|$))/i,
    /(?:certify|certifies|cently|certifye|certiy|patunay|katibayan)\s+(?:that\s+)?[_\W]*([A-Za-z\s,\.\-]{3,60})(?=\s*(?:\d+\s*years|of\s*legal\s*age|single|married|widow|separated|divorced|filipino|pilipino|citizen|is\s+a\s+resident|resident|bonafide|\n|$))/i,
    /(?:this\s+is\s+to|sto)\s+[a-z]{3,10}\s+that\s+[_\W]*([A-Za-z\s,\.\-]{3,60})(?=\s*(?:\d+\s*years|of\s*legal\s*age|single|married|widow|separated|filipino|citizen|resident|bonafide|\n|$))/i,
    /(?:name|pangalan)\s*[:\-]?\s*([A-Za-z\s,\.\-]+?)(?=\s+total|\s+reg|\s+student|\s+id|\s+course|\n|$)/i,
    /\b([A-Za-z]{2,20}\s*,\s*[A-Za-z ]{3,40})\b/
  ];

  for (const pat of certPatterns) {
    const m = rawText.match(pat);
    console.log("Testing pattern:", pat, "-> match:", m ? m[1] : null);
    if (m && m[1]) {
      const rawCand = m[1].replace(/^[^a-zA-Z]+/, '').trim();
      if (rawCand.length >= 3 && rawCand.includes(' ')) {
        candidateNameStr = rawCand;
        break;
      }
    }
  }

  console.log("Extracted candidateNameStr:", candidateNameStr);
}

testCandidateNameOnMultiline(multilineGradesText);
