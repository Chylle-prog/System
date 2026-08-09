const userGradesText = `DE LA SALLE LIPA
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

function normalizeForOcr(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function isSimilarWord(w1, w2) {
  if (!w1 || !w2) return false;
  const a = w1.toLowerCase();
  const b = w2.toLowerCase();
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4) {
    if (a.startsWith(b) || b.startsWith(a)) return true;
  }
  return false;
}

function checkNameWordGroup(expectedWordsStr, text) {
  if (!expectedWordsStr || !text) return false;
  const expWords = normalizeForOcr(expectedWordsStr).split(/\s+/).filter(w => w.length >= 1);
  const normText = normalizeForOcr(text);
  if (!expWords.length || !normText) return false;

  return expWords.every(w => {
    if (w.length === 1) {
      return new RegExp('\\b' + w + '\\b', 'i').test(normText) || normText.split(/\s+/).some(tw => tw.toLowerCase().startsWith(w.toLowerCase()));
    }
    return new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(normText) ||
           normText.split(/\s+/).some(tw => isSimilarWord(tw, w));
  });
}

function extractOcrKeyValues(rawText) {
  const fields = {};
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const labelMap = {
    name: [
      /student\s*name\s*[:\-1l\|\]\}\)]\s*(.+)/i,
      /name\s*of\s*student\s*[:\-1l\|\]\}\)]\s*(.+)/i,
      /pangalan\s*[:\-1l\|\]\}\)]\s*(.+)/i,
      /^name\s*[:\-]\s*(.+)/i,
      /name\s*[:\-1l\|\]\}\)]\s*(.+)/i
    ]
  };

  for (const line of lines) {
    for (const regex of labelMap.name) {
      const match = line.match(regex);
      if (match && match[1] && match[1].trim().length > 0) {
        let val = match[1].trim();
        val = val.replace(/\s+(?:Reg|Tran|College|Pay|User|Scholarship|Discount|Ref|Total\s*Units|Total)[\s\S]*/i, '').trim();
        if (key === 'name' && (/\d/.test(val) || /AY\s*\d|School\s*Year|Semester|1st|2nd|3rd|Official|Certificate|Registration/i.test(val))) {
          continue;
        }
        fields.name = val;
        break;
      }
    }
  }
  return fields;
}

// Trace line by line
const lines = userGradesText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
console.log("Lines:");
lines.forEach((l, idx) => console.log(`${idx}: ${l}`));
