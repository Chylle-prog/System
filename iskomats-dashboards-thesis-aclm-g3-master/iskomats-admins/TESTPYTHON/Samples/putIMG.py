from sqlalchemy import create_engine, text
from urllib.parse import quote_plus

# ===== DATABASE CONNECTION SETTINGS =====
DB_HOST = "localhost"
DB_PORT = "5432"
DB_NAME = "test"
DB_USER = "postgres"
DB_PASSWORD = "secure_pass"

DATABASE_URL = f"postgresql+psycopg2://{DB_USER}:{quote_plus(DB_PASSWORD)}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
engine = create_engine(DATABASE_URL)

image_path = "live_capture.jpg"

with open(image_path, "rb") as f:
    image_bytes = f.read()

with engine.begin() as conn:
    conn.execute(
        text("""
            UPDATE applicants
            SET profile_picture = :img
            WHERE applicant_number = '1'
        """),
        {"img": image_bytes}
    )
