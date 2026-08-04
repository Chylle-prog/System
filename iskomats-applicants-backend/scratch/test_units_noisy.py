import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.ocr_utils import verify_cor_fields, parse_cor_document

raw_text = """School Year Sem: AY 2025-2026 - 2nd Semester
Student No: 2021305751
Name: LANTAFE, MIKAELA YSABEL LINATOC
College: COLLEGE OF INFORMATION, ENGINEERING TECHNOLOGY, AND
Course: BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY
Year Level: 3rd Year

Subject Units Section Bldg/Room Faculty Days Time
Itelect3 IT Elective 3 3 IT3B MB 412 S 2:30 PM - 5:30 PM
ITcaproj1 Capstone Project 1 3 IT3B MB 612 W 7:30 AM - 9:00 AM
Systadm System Administration and Maintenance 3 IT3B MB 612 S 7:30 AM - 10:30 AM
Wordlit World Literature 3 IT3B MB 512 Th 9:10 AM - 10:40 AM
Disifil Filipino sa Iba't Ibang Disiplina 3 IT3B MB 411 Th 10:50 AM - 12:20 PM
Techpre Technopreneurship 3 IT3B JRF 204 W 11:00 AM - 2:00 PM
Itfisem IT Fieldtrips and Seminars 3 IT3B MB 511 M 5:30 PM - 8:30 PM
Sysiarc2 System Integration and Architecture 2 3 IT3B MB 511 F 7:30 AM - 10:30 AM
Itnetw2 Networking 2 3 IT3B MB 612 S 11:00 AM - 2:00 PM
TOTAL UNITS : a2”

ASSESSED FEES
TUITION FEE 41,375.00"""

parsed = parse_cor_document(raw_text)
success, msg, meta = verify_cor_fields(
    parsed,
    raw_text,
    'Mikaela Ysabel',
    'Linatoc',
    'Lantafe',
    expected_academic_year='2025-2026',
    expected_semester='2nd',
    course='BSIT',
    expected_id_no='2021305751',
    expected_school_name='De La Salle Lipa'
)

print('Score Details:')
for k, v in meta.get('score_details', {}).items():
    print(f'  {k}: {v}')
