import React, { useRef, useEffect, useState, useImperativeHandle, forwardRef } from 'react';

const SignaturePad = forwardRef(({ 
  onSignatureChange, 
  width = 500, 
  height = 200,
  penColor = "#000"
}, ref) => {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);

  // Resize canvas to match the actual rendered container size
  const resizeCanvas = () => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const newW = Math.floor(rect.width) || width;
    const newH = Math.floor(rect.height) || height;

    // Only resize if dimensions changed (avoids clearing a clean canvas)
    if (canvas.width !== newW || canvas.height !== newH) {
      // Preserve existing drawing
      const imageData = canvas.toDataURL();
      canvas.width = newW;
      canvas.height = newH;

      // Re-apply context styles after resize
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, newW, newH);
      ctx.strokeStyle = penColor;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Restore drawing if canvas wasn't empty
      if (!isEmpty) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, newW, newH);
        img.src = imageData;
      }
    }
  };

  useImperativeHandle(ref, () => ({
    clear: () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      setIsEmpty(true);
      if (onSignatureChange) onSignatureChange(null);
    },
    isEmpty: () => isEmpty,
    getCanvas: () => canvasRef.current,
    getTrimmedCanvas: () => canvasRef.current,
    toDataURL: (type = 'image/png') => {
      return canvasRef.current ? canvasRef.current.toDataURL(type) : '';
    }
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // Initial resize to match container
    resizeCanvas();

    // Watch for container size changes (e.g., orientation change, panel open/close)
    let observer;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => resizeCanvas());
      observer.observe(container);
    }

    return () => {
      if (observer) observer.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [penColor]);

  const getCoordinates = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    // Handle both mouse and touch events
    const clientX = e.clientX ?? (e.touches && e.touches[0].clientX);
    const clientY = e.clientY ?? (e.touches && e.touches[0].clientY);
    
    // Scale coordinates to match internal canvas resolution
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    
    return { x, y };
  };

  const startDrawing = (e) => {
    if (e.touches) e.preventDefault();
    
    setIsDrawing(true);
    setIsEmpty(false);
    const coords = getCoordinates(e);
    const ctx = canvasRef.current.getContext('2d');
    
    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    if (e.touches) e.preventDefault();
    
    const ctx = canvasRef.current.getContext('2d');
    const coords = getCoordinates(e);
    
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (isDrawing) {
      setIsDrawing(false);
      const canvas = canvasRef.current;
      const signatureData = canvas.toDataURL();
      if (onSignatureChange) onSignatureChange(signatureData);
    }
  };

  return (
    <div
      ref={containerRef}
      className="signature-pad-container"
      style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}
    >
      <canvas
        ref={canvasRef}
        style={{
          cursor: 'crosshair',
          touchAction: 'none',
          backgroundColor: 'white',
          display: 'block',
          width: '100%',
          height: '100%',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
      />
    </div>
  );
});

export default SignaturePad;
