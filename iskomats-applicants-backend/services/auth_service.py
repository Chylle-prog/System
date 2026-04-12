# Applicant-only auth_service
# Cleaned and migrated from the original backend
import os
import re
DEFAULT_CORS_ORIGINS = (
	"http://localhost:5173,http://localhost:5173/,"
	"http://localhost:3000,http://localhost:3000/,"
	"http://localhost:5174,http://localhost:5174/,"
	"http://localhost:5175,http://localhost:5175/,"
	"https://cozy-kulfi-35f772.netlify.app,https://cozy-kulfi-35f772.netlify.app/,"
	"https://stingy-body.surge.sh,https://stingy-body.surge.sh/,"
	"https://foregoing-giants.surge.sh,https://foregoing-giants.surge.sh/,"
	"https://iskomats-admin.surge.sh,https://iskomats-admin.surge.sh/,"
	"https://system-kjbv.onrender.com,https://system-kjbv.onrender.com/"
)
def get_secret_key():
	return os.environ.get('SECRET_KEY', 'development-key-replace-in-production')
# ...existing code migrated and cleaned for applicant use only...
# Copied: auth_service.py (applicant only)
