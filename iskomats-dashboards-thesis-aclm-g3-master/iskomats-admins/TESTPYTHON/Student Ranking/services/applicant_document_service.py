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
    
    # Do case-insensitive check
    applicant_col_map = {col.lower(): col for col in applicant_columns}
    real_applicant_col = applicant_col_map.get(column_name.lower())
    applicant_expr = f'{applicant_alias}."{real_applicant_col}"' if real_applicant_col else None

    if document_table:
        document_columns = get_table_columns(cursor, document_table)
        doc_col_map = {col.lower(): col for col in document_columns}
        real_doc_col = doc_col_map.get(column_name.lower())
        if real_doc_col:
            document_expr = f'{document_alias}."{real_doc_col}"'
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
        if column_name == 'profile_picture':
            if 'profile_picture' not in applicant_columns:
                select_parts.append('NULL AS profile_picture')
            else:
                select_parts.append('a."profile_picture" AS profile_picture')
            continue
        select_parts.append(f'{applicant_document_expr(cursor, column_name, "a", "ad")} AS "{column_name}"')

    query = f'SELECT {", ".join(select_parts)} FROM applicants a{joins}WHERE a.applicant_no = %s LIMIT 1'
    cursor.execute(query, (applicant_no,))
    row = cursor.fetchone()
    return row or {}


def persist_applicant_document_values(cursor, applicant_no, values):
    doc_cols_lower = {col.lower(): col for col in APPLICANT_DOCUMENT_COLUMNS}
    
    document_values = {}
    for key, value in values.items():
        key_lower = key.lower()
        if key_lower in doc_cols_lower:
            document_values[key] = value

    if not document_values:
        return

    document_table = get_applicant_document_table(cursor)
    if document_table:
        document_columns = get_table_columns(cursor, document_table)
        doc_col_map = {col.lower(): col for col in document_columns}
        filtered_values = {}
        for key, value in document_values.items():
            real_key = doc_col_map.get(key.lower())
            if real_key:
                filtered_values[real_key] = value

        if not filtered_values:
            return

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
        return

    applicant_columns = get_table_columns(cursor, 'applicants')
    applicant_col_map = {col.lower(): col for col in applicant_columns}
    fallback_values = {}
    for key, value in document_values.items():
        real_key = applicant_col_map.get(key.lower())
        if real_key:
            fallback_values[real_key] = value

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
    Ensures a Supabase storage URL points to the current project domain.
    This prevents 400 Bad Request errors when switching between projects.
    """
    import os
    from urllib.parse import urlparse

    if not url or not isinstance(url, str) or not url.startswith('http'):
        return url

    # Skip if it's not a Supabase-like URL
    if '.supabase.co' not in url:
        return url

    current_url = os.environ.get('SUPABASE_URL', '').strip()
    if not current_url:
        return url

    try:
        current_host = urlparse(current_url).netloc.lower()
        parsed_url = urlparse(url)
        
        # If domain mismatch, rewrite with current project host
        if parsed_url.netloc.lower() != current_host:
            # Reconstruct URL with current host
            return f"https://{current_host}{parsed_url.path}{'?' + parsed_url.query if parsed_url.query else ''}"
    except Exception:
        pass

    return url