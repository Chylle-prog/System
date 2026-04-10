import os
import re


DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173,http://localhost:5173/,"
    "http://localhost:3000,http://localhost:3000/,"
    "http://localhost:5174,http://localhost:5174/,"
    "http://localhost:5175,http://localhost:5175/,"
    "https://cozy-kulfi-35f772.netlify.app,https://cozy-kulfi-35f772.netlify.app/,"
    "https://stingy-body.surge.sh,https://stingy-body.surge.sh/,"
    "https://foregoing-giants.surge.sh,https://foregoing-giants.surge.sh/,"
    "https://iskomats-admin.surge.sh,https://iskomats-admin.surge.sh/,"
    "https://system-kjbv.onrender.com,https://system-kjbv.onrender.com/"
)


def get_secret_key():
    return os.environ.get('SECRET_KEY', 'development-key-replace-in-production')


def get_allowed_origins():
    configured = os.environ.get('CORS_ORIGINS', '')
    default_origins = [origin.strip() for origin in DEFAULT_CORS_ORIGINS.split(',') if origin.strip()]
    configured_origins = [origin.strip() for origin in configured.split(',') if origin.strip()]
    
    # Combine and ensure uniqueness
    raw_origins = list(dict.fromkeys([*default_origins, *configured_origins]))
    
    origins = []
    preview_patterns = []

    for origin in raw_origins:
        # For every origin, ensure we have both the version with and without trailing slash
        base_origin = origin.rstrip('/')
        origins.append(base_origin)
        origins.append(base_origin + '/')
        
        # Wildcard support for surge.sh and netlify.app
        if base_origin.endswith('.surge.sh') or base_origin.endswith('.netlify.app'):
            host = base_origin.removeprefix('https://').removeprefix('http://').split('/')[0]
            # Match current host and any subdomains
            preview_patterns.append(re.compile(rf"^https?://([a-z0-9\-]+\.)*{re.escape(host)}/?$"))
            # Also add common pattern for surge.sh generally
            if 'surge.sh' in host:
                preview_patterns.append(re.compile(rf"^https?://[a-z0-9\-]+\.surge\.sh/?$"))

    # Return unique list
    final_origins = list(dict.fromkeys(origins))
    return final_origins + preview_patterns


def split_allowed_origins(origins):
    exact_origins = []
    regex_origins = []

    for origin in origins:
        if hasattr(origin, 'match'):
            regex_origins.append(origin)
        else:
            exact_origins.append(origin)

    return exact_origins, regex_origins


def is_origin_allowed(origin, exact_origins, regex_origins):
    if not origin:
        return False

    # Check exact matches (including those we added with/without slashes)
    if origin in exact_origins:
        # Only log sparingly to avoid flooding logs
        return True

    # Check regex patterns
    for pattern in regex_origins:
        if pattern.match(origin):
            return True

    print(f"[CORS REJECT] '{origin}' not in allowed list ({len(exact_origins)} exact, {len(regex_origins)} patterns)", flush=True)
    return False