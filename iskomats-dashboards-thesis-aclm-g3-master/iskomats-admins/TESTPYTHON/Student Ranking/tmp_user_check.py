from project_config import get_db
import json

def check_user_profile():
    conn = get_db(cursor_factory=None)
    cur = conn.cursor()
    
    # We don't have the user_no easily, so we check the most recent applicants
    cur.execute("SELECT applicant_no, first_name, middle_name, last_name, town_city_municipality FROM applicants ORDER BY applicant_no DESC LIMIT 5")
    rows = cur.fetchall()
    
    results = []
    for row in rows:
        results.append({
            'applicant_no': row[0],
            'first_name': row[1],
            'middle_name': row[2],
            'last_name': row[3],
            'town_city': row[4]
        })
    
    with open('user_check.json', 'w') as f:
        json.dump(results, f, indent=2)
    
    conn.close()

if __name__ == "__main__":
    check_user_profile()
