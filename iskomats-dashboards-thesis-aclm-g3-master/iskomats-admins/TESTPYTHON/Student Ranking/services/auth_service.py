import os
import re


DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173,http://localhost:5173/,"
    "http://localhost:3000,http://localhost:3000/,"
    "http://localhost:5174,http://localhost:5174/,"
    "http://localhost:5175,http://localhost:5175/,"
    "https://cozy-kulfi-35f772.netlify.app,"
    "https://stingy-body.surge.sh,"
    "https://foregoing-giants.surge.sh,"
    "https://iskomats-applicants.surge.sh,"
    "https://iskomats-admin.surge.sh,"
    "https://system-kjbv.onrender.com"
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
            # Bulletproof: Also add general surge.sh subdomain pattern
            if 'surge.sh' in host:
                preview_patterns.append(re.compile(r"^https?://[a-z0-9\-]+\.surge\.sh/?$"))

    # Return unique list
    final_origins = list(dict.fromkeys(origins))
    
    # LIBERAL SURGE/NETLIFY SUPPORT: Always allow any surge.sh or netlify.app origin to avoid blockers
    preview_patterns.append(re.compile(r"^https?://[a-z0-9\-]+\.surge\.sh/?$"))
    preview_patterns.append(re.compile(r"^https?://[a-z0-9\-]+\.netlify\.app/?$"))

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

    # Normalize origin for comparison
    normalized_origin = origin.strip().lower()

    # Check exact matches (case-insensitive)
    for allowed in exact_origins:
        if normalized_origin == allowed.strip().lower():
            return True

    # Check regex patterns
    for pattern in regex_origins:
        try:
            if pattern.match(origin):
                return True
        except Exception as e:
            print(f"[CORS] Error matching pattern {pattern}: {e}")

    # GLOBAL OVERRIDE: Allow any surge.sh or netlify.app origin as a safety net
    if normalized_origin.endswith('.surge.sh') or normalized_origin.endswith('.surge.sh/') or \
       normalized_origin.endswith('.netlify.app') or normalized_origin.endswith('.netlify.app/'):
        return True

    # Log only unique rejections to avoid flooding
    print(f"[CORS REJECT] '{origin}' (normalized: '{normalized_origin}') not found in allowed list. Exact: {len(exact_origins)}, Regex: {len(regex_origins)}", flush=True)
    return False