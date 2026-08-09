const gradesText = `DE LA SALLE LIPA
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

function normalizeForOcr(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

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
    course: [/course\s*[:\-1l\|\]\}\)]\s*(.+)/i, /program\s*[:\-1l\|\]\}\)]\s*(.+)/i, /degree\s*[:\-1l\|\]\}\)]\s*(.+)/i, /strand\s*[:\-1l\|\]\}\)]\s*(.+)/i],
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
            fields[key] = val;
            break;
          }
        }
      }
    }
  }
  return fields;
}

function courseMatchesText(expectedCourse, text) {
  if (!expectedCourse || !text) return true;
  const normText = normalizeForOcr(text);
  const lowerRaw = String(text).toLowerCase();

  const fixedText = lowerRaw.replace(/b5it/g, 'bsit').replace(/5/g, 's');
  const normCourse = normalizeForOcr(expectedCourse);

  const kv = extractOcrKeyValues(text);
  const targetText = kv.course ? normalizeForOcr(kv.course) : normText;

  console.log("expectedCourse:", expectedCourse);
  console.log("normCourse:", normCourse);
  console.log("kv.course:", kv.course);
  console.log("targetText:", targetText);
  console.log("normText includes normCourse?", normText.includes(normCourse));

  if (targetText.includes(normCourse) || normText.includes(normCourse) || fixedText.includes(normCourse)) return true;

  const courseMap = {
    'bsit': ['information technology', 'info tech', 'it', 'b5it'],
    'bscs': ['computer science', 'comp sci', 'cs'],
  };

  const expUpper = String(expectedCourse).toLowerCase().trim();
  for (const [code, synonyms] of Object.entries(courseMap)) {
    if (expUpper.includes(code) || synonyms.some(s => expUpper.includes(s))) {
      if (fixedText.includes(code) || synonyms.some(s => fixedText.includes(s) || normText.includes(s))) {
        return true;
      }
    }
  }

  const words = String(expectedCourse).trim().split(/\s+/);
  const acronym = words.map(w => w[0] ? w[0].toLowerCase() : '').join('');
  if (acronym.length >= 2) {
    const acronymRegex = new RegExp(`\\b${acronym.replace('bs', 'b[s5]\\s*')}\\b`, 'i');
    if (acronymRegex.test(targetText) || acronymRegex.test(fixedText)) return true;
  }

  const genericWords = ['bachelor', 'master', 'doctor', 'science', 'arts', 'degree', 'major', 'in', 'of', 'and', 'bs', 'ba', 'ms', 'ma'];
  const sigWords = words.map(normalizeForOcr).filter(w => w.length > 2 && !genericWords.includes(w));

  if (sigWords.length > 0) {
    const searchArea = targetText || fixedText;
    const matchedCount = sigWords.filter(w => new RegExp('\\b' + w + '\\b').test(searchArea) || searchArea.includes(w)).length;
    const requiredRatio = sigWords.length <= 2 ? 1.0 : 0.6;
    if ((matchedCount / sigWords.length) >= requiredRatio) return true;
  }

  return false;
}

console.log("courseMatchesText result:", courseMatchesText("BSIT", gradesText));
console.log("courseMatchesText result:", courseMatchesText("BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY", gradesText));
