import React, { useRef, useEffect, useState, useImperativeHandle, forwardRef } from 'react';

const SignaturePad = forwardRef(({ 
  onSignatureChange, 
  width = 500, 
  height = 200,
  penColor = "#000",
  minWidth = 0.5,
  maxWidth = 2.5,
  velocityFilterWeight = 0.7,
  canvasProps = {}
}, ref) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);
  const lastPoint = useRef(null);

  useImperativeHandle(ref, () => ({
    clear: () => {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      setIsEmpty(true);
      lastPoint.current = null;
      if (onSignatureChange) onSignatureChange(null);
    },
    isEmpty: () => isEmpty,
    getTrimmedCanvas: () => {
      // In this version, we just return the full canvas
      // A more complex version would trim whitespace
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
    
    // Set initial canvas state
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  const getCoordinates = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    // Handle both mouse and touch events
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    
    // Scale coordinates based on canvas internal resolution vs visual size
    const x = (clientX - rect.left) * (canvas.width / rect.width);
    const y = (clientY - rect.top) * (canvas.height / rect.height);
    
    return { x, y };
  };

  const startDrawing = (e) => {
    // Prevent default scrolling on touch
    if (e.touches) e.preventDefault();
    
    setIsDrawing(true);
    setIsEmpty(false);
    const coords = getCoordinates(e);
    lastPoint.current = coords;
  };

  const draw = (e) => {
    if (!isDrawing) return;
    if (e.touches) e.preventDefault();
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const coords = getCoordinates(e);
    
    if (lastPoint.current) {
      ctx.beginPath();
      ctx.strokeStyle = penColor;
      ctx.lineWidth = maxWidth; // Simplified: no velocity-based width yet
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
      ctx.lineTo(coords.x, coords.y);
      ctx.stroke();
    }
    
    lastPoint.current = coords;
  };

  const stopDrawing = () => {
    if (isDrawing) {
      setIsDrawing(false);
      lastPoint.current = null;
      const canvas = canvasRef.current;
      const signatureData = canvas.toDataURL();
      if (onSignatureChange) onSignatureChange(signatureData);
    }
  };

  const mergedCanvasProps = {
    ...canvasProps,
    ref: canvasRef,
    width: width,
    height: height,
    style: {
      cursor: 'crosshair',
      touchAction: 'none',
      backgroundColor: 'white',
      display: 'block',
      ...canvasProps.style
    },
    onMouseDown: startDrawing,
    onMouseMove: draw,
    onMouseUp: stopDrawing,
    onMouseLeave: stopDrawing,
    onTouchStart: startDrawing,
    onTouchMove: draw,
    onTouchEnd: stopDrawing
  };

  return (
    <div className="signature-pad-container" style={{ width: '100%', overflow: 'hidden' }}>
      <canvas {...mergedCanvasProps} />
    </div>
  );
});

export default SignaturePad;
