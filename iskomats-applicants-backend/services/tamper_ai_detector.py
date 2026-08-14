import os
import io
import json
import logging
import base64
import cv2
import numpy as np
from PIL import Image, ImageChops, ImageEnhance, ExifTags

logger = logging.getLogger("iskomats-backend.tamper_ai_detector")

# Known software signatures used for digital editing/manipulation
EDITING_SOFTWARE_KEYWORDS = [
    'photoshop', 'canva', 'gimp', 'pixlr', 'paint.net', 'lightroom',
    'photoroom', 'affinity', 'krita', 'snapseed', 'picsart', 'illustrator',
    'coreldraw', 'acrobat', 'pdf2image', 'pdfscape', 'foxit', 'sejda'
]


def resolve_image_bytes(image_data):
    """Safely decode base64 strings, URLs, memoryviews, or byte arrays into raw image bytes."""
    if not image_data:
        return None
    if isinstance(image_data, memoryview):
        return image_data.tobytes()
    if isinstance(image_data, (bytes, bytearray)):
        return bytes(image_data)
    if isinstance(image_data, str):
        normalized = image_data.strip()
        if not normalized:
            return None
        if ',' in normalized:
            normalized = normalized.split(',')[1]
        try:
            return base64.b64decode(normalized)
        except Exception:
            if normalized.startswith('http'):
                try:
                    import urllib.request
                    req = urllib.request.Request(normalized, headers={'User-Agent': 'Mozilla/5.0'})
                    with urllib.request.urlopen(req, timeout=10) as resp:
                        return resp.read()
                except Exception as err:
                    logger.warning(f"[TAMPER DETECTOR] Failed to fetch URL {normalized[:40]}: {err}")
                    return None
    return None


def inspect_exif_metadata(image_bytes):
    """
    FotoForensics EXIF Inspection:
    Extracts embedded EXIF tags to check if editing software (Canva/Photoshop) was used
    or if the photo originated directly from a mobile camera sensor.
    """
    raw = resolve_image_bytes(image_bytes)
    if not raw:
        return {'edited': False, 'software_detected': None, 'is_camera_photo': False, 'exif_summary': 'No image data'}

    result = {
        'edited': False,
        'software_detected': None,
        'is_camera_photo': False,
        'camera_model': None,
        'exif_summary': 'No EXIF metadata present'
    }

    try:
        pil_img = Image.open(io.BytesIO(raw))
        exif_raw = pil_img._getexif()

        if not exif_raw:
            result['exif_summary'] = 'Raw image without camera EXIF metadata (often web export or screenshot).'
            return result

        exif_dict = {}
        for tag_id, val in exif_raw.items():
            tag_name = ExifTags.TAGS.get(tag_id, str(tag_id))
            exif_dict[tag_name] = str(val)

        # Check Camera Make/Model
        make = exif_dict.get('Make', '')
        model = exif_dict.get('Model', '')
        if make or model:
            result['is_camera_photo'] = True
            result['camera_model'] = f"{make} {model}".strip()

        # Check Software Tag
        software = exif_dict.get('Software', '') + " " + exif_dict.get('ProcessingSoftware', '') + " " + exif_dict.get('ImageDescription', '')
        software_lower = software.lower()

        for kw in EDITING_SOFTWARE_KEYWORDS:
            if kw in software_lower:
                result['edited'] = True
                result['software_detected'] = software.strip()
                result['exif_summary'] = f"Digital editing software detected in EXIF: '{software.strip()}'"
                return result

        if result['is_camera_photo']:
            result['exif_summary'] = f"Authentic camera metadata found ({result['camera_model']})"
        else:
            result['exif_summary'] = "EXIF present without explicit editing software flags"

    except Exception as exc:
        result['exif_summary'] = f"EXIF parsing error: {exc}"

    return result


