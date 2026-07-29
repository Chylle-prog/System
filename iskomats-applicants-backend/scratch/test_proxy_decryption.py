import sys
import os
import requests

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from project_config import get_db

def main():
    # Simulate what the backend proxy does when it serves enrollment_certificate_doc
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Get the stored URL
        cursor.execute("SELECT enrollment_certificate_doc FROM applicant_documents WHERE applicant_no = 1")
        row = cursor.fetchone()
        supabase_url = row['enrollment_certificate_doc']
        print(f"Supabase URL: {supabase_url}\n")
        
        # Fetch it as the backend proxy would
        resp = requests.get(supabase_url, timeout=10)
        raw = resp.content
        print(f"Downloaded {len(raw)} bytes, starts with ENC: {raw.startswith(b'ENC:')}")
        
        # Decrypt using crypto_service (which uses ENCRYPTION_KEY env var)
        from services.crypto_service import decrypt_if_encrypted
        
        # Check what key is being used
        enc_key = os.environ.get('ENCRYPTION_KEY')
        print(f"ENCRYPTION_KEY env var: {'SET (' + enc_key[:10] + '...)' if enc_key else 'NOT SET (will use default)'}")
        
        decrypted = decrypt_if_encrypted(raw)
        is_same = decrypted is raw or decrypted == raw
        print(f"Decryption changed data: {not is_same}")
        is_jpg = decrypted.startswith(b'\xff\xd8\xff') if isinstance(decrypted, bytes) else False
        print(f"Result is JPEG: {is_jpg}")
        print(f"Result length: {len(decrypted)} bytes")
        
        if not is_jpg:
            print("\nSTILL ENCRYPTED or wrong key!")
            print(f"First 20 bytes: {decrypted[:20]}")
        else:
            print("\nSUCCESS: Backend proxy correctly decrypts the COE document!")

if __name__ == '__main__':
    main()
