// CORS Testing Suite for ISKOMATS Frontend
// Paste this into the browser console on https://foregoing-giants.surge.sh
// and run: testCORS()

window.testCORS = async function() {
  const backendUrl = 'https://iskomats-backend.onrender.com';
  const results = [];
  
  console.log('%c=== ISKOMATS CORS Testing Suite ===', 'color: cyan; font-size: 16px; font-weight: bold;');
  console.log('Backend: ' + backendUrl);
  console.log('Frontend Origin: ' + window.location.origin);
  console.log('');

  // Test 1: Health check
  console.log('%c[TEST 1] Health Check', 'color: yellow; font-weight: bold;');
  try {
    const response = await fetch(`${backendUrl}/_health`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    console.log('✓ Status: ' + response.status);
    console.log('✓ CORS Header Present: ' + !!response.headers.get('Access-Control-Allow-Origin'));
    const data = await response.json();
    console.table(data);
    results.push({ test: 'Health Check', status: 'PASS' });
  } catch (err) {
    console.error('✗ Failed: ' + err.message);
    results.push({ test: 'Health Check', status: 'FAIL', error: err.message });
  }

  console.log('');

  // Test 2: CORS Preflight (OPTIONS)
  console.log('%c[TEST 2] CORS Preflight (OPTIONS)', 'color: yellow; font-weight: bold;');
  try {
    const response = await fetch(`${backendUrl}/api/student/verification/ocr-check`, {
      method: 'OPTIONS',
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, Authorization'
      }
    });
    console.log('✓ Status: ' + response.status);
    const corsOrigin = response.headers.get('Access-Control-Allow-Origin');
    const corsMethods = response.headers.get('Access-Control-Allow-Methods');
    const corsHeaders = response.headers.get('Access-Control-Allow-Headers');
    const corsCredentials = response.headers.get('Access-Control-Allow-Credentials');
    
    console.log('✓ Access-Control-Allow-Origin: ' + (corsOrigin ? corsOrigin : 'NOT PRESENT'));
    console.log('✓ Access-Control-Allow-Methods: ' + (corsMethods ? corsMethods : 'NOT PRESENT'));
    console.log('✓ Access-Control-Allow-Headers: ' + (corsHeaders ? corsHeaders : 'NOT PRESENT'));
    console.log('✓ Access-Control-Allow-Credentials: ' + (corsCredentials ? corsCredentials : 'NOT PRESENT'));
    
    if (corsOrigin === window.location.origin) {
      console.log('%c✓ CORS origin matches!', 'color: green;');
      results.push({ test: 'CORS Preflight', status: 'PASS' });
    } else {
      console.error('%c✗ CORS origin mismatch\n  Expected: ' + window.location.origin + '\n  Got: ' + corsOrigin, 'color: red;');
      results.push({ test: 'CORS Preflight', status: 'FAIL', error: 'Origin mismatch' });
    }
  } catch (err) {
    console.error('✗ Failed: ' + err.message);
    results.push({ test: 'CORS Preflight', status: 'FAIL', error: err.message });
  }

  console.log('');

  // Test 3: API Health endpoint
  console.log('%c[TEST 3] Student API Health', 'color: yellow; font-weight: bold;');
  try {
    const response = await fetch(`${backendUrl}/api/student/health`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    console.log('✓ Status: ' + response.status);
    console.log('✓ CORS Header: ' + response.headers.get('Access-Control-Allow-Origin'));
    const data = await response.json();
    console.table(data);
    results.push({ test: 'API Health', status: 'PASS' });
  } catch (err) {
    console.error('✗ Failed: ' + err.message);
    results.push({ test: 'API Health', status: 'FAIL', error: err.message });
  }

  console.log('');

  // Test 4: Root status
  console.log('%c[TEST 4] Root Status', 'color: yellow; font-weight: bold;');
  try {
    const response = await fetch(`${backendUrl}/`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    console.log('✓ Status: ' + response.status);
    const data = await response.json();
    console.table(data);
    results.push({ test: 'Root Status', status: 'PASS' });
  } catch (err) {
    console.error('✗ Failed: ' + err.message);
    results.push({ test: 'Root Status', status: 'FAIL', error: err.message });
  }

  console.log('');

  // Summary
  console.log('%c=== Test Summary ===', 'color: cyan; font-size: 14px; font-weight: bold;');
  console.table(results);
  
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  
  console.log(`%c${passed} Passed, ${failed} Failed`, 
    `color: ${failed === 0 ? 'green' : 'red'}; font-weight: bold;`);

  return { results, passed, failed };
};

// Helper function to test actual OCR endpoint (requires token)
window.testOCREndpoint = async function(idImageBase64, faceImageBase64, token) {
  const backendUrl = 'https://iskomats-backend.onrender.com';
  
  console.log('%c[TEST] OCR Check Endpoint', 'color: yellow; font-weight: bold;');
  
  try {
    const response = await fetch(`${backendUrl}/api/student/verification/ocr-check`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        id_image: idImageBase64,
        face_image: faceImageBase64
      })
    });

    console.log('✓ Status: ' + response.status);
    console.log('✓ CORS Header: ' + response.headers.get('Access-Control-Allow-Origin'));
    
    const data = await response.json();
    console.log('✓ Response:');
    console.table(data);
    
    return { status: 'success', data };
  } catch (err) {
    console.error('✗ Failed: ' + err.message);
    return { status: 'error', error: err.message };
  }
};

// Auto-run tests on page load
console.log('%c⚠️ CORS tests available. Run: testCORS()', 'color: orange; font-weight: bold;');
