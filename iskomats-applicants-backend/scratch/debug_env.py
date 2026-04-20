import os
from project_config import get_db_connection_kwargs
print("DB_USER from os.environ:", os.environ.get('DB_USER'))
print("get_db_connection_kwargs results:", get_db_connection_kwargs())
