import os
import sys
import numpy as np
import cv2

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services.ocr_utils import verify_video_content

def test_video_google_vision_ocr():
    print("==================================================")
    print("Testing Video Proof OCR via Google Cloud Vision API")
    print("==================================================")

    # Generate a dummy synthetic document image frame
    frame = np.ones((600, 800, 3), dtype=np.uint8) * 255
    cv2.putText(frame, "REPUBLIC OF THE PHILIPPINES", (50, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
    cv2.putText(frame, "BARANGAY NANGKAAN", (50, 150), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
    cv2.putText(frame, "CERTIFICATE OF INDIGENCY", (50, 200), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 2)
    cv2.putText(frame, "This is to certify that Alexie Chyle Magbuhat", (50, 260), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
    cv2.putText(frame, "is a bonafide resident of Purok 3 Lipa City", (50, 310), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)

    success, encoded_png = cv2.imencode('.png', frame)
    assert success, "Failed to encode test frame"
    frame_bytes = encoded_png.tobytes()

    is_valid, msg, logs = verify_video_content(
        video_bytes=None,
        doc_type="Certificate of Indigency",
        expected_name="Alexie Chyle Magbuhat",
        expected_address="Lipa City",
        frame_bytes_list=[frame_bytes]
    )

    print(f"Validation Success: {is_valid}")
    print(f"Message: {msg}")
    print(f"Extracted Logs:\n{logs}")

    assert is_valid, f"Video proof OCR failed: {msg}"
    assert "Frame 1" in logs, "Log missing Frame 1 output"
    print("\n[SUCCESS] Video Proof Google Cloud Vision API OCR Test Passed!")

if __name__ == '__main__':
    test_video_google_vision_ocr()
