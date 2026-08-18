/**
 * Utility for fast client-side image compression.
 * Resizes large smartphone/camera photos before sending them over the network.
 */
export const compressImage = (file, maxDim = 800, quality = 0.75) => {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve(null);
      return;
    }

    // If it's already a small string or not a Blob/File
    if (typeof file === 'string') {
      resolve(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedBase64);
      };
      img.onerror = () => {
        // If image object fails to load, fallback to reader result
        resolve(event.target.result);
      };
      img.src = event.target.result;
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
};

if (typeof window !== 'undefined') {
  window.compressImage = compressImage;
}
