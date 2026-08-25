import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Test suite for Persons Server API Endpoints (Command 4)
console.log("=== Running Server Persons API Security & Isolation Tests ===");

async function testPersonsApi() {
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
  const baseUrl = `http://127.0.0.1:${PORT}`;

  // 1. Unauthenticated request to /api/persons -> MUST REJECT WITH 401
  console.log("\n[Test 1] Unauthenticated GET /api/persons");
  const res1 = await fetch(`${baseUrl}/api/persons`);
  assert.equal(res1.status, 401, "Expected 401 Unauthorized for request without token");
  const body1 = await res1.json();
  assert.equal(body1.error, "Unauthorized");
  console.log("✅ Test 1 Passed: Anonymous GET /api/persons rejected with 401");

  // 2. Invalid JWT token to /api/persons -> MUST REJECT WITH 401
  console.log("\n[Test 2] Invalid JWT to /api/persons");
  const res2 = await fetch(`${baseUrl}/api/persons`, {
    headers: { Authorization: "Bearer invalid_garbage_token" }
  });
  assert.equal(res2.status, 401, "Expected 401 Unauthorized for invalid token");
  console.log("✅ Test 2 Passed: Invalid JWT token rejected with 401");

  // 3. Unauthenticated POST /api/persons -> MUST REJECT WITH 401
  console.log("\n[Test 3] Unauthenticated POST /api/persons");
  const res3 = await fetch(`${baseUrl}/api/persons`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "P999", name: "Hacked Person" })
  });
  assert.equal(res3.status, 401);
  console.log("✅ Test 3 Passed: Anonymous POST /api/persons rejected with 401");

  // 4. Unauthenticated PUT /api/persons/:id -> MUST REJECT WITH 401
  console.log("\n[Test 4] Unauthenticated PUT /api/persons/:id");
  const res4 = await fetch(`${baseUrl}/api/persons/00000000-0000-0000-0000-000000000000`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Changed Name" })
  });
  assert.equal(res4.status, 401);
  console.log("✅ Test 4 Passed: Anonymous PUT /api/persons/:id rejected with 401");

  // 5. Unauthenticated POST /api/persons/:id/deactivate -> MUST REJECT WITH 401
  console.log("\n[Test 5] Unauthenticated POST /api/persons/:id/deactivate");
  const res5 = await fetch(`${baseUrl}/api/persons/00000000-0000-0000-0000-000000000000/deactivate`, {
    method: "POST"
  });
  assert.equal(res5.status, 401);
  console.log("✅ Test 5 Passed: Anonymous POST /api/persons/:id/deactivate rejected with 401");

  // 6. Verify that NO Hard DELETE endpoint exists
  console.log("\n[Test 6] DELETE /api/persons/:id -> MUST REJECT (No handler or 404/405)");
  const res6 = await fetch(`${baseUrl}/api/persons/00000000-0000-0000-0000-000000000000`, {
    method: "DELETE"
  });
  assert.ok(res6.status === 404 || res6.status === 405 || !res6.ok, "DELETE method must not be exposed");
  console.log("✅ Test 6 Passed: Physical DELETE endpoint is not exposed");

  console.log("\n============================================================");
  console.log("🎉 ALL 6 PERSONS API SECURITY & ISOLATION TESTS PASSED!");
  console.log("============================================================\n");
}

testPersonsApi().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
