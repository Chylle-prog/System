
import os
import base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# Shared secret key (must match frontend VITE_ENCRYPTION_KEY)
ENCRYPTION_KEY_STR = os.environ.get('ENCRYPTION_KEY', 'iskomats-system-secret-key-2024')
MAGIC_PREFIX = b'ENC:'

# Derive 32-byte key for AES-256-GCM
key_bytes = ENCRYPTION_KEY_STR.ljust(32, '0')[:32].encode()
aesgcm = AESGCM(key_bytes)

def decrypt_if_encrypted(data):
    """
    Decrypts bytes if they start with the MAGIC_PREFIX.
    Otherwise returns the original data.
    """
    if not data or not isinstance(data, (bytes, bytearray)):
        return data
        
    if data.startswith(MAGIC_PREFIX):
        try:
            # Format: [MAGIC_PREFIX] [IV (12 bytes)] [EncryptedData]
            iv_start = len(MAGIC_PREFIX)
            iv_end = iv_start + 12
            iv = data[iv_start:iv_end]
            encrypted_payload = data[iv_end:]
            
            decrypted = aesgcm.decrypt(iv, encrypted_payload, None)
            return decrypted
        except Exception as e:
            print(f"[CRYPTO] Decryption failed: {e}")
            return data
            
    return data

def encrypt_data(data):
    """
    Encrypts bytes and adds the MAGIC_PREFIX.
    """
    if not data:
        return data
        
    iv = os.urandom(12)
    encrypted = aesgcm.encrypt(iv, data, None)
    return MAGIC_PREFIX + iv + encrypted
