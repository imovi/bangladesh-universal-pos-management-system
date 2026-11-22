#!/usr/bin/env node
/**
 * scripts/test-verify-report-refs.cjs
 *
 * Unit tests for scripts/verify-report-refs.cjs conclusion checking
 * Tests a fixture section with:
 * 1. Matching conclusion (must pass)
 * 2. Mismatched conclusion (must fail with exit code 1)
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const testDir = path.join(__dirname, "test-fixtures");
if (!fs.existsSync(testDir)) {
  fs.mkdirSync(testDir, { recursive: true });
}

const fixtureFile = path.join(testDir, "fixture-report.md");

// Mock data: run 44111111111 is success on 4cda049, run 44222222222 is failure on e641606
const mockRuns = JSON.stringify({
  "44111111111": { id: 44111111111, head_sha: "4cda0491234567890abcdef", status: "completed", conclusion: "success" },
  "44222222222": { id: 44222222222, head_sha: "e6416061234567890abcdef", status: "completed", conclusion: "failure" },
  "44333333333": { id: 44333333333, head_sha: "78295ce1234567890abcdef", status: "completed", conclusion: "failure" },
});

console.log("=== Testing verify-report-refs.cjs ===");

// 1. Valid fixture: both conclusions and head_shas match
const validFixture = `
## Test Section Valid
- Commit \`4cda049\` run 44111111111 (Conclusion: success)
- Commit \`e641606\` run 44222222222 (Conclusion: failure)
`;

fs.writeFileSync(fixtureFile, validFixture, "utf8");

try {
  const out = execSync(
    `node "${path.join(__dirname, "verify-report-refs.cjs")}" "## Test Section Valid" "${fixtureFile}"`,
    {
      env: { ...process.env, VERIFY_MOCK_RUNS: mockRuns },
      encoding: "utf8",
    }
  );
  console.log("[PASS] Valid fixture passed as expected.");
} catch (err) {
  console.error("[FAIL] Valid fixture failed unexpectedly:", err.stdout || err.message);
  process.exit(1);
}

// 2. Invalid fixture: run 44222222222 is actual failure but fixture claims success
const invalidFixture = `
## Test Section Invalid
- Commit \`4cda049\` run 44111111111 (Conclusion: success)
- Commit \`e641606\` run 44222222222 (Conclusion: success)
`;

fs.writeFileSync(fixtureFile, invalidFixture, "utf8");

let failedAsExpected = false;
try {
  execSync(
    `node "${path.join(__dirname, "verify-report-refs.cjs")}" "## Test Section Invalid" "${fixtureFile}"`,
    {
      env: { ...process.env, VERIFY_MOCK_RUNS: mockRuns },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
} catch (err) {
  failedAsExpected = true;
  const output = (err.stdout ? err.stdout.toString() : "") + (err.stderr ? err.stderr.toString() : "");
  if (output.includes("Conclusion mismatch for run 44222222222: written 'success' vs actual 'failure'")) {
    console.log("[PASS] Invalid fixture caught conclusion mismatch as expected.");
  } else {
    console.error("[FAIL] Invalid fixture failed with unexpected output:", output);
    process.exit(1);
  }
}

if (!failedAsExpected) {
  console.error("[FAIL] Invalid fixture did not exit with error!");
  process.exit(1);
}

// 3. Invalid fixture: commit 4cda049 paired on same line with run 44333333333 whose head_sha is 78295ce
const shaMismatchFixture = `
## Test Section SHA Mismatch
- Commit \`4cda049\` run 44333333333 (Conclusion: failure)
`;

fs.writeFileSync(fixtureFile, shaMismatchFixture, "utf8");

let shaFailedAsExpected = false;
try {
  execSync(
    `node "${path.join(__dirname, "verify-report-refs.cjs")}" "## Test Section SHA Mismatch" "${fixtureFile}"`,
    {
      env: { ...process.env, VERIFY_MOCK_RUNS: mockRuns },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
} catch (err) {
  shaFailedAsExpected = true;
  const output = (err.stdout ? err.stdout.toString() : "") + (err.stderr ? err.stderr.toString() : "");
  if (output.includes("Head SHA mismatch for run 44333333333") && output.includes("expected commit '4cda049' but run head_sha is '78295ce'")) {
    console.log("[PASS] Invalid fixture caught head_sha mismatch as expected.");
  } else {
    console.error("[FAIL] Invalid fixture failed with unexpected output:", output);
    process.exit(1);
  }
}

if (!shaFailedAsExpected) {
  console.error("[FAIL] SHA mismatch fixture did not exit with error!");
  process.exit(1);
}

// Cleanup fixture file
try {
  fs.unlinkSync(fixtureFile);
  fs.rmdirSync(testDir);
} catch {}

console.log("=== All verify-report-refs tests passed! ===");
