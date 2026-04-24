import os
import base64
import time
import logging
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException, Body, Header
from pydantic import BaseModel, Field
import uvicorn
from fastapi.middleware.cors import CORSMiddleware

# Import your existing tweaked logic
# We keep the imports relative to the backend root
from services.ocr_utils import (
    verify_id_with_ocr, 
    verify_face_with_id,
    _perform_text_matching,
    extract_document_text,
    student_name_matches_text,
    student_id_no_matches_text,
    year_level_matches_text,
    course_matches_text,
    gpa_matches_text,
    academic_year_matches_expected,
    extract_school_year_from_text,
    extract_semester_from_text,
    normalize_semester_label
)
from services.school_utils import school_name_matches_text

# Configure Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("verification-service")

app = FastAPI(
    title="Iskomats High-Performance Verification Service",
    description="FastAPI-based OCR and Validation engine for Iskomats scholarship system.",
    version="1.0.0"
)

# Enable CORS (Internal only usually, but good for testing)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- MODELS (Mirroring your Flask payloads) ---

class BaseVerificationRequest(BaseModel):
    first_name: str = Field(..., alias="firstName")
    middle_name: Optional[str] = Field("", alias="middleName")
    last_name: str = Field(..., alias="lastName")
    
    class Config:
        allow_population_by_field_name = True

class IDVerificationRequest(BaseVerificationRequest):
    image_base64: str = Field(..., alias="image")
    id_no: Optional[str] = Field(None, alias="idNo")
    year_level: Optional[str] = Field(None, alias="yearLevel")
    school_name: Optional[str] = Field(None, alias="schoolName")
    address: Optional[str] = Field(None, alias="address")

class DocumentVerificationRequest(BaseVerificationRequest):
    image_base64: str = Field(..., alias="image")
    doc_type: str = Field(..., alias="docType")
    expected_address: Optional[str] = Field(None, alias="address")
    expected_id_no: Optional[str] = Field(None, alias="idNo")
    expected_school_name: Optional[str] = Field(None, alias="schoolName")
    # Academic specific
    expected_gpa: Optional[str] = Field(None, alias="gpa")
    expected_year_level: Optional[str] = Field(None, alias="yearLevel")
    expected_academic_year: Optional[str] = Field(None, alias="academicYear")
    expected_semester: Optional[str] = Field(None, alias="semester")
    expected_course: Optional[str] = Field(None, alias="course")

class FaceVerificationRequest(BaseModel):
    id_image_base64: str = Field(..., alias="idImage")
    live_face_base64: str = Field(..., alias="liveFace")


# --- ENDPOINTS ---

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "iskomats-verification-fastapi", "timestamp": time.time()}

@app.post("/verify/id")
def api_verify_id(req: IDVerificationRequest):
    """
    Wraps the existing verify_id_with_ocr function.
    Maintains all existing tweaks and regex logic.
    """
    start_time = time.time()
    try:
        # Decode image
        try:
            image_bytes = base64.b64decode(req.image_base64.split(',')[-1])
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid base64 image data")

        logger.info(f"Processing ID Verification for {req.first_name} {req.last_name}")
        
        # CALLING THE ORIGINAL TWEAKED LOGIC
        # This ensures every regex and threshold fix you made is preserved.
        success, message, detected_text, ratio = verify_id_with_ocr(
            image_bytes,
            req.first_name,
            req.middle_name,
            req.last_name,
            expected_address=req.address,
            expected_id_no=req.id_no,
            expected_year_level=req.year_level,
            expected_school_name=req.school_name
        )
        
        process_time = time.time() - start_time
        logger.info(f"Verification complete in {process_time:.2f}s. Success: {success}")

        return {
            "success": success,
            "message": message,
            "detected_text": detected_text[:500] if detected_text else "", # Limit return size
            "match_ratio": ratio,
            "performance": {
                "total_time": process_time
            }
        }
    except Exception as e:
        logger.error(f"Error in ID Verification: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/verify/document")
