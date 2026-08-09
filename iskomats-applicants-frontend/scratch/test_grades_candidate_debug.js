const gradesOcrText = `DE LA SALLE LIPA
OFFICE OF THE COLLEGE REGISTRAR
STUDENT'S FINAL GRADES
SY/Sem : 2025-2026 1st Semester Total Units Enrolled : 128
Student No : 2021305751 Total Units of Failure (0.00) : 0
Student Name : LANTAFE, MIKAELA YSABEL LINATOC Total Units of Failure (0.00) % : 0
Course : BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY Total Units of Incomplete : 0`;

function debugGradesCandidateExtraction(text) {
  let candidateNameStr = null;
  const certPatterns = [
    /(?:student\s*name|name\s*of\s*student)\s*[:\-1l\|\]\}\)]\s*([A-Za-z\s,\.\-]{3,60})(?=\s*(?:total|student|course|reg|scholarship|academic|section|units|\n|$))/i,
    /(?:certify|certifies|cently|certifye|certiy|patunay|katibayan)\s+(?:that\s+)?[_\W]*([A-Za-z\s,\.\-]{3,60})(?=\s*(?:\d+\s*years|of\s*legal\s*age|single|married|widow|separated|divorced|filipino|pilipino|citizen|is\s+a\s+resident|resident|bonafide|\n|$))/i,
    /(?:this\s+is\s+to|sto)\s+[a-z]{3,10}\s+that\s+[_\W]*([A-Za-z\s,\.\-]{3,60})(?=\s*(?:\d+\s*years|of\s*legal\s*age|single|married|widow|separated|filipino|citizen|resident|bonafide|\n|$))/i,
    /(?:name|pangalan)\s*[:\-]?\s*([A-Za-z\s,\.\-]+?)(?=\s+total|\s+reg|\s+student|\s+id|\s+course|\n|$)/i
  ];

  for (const pat of certPatterns) {
    const m = text.match(pat);
    if (m && m[1]) {
      const rawCand = m[1].replace(/^[^a-zA-Z]+/, '').trim();
      if (rawCand.length >= 3 && rawCand.includes(' ')) {
        candidateNameStr = rawCand;
        break;
      }
    }
  }

  console.log("Raw matched candidateNameStr:", JSON.stringify(candidateNameStr));

  if (candidateNameStr) {
    // Strip trailing column headers or labels before digit test
    candidateNameStr = candidateNameStr.replace(/(?:total|student|course|reg|scholarship|academic|section|units|failure|incomplete|blank|drp)[\s\S]*/i, '').trim();
  }

  console.log("Cleaned candidateNameStr (before digit check):", JSON.stringify(candidateNameStr));

  if (candidateNameStr && (/\d/.test(candidateNameStr) || /AY\s*\d|School\s*Year|Semester|1st|2nd|3rd|Official|Certificate|Registration/i.test(candidateNameStr))) {
    candidateNameStr = null;
  }

  console.log("Final candidateNameStr (after digit check):", JSON.stringify(candidateNameStr));
  return candidateNameStr;
}

debugGradesCandidateExtraction(gradesOcrText);
