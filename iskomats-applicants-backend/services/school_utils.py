import re
import difflib

HARD_CODED_SCHOOL_NAMES = [
    'DLSL/De La Salle Lipa/De La Salle',
    'NU/National University Lipa/National University',
    'Batangas State University/BatSU',
    'Kolehiyo ng Lungsod ng Lipa/KLL',
    'Philippine State College of Aeronautics/PhilSCA',
    'Lipa City Colleges/LCC',
    'University of Batangas/UB',
    'New Era University/NEU',
    'Batangas College of Arts and Sciences/BCAS',
    'Royal British College/RBC',
    'STI Academic Center/STI',
    'AMA Computer College/AMA',
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

    # Final fuzzy fallback for institutional names that might be partially misread
    # Use SequenceMatcher to find if any variant phrase exists in a similar form in the OCR text
    for variant in variants:
        norm_var = normalize_school_text(variant)
        # Skip small words/acronyms for fuzzy matching to avoid false positives
        if len(norm_var) < 5: continue
        
        # Sliding window comparison across normalized text
        var_len = len(norm_var)
        for i in range(len(normalized_raw) - var_len + 1):
            chunk = normalized_raw[i:i+var_len]
            if difflib.SequenceMatcher(None, norm_var, chunk).ratio() >= 0.8:
                return True, variant, variants

    return False, None, variants