def api_verify_document(req: DocumentVerificationRequest):
    """
    Handles specialized verification for Enrollment, Grades, and Indigency.
    Ported directly from student_api.py run_ocr_check logic.
    """
    start_time = time.time()
    try:
        image_bytes = base64.b64decode(req.image_base64.split(',')[-1])
        doc_type = req.doc_type
        
        # Imports needed for local logic (already in verification_service)
        from services.ocr_utils import (
            extract_document_text, student_name_matches_text, 
            _perform_text_matching, verify_id_with_ocr
        )

        raw_t = ""
        v_t = False
        msg = ""
        meta = {}

        if doc_type == 'Enrollment':
            raw_t, _ = extract_document_text(image_bytes, max_width=1200, prefer_fast_layout=False, crop_percent=1.0)
            
            # 1. Name Check
            name_ok, name_ratio, name_details = student_name_matches_text(raw_t, req.first_name, req.middle_name, req.last_name)
            
            # 2. School Check
            school_ok = True
            if req.expected_school_name:
                school_ok, _, _ = school_name_matches_text(raw_t, req.expected_school_name)
                
            # 3. Year Level Check (Disabled as per Flask parity)
            year_lvl_ok = True
                
            # 4. Course Check
            course_ok = True
            if req.expected_course:
                course_ok, _ = course_matches_text(raw_t, req.expected_course)
                
            # 5. Academic Year Check
            ay_ok = True
            if req.expected_academic_year:
                found_ay = extract_school_year_from_text(raw_t)
                ay_ok = academic_year_matches_expected(found_ay, req.expected_academic_year)
                
            # 6. Semester Check
            sem_ok = True
            if req.expected_semester:
                found_sem = extract_semester_from_text(raw_t)
                sem_ok = (normalize_semester_label(found_sem) == normalize_semester_label(req.expected_semester))
            
            # 7. ID Check (New: Parity with Flask)
            id_ok = True
            if req.expected_id_no:
                id_ok, _ = student_id_no_matches_text(req.expected_id_no, raw_t)

            v_t = name_ok and school_ok and year_lvl_ok and course_ok and ay_ok and sem_ok and id_ok
            msg = f"Checklist: [Name: {'OK' if name_ok else 'X'} | School: {'OK' if school_ok else 'X'} | ID: {'OK' if id_ok else 'X'} | Year: {'OK' if ay_ok else 'X'} | Sem: {'OK' if sem_ok else 'X'} | Level: {'OK' if year_lvl_ok else 'X'} | Course: {'OK' if course_ok else 'X'}]"
            if v_t: msg = "Verified"
            meta = {'name_ok': name_ok, 'school_ok': school_ok, 'id_ok': id_ok, 'ay_ok': ay_ok, 'sem_ok': sem_ok, 'year_lvl_ok': year_lvl_ok, 'course_ok': course_ok, 'name_details': name_details}
        
        elif doc_type == 'Grades':
            raw_t, _ = extract_document_text(image_bytes, max_width=1200, prefer_fast_layout=False, crop_percent=1.0)
            
            # 1. Name Check
            name_ok, name_ratio, name_details = student_name_matches_text(raw_t, req.first_name, req.middle_name, req.last_name)
            
            # 2. School Check
            school_ok = True
            if req.expected_school_name:
                school_ok, _, _ = school_name_matches_text(raw_t, req.expected_school_name)
                
            # 3. GPA Check
            gpa_ok = True
            if req.expected_gpa:
                gpa_ok, _, _ = gpa_matches_text(raw_t, req.expected_gpa)
                
            # 4. Academic Year Check
            ay_ok = True
            if req.expected_academic_year:
                found_ay = extract_school_year_from_text(raw_t)
                ay_ok = academic_year_matches_expected(found_ay, req.expected_academic_year)

            # 5. ID Check (New: Parity with Flask)
            id_ok = True
            if req.expected_id_no:
                id_ok, _ = student_id_no_matches_text(req.expected_id_no, raw_t)

            # 6. Course Check
            course_ok = True
            if req.expected_course:
                course_ok, _ = course_matches_text(raw_t, req.expected_course)

            # 7. Semester Check
            sem_ok = True
            if req.expected_semester:
                found_sem = extract_semester_from_text(raw_t)
                sem_ok = (normalize_semester_label(found_sem) == normalize_semester_label(req.expected_semester))

            v_t = name_ok and school_ok and gpa_ok and ay_ok and id_ok and course_ok and sem_ok
            msg = f"Checklist: [Name: {'OK' if name_ok else 'X'} | School: {'OK' if school_ok else 'X'} | GPA: {'OK' if gpa_ok else 'X'} | Year: {'OK' if ay_ok else 'X'} | Sem: {'OK' if sem_ok else 'X'} | ID: {'OK' if id_ok else 'X'} | Course: {'OK' if course_ok else 'X'}]"
            if v_t: msg = "Verified"
            meta = {'name_ok': name_ok, 'school_ok': school_ok, 'gpa_ok': gpa_ok, 'ay_ok': ay_ok, 'sem_ok': sem_ok, 'id_ok': id_ok, 'course_ok': course_ok, 'name_details': name_details}
            
        elif doc_type == 'SchoolIDBack':
            raw_t, _ = extract_document_text(image_bytes, is_id_back=True)
            v_t = bool(raw_t and raw_t.strip())
            msg = 'Verified' if v_t else 'Unable to read school ID back text'
            
        elif doc_type == 'Indigency':
            # TWEAK: High res (1200) and 85% crop for certificates
            raw_t, _ = extract_document_text(image_bytes, max_width=1200, prefer_fast_layout=False, crop_percent=0.85)
            name_ok, name_ratio, name_details = student_name_matches_text(raw_t, req.first_name, req.middle_name, req.last_name, is_indigency=True)
            _, addr_ok, found_keywords, _, detect_meta = _perform_text_matching(raw_t, None, None, None, req.expected_address, is_indigency=True)
            
            detected_brgys = detect_meta.get('detected_brgy', [])
            addr_final_ok = addr_ok if req.expected_address else False
            
            v_t = name_ok and addr_final_ok
            brgy_str = ", ".join(detected_brgys) if detected_brgys else "None detected"
            status_addr = 'OK' if addr_final_ok else 'X'
            msg = f"Checklist: [First: {'OK' if name_details.get('first_ok') else 'X'} | Last: {'OK' if name_details.get('last_ok') else 'X'} | Addr: {status_addr} (Target: {req.expected_address or 'Missing'}, Found: {brgy_str})]"
            meta = {'name_ok': name_ok, 'addr_ok': addr_final_ok, 'name_ratio': name_ratio, 'keywords': found_keywords, 'detected_brgy': detected_brgys}
            
        elif doc_type == 'SchoolID':
            logger.info(f"[FASTAPI-DIAG] SchoolID verify called with: first='{req.first_name}', middle='{req.middle_name}', last='{req.last_name}', id_no='{req.expected_id_no}', school='{req.expected_school_name}', image_bytes={len(image_bytes)}")
            v_t, msg, raw_t, meta = verify_id_with_ocr(
                image_bytes, req.first_name, req.middle_name, req.last_name, 
                expected_address=None, # DO NOT pass address for ID to avoid mis-triggering Indigency scanning logic
                expected_id_no=req.expected_id_no, 
                expected_school_name=req.expected_school_name
            )
            logger.info(f"[FASTAPI-DIAG] SchoolID result: v_t={v_t}, msg='{msg}', raw_text_len={len(raw_t) if raw_t else 0}")

        else:
            # Fallback for unknown types
            v_t, msg, raw_t, meta = verify_id_with_ocr(
                image_bytes, req.first_name, req.middle_name, req.last_name, 
                expected_address=None, 
                expected_id_no=req.expected_id_no, 
                expected_school_name=req.expected_school_name
            )

        return {
            "success": v_t,
            "message": msg,
            "detected_text": raw_t[:2000] if raw_t else "",
            "meta": meta,
            "performance": {"total_time": time.time() - start_time}
        }
    except Exception as e:
        logger.error(f"Error in Document Verification: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/verify/face")
