import os
import sys
import base64
import time
import logging
from typing import Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import uvicorn
from fastapi.middleware.cors import CORSMiddleware
import cv2

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from services.ocr_utils import verify_face_with_id, verify_signature_against_id, resolve_verification_image_bytes, save_signature_profile

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("verifier-bench-backend")

app = FastAPI(
    title="ISKOMATS Verifier Bench Standalone Backend",
    description="Dedicated microservice backend for ISKOMATS OCR & Biometric Verifier Bench.",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class FaceVerificationRequest(BaseModel):
    id_image_base64: Optional[str] = Field(None, alias="idImage")
    live_face_base64: Optional[str] = Field(None, alias="liveFace")
    face_image: Optional[str] = None
    id_image: Optional[str] = None

class SignatureMatchRequest(BaseModel):
    signature_image: Optional[str] = None
    id_back_image: Optional[str] = None

class SignatureFeedbackRequest(BaseModel):
    signature_image: Optional[str] = None
    decision: Optional[str] = 'agree'
    was_verified: Optional[bool] = False
    student_id: Optional[str] = 'bench_user'


@app.get("/")
@app.get("/health")
@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy", 
        "service": "iskomats-verifier-bench-standalone-backend", 
        "timestamp": time.time()
    }


@app.post("/verify/face")
@app.post("/api/student/verification/face-match")
@app.post("/student/verification/face-match")
async def api_verify_face(req: FaceVerificationRequest):
    start_time = time.time()
    try:
        id_str = req.id_image or req.id_image_base64
        face_str = req.face_image or req.live_face_base64

        if not id_str or not face_str:
            return {"verified": False, "message": "Missing face or ID image data", "confidence": 0.0}

        id_bytes = resolve_verification_image_bytes(id_str)
        face_bytes = resolve_verification_image_bytes(face_str)

        if not id_bytes or not face_bytes:
            return {"verified": False, "message": "Invalid image data", "confidence": 0.0}

        success, message, confidence = verify_face_with_id(face_bytes, id_bytes)
        
        return {
            "verified": bool(success),
            "message": str(message),
            "confidence": float(confidence) * 100.0 if confidence <= 1.0 else float(confidence),
            "process_time": time.time() - start_time
        }
    except Exception as e:
        logger.error(f"Error in Face Verification: {str(e)}")
        return {"verified": False, "message": str(e), "confidence": 0.0}


@app.post("/api/student/verification/signature-match")
@app.post("/student/verification/signature-match")
@app.post("/verify/signature")
async def api_signature_match(req: SignatureMatchRequest):
    start_time = time.time()
    try:
        if not req.signature_image or not req.id_back_image:
            return {"verified": False, "message": "Missing signature or ID back image.", "confidence": 0.0}

        signature_bytes = resolve_verification_image_bytes(req.signature_image)
        id_back_bytes = resolve_verification_image_bytes(req.id_back_image)

        if not signature_bytes or not id_back_bytes:
            return {"verified": False, "message": "Invalid image format.", "confidence": 0.0}

        verified, message, confidence, sub_img, ext_img, matcher_sub_img, matcher_ref_img = verify_signature_against_id(signature_bytes, id_back_bytes)

        processed_submitted = None
        extracted_signature = None
        matcher_submitted = None
        matcher_reference = None

        if sub_img is not None:
            _, buffer = cv2.imencode('.png', sub_img)
            processed_submitted = f"data:image/png;base64,{base64.b64encode(buffer).decode('utf-8')}"

        if ext_img is not None:
            _, buffer = cv2.imencode('.png', ext_img)
            extracted_signature = f"data:image/png;base64,{base64.b64encode(buffer).decode('utf-8')}"

        if matcher_sub_img is not None:
            _, buffer = cv2.imencode('.png', matcher_sub_img)
            matcher_submitted = f"data:image/png;base64,{base64.b64encode(buffer).decode('utf-8')}"

        if matcher_ref_img is not None:
            _, buffer = cv2.imencode('.png', matcher_ref_img)
            matcher_reference = f"data:image/png;base64,{base64.b64encode(buffer).decode('utf-8')}"

        return {
            "verified": bool(verified),
            "message": str(message),
            "confidence": float(confidence) * 100.0 if confidence <= 1.0 else float(confidence),
            "processed_submitted": processed_submitted,
            "extracted_signature": extracted_signature,
            "matcher_submitted": matcher_submitted,
            "matcher_reference": matcher_reference,
            "process_time": time.time() - start_time
        }
    except Exception as e:
        logger.error(f"Error in Signature Verification: {str(e)}")
        return {"verified": False, "message": str(e), "confidence": 0.0}


@app.post("/api/student/verification/signature-feedback")
@app.post("/student/verification/signature-feedback")
async def api_signature_feedback(req: SignatureFeedbackRequest):
    try:
        if not req.signature_image:
            return {"success": False, "message": "Missing signature image data."}

        signature_bytes = resolve_verification_image_bytes(req.signature_image)
        if not signature_bytes:
            return {"success": False, "message": "Invalid signature image."}
        
        student_id = req.student_id or 'bench_user'
        user_choice = req.decision or 'agree'
        was_verified = req.was_verified or False

        if user_choice == 'agree':
            profile_type = 'real' if was_verified else 'fake'
        else:
            profile_type = 'fake' if was_verified else 'real'

        success = save_signature_profile(student_id, signature_bytes, profile_type=profile_type)

        if user_choice == 'agree':
            msg = f"System logic reinforced. Result confirmed as {profile_type}."
        else:
            msg = f"System logic corrected. Drawing re-classified as {profile_type}."

        return {"success": bool(success), "message": msg if success else f"Failed to update {profile_type} profile."}
    except Exception as e:
        logger.error(f"Error in Signature Feedback: {str(e)}")
        return {"success": False, "message": str(e)}


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    logger.info(f"Starting Verifier Bench Standalone Server on port {port}...")
    uvicorn.run(app, host="0.0.0.0", port=port)
