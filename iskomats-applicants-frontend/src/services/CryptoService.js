
/**
 * CryptoService for ISKOMATS
 * Provides client-side encryption and decryption for sensitive documents and videos.
 * Uses AES-GCM (authenticated encryption) with a shared system key.
 */

const ENCRYPTION_KEY_STR = import.meta.env.VITE_ENCRYPTION_KEY || 'iskomats-system-secret-key-2024';
const MAGIC_PREFIX = 'ENC:';

const getCryptoKey = async () => {
  const enc = new TextEncoder();
  // Ensure key is exactly 32 bytes for AES-256
  const keyData = enc.encode(ENCRYPTION_KEY_STR.padEnd(32, '0').slice(0, 32));
  return crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
};

/**
 * Encrypt a Blob or File
 * @param {Blob|File} data 
 * @returns {Promise<Blob>} Encrypted blob with MAGIC_PREFIX
 */
export const encryptDocument = async (data) => {
  if (!data) return data;
  try {
    const key = await getCryptoKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const arrayBuffer = await data.arrayBuffer();
    
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      arrayBuffer
    );

    // Format: [MAGIC_PREFIX] [IV (12 bytes)] [EncryptedData]
    const prefixBytes = new TextEncoder().encode(MAGIC_PREFIX);
    const combined = new Uint8Array(prefixBytes.length + iv.length + encrypted.byteLength);
    combined.set(prefixBytes);
    combined.set(iv, prefixBytes.length);
    combined.set(new Uint8Array(encrypted), prefixBytes.length + iv.length);

    return new Blob([combined], { type: 'application/octet-stream' });
  } catch (error) {
    console.error('[CRYPTO] Encryption failed:', error);
    return data; // Fallback to raw
  }
};

/**
 * Decrypt a Blob
 * @param {Blob} blob 
 * @returns {Promise<Blob>} Decrypted blob or original if not encrypted
 */
export const decryptDocument = async (blob, originalType = 'image/jpeg') => {
  if (!blob) return blob;
  try {
    const buffer = await blob.arrayBuffer();
    const prefixBytes = new TextEncoder().encode(MAGIC_PREFIX);
    
    // Check if starts with ENC:
    const potentialPrefix = new Uint8Array(buffer.slice(0, prefixBytes.length));
    const isEncrypted = prefixBytes.every((val, i) => val === potentialPrefix[i]);

    if (!isEncrypted) return blob;

    const key = await getCryptoKey();
    const iv = new Uint8Array(buffer.slice(prefixBytes.length, prefixBytes.length + 12));
    const encryptedData = buffer.slice(prefixBytes.length + 12);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encryptedData
    );

    return new Blob([decrypted], { type: originalType });
  } catch (error) {
    // Unencrypted file or key mismatch - return raw blob safely without alarming console warnings
    return blob;
  }
};

/**
 * Helper to decrypt a URL (fetches, decrypts, and returns a local object URL)
 */
export const decryptUrl = async (url, type = 'image/jpeg') => {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return url;
  try {
    const separator = url.includes('?') ? '&' : '?';
    const fetchUrl = `${url}${separator}_cb=${Date.now()}`;
    const headers = {};
    const token = localStorage.getItem('authToken');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const response = await fetch(fetchUrl, { headers });
    if (!response.ok) return url;
    const blob = await response.blob();
    if (blob.size === 0) return url;

    const textData = await blob.text();
    if (textData.startsWith('data:') && textData.includes(';base64,')) {
      const res = await fetch(textData);
      const decBlob = await res.blob();
      return URL.createObjectURL(decBlob);
    }

    // Check if the payload is already an unencrypted image, video, or PDF
    const headerBuffer = await blob.slice(0, 16).arrayBuffer();
    const headerBytes = new Uint8Array(headerBuffer);
    const isMkvWebm = headerBytes[0] === 0x1a && headerBytes[1] === 0x45 && headerBytes[2] === 0xdf && headerBytes[3] === 0xa3;
    const isMp4 = String.fromCharCode(...headerBytes.slice(4, 8)) === 'ftyp';
    const isPng = headerBytes[0] === 0x89 && headerBytes[1] === 0x50 && headerBytes[2] === 0x4e && headerBytes[3] === 0x47;
    const isJpg = headerBytes[0] === 0xff && headerBytes[1] === 0xd8 && headerBytes[2] === 0xff;
    const isPdf = headerBytes[0] === 0x25 && headerBytes[1] === 0x50 && headerBytes[2] === 0x44 && headerBytes[3] === 0x46;

    let decryptedBlob = blob;
    if (!isMkvWebm && !isMp4 && !isPng && !isJpg && !isPdf) {
      decryptedBlob = await decryptDocument(blob, type);
    }
    return URL.createObjectURL(decryptedBlob);
  } catch (error) {
    return url;
  }
};
