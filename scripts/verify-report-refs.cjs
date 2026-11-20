const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const targetSection = process.argv[2] || '## Phase 1D, fixes';
let reportPath = process.argv[3] ? path.resolve(process.argv[3]) : path.join(__dirname, '..', 'docs', 'overnight-report.md');
let content = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : '';

if (content.indexOf(targetSection) === -1) {
  // If not found in report, check overnight-log.md
  const logPath = path.join(__dirname, '..', 'docs', 'overnight-log.md');
  if (fs.existsSync(logPath) && fs.readFileSync(logPath, 'utf8').includes(targetSection)) {
    reportPath = logPath;
    content = fs.readFileSync(reportPath, 'utf8');
  }
}

const sectionIndex = content.indexOf(targetSection);
if (sectionIndex === -1) {
  console.error(`Section "${targetSection}" not found in ${reportPath}`);
  process.exit(1);
}

// Find next section header starting with "## " or end of file
const afterSection = content.substring(sectionIndex + targetSection.length);
const nextHeaderMatch = afterSection.match(/\n## [^\n]+/);
const sectionContent = nextHeaderMatch 
  ? afterSection.substring(0, nextHeaderMatch.index)
  : afterSection;

console.log(`Checking section: ${targetSection} (${sectionContent.length} chars)`);

// Extract 7-to-40 char hex commit hashes (surrounded by [`...`] or [`<hash>`](...) or similar)
const hashRegex = /\[`([0-9a-f]{7,40})`\]/gi;
const commitHashes = new Set();
let m;
while ((m = hashRegex.exec(sectionContent)) !== null) {
  commitHashes.add(m[1].toLowerCase());
}

// Also check any standalone backticked hex hashes: `c6283c2`
const inlineHashRegex = /(?<!\[)`([0-9a-f]{7,40})`(?!\])/gi;
while ((m = inlineHashRegex.exec(sectionContent)) !== null) {
  // Avoid UUIDs or words
  if (/^[0-9a-f]{7,40}$/i.test(m[1]) && !m[1].includes('-')) {
    // Only add if git cat-file recognizes it as a commit or object
    try {
      execSync(`git cat-file -t ${m[1]}`, { stdio: 'pipe' });
      commitHashes.add(m[1].toLowerCase());
    } catch {}
  }
}

// Extract 11-digit run IDs (e.g. 44583726514)
const runRegex = /\b(44\d{9})\b/g;
const runIds = new Set();
while ((m = runRegex.exec(sectionContent)) !== null) {
  runIds.add(m[1]);
}

console.log(`Found ${commitHashes.size} unique commit hash(es) and ${runIds.size} unique run ID(s).`);

let missingCommits = 0;
for (const hash of commitHashes) {
  try {
    const type = execSync(`git cat-file -t ${hash}`, { stdio: 'pipe' }).toString().trim();
    if (type !== 'commit') {
      console.error(`[FAIL] ${hash} is of type ${type}, expected commit`);
      missingCommits++;
    } else {
      console.log(`[PASS] commit: ${hash}`);
    }
  } catch (err) {
    console.error(`[FAIL] commit ${hash} does not exist in git`);
    missingCommits++;
  }
}

let missingRuns = 0;
// Fetch the recent 100 runs in a single call to conserve public rate limit
const cachedRuns = new Map();
try {
  const batchRes = execSync(
    'curl.exe -s "https://api.github.com/repos/imovi/bangladesh-universal-pos-management-system/actions/runs?per_page=100"',
    { maxBuffer: 10 * 1024 * 1024 }
  ).toString();
  const batchData = JSON.parse(batchRes);
  if (Array.isArray(batchData.workflow_runs)) {
    for (const r of batchData.workflow_runs) {
      cachedRuns.set(String(r.id), r);
    }
  }
} catch (e) {
  // Fall back to individual requests
}

for (const runId of runIds) {
  try {
    let data = cachedRuns.get(String(runId));
    if (!data) {
      const res = execSync(
        `curl.exe -s "https://api.github.com/repos/imovi/bangladesh-universal-pos-management-system/actions/runs/${runId}"`,
        { maxBuffer: 10 * 1024 * 1024 }
      ).toString();
      data = JSON.parse(res);
    }
    if (data && data.id && String(data.id) === String(runId)) {
      console.log(`[PASS] run: ${runId} (status: ${data.status}, conclusion: ${data.conclusion})`);
    } else {
      console.error(`[FAIL] run ${runId} not found in GitHub Actions API (${data?.message || 'unknown error'})`);
      missingRuns++;
    }
  } catch (err) {
    console.error(`[FAIL] error verifying run ${runId}:`, err.message);
    missingRuns++;
  }
}

console.log('--- Verification Summary ---');
console.log(`Missing commits: ${missingCommits}`);
console.log(`Missing run IDs: ${missingRuns}`);

if (missingCommits > 0 || missingRuns > 0) {
  process.exit(1);
} else {
  console.log('ALL REFERENCES VERIFIED SUCCESSFULLY.');
  process.exit(0);
}
