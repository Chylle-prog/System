# CORS Testing Script for iskomats-backend (PowerShell)

$BACKEND_URL = "https://system-kjbv.onrender.com"
$ORIGIN = "https://foregoing-giants.surge.sh"

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "CORS Test for iskomats-backend" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "1. Testing OPTIONS (preflight) request..." -ForegroundColor Yellow
Write-Host "   Backend: $BACKEND_URL/api/cors-test" -ForegroundColor Gray
Write-Host "   Origin: $ORIGIN" -ForegroundColor Gray
Write-Host ""

$headers = @{
    "Origin" = $ORIGIN
    "Access-Control-Request-Method" = "POST"
    "Access-Control-Request-Headers" = "Content-Type, Authorization"
}

try {
    $response = Invoke-WebRequest -Uri "$BACKEND_URL/api/cors-test" -Method OPTIONS -Headers $headers -Verbose 4>&1
    Write-Host "Response Headers:" -ForegroundColor Green
    $response.Headers.GetEnumerator() | Where-Object { $_.Key -like "*Access-Control*" } | ForEach-Object {
        Write-Host "  $($_.Key): $($_.Value)" -ForegroundColor Green
    }
    Write-Host "Status: $($response.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        Write-Host "Status: $($_.Exception.Response.StatusCode)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "2. Testing actual GET request..." -ForegroundColor Yellow
Write-Host ""

$headers = @{
    "Origin" = $ORIGIN
}

try {
    $response = Invoke-WebRequest -Uri "$BACKEND_URL/api/cors-test" -Method GET -Headers $headers
    Write-Host "Response Headers:" -ForegroundColor Green
    $response.Headers.GetEnumerator() | Where-Object { $_.Key -like "*Access-Control*" } | ForEach-Object {
        Write-Host "  $($_.Key): $($_.Value)" -ForegroundColor Green
    }
    Write-Host "Status: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "Body: $($response.Content)" -ForegroundColor Green
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        Write-Host "Status: $($_.Exception.Response.StatusCode)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "3. Testing debug endpoint..." -ForegroundColor Yellow
Write-Host ""

try {
    $response = Invoke-WebRequest -Uri "$BACKEND_URL/api/debug/cors" -Method GET -Headers @{ "Origin" = $ORIGIN }
    $json = $response.Content | ConvertFrom-Json
    Write-Host ($json | ConvertTo-Json) -ForegroundColor Green
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "Done!" -ForegroundColor Cyan
