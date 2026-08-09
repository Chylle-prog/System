const text = "THIS IS TO CERTIFY THAT MIKAELA YSABEL L. LANTAFE IS A BONAFIDE RESIDENT OF BARANGAY INOSLUBAN LIPA CITY BATANGAS";

function testResidencyCandidate(rawText) {
  let candidateNameStr = null;
  const certPatterns = [
    /(?:certify|certifies|cently|certifye|certiy|patunay|katibayan)\s+(?:that\s+)?[_\W]*([A-Za-z\s,\.\-]{3,60})/gi,
    /(?:this\s+is\s+to|sto)\s+[a-z]{3,10}\s+that\s+[_\W]*([A-Za-z\s,\.\-]{3,60})/gi,
    /that\s+[_\W]*([A-Z\s,\.\-]{5,60})/gi
  ];

  const addressNoise = /CITY|BATANGAS|PHILIPPINES|HIGHWAY|STREET|ROAD|ADDRESS|BARANGAY|PROVINCE|TEL|TELEFAX|WWW|OFFICE|REGISTRAR|COLLEGE|UNIVERSITY/i;

  for (const pat of certPatterns) {
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

  console.log("Raw matched:", JSON.stringify(candidateNameStr));

  if (candidateNameStr) {
    candidateNameStr = candidateNameStr.replace(/(?:is\s+a\s+|bonafide|resident|indigent|citizen|filipino|single|married|widow|separated|divorced|of\s+legal\s+age|\d+\s*years|purok|barangay|bayan|lipa|batangas|punong|kagawad|seal|signature|date|issued|total|student|course|reg|scholarship|academic|section|units|failure|incomplete|blank|drp|status|pay|discount)[\s\S]*/i, '').trim();
  }

  console.log("Cleaned candidateNameStr:", JSON.stringify(candidateNameStr));
  return candidateNameStr;
}

testResidencyCandidate(text);
