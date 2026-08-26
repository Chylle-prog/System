import os
import time
import threading
from pathlib import Path

import psycopg2
from psycopg2 import pool
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

# ─── PERFORMANCE PROFILES ───────────────────────────────────────────────────
# Profiles for different Render instance types (Free vs Standard)
APP_PERFORMANCE_MODE = os.environ.get('APP_PERFORMANCE_MODE', 'HIGH').upper()

PERFORMANCE_CONFIG = {
    'LOW': {
        'ocr_concurrency': 1,
        'threads_per_process': 1,
        'image_max_width': 1024,
        'gc_frequency': 'always'
    },
    'HIGH': {
        'ocr_concurrency': 8,
        'threads_per_process': 8,
        'image_max_width': 1024,
        'gc_frequency': 'minimal'
    }
}

def get_performance_config():
    return PERFORMANCE_CONFIG.get(APP_PERFORMANCE_MODE, PERFORMANCE_CONFIG['HIGH'])

print(f"[RESOURCES] Performance Mode: {APP_PERFORMANCE_MODE} (LOCAL ULTRA)", flush=True)

# ─── CONNECTION POOLING ───────────────────────────────────────────────────────
_CONNECTION_POOL = None
_POOL_LOCK = threading.Lock()

def _init_pool():
    global _CONNECTION_POOL
    with _POOL_LOCK:
        if _CONNECTION_POOL is not None:
            return
        
        print("[DB INITIALIZE] Creating ThreadedConnectionPool...", flush=True)
        kwargs = get_db_connection_kwargs()
        
        # Adjust pool size based on environment
        # For managed DBs like Render (limit 20), we keep these very conservative
        min_conn = int(os.environ.get('DB_POOL_MIN', '2'))
        max_conn = int(os.environ.get('DB_POOL_MAX', '40'))
        
        try:
            _CONNECTION_POOL = pool.ThreadedConnectionPool(
                min_conn, max_conn, **kwargs
            )
            print(f"[DB INITIALIZE] Pool created with {min_conn}-{max_conn} connections.", flush=True)
        except Exception as e:
            print(f"[DB ERROR] Failed to initialize connection pool: {e}", flush=True)
            raise

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


def get_db(cursor_factory=RealDictCursor, fast_startup=False):
    # For startup/migrations, we prefer a fresh connection that fails fast
    if fast_startup:
        connection_kwargs = get_db_connection_kwargs()
        connection_kwargs['connect_timeout'] = 2
        return psycopg2.connect(cursor_factory=cursor_factory, **connection_kwargs)

    # For standard requests, use the pool
    if _CONNECTION_POOL is None:
        _init_pool()
    
    # Try up to 10 attempts with backoff when pool is busy under high socket bursts
    conn = None
    max_attempts = 10
    for attempt in range(max_attempts):
        try:
            conn = _CONNECTION_POOL.getconn()
            if conn.closed != 0:
                raise psycopg2.InterfaceError("Connection obtained from pool is already closed.")
            break
        except pool.PoolError as e:
            if attempt < max_attempts - 1:
                # Active queries take a few ms; sleep briefly and retry to acquire freed connection
                time.sleep(0.05 * (attempt + 1))
                continue
            pool_max = os.environ.get('DB_POOL_MAX', '40')
            print(f"[DB CRITICAL] Pool exhausted after {max_attempts} attempts! All {pool_max} connections in use.", flush=True)
            raise psycopg2.OperationalError("Database connection pool is full. Try again later.") from e
        except (psycopg2.OperationalError, psycopg2.InterfaceError) as e:
            print(f"[DB ERROR] Got broken connection from pool: {e}. Attempting to refresh...", flush=True)
            if conn:
                try:
                    _CONNECTION_POOL.putconn(conn, close=True) 
                except:
                    pass
            conn = None
            if attempt == max_attempts - 1:
                raise
            time.sleep(0.05)
        except Exception as e:
            print(f"[DB ERROR] Unexpected error gathering connection: {e}", flush=True)
            if conn:
                try:
                    _CONNECTION_POOL.putconn(conn)
                except:
                    pass
            conn = None
            raise

    if not conn:
        raise psycopg2.OperationalError("Could not obtain a live database connection after retries.")

    # We'll use a wrapper to ensure the connection is returned to the pool on close
    class PooledConnectionProxy:
        def __init__(self, connection, cursor_factory):
            self._conn = connection
            self._cursor_factory = cursor_factory
            self._returned = False

        def __getattr__(self, name):
            if name == 'autocommit':
                return self._conn.autocommit
            return getattr(self._conn, name)
            
        def __setattr__(self, name, value):
            if name == 'autocommit':
                self._conn.autocommit = value
            else:
                super().__setattr__(name, value)

        def cursor(self, *args, **kwargs):
            if 'cursor_factory' not in kwargs and self._cursor_factory:
                kwargs['cursor_factory'] = self._cursor_factory
            return self._conn.cursor(*args, **kwargs)

        def close(self):
            if not self._returned:
                try:
                    is_closed = (self._conn.closed != 0)
                    _CONNECTION_POOL.putconn(self._conn, close=is_closed)
                except:
                    try:
                        _CONNECTION_POOL.putconn(self._conn)
                    except:
                        pass
                self._returned = True

        def commit(self):
            return self._conn.commit()

        def rollback(self):
            return self._conn.rollback()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_val, exc_tb):
            # Crucial: Always return to pool even if exception occurs
            self.close()

    return PooledConnectionProxy(conn, cursor_factory)


