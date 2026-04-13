import re
import difflib

HARD_CODED_SCHOOL_NAMES = [
    'DLSL/De La Salle Lipa',
    'NU/National University Lipa',
    'Batangas State University',
    'Kolehiyo ng Lungsod ng Lipa',
    'Philippine State College of Aeronautics',
    'Lipa City Colleges',
    'University of Batangas',
    'New Era University',
    'Batangas College of Arts and Sciences',
    'Royal British College',
    'STI Academic Center',
    'AMA Computer College',
    'ICT-ED'
]

def normalize_school_text(text):
    if not text:
        return ""
    # Remove special characters, convert to lowercase
    text = re.sub(r'[^a-zA-Z0-9\s]', ' ', text.lower())
    # Remove extra whitespace
    return ' '.join(text.split())

def build_school_name_variants(school_name):
    normalized_input = normalize_school_text(school_name)
    variants = set()

    for entry in HARD_CODED_SCHOOL_NAMES:
        aliases = [alias.strip() for alias in entry.split('/') if alias.strip()]
        normalized_aliases = [normalize_school_text(alias) for alias in aliases]
        is_match = normalized_input and any(
            normalized_input in alias or alias in normalized_input
            for alias in normalized_aliases
            if alias
        )

        if is_match:
            variants.update(aliases)

    if not variants and school_name:
        variants.add(school_name.strip())

    expanded = set()
    for variant in variants:
        cleaned = variant.strip()
        if not cleaned:
            continue

        expanded.add(cleaned)
        normalized = normalize_school_text(cleaned)
        if normalized:
            expanded.add(normalized)

        words = [word for word in re.split(r'[\s./-]+', cleaned) if word]
        if len(words) > 1:
            acronym = ''.join(word[0] for word in words if word[0].isalnum()).upper()
            if len(acronym) >= 2:
                expanded.add(acronym)

    return sorted((variant for variant in expanded if len(normalize_school_text(variant)) >= 2), key=len, reverse=True)

def school_name_matches_text(raw_text, school_name, perform_text_matching_fn=None):
    variants = build_school_name_variants(school_name)
    normalized_raw = normalize_school_text(raw_text)
    
    for variant in variants:
        normalized_variant = normalize_school_text(variant)
        if normalized_variant and normalized_variant in normalized_raw:
            return True, variant, variants

    if perform_text_matching_fn:
        _, _, found_keywords, _ = perform_text_matching_fn(
            raw_text,
            keywords=variants
        )
        if found_keywords:
            return True, found_keywords[0], variants

    return False, None, variants
