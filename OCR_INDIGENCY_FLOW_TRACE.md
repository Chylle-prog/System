# Complete OCR Indigency Verification Flow Trace

## Overview
This document traces the complete flow of indigency document OCR verification in the ISKOMATS system, from the HTTP endpoint to the error conditions.

---

## 1. ENDPOINT ENTRY POINT

**File:** `iskomats-dashboards-thesis-aclm-g3-master/iskomats-admins/TESTPYTHON/Student Ranking/blueprints/student_api.py`  
**Lines:** 1198-1200

```python
@student_api_bp.route('/verification/ocr-check', methods=['POST'])
@token_required
def ocr_check():
    """OCR verification endpoint — supports multi-document authentication in parallel."""
    try:
        data = request.get_json(silent=True) or {}

        # 1. Get applicant record from DB
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT applicant_no, first_name, middle_name, last_name, town_city_municipality, id_img_front, indigency_doc FROM applicants WHERE applicant_no = %s", (request.user_no,))
        applicant = cur.fetchone()

        if not applicant:
            return jsonify({'verified': False, 'message': 'Applicant profile not found'}), 404
```

---

## 2. PARAMETER EXTRACTION & CONSTRUCTION

**File:** Same as above  
**Lines:** 1218-1245

### 2.1 Input Parameters from Request
```python
# 2. Resolve parameters
id_front_param = data.get('id_front') or data.get('idFront')
id_back_param = data.get('id_back') or data.get('idBack')
indigency_doc_param = data.get('indigency_doc') or data.get('indigencyDoc')
enrollment_doc_param = data.get('enrollment_doc') or data.get('enrollmentDoc')
grades_doc_param = data.get('grades_doc') or data.get('gradesDoc')
```

### 2.2 Name Construction
```python
first_name = str(data.get('first_name') or data.get('firstName') or applicant.get('first_name', '')).strip()
middle_name = str(data.get('middle_name') or data.get('middleName') or applicant.get('middle_name', '')).strip()
last_name = str(data.get('last_name') or data.get('lastName') or applicant.get('last_name', '')).strip()

# Construct full expected name for OCR matching
# Include middle name only if it's more than a single character or placeholder
full_expected_name = f"{first_name} {last_name}"
if middle_name and len(middle_name) > 1:
    full_expected_name = f"{first_name} {middle_name} {last_name}"
```

### 2.3 ADDRESS PARAMETER (CRITICAL FOR INDIGENCY)
```python
town_city = str(data.get('town_city') or data.get('townCity') or applicant.get('town_city_municipality', '')).strip()
```

**IMPORTANT:** This parameter comes from:
1. Request JSON as `townCity` or `town_city` (form data)
2. Fallback to applicant database field `town_city_municipality`

### 2.4 Other Parameters
```python
school_name = str(data.get('school_name') or data.get('schoolName') or '').strip()
course = str(data.get('course') or '').strip()
expected_gpa = str(data.get('gpa') or data.get('expectedGPA') or '').strip()
expected_year = str(data.get('expected_year') or data.get('expectedYear') or data.get('yearLevel') or '').strip()
expected_id_no = str(data.get('id_number') or data.get('idNumber') or '').strip()
```

---

## 3. DATA CONVERSION FUNCTIONS

**File:** Same as above  
**Lines:** 203-215

### 3.1 decode_base64
```python
def decode_base64(data_uri):
    if not data_uri or not isinstance(data_uri, str) or ',' not in data_uri:
        return None
    try:
        return base64.b64decode(data_uri.split(',')[1])
    except Exception:
        return None
```

**Potential Data Loss:**
- Returns `None` if `data_uri` is not a string or doesn't contain comma
- Extracts everything after the comma (assumes data URI format: `data:image/png;base64,{base64_content}`)
- Exception silently returns `None` (no error logging)

### 3.2 db_bytes
```python
def db_bytes(value):
    if isinstance(value, memoryview):
        return value.tobytes()
    return value
```

**Potential Data Loss:**
- If value is `memoryview`, converts to bytes
- If conversion fails, returns raw value (may not be usable)

### 3.3 Document Bytes Resolution
```python
def get_bytes(param, db_val):
    return decode_base64(param) or db_bytes(db_val)
```