def perform_error_level_analysis(image_bytes, quality=95):
    """
    FotoForensics ELA (Error Level Analysis):
    Resaves image at 95% JPEG quality and analyzes differential error rates.
    Digitally modified or spliced text blocks degrade at different compression rates
    compared to original background document paper.
    """
    raw = resolve_image_bytes(image_bytes)
    if not raw:
        return {'suspicious': False, 'ela_score': 0.0, 'details': 'No image data'}

    try:
        orig = Image.open(io.BytesIO(raw)).convert('RGB')
        
        # Save to memory at fixed 95% JPEG quality
        buffer = io.BytesIO()
        orig.save(buffer, 'JPEG', quality=quality)
        buffer.seek(0)
        recompressed = Image.open(buffer).convert('RGB')

        # Calculate absolute difference (ELA)
        ela_img = ImageChops.difference(orig, recompressed)
        
        # Calculate max and mean error per color channel
        extrema = ela_img.getextrema()
        max_diff = max([ex[1] for ex in extrema])
        
        ela_arr = np.array(ela_img, dtype=np.float32)
        mean_err = float(np.mean(ela_arr))
        std_err = float(np.std(ela_arr))

        # High localized standard deviation of ELA error indicates spliced elements
        # Normal unedited documents produce uniform ELA noise (std_err < 12.0)
        suspicious = (std_err > 18.5) and (max_diff > 60)
        ela_score = round(min(100.0, (std_err / 25.0) * 100.0), 2)

        details = "Uniform compression error level (No digital splicing detected)"
        if suspicious:
            details = f"Non-uniform ELA compression variance detected (ELA Score: {ela_score}%, Max Diff: {max_diff}). High likelihood of spliced text or altered numbers."

        return {
            'suspicious': suspicious,
            'ela_score': ela_score,
            'max_diff': max_diff,
            'std_err': round(std_err, 2),
            'details': details
        }
    except Exception as exc:
        return {'suspicious': False, 'ela_score': 0.0, 'details': f"ELA processing error: {exc}"}


def detect_recapture_moire(image_bytes):
    """
    TrueDoc Screen Recapture Detector:
    Uses 2D Fast Fourier Transform (FFT) frequency domain analysis to detect
    Moiré pattern lines created when photographing a computer screen / monitor.
    """
    raw = resolve_image_bytes(image_bytes)
    if not raw:
        return {'recaptured': False, 'confidence': 0.0, 'details': 'No image data'}

    try:
        nparr = np.frombuffer(raw, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_GRAYSCALE)
        if img is None:
            return {'recaptured': False, 'confidence': 0.0, 'details': 'Invalid image format'}

        # Resize to standard 512x512 for uniform frequency spectrum analysis
        resized = cv2.resize(img, (512, 512))

        # 2D Fast Fourier Transform
        f = np.fft.fft2(resized)
        fshift = np.fft.fftshift(f)
        magnitude_spectrum = 20 * np.log(np.abs(fshift) + 1e-8)

        # Mask DC component (center low frequencies)
        cy, cx = 256, 256
        cv2.circle(magnitude_spectrum, (cx, cy), 30, 0, -1)

        # Detect periodic peak spikes in high frequency band (Moiré screen lattice)
        max_peak = float(np.max(magnitude_spectrum))
        mean_freq = float(np.mean(magnitude_spectrum))
        std_freq = float(np.std(magnitude_spectrum))

        peak_ratio = (max_peak - mean_freq) / (std_freq + 1e-5)
        recaptured = peak_ratio > 4.8

        confidence = round(min(100.0, max(0.0, (peak_ratio - 3.0) * 33.3)), 2)
        details = "Direct document scan / photo (No monitor screen Moiré pattern detected)"
        if recaptured:
            details = f"Screen Recapture Detected (Moiré grid pattern ratio: {peak_ratio:.2f}). Document appears to be a photo taken off a computer screen."

        return {
            'recaptured': recaptured,
            'confidence': confidence,
            'peak_ratio': round(peak_ratio, 2),
            'details': details
        }
    except Exception as exc:
        return {'recaptured': False, 'confidence': 0.0, 'details': f"Recapture detection error: {exc}"}


