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
    extract_document_text
)

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

class FaceVerificationRequest(BaseModel):
    id_image_base64: str = Field(..., alias="idImage")
    live_face_base64: str = Field(..., alias="liveFace")

class DocumentVerificationRequest(BaseVerificationRequest):
    image_base64: str = Field(..., alias="image")
    document_type: str = Field(..., alias="docType") # 'grades', 'coe', 'indigency'
    expected_gpa: Optional[float] = Field(None, alias="expectedGpa")
    expected_year: Optional[str] = Field(None, alias="expectedYear")
    expected_semester: Optional[str] = Field(None, alias="expectedSemester")

# --- ENDPOINTS ---

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "iskomats-verification-fastapi", "timestamp": time.time()}

@app.post("/verify/id")
async def api_verify_id(req: IDVerificationRequest):
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
async def api_verify_document(req: DocumentVerificationRequest):
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
            # TWEAK: High res (1200) and slow layout for complex CORs
            raw_t, _ = extract_document_text(image_bytes, max_width=1200, prefer_fast_layout=False, crop_percent=1.0)
            v_t = bool(raw_t and len(raw_t.strip()) > 15)
            msg = 'Verified' if v_t else 'Unable to read document text (verify lighting)'
        
        elif doc_type == 'Grades':
            # TWEAK: High res (1200) for dense tables
            raw_t, _ = extract_document_text(image_bytes, max_width=1200, prefer_fast_layout=False, crop_percent=1.0)
            v_t = bool(raw_t and raw_t.strip())
            msg = 'Verified' if v_t else 'Unable to read document text'
            
        elif doc_type == 'SchoolIDBack':
            raw_t, _ = extract_document_text(image_bytes, is_id_back=True)
            v_t = bool(raw_t and raw_t.strip())
            msg = 'Verified' if v_t else 'Unable to read school ID back text'
            
        elif doc_type == 'Indigency':
            # TWEAK: 85% crop and fast layout for certificates
            raw_t, _ = extract_document_text(image_bytes, max_width=800, prefer_fast_layout=True, crop_percent=0.85)
            name_ok, name_ratio, name_details = student_name_matches_text(raw_t, req.first_name, req.middle_name, req.last_name, is_indigency=True)
            _, addr_ok, found_keywords, _, detect_meta = _perform_text_matching(raw_t, None, None, None, req.expected_address, is_indigency=True)
            
            detected_brgys = detect_meta.get('detected_brgy', [])
            addr_final_ok = addr_ok if req.expected_address else False
            
            v_t = name_ok and addr_final_ok
            brgy_str = ", ".join(detected_brgys) if detected_brgys else "None detected"
            status_addr = 'OK' if addr_final_ok else 'X'
            msg = f"Checklist: [First: {'OK' if name_details.get('first_ok') else 'X'} | Last: {'OK' if name_details.get('last_ok') else 'X'} | Addr: {status_addr} (Target: {req.expected_address or 'Missing'}, Found: {brgy_str})]"
            meta = {'name_ok': name_ok, 'addr_ok': addr_final_ok, 'name_ratio': name_ratio, 'keywords': found_keywords, 'detected_brgy': detected_brgys}
            
        else:
            # Fallback for ID Front or unknown types
            v_t, msg, raw_t, _ = verify_id_with_ocr(
                image_bytes, req.first_name, req.middle_name, req.last_name, 
                expected_address=req.expected_address, 
                expected_id_no=req.expected_id_no, 
                expected_school_name=req.expected_school_name
            )

        return {
            "success": v_t,
            "message": msg,
            "detected_text": raw_t[:1000] if raw_t else "",
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
