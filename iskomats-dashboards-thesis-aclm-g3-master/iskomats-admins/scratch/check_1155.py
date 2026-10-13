import psycopg2

conn = psycopg2.connect(
    dbname='postgres',
    user='postgres.choqncwkxobwsouyotih',
    password='SuperSecurePassword!',
    host='aws-0-ap-northeast-1.pooler.supabase.com',
    port=5432,
    sslmode='require'
)
cur = conn.cursor()

# Get applicant 1155 applications
cur.execute("SELECT s.stat_no, s.is_accepted, sch.title, sch.pro_no FROM applicant_status s JOIN scholarships sch ON s.scholarship_no = sch.scholarship_no WHERE s.applicant_no = 1155")
apps = cur.fetchall()
print("Applicant 1155 applications:")
for a in apps:
    print(a)
