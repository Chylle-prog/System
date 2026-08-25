/**
 * CryptoService for ISKOMATS (Admin Site)
 * Matches the encryption logic on the applicant site with high-performance caching and fast video inspection.
 */

const ENCRYPTION_KEY_STR = import.meta.env.VITE_ENCRYPTION_KEY || 'iskomats-system-secret-key-2024';
const MAGIC_PREFIX = 'ENC:';

const urlCache = new Map();

const getCryptoKey = async () => {
  const enc = new TextEncoder();
  const keyData = enc.encode(ENCRYPTION_KEY_STR.padEnd(32, '0').slice(0, 32));
  return crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
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

export const decryptUrl = async (url, type = 'image/jpeg') => {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return url;

  if (urlCache.has(url)) {
    return urlCache.get(url);
  }

  const decryptPromise = (async () => {
    try {
      const isVideo = Boolean(
        (type && type.startsWith('video')) ||
        url.toLowerCase().includes('.mp4') ||
        url.toLowerCase().includes('.webm') ||
        url.toLowerCase().includes('.mov') ||
        url.toLowerCase().includes('/video/') ||
        url.toLowerCase().includes('video')
      );

      // Cloudinary and standard hosted videos stream directly via browser for instant buffer-free playback
      if (isVideo && (url.includes('cloudinary.com') || url.includes('res.cloudinary') || !url.includes('encrypted'))) {
        return url;
      }

      const prefixBytes = new TextEncoder().encode(MAGIC_PREFIX);

      // Fast check for videos using Range request to avoid downloading multi-megabyte files unnecessarily
      if (isVideo) {
        try {
          const headResp = await fetch(url, {
            headers: { 'Range': `bytes=0-${prefixBytes.length + 12 - 1}` },
            cache: 'default'
          });

          if (headResp.status === 206 || headResp.ok) {
            const sampleBuffer = await headResp.arrayBuffer();
            if (sampleBuffer.byteLength >= prefixBytes.length) {
              const samplePrefix = new Uint8Array(sampleBuffer.slice(0, prefixBytes.length));
              const isEncrypted = prefixBytes.every((val, i) => val === samplePrefix[i]);

              if (!isEncrypted) {
                return url; // Stream directly via browser native player!
              }
            }
          }
        } catch (rangeErr) {
          // If range check fails on a video, return the URL to let browser stream natively instead of blocking on full download
          return url;
        }
      }

      const response = await fetch(url, { cache: 'force-cache' });
      if (!response.ok) {
        console.warn(`[CRYPTO] Failed to fetch media (HTTP ${response.status}):`, url);
        return url;
      }
      const blob = await response.blob();
      if (blob.size === 0) return url;

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

      // Unencrypted file — return original url directly so browser handles native caching and fast rendering!
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
  if (!Array.isArray(urls)) return;
  const imageUrls = urls.filter(u => u && typeof u === 'string' && u.startsWith('http') && !u.toLowerCase().includes('.mp4') && !u.toLowerCase().includes('video'));

  // Preload images in parallel so dossier document photos appear instantly
  imageUrls.forEach(url => {
    decryptUrl(url, type || 'image/jpeg');
  });
};