**Flow for Indigency Document:**
```
get_bytes(indigency_doc_param, applicant.get('indigency_doc'))
    ↓
If indigency_doc_param provided (from form):
    decode_base64(indigency_doc_param)
    ↓
Else if applicant.get('indigency_doc') exists (from DB):
    db_bytes(applicant.get('indigency_doc'))
    ↓
Else:
    None
```

---

## 4. PARALLEL DOCUMENT PROCESSING WORKER

**File:** Same as above  
**Lines:** 1249-1300

### 4.1 Worker Function Definition
```python
def process_doc(doc_type, doc_param, db_val):
    try:
        # Use standard doc bytes for provided parameters, fallback to DB only for Indigency/ID
        doc_bytes = decode_base64(doc_param) if doc_param else (db_bytes(db_val) if db_val else None)
        if not doc_bytes: return None

        # 1. Main OCR Verification (Identity)
        # For Indigency, we also verify the address (town_city)
        # For ID Back, we don't expect the name (as year level is the focus)
        v, msg, raw, _ = verify_id_with_ocr(
            image_bytes=doc_bytes,
            expected_name=full_expected_name if doc_type != 'SchoolIDBack' else None,
            expected_address=town_city if doc_type == 'Indigency' else None
        )
        raw_lower = raw.lower()
```

### 4.2 Indigency-Specific Processing
```python
        elif doc_type == 'Indigency':
            # Note: keyword verification already happens in verify_id_with_ocr()
            # Don't re-check here as OCR extraction can be lossy
            return {'doc': 'Indigency', 'verified': v, 'message': msg, 'raw_text': raw}
```

**Key Point:** No additional validation beyond what `verify_id_with_ocr()` provides.

### 4.3 Error Handler
```python
    except Exception as worker_err:
        print(f"[OCR WORKER ERROR] {doc_type}: {str(worker_err)}", flush=True)
        return {'doc': doc_type, 'verified': False, 'message': f'Processing error: {str(worker_err)}'}
```

---

## 5. OCR VERIFICATION ENGINE

**File:** `iskomats-dashboards-thesis-aclm-g3-master/iskomats-admins/TESTPYTHON/Student Ranking/services/ocr_utils.py`  
**Lines:** 110-230

### 5.1 Function Signature
```python
def verify_id_with_ocr(image_bytes, expected_name, expected_address=None):
    if not _check_tesseract(): 
        return False, "OCR Engine (Tesseract) not found.", "", 0.0
    
    import re
    import difflib
```

### 5.2 Indigency Detection
```python
    # Flag if this is likely an indigency certificate based on expected address presence
    is_indigency = (expected_address is not None) 
```

**CRITICAL LOGIC:** Document is flagged as Indigency if and only if `expected_address` is NOT None.

### 5.3 Internal check_match() Function
**Lines:** 122-192

