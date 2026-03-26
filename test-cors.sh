#!/bin/bash
# CORS Testing Script for iskomats-backend

BACKEND_URL="https://system-kjbv.onrender.com"
ORIGIN="https://foregoing-giants.surge.sh"

echo "========================================="
echo "CORS Test for iskomats-backend"
echo "========================================="
echo ""

echo "1. Testing OPTIONS (preflight) request..."
echo "   Sending to: ${BACKEND_URL}/api/cors-test"
echo "   From origin: ${ORIGIN}"
echo ""

curl -v -X OPTIONS \
  -H "Origin: ${ORIGIN}" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type, Authorization" \
  "${BACKEND_URL}/api/cors-test" 2>&1 | grep -iE "(access-control|< HTTP)"

echo ""
echo "========================================="
echo "2. Testing actual GET request..."
echo ""

curl -v -X GET \
  -H "Origin: ${ORIGIN}" \
  "${BACKEND_URL}/api/cors-test" 2>&1 | grep -iE "(access-control|< HTTP|message)"

echo ""
echo "========================================="
echo "3. Testing debug endpoint..."
echo ""

curl -s -X GET \
  -H "Origin: ${ORIGIN}" \
  "${BACKEND_URL}/api/debug/cors" | jq '.'

echo ""
echo "========================================="
echo "Done!"
