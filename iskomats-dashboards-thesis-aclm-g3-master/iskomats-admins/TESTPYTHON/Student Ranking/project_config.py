import os
import time
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
    # Only load from .env if the variable isn't already set (prevents overriding Render variables)
    load_dotenv(ENV_PATH, override=False)


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
        'application_name': os.environ.get('DB_APPLICATION_NAME', 'iskomats-combined-backend'),
        'keepalives': 1,
        'keepalives_idle': int(os.environ.get('DB_KEEPALIVES_IDLE', '30')),
        'keepalives_interval': int(os.environ.get('DB_KEEPALIVES_INTERVAL', '10')),
        'keepalives_count': int(os.environ.get('DB_KEEPALIVES_COUNT', '5')),
    }

    if schema and schema != 'public':
        connection_kwargs['options'] = f'-c search_path={schema}'

    return connection_kwargs


def get_db(cursor_factory=RealDictCursor):
    connection_kwargs = get_db_connection_kwargs()
    max_attempts = int(os.environ.get('DB_CONNECT_RETRIES', '3'))
    retry_delay = float(os.environ.get('DB_CONNECT_RETRY_DELAY', '1.0'))
    last_error = None

    for attempt in range(1, max_attempts + 1):
        try:
            if cursor_factory is None:
                return psycopg2.connect(**connection_kwargs)
            return psycopg2.connect(cursor_factory=cursor_factory, **connection_kwargs)
        except psycopg2.OperationalError as exc:
            last_error = exc
            if attempt == max_attempts:
                break
            time.sleep(retry_delay)

    raise last_error


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