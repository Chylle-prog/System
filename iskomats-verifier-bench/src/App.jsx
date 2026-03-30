import React, { useState, useEffect } from 'react';
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
  Code
} from 'lucide-react';
import * as api from './api';

const App = () => {
  const [activeTab, setActiveTab] = useState('ocr');
  const [token, setToken] = useState(localStorage.getItem('verifier_token') || '');
  const [apiUrl, setApiUrl] = useState(localStorage.getItem('verifier_api_url') || 'http://localhost:5000/api');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  
  // Form States
  const [form, setForm] = useState({
    firstName: 'Alexie Chyle',
    lastName: 'Magbuhat',
    townCity: 'Lipa City',
    idFront: null,
    indigencyDoc: null,
    enrollmentDoc: null,
    gradesDoc: null,
    faceImage: null
  });

  const [previews, setPreviews] = useState({});

  useEffect(() => {
    localStorage.setItem('verifier_token', token);
    localStorage.setItem('verifier_api_url', apiUrl);
  }, [token, apiUrl]);

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
        last_name: form.lastName
      });
      setResults({ type: 'ocr', data: res });
    } catch (err) {
      setResults({ type: 'error', data: err.response?.data || { message: err.message } });
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
      setResults({ type: 'error', data: err.response?.data || { message: err.message } });
    } finally {
      setLoading(false);
    }
  };

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
                {detail.verified ? <CheckCircle2 size={16} color="#10b981" /> : <XCircle size={16} color="#ef4444" />}
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

  return (
    <div className="app-root">
      <div className="auth-bar">
        <label style={{ color: '#94a3b8', fontSize: '0.75rem', fontWeight: '800' }}>API CONFIG</label>
        <input 
          placeholder="Endpoint URL (e.g. http://localhost:5000/api)" 
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
                </div>

                <button className="btn-verify" onClick={runOcrTest} disabled={loading}>
                  {loading ? <RefreshCw className="loading-icon" /> : <ShieldCheck size={20} />} 
                  RUN COMPLETE OCR DIAGNOSTICS
                </button>
              </div>
            ) : (
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
            )}
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

            {activeTab === 'ocr' ? renderOcrResults() : renderFaceResults()}
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
