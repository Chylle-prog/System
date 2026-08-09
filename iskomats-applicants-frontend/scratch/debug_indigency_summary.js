function extractOcrKeyValues(rawText) {
  if (!rawText) return {};
  const lines = String(rawText).split(/\r?\n/);
  const fields = {};

  const rightLabelRegex = /\s+(?=(?:Reg\s*No|Tran\s*Date|College|Pay\s*Type|User|Run\s*Date|Scholarship|Discount|Ref\s*No|Status|Section|Bldg\/Room)\s*[:\-])/i;
  const splitLines = [];
  for (const line of lines) {
    const parts = line.split(rightLabelRegex);
    for (const p of parts) {
      if (p.trim()) splitLines.push(p.trim());
    }
  }

  const labelMap = {
    name: [
      /name\s*[:\-1l\|\]\}\)]\s*(.+)/i,
      /student\s*name\s*[:\-1l\|\]\}\)]\s*(.+)/i,
      /name\s*of\s*student\s*[:\-1l\|\]\}\)]\s*(.+)/i,
      /pangalan\s*[:\-1l\|\]\}\)]\s*(.+)/i,
      /^name\s*[:\-]\s*(.+)/i
    ],
  };

  for (const line of splitLines) {
    for (const [key, regexes] of Object.entries(labelMap)) {
      if (fields[key]) continue;
      for (const regex of regexes) {
        const match = line.match(regex);
        if (match && match[1] && match[1].trim().length > 0) {
          let val = match[1].trim();
          val = val.replace(/\s+(?:Reg|Tran|College|Pay|User|Scholarship|Discount|Ref)\s*[:\-].*/i, '').trim();
          if (val.length > 0) {
            if (key === 'name' && (/\d/.test(val) || /AY\s*\d|School\s*Year|Semester|1st|2nd|3rd|Official|Certificate|Registration/i.test(val))) {
              continue;
            }
            fields[key] = val;
            break;
          }
        }
      }
    }
  }
  if (!fields.name) {
    // Restrict fnMatch to single-line spaces (no \n) and filter out noise keywords
    const fnMatch = rawText.match(/\b([A-Za-z]{2,20}\s*,\s*[A-Za-z ]{3,40})\b/);
    if (fnMatch && fnMatch[1]) {
      const cand = fnMatch[1].trim();
      const isNoise = /OFFICIAL|CERTIFICATE|REGISTRATION|COLLEGE|UNIVERSITY|ENGINEERING|INFORMATION|BACHELOR|CERTIFY|AGE|RESIDENT|BARANGAY/i.test(cand);
      if (!isNoise) {
        fields.name = cand;
      }
    }
  }
  return fields;
}

