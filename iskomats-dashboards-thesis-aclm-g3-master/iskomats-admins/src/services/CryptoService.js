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

export const resolveProxiedMediaUrl = (url) => {
  if (!url || typeof url !== 'string') return url;
  const trimmed = url.trim();
  if (
    trimmed.includes('.supabase.co/storage/v1/object/') ||
    trimmed.includes('/storage/v1/object/')
  ) {
    const origin = (import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'https://iskomats-backend.onrender.com')
      .replace(/\/+$/, '')
      .replace(/\/api\/?$/, '');
    return `${origin}/api/admin/storage/proxy?url=${encodeURIComponent(trimmed)}`;
  }
  return trimmed;
};

export const clearUrlCache = (url = null) => {
  if (url) {
    const p = urlCache.get(url);
    if (p) {
      p.then((resolvedUrl) => {
        if (typeof resolvedUrl === 'string' && resolvedUrl.startsWith('blob:')) {
          try { URL.revokeObjectURL(resolvedUrl); } catch {}
        }
      }).catch(() => {});
      urlCache.delete(url);
    }
  } else {
    urlCache.forEach((promise) => {
      promise.then((resolvedUrl) => {
        if (typeof resolvedUrl === 'string' && resolvedUrl.startsWith('blob:')) {
          try { URL.revokeObjectURL(resolvedUrl); } catch {}
        }
      }).catch(() => {});
    });
    urlCache.clear();
  }
};

export const decryptUrl = (url, type = 'image/jpeg', forceRefresh = false) => {
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

  const proxiedUrl = resolveProxiedMediaUrl(url);

  // Instant zero-blocking playback for all videos: browser native HTML5 player streams HTTP 206 chunks directly from proxy
  if (isVideo) {
    return Promise.resolve(proxiedUrl);
  }

  if (!forceRefresh && urlCache.has(url)) {
    return urlCache.get(url);
  }

  const decryptPromise = (async () => {
    try {
      let response = await fetch(proxiedUrl, { 
        cache: forceRefresh ? 'no-cache' : 'default',
        headers: { 'Pragma': 'no-cache' }
      });

      // Resilient fallback if /api/admin/storage/proxy fails (e.g. try /api/storage/proxy or /api/student/storage/proxy)
      if (!response.ok && proxiedUrl.includes('/api/admin/storage/proxy')) {
        const altUrls = [
          proxiedUrl.replace('/api/admin/storage/proxy', '/api/storage/proxy'),
          proxiedUrl.replace('/api/admin/storage/proxy', '/api/student/storage/proxy')
        ];
        for (const altUrl of altUrls) {
          try {
            const fallbackRes = await fetch(altUrl, {
              cache: forceRefresh ? 'no-cache' : 'default',
              headers: { 'Pragma': 'no-cache' }
            });
            if (fallbackRes.ok) {
              response = fallbackRes;
              break;
            }
          } catch (_) {}
        }
      }

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

      // Return local Object URL from the downloaded blob so private cloud storage URLs render seamlessly
      try {
        return URL.createObjectURL(blob);
      } catch (e) {
        return url;
      }
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
export const preloadMediaUrls = (urls = [], type = 'image/jpeg', forceRefresh = false) => {
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
    decryptUrl(url, type || 'image/jpeg', forceRefresh);
  });
};
