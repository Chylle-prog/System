import React, { useRef, useEffect, useState, useImperativeHandle, forwardRef } from 'react';

const SignaturePad = forwardRef(({ 
  onSignatureChange, 
  width = 500, 
  height = 200,
  penColor = "#000"
}, ref) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);

  useImperativeHandle(ref, () => ({
    clear: () => {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      setIsEmpty(true);
      if (onSignatureChange) onSignatureChange(null);
    },
    isEmpty: () => isEmpty,
    getTrimmedCanvas: () => {
      return canvasRef.current;
    },
    toDataURL: (type) => {
      return canvasRef.current.toDataURL(type);
    }
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    
    // Set initial canvas state - Match Verifier Bench specs
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = penColor;
    ctx.lineWidth = 2.5; // EXACT match with Verifier Bench
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, [penColor]);

  const getCoordinates = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    // Handle both mouse and touch events
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    
    // Scale coordinates EXACTLY like Verifier Bench
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
    <div className="signature-pad-container" style={{ width: '100%', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          cursor: 'crosshair',
          touchAction: 'none',
          backgroundColor: 'white',
          display: 'block',
          width: '100%'
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
