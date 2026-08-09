const frontText = `COLLEGE
DE LA SALLE LIPA
LANTAFE
Mikaela Ysabel L.
2021305751`;

function extractCandidateNameFromDocument(text) {
  if (!text) return null;

  // Pattern 1: Labeled names (Student Name :, Name :, Pangalan :, Certify that ...)
  const labeledPatterns = [
    /(?:student\s*name|name\s*of\s*student)\s*[:\-1l\|\]\}\)]\s*([A-Za-z\s,\.\-]{3,60})(?=\s*(?:total|student|course|reg|scholarship|academic|section|units|\n|$))/i,
    /(?:certify|certifies|cently|certifye|certiy|patunay|katibayan)\s+(?:that\s+)?[_\W]*([A-Za-z\s,\.\-]{3,60})(?=\s*(?:\d+\s*years|of\s*legal\s*age|single|married|widow|separated|divorced|filipino|pilipino|citizen|is\s+a\s+resident|resident|bonafide|\n|$))/i,
    /(?:this\s+is\s+to|sto)\s+[a-z]{3,10}\s+that\s+[_\W]*([A-Za-z\s,\.\-]{3,60})(?=\s*(?:\d+\s*years|of\s*legal\s*age|single|married|widow|separated|filipino|citizen|resident|bonafide|\n|$))/i,
    /(?:name|pangalan)\s*[:\-]?\s*([A-Za-z\s,\.\-]+?)(?=\s+total|\s+reg|\s+student|\s+id|\s+course|\n|$)/i,
    /\b([A-Za-z]{2,20}\s*,\s*[A-Za-z ]{3,40})\b/
  ];

  for (const pat of labeledPatterns) {
    const m = text.match(pat);
    if (m && m[1]) {
      const rawCand = m[1].replace(/^[^a-zA-Z]+/, '').trim();
      if (rawCand.length >= 3 && rawCand.includes(' ')) {
        return rawCand;
      }
    }
  }

  // Pattern 2: School ID Layout / Unlabeled text layout
  // Lines preceding an ID number or following university header
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const stopHeader = /COLLEGE|UNIVERSITY|DE LA SALLE|LIPA|REPUBLIC|PHILIPPINES|STUDENT|SIGNATURE|VALID|UNTIL|CHANCELLOR|REGISTRAR|SECTION|COURSE|DEGREE|YEAR|LEVEL|GRADE/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Check if line contains First + Middle/Last words (e.g. "Mikaela Ysabel L." or "Mikaela Ysabel")
    const words = line.split(/\s+/).filter(w => /^[A-Za-z\.\,]+$/.test(w));
    if (words.length >= 2 && !stopHeader.test(line)) {
      // Check if previous line is a surname (e.g. "LANTAFE")
      const prevLine = i > 0 ? lines[i - 1] : '';
      if (prevLine && /^[A-Za-z]{2,20}$/.test(prevLine) && !stopHeader.test(prevLine)) {
        return `${prevLine}, ${line}`;
      }
      return line;
    }
  }

  return null;
}

console.log("Extracted candidate from School ID text:", extractCandidateNameFromDocument(frontText));
