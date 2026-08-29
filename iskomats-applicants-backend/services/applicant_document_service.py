import os
from urllib.parse import urlparse

APPLICANT_DOCUMENT_TABLE_CANDIDATES = ('applicant_documents', 'applicant_document')

APPLICANT_INLINE_MEDIA_COLUMNS = (
    'profile_picture',
)

APPLICANT_DOCUMENT_COLUMNS = (
    'signature_image_data',
    'id_pic',
    'id_img_front',
    'id_img_back',
    'enrollment_certificate_doc',
    'grades_doc',
    'indigency_doc',
    'id_vid_url',
    'indigency_vid_url',
    'grades_vid_url',
    'enrollment_certificate_vid_url',
    'schoolid_front_vid_url',
    'schoolid_back_vid_url',
    'profile_picture',
    'indigency_verified',
    'enrollment_verified',
    'grades_verified',
    'id_verified',
    'face_verified',
    'signature_verified',
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


_SCHEMA_ENSURED = False


def ensure_applicant_status_app_doc_no_schema(cursor):
    """
    Ensures that applicant_status has an app_doc_no foreign key pointing to applicant_documents,
    drops the 1:1 UNIQUE(applicant_no) constraint on applicant_documents so multi-application
    document sets can exist, and backfills all historical applicant_status records.
    """
    global _SCHEMA_ENSURED
    if _SCHEMA_ENSURED:
        return

    try:
        # 1. Add app_doc_no column to applicant_status if not present
        cursor.execute(
            """
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'applicant_status' AND column_name = 'app_doc_no'
                ) THEN
                    ALTER TABLE applicant_status ADD COLUMN app_doc_no integer;
                END IF;
            END $$;
            """
        )

        # 2. Drop 1:1 unique constraint on applicant_documents(applicant_no) to allow multi-document snapshots
        cursor.execute(
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.table_constraints 
                    WHERE table_name = 'applicant_documents' AND constraint_name = 'applicant_documents_applicant_no_key'
                ) THEN
                    ALTER TABLE applicant_documents DROP CONSTRAINT applicant_documents_applicant_no_key;
                END IF;
            END $$;
            """
        )

        # 3. Add Foreign Key constraint from applicant_status.app_doc_no to applicant_documents.app_doc_no
        cursor.execute(
            """
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints 
                    WHERE table_name = 'applicant_status' AND constraint_name = 'fk_applicant_status_app_doc_no'
                ) THEN
                    ALTER TABLE applicant_status 
                    ADD CONSTRAINT fk_applicant_status_app_doc_no 
                    FOREIGN KEY (app_doc_no) REFERENCES applicant_documents(app_doc_no) 
                    ON DELETE SET NULL;
                END IF;
            END $$;
            """
        )

        # 4. Backfill existing historical records: pair applicant_status with existing applicant_documents
        cursor.execute(
            """
            UPDATE applicant_status ast
            SET app_doc_no = ad.app_doc_no
            FROM (
                SELECT applicant_no, MIN(app_doc_no) AS app_doc_no
                FROM applicant_documents
                GROUP BY applicant_no
            ) ad
            WHERE ast.applicant_no = ad.applicant_no
              AND ast.app_doc_no IS NULL;
            """
        )

        _SCHEMA_ENSURED = True
        print("[SCHEMA] applicant_status -> applicant_documents FK and historical backfill ensured successfully.", flush=True)
    except Exception as e:
        print(f"[SCHEMA ERROR] ensure_applicant_status_app_doc_no_schema error: {e}", flush=True)


def get_applicant_document_table(cursor):
    for candidate in APPLICANT_DOCUMENT_TABLE_CANDIDATES:
        if _table_exists(cursor, candidate):
            return candidate
    return None


def applicant_document_join_sql(cursor, applicant_alias='a', document_alias='ad', status_alias=None):
    document_table = get_applicant_document_table(cursor)
    if not document_table:
        return ''
    if status_alias:
        try:
            status_cols = [c.lower() for c in get_table_columns(cursor, 'applicant_status')]
            doc_cols = [c.lower() for c in get_table_columns(cursor, document_table)]
            if 'app_doc_no' in status_cols and 'app_doc_no' in doc_cols:
                return f' LEFT JOIN {document_table} {document_alias} ON ({document_alias}.app_doc_no = {status_alias}.app_doc_no OR ({status_alias}.app_doc_no IS NULL AND {document_alias}.app_doc_no = (SELECT MAX(sub_d.app_doc_no) FROM {document_table} sub_d WHERE sub_d.applicant_no = {applicant_alias}.applicant_no))) '
        except Exception:
            pass
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
            subquery_fallback = f'(SELECT sub_d."{real_doc_col}" FROM {document_table} sub_d WHERE sub_d.applicant_no = {applicant_alias}.applicant_no AND sub_d."{real_doc_col}" IS NOT NULL ORDER BY sub_d.app_doc_no DESC LIMIT 1)'
            
            # For face photo / id_pic, if not found, also coalesce with profile_picture
            if column_name.lower() in ('id_pic', 'face_photo', 'facephoto', 'idpic'):
                prof_expr = f'{applicant_alias}.profile_picture' if 'profile_picture' in applicant_col_map else None
                if prof_expr and applicant_expr:
                    return f'COALESCE({document_expr}, {subquery_fallback}, {applicant_expr}, {prof_expr})'
                elif prof_expr:
                    return f'COALESCE({document_expr}, {subquery_fallback}, {prof_expr})'

            if applicant_expr:
                return f'COALESCE({document_expr}, {subquery_fallback}, {applicant_expr})'
            return f'COALESCE({document_expr}, {subquery_fallback})'

    if column_name.lower() in ('id_pic', 'face_photo', 'facephoto', 'idpic') and 'profile_picture' in applicant_col_map:
        return f'{applicant_alias}.profile_picture'

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
        select_parts.append(f'{applicant_document_expr(cursor, column_name, "a", "ad")} AS "{column_name}"')

    if join_param is not None:
        query = f'SELECT {", ".join(select_parts)} FROM applicants a{joins}WHERE a.applicant_no = %s LIMIT 1'
        cursor.execute(query, (join_param, applicant_no))
    else:
        query = f'SELECT {", ".join(select_parts)} FROM applicants a{joins}WHERE a.applicant_no = %s LIMIT 1'
        cursor.execute(query, (applicant_no,))
    row = cursor.fetchone()
    if row:
        if hasattr(row, 'keys'):
            row_dict = dict(row)
        elif cursor.description:
            colnames = [d[0] for d in cursor.description]
            row_dict = dict(zip(colnames, row))
        else:
            row_dict = {}
    else:
        row_dict = {}

    # Robust Fallback: If any requested document column is NULL in the joined row,
    # find the most recent non-null value from applicant_documents for this applicant
    if document_table:
        document_columns = get_table_columns(cursor, document_table)
        doc_col_map = {c.lower(): c for c in document_columns}
        needed_cols = [col for col in requested_columns if row_dict.get(col) is None and doc_col_map.get(col.lower())]
        if needed_cols:
            for col in needed_cols:
                rc = doc_col_map[col.lower()]
                if row_dict.get(col) is None:
                    try:
                        cursor.execute(
                            f'SELECT "{rc}" FROM {document_table} WHERE applicant_no = %s AND "{rc}" IS NOT NULL ORDER BY app_doc_no DESC LIMIT 1',
                            (applicant_no,)
                        )
                        fb_val = cursor.fetchone()
                        if fb_val:
                            val = fb_val.get(rc) if isinstance(fb_val, dict) else fb_val[0]
                            if val is not None:
                                row_dict[col] = val
                    except Exception as fb_err:
                        print(f"[DOC SERVICE] Fallback fetch error for {col}: {fb_err}", flush=True)

        # Additional fallback for id_pic: fallback to applicants.profile_picture if still null
        if ('id_pic' in requested_columns or 'face_photo' in requested_columns or 'facePhoto' in requested_columns) and (row_dict.get('id_pic') is None and row_dict.get('face_photo') is None):
            try:
                cursor.execute('SELECT profile_picture FROM applicants WHERE applicant_no = %s AND profile_picture IS NOT NULL LIMIT 1', (applicant_no,))
                p_row = cursor.fetchone()
                if p_row:
                    p_val = p_row.get('profile_picture') if isinstance(p_row, dict) else p_row[0]
                    if p_val is not None:
                        row_dict['id_pic'] = p_val
                        row_dict['face_photo'] = p_val
            except Exception as p_err:
                print(f"[DOC SERVICE] Profile picture fallback error for id_pic: {p_err}", flush=True)

        if 'profile_picture' in requested_columns and row_dict.get('profile_picture') is None:
            try:
                cursor.execute('SELECT profile_picture FROM applicants WHERE applicant_no = %s AND profile_picture IS NOT NULL LIMIT 1', (applicant_no,))
                p_row = cursor.fetchone()
                if p_row:
                    p_val = p_row.get('profile_picture') if isinstance(p_row, dict) else p_row[0]
                    if p_val is not None:
                        row_dict['profile_picture'] = p_val
            except Exception as p_err:
                print(f"[DOC SERVICE] Profile picture fallback error: {p_err}", flush=True)

    return row_dict


def create_applicant_document_record(cursor, applicant_no, values):
    """
    Creates a new distinct document snapshot record in applicant_documents for a new application.
    Returns the newly created app_doc_no.
    """
    ensure_applicant_status_app_doc_no_schema(cursor)

    is_cloud = os.environ.get('STORE_FILES_IN', 'database').strip().lower() == 'storage'
    doc_cols_lower = {col.lower(): col for col in APPLICANT_DOCUMENT_COLUMNS}
    
    document_values = {}
    for key, value in values.items():
        key_lower = key.lower()
        if key_lower in doc_cols_lower:
            document_values[key] = value

    if is_cloud:
        cleaned_values = {}
        for k, v in document_values.items():
            if isinstance(v, str):
                s = v.strip()
                if s.startswith('blob:') or s.startswith('data:video'):
                    continue
                cleaned_values[k] = s
            else:
                pass
        document_values = cleaned_values

    document_table = get_applicant_document_table(cursor)
    if not document_table:
        return None

    document_columns = get_table_columns(cursor, document_table)
    doc_col_map = {col.lower(): col for col in document_columns}
    filtered_values = {}
    for key, value in document_values.items():
        real_key = doc_col_map.get(key.lower())
        if real_key and value is not None:
            filtered_values[real_key] = value

    # Automatically inherit any missing document values from previous snapshots for this applicant
    try:
        cursor.execute(
            f'SELECT * FROM {document_table} WHERE applicant_no = %s ORDER BY app_doc_no DESC LIMIT 1',
            (applicant_no,)
        )
        prev_row = cursor.fetchone()
        if prev_row:
            prev_dict = dict(prev_row)
            for col in APPLICANT_DOCUMENT_COLUMNS:
                real_col = doc_col_map.get(col.lower())
                if real_col and (real_col not in filtered_values or filtered_values[real_col] is None) and prev_dict.get(real_col) is not None:
                    filtered_values[real_col] = prev_dict[real_col]
        # Also inherit profile_picture into id_pic if still missing
        id_pic_col = doc_col_map.get('id_pic')
        if id_pic_col and (id_pic_col not in filtered_values or filtered_values[id_pic_col] is None):
            cursor.execute('SELECT profile_picture FROM applicants WHERE applicant_no = %s AND profile_picture IS NOT NULL LIMIT 1', (applicant_no,))
            p_res = cursor.fetchone()
            if p_res:
                p_pic = p_res.get('profile_picture') if isinstance(p_res, dict) else p_res[0]
                if p_pic:
                    filtered_values[id_pic_col] = p_pic
    except Exception as inherit_err:
        print(f"[DOC SERVICE] Non-fatal document inheritance error: {inherit_err}", flush=True)

    # Generate next app_doc_no
    cursor.execute(f'SELECT COALESCE(MAX(app_doc_no), 0) + 1 AS next_id FROM {document_table}')
    res = cursor.fetchone()
    next_app_doc_no = res['next_id'] if isinstance(res, dict) else res[0]

    insert_cols = ['"app_doc_no"', '"applicant_no"', *[f'"{col}"' for col in filtered_values.keys()]]
    val_placeholders = ['%s'] * len(insert_cols)
    insert_params = [next_app_doc_no, applicant_no, *filtered_values.values()]

    cursor.execute(
        f'INSERT INTO {document_table} ({", ".join(insert_cols)}) VALUES ({", ".join(val_placeholders)}) RETURNING app_doc_no',
        tuple(insert_params)
    )
    inserted_row = cursor.fetchone()
    app_doc_no = inserted_row['app_doc_no'] if isinstance(inserted_row, dict) else (inserted_row[0] if inserted_row else next_app_doc_no)
    print(f"[DOCUMENT SERVICE] Created separate document snapshot app_doc_no={app_doc_no} for applicant_no={applicant_no}", flush=True)

    return app_doc_no


def persist_applicant_document_values(cursor, applicant_no, values, app_doc_no=None, update_base_profile=True):
    is_cloud = os.environ.get('STORE_FILES_IN', 'database').strip().lower() == 'storage'
    
    doc_cols_lower = {col.lower(): col for col in APPLICANT_DOCUMENT_COLUMNS}
    
    document_values = {}
    for key, value in values.items():
        key_lower = key.lower()
        if key_lower in doc_cols_lower:
            document_values[key] = value

    if not document_values:
        return

    if is_cloud:
        cleaned_values = {}
        for k, v in document_values.items():
            if isinstance(v, str):
                s = v.strip()
                if s.startswith('blob:') or s.startswith('data:video'):
                    print(f"[SERVICE] REJECTED invalid blob/data URL persistence for {k}: {s[:60]}", flush=True)
                    continue
                cleaned_values[k] = s
            else:
                print(f"[SERVICE] WARNING: Rejecting binary persistence for {k} because Cloud Storage is enabled.", flush=True)
        document_values = cleaned_values
        
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
            if app_doc_no:
                # Update specific application document record
                update_assignments = ', '.join(f'"{col}" = %s' for col in filtered_values.keys())
                update_params = [*filtered_values.values(), app_doc_no]
                cursor.execute(
                    f'UPDATE {document_table} SET {update_assignments} WHERE app_doc_no = %s',
                    tuple(update_params),
                )
            elif update_base_profile:
                # Update latest existing row or insert default
                update_assignments = ', '.join(f'"{col}" = %s' for col in filtered_values.keys())
                cursor.execute(
                    f'SELECT app_doc_no FROM {document_table} WHERE applicant_no = %s ORDER BY app_doc_no DESC LIMIT 1',
                    (applicant_no,)
                )
                existing = cursor.fetchone()
                if existing:
                    target_doc_no = existing['app_doc_no'] if isinstance(existing, dict) else existing[0]
                    update_params = [*filtered_values.values(), target_doc_no]
                    cursor.execute(
                        f'UPDATE {document_table} SET {update_assignments} WHERE app_doc_no = %s',
                        tuple(update_params),
                    )
                else:
                    cursor.execute(f'SELECT COALESCE(MAX(app_doc_no), 0) + 1 AS next_id FROM {document_table}')
                    next_res = cursor.fetchone()
                    next_doc_no = next_res['next_id'] if isinstance(next_res, dict) else next_res[0]
                    insert_columns = ['"app_doc_no"', '"applicant_no"', *[f'"{col}"' for col in filtered_values.keys()]]
                    val_exprs = ['%s'] * len(insert_columns)
                    insert_params = [next_doc_no, applicant_no, *filtered_values.values()]
                    cursor.execute(
                        f'INSERT INTO {document_table} ({", ".join(insert_columns)}) VALUES ({", ".join(val_exprs)})',
                        tuple(insert_params)
                    )
    
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