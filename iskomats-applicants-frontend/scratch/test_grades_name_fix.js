const rawText = `DE LA SALLE LIPA
OFFICE OF THE COLLEGE REGISTRAR
1962 J.P. Laurel National Highway 4217 Lipa City, Batangas Philippines
Tel. (+63 43) 756 5555 loc 222 Telefax (+63 43) 981 1781
www.disi.edu.ph
STUDENT'S FINAL GRADES
SY/Sem : 2025-2026 1st Semester Total Units Enrolled : 128
Student No : 2021305751 Total Units of Failure (0.00) : 0
Student Name : LANTAFE, MIKAELA YSABEL LINATOC Total Units of Failure (0.00) % : 0
Course : BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY Total Units of Incomplete : 0
Scholarship : Total Units of Blank Grades : 0
Academic Status : Total Units of DRP Grades : 0`;

function extractOcrKeyValues(rawText) {
  if (!rawText) return {};
  const lines = String(rawText).split(/\r?\n/);
  const fields = {};

  const rightLabelRegex = /\s+(?=(?:Reg\s*No|Tran\s*Date|College|Pay\s*Type|User|Run\s*Date|Scholarship|Discount|Ref\s*No|Status|Section|Bldg\/Room|Total\s*Units(?:\s+of\s+[A-Za-z\(\)\.\%]+)?)\s*[:\-])/i;
  const splitLines = [];
  for (const line of lines) {
    const parts = line.split(rightLabelRegex);
    for (const p of parts) {
      if (p.trim()) splitLines.push(p.trim());
    }
  }

  const labelMap = {
    name: [
      /student\s*name\s*[:\-1l\|\]\}\)]\s*(.+)/i,
      /name\s*of\s*student\s*[:\-1l\|\]\}\)]\s*(.+)/i,
      /pangalan\s*[:\-1l\|\]\}\)]\s*(.+)/i,
      /^name\s*[:\-]\s*(.+)/i,
      /name\s*[:\-1l\|\]\}\)]\s*(.+)/i
    ],
  };

  for (const line of splitLines) {
    for (const [key, regexes] of Object.entries(labelMap)) {
      if (fields[key]) continue;
      for (const regex of regexes) {
        const match = line.match(regex);
        if (match && match[1] && match[1].trim().length > 0) {
          let val = match[1].trim();
          val = val.replace(/\s+(?:Reg|Tran|College|Pay|User|Scholarship|Discount|Ref|Total\s*Units|Total)[\s\S]*/i, '').trim();
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
    const fnMatch = rawText.match(/\b([A-Za-z]{2,20}\s*,\s*[A-Za-z ]{3,40})\b/);
    if (fnMatch && fnMatch[1]) {
      const cand = fnMatch[1].trim();
      const isNoise = /OFFICIAL|CERTIFICATE|REGISTRATION|COLLEGE|UNIVERSITY|ENGINEERING|INFORMATION|BACHELOR|CERTIFY|AGE|RESIDENT|BARANGAY|PHILIPPINES|BATANGAS|CITY|PROVINCE|HIGHWAY|STREET|ROAD|ADDRESS|TEL|TELEFAX|WWW|PAGE/i.test(cand);
      if (!isNoise) {
        fields.name = cand;
      }
    }
  }
  return fields;
}

console.log("Extracted KeyValues:", extractOcrKeyValues(rawText));
