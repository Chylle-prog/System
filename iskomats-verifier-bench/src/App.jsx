import React, { useState, useEffect, useRef } from 'react';
import { 
  FileText, 
  UserCheck, 
  ShieldCheck, 
  RefreshCw, 
  Search, 
  Info, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  Fingerprint,
  Camera,
  Activity,
  Code,
  PenTool,
  Sparkles
} from 'lucide-react';
import * as api from './api';

const DEFAULT_API_URL = api.getBaseUrl();

const App = () => {
  const [activeTab, setActiveTab] = useState('ocr');
  const [token, setToken] = useState(localStorage.getItem('verifier_token') || '');
  const [apiUrl, setApiUrl] = useState(api.getBaseUrl());
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [lastSignatureImage, setLastSignatureImage] = useState(null);
  
  // Form States
  const [form, setForm] = useState({
    firstName: 'Alexie Chyle',
    lastName: 'Magbuhat',
    townCity: 'Lipa City',
    idFront: null,
    indigencyDoc: null,
    enrollmentDoc: null,
    gradesDoc: null,
    faceImage: null,
    signatureImage: null,
    idBackImage: null,
    schoolName: 'National University',
    course: 'BS Information Technology',
    expectedGPA: '1.25',
    expectedYear: '2026'
  });

  const [previews, setPreviews] = useState({});
  const signatureCanvasRef = useRef(null);

  useEffect(() => {
    localStorage.setItem('verifier_token', token);
    localStorage.setItem('verifier_api_url', apiUrl);
  }, [token, apiUrl]);

  useEffect(() => {
    const normalizedUrl = api.getBaseUrl();
    if (apiUrl !== normalizedUrl) {
      setApiUrl(normalizedUrl);
    }
  }, []);

  const handleFileChange = (e, field) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result;
        setForm(prev => ({ ...prev, [field]: base64 }));
        setPreviews(prev => ({ ...prev, [field]: base64 }));
      };
      reader.readAsDataURL(file);
    }
  };

  const runOcrTest = async () => {
    setLoading(true);
    setResults(null);
    try {
      const res = await api.ocrCheck({
        id_front: form.idFront,
        indigency_doc: form.indigencyDoc,
        enrollment_doc: form.enrollmentDoc,
        grades_doc: form.gradesDoc,
        town_city: form.townCity,
        first_name: form.firstName,
        last_name: form.lastName,
        school_name: form.schoolName,
        course: form.course,
        gpa: form.expectedGPA,
        expected_year: form.expectedYear
      });
      setResults({ type: 'ocr', data: res });
    } catch (err) {
      setResults({ type: 'error', data: api.describeRequestError(err, '/student/verification/ocr-check') });
    } finally {
      setLoading(false);
    }
  };

  const runFaceTest = async () => {
    setLoading(true);
    setResults(null);
    try {
      const res = await api.faceMatch(form.faceImage, form.idFront);
      setResults({ type: 'face', data: res });
    } catch (err) {
      setResults({ type: 'error', data: api.describeRequestError(err, '/student/verification/face-match') });
    } finally {
      setLoading(false);
    }
  };

  const [signatureStats, setSignatureStats] = useState({ strokes: 0, inkMass: 0, entropy: 0 });

  const analyzeSignatureComplexity = (canvas) => {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    let inkPixels = 0;
    let sumX = 0, sumY = 0;
    let points = [];

    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 200) { // Black ink
        inkPixels++;
        const pixelIdx = i / 4;
        const x = pixelIdx % canvas.width;
        const y = Math.floor(pixelIdx / canvas.width);
        sumX += x;
        sumY += y;
        if (inkPixels % 10 === 0) points.push({x, y}); // Sample for entropy
      }
    }

    if (inkPixels === 0) return { score: 0, mass: 0, entropy: 0 };

    const avgX = sumX / inkPixels;
    const avgY = sumY / inkPixels;
    
    let junctions = 0;
    const neighborOffsets = [
      [-1, -1], [0, -1], [1, -1],
      [-1, 0],          [1, 0],
      [-1, 1],  [0, 1],  [1, 1]
    ];

    points.forEach(p => {
      let neighbors = 0;
      neighborOffsets.forEach(([dx, dy]) => {
        const nx = p.x + dx;
        const ny = p.y + dy;
        const idx = (ny * canvas.width + nx) * 4;
        if (data[idx] < 200) neighbors++;
      });
      if (neighbors > 2) junctions++;
    });
    
    // Heuristic: Real signatures have many junctions (overlapping strokes, tight curves)
    const normalizedMass = Math.min(1, inkPixels / 2000);
    const normalizedJunctions = Math.min(1, junctions / 150); // 150 junctions for a decent signature
    
    // Complexity score now favors structured "junction-rich" handwriting
    const score = (normalizedMass * 0.3) + (normalizedJunctions * 0.7);
    
    return { score, mass: inkPixels, junctions };
  };

  const runSignatureTest = async () => {
    setLoading(true);
    setResults(null);
    try {
      const canvas = signatureCanvasRef.current;
      if (!canvas) throw new Error('Canvas not initialized');
      
      const signatureData = canvas.toDataURL('image/png');
      setLastSignatureImage(signatureData);
      
      const complexity = analyzeSignatureComplexity(canvas);
      setSignatureStats(prev => ({ ...prev, inkMass: complexity.mass, junctions: complexity.junctions }));

      const res = await api.signatureMatch(signatureData, form.idBackImage);
      
      // If complexity is extremely low, override a "successful" match
      if (complexity.score < 0.22 && res.verified) {
        res.verified = false;
        res.message = `[Bench Rejected] Simple doodle detected. Structure score: ${(complexity.score * 100).toFixed(1)}%.`;
      }

      setResults({ type: 'signature', data: res });
    } catch (err) {
      setResults({ type: 'error', data: api.describeRequestError(err, '/student/verification/signature-match') });
    } finally {
      setLoading(false);
    }
  };

  const handleSignatureFeedback = async (type) => {
    if (!results || results.type !== 'signature' || !lastSignatureImage) return;

    try {
      setLoading(true);
      const res = await fetch(`${apiUrl}/student/verification/signature-feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          signature_image: lastSignatureImage,
          decision: type, // 'agree' or 'disagree'
          was_verified: results?.data?.verified || false
        })
      });

      const data = await res.json();
      if (data.success) {
        alert(data.message || 'Feedback saved successfully!');
      } else {
        alert('Feedback failed: ' + (data.message || 'Unknown error'));
      }
    } catch (error) {
      console.error('Feedback error:', error);
      alert('Error sending feedback: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const [isDrawing, setIsDrawing] = useState(false);

  const startDrawing = (e) => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearSignatureCanvas = () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  // Initialize canvas when signature tab is active
  useEffect(() => {
    if (activeTab === 'signature') {
      setTimeout(clearSignatureCanvas, 100);
    }
  }, [activeTab]);

  const renderOcrResults = () => {
    if (!results || results.type !== 'ocr') return null;
    const { data } = results;
    
    return (
      <div className="results-content">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Activity size={20} className="text-secondary" /> Verification Report
          </h3>
          <span className={`status-badge ${data.verified ? 'status-success' : 'status-failed'}`}>
            {data.verified ? 'All Passed' : 'Verification Issue'}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {data.details && data.details.map((detail, idx) => (
            <div key={idx} className="card" style={{ background: 'rgba(15, 23, 42, 0.4)', padding: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ fontWeight: '700', color: '#818cf8' }}>{detail.doc} Check</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {detail.school_year && (
                    <span style={{ 
                      fontSize: '0.65rem', 
                      background: 'rgba(129, 140, 248, 0.2)', 
                      color: '#a5b4fc', 
                      padding: '2px 6px', 
                      borderRadius: '4px',
                      border: '1px solid rgba(129, 140, 248, 0.3)',
                      fontWeight: '600'
                    }}>
                      A.Y. {detail.school_year}
                    </span>
                  )}
                  {detail.verified ? <CheckCircle2 size={16} color="#10b981" /> : <XCircle size={16} color="#ef4444" />}
                </div>
              </div>
              <p style={{ fontSize: '0.8rem', color: detail.verified ? '#f8fafc' : '#ef4444' }}>{detail.message}</p>
              {detail.raw_text && (
                <details style={{ marginTop: '0.5rem' }}>
                  <summary style={{ fontSize: '0.75rem', color: '#64748b', cursor: 'pointer' }}>📄 Raw OCR Text</summary>
                  <pre style={{ marginTop: '0.5rem', fontSize: '0.7rem', color: '#94a3b8', background: 'rgba(0,0,0,0.3)', padding: '0.5rem', borderRadius: '6px', whiteSpace: 'pre-wrap', maxHeight: '150px', overflowY: 'auto' }}>{detail.raw_text}</pre>
                </details>
              )}
            </div>
          ))}
        </div>

        <div style={{ marginTop: '2rem' }}>
          <h4 style={{ fontSize: '0.9rem', marginBottom: '1rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Code size={16} /> RAW SERVER RESPONSE
          </h4>
          <pre className="results-panel">
            <code className="json-view">{JSON.stringify(data, null, 2)}</code>
          </pre>
        </div>
      </div>
    );
  };

  const renderFaceResults = () => {
    if (!results || results.type !== 'face') return null;
    const { data } = results;
    const confidence = data.confidence || 0;
    
    return (
      <div className="results-content">
         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Fingerprint size={20} className="text-secondary" /> Face Match Score
          </h3>
          <span className={`status-badge ${data.verified ? 'status-success' : 'status-failed'}`}>
            {data.verified ? 'Match Confirmed' : 'Identity Mismatch'}
          </span>
        </div>

        <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
           <div style={{ fontSize: '3rem', fontWeight: '900', color: data.verified ? '#10b981' : '#ef4444' }}>
             {confidence.toFixed(1)}%
           </div>
           <div className="confidence-bar">
             <div className="confidence-fill" style={{ width: `${confidence}%` }}></div>
           </div>
           <p style={{ color: 'var(--text-muted)' }}>Confidence Match Score</p>
        </div>

        <div style={{ marginTop: '2rem' }}>
           <p style={{ fontSize: '0.9rem', color: '#f8fafc', padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '10px' }}>
             {data.message}
           </p>
        </div>
      </div>
    );
  };

  const renderSignatureResults = () => {
    if (!results || results.type !== 'signature') return null;
    const { data } = results;
    const isMatch = data.verified;

    return (
      <div className="results-container">
        <div className="score-card">
          <div className="score-header">
            <h3 style={{ fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <PenTool size={20} color="#818cf8" />
              Signature Match Score
            </h3>
            <span className={`status-badge ${isMatch ? 'status-success' : 'status-failed'}`}>
              {isMatch ? 'Valid' : 'Mismatch'}
            </span>
          </div>

          <div className="score-value" style={{ color: isMatch ? '#10b981' : '#ef4444' }}>
            {(data.confidence || 0).toFixed(1)}%
          </div>
          
          <div className="confidence-bar">
            <div className="confidence-fill" style={{ width: `${data.confidence || 0}%`, background: isMatch ? '#10b981' : '#ef4444' }}></div>
          </div>
          <p style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Match Confidence</p>
        </div>

        {/* Training Feedback Loop */}
        <div className="training-loop">
          <p style={{ fontSize: '0.65rem', fontWeight: '800', color: '#818cf8', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Sparkles size={12} /> TRAINING FEEDBACK
          </p>
          <div className="btn-group">
            <button className="btn-feedback btn-agree" onClick={() => handleSignatureFeedback('agree')} disabled={loading}>Agree</button>
            <button className="btn-feedback btn-disagree" onClick={() => handleSignatureFeedback('disagree')} disabled={loading}>Disagree</button>
          </div>
        </div>

        {/* Visual Match Analysis */}
        <div className="visual-analysis">
          <h4 style={{ fontSize: '0.7rem', fontWeight: '800', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Visual Match Analysis</h4>
          <div className="image-grid">
            <div className="image-item">
              <p>Extracted from ID</p>
              <div className="image-container">
                {data.extracted_signature ? (
                  <img src={data.extracted_signature} alt="ID Signature" style={{ filter: 'contrast(1.2)' }} />
                ) : (
                  <span style={{ fontSize: '0.7rem', fontStyle: 'italic', color: '#475569' }}>No Extract</span>
                )}
              </div>
            </div>
            <div className="image-item">
              <p>Processed Submission</p>
              <div className="image-container">
                {data.processed_submitted ? (
                  <img src={data.processed_submitted} alt="Submission" />
                ) : (
                  <span style={{ fontSize: '0.7rem', fontStyle: 'italic', color: '#475569' }}>No Process</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* What The Matcher Sees */}
        <div className="visual-analysis">
          <h4 style={{ fontSize: '0.7rem', fontWeight: '800', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Neural Matcher View</h4>
          <div className="image-grid">
            <div className="image-item">
              <p>Reference (Anchor)</p>
              <div className="image-container" style={{ borderColor: 'rgba(16, 185, 129, 0.3)' }}>
                {data.matcher_reference ? (
                  <img src={data.matcher_reference} alt="Reference View" />
                ) : (
                  <span style={{ fontSize: '0.7rem', fontStyle: 'italic', color: '#475569' }}>No View</span>
                )}
              </div>
            </div>
            <div className="image-item">
              <p>Submitted (Normalized)</p>
              <div className="image-container" style={{ borderColor: 'rgba(16, 185, 129, 0.3)' }}>
                {data.matcher_submitted ? (
                  <img src={data.matcher_submitted} alt="Submitted View" />
                ) : (
                  <span style={{ fontSize: '0.7rem', fontStyle: 'italic', color: '#475569' }}>No View</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Complexity Metrics */}
        <div className="complexity-metrics">
          <h4 style={{ fontSize: '0.65rem', fontWeight: '800', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Activity size={12} /> Complexity Metrics
          </h4>
          <div className="metrics-grid">
            <div className="metric-item">
              <p className="metric-label">Ink Mass</p>
              <p className="metric-value">{signatureStats.inkMass} px</p>
            </div>
            <div className="metric-item">
              <p className="metric-label">Junctions</p>
              <p className="metric-value">{signatureStats.junctions}</p>
            </div>
          </div>
        </div>

        <div style={{ padding: '1rem', borderRadius: '12px', background: isMatch ? 'rgba(16, 185, 129, 0.05)' : 'rgba(239, 68, 68, 0.05)', border: `1px solid ${isMatch ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}` }}>
          <p style={{ fontSize: '0.65rem', fontWeight: '800', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Server Message</p>
          <p style={{ fontSize: '0.85rem' }}>{data.message}</p>
        </div>
      </div>
    );
  };

  return (
    <div className="app-root">
      <div className="auth-bar">
        <label style={{ color: '#94a3b8', fontSize: '0.75rem', fontWeight: '800' }}>API CONFIG</label>
        <input 
          placeholder={`Endpoint URL (default: ${DEFAULT_API_URL})`} 
          value={apiUrl} 
          onChange={(e) => setApiUrl(e.target.value)} 
        />
        <input 
          type="password" 
          placeholder="Bearer Auth Token" 
          value={token} 
          onChange={(e) => setToken(e.target.value)} 
        />
      </div>

      <div className="container">
        <header className="header">
          <h1>Verifier <span style={{ fontWeight: '300' }}>Lab Bench</span></h1>
          <p style={{ color: '#94a3b8' }}>Advanced OCR & Biometric Testing Environment</p>
        </header>

        <nav className="tab-nav">
          <button className={`tab-btn ${activeTab === 'ocr' ? 'active' : ''}`} onClick={() => setActiveTab('ocr')}>
            <FileText size={18} style={{ marginRight: '8px' }} /> Document OCR
          </button>
          <button className={`tab-btn ${activeTab === 'face' ? 'active' : ''}`} onClick={() => setActiveTab('face')}>
            <UserCheck size={18} style={{ marginRight: '8px' }} /> Face Matching
          </button>
          <button className={`tab-btn ${activeTab === 'signature' ? 'active' : ''}`} onClick={() => setActiveTab('signature')}>
            <PenTool size={18} style={{ marginRight: '8px' }} /> Signature Verification
          </button>
        </nav>

        <div className="grid">
          {/* Left Panel: Inputs */}
          <div className="card">
            {activeTab === 'ocr' ? (
              <div className="ocr-inputs">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="input-group">
                    <label>ID Front (Required for Name Match)</label>
                    <div className="upload-area">
                      <input type="file" onChange={(e) => handleFileChange(e, 'idFront')} />
                      {previews.idFront ? <img src={previews.idFront} className="preview-img" /> : 'Drop ID Front'}
                    </div>
                  </div>
                  <div className="input-group">
                    <label>Indigency Doc (Address Match)</label>
                    <div className="upload-area">
                      <input type="file" onChange={(e) => handleFileChange(e, 'indigencyDoc')} />
                      {previews.indigencyDoc ? <img src={previews.indigencyDoc} className="preview-img" /> : 'Drop Indigency'}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                   <div className="input-group">
                    <label>Enrollment (COE)</label>
                    <div className="upload-area">
                      <input type="file" onChange={(e) => handleFileChange(e, 'enrollmentDoc')} />
                      {previews.enrollmentDoc ? <img src={previews.enrollmentDoc} className="preview-img" /> : 'Drop COE'}
                    </div>
                  </div>
                  <div className="input-group">
                    <label>Grades Transcript</label>
                    <div className="upload-area">
                      <input type="file" onChange={(e) => handleFileChange(e, 'gradesDoc')} />
                      {previews.gradesDoc ? <img src={previews.gradesDoc} className="preview-img" /> : 'Drop Grades'}
                    </div>
                  </div>
                </div>

                <div className="input-group">
                  <label>Applicant Identity (Expected)</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.5fr', gap: '10px' }}>
                    <input placeholder="First Name" value={form.firstName} onChange={(e) => setForm(p=>({...p, firstName: e.target.value}))} />
                    <input placeholder="Last Name" value={form.lastName} onChange={(e) => setForm(p=>({...p, lastName: e.target.value}))} />
                    <input placeholder="Expected Town/City" value={form.townCity} onChange={(e) => setForm(p=>({...p, townCity: e.target.value}))} />
                  </div>
                  <div className="input-group" style={{ gridColumn: '1 / -1', marginTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1rem' }}>
                    <label style={{ fontSize: '0.8rem', color: '#818cf8', display: 'block', marginBottom: '0.5rem' }}>Additional Verifications (OCR Context)</label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' }}>
                      <input placeholder="School Name" value={form.schoolName} onChange={(e) => setForm(p=>({...p, schoolName: e.target.value}))} />
                      <input placeholder="Course" value={form.course} onChange={(e) => setForm(p=>({...p, course: e.target.value}))} />
                      <input placeholder="Expected GPA" value={form.expectedGPA} onChange={(e) => setForm(p=>({...p, expectedGPA: e.target.value}))} />
                      <input placeholder="Verification Year (e.g. 2026)" value={form.expectedYear} onChange={(e) => setForm(p=>({...p, expectedYear: e.target.value}))} />
                    </div>
                  </div>
                </div>

                <button className="btn-verify" onClick={runOcrTest} disabled={loading}>
                  {loading ? <RefreshCw className="loading-icon" /> : <ShieldCheck size={20} />} 
                  RUN COMPLETE OCR DIAGNOSTICS
                </button>
              </div>
            ) : activeTab === 'face' ? (
              <div className="face-inputs">
                <div className="input-group">
                  <label>Reference ID Photo</label>
                  <div className="upload-area">
                    <input type="file" onChange={(e) => handleFileChange(e, 'idFront')} />
                    {previews.idFront ? <img src={previews.idFront} className="preview-img" /> : 'Drop ID Photo'}
                  </div>
                </div>

                <div className="input-group">
                  <label>Live/Selfie Photo</label>
                  <div className="upload-area">
                    <input type="file" onChange={(e) => handleFileChange(e, 'faceImage')} />
                    {previews.faceImage ? <img src={previews.faceImage} className="preview-img" /> : 'Drop Selfie'}
                  </div>
                </div>

                <button className="btn-verify" onClick={runFaceTest} disabled={loading}>
                  {loading ? <RefreshCw className="loading-icon" /> : <Camera size={20} />} 
                  MATCH BIOMETRICS
                </button>
              </div>
            ) : activeTab === 'signature' ? (
              <div className="signature-inputs">
                <div className="input-group">
                  <label>Draw Signature</label>
                  <div style={{ background: 'white', borderRadius: '8px', border: '2px solid #334155', padding: '4px', overflow: 'hidden' }}>
                    <canvas 
                      ref={signatureCanvasRef}
                      width={400} 
                      height={120}
                      onMouseDown={startDrawing}
                      onMouseMove={draw}
                      onMouseUp={stopDrawing}
                      onMouseOut={stopDrawing}
                      onTouchStart={startDrawing}
                      onTouchMove={draw}
                      onTouchEnd={stopDrawing}
                      style={{
                        display: 'block',
                        cursor: 'crosshair',
                        touchAction: 'none',
                        width: '100%',
                        height: '120px',
                        backgroundColor: 'white'
                      }}
                    />
                  </div>
                  <button 
                    onClick={clearSignatureCanvas}
                    style={{ 
                      width: '100%', 
                      background: '#1e293b', 
                      color: '#94a3b8', 
                      padding: '8px 16px', 
                      borderRadius: '8px',
                      border: '1px solid #334155',
                      cursor: 'pointer',
                      marginTop: '8px',
                      fontSize: '0.875rem',
                      fontWeight: '600'
                    }}
                    onMouseOver={(e) => e.target.style.background = '#334155'}
                    onMouseOut={(e) => e.target.style.background = '#1e293b'}
                  >
                    Clear Signature
                  </button>
                </div>

                <div className="input-group">
                  <label>ID Back Image</label>
                  <div className="upload-area">
                    <input type="file" onChange={(e) => handleFileChange(e, 'idBackImage')} />
                    {previews.idBackImage ? <img src={previews.idBackImage} className="preview-img" /> : 'Drop ID Back'}
                  </div>
                </div>

                <button className="btn-verify" onClick={runSignatureTest} disabled={loading}>
                  {loading ? <RefreshCw className="loading-icon" /> : <PenTool size={20} />} 
                  VERIFY SIGNATURE
                </button>
              </div>
            ) : null}
          </div>

          {/* Right Panel: Results */}
          <div className="card" style={{ borderLeft: '4px solid #818cf8', background: 'rgba(30, 41, 59, 0.5)' }}>
            {!results && !loading && (
              <div style={{ textAlign: 'center', marginTop: '100px', color: '#64748b' }}>
                <Search size={48} style={{ marginBottom: '1rem', opacity: 0.2 }} />
                <p>Waiting for test execution...</p>
                <p style={{ fontSize: '0.75rem' }}>Upload images and click verify to see diagnostics.</p>
              </div>
            )}

            {loading && (
              <div style={{ textAlign: 'center', marginTop: '100px' }}>
                <RefreshCw size={48} className="loading-icon" style={{ marginBottom: '1rem', color: '#818cf8' }} />
                <p>Processing Verification Request...</p>
                <p style={{ fontSize: '0.75rem', color: '#64748b' }}>Consulting OCR & Biometric Servers</p>
              </div>
            )}

            {results?.type === 'error' && (
              <div style={{ padding: '1rem', borderRadius: '15px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#ef4444', fontWeight: '800', marginBottom: '10px' }}>
                  <AlertTriangle size={20} /> SERVER ERROR
                </div>
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem', color: '#fca5a5' }}>
                  {JSON.stringify(results.data, null, 2)}
                </pre>
              </div>
            )}

            {activeTab === 'ocr' ? renderOcrResults() : activeTab === 'face' ? renderFaceResults() : renderSignatureResults()}
          </div>
        </div>
      </div>

      <footer style={{ textAlign: 'center', padding: '2rem', color: '#475569', fontSize: '0.75rem' }}>
        Built for ISKOMATS Scholarship System • V1.0 Internal Testing Tools
      </footer>
    </div>
  );
};

export default App;