async def api_verify_face(req: FaceVerificationRequest):
    """
    Wraps verify_face_with_id using UniFace/DeepFace.
    """
    start_time = time.time()
    try:
        id_bytes = base64.b64decode(req.id_image_base64.split(',')[-1])
        face_bytes = base64.b64decode(req.live_face_base64.split(',')[-1])
        
        # CALLING ORIGINAL LOGIC
        success, message, confidence = verify_face_with_id(id_bytes, face_bytes)
        
        return {
            "success": success,
            "message": message,
            "confidence": confidence,
            "process_time": time.time() - start_time
        }
    except Exception as e:
        logger.error(f"Error in Face Verification: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/extract/text")
async def api_extract_text(payload: Dict[str, str] = Body(...)):
    """
    Generic text extraction helper for any document.
    """
    try:
        image_base64 = payload.get("image")
        if not image_base64:
            raise HTTPException(status_code=400, detail="Image data required")
            
        image_bytes = base64.b64decode(image_base64.split(',')[-1])
        text = extract_document_text(image_bytes)
        
        return {"text": text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    # PORT 8001 to avoid conflict with Flask's 10000 or 5000
    port = int(os.environ.get("VERIFICATION_PORT", 8001))
    uvicorn.run(app, host="0.0.0.0", port=port)
