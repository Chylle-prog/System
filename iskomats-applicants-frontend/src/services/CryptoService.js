
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
    console.error('[CRYPTO] Decryption failed:', error);
    return blob;
  }
};

/**
 * Helper to decrypt a URL (fetches, decrypts, and returns a local object URL)
 */
export const decryptUrl = async (url, type = 'image/jpeg') => {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return url;
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const decryptedBlob = await decryptDocument(blob, type);
    return URL.createObjectURL(decryptedBlob);
  } catch (error) {
    console.warn('[CRYPTO] Failed to fetch and decrypt URL:', url, error);
    return url;
  }
};
