const docText = `DE LA SALLE LIPA
OFFICE OF THE COLLEGE REGISTRAR
STUDENT'S FINAL GRADES
SY/Sem : 2025-2026 1st Semester
Total Units Enrolled : 128
Student No : 2021305751
Student Name : LANTAFE, MIKAELA YSABEL LINATOC`;

const videoText = `[Frame at 1.3s]: "DE LA SALLE LIPA AY 2025-2026-2nd Semester Alexie Chyle Magbuhat"
[Frame at 3.3s]: "DE LA SALLE LIPA AY 2025-2026-2nd Semester Alexie Chyle Magbuhat"`;

const combinedText = docText + " " + videoText;

function normalizeSemesterInt(value) {
  if (!value) return null;
  const s = String(value).toLowerCase();
  if (s.includes('1st') || s.includes('first') || s === '1') return 1;
  if (s.includes('2nd') || s.includes('second') || s === '2') return 2;
  if (s.includes('3rd') || s.includes('third') || s.includes('summer') || s.includes('midyear') || s === '3') return 3;
  return null;
}

function extractSemesterFromText(text) {
  if (!text) return null;
  const lines = String(text).split(/\r?\n/);
  const votes = { 1: 0, 2: 0, 3: 0 };

  for (const line of lines) {
    if (/(?:sy\b|ay\b|sem\b|semester|term\b|period)/i.test(line)) {
      const cleanLine = line
        .replace(/\b20\d{2}\s*[\-\/\.\:\+]\s*20\d{2}\b/g, '')
        .replace(/\b(?:sy|ay)?\s*\d{2}\s*[\-\/\.\:\+]\s*\d{2}\b/gi, '');

      if (/\b(?:1st|first|1sa|15t|sem\s*1|1st\s*sem|1st\s*semester)\b/i.test(cleanLine)) votes[1]++;
      else if (/\b(?:2nd|second|2na|2ng|2da|2rd|sem\s*2|2nd\s*sem|2nd\s*semester)\b/i.test(cleanLine)) votes[2]++;
      else if (/\b(?:3rd|third|summer|midyear|sem\s*3|3rd\s*sem|3rd\s*semester)\b/i.test(cleanLine)) votes[3]++;
    }
  }

  const maxVotes = Math.max(votes[1], votes[2], votes[3]);
  if (maxVotes > 0) {
    if (votes[1] === maxVotes) return 1;
    if (votes[2] === maxVotes) return 2;
    if (votes[3] === maxVotes) return 3;
  }

  return null;
}

function semesterMatchesText(text, expectedSemester) {
  if (!expectedSemester || !text) return true;
  const expNum = normalizeSemesterInt(expectedSemester);
  if (expNum === null) return true;
  const foundNum = extractSemesterFromText(text);
  return foundNum !== null ? expNum === foundNum : true;
}

console.log("OLD check on combinedText (1st Semester expected):", semesterMatchesText(combinedText, "1st Semester"));
console.log("NEW check: docText FIRST, fallback combinedText:", semesterMatchesText(docText, "1st Semester") || semesterMatchesText(combinedText, "1st Semester"));
