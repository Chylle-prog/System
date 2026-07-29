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

    # The actual VITE_ENCRYPTION_KEY from .env
    actual_key_str = '4uLE7rdLawGyh8a7cT33ZAdMxDfZ_NpBUyjS4oYWiPw='
    
    # Frontend uses: enc.encode(key.padEnd(32,'0').slice(0,32))
    # In Python: key_str.ljust(32,'0')[:32].encode()  -- but key is 44 chars so no padding needed
    # slice(0,32) = first 32 characters
    key_bytes = actual_key_str[:32].encode('utf-8')
    print(f"Key bytes (first 32 chars of VITE_ENCRYPTION_KEY): {key_bytes}")
    
    try:
        aesgcm = AESGCM(key_bytes)
        decrypted = aesgcm.decrypt(iv, ciphertext, None)
        is_jpg = decrypted.startswith(b'\xff\xd8\xff')
        is_png = decrypted.startswith(b'\x89PNG')
        print(f"SUCCESS! Decrypted length: {len(decrypted)} bytes")
        print("Is JPEG:", is_jpg)
        print("Is PNG:", is_png)
        print("Magic bytes:", decrypted[:16])
    except Exception as e:
        print(f"FAILED: {e}")

if __name__ == '__main__':
    main()
