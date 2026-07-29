import sys
import os
import requests

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services.crypto_service import decrypt_if_encrypted

def main():
    url = "https://choqncwkxobwsouyotih.supabase.co/storage/v1/object/public/document_images/coe/1-enrollment_certificate_doc.jpg"
    print(f"Fetching {url}...")
    resp = requests.get(url, timeout=10)
    raw_data = resp.content
    print(f"Starts with ENC: {raw_data.startswith(b'ENC:')}")
    
    try:
        decrypted = decrypt_if_encrypted(raw_data)
        print(f"Decrypted Length: {len(decrypted)} bytes")
        print(f"Decrypted Magic bytes (first 30): {decrypted[:30]}")
        is_jpg = decrypted.startswith(b'\xff\xd8\xff')
        is_png = decrypted.startswith(b'\x89PNG')
        print("Is JPEG:", is_jpg)
        print("Is PNG:", is_png)
    except Exception as e:
        print(f"DECRYPTION ERROR: {e}")

if __name__ == '__main__':
    main()
