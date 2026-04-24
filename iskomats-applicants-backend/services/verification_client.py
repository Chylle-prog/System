import os
import base64
import requests
import logging

logger = logging.getLogger("verification-client")

# The URL where your FastAPI service is running
# Default to 8001 (as set in verification_service.py)
VERIFICATION_SERVICE_URL = os.environ.get("VERIFICATION_SERVICE_URL", "http://localhost:8001")

def call_fastapi_verify_id(image_bytes, first_name, middle_name, last_name, **kwargs):
    """
    Calls the FastAPI verification service to perform ID OCR and validation.
    """
    try:
        # Prepare payload
        # FastAPI expects base64 strings for images
        payload = {
            "firstName": first_name,
            "middleName": middle_name or "",
            "lastName": last_name,
            "image": base64.b64encode(image_bytes).decode('utf-8'),
            "idNo": kwargs.get('expected_id_no'),
            "yearLevel": kwargs.get('expected_year_level'),
            "schoolName": kwargs.get('expected_school_name'),
            "address": kwargs.get('expected_address')
        }

        logger.info(f"Forwarding verification to FastAPI: {VERIFICATION_SERVICE_URL}/verify/id")
        response = requests.post(
            f"{VERIFICATION_SERVICE_URL}/verify/id",
            json=payload,
            timeout=45 # OCR can be slow, give it time
        )
        
        if response.status_code == 200:
            res_data = response.json()
            return (
                res_data.get("success"),
                res_data.get("message"),
                res_data.get("detected_text"),
                res_data.get("match_ratio")
            )
        else:
            logger.error(f"FastAPI Error ({response.status_code}): {response.text}")
            return False, f"Verification Service Error: {response.status_code}", "", 0.0

    except Exception as e:
        logger.error(f"Failed to connect to Verification Service: {str(e)}")
        # If the service is down, we could potentially fall back to local processing
        # but for now we report the error.
        return False, f"Verification Service Unavailable: {str(e)}", "", 0.0

def call_fastapi_verify_document(image_bytes, doc_type, first_name, middle_name, last_name, **kwargs):
    """
    Calls the FastAPI verification service for specialized document verification (COR, Grades, Indigency).
    """
    try:
        payload = {
            "docType": doc_type,
            "firstName": first_name,
            "middleName": middle_name or "",
            "lastName": last_name,
            "image": base64.b64encode(image_bytes).decode('utf-8'),
            "address": kwargs.get('expected_address'),
            "idNo": kwargs.get('expected_id_no'),
            "schoolName": kwargs.get('expected_school_name'),
            "gpa": str(kwargs.get('expected_gpa', '')),
            "yearLevel": kwargs.get('expected_year_level'),
            "academicYear": kwargs.get('expected_academic_year'),
            "semester": kwargs.get('expected_semester')
        }

        response = requests.post(
            f"{VERIFICATION_SERVICE_URL}/verify/document",
            json=payload,
            timeout=45
        )
        
        if response.status_code == 200:
            res_data = response.json()
            # Returns 4-tuple to match Flask's internal run_ocr_check expectation
            return (
                res_data.get("success"),
                res_data.get("message"),
                res_data.get("detected_text"),
                res_data.get("meta", {})
            )
        return False, f"Document Service Error: {response.status_code}", "", {}
    except Exception as e:
        logger.error(f"Document Verification Service Unavailable: {str(e)}")
        return False, f"Service Error: {str(e)}", "", {}

def call_fastapi_verify_face(id_image_bytes, live_face_bytes):
    """
    Calls the FastAPI verification service for face matching.
    """
    try:
        payload = {
            "idImage": base64.b64encode(id_image_bytes).decode('utf-8'),
            "liveFace": base64.b64encode(live_face_bytes).decode('utf-8')
        }

        response = requests.post(
            f"{VERIFICATION_SERVICE_URL}/verify/face",
            json=payload,
            timeout=30
        )
        
        if response.status_code == 200:
            res_data = response.json()
            return (
                res_data.get("success"),
                res_data.get("message"),
                res_data.get("confidence")
            )
        return False, f"Face Verification Service Error: {response.status_code}", 0.0
    except Exception as e:
        logger.error(f"Face Verification Service Unavailable: {str(e)}")
        return False, f"Service Error: {str(e)}", 0.0
