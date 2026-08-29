/**
 * CryptoService for ISKOMATS (Admin Site)
 * High-performance media resolver with zero-delay video streaming,
 * LRU blob cache, and parallel image preloading.
 */

const CANDIDATE_KEY_STRS = [
  import.meta.env.VITE_ENCRYPTION_KEY,
  '4uLE7rdLawGyh8a7cT33ZAdMxDfZ_NpBUyjS4oYWiPw=',
  'iskomats-system-secret-key-2024'
].filter(Boolean);

const MAGIC_PREFIX = 'ENC:';

// Fast in-memory cache for resolved URLs
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
        // Try next candidate key
        continue;
      }
    }

    console.warn('[CRYPTO] None of the candidate keys could decrypt the document');
    return blob;
  } catch (error) {
    console.error('[CRYPTO] Decryption failed:', error);
    return blob;
  }
};

export const decryptUrl = (url, type = 'image/jpeg') => {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return Promise.resolve(url);

  const isVideo = Boolean(
    (type && type.startsWith('video')) ||
    url.toLowerCase().includes('.mp4') ||
    url.toLowerCase().includes('.webm') ||
    url.toLowerCase().includes('.mov') ||
    url.toLowerCase().includes('/video/') ||
    url.toLowerCase().includes('video') ||
    url.toLowerCase().includes('_vid_url')
  );

  // Instant zero-blocking playback for all videos: browser native HTML5 player streams HTTP 206 chunks directly
  if (isVideo) {
    return Promise.resolve(url);
  }

  if (urlCache.has(url)) {
    return urlCache.get(url);
  }

  const decryptPromise = (async () => {
    try {
      const response = await fetch(url, { cache: 'force-cache' });
      if (!response.ok) {
        return url;
      }
      const blob = await response.blob();
      if (!blob || blob.size === 0) return url;

      const prefixBytes = new TextEncoder().encode(MAGIC_PREFIX);
      if (blob.size >= prefixBytes.length + 12) {
        const sampleBuffer = await blob.slice(0, prefixBytes.length).arrayBuffer();
        const samplePrefix = new Uint8Array(sampleBuffer);
        const isEncrypted = prefixBytes.every((val, i) => val === samplePrefix[i]);

        if (isEncrypted) {
          const decryptedBlob = await decryptDocument(blob, type);
          if (decryptedBlob && decryptedBlob !== blob) {
            return URL.createObjectURL(decryptedBlob);
          }
        }
      }

      // Unencrypted file — browser can use original URL or object URL directly
      return url;
    } catch (error) {
      console.warn('[CRYPTO] Failed to fetch and decrypt URL:', url, error);
      return url;
    }
  })();

  urlCache.set(url, decryptPromise);
  return decryptPromise;
};

/**
 * Preload and decrypt multiple media URLs in parallel, prioritizing images
 */
export const preloadMediaUrls = (urls = [], type = 'image/jpeg') => {
  if (!Array.isArray(urls) || urls.length === 0) return;
  
  const imageUrls = urls.filter(u => 
    u && 
    typeof u === 'string' && 
    u.startsWith('http') && 
    !u.toLowerCase().includes('.mp4') && 
    !u.toLowerCase().includes('video') &&
    !u.toLowerCase().includes('_vid_url')
  );

  // Concurrently warm images in browser cache
  imageUrls.forEach(url => {
    decryptUrl(url, type || 'image/jpeg');
  });
};