```python
    def check_match(ocr_text, target_name, target_addr, is_indigency=False):
        norm_txt = normalize_for_ocr(ocr_text)
        all_ocr_words = norm_txt.split()
        
        # 1. Fuzzy Name Matching
        n_verified = True # Default to true if no name to match
        m_ratio = 1.0
        if target_name:
            n_words = [w.strip() for w in normalize_for_ocr(target_name).split() if len(w.strip()) >= 2]
            if not n_words:
                n_words = [w.strip() for w in normalize_for_ocr(target_name).split() if w.strip()]
                
            f_count = 0
            matched_words = []
            for word in n_words:
                # Check for exact substring match first
                if word in norm_txt:
                    f_count += 1
                    matched_words.append(word)
                    continue
                
                # Fuzzy match with individual OCR words
                is_fuzzy = False
                for ocr_w in all_ocr_words:
                    if len(ocr_w) < len(word) - 1: continue 
                    if difflib.SequenceMatcher(None, word, ocr_w).ratio() >= (0.7 if is_indigency else 0.8):
                        is_fuzzy = True
                        matched_words.append(f"{word}~(as {ocr_w})")
                        break
                if is_fuzzy: f_count += 1
                
            m_ratio = f_count / len(n_words) if n_words else 0
            # Extremely permissive for Indigency certificates.
            # Fallback: if we find indigency keywords, lower the threshold even more.
            ind_keywords = ["indigent", "indigency", "barangay", "residency", "social", "welfare"]
            found_ind_kw = any(kw in norm_txt for kw in ind_keywords)
            
            pass_threshold = 0.25 if is_indigency else 0.6
            if is_indigency and found_ind_kw:
                pass_threshold = 0.05 # Only need 5% name match if keywords are found
                
            n_verified = m_ratio >= pass_threshold
        
        if not n_verified and is_indigency:
            print(f"[OCR DEBUG] Name mismatch for Indigency. Expected: {target_name} | Ratio: {m_ratio:.2f} | KW Found: {found_ind_kw}", flush=True)

        # 2. Address Matching
        a_verified = True
        if target_addr:
            norm_target_addr = normalize_for_ocr(target_addr)
            if norm_target_addr in norm_txt:
                a_verified = True
            else:
                a_words = [w.strip() for w in norm_target_addr.split() if len(w.strip()) >= 2]
                if not a_words:
                    a_words = [w.strip() for w in norm_target_addr.split() if w.strip()]
                
                f_a_count = 0
                for word in a_words:
                    if word in norm_txt: f_a_count += 1; continue
                    for ocr_w in all_ocr_words:
                        if len(ocr_w) < 2: continue
                        if difflib.SequenceMatcher(None, word, ocr_w).ratio() >= 0.7:
                            f_a_count += 1
                            break
                
                a_match_ratio = f_a_count / len(a_words) if a_words else 0
                # Address matching for Indigency is also more permissive (25% match required)
                a_verified = a_match_ratio >= 0.25 if is_indigency else 0.5
        
        return n_verified, a_verified, m_ratio
```

#### Name Matching Parameters for Indigency:
- **Fuzzy threshold:** 0.7 (vs 0.8 for other doc types)
- **Pass threshold (default):** 0.25 = 25% of name words must match (vs 0.6 = 60% for others)
- **Pass threshold (with keywords):** 0.05 = 5% of name words must match if keywords found
- **Keywords searched:** `["indigent", "indigency", "barangay", "residency", "social", "welfare"]`

#### Address Matching Parameters for Indigency:
- **Pass threshold:** 0.25 = 25% of address words must match (vs 0.5 = 50% for others)
- **Fuzzy threshold:** 0.7 for all address words

### 5.4 OCR Text Extraction Passes
**Lines:** 194-207

```python
    # Pass 1: Fast Mode
    text = _run_tesseract(image_bytes, fast_mode=True)
    name_v, addr_v, ratio = check_match(text, expected_name, expected_address, is_indigency)
    
    # Pass 2: Retry with Full Preprocessing
    if not (name_v and addr_v) and image_bytes:
        text_full = _run_tesseract(image_bytes, fast_mode=False)
        name_v_f, addr_v_f, ratio_f = check_match(text_full, expected_name, expected_address, is_indigency)
        if (name_v_f and addr_v_f) or ratio_f > ratio:
            text, name_v, addr_v, ratio = text_full, name_v_f, addr_v_f, ratio_f

    # Slow passes (PSM 11/6) removed to prevent timeouts on Render CPU
```

**Flow:**
1. First attempt with fast Tesseract mode
2. If verification fails, retry with full preprocessing (image enhancement, deskewing, etc.)
3. Uses the result that has better match or both conditions satisfied
4. Slow passes explicitly removed to avoid server timeout on limited CPU (512MB RAM Render.com)

### 5.5 Ultimate Fallback for Indigency
**Lines:** 210-215

```python
    # Ultimate fallback for Indigency: If we found keywords, we are much more lenient on the final result
    ind_keywords = ["indigent", "indigency", "barangay", "residency", "social", "welfare"]
    found_ind_kw = any(kw.lower() in text.lower() for kw in ind_keywords)
    
    if is_indigency and found_ind_kw and (name_v or addr_v or ratio >= 0.05):
        return True, f"Indigency verified primarily via keywords ({ratio:.0%} name match).", text, 1.0
```

**Success Condition:** If is_indigency AND keywords found AND (name matched OR address matched OR ratio >= 5%)

### 5.6 Final Decision Logic
**Lines:** 216-224

