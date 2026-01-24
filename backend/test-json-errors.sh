#!/bin/bash

# Test script to understand INVALID_JSON vs VALIDATION_FAILED errors
# This tests the /v1/auth/login endpoint which requires a body with email and password

BASE_URL="http://localhost:5000/api"
ENDPOINT="/v1/auth/login"

echo "============================================"
echo "Testing JSON Error Handling"
echo "============================================"
echo

# Test 1: Malformed JSON - missing quotes
echo "Test 1: Malformed JSON - missing quotes around key"
echo "Expected: INVALID_JSON"
echo "Request body: {email: \"test@test.com\", \"password\": \"test123\"}"
curl -s -X POST "${BASE_URL}${ENDPOINT}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: node" \
  -d '{email: "test@test.com", "password": "test123"}' | jq
echo
echo "---"
echo

# Test 2: Malformed JSON - trailing comma
echo "Test 2: Malformed JSON - trailing comma"
echo "Expected: INVALID_JSON"
echo "Request body: {\"email\": \"test@test.com\", \"password\": \"test123\",}"
curl -s -X POST "${BASE_URL}${ENDPOINT}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: node" \
  -d '{"email": "test@test.com", "password": "test123",}' | jq
echo
echo "---"
echo

# Test 3: Malformed JSON - single quotes
echo "Test 3: Malformed JSON - single quotes"
echo "Expected: INVALID_JSON"
echo "Request body: {'email': 'test@test.com', 'password': 'test123'}"
curl -s -X POST "${BASE_URL}${ENDPOINT}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: node" \
  -d "{'email': 'test@test.com', 'password': 'test123'}" | jq
echo
echo "---"
echo

# Test 4: Malformed JSON - incomplete
echo "Test 4: Malformed JSON - incomplete"
echo "Expected: INVALID_JSON"
echo "Request body: {\"email\": \"test@test.com\""
curl -s -X POST "${BASE_URL}${ENDPOINT}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: node" \
  -d '{"email": "test@test.com"' | jq
echo
echo "---"
echo

# Test 5: Valid JSON but empty object
echo "Test 5: Valid JSON but empty object (missing required fields)"
echo "Expected: VALIDATION_FAILED (email and password required)"
echo "Request body: {}"
curl -s -X POST "${BASE_URL}${ENDPOINT}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: node" \
  -d '{}' | jq
echo
echo "---"
echo

# Test 6: Valid JSON but missing password
echo "Test 6: Valid JSON but missing required field (password)"
echo "Expected: VALIDATION_FAILED"
echo "Request body: {\"email\": \"test@test.com\"}"
curl -s -X POST "${BASE_URL}${ENDPOINT}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: node" \
  -d '{"email": "test@test.com"}' | jq
echo
echo "---"
echo

# Test 7: Valid JSON but invalid email format
echo "Test 7: Valid JSON but invalid email format"
echo "Expected: VALIDATION_FAILED (invalid email)"
echo "Request body: {\"email\": \"notanemail\", \"password\": \"test123\"}"
curl -s -X POST "${BASE_URL}${ENDPOINT}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: node" \
  -d '{"email": "notanemail", "password": "test123"}' | jq
echo
echo "---"
echo

# Test 8: No body at all
echo "Test 8: No body at all"
echo "Expected: VALIDATION_FAILED (or possibly INVALID_JSON)"
echo "Request body: (empty)"
curl -s -X POST "${BASE_URL}${ENDPOINT}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: node" | jq
echo
echo "---"
echo

# Test 9: Just plain text (not JSON)
echo "Test 9: Plain text instead of JSON"
echo "Expected: INVALID_JSON"
echo "Request body: this is not json"
curl -s -X POST "${BASE_URL}${ENDPOINT}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: node" \
  -d "this is not json" | jq
echo
echo "---"
echo

# Test 10: Valid JSON with wrong types
echo "Test 10: Valid JSON but wrong types (number instead of string)"
echo "Expected: VALIDATION_FAILED"
echo "Request body: {\"email\": 12345, \"password\": \"test123\"}"
curl -s -X POST "${BASE_URL}${ENDPOINT}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: node" \
  -d '{"email": 12345, "password": "test123"}' | jq
echo
echo "---"
echo

echo "============================================"
echo "Summary"
echo "============================================"
echo "INVALID_JSON should be thrown when:"
echo "  - JSON syntax is malformed (missing quotes, trailing commas, etc.)"
echo "  - Content is not valid JSON at all"
echo
echo "VALIDATION_FAILED should be thrown when:"
echo "  - JSON is valid but missing required fields"
echo "  - JSON is valid but fields have wrong types"
echo "  - JSON is valid but field values don't match constraints (e.g., email format)"
echo "  - Body is empty (parsed as empty object/null)"
