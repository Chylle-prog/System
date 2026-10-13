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
cur.execute("SELECT m_id, room, username, message, applicant_no, is_student_sender, is_read, sender_id FROM message WHERE is_student_sender = true AND is_read = false")
rows = cur.fetchall()
print(f"Unread student messages ({len(rows)}):")
for r in rows:
    print(r)