```python
    if name_v and addr_v:
        return True, "Name and Address verified via OCR.", text, 1.0
    elif name_v:
        return False, "Address mismatch", text, 0.7
    
    if ratio >= 0.3: # Return partial match if at least 30% matches
        return False, f"Identity check: Name partially matched ({ratio:.0%}). Please ensure image is clear.", text, ratio
        
    print(f"[OCR] Verification Failed. Expected: '{expected_name}'. Ratio: {ratio:.2f}", flush=True)
    return False, "Identity verification mismatch", text, 0.0
```

---

## 6. ERROR CONDITION TREE

### 6.1 "Identity verification mismatch" Error

**Triggered When:**
```python
return False, "Identity verification mismatch", text, 0.0
```

**ALL of these must be true:**
1. NOT (name_verified AND address_verified)
2. NOT (name_verified AND address_verified AND keyword_fallback_applied)
3. ratio < 0.3 (less than 30% name match for partial match)

**Conditions:**

| Condition | For Indigency | For Other Docs |
|-----------|---------------|-----------------|
| Name threshold (no keywords) | 0.25 (25%) | 0.60 (60%) |
| Name threshold (with keywords) | 0.05 (5%) | N/A |
| Address threshold | 0.25 (25%) | 0.50 (50%) |
| Partial match threshold | 0.30 (30%) | 0.30 (30%) |

### 6.2 Debugging Output
**Line:** 166 in ocr_utils.py
```python
if not n_verified and is_indigency:
    print(f"[OCR DEBUG] Name mismatch for Indigency. Expected: {target_name} | Ratio: {m_ratio:.2f} | KW Found: {found_ind_kw}", flush=True)
```

**Line:** 224
```python
print(f"[OCR] Verification Failed. Expected: '{expected_name}'. Ratio: {ratio:.2f}", flush=True)
```

These print statements to stdout/stderr can be used for debugging.

---

## 7. JOB SCHEDULING

**File:** `blueprints/student_api.py`  
**Lines:** 1301-1320

### 7.1 Job Queue Construction
```python
        jobs = []
        if enrollment_doc_param: jobs.append(('Enrollment', enrollment_doc_param, None))
        if grades_doc_param: jobs.append(('Grades', grades_doc_param, None))
        if indigency_doc_param or (not enrollment_doc_param and not grades_doc_param and not id_front_param):
            jobs.append(('Indigency', indigency_doc_param, applicant.get('indigency_doc')))
        if id_front_param:
            jobs.append(('SchoolID', id_front_param, applicant.get('id_img_front')))
        if id_back_param:
            jobs.append(('SchoolIDBack', id_back_param, applicant.get('id_img_back')))
```

**Indigency Processing Logic:**
- Processed if `indigency_doc_param` is provided
- OR if no other documents are provided (default workflow)

### 7.2 Parallel Execution
```python
        results = []
        overall_verified = True
        if jobs:
            # Sequential processing is safer for low-memory environments (avoiding OOM crashes)
            # Use max_workers=1 to process documents one by one
            with ThreadPoolExecutor(max_workers=1) as executor:
                # Store by doc_type to ensure we can track which one finished
                future_results = [executor.submit(process_doc, *job) for job in jobs]
                for future in future_results:
                    try:
                        res = future.result(timeout=60) # 60 second timeout per doc
                        if res:
                            results.append(res)
                            if not res.get('verified', False):
                                overall_verified = False
                    except Exception as future_err:
                        print(f"[OCR ERROR] {str(future_err)}", flush=True)
                        results.append({'doc': 'Verification', 'verified': False, 'message': f'Thread timeout/error: {str(future_err)}'})
                        overall_verified = False
```

**Key Points:**
- Uses `ThreadPoolExecutor` with `max_workers=1` (sequential, not parallel)
- 60-second timeout per document
- Memory constraint: "safer for low-memory environments (avoiding OOM crashes)"
- If any document fails, `overall_verified = False`

---

## 8. RESPONSE CONSTRUCTION

**File:** `blueprints/student_api.py`  
**Lines:** 1322-1326

```python
        if not results:
            return jsonify({'verified': False, 'message': 'No documents provided for verification'}), 400

        final_msg = " | ".join([f"{r['doc']}: {r['message']}" for r in results])
        return jsonify({'verified': overall_verified, 'message': final_msg, 'results': results})
```

