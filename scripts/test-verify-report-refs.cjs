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

// 4. Section with 45... run ID and wrong conclusion must exit 1
const mock45Runs = JSON.stringify({
  "45030935054": { id: 45030935054, head_sha: "d4da0191234567890abcdef", status: "completed", conclusion: "success" },
});
const run45MismatchFixture = `
## Test Section 45 Run Conclusion Mismatch
- CI: \`d4da019\` → run \`45030935054\` → completed failure
`;
fs.writeFileSync(fixtureFile, run45MismatchFixture, "utf8");

let run45FailedAsExpected = false;
try {
  execSync(
    `node "${path.join(__dirname, "verify-report-refs.cjs")}" "## Test Section 45 Run Conclusion Mismatch" "${fixtureFile}"`,
    {
      env: { ...process.env, VERIFY_MOCK_RUNS: mock45Runs },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
} catch (err) {
  run45FailedAsExpected = true;
  const output = (err.stdout ? err.stdout.toString() : "") + (err.stderr ? err.stderr.toString() : "");
  if (output.includes("Conclusion mismatch for run 45030935054: written 'failure' vs actual 'success'")) {
    console.log("[PASS] 45... run ID with wrong conclusion failed with exit 1 as expected.");
  } else {
    console.error("[FAIL] 45... run fixture failed with unexpected output:", output);
    process.exit(1);
  }
}
if (!run45FailedAsExpected) {
  console.error("[FAIL] 45... run mismatch fixture did not exit with error!");
  process.exit(1);
}

// 5. Run line with no commit hash must exit 1
const noCommitFixture = `
## Test Section Run Line No Commit
- CI run 45030935054 completed success
`;
fs.writeFileSync(fixtureFile, noCommitFixture, "utf8");

let noCommitFailedAsExpected = false;
try {
  execSync(
    `node "${path.join(__dirname, "verify-report-refs.cjs")}" "## Test Section Run Line No Commit" "${fixtureFile}"`,
    {
      env: { ...process.env, VERIFY_MOCK_RUNS: mock45Runs },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
} catch (err) {
  noCommitFailedAsExpected = true;
  const output = (err.stdout ? err.stdout.toString() : "") + (err.stderr ? err.stderr.toString() : "");
  if (output.includes("has no commit hash on the same line")) {
    console.log("[PASS] Run line with no commit hash failed with exit 1 as expected.");
  } else {
    console.error("[FAIL] Run line with no commit failed with unexpected output:", output);
    process.exit(1);
  }
}
if (!noCommitFailedAsExpected) {
  console.error("[FAIL] Run line with no commit did not exit with error!");
  process.exit(1);
}

// 6. Section that mentions "CI Run" but has no run ID must exit 1
const noIdFixture = `
## Test Section CI Run No ID
- We observed CI Run failures during initial testing without logging IDs.
`;
fs.writeFileSync(fixtureFile, noIdFixture, "utf8");

let noIdFailedAsExpected = false;
try {
  execSync(
    `node "${path.join(__dirname, "verify-report-refs.cjs")}" "## Test Section CI Run No ID" "${fixtureFile}"`,
    {
      env: { ...process.env, VERIFY_MOCK_RUNS: mock45Runs },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
} catch (err) {
  noIdFailedAsExpected = true;
  const output = (err.stdout ? err.stdout.toString() : "") + (err.stderr ? err.stderr.toString() : "");
  if (output.includes("Section contains 'CI Run' or 'Run <number>' but no run ID was found!")) {
    console.log("[PASS] Section mentioning 'CI Run' without ID failed with exit 1 as expected.");
  } else {
    console.error("[FAIL] Section with no run ID failed with unexpected output:", output);
    process.exit(1);
  }
}
if (!noIdFailedAsExpected) {
  console.error("[FAIL] Section mentioning CI Run without ID did not exit with error!");
  process.exit(1);
}

// 7. Bare hash fixture: - CI: <sha> → run <id> → <conclusion> format without backticks
const bareHashFixture = `
## Test Section Bare Hash Format
- CI: efe3f6f → run 45064820984 → completed failure
- CI: 4cda049 → run 44111111111 → completed success
`;
fs.writeFileSync(fixtureFile, bareHashFixture, "utf8");

const mockBareRuns = JSON.stringify({
  "45064820984": { id: 45064820984, head_sha: "efe3f6f1234567890abcdef", status: "completed", conclusion: "failure" },
  "44111111111": { id: 44111111111, head_sha: "4cda0491234567890abcdef", status: "completed", conclusion: "success" },
});

try {
  execSync(
    `node "${path.join(__dirname, "verify-report-refs.cjs")}" "## Test Section Bare Hash Format" "${fixtureFile}"`,
    {
      env: { ...process.env, VERIFY_MOCK_RUNS: mockBareRuns },
      encoding: "utf8",
    }
  );
  console.log("[PASS] Bare hash format parsed and validated successfully.");
} catch (err) {
  console.error("[FAIL] Bare hash format failed unexpectedly:", err.stdout || err.message);
  process.exit(1);
}

// 8. Offline mode validation: --offline flag skips API and verifies pairing + git commits
try {
  const offlineOut = execSync(
    `node "${path.join(__dirname, "verify-report-refs.cjs")}" "## Test Section Bare Hash Format" "${fixtureFile}" --offline`,
    {
      env: { ...process.env, VERIFY_MOCK_RUNS: mockBareRuns },
      encoding: "utf8",
    }
  );
  if (offlineOut.includes("ALL REFERENCES AND PAIRINGS VERIFIED SUCCESSFULLY (OFFLINE)")) {
    console.log("[PASS] Offline mode passed format and pairing verification.");
  } else {
    console.error("[FAIL] Offline mode returned unexpected output:", offlineOut);
    process.exit(1);
  }
} catch (err) {
  console.error("[FAIL] Offline mode failed unexpectedly:", err.stdout || err.message);
  process.exit(1);
}

// 9. Offline mode conflicting commits for same run ID must fail
const conflictFixture = `
## Test Section Conflicting Run
- CI: \`4cda049\` → run 44111111111 → completed success
- CI: \`e641606\` → run 44111111111 → completed failure
`;
fs.writeFileSync(fixtureFile, conflictFixture, "utf8");

let conflictFailedAsExpected = false;
try {
  execSync(
    `node "${path.join(__dirname, "verify-report-refs.cjs")}" "## Test Section Conflicting Run" "${fixtureFile}" --offline`,
    {
      env: { ...process.env, VERIFY_MOCK_RUNS: mockBareRuns },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
} catch (err) {
  conflictFailedAsExpected = true;
  const output = (err.stdout ? err.stdout.toString() : "") + (err.stderr ? err.stderr.toString() : "");
  if (output.includes("is paired with conflicting commits")) {
    console.log("[PASS] Conflicting run ID across commits caught in offline mode as expected.");
  } else {
    console.error("[FAIL] Conflicting run ID failed with unexpected output:", output);
    process.exit(1);
  }
}
if (!conflictFailedAsExpected) {
  console.error("[FAIL] Conflicting run ID did not exit with error!");
  process.exit(1);
}

// Cleanup fixture file
try {
  fs.unlinkSync(fixtureFile);
  fs.rmdirSync(testDir);
} catch {}

console.log("=== All verify-report-refs tests passed! ===");
