import os
import sys
import io
from PIL import Image

# Add root directory to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services.tamper_ai_detector import (
    inspect_exif_metadata,
    perform_error_level_analysis,
    detect_recapture_moire,
    detect_ai_generated_document,
    generate_ai_recommendation,
    run_full_security_audit
)
from services.ocr_utils import verify_document_with_ocr

def create_sample_test_image():
    """Create a sample synthetic document image in memory for testing."""
    img = Image.new('RGB', (800, 600), color=(255, 255, 255))
    buffer = io.BytesIO()
    img.save(buffer, format='JPEG', quality=95)
    return buffer.getvalue()

def run_tests():
    print("=== Testing AI & Tamper Detection Engine ===")
    sample_bytes = create_sample_test_image()

    # 1. EXIF Inspection
    exif_res = inspect_exif_metadata(sample_bytes)
    print("\n1. EXIF Inspection Result:")
    print(f"   Edited: {exif_res['edited']}")
    print(f"   Software: {exif_res['software_detected']}")
    print(f"   Summary: {exif_res['exif_summary']}")
    assert 'edited' in exif_res

    # 2. Error Level Analysis (ELA)
    ela_res = perform_error_level_analysis(sample_bytes)
    print("\n2. ELA Splicing Result:")
    print(f"   Suspicious: {ela_res['suspicious']}")
    print(f"   ELA Score: {ela_res['ela_score']}%")
    print(f"   Details: {ela_res['details']}")
    assert 'ela_score' in ela_res

    # 3. Recapture Moiré Scan
    recapture_res = detect_recapture_moire(sample_bytes)
    print("\n3. Recapture Moiré Result:")
    print(f"   Recaptured Screen Photo: {recapture_res['recaptured']}")
    print(f"   Confidence: {recapture_res['confidence']}%")
    print(f"   Details: {recapture_res['details']}")
    assert 'recaptured' in recapture_res

    # 4. AI Document Detector
    ai_res = detect_ai_generated_document(sample_bytes)
    print("\n4. AI Generated Document Detector Result:")
    print(f"   Is AI Generated: {ai_res['is_ai_generated']}")
    print(f"   Confidence: {ai_res['confidence']}%")
    print(f"   Provider: {ai_res['provider']}")
    print(f"   Details: {ai_res['details']}")
    assert 'is_ai_generated' in ai_res

    # 5. Full Security Audit & AI Recommendation Engine
    full_audit = run_full_security_audit(
        sample_bytes,
        doc_type="Certificate of Registration",
        success=True,
        message="COR Verified: Name (Alexie Magbuhat), ID (1500017172) matched.",
        meta={'details': []}
    )
    print("\n5. AI Recommendation Summary:")
    print(full_audit['recommendation'])
    assert 'recommendation' in full_audit

    print("\n=== ALL AI & TAMPER DETECTION TESTS PASSED SUCCESSFULLY ===")

if __name__ == '__main__':
    run_tests()
