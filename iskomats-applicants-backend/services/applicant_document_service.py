import os
from urllib.parse import urlparse

APPLICANT_DOCUMENT_TABLE_CANDIDATES = ('applicant_documents', 'applicant_document')

APPLICANT_INLINE_MEDIA_COLUMNS = (
    'profile_picture',
)

APPLICANT_DOCUMENT_COLUMNS = (
    'signature_image_data',
    'schoolID_photo',
    'id_img_front',
    'id_img_back',
    'enrollment_certificate_doc',
    'grades_doc',
    'indigency_doc',
    'id_pic',
    'id_vid_url',
    'indigency_vid_url',
    'grades_vid_url',
    'enrollment_certificate_vid_url',
    'schoolid_front_vid_url',
    'schoolid_back_vid_url',
    'profile_picture',
)

_TABLE_CACHE = {}
_COLUMN_CACHE = {}


def applicant_has_column(cursor, column_name):
    return column_name in get_table_columns(cursor, 'applicants')


def _table_exists(cursor, table_name):
    cache_key = ('exists', table_name)
    if cache_key in _TABLE_CACHE:
        return _TABLE_CACHE[cache_key]

    cursor.execute(
        """
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = ANY (current_schemas(FALSE))
              AND table_name = %s
        ) AS exists
        """,
        (table_name,),
    )
    row = cursor.fetchone()
    exists = row.get('exists') if hasattr(row, 'get') else row[0]
    _TABLE_CACHE[cache_key] = exists
    return exists


