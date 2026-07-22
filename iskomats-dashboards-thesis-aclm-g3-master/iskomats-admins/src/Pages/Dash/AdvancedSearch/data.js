export const scholarships = [];

export const incomeLabels = {
  "below-100k": "Below ₱100,000/yr",
  "100k-250k": "₱100,000–₱250,000/yr",
  "250k-500k": "₱250,000–₱500,000/yr",
  "above-500k": "Above ₱500,000/yr",
  "none": "No income requirement"
};

export const statusColors = {
  Open: "var(--ok)",
  Pending: "var(--pending)",
  Closed: "var(--closed)",
  Expired: "var(--expired)"
};

export const gpaBuckets = [
  {id:"latin", label:"1.00 – 1.50 (Latin Honor tier)", min:1.00, max:1.50},
  {id:"b1", label:"1.51 – 2.00", min:1.51, max:2.00},
  {id:"b2", label:"2.01 – 2.50", min:2.01, max:2.50},
  {id:"b3", label:"2.51 – 3.00", min:2.51, max:3.00},
  {id:"b4", label:"3.01 and lower requirement", min:3.01, max:5.00},
];

export function withinDays(dateStr, days) {
  const today = new Date("2026-07-19T00:00:00");
  const d = new Date(dateStr+"T00:00:00");
  const diff = (d - today) / (1000*60*60*24);
  return diff >= 0 && diff <= days;
}

export const deadlinePresets = [
  {id:"week", label:"Ending this week", test:d=>withinDays(d,7)},
  {id:"month", label:"Ending this month", test:d=>withinDays(d,31)},
  {id:"quarter", label:"Ending in next 3 months", test:d=>withinDays(d,92)},
  {id:"later", label:"Later than 3 months", test:d=>!withinDays(d,92)},
];

export const barangayList = [
  "Adya","Anilao","Anilao-Labac","Antipolo del Norte","Antipolo del Sur","Bagong Pook","Balintawak",
  "Banaybanay","Bolbok","Bugtong na Pulo","Bulacnin","Bulaklakan","Calamias","Cumba","Dagatan","Duhatan",
  "Fernando","Halang","Inosloban","Kayumanggi","Latag","Lodlod","Lumbang","Mabini","Malagonlong","Malitlit",
  "Marauoy","Mataas na Lupa","Munting Pulo","Pagolingin Bata","Pagolingin East","Pagolingin West","Pangao",
  "Pinagkawitan","Pinagtongulan","Poblacion Barangay 1","Poblacion Barangay 2","Poblacion Barangay 3",
  "Poblacion Barangay 4","Poblacion Barangay 5","Poblacion Barangay 6","Poblacion Barangay 7",
  "Poblacion Barangay 8","Poblacion Barangay 9","Poblacion Barangay 9-A","Poblacion Barangay 10",
  "Poblacion Barangay 11","Quezon","Rizal","Sabang","Sampaguita","San Benito","San Carlos","San Celestino",
  "San Francisco","San Guillermo","San Isidro","San Jose","San Lucas","San Salvador","San Sebastian",
  "Santo Niño","Santo Toribio","Sapac","Sico","Talisay","Tambo","Tangob","Tangway","Tibig","Tipacan","Plaridel"
];

export const schoolList = [
  "Batangas State University – Lipa Campus",
  "Kolehiyo ng Lungsod ng Lipa",
  "Philippine State College of Aeronautics (PhilSCA)",
  "De La Salle Lipa",
  "Lipa City Colleges (LCC)",
  "University of Batangas – Lipa Campus",
  "AMA Computer College – Lipa",
  "STI College – Lipa",
  "National University (NU) Lipa",
  "New Era University – Lipa",
  "Batangas College of Arts and Sciences (BCAS)",
  "Royal British College",
  "ICT-ED Institute of Science and Technology"
];
