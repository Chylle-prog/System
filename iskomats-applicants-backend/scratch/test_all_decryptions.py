import sys
import os
import requests

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services.crypto_service import decrypt_if_encrypted, _FRONTEND_KEY_STR
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

def test_url(name, url):
    resp = requests.get(url, timeout=5)
    data = resp.content
    prefix = b'ENC:'
    if not data.startswith(prefix):
        print(f"{name}: Not encrypted (len={len(data)})")
        return

    iv = data[len(prefix):len(prefix)+12]
    ciphertext = data[len(prefix)+12:]

    # Test key derivations
    keys = [
        ("default_key_32pad", _FRONTEND_KEY_STR.ljust(32, '0')[:32].encode('utf-8')),
        ("env_key_32pad", (os.environ.get('ENCRYPTION_KEY') or '').ljust(32, '0')[:32].encode('utf-8')),
    ]

    success = False
    for k_name, k_bytes in keys:
        if len(k_bytes) != 32:
            continue
        try:
            aesgcm = AESGCM(k_bytes)
            dec = aesgcm.decrypt(iv, ciphertext, None)
            is_jpg = dec.startswith(b'\xff\xd8\xff')
            is_png = dec.startswith(b'\x89PNG')
            print(f"{name}: SUCCESS with {k_name}! (len={len(dec)}, is_jpg={is_jpg}, is_png={is_png})")
            success = True
            break
        except Exception:
            pass

    if not success:
        print(f"{name}: DECRYPTION FAILED for key candidates!")

def main():
    urls = {
        "indigency": "https://choqncwkxobwsouyotih.supabase.co/storage/v1/object/public/document_images/indigency/1-indigency_doc.jpg",
        "grades": "https://choqncwkxobwsouyotih.supabase.co/storage/v1/object/public/document_images/grades/1-grades_doc.jpg",
        "coe": "https://choqncwkxobwsouyotih.supabase.co/storage/v1/object/public/document_images/coe/1-enrollment_certificate_doc.jpg",
        "id_front": "https://choqncwkxobwsouyotih.supabase.co/storage/v1/object/public/document_images/id_verification/1-id_img_front.jpg"
    }

    for name, url in urls.items():
        test_url(name, url)

if __name__ == '__main__':
    main()