def get_table_columns(cursor, table_name):
    cache_key = ('columns', table_name)
    if cache_key in _COLUMN_CACHE:
        return _COLUMN_CACHE[cache_key]

    cursor.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = ANY (current_schemas(FALSE))
          AND table_name = %s
        """,
        (table_name,),
    )
    columns = {
        row.get('column_name') if hasattr(row, 'get') else row[0]
        for row in cursor.fetchall()
    }
    _COLUMN_CACHE[cache_key] = columns
    return columns


def get_applicant_document_table(cursor):
    for candidate in APPLICANT_DOCUMENT_TABLE_CANDIDATES:
        if _table_exists(cursor, candidate):
            return candidate
    return None


def applicant_document_join_sql(cursor, applicant_alias='a', document_alias='ad'):
    document_table = get_applicant_document_table(cursor)
    if not document_table:
        return ''
    return f' LEFT JOIN {document_table} {document_alias} ON {document_alias}.applicant_no = {applicant_alias}.applicant_no '


def applicant_document_expr(cursor, column_name, applicant_alias='a', document_alias='ad'):
    applicant_columns = get_table_columns(cursor, 'applicants')
    document_table = get_applicant_document_table(cursor)
    applicant_expr = f'{applicant_alias}."{column_name}"' if column_name in applicant_columns else None

    if document_table:
        document_columns = get_table_columns(cursor, document_table)
        if column_name in document_columns:
            document_expr = f'{document_alias}."{column_name}"'
            if applicant_expr:
                return f'COALESCE({document_expr}, {applicant_expr})'
            return document_expr

    if applicant_expr:
        return applicant_expr

    return 'NULL'


def fetch_applicant_document_values(cursor, applicant_no, column_names):
    document_table = get_applicant_document_table(cursor)
    requested_columns = list(dict.fromkeys(column_names))
    if not requested_columns:
        return {}

    applicant_columns = get_table_columns(cursor, 'applicants')
    joins = applicant_document_join_sql(cursor, 'a', 'ad')
    select_parts = []
    for column_name in requested_columns:
        if column_name == 'applicant_no':
            select_parts.append('a.applicant_no AS applicant_no')
            continue
        select_parts.append(f'{applicant_document_expr(cursor, column_name, "a", "ad")} AS "{column_name}"')

    query = f'SELECT {", ".join(select_parts)} FROM applicants a{joins}WHERE a.applicant_no = %s LIMIT 1'
    cursor.execute(query, (applicant_no,))
    row = cursor.fetchone()
    return row or {}


def persist_applicant_document_values(cursor, applicant_no, values):
    is_cloud = os.environ.get('STORE_FILES_IN', 'database').strip().lower() == 'storage'
    
    document_values = {key: value for key, value in values.items() if key in APPLICANT_DOCUMENT_COLUMNS}
    if not document_values:
        return

    # If cloud storage is enabled, we MUST NOT save raw bytes/blobs to the document columns.
    # We only allow URLs or Data URIs.
    if is_cloud:
        cleaned_values = {}
        for k, v in document_values.items():
            if isinstance(v, str):
                cleaned_values[k] = v
            else:
                print(f"[SERVICE] WARNING: Rejecting binary persistence for {k} because Cloud Storage is enabled.", flush=True)
        document_values = cleaned_values
        
    if not document_values:
        return

    document_table = get_applicant_document_table(cursor)
    if document_table:
        document_columns = get_table_columns(cursor, document_table)
        filtered_values = {
            key: value
            for key, value in document_values.items()
            if key in document_columns
        }
        if filtered_values:
            insert_columns = ['applicant_no', *filtered_values.keys()]
            placeholders = ', '.join(['%s'] * len(insert_columns))
            assignments = ', '.join(f'"{column}" = EXCLUDED."{column}"' for column in filtered_values.keys())
            params = [applicant_no, *filtered_values.values()]
            cursor.execute(
                f'''
                INSERT INTO {document_table} ({', '.join(insert_columns)})
                VALUES ({placeholders})
                ON CONFLICT (applicant_no)
                DO UPDATE SET {assignments}
                ''',
                tuple(params),
            )
            # If we persisted to the doc table, we don't necessarily want to duplicate in applicants?
            # Actually, some columns like profile_picture might be in both.
            # We'll continue to the fallback loop just for those.
    
    applicant_columns = get_table_columns(cursor, 'applicants')
    fallback_values = {
        key: value
        for key, value in document_values.items()
        if key in applicant_columns
    }
    if not fallback_values:
        return

    assignments = ', '.join(f'"{column}" = %s' for column in fallback_values.keys())
    params = [*fallback_values.values(), applicant_no]
    cursor.execute(
        f'UPDATE applicants SET {assignments} WHERE applicant_no = %s',
        tuple(params),
    )


def normalize_supabase_url(url):
    """
    Standardizes Supabase storage URLs to the current project domain and correct buckets.
    """
    if not url or not isinstance(url, str) or '.supabase.co/' not in url:
        return url

    current_url = os.environ.get('SUPABASE_URL', '').strip()
    img_bucket = os.environ.get('SUPABASE_STORAGE_BUCKET', 'document_images').strip()
    vid_bucket = 'document_videos' # Hardcoded as seen in user's Supabase dashboard
    
    if not current_url:
        return url

    try:
        current_host = urlparse(current_url).netloc.lower()
        parsed_url = urlparse(url)
        path = parsed_url.path
        
        if '/storage/v1/object/' in path:
            parts = path.split('/')
            if len(parts) > 5:
                # parts[5] is the bucket name
                old_bucket = parts[5]
                
                # 1. Determine the correct target bucket
                # If it's already one of our new buckets, keep it.
                # If it's an old bucket (like iskomats-files), decide based on folder/file name
                target_bucket = old_bucket
                
                valid_buckets = {img_bucket, vid_bucket, 'announcement_images'}
                
                if old_bucket not in valid_buckets:
                    # Logic to migrate from old 'iskomats-files' or other buckets
                    if '/videos/' in path or 'vid_url' in path or old_bucket == 'document_videos':
                        target_bucket = vid_bucket
                    else:
                        target_bucket = img_bucket
                
                # 2. Rewrite path if bucket changed or if it's improperly nested
                bucket_changed = (old_bucket != target_bucket)
                
                # Deduplication: if parts[6] is the same as the bucket name, it's likely a nested error (bucket/bucket/path)
                # This fixes the "document_images/document_images/videos" issue.
                is_nested = (len(parts) > 6 and parts[6] == target_bucket)
                if bucket_changed or is_nested:
                    parts[5] = target_bucket
                    if is_nested:
                        # Remove the duplicate bucket folder
                        parts.pop(6)
                    path = '/'.join(parts)
            
            # 3. Always update the host to the current project domain
            return f"https://{current_host}{path}{'?' + parsed_url.query if parsed_url.query else ''}"

    except Exception:
        pass

    return url