**Response JSON:**
```json
{
  "verified": true/false,
  "message": "Indigency: Identity verification mismatch | ...",
  "results": [
    {
      "doc": "Indigency",
      "verified": false,
      "message": "Identity verification mismatch",
      "raw_text": "... OCR extracted text ..."
    }
  ]
}
```

---

## 9. COMPLETE EXECUTION FLOW DIAGRAM

```
┌─────────────────────────────────────────────────────────────────┐
│ POST /api/student/verification/ocr-check                        │
│ {                                                               │
│   "indigencyDoc": "data:image/png;base64,iVBORw0K...",          │
│   "townCity": "Makati City"                                     │
│ }                                                               │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ ocr_check() endpoint (Line 1200)                                │
│ - Query applicant from DB                                       │
│ - Extract parameters from request + DB                          │
│ - expected_name = "John Doe"                                    │
│ - expected_address = "Makati City"                              │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ decode_base64(indigencyDoc) or db_bytes(DB_value)               │
│ - Extracts bytes from base64 data URI                           │
│ - POTENTIAL DATA LOSS: Returns None if comma not found          │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ process_doc('Indigency', doc_param, db_val) (Line 1249)         │
│ - Gets document bytes                                           │
│ - Calls verify_id_with_ocr()                                    │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ verify_id_with_ocr(                                             │
│   image_bytes = <indigency_bytes>,                              │
│   expected_name = "John Doe",                                   │
│   expected_address = "Makati City"  ← SETS is_indigency = True  │
│ ) (Line 110)                                                    │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ _run_tesseract(image_bytes, fast_mode=True) - PASS 1            │
│ check_match(ocr_text, expected_name, expected_address, True)    │
│                                                                 │
│ NAME MATCHING:                                                  │
│ - Fuzzy threshold: 0.7                                          │
│ - Pass threshold: 0.25 (or 0.05 if keywords found)              │
│ - Keywords: ["indigent", "indigency", "barangay", ...]          │
│                                                                 │
│ ADDRESS MATCHING:                                               │
│ - Pass threshold: 0.25                                          │
│ - Fuzzy threshold: 0.7                                          │
│                                                                 │
│ Returns: (name_verified, addr_verified, ratio)                  │
└─────────────────────────────────────────────────────────────────┘
                            ↓
         IF NOT (name_v AND addr_v):
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ _run_tesseract(image_bytes, fast_mode=False) - PASS 2           │
│ (Full preprocessing: enhancement, deskewing, binary, etc.)      │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ ULTIMATE INDIGENCY FALLBACK (Line 214)                          │
│ IF is_indigency AND keywords_found AND                          │
│    (name_v OR addr_v OR ratio >= 0.05):                         │
│     RETURN: True, "Indigency verified primarily via keywords"   │
└─────────────────────────────────────────────────────────────────┘
                            ↓
        IF NOT (match_condition):
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ FINAL DECISION (Line 216-224)                                   │
│                                                                 │
│ IF name_v AND addr_v:                                           │
│   RETURN: True, "Name and Address verified via OCR."            │
│                                                                 │
│ ELIF ratio >= 0.3:                                              │
│   RETURN: False, "Identity check: Name partially matched..."    │
│                                                                 │
│ ELSE:                                                           │
│   RETURN: False, "Identity verification mismatch"               │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Return to process_doc()                                         │
│ {                                                               │
│   "doc": "Indigency",                                           │
│   "verified": false,                                            │
│   "message": "Identity verification mismatch",                  │
│   "raw_text": "... OCR extracted text ..."                      │
│ }                                                               │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ RESPONSE to Client (Line 1326)                                  │
│ {                                                               │
│   "verified": false,                                            │
│   "message": "Indigency: Identity verification mismatch",       │
│   "results": [...]                                              │
│ }                                                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 10. POTENTIAL DATA LOSS POINTS SUMMARY

### 10.1 Base64 Decoding
**File:** `blueprints/student_api.py`, Line 203-210
- **Risk:** Returns `None` if data_uri doesn't contain comma
- **Impact:** Image not processed, document verification skipped
- **No logging:** Silent failure

### 10.2 Memoryview Conversion
**File:** `blueprints/student_api.py`, Line 212-215
- **Risk:** Exception during `.tobytes()` conversion
- **Impact:** Returns unconverted memoryview, may fail in Tesseract
- **No logging:** Silent failure or OCR error

### 10.3 OCR Text Extraction
**File:** `services/ocr_utils.py`, Line 194-207
- **Risk:** Tesseract inaccuracy, especially with low-quality images
- **Impact:** Keywords may not be detected, fuzzy matching may fail
- **Mitigation:** Dual-pass (fast + full preprocessing)

### 10.4 Normalization Loss
**File:** `services/ocr_utils.py`, Line 117-120
```python
def normalize_for_ocr(s):
    if not s: return ""
    # Remove punctuation like . , ( ) etc and normalize spaces
    return re.sub(r'[^a-z0-9\s]', ' ', s.lower()).strip()
