import os
from pathlib import Path

import psycopg2
from dotenv import load_dotenv
from psycopg2.extras import RealDictCursor

try:
    from supabase import create_client
except ImportError:
    create_client = None


PROJECT_ROOT = Path(__file__).resolve().parent
ENV_PATH = PROJECT_ROOT / '.env'

if ENV_PATH.exists():
    load_dotenv(ENV_PATH, override=True)


def get_db_connection_kwargs():
    schema = os.getenv('DB_SCHEMA', '').strip()
    sslmode = os.getenv('DB_SSLMODE', '').strip()
    connect_timeout = os.getenv('DB_CONNECT_TIMEOUT', '').strip()

    connection_kwargs = {
        'dbname': os.getenv('DB_NAME', '').strip() or None,
        'user': os.getenv('DB_USER', '').strip() or None,
        'password': os.getenv('DB_PASSWORD', '').strip() or None,
        'host': os.getenv('DB_HOST', '').strip() or None,
    }

    port = os.getenv('DB_PORT', '').strip()
    if port:
        connection_kwargs['port'] = port

    if sslmode:
        connection_kwargs['sslmode'] = sslmode

    if connect_timeout:
        connection_kwargs['connect_timeout'] = int(connect_timeout)

    if schema:
        connection_kwargs['options'] = f'-c search_path={schema}'

    return {key: value for key, value in connection_kwargs.items() if value is not None}


def get_db(cursor_factory=RealDictCursor):
    connection_kwargs = get_db_connection_kwargs()
    if cursor_factory is None:
        return psycopg2.connect(**connection_kwargs)
    return psycopg2.connect(cursor_factory=cursor_factory, **connection_kwargs)


def get_db_display_config():
    connection_kwargs = get_db_connection_kwargs()
    return {
        'host': connection_kwargs['host'],
        'port': connection_kwargs.get('port'),
        'dbname': connection_kwargs['dbname'],
        'schema': os.getenv('DB_SCHEMA', '').strip(),
        'sslmode': connection_kwargs.get('sslmode'),
    }


def use_storage():
    return os.environ.get('STORE_FILES_IN', '').strip().lower() == 'storage'


def get_storage_bucket(default=None):
    bucket = os.environ.get('SUPABASE_STORAGE_BUCKET', '').strip()
    if bucket:
        return bucket
    return default


def get_supabase_client():
    url = os.environ.get('SUPABASE_URL', '').strip()
    service_role_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '').strip()

    if not url or not service_role_key:
        return None

    if create_client is None:
        raise RuntimeError('supabase package is not installed. Add it to requirements.txt before using storage features.')

    return create_client(url, service_role_key)