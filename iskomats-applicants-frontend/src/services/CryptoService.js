/**
 * CryptoService for ISKOMATS (Applicant Site)
 * Provides client-side encryption and high-performance decryption for sensitive documents and videos.
 * Features instant video stream passthrough, persistent Object URL caching, and parallel preloading.
 */

const CANDIDATE_KEY_STRS = [
  import.meta.env.VITE_ENCRYPTION_KEY,
  '4uLE7rdLawGyh8a7cT33ZAdMxDfZ_NpBUyjS4oYWiPw=',
  'iskomats-system-secret-key-2024'
].filter(Boolean);

const MAGIC_PREFIX = 'ENC:';

const urlCache = new Map();
let cryptoKeysPromise = null;

const getCryptoKeys = async () => {
  if (!cryptoKeysPromise) {
    cryptoKeysPromise = (async () => {
      const enc = new TextEncoder();
      const keys = [];
      const seen = new Set();
      for (const str of CANDIDATE_KEY_STRS) {
        const keyData = enc.encode(str.padEnd(32, '0').slice(0, 32));
        const keyId = Array.from(keyData).join(',');
        if (seen.has(keyId)) continue;
        seen.add(keyId);
        try {
          const k = await crypto.subtle.importKey(
            'raw',
            keyData,
            { name: 'AES-GCM' },
            false,
            ['encrypt', 'decrypt']
          );
          keys.push(k);
        } catch (e) {
          console.warn('[CRYPTO] Failed to import key candidate:', e);
        }
      }
      return keys;
    })();
  }
  return cryptoKeysPromise;
};

const getCryptoKey = async () => {
  const keys = await getCryptoKeys();
  return keys[0];
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
    return data;
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
    
    if (buffer.byteLength < prefixBytes.length + 12) return blob;

    const potentialPrefix = new Uint8Array(buffer.slice(0, prefixBytes.length));
    const isEncrypted = prefixBytes.every((val, i) => val === potentialPrefix[i]);

    if (!isEncrypted) return blob;

    const keys = await getCryptoKeys();
    const iv = new Uint8Array(buffer.slice(prefixBytes.length, prefixBytes.length + 12));
    const encryptedData = buffer.slice(prefixBytes.length + 12);

    for (const key of keys) {
      try {
        const decrypted = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv },
          key,
          encryptedData
        );
        return new Blob([decrypted], { type: originalType });
      } catch {
        continue;
      }
    }

    return blob;
  } catch (error) {
    return blob;
  }
};

/**
 * Helper to decrypt a URL (fetches, decrypts, and returns a local object URL with persistent caching)
 */
export const decryptUrl = (url, type = 'image/jpeg') => {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return Promise.resolve(url);

  const isVideo = Boolean(
    (type && type.startsWith('video')) ||
    url.toLowerCase().includes('.mp4') ||
    url.toLowerCase().includes('.webm') ||
    url.toLowerCase().includes('.mov') ||
    url.toLowerCase().includes('/video/') ||
    url.toLowerCase().includes('video') ||
    url.toLowerCase().includes('_vid_url') ||
    url.toLowerCase().includes('face_video') ||
    url.toLowerCase().includes('mayorindigency_video') ||
    url.toLowerCase().includes('mayorgrades_video') ||
    url.toLowerCase().includes('mayorcoe_video') ||
    url.toLowerCase().includes('schoolidfront_video') ||
    url.toLowerCase().includes('schoolidback_video')
  );

  // All video streams play immediately via native browser HTML5 player (zero blocking blob downloads)
  if (isVideo || url.includes('/applicant/document/raw/')) {
    return Promise.resolve(url);
  }

  if (urlCache.has(url)) {
    return urlCache.get(url);
  }

  const decryptPromise = (async () => {
    try {
      const headers = {};
      const token = localStorage.getItem('authToken');
      if (token && !url.includes('supabase.co')) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      let response = null;
      try {
        response = await fetch(url, { headers, cache: 'default' });
      } catch (e) {
        response = await fetch(url).catch(() => null);
      }

      if (!response || !response.ok) return url;
      const blob = await response.blob();
      if (!blob || blob.size === 0) return url;

      // Check if the payload is a base64 Data URI string
      const sampleBuffer = await blob.slice(0, 100).arrayBuffer();
      const sampleText = new TextDecoder().decode(sampleBuffer);
      if (sampleText.startsWith('data:') && sampleText.includes(';base64,')) {
        const fullText = await blob.text();
        const res = await fetch(fullText);
        const decBlob = await res.blob();
        return URL.createObjectURL(decBlob);
      }

      // Check magic headers
      const headerBuffer = await blob.slice(0, 16).arrayBuffer();
      const headerBytes = new Uint8Array(headerBuffer);
      const isMkvWebm = headerBytes[0] === 0x1a && headerBytes[1] === 0x45 && headerBytes[2] === 0xdf && headerBytes[3] === 0xa3;
      const isMp4 = String.fromCharCode(...headerBytes.slice(4, 8)) === 'ftyp';
      const isPng = headerBytes[0] === 0x89 && headerBytes[1] === 0x50 && headerBytes[2] === 0x4e && headerBytes[3] === 0x47;
      const isJpg = headerBytes[0] === 0xff && headerBytes[1] === 0xd8 && headerBytes[2] === 0xff;
      const isPdf = headerBytes[0] === 0x25 && headerBytes[1] === 0x50 && headerBytes[2] === 0x44 && headerBytes[3] === 0x46;

      let targetMimeType = type || 'image/jpeg';
      if (isPdf) targetMimeType = 'application/pdf';
      else if (isPng) targetMimeType = 'image/png';
      else if (isJpg) targetMimeType = 'image/jpeg';

      const prefixBytes = new TextEncoder().encode(MAGIC_PREFIX);
      if (blob.size >= prefixBytes.length + 12) {
        const potentialPrefix = new Uint8Array(sampleBuffer.slice(0, prefixBytes.length));
        const isEncrypted = prefixBytes.every((val, i) => val === potentialPrefix[i]);

        if (isEncrypted) {
          const decryptedBlob = await decryptDocument(blob, targetMimeType);
          if (decryptedBlob && decryptedBlob !== blob) {
            return URL.createObjectURL(decryptedBlob);
          }
        }
      }

      if (isPng || isJpg || isPdf) {
        return URL.createObjectURL(new Blob([blob], { type: targetMimeType }));
      }

      return url;
    } catch (error) {
      return url;
    }
  })();

  urlCache.set(url, decryptPromise);
  return decryptPromise;
};

/**
 * Preload media URLs concurrently in the background
 */
export const preloadMediaUrls = (urls = [], type = 'image/jpeg') => {
  if (!Array.isArray(urls) || urls.length === 0) return;
  const imageUrls = urls.filter(u => 
    u && 
    typeof u === 'string' && 
    u.startsWith('http') && 
    !u.toLowerCase().includes('.mp4') && 
    !u.toLowerCase().includes('video') &&
    !u.toLowerCase().includes('_vid')
  );

  imageUrls.forEach(url => {
    decryptUrl(url, type || 'image/jpeg');
  });
};
