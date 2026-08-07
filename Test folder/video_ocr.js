/**
 * Iskomats Bulletproof Seek-and-Extract Video OCR Engine
 * Standalone Localhost Proof-of-Concept for COR & Grades Video Verification
 */

let tesseractWorker = null;

async function getOCRWorker() {
  if (tesseractWorker) return tesseractWorker;

  if (typeof Tesseract === 'undefined') {
    throw new Error('Tesseract.js library not loaded. Check internet or local bundle script.');
  }

  tesseractWorker = await Tesseract.createWorker('eng', 1, {
    workerPath: 'https://unpkg.com/tesseract.js@5.1.0/dist/worker.min.js',
    corePath: 'https://unpkg.com/tesseract.js-core@5.1.0/tesseract-core.wasm.js',
    langPath: 'https://tessdata.projectnaptha.com/4.0.0',
    cacheMethod: 'write'
  });

  try {
    await tesseractWorker.setParameters({
      tessjs_create_hocr: '0',
      tessjs_create_tsv: '0',
      tessedit_pageseg_mode: '6' // Uniform block mode (best for dense document tables)
    });
  } catch (e) {
    console.warn('[VIDEO OCR] Worker parameter note:', e);
  }

  return tesseractWorker;
}

/**
 * Bulletproof Video Frame Extractor using HTML5 Video Seeking
 * Seeks to target percentage timestamps and extracts clean, non-blank frames.
 */
async function extractVideoFramesViaSeeking(videoFile, sampleRatios = [0.15, 0.35, 0.60, 0.85], maxDim = 1600) {
  return new Promise((resolve, reject) => {
    if (!videoFile) return reject(new Error('No video file or blob provided.'));

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    const objectUrl = URL.createObjectURL(videoFile);
    video.src = objectUrl;

    const frames = [];

    const cleanup = () => {
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.remove();
      } catch (e) {}
      URL.revokeObjectURL(objectUrl);
    };

    video.onerror = (err) => {
      cleanup();
      reject(new Error('Failed to load video metadata: ' + (err.message || 'Invalid video file format')));
    };

    video.onloadedmetadata = async () => {
      try {
        const duration = video.duration || 5;
        const vw = video.videoWidth;
        const vh = video.videoHeight;

        if (!vw || !vh) {
          cleanup();
          return reject(new Error('Video has 0x0 dimensions. Video track might be corrupted or missing.'));
        }

        // Compute scaled target dimensions for OCR
        let targetW = vw;
        let targetH = vh;
        if (targetW > maxDim || targetH > maxDim) {
          if (targetW > targetH) {
            targetH = Math.round((targetH * maxDim) / targetW);
            targetW = maxDim;
          } else {
            targetW = Math.round((targetW * maxDim) / targetH);
            targetH = maxDim;
          }
        }

        const timestamps = sampleRatios.map(r => Math.max(0.1, Math.min(duration - 0.1, duration * r)));

        for (let i = 0; i < timestamps.length; i++) {
          const seekTime = timestamps[i];

          await new Promise((seekResolve) => {
            const onSeeked = () => {
              video.removeEventListener('seeked', onSeeked);

              const canvas = document.createElement('canvas');
              canvas.width = targetW;
              canvas.height = targetH;
              const ctx = canvas.getContext('2d');
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = 'high';
              ctx.drawImage(video, 0, 0, targetW, targetH);

              frames.push({
                time: seekTime,
                canvas: canvas,
                dataUrl: canvas.toDataURL('image/jpeg', 0.90)
              });

              seekResolve();
            };

            video.addEventListener('seeked', onSeeked, { once: true });
            video.currentTime = seekTime;
          });
        }

        cleanup();
        resolve(frames);
      } catch (err) {
        cleanup();
        reject(err);
      }
    };
  });
}

/**
 * Keyword & Category Evaluator
 */
function evaluateExtractedVideoText(textLogs, docType, expectedName, expectedId) {
  const combinedRaw = (textLogs || []).join(' ').toLowerCase();
  const cleanText = combinedRaw.replace(/[^a-z0-9\s]/g, ' ');

  const nameWords = (expectedName || '').toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  const matchedNameWords = nameWords.filter(w => cleanText.includes(w));
  const hasNameMatch = nameWords.length > 0 && (matchedNameWords.length >= Math.ceil(nameWords.length * 0.6));

  const cleanId = (expectedId || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const hasIdMatch = cleanId.length >= 4 && cleanText.includes(cleanId);

  // Keyword maps
  const keywordMap = {
    COR: ['certificate', 'registration', 'enrollment', 'official', 'student', 'college', 'semester', 'academic', 'course', 'school', 'university', 'certify', 'bonafide', 'enrolled', 'registrar', 'units', 'cor', 'coe', 'total', 'subject', 'load', 'sy', 'ay'],
    Grades: ['grade', 'grades', 'transcript', 'gpa', 'gwa', 'academic', 'rating', 'remarks', 'passed', 'subject', 'subjects', 'units', 'unit', 'evaluation', 'record', 'scholastic', 'registrar', 'student', 'school', 'college', 'course', 'term', 'semester', 'tor'],
    Indigency: ['indigency', 'indigent', 'certificate', 'barangay', 'punong', 'certify', 'office', 'bayan', 'lipa', 'batangas', 'whom', 'concern', 'resident', 'bonafide', 'republic', 'philippines'],
    SchoolID: ['republic', 'philippines', 'school', 'student', 'id', 'college', 'university', 'card', 'signature', 'valid', 'identity']
  };

  const targetKeywords = keywordMap[docType] || keywordMap['COR'];
  const matchedKeywords = targetKeywords.filter(k => cleanText.includes(k));

  const isMatched = hasNameMatch || hasIdMatch || (matchedKeywords.length >= 1) || (cleanText.trim().length >= 15);

  return {
    valid: isMatched,
    isMatched: isMatched,
    nameMatch: hasNameMatch,
    idMatch: hasIdMatch,
    matchedKeywords: matchedKeywords,
    detectedTextLength: combinedRaw.length,
    rawText: (textLogs || []).join('\n\n')
  };
}
