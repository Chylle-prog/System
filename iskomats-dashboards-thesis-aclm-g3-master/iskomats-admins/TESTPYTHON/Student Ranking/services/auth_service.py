import os
import re


DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173,"
    "http://localhost:3000,"
    "http://localhost:5174,"
    "https://cozy-kulfi-35f772.netlify.app,"
    "https://stingy-body.surge.sh,"
    "https://foregoing-giants.surge.sh,"
    "https://system-kjbv.onrender.com"
)


def get_secret_key():
    return os.environ.get('SECRET_KEY', 'development-key-replace-in-production')


def get_allowed_origins():
    configured = os.environ.get('CORS_ORIGINS', '')
    default_origins = [origin.strip() for origin in DEFAULT_CORS_ORIGINS.split(',') if origin.strip()]
    configured_origins = [origin.strip() for origin in configured.split(',') if origin.strip()]
    origins = list(dict.fromkeys([*default_origins, *configured_origins]))
    preview_patterns = []

    for origin in origins:
        if origin.endswith('.netlify.app') and '--' not in origin:
            host = origin.removeprefix('https://').removeprefix('http://')
            preview_patterns.append(re.compile(rf"https://.*--{re.escape(host)}$"))

    return origins + preview_patterns


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

    if origin in exact_origins:
        return True

    return any(pattern.match(origin) for pattern in regex_origins)