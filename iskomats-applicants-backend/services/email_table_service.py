USER_EMAIL_TABLE_CANDIDATES = ('user_email', 'user_emails')
APPLICANT_EMAIL_TABLE_CANDIDATES = ('applicant_email', 'applicant_emails')

_RESOLVED_AUTH_TABLES = {}


def resolve_auth_table(cursor, account_kind):
    if account_kind not in ('user', 'applicant'):
        raise ValueError(f'Unsupported account kind: {account_kind}')

    cached = _RESOLVED_AUTH_TABLES.get(account_kind)
    if cached:
        return cached

    candidates = (
        USER_EMAIL_TABLE_CANDIDATES
        if account_kind == 'user'
        else APPLICANT_EMAIL_TABLE_CANDIDATES
    )

    for candidate in candidates:
        cursor.execute(
            """
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = ANY (current_schemas(FALSE))
                  AND table_name = %s
            ) AS exists
            """,
            (candidate,),
        )
        row = cursor.fetchone()
        exists = row.get('exists') if hasattr(row, 'get') else row[0]
        if exists:
            _RESOLVED_AUTH_TABLES[account_kind] = candidate
            return candidate

    raise RuntimeError(
        f"Could not find a table for '{account_kind}'. Tried: {', '.join(candidates)}"
    )


def get_user_email_table(cursor):
    return resolve_auth_table(cursor, 'user')


def get_applicant_email_table(cursor):
    return resolve_auth_table(cursor, 'applicant')


def make_account_identifier(account_type, email_id):
    normalized = (account_type or '').strip().lower()
    if normalized == 'admin':
        return f'admin-{email_id}'
    if normalized == 'applicant':
        return f'applicant-{email_id}'
    raise ValueError(f'Unsupported account type: {account_type}')


def parse_account_identifier(account_id):
    raw_value = str(account_id or '').strip()
    if raw_value.startswith('admin-'):
        suffix = raw_value[6:]
        if suffix.isdigit():
            return 'admin', int(suffix)
    elif raw_value.startswith('applicant-'):
        suffix = raw_value[10:]
        if suffix.isdigit():
            return 'applicant', int(suffix)
    elif raw_value.isdigit():
        return None, int(raw_value)

    raise ValueError('Invalid account identifier')
