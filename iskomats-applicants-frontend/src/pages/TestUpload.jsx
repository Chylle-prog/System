import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { encryptDocument, decryptUrl } from '../services/CryptoService';
import { applicantAPI } from '../services/api';

const TestUpload = () => {
  const [directImage, setDirectImage] = useState(null);
  const [directVideo, setDirectVideo] = useState(null);
  
  const [backendImage, setBackendImage] = useState(null);
  const [backendVideo, setBackendVideo] = useState(null);

  const [loading, setLoading] = useState({});
  const [urls, setUrls] = useState({});
  const [previews, setPreviews] = useState({});
  const [error, setError] = useState(null);

  const getAuthHeader = () => {
    const token = localStorage.getItem('authToken');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  };

  const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:10001/api';

  // 1. Direct Frontend Upload to Supabase Storage (with client-side encryption)
  const handleDirectUpload = async (file, type) => {
    if (!file) return;
    const key = `direct-${type}`;
    setLoading(prev => ({ ...prev, [key]: true }));
    setError(null);

    try {
      // Encrypt the file using CryptoService
      const encryptedBlob = await encryptDocument(file);
      
      const bucketName = type === 'image' ? 'document_images' : 'document_videos';
      const fileExt = file.name.split('.').pop() || (type === 'image' ? 'jpg' : 'mp4');
      const objectPath = `test-uploads/direct-${type}-${Date.now()}.${fileExt}`;

      const { data, error: uploadErr } = await supabase.storage
        .from(bucketName)
        .upload(objectPath, encryptedBlob, {
          upsert: true,
          contentType: 'application/octet-stream'
        });

      if (uploadErr) throw uploadErr;

      // Get public URL
      const { data: urlData } = supabase.storage.from(bucketName).getPublicUrl(objectPath);
      if (!urlData?.publicUrl) throw new Error("Could not retrieve public URL");

      setUrls(prev => ({ ...prev, [key]: urlData.publicUrl }));

      // Test Decryption immediately for Preview
      const mime = type === 'image' ? 'image/jpeg' : 'video/mp4';
      const localDecryptedUrl = await decryptUrl(urlData.publicUrl, mime);
      setPreviews(prev => ({ ...prev, [key]: localDecryptedUrl }));

    } catch (err) {
      console.error("Direct upload error:", err);
      setError(`Direct upload failed: ${err.message}`);
    } finally {
      setLoading(prev => ({ ...prev, [key]: false }));
    }
  };

  // 2. Backend-assisted Upload (Encrypted in Python)
  const handleBackendUpload = async (file, type) => {
    if (!file) return;
    const key = `backend-${type}`;
    setLoading(prev => ({ ...prev, [key]: true }));
    setError(null);

    try {
      const formData = new FormData();
      formData.append(type, file);

      const endpoint = `${API_BASE}/student/test/upload-${type}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: getAuthHeader(),
        body: formData
      });

      const resData = await response.json();
      if (!response.ok) throw new Error(resData.message || `HTTP ${response.status}`);

      setUrls(prev => ({ ...prev, [key]: resData.publicUrl }));

      // Test Decryption by downloading and decrypting locally
      const mime = type === 'image' ? 'image/jpeg' : 'video/mp4';
      const localDecryptedUrl = await decryptUrl(resData.publicUrl, mime);
      setPreviews(prev => ({ ...prev, [key]: localDecryptedUrl }));

    } catch (err) {
      console.error("Backend upload error:", err);
      setError(`Backend upload failed: ${err.message}`);
    } finally {
      setLoading(prev => ({ ...prev, [key]: false }));
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(circle at 10% 20%, rgb(4, 21, 45) 0%, rgb(16, 37, 68) 90.1%)',
      color: '#f8fafc',
      fontFamily: "'Inter', sans-serif",
      padding: '3rem 2rem',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center'
    }}>
      <div style={{ maxWidth: '1000px', width: '100%' }}>
        {/* Navigation & Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <Link to="/portal" style={{
            color: '#38bdf8',
            textDecoration: 'none',
            fontSize: '0.95rem',
            fontWeight: '600',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <i className="fas fa-arrow-left"></i> Back to Portal
          </Link>
          <div style={{
            background: 'rgba(56, 189, 248, 0.1)',
            border: '1px solid rgba(56, 189, 248, 0.2)',
            borderRadius: '20px',
            padding: '4px 16px',
            fontSize: '0.8rem',
            fontWeight: '700',
            color: '#38bdf8'
          }}>
            SYSTEM TESTING ZONE
          </div>
        </div>

        <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
          <h1 style={{
            fontSize: '2.8rem',
            fontWeight: '800',
            letterSpacing: '-1px',
            background: 'linear-gradient(90deg, #38bdf8 0%, #a855f7 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            marginBottom: '0.8rem'
          }}>
            Encryption & Storage Testing Suite
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '1.1rem', maxWidth: '600px', margin: '0 auto' }}>
            Verify that images and videos are fully encrypted when saved to Supabase Storage, and that the decryption engine decodes them properly for display.
          </p>
        </div>

        {error && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#fca5a5',
            borderRadius: '12px',
            padding: '1rem',
            marginBottom: '2rem',
            fontSize: '0.9rem',
            fontWeight: '600',
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}>
            <i className="fas fa-exclamation-triangle" style={{ color: '#ef4444' }}></i>
            {error}
          </div>
        )}

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))',
          gap: '2rem'
        }}>
          {/* ─── FRONTEND DIRECT ENCRYPTION ─── */}
          <div style={{
            background: 'rgba(30, 41, 59, 0.7)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '24px',
            padding: '2.5rem',
            boxShadow: '0 20px 40px rgba(0,0,0,0.3)'
          }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '700', marginBottom: '1.5rem', color: '#38bdf8' }}>
              <i className="fas fa-laptop-code" style={{ marginRight: '10px' }}></i>
              Direct Frontend Encryption
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '0.88rem', marginBottom: '2rem', lineHeight: '1.6' }}>
              Uploads directly from the browser to Supabase Storage. File content is encrypted client-side using **Web Crypto AES-GCM** before transmission.
            </p>

            {/* Test Image Direct */}
            <div style={{ marginBottom: '2rem', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '2rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', marginBottom: '10px', color: '#cbd5e1' }}>Test Image Upload</label>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <input 
                  type="file" 
                  accept="image/*"
                  onChange={(e) => setDirectImage(e.target.files[0])}
                  style={{
                    background: 'rgba(15,23,42,0.6)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '10px',
                    padding: '8px 12px',
                    fontSize: '0.85rem',
                    color: '#fff',
                    flex: 1
                  }}
                />
                <button 
                  onClick={() => handleDirectUpload(directImage, 'image')}
                  disabled={loading['direct-image'] || !directImage}
                  style={{
                    padding: '10px 20px',
                    borderRadius: '10px',
                    background: 'linear-gradient(135deg, #38bdf8 0%, #0284c7 100%)',
                    color: '#fff',
                    border: 'none',
                    fontWeight: '700',
                    cursor: (!directImage || loading['direct-image']) ? 'not-allowed' : 'pointer',
                    opacity: (!directImage || loading['direct-image']) ? 0.6 : 1,
                    boxShadow: '0 4px 12px rgba(56, 189, 248, 0.2)'
                  }}
                >
                  {loading['direct-image'] ? 'Uploading...' : 'Upload & Encrypt'}
                </button>
              </div>
              <RenderPreview type="image" uploadKey="direct-image" urls={urls} previews={previews} />
            </div>

            {/* Test Video Direct */}
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', marginBottom: '10px', color: '#cbd5e1' }}>Test Video Upload</label>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <input 
                  type="file" 
                  accept="video/*"
                  onChange={(e) => setDirectVideo(e.target.files[0])}
                  style={{
                    background: 'rgba(15,23,42,0.6)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '10px',
                    padding: '8px 12px',
                    fontSize: '0.85rem',
                    color: '#fff',
                    flex: 1
                  }}
                />
                <button 
                  onClick={() => handleDirectUpload(directVideo, 'video')}
                  disabled={loading['direct-video'] || !directVideo}
                  style={{
                    padding: '10px 20px',
                    borderRadius: '10px',
                    background: 'linear-gradient(135deg, #38bdf8 0%, #0284c7 100%)',
                    color: '#fff',
                    border: 'none',
                    fontWeight: '700',
                    cursor: (!directVideo || loading['direct-video']) ? 'not-allowed' : 'pointer',
                    opacity: (!directVideo || loading['direct-video']) ? 0.6 : 1,
                    boxShadow: '0 4px 12px rgba(56, 189, 248, 0.2)'
                  }}
                >
                  {loading['direct-video'] ? 'Uploading...' : 'Upload & Encrypt'}
                </button>
              </div>
              <RenderPreview type="video" uploadKey="direct-video" urls={urls} previews={previews} />
            </div>
          </div>

          {/* ─── BACKEND-ASSISTED ENCRYPTION ─── */}
          <div style={{
            background: 'rgba(30, 41, 59, 0.7)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '24px',
            padding: '2.5rem',
            boxShadow: '0 20px 40px rgba(0,0,0,0.3)'
          }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '700', marginBottom: '1.5rem', color: '#a855f7' }}>
              <i className="fas fa-server" style={{ marginRight: '10px' }}></i>
              Backend Encryption (Python)
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '0.88rem', marginBottom: '2rem', lineHeight: '1.6' }}>
              Sends the raw file to the Flask backend. The server processes the bytes, encrypts them using **AES-256-GCM**, and uploads them to Supabase Storage.
            </p>

            {/* Test Image Backend */}
            <div style={{ marginBottom: '2rem', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '2rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', marginBottom: '10px', color: '#cbd5e1' }}>Test Image Upload</label>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <input 
                  type="file" 
                  accept="image/*"
                  onChange={(e) => setBackendImage(e.target.files[0])}
                  style={{
                    background: 'rgba(15,23,42,0.6)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '10px',
                    padding: '8px 12px',
                    fontSize: '0.85rem',
                    color: '#fff',
                    flex: 1
                  }}
                />
                <button 
                  onClick={() => handleBackendUpload(backendImage, 'image')}
                  disabled={loading['backend-image'] || !backendImage}
                  style={{
                    padding: '10px 20px',
                    borderRadius: '10px',
                    background: 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)',
                    color: '#fff',
                    border: 'none',
                    fontWeight: '700',
                    cursor: (!backendImage || loading['backend-image']) ? 'not-allowed' : 'pointer',
                    opacity: (!backendImage || loading['backend-image']) ? 0.6 : 1,
                    boxShadow: '0 4px 12px rgba(168, 85, 247, 0.2)'
                  }}
                >
                  {loading['backend-image'] ? 'Uploading...' : 'Send to Backend'}
                </button>
              </div>
              <RenderPreview type="image" uploadKey="backend-image" urls={urls} previews={previews} />
            </div>

            {/* Test Video Backend */}
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', marginBottom: '10px', color: '#cbd5e1' }}>Test Video Upload</label>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <input 
                  type="file" 
                  accept="video/*"
                  onChange={(e) => setBackendVideo(e.target.files[0])}
                  style={{
                    background: 'rgba(15,23,42,0.6)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '10px',
                    padding: '8px 12px',
                    fontSize: '0.85rem',
                    color: '#fff',
                    flex: 1
                  }}
                />
                <button 
                  onClick={() => handleBackendUpload(backendVideo, 'video')}
                  disabled={loading['backend-video'] || !backendVideo}
                  style={{
                    padding: '10px 20px',
                    borderRadius: '10px',
                    background: 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)',
                    color: '#fff',
                    border: 'none',
                    fontWeight: '700',
                    cursor: (!backendVideo || loading['backend-video']) ? 'not-allowed' : 'pointer',
                    opacity: (!backendVideo || loading['backend-video']) ? 0.6 : 1,
                    boxShadow: '0 4px 12px rgba(168, 85, 247, 0.2)'
                  }}
                >
                  {loading['backend-video'] ? 'Uploading...' : 'Send to Backend'}
                </button>
              </div>
              <RenderPreview type="video" uploadKey="backend-video" urls={urls} previews={previews} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const RenderPreview = ({ type, uploadKey, urls, previews }) => {
  const publicUrl = urls[uploadKey];
  const decryptedUrl = previews[uploadKey];
  const [ocrText, setOcrText] = useState('');
  const [ocrLoading, setOcrLoading] = useState(false);
  const [docType, setDocType] = useState('Plain');

  // OCR Expected Match Criteria
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [barangay, setBarangay] = useState('');
  const [gpa, setGpa] = useState('');
  const [course, setCourse] = useState('');
  const [semester, setSemester] = useState('');

  const [verificationResult, setVerificationResult] = useState(null);

  if (!publicUrl) return null;

  const normalizeForOcr = (str) => {
    return String(str || '').toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const checkNameMatches = (text, first, last) => {
    const normText = normalizeForOcr(text);
    if (!normText) return false;
    const checkPart = (part) => {
      if (!part) return true;
      const words = normalizeForOcr(part).split(' ').filter(w => w.length >= 2);
      if (words.length === 0) return true;
      let found = 0;
      words.forEach(w => {
        if (new RegExp('\\b' + w + '\\b').test(normText) || normText.includes(w)) {
          found++;
        }
      });
      return found >= Math.max(1, words.length - 1);
    };
    return checkPart(first) && checkPart(last);
  };

  const checkIdMatches = (targetId, text) => {
    if (!targetId) return true;
    const normalizeId = (s) => s.toString().toLowerCase().replace(/[^a-z0-9]/g, '')
      .replace(/o/g, '0').replace(/q/g, '0').replace(/d/g, '0')
      .replace(/i/g, '1').replace(/l/g, '1')
      .replace(/z/g, '2').replace(/s/g, '5')
      .replace(/g/g, '6').replace(/b/g, '6')
      .replace(/q/g, '9');
    const tId = normalizeId(targetId);
    const normText = normalizeId(text);
    return normText.includes(tId);
  };

  const checkSchoolMatches = (text, targetSchool) => {
    if (!targetSchool) return true;
    const normText = normalizeForOcr(text);
    const normSchool = normalizeForOcr(targetSchool);
    if (normText.includes(normSchool)) return true;
    const words = normSchool.split(' ').filter(w => w.length > 2);
    if (words.length === 0) return true;
    let matched = 0;
    words.forEach(w => {
      if (normText.includes(w)) matched++;
    });
    return (matched / words.length) >= 0.6;
  };

  const checkAddressMatches = (text, targetAddr) => {
    if (!targetAddr) return true;
    const normText = normalizeForOcr(text);
    const normAddr = normalizeForOcr(targetAddr);
    if (normText.includes(normAddr)) return true;
    const words = normAddr.split(' ').filter(w => w.length > 2 && !['barangay', 'brgy', 'city', 'municipality'].includes(w));
    if (words.length === 0) return true;
    return words.some(w => normText.includes(w));
  };

  const runOcrCheck = async () => {
    if (!decryptedUrl) return;
    setOcrLoading(true);
    setOcrText('');
    setVerificationResult(null);
    try {
      if (!window.Tesseract) {
        throw new Error("WebAssembly OCR Engine (Tesseract.js) is not loaded.");
      }
      const result = await window.Tesseract.recognize(decryptedUrl, 'eng');
      const extracted = result?.data?.text || "No text detected.";
      setOcrText(extracted);

      if (docType !== 'Plain') {
        let nameOk = true;
        let schoolOk = true;
        let idOk = true;
        let addrOk = true;
        let gpaOk = true;
        let courseOk = true;
        let semOk = true;

        if (firstName || lastName) {
          nameOk = checkNameMatches(extracted, firstName, lastName);
        }
        if (schoolName) {
          schoolOk = checkSchoolMatches(extracted, schoolName);
        }
        if (idNumber) {
          idOk = checkIdMatches(idNumber, extracted);
        }
        if (barangay) {
          addrOk = checkAddressMatches(extracted, barangay);
        }
        if (gpa) {
          gpaOk = extracted.includes(gpa.toString().replace(/[^0-9.]/g, ''));
        }
        if (course) {
          courseOk = normalizeForOcr(extracted).includes(normalizeForOcr(course));
        }
        if (semester) {
          semOk = normalizeForOcr(extracted).includes(normalizeForOcr(semester));
        }

        let isSuccess = false;
        let checks = {};

        if (docType === 'SchoolID') {
          isSuccess = nameOk && idOk && schoolOk;
          checks = { 'Student Name': nameOk, 'ID Number': idOk, 'School Name': schoolOk };
        } else if (docType === 'Enrollment') {
          isSuccess = schoolOk && courseOk && semOk;
          checks = { 'School Name': schoolOk, 'Course': courseOk, 'Semester': semOk };
        } else if (docType === 'Grades') {
          isSuccess = nameOk && gpaOk && semOk;
          checks = { 'Student Name': nameOk, 'GPA': gpaOk, 'Semester': semOk };
        } else if (docType === 'Indigency') {
          isSuccess = nameOk && addrOk;
          checks = { 'Student Name': nameOk, 'Barangay/Address': addrOk };
        }

        setVerificationResult({
          success: isSuccess,
          checks
        });

        // Persist verification status to DB in background
        try {
          await applicantAPI.ocrCheck(docType, isSuccess, `Testing Suite simulated: ${isSuccess ? 'Passed' : 'Failed'}`, [
            { doc: docType, verified: isSuccess, message: 'Verified via Testing Suite' }
          ]);
          console.log("[TEST OCR] Verification status persisted successfully.");
        } catch (dbErr) {
          console.warn("[TEST OCR] Failed to persist OCR verification to database:", dbErr);
        }
      }
    } catch (err) {
      console.error("OCR Check Error:", err);
      setOcrText(`OCR Verification Failed: ${err.message}`);
    } finally {
      setOcrLoading(false);
    }
  };

  return (
    <div style={{ marginTop: '1.2rem', textAlign: 'left', animation: 'fadeIn 0.4s ease' }}>
      <div style={{
        fontSize: '0.78rem',
        color: '#64748b',
        wordBreak: 'break-all',
        background: 'rgba(15,23,42,0.4)',
        border: '1px solid rgba(255,255,255,0.05)',
        padding: '10px',
        borderRadius: '8px',
        marginBottom: '10px'
      }}>
        <strong style={{ color: '#cbd5e1' }}>Supabase Encrypted Asset URL:</strong>
        <br />
        <a href={publicUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#38bdf8', textDecoration: 'underline' }}>
          {publicUrl}
        </a>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <span style={{ fontSize: '0.8rem', fontWeight: '700', color: '#10b981' }}>
          <i className="fas fa-unlock-alt" style={{ marginRight: '6px' }}></i>
          Local Decryption Preview (Success):
        </span>
        <div style={{
          width: '100%',
          maxHeight: '220px',
          background: '#090d16',
          borderRadius: '10px',
          overflow: 'hidden',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          border: '1px solid rgba(255,255,255,0.05)',
          padding: '8px'
        }}>
          {type === 'image' ? (
            <img 
              src={decryptedUrl} 
              alt="Decrypted Preview"
              style={{ maxWidth: '100%', maxHeight: '200px', objectFit: 'contain', borderRadius: '6px' }}
              onError={(e) => console.error("Preview image load error", e)}
            />
          ) : (
            <video 
              src={decryptedUrl} 
              controls
              style={{ maxWidth: '100%', maxHeight: '200px', objectFit: 'contain', borderRadius: '6px' }}
              onError={(e) => console.error("Preview video load error", e)}
            />
          )}
        </div>
      </div>

      {type === 'image' && (
        <div style={{ marginTop: '1rem', background: 'rgba(15,23,42,0.4)', borderRadius: '12px', padding: '1rem', border: '1px solid rgba(255,255,255,0.04)' }}>
          <h4 style={{ fontSize: '0.9rem', color: '#cbd5e1', fontWeight: '700', marginBottom: '10px' }}>
            Document Verification Simulator
          </h4>
          
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.78rem', color: '#94a3b8', marginBottom: '6px', fontWeight: '600' }}>Document Type</label>
            <select 
              value={docType}
              onChange={(e) => {
                setDocType(e.target.value);
                setVerificationResult(null);
              }}
              style={{
                width: '100%',
                background: '#090d16',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
                padding: '8px',
                fontSize: '0.8rem',
                color: '#fff'
              }}
            >
              <option value="Plain">Plain Text Extraction Only</option>
              <option value="SchoolID">School ID Card</option>
              <option value="Enrollment">Certificate of Enrollment (COE)</option>
              <option value="Grades">Grades Transcript</option>
              <option value="Indigency">Certificate of Indigency</option>
            </select>
          </div>

          {docType !== 'Plain' && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '10px',
              marginBottom: '1rem',
              animation: 'fadeIn 0.3s ease'
            }}>
              {(docType === 'SchoolID' || docType === 'Grades' || docType === 'Indigency') && (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.72rem', color: '#94a3b8', marginBottom: '4px' }}>First Name</label>
                    <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} style={{ width: '100%', background: '#090d16', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '6px', fontSize: '0.78rem', color: '#fff' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.72rem', color: '#94a3b8', marginBottom: '4px' }}>Last Name</label>
                    <input type="text" value={lastName} onChange={e => setLastName(e.target.value)} style={{ width: '100%', background: '#090d16', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '6px', fontSize: '0.78rem', color: '#fff' }} />
                  </div>
                </>
              )}
              {(docType === 'SchoolID' || docType === 'Enrollment') && (
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: '0.72rem', color: '#94a3b8', marginBottom: '4px' }}>Expected School Name</label>
                  <input type="text" value={schoolName} onChange={e => setSchoolName(e.target.value)} style={{ width: '100%', background: '#090d16', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '6px', fontSize: '0.78rem', color: '#fff' }} placeholder="e.g. De La Salle" />
                </div>
              )}
              {docType === 'SchoolID' && (
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: '0.72rem', color: '#94a3b8', marginBottom: '4px' }}>Student ID Number</label>
                  <input type="text" value={idNumber} onChange={e => setIdNumber(e.target.value)} style={{ width: '100%', background: '#090d16', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '6px', fontSize: '0.78rem', color: '#fff' }} />
                </div>
              )}
              {docType === 'Indigency' && (
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: '0.72rem', color: '#94a3b8', marginBottom: '4px' }}>Expected Barangay/Address</label>
                  <input type="text" value={barangay} onChange={e => setBarangay(e.target.value)} style={{ width: '100%', background: '#090d16', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '6px', fontSize: '0.78rem', color: '#fff' }} />
                </div>
              )}
              {docType === 'Enrollment' && (
                <div>
                  <label style={{ display: 'block', fontSize: '0.72rem', color: '#94a3b8', marginBottom: '4px' }}>Course / Program</label>
                  <input type="text" value={course} onChange={e => setCourse(e.target.value)} style={{ width: '100%', background: '#090d16', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '6px', fontSize: '0.78rem', color: '#fff' }} placeholder="e.g. BSCS" />
                </div>
              )}
              {(docType === 'Enrollment' || docType === 'Grades') && (
                <div>
                  <label style={{ display: 'block', fontSize: '0.72rem', color: '#94a3b8', marginBottom: '4px' }}>Semester</label>
                  <input type="text" value={semester} onChange={e => setSemester(e.target.value)} style={{ width: '100%', background: '#090d16', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '6px', fontSize: '0.78rem', color: '#fff' }} placeholder="e.g. First Semester" />
                </div>
              )}
              {docType === 'Grades' && (
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: '0.72rem', color: '#94a3b8', marginBottom: '4px' }}>Expected GPA</label>
                  <input type="text" value={gpa} onChange={e => setGpa(e.target.value)} style={{ width: '100%', background: '#090d16', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '6px', fontSize: '0.78rem', color: '#fff' }} placeholder="e.g. 1.75" />
                </div>
              )}
            </div>
          )}

          <button 
            onClick={runOcrCheck}
            disabled={ocrLoading}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '8px',
              background: 'rgba(56, 189, 248, 0.1)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              color: '#38bdf8',
              fontSize: '0.82rem',
              fontWeight: '750',
              cursor: ocrLoading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}
          >
            <i className={ocrLoading ? "fas fa-spinner fa-spin" : "fas fa-shield-alt"}></i>
            {ocrLoading ? 'Verifying Document via OCR...' : 'Run Document Verification Check'}
          </button>
          
          {verificationResult && (
            <div style={{
              marginTop: '12px',
              background: verificationResult.success ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
              border: verificationResult.success ? '1px solid rgba(16, 185, 129, 0.25)' : '1px solid rgba(239, 68, 68, 0.25)',
              borderRadius: '8px',
              padding: '12px',
              animation: 'fadeIn 0.3s ease'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: '750', color: verificationResult.success ? '#34d399' : '#f87171' }}>Verification Results:</span>
                <span style={{
                  fontSize: '0.72rem',
                  fontWeight: '800',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  background: verificationResult.success ? '#065f46' : '#991b1b',
                  color: '#fff'
                }}>
                  {verificationResult.success ? 'PASSED ✔' : 'FAILED ✘'}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {Object.entries(verificationResult.checks).map(([checkName, checkPassed]) => (
                  <div key={checkName} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.76rem', color: '#cbd5e1' }}>
                    <span>{checkName}</span>
                    <span style={{ color: checkPassed ? '#34d399' : '#f87171', fontWeight: '700' }}>
                      {checkPassed ? 'MATCHED' : 'NOT FOUND'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {ocrText && (
            <div style={{
              marginTop: '10px',
              background: '#040711',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: '8px',
              padding: '12px',
              maxHeight: '150px',
              overflowY: 'auto',
              fontFamily: 'monospace',
              fontSize: '0.78rem',
              color: '#cbd5e1',
              whiteSpace: 'pre-wrap',
              animation: 'fadeIn 0.3s ease'
            }}>
              <strong style={{ color: '#38bdf8', display: 'block', marginBottom: '6px' }}>Extracted OCR Text:</strong>
              {ocrText}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TestUpload;
