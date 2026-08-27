APPLICANT_DOCUMENT_TABLE_CANDIDATES = ('applicant_documents', 'applicant_document')

APPLICANT_INLINE_MEDIA_COLUMNS = (
    'profile_picture',
)

APPLICANT_DOCUMENT_COLUMNS = (
    'signature_image_data',
    'id_pic',
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
    return f' LEFT JOIN (SELECT DISTINCT ON (applicant_no) * FROM {document_table} ORDER BY applicant_no, app_doc_no DESC) {document_alias} ON {document_alias}.applicant_no = {applicant_alias}.applicant_no '


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


def fetch_applicant_document_values(cursor, applicant_no, column_names, app_doc_no=None):
    document_table = get_applicant_document_table(cursor)
    requested_columns = list(dict.fromkeys(column_names))
    if not requested_columns:
        return {}

    applicant_columns = get_table_columns(cursor, 'applicants')
    
    join_param = None
    if app_doc_no is not None and document_table:
        try:
            str_doc_no = str(app_doc_no).strip()
            if str_doc_no and str_doc_no.isdigit():
                doc_cols = [c.lower() for c in get_table_columns(cursor, document_table)]
                if 'app_doc_no' in doc_cols:
                    joins = f' LEFT JOIN {document_table} ad ON ad.app_doc_no = %s '
                    join_param = int(str_doc_no)
                else:
                    joins = applicant_document_join_sql(cursor, 'a', 'ad')
            else:
                joins = applicant_document_join_sql(cursor, 'a', 'ad')
        except (ValueError, TypeError):
            joins = applicant_document_join_sql(cursor, 'a', 'ad')
    else:
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

    if join_param is not None:
        query = f'SELECT {", ".join(select_parts)} FROM applicants a{joins}WHERE a.applicant_no = %s LIMIT 1'
        cursor.execute(query, (join_param, applicant_no))
    else:
        query = f'SELECT {", ".join(select_parts)} FROM applicants a{joins}WHERE a.applicant_no = %s LIMIT 1'
        cursor.execute(query, (applicant_no,))
    row = cursor.fetchone()
    row_dict = dict(row) if row else {}

    # Robust Fallback: If any requested document column is NULL in the joined row,
    # find the most recent non-null value from applicant_documents for this applicant.
    if document_table:
        doc_cols = [c.lower() for c in get_table_columns(cursor, document_table)]
        for col in requested_columns:
            if row_dict.get(col) is None and col.lower() in doc_cols:
                try:
                    cursor.execute(
                        f'SELECT "{col}" FROM {document_table} WHERE applicant_no = %s AND "{col}" IS NOT NULL ORDER BY app_doc_no DESC LIMIT 1',
                        (applicant_no,)
                    )
                    fb = cursor.fetchone()
                    if fb:
                        val = fb.get(col) if isinstance(fb, dict) else fb[0]
                        if val is not None:
                            row_dict[col] = val
                except Exception as fb_err:
                    print(f"[DOC SERVICE] Fallback fetch error for {col}: {fb_err}", flush=True)

    return row_dict


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

        if filtered_values:
            # Detect primary key identifier column (e.g. app_doc_no) that may lack default auto-increment
            pk_col = None
            for pk_name in ('app_doc_no', 'doc_no', 'document_no', 'id'):
                if pk_name in doc_col_map and doc_col_map[pk_name] not in filtered_values and doc_col_map[pk_name] != 'applicant_no':
                    pk_col = doc_col_map[pk_name]
                    break

            # 1. Try UPDATE first for existing row to avoid touching app_doc_no
            update_assignments = ', '.join(f'"{col}" = %s' for col in filtered_values.keys())
            update_params = [*filtered_values.values(), applicant_no]
            cursor.execute(
                f'UPDATE {document_table} SET {update_assignments} WHERE applicant_no = %s',
                tuple(update_params),
            )

            # 2. If no existing row was updated, INSERT new record with generated app_doc_no
            if cursor.rowcount == 0:
                if pk_col:
                    insert_columns = [f'"{pk_col}"', '"applicant_no"', *[f'"{col}"' for col in filtered_values.keys()]]
                    val_exprs = [f'(SELECT COALESCE(MAX("{pk_col}"), 0) + 1 FROM {document_table})', '%s', *['%s'] * len(filtered_values)]
                    insert_params = [applicant_no, *filtered_values.values()]
                else:
                    insert_columns = ['"applicant_no"', *[f'"{col}"' for col in filtered_values.keys()]]
                    val_exprs = ['%s'] * len(insert_columns)
                    insert_params = [applicant_no, *filtered_values.values()]

                conflict_assignments = ', '.join(f'"{column}" = EXCLUDED."{column}"' for column in filtered_values.keys())
                try:
                    cursor.execute(
                        f'''
                        INSERT INTO {document_table} ({', '.join(insert_columns)})
                        VALUES ({', '.join(val_exprs)})
                        ON CONFLICT (applicant_no)
                        DO UPDATE SET {conflict_assignments}
                        ''',
                        tuple(insert_params),
                    )
                except Exception:
                    cursor.execute(
                        f'''
                        INSERT INTO {document_table} ({', '.join(insert_columns)})
                        VALUES ({', '.join(val_exprs)})
                        ''',
                        tuple(insert_params),
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