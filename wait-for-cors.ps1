# Wait for backend to be redeployed with CORS fixes
$url = "https://system-kjbv.onrender.com/api/student/applications/submit"
$origin = "https://foregoing-giants.surge.sh"
$maxAttempts = 12  # ~120 seconds (10s × 12)
$attempt = 0

Write-Host "Waiting for Render to redeploy backend..." -ForegroundColor Cyan

while ($attempt -lt $maxAttempts) {
    $attempt++
    
    try {
        $headers = @{
            'Origin' = $origin
            'Access-Control-Request-Method' = 'POST'
            'Access-Control-Request-Headers' = 'Content-Type'
        }
        
        $response = Invoke-WebRequest -Uri $url -Method OPTIONS -Headers $headers -SkipHeaderValidation -ErrorAction SilentlyContinue
        $corsHeader = $response.Headers['Access-Control-Allow-Origin']
        
        if ($corsHeader -eq $origin) {
            Write-Host "✓ SUCCESS! Backend deployed with CORS headers ✓" -ForegroundColor Green
            Write-Host "Returned CORS Origin: $corsHeader" -ForegroundColor Green
            exit 0
        } else {
            Write-Host "[$attempt/$maxAttempts] No CORS headers yet... (waiting for Render)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "[$attempt/$maxAttempts] Backend not ready yet..." -ForegroundColor Yellow
    }
    
    Start-Sleep -Seconds 10
}

Write-Host "× Backend deployment timed out after 2 minutes. Check Render dashboard." -ForegroundColor Red
exit 1
