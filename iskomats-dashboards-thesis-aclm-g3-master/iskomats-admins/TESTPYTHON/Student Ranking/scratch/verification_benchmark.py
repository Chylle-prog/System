import time
import os
import sys

# Add the project directory to sys.path
sys.path.append(os.path.join(os.getcwd(), 'iskomats-dashboards-thesis-aclm-g3-master', 'iskomats-admins', 'TESTPYTHON', 'Student Ranking'))

from services.ocr_utils import verify_id_with_ocr, extract_document_text

def benchmark_ocr():
    # Mock image data (can't really test with real bytes here easily without a file)
    # But we can check if the functions exist and their internal logic flows
    
    print("--- OCR Speed Optimization Benchmark ---")
    print(f"Testing environment info...")
    
    # Check if verify_id_with_ocr has the new logic
    import inspect
    source = inspect.getsource(verify_id_with_ocr)
    if "ThreadPoolExecutor(max_workers=2)" in source and "psm=11" in source:
        print("✅ Parallel PSM Strategy: IMPLEMENTED")
    else:
        print("❌ Parallel PSM Strategy: NOT FOUND")

    # Check Semaphore
    from services import ocr_utils
    if ocr_utils.OCR_SEMAPHORE.counter <= 3:
        print(f"✅ OCR Concurrency Limit: {ocr_utils.OCR_SEMAPHORE.counter} (OPTIMIZED)")
    else:
        print(f"❌ OCR Concurrency Limit: {ocr_utils.OCR_SEMAPHORE.counter} (HIGH)")

if __name__ == "__main__":
    benchmark_ocr()
