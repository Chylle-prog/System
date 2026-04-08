#!/usr/bin/env pwsh
# CORS Configuration Testing Script for ISKOMATS Backend
# Tests CORS headers and server connectivity

param(
    [string]$BackendUrl = "https://iskomats-backend.onrender.com",
    [string]$FrontendOrigin = "https://foregoing-giants.surge.sh"
)

Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "ISKOMATS CORS Testing Suite" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host ""

# Test 1: Simple health check
Write-Host "[TEST 1] Server Health Check" -ForegroundColor Yellow
Write-Host "URL: $BackendUrl/_health" -ForegroundColor Gray

try {
    $response = Invoke-WebRequest -Uri "$BackendUrl/_health" -Method GET -TimeoutSec 10 -ErrorAction Stop
    Write-Host "✓ Server responded with status: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "  Response: $($response.Content | ConvertFrom-Json | ConvertTo-Json -Compress)" -ForegroundColor Gray
} catch {
    Write-Host "✗ Server health check failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  This may indicate the server is down or unreachable on Render" -ForegroundColor Red
}

Write-Host ""

# Test 2: CORS Preflight (OPTIONS) Request
Write-Host "[TEST 2] CORS Preflight Request (OPTIONS)" -ForegroundColor Yellow
Write-Host "Testing CORS headers for preflight request" -ForegroundColor Gray
Write-Host "From: $FrontendOrigin" -ForegroundColor Gray

try {
    $headers = @{
        'Origin' = $FrontendOrigin
        'Access-Control-Request-Method' = 'POST'
        'Access-Control-Request-Headers' = 'Content-Type, Authorization'
    }
    
    $response = Invoke-WebRequest -Uri "$BackendUrl/api/student/verification/ocr-check" -Method OPTIONS -Headers $headers -TimeoutSec 10 -ErrorAction Stop
    
    Write-Host "✓ Preflight request successful (Status: $($response.StatusCode))" -ForegroundColor Green
    
    $corsHeader = $response.Headers['Access-Control-Allow-Origin']
    $corsMethods = $response.Headers['Access-Control-Allow-Methods']
    $corsHeaders = $response.Headers['Access-Control-Allow-Headers']
    $corsCredentials = $response.Headers['Access-Control-Allow-Credentials']
    
    Write-Host ""
    Write-Host "CORS Headers Received:" -ForegroundColor Cyan
    Write-Host "  Access-Control-Allow-Origin: $corsHeader" -ForegroundColor $(if ($corsHeader -eq $FrontendOrigin) { 'Green' } else { 'Red' })
    Write-Host "  Access-Control-Allow-Methods: $corsMethods" -ForegroundColor Green
    Write-Host "  Access-Control-Allow-Headers: $corsHeaders" -ForegroundColor Green
    Write-Host "  Access-Control-Allow-Credentials: $corsCredentials" -ForegroundColor Green
    
    if ($corsHeader -eq $FrontendOrigin) {
        Write-Host "✓ CORS origin matches expected frontend origin" -ForegroundColor Green
    } else {
        Write-Host "✗ CORS origin mismatch!" -ForegroundColor Red
        Write-Host "  Expected: $FrontendOrigin" -ForegroundColor Red
        Write-Host "  Got: $corsHeader" -ForegroundColor Red
    }
} catch {
    Write-Host "✗ Preflight request failed: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        Write-Host "  Status Code: $($_.Exception.Response.StatusCode)" -ForegroundColor Red
    }
}

Write-Host ""

# Test 3: GET Request with CORS
Write-Host "[TEST 3] GET Request (Health Check) with CORS Headers" -ForegroundColor Yellow
Write-Host "Testing GET request with proper CORS headers" -ForegroundColor Gray

try {
    $headers = @{
        'Origin' = $FrontendOrigin
    }
    
    $response = Invoke-WebRequest -Uri "$BackendUrl/api/student/health" -Method GET -Headers $headers -TimeoutSec 10 -ErrorAction Stop
    
    Write-Host "✓ GET request successful (Status: $($response.StatusCode))" -ForegroundColor Green
    
    $corsHeader = $response.Headers['Access-Control-Allow-Origin']
    Write-Host "  Access-Control-Allow-Origin: $corsHeader" -ForegroundColor $(if ($corsHeader) { 'Green' } else { 'Yellow' })
    
    $content = $response.Content | ConvertFrom-Json
    Write-Host "  Response Status: $($content.status)" -ForegroundColor Green
    if ($content.components) {
        Write-Host "  Components:" -ForegroundColor Cyan
        $content.components.PSObject.Properties | ForEach-Object {
            Write-Host "    - $($_.Name): $($_.Value)" -ForegroundColor Green
        }
    }
} catch {
    Write-Host "✗ GET request failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# Test 4: Status endpoint
Write-Host "[TEST 4] Root Status Endpoint" -ForegroundColor Yellow

try {
    $response = Invoke-WebRequest -Uri "$BackendUrl/" -Method GET -TimeoutSec 10 -ErrorAction Stop
    $content = $response.Content | ConvertFrom-Json
    
    Write-Host "✓ Service is running:" -ForegroundColor Green
    Write-Host "  Service: $($content.service)" -ForegroundColor Green
    Write-Host "  Status: $($content.status)" -ForegroundColor Green
    Write-Host "  Student API: $($content.studentApi)" -ForegroundColor Green
    Write-Host "  Admin API: $($content.adminApi)" -ForegroundColor Green
    if ($content.uptime) {
        Write-Host "  Uptime: $([Math]::Round($content.uptime, 2))s" -ForegroundColor Green
    }
} catch {
    Write-Host "✗ Root endpoint failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "Testing Complete" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host ""

# Summary
Write-Host "Summary:" -ForegroundColor Yellow
Write-Host "✓ Health check: Tests if server is responding" -ForegroundColor Gray
Write-Host "✓ CORS Preflight: Tests OPTIONS request handling" -ForegroundColor Gray
Write-Host "✓ GET Request: Tests actual API request with CORS" -ForegroundColor Gray
Write-Host "✓ Status Endpoint: Tests root API status" -ForegroundColor Gray
Write-Host ""
Write-Host "If CORS headers are not present:" -ForegroundColor Cyan
Write-Host "1. Check Render server logs for startup errors" -ForegroundColor Gray
Write-Host "2. Verify frontend origin matches exactly: $FrontendOrigin" -ForegroundColor Gray
Write-Host "3. Check if origin is in DEFAULT_CORS_ORIGINS (services/auth_service.py)" -ForegroundColor Gray
Write-Host "4. Ensure Dockerfile health check passes" -ForegroundColor Gray
Write-Host ""