def get_db_startup(cursor_factory=RealDictCursor):
    """Lightweight startup/migration DB connection — fails fast to avoid bloating deploy time."""
    return get_db(cursor_factory=cursor_factory, fast_startup=True)


def get_db_display_config():
    connection_kwargs = get_db_connection_kwargs()
    return {
        'host': connection_kwargs['host'] or 'N/A',
        'port': connection_kwargs['port'] or '5432',
        'dbname': connection_kwargs['dbname'] or 'N/A',
        'schema': os.environ.get('DB_SCHEMA', 'public').strip() or 'public',
        'sslmode': connection_kwargs['sslmode'] or 'require',
    }


def use_storage():
    return os.environ.get('STORE_FILES_IN', 'database').strip().lower() == 'storage'


def get_storage_bucket(default='document_images'):
    return os.environ.get('SUPABASE_STORAGE_BUCKET', default).strip() or default


_SUPABASE_CLIENT = None
_SUPABASE_LOCK = threading.Lock()
_VERIFIED_BUCKETS = {'announcement_images', 'scholarship_images', 'applicant_documents', 'documents', 'document_images'}

def get_supabase_client():
    global _SUPABASE_CLIENT
    if _SUPABASE_CLIENT is not None:
        return _SUPABASE_CLIENT

    with _SUPABASE_LOCK:
        if _SUPABASE_CLIENT is not None:
            return _SUPABASE_CLIENT

        url = os.environ.get('SUPABASE_URL', '').strip()
        service_role_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '').strip()

        if not url or not service_role_key:
            return None

        if create_client is None:
            raise RuntimeError('supabase package is not installed. Add it to requirements.txt before using storage features.')

        _SUPABASE_CLIENT = create_client(url, service_role_key)
        return _SUPABASE_CLIENT


def upload_to_supabase(image_data, bucket_name, file_path, content_type='image/jpeg'):
    """
    General helper to upload binary data to a Supabase storage bucket.
    Ensures bucket exists before upload (cached).
    Returns the public URL on success, or None on failure.
    """
    supabase = get_supabase_client()
    if not supabase:
        print("[STORAGE ERROR] Supabase client not initialized.", flush=True)
        return None
    
    try:
        # Standardize bytes
        if hasattr(image_data, 'read'):
            binary_data = image_data.read()
        elif isinstance(image_data, (bytes, bytearray, memoryview)):
            binary_data = bytes(image_data)
        elif isinstance(image_data, str) and (image_data.startswith('http') or len(image_data) > 1000):
            return None
        else:
            binary_data = bytes(image_data)

        # 1. Ensure bucket exists (cached to avoid remote network latency on every upload)
        if bucket_name not in _VERIFIED_BUCKETS:
            try:
                supabase.storage.get_bucket(bucket_name)
                _VERIFIED_BUCKETS.add(bucket_name)
            except Exception:
                try:
                    all_buckets = [b.name for b in supabase.storage.list_buckets()]
                    print(f"[STORAGE] Bucket '{bucket_name}' not found. Available buckets: {all_buckets}", flush=True)
                    print(f"[STORAGE] Attempting to create bucket '{bucket_name}'...", flush=True)
                    supabase.storage.create_bucket(bucket_name, {"public": True})
                    _VERIFIED_BUCKETS.add(bucket_name)
                except Exception as e:
                    available = []
                    try:
                        available = [b.name for b in supabase.storage.list_buckets()]
                    except: pass
                    print(f"[STORAGE ERROR] Could not create bucket '{bucket_name}': {e}. Visible buckets: {available}", flush=True)
                    raise RuntimeError(f"Storage Error: Bucket '{bucket_name}' not found and creation failed. Visible buckets: {available}. Error: {str(e)}")

        # 2. Upload using service role key (bypasses RLS)
        supabase.storage.from_(bucket_name).upload(
            path=file_path,
            file=binary_data,
            file_options={
                "contentType": content_type, 
                "upsert": "true",
                "cacheControl": "31536000"
            }
        )
        
        # 3. Get public URL
        url_res = supabase.storage.from_(bucket_name).get_public_url(file_path)
        if isinstance(url_res, dict):
            return url_res.get('publicUrl')
        return url_res
    except Exception as e:
        print(f"[STORAGE ERROR] Upload failed for {file_path} in {bucket_name}: {e}", flush=True)
        raise  # Bubble up to the caller so they can report the full traceback
