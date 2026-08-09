const text = `DE LA SALLE LIPA
OFFICE OF THE COLLEGE REGISTRAR
STUDENT'S FINAL GRADES
SY/Sem : 2025-2026 1st Semester Total Units Enrolled : 128
Student No : 2021305751 Total Units of Failure (0.00) : 0
Student Name : LANTAFE, MIKAELA YSABEL LINATOC Total Units of Failure (0.00) % : 0
Course : BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY`;

function extractCandidateName(rawText) {
  const patterns = [
    /(?:student\s*name|name\s*of\s*student|name|pangalan)\s*[:\-1l\|\]\}\)]\s*([A-Za-z\s,\.\-]{3,60})(?=\s*(?:total|student|course|reg|scholarship|academic|section|units|\n|$))/i,
    /(?:certify|certifies|cently|certifye|certiy)\s+(?:that\s+)?[_\W]*([A-Za-z\s,\.\-]{3,60})(?=\s*(?:\d+\s*years|of\s*legal\s*age|single|married|widow|separated|divorced|filipino|pilipino|citizen|is\s+a\s+resident|resident|bonafide|\n|$))/i,
    /(?:this\s+is\s+to|sto)\s+[a-z]{3,10}\s+that\s+[_\W]*([A-Za-z\s,\.\-]{3,60})(?=\s*(?:\d+\s*years|of\s*legal\s*age|single|married|widow|separated|filipino|citizen|resident|bonafide|\n|$))/i,
    /\b([A-Za-z]{2,20}\s*,\s*[A-Za-z ]{3,40})\b/
  ];

  for (const pat of patterns) {
    const m = rawText.match(pat);
    if (m && m[1]) {
      const rawCand = m[1].replace(/^[^a-zA-Z]+/, '').trim();
      if (rawCand.length >= 3 && rawCand.includes(' ')) {
        return rawCand;
      }
    }
  }
  return null;
}

console.log("Extracted Candidate Name from Grades Text:", extractCandidateName(text));
