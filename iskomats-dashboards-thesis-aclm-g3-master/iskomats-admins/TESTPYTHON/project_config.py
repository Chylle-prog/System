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
    schema = os.environ.get('DB_SCHEMA', 'public').strip() or 'public'
    sslmode = os.environ.get('DB_SSLMODE', 'require').strip() or 'require'
    connect_timeout = int(os.environ.get('DB_CONNECT_TIMEOUT', '10'))

    connection_kwargs = {
        'dbname': os.environ.get('DB_NAME'),
        'user': os.environ.get('DB_USER'),
        'password': os.environ.get('DB_PASSWORD'),
        'host': os.environ.get('DB_HOST'),
        'port': os.environ.get('DB_PORT', '5432'),
        'sslmode': sslmode,
        'connect_timeout': connect_timeout,
    }

    if schema and schema != 'public':
        connection_kwargs['options'] = f'-c search_path={schema}'

    return connection_kwargs


def get_db(cursor_factory=RealDictCursor):
    connection_kwargs = get_db_connection_kwargs()
    if cursor_factory is None:
        return psycopg2.connect(**connection_kwargs)
    return psycopg2.connect(cursor_factory=cursor_factory, **connection_kwargs)


def get_db_display_config():
    connection_kwargs = get_db_connection_kwargs()
    return {
        'host': connection_kwargs['host'],
        'port': connection_kwargs['port'],
        'dbname': connection_kwargs['dbname'],
        'schema': os.environ.get('DB_SCHEMA', 'public').strip() or 'public',
        'sslmode': connection_kwargs['sslmode'],
    }


def use_storage():
    return os.environ.get('STORE_FILES_IN', 'database').strip().lower() == 'storage'


def get_storage_bucket(default='iskomats-files'):
    return os.environ.get('SUPABASE_STORAGE_BUCKET', default).strip() or default


def get_supabase_client():
    url = os.environ.get('SUPABASE_URL', '').strip()
    service_role_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '').strip()

    if not url or not service_role_key:
        return None

    if create_client is None:
        raise RuntimeError('supabase package is not installed. Add it to requirements.txt before using storage features.')

    return create_client(url, service_role_key)