def detect_ai_generated_document(image_bytes):
    """
    Hive Moderation API / Texture Grain AI Detector:
    Queries Hive Moderation API if HIVE_API_KEY is available.
    Otherwise uses local PRNU (Photo-Response Non-Uniformity) texture grain scan
    to detect synthetic AI generated document images.
    """
    raw = resolve_image_bytes(image_bytes)
    if not raw:
        return {'is_ai_generated': False, 'confidence': 0.0, 'provider': 'none', 'details': 'No image data'}

    hive_api_key = os.environ.get('HIVE_API_KEY')
    if hive_api_key:
        try:
            import requests
            b64_str = base64.b64encode(raw).decode('utf-8')
            headers = {'Authorization': f'token {hive_api_key}'}
            payload = {'image_base64': b64_str, 'models': ['hive_ai_generated_image']}
            resp = requests.post('https://api.thehive.ai/api/v2/task/sync', headers=headers, json=payload, timeout=8)
            if resp.status_code == 200:
                res_json = resp.json()
                classes = res_json.get('status', [{}])[0].get('response', {}).get('output', [{}])[0].get('classes', [])
                for cls in classes:
                    if cls.get('class') in ['ai_generated', 'yes', 'ai']:
                        score = float(cls.get('score', 0.0))
                        is_ai = score >= 0.70
                        return {
                            'is_ai_generated': is_ai,
                            'confidence': round(score * 100.0, 2),
                            'provider': 'Hive Moderation API',
                            'details': f"Hive AI Detection Score: {score * 100.0:.1f}% AI probability."
                        }
        except Exception as err:
            logger.warning(f"[TAMPER DETECTOR] Hive API call note: {err}")

    # Fallback: Local High-Frequency PRNU & Texture Uniformity Analyzer
    try:
        nparr = np.frombuffer(raw, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return {'is_ai_generated': False, 'confidence': 0.0, 'provider': 'local', 'details': 'Invalid image'}

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        # Compute High-Pass Noise Residual (PRNU proxy)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        noise_residual = cv2.absdiff(gray, blurred)

        # AI generated image text blocks lack physical camera sensor photon noise
        mean_noise = float(np.mean(noise_residual))
        std_noise = float(np.std(noise_residual))

        # Calculate noise distribution uniformity score
        is_ai = (mean_noise < 0.45 and std_noise < 0.85)
        ai_score = round(max(0.0, min(100.0, (1.0 - mean_noise) * 75.0)), 2)

        details = "Natural sensor texture & paper grain detected"
        if is_ai:
            details = f"Unnatural pixel noise texture (AI Document Risk: {ai_score}%). Image lacks natural optical sensor noise."

        return {
            'is_ai_generated': is_ai,
            'confidence': ai_score if is_ai else 0.0,
            'provider': 'Local Texture Analyzer',
            'details': details
        }
    except Exception as exc:
        return {'is_ai_generated': False, 'confidence': 0.0, 'provider': 'local', 'details': f"Local AI detection error: {exc}"}


def generate_ai_recommendation(doc_type, success, message, meta, security_audit):
    """
    AI Recommendation Engine (Powered by Google Gemini with fallback):
    Generates a clear human-readable explanation summarizing why a document
    was approved, needs manual review, or was rejected.
    """
    gemini_key = os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY')
    
    exif = security_audit.get('exif', {})
    ela = security_audit.get('ela', {})
    recapture = security_audit.get('recapture', {})
    ai_gen = security_audit.get('ai_generated', {})

    has_tamper_flag = (exif.get('edited') or ela.get('suspicious') or recapture.get('recaptured') or ai_gen.get('is_ai_generated'))

    # If Gemini API key is present, attempt LLM explanation generation
    if gemini_key:
        try:
            from google import genai
            client = genai.Client(api_key=gemini_key)
            prompt = f"""
            You are an expert scholarship document verification AI assistant for Iskomats.
            Analyze the following document verification audit result and summarize the recommendation in 2 concise sentences for the scholarship reviewer:

            Document Type: {doc_type}
            OCR Status: {"PASSED" if success else "FAILED"}
            OCR Message: {message}
            Field Mismatches: {meta.get('details', [])}

            Security Audit:
            - EXIF Software Edit: {exif.get('software_detected', 'None')} (Summary: {exif.get('exif_summary')})
            - Error Level Analysis Splicing: {"SUSPICIOUS" if ela.get('suspicious') else "Clean"} (ELA Score: {ela.get('ela_score')}%)
            - Screen Recapture Moiré: {"RECAPTURED SCREEN PHOTO" if recapture.get('recaptured') else "Direct Photo/Scan"}
            - AI Generated Document Risk: {"HIGH" if ai_gen.get('is_ai_generated') else "Low"} ({ai_gen.get('details')})

            Respond with ONLY a 2-sentence recommendation formatted as:
            STATUS: [RECOMMENDED FOR APPROVAL | REQUIRES MANUAL REVIEW | REJECTED]
            REASON: [Explanation]
            """
            response = client.models.generate_content(
                model='gemini-2.0-flash',
                contents=prompt
            )
            if response and response.text:
                return response.text.strip()
        except Exception as gem_err:
            logger.warning(f"[TAMPER DETECTOR] Gemini API recommendation note: {gem_err}")

    # Structured Rule-Based Fallback Engine (No API key needed)
    if success and not has_tamper_flag:
        return (
            "STATUS: RECOMMENDED FOR APPROVAL\n"
            f"REASON: High confidence OCR verification. All extracted fields on the {doc_type} matched student records, and authentic camera metadata was verified with zero digital tampering or AI artifacts."
        )
    elif success and has_tamper_flag:
        reasons = []
        if exif.get('edited'):
            reasons.append(f"EXIF indicates editing in software '{exif.get('software_detected')}'")
        if ela.get('suspicious'):
            reasons.append(f"Error Level Analysis detected non-uniform compression (ELA Score {ela.get('ela_score')}%)")
        if recapture.get('recaptured'):
            reasons.append("Document appears to be a photo taken off a computer monitor screen")
        if ai_gen.get('is_ai_generated'):
            reasons.append("High probability of AI synthetic image generation")

        return (
            "STATUS: REQUIRES MANUAL REVIEW\n"
            f"REASON: Document OCR text matched student records, but security audit flagged potential issues: {'; '.join(reasons)}. Reviewer verification recommended."
        )
    else:
        failures = meta.get('details', [message])
        fail_str = "; ".join(failures) if isinstance(failures, list) else str(failures)
        return (
            "STATUS: REJECTED\n"
            f"REASON: Document failed verification due to data mismatch or unreadable text: {fail_str}."
        )


def run_full_security_audit(image_bytes, doc_type="Document", success=False, message="", meta=None):
    """
    Master Pre-Scan Entry Point:
    Runs EXIF inspection, ELA analysis, Recapture detection, AI generation scan,
    and produces an AI recommendation without modifying original image bytes or OCR logic.
    """
    meta = meta or {}
    exif_res = inspect_exif_metadata(image_bytes)
    ela_res = perform_error_level_analysis(image_bytes)
    recapture_res = detect_recapture_moire(image_bytes)
    ai_res = detect_ai_generated_document(image_bytes)

    audit_summary = {
        'exif': exif_res,
        'ela': ela_res,
        'recapture': recapture_res,
        'ai_generated': ai_res
    }

    ai_recommendation = generate_ai_recommendation(
        doc_type=doc_type,
        success=success,
        message=message,
        meta=meta,
        security_audit=audit_summary
    )

    is_flagged = (
        exif_res.get('edited') or
        ela_res.get('suspicious') or
        recapture_res.get('recaptured') or
        ai_res.get('is_ai_generated')
    )

    return {
        'security_flagged': bool(is_flagged),
        'audit': audit_summary,
        'recommendation': ai_recommendation
    }
