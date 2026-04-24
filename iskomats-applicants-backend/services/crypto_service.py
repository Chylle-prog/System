import os
import base64
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_ENCRYPTION_KEY = os.environ.get('ENCRYPTION_KEY')
_FRONTEND_KEY_STR = 'iskomats-system-secret-key-2024'
_fernet = None

if _ENCRYPTION_KEY:
    try:
        if isinstance(_ENCRYPTION_KEY, str):
            _ENCRYPTION_KEY = _ENCRYPTION_KEY.encode()
        _fernet = Fernet(_ENCRYPTION_KEY)
    except Exception as e:
        print(f"[CRYPTO_SERVICE] Failed to initialize Fernet: {e}")

def get_fernet():
    return _fernet

def decrypt_aes_gcm(data):
    """Decrypts data encrypted with Web Crypto AES-GCM (from CryptoService.js)"""
    try:
        # Format: [MAGIC_PREFIX "ENC:"] [IV (12 bytes)] [EncryptedData]
        prefix = b'ENC:'
        if not data.startswith(prefix):
            return data
            
        # Ensure we have enough bytes for prefix + IV
        if len(data) < len(prefix) + 12:
            return data
            
        iv = data[len(prefix):len(prefix)+12]
        ciphertext = data[len(prefix)+12:]
        
        # Prepare key (matches CryptoService.js: getCryptoKey)
        key_bytes = _FRONTEND_KEY_STR.ljust(32, '0')[:32].encode()
        aesgcm = AESGCM(key_bytes)
        
        return aesgcm.decrypt(iv, ciphertext, None)
    except Exception as e:
        print(f"[CRYPTO_SERVICE] AES-GCM Decryption failed: {e}")
        return data

def decrypt_if_encrypted(data):
    if not data:
        return data
    
    # Standardize to bytes for checking
    bytes_data = data
    if isinstance(data, str):
        try:
            # Check if it's base64 first
            if ',' in data:
                bytes_data = base64.b64decode(data.split(',')[1])
            else:
                bytes_data = base64.b64decode(data)
        except:
            bytes_data = data.encode('utf-8', errors='ignore')

    # 1. Check for AES-GCM (Web Crypto)
    if bytes_data.startswith(b'ENC:'):
        return decrypt_aes_gcm(bytes_data)
        
    # 2. Check for Fernet (Python)
    if _fernet and bytes_data.startswith(b'gAAAA'):
        try:
            return _fernet.decrypt(bytes_data)
        except Exception:
            return bytes_data
            
    return bytes_data