```
- **Risk:** Stripping punctuation and converting to lowercase
- **Impact:** "O'Brien" → "obrien", Important hyphens removed
- **Expected Impact:** May cause false negatives for names with special characters

### 10.5 Keyword Matching Sensitivity
**File:** `services/ocr_utils.py`, Line 156, 211
- **Risk:** Keywords are case-sensitive after normalization
- **Impact:** If OCR misses keywords, fallback threshold remains 0.25 (not 0.05)
- **Mitigation:** Final keyword check uses `.lower()` comparison

---

## 11. SUMMARY TABLE: THRESHOLDS BY DOCUMENT TYPE

| Metric | Indigency | School ID Front | ID Back | Enrollment | Grades |
|--------|-----------|-----------------|---------|------------|--------|
| Name Fuzzy Threshold | 0.7 | 0.8 | 0.8 | 0.8 | 0.8 |
| Name Pass Threshold (no KW) | 0.25 | 0.60 | N/A | 0.60 | 0.60 |
| Name Pass Threshold (with KW) | 0.05 | N/A | N/A | N/A | N/A |
| Address Pass Threshold | 0.25 | N/A | N/A | N/A | N/A |
| Partial Match Threshold | 0.30 | 0.30 | 0.30 | 0.30 | 0.30 |
| Keyword Set | "indigent", "indigency", "barangay", "residency", "social", "welfare" | N/A | N/A | "enrollment", "registration", "admission", "cor", "coe" | "grades", "transcript", "evaluation", "scholastic" |

---

## 12. CONFIGURATION

### Environment Variables Used
- `TESSERACT_CMD`: Tesseract executable path (defaults to Windows path)
- `PASSWORD_RESET_EXPIRY_MINUTES`: Email verification expiry

### Hardware Constraints
- **Memory:** 512MB (Render.com free tier)
- **CPU:** Limited (Render.com free tier has CPU throttling)
- **Impact:** Slow passes removed to prevent timeouts

### Processing Strategy
- **Threading:** `max_workers=1` (sequential processing)
- **Timeout:** 60 seconds per document
- **Image preprocessing:** Binary thresholding, morphological ops
- **OCR Modes:** PSM 3 (fast) and multiple strategies (full)

---

## 13. INTEGRATION POINTS

###Calling Locations
1. **Frontend:** `iskomats-verifier-bench/index-standalone.html` - Test OCR verification
2. **Frontend:** `iskomats-admins/src/Pages/Dash/**` - Display verification results
3. **API Consumer:** Any client calling `POST /api/student/verification/ocr-check`

### Database Tables Involved
- `applicants` table: `first_name`, `last_name`, `middle_name`, `town_city_municipality`, `id_img_front`, `indigency_doc`

---

## 14. RECENT CHANGES & CONDITIONALS

**Recent Changes in Code:**
1. Dual-pass OCR (fast + full preprocessing) to improve accuracy
2. Keyword fallback for indigency (very permissive: 5% threshold)
3. Sequential processing (`max_workers=1`) instead of parallel to avoid OOM
4. Removal of slow OCR passes (PSM 11/6) to prevent timeouts

**Conditionals Affecting Indigency:**
1. `is_indigency = (expected_address is not None)` - CRITICAL
2. `if is_indigency and found_ind_kw:` - Keyword fallback
3. `pass_threshold = 0.05 if is_indigency and found_ind_kw else 0.25` - Threshold adjustment

