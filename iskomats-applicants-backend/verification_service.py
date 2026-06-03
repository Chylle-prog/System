import os
import base64
import time
import logging
from typing import Optional, Dict
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import uvicorn
from fastapi.middleware.cors import CORSMiddleware

# Import face verification logic from our streamlined ocr_utils
from services.ocr_utils import verify_face_with_id

# Configure Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("verification-service")

app = FastAPI(
    title="Iskomats High-Performance Verification Service",
    description="FastAPI-based Face matching engine for Iskomats scholarship system.",
    version="1.0.0"
)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- MODELS ---

class FaceVerificationRequest(BaseModel):
    id_image_base64: str = Field(..., alias="idImage")
    live_face_base64: str = Field(..., alias="liveFace")


# --- ENDPOINTS ---

@app.get("/health")
async def health_check():
    return {
        "status": "healthy", 
        "service": "iskomats-verification-fastapi", 
        "timestamp": time.time(),
        "ocr_purged": True
    }

@app.post("/verify/face")
async def api_verify_face(req: FaceVerificationRequest):
    """
    Wraps verify_face_with_id using UniFace/DeepFace.
    """
    start_time = time.time()
    try:
        try:
            id_bytes = base64.b64decode(req.id_image_base64.split(',')[-1])
            face_bytes = base64.b64decode(req.live_face_base64.split(',')[-1])
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid base64 image data")

        # Call face verification logic
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


if __name__ == "__main__":
    port = int(os.environ.get("VERIFICATION_PORT", 8001))
    logger.info(f"Starting Face Verification Service on port {port}...")
    uvicorn.run(app, host="0.0.0.0", port=port)