function formatExtractedRequirementsSummary(rawText) {
  if (!rawText) return "";

  let nameSearchText = rawText;
  const frontIdSectionMatch = rawText.match(/\[(?:FRONT ID TEXT|NATIONAL ID FRONT TEXT)\]\s*([\s\S]*?)(?=\n\n\[|$)/i);
  if (frontIdSectionMatch && frontIdSectionMatch[1]) {
    nameSearchText = frontIdSectionMatch[1];
  }

  const kv = extractOcrKeyValues(nameSearchText);

  let fullName = kv.name;

  if (!fullName) {
    const indigencyAnchorPatterns = [
      /(?:certify|certifies|patunay|katibayan|pinatutunayan)\s+(?:that\s+|na\s+si\s+)?[_\W]*([A-Za-z][A-Za-z\s,\.\-]{3,60})(?=\s*(?:\d+\s*years?|of\s*legal\s*age|single|married|widow|separated|divorced|filipino|pilipino|citizen|is\s+a\s+resident|resident|bonafide|\n|$))/i,
      /(?:this\s+is\s+to\s+certify\s+that|sto\s+certify\s+that)\s+[_\W]*([A-Za-z][A-Za-z\s,\.\-]{3,60})(?=\s*(?:\d+\s*years?|of\s*legal\s*age|single|married|widow|separated|filipino|citizen|resident|bonafide|\n|$))/i
    ];
    for (const pat of indigencyAnchorPatterns) {
      const m = nameSearchText.match(pat);
      if (m && m[1]) {
        let raw = m[1].trim()
          .replace(/^(?:this\s+is\s+to\s+|sto\s+)?(?:certify|certifies|patunay|katibayan|pinatutunayan)\s*(?:that|na\s+si)?\s*/i, '')
          .replace(/^(?:this\s+is\s+to\s+certify\s+that|sto\s+certify\s+that|certify\s+that|pinatutunayan\s+na\s+si)\s*/i, '')
          .replace(/^[^a-zA-Z]+/, '')
          .replace(/\s*(?:\d+\s*)?(?:years?\s*of\s*age|of\s*legal\s*age|years?\s*old|years?|yr|yo|taong|age)\b.*$/i, '')
          .replace(/\s*(?:single|married|widow(?:er)?|separated|divorced|filipino(?:\s*citizen)?|pilipino(?:\s*citizen)?|citizen)\b.*$/i, '')
          .replace(/\s*(?:is\s+a\s+resident|is\s+a\s+bonafide|resident|bonafide)\b.*$/i, '')
          .trim();
        if (raw.length >= 3 && /\s/.test(raw) && !/certify|certificate|barangay|office|republic|philippines|punong/i.test(raw)) {
          fullName = raw;
          break;
        }
      }
    }
  }

  let firstName = "Not detected";
  let middleName = "Not detected";
  let lastName = "Not detected";

  if (fullName && fullName !== "Not detected") {
    let clean = fullName.trim();
    if (clean.includes(',')) {
      const parts = clean.split(',').map(s => s.trim());
      lastName = parts[0] || "Not detected";
      const rest = (parts[1] || '').split(/\s+/).filter(Boolean);
      if (rest.length >= 2) {
        const lastToken = rest[rest.length - 1];
        if (/^[A-Za-z]\.?$/.test(lastToken)) {
          middleName = lastToken.replace('.', '');
          firstName = rest.slice(0, rest.length - 1).join(' ');
        } else {
          firstName = rest.join(' ');
          middleName = "N/A";
        }
      } else if (rest.length === 1) {
        firstName = rest[0];
        middleName = "N/A";
      }
    } else {
      let words = clean.split(/\s+/).filter(Boolean);

      const nameNoiseWords = [
        'age', 'years', 'year', 'yr', 'yo', 'of', 'legal', 'taong', 'gulang',
        'single', 'married', 'widow', 'widower', 'separated', 'divorced',
        'filipino', 'pilipino', 'citizen', 'resident', 'bonafide', 'residing',
        'this', 'is', 'to', 'certify', 'that', 'sto', 'certifies', 'patunay',
        'katibayan', 'pinatutunayan', 'na', 'si', 'the', 'a', 'and'
      ];

      while (words.length > 0) {
        const lastW = words[words.length - 1].toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!lastW || nameNoiseWords.includes(lastW) || /^\d+$/.test(lastW)) {
          words.pop();
        } else {
          break;
        }
      }

      while (words.length > 0) {
        const firstW = words[0].toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!firstW || nameNoiseWords.includes(firstW)) {
          words.shift();
        } else {
          break;
        }
      }

      if (words.length >= 3) {
        lastName = words[words.length - 1];
        const potentialMiddle = words[words.length - 2];
        if (/^[A-Za-z]\.?$/.test(potentialMiddle)) {
          middleName = potentialMiddle.replace('.', '');
          firstName = words.slice(0, words.length - 2).join(' ');
        } else {
          firstName = words.slice(0, words.length - 1).join(' ');
          middleName = "N/A";
        }
      } else if (words.length === 2) {
        firstName = words[0];
        lastName = words[1];
        middleName = "N/A";
      } else if (words.length === 1) {
        firstName = words[0];
      }
    }

    const certStopWords = ['this', 'is', 'to', 'certify', 'that', 'sto', 'certifies', 'patunay', 'katibayan', 'pinatutunayan', 'na', 'si', 'the', 'of', 'a'];
    if (firstName && firstName !== "Not detected") {
      const cleanFirst = firstName.split(/\s+/).filter(w => !certStopWords.includes(w.toLowerCase())).join(' ');
      if (cleanFirst) firstName = cleanFirst;
    }

    const nameNoiseWordsList = [
      'age', 'years', 'year', 'yr', 'yo', 'of', 'legal', 'taong', 'gulang',
      'single', 'married', 'widow', 'widower', 'separated', 'divorced',
      'filipino', 'pilipino', 'citizen', 'resident', 'bonafide', 'residing',
      'this', 'is', 'to', 'certify', 'that', 'sto', 'certifies', 'patunay',
      'katibayan', 'pinatutunayan', 'na', 'si', 'the', 'a', 'and'
    ];
    if (lastName && lastName !== "Not detected") {
      const cleanLast = lastName.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (nameNoiseWordsList.includes(cleanLast) || /^\d+$/.test(cleanLast)) {
        lastName = "Not detected";
      }
    }
  }

  return { firstName, middleName, lastName, fullName };
}

const rawText = `Republic of the Philippines
Province of Batangas
City of Lipa
BARANGAY INOSLUBAN
OFFICE OF THE PUNONG BARANGAY
CERTIFICATE OF INDIGENCY
OF
TO WHOM IT MAY CONCERN:
23 years of age,
This is to certify that MIKAELA YSABEL L. LANTAFE
single/married/widow/separated, Filipino citizen is a resident of this barangay with postal
PUROK 2, BRGY. INOSLUBAN, LIPA CITY
address at
whose specimen signature below, is an INDIGENT and that he/she has visibly no money,
property or means of livelihood sufficient and available for daily food, shelter and basic
necessities for himself and his family.
This certification is being issued upon the request of ABOVE-NAMED PERSON
a
certain
requirement for the request of/for
SCHOOL REQUIREMENT
in
the fulfillment of
Isssued this 7TH day of
APRIL
2026 at Barangay Inosluban, Lipa
City, Batangas, Philippines.
Specimen Signature:
LIPA
CITY
HON. MIGUELL OLGADO
Punong Barangay
Purok 3, Brgy. mastuban, Lipa City, Batangas 4217 (043) 404-3035 / (043) 233 2459 induban2014@gmail.com`;

console.log("Full Result:", formatExtractedRequirementsSummary(rawText));
