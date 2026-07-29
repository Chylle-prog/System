import sys
import os
import requests
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

def main():
    url = "https://choqncwkxobwsouyotih.supabase.co/storage/v1/object/public/document_images/coe/1-enrollment_certificate_doc.jpg"
    print(f"Downloading encrypted COE file from {url}...")
    resp = requests.get(url, timeout=10)
    data = resp.content
    
    prefix = b'ENC:'
    if not data.startswith(prefix):
        print("Error: data does not start with ENC:")
        return

    iv = data[len(prefix):len(prefix)+12]
    ciphertext = data[len(prefix)+12:]

    # List candidate key strings to test
    candidates = [
        'iskomats-system-secret-key-2024',
        'your_encryption_key_here',
        'iskomats-system-secret-key',
        'iskomats_secret_key',
        'iskomats-secret-key',
        'iskomats',
        'secret',
        'key',
    ]

    print("\nTesting candidate key strings...")
    for candidate in candidates:
        key_bytes_32 = candidate.ljust(32, '0')[:32].encode('utf-8')
        key_bytes_raw = candidate[:32].encode('utf-8')
        
        for name, kb in [("32-padded", key_bytes_32), ("raw", key_bytes_raw)]:
            if len(kb) != 32:
                continue
            try:
                aesgcm = AESGCM(kb)
                decrypted = aesgcm.decrypt(iv, ciphertext, None)
                is_jpg = decrypted.startswith(b'\xff\xd8\xff')
                is_png = decrypted.startswith(b'\x89PNG')
                print(f"\nSUCCESS! Decrypted with key: '{candidate}' ({name})")
                print(f"Decrypted length: {len(decrypted)} bytes")
                print("Is JPEG:", is_jpg)
                print("Is PNG:", is_png)
                print("Magic bytes:", decrypted[:16])
                return
            except Exception:
                pass

    print("\nFailed to decrypt with candidate keys.")

if __name__ == '__main__':
    main()
