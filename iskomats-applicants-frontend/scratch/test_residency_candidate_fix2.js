const text = "THIS IS TO CERTIFY THAT MIKAELA YSABEL L. LANTAFE IS A BONAFIDE RESIDENT OF BARANGAY INOSLUBAN LIPA CITY BATANGAS";

function testResidencyCandidateFixed(rawText) {
  let candidateNameStr = null;

  const certPatterns = [
    /(?:certify|certifies|cently|certifye|certiy|patunay|katibayan)\s+(?:that\s+)?[_\W]*([A-Za-z\s,\.\-]{3,60})(?=\s*(?:is\s+a|\d+\s*years|of\s*legal\s*age|single|married|widow|separated|divorced|filipino|pilipino|citizen|resident|bonafide|purok|barangay|\n|$))/i,
    /(?:this\s+is\s+to|sto)\s+[a-z]{3,10}\s+that\s+[_\W]*([A-Za-z\s,\.\-]{3,60})(?=\s*(?:is\s+a|\d+\s*years|of\s*legal\s*age|single|married|widow|separated|filipino|citizen|resident|bonafide|purok|barangay|\n|$))/i,
    /that\s+[_\W]*([A-Z\s,\.\-]{5,60})(?=\s*(?:is\s+a|\d+\s*years|of\s*legal\s*age|single|married|widow|separated|filipino|citizen|resident|bonafide|purok|barangay|\n|$))/i
  ];

  for (const pat of certPatterns) {
    const m = rawText.match(pat);
    if (m && m[1]) {
      const rawCand = m[1].replace(/^[^a-zA-Z]+/, '').trim();
      if (rawCand.length >= 3 && rawCand.includes(' ')) {
        candidateNameStr = rawCand;
        break;
      }
    }
  }

  console.log("Raw matched:", JSON.stringify(candidateNameStr));

  if (candidateNameStr) {
    candidateNameStr = candidateNameStr.replace(/(?:is\s+a\s+|bonafide|resident|indigent|citizen|filipino|single|married|widow|separated|divorced|of\s+legal\s+age|\d+\s*years|purok|barangay|bayan|lipa|batangas|punong|kagawad|seal|signature|date|issued|total|student|course|reg|scholarship|academic|section|units|failure|incomplete|blank|drp|status|pay|discount)[\s\S]*/i, '').trim();
  }

  console.log("Cleaned candidateNameStr:", JSON.stringify(candidateNameStr));
  return candidateNameStr;
}

testResidencyCandidateFixed(text);
