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
  if (/^[0-9a-f]{7,40}$/i.test(m[1]) && !m[1].includes('-')) {
    try {
      execSync(`git cat-file -t ${m[1]}`, { stdio: 'pipe' });
      commitHashes.add(m[1].toLowerCase());
    } catch {}
  }
}

// Extract run IDs line by line and find associated conclusion word on the same line
const lines = sectionContent.split('\n');
const runEntries = []; // Array of { runId, line, writtenConclusion, lineNumber }
const runIds = new Set();

const runIdRegex = /\b(44\d{9})\b/g;
const conclusionRegex = /\b(success|failure|cancelled|green|red|in_progress)\b/gi;

lines.forEach((lineText, idx) => {
  let match;
  while ((match = runIdRegex.exec(lineText)) !== null) {
    const runId = match[1];
    runIds.add(runId);

    // Look for conclusion word on this same line
    const words = [];
    let wMatch;
    while ((wMatch = conclusionRegex.exec(lineText)) !== null) {
      words.push(wMatch[1].toLowerCase());
    }

    // Determine normalized written conclusion
    let written = null;
    if (words.includes('success') || words.includes('green')) {
      written = 'success';
    } else if (words.includes('failure') || words.includes('red')) {
      written = 'failure';
    } else if (words.includes('cancelled')) {
      written = 'cancelled';
    } else if (words.includes('in_progress')) {
      written = 'in_progress';
    }

    runEntries.push({
      runId,
      lineText: lineText.trim(),
      writtenConclusion: written,
      lineNumber: idx + 1,
    });
  }
});

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

// Mock support for tests
const cachedRuns = new Map();
if (process.env.VERIFY_MOCK_RUNS) {
  try {
    const parsed = JSON.parse(process.env.VERIFY_MOCK_RUNS);
    for (const [k, v] of Object.entries(parsed)) {
      cachedRuns.set(String(k), v);
    }
  } catch (e) {
    console.error('Failed to parse VERIFY_MOCK_RUNS JSON');
  }
} else {
  // Fetch the recent 100 runs in a single call to conserve public rate limit
  try {
    const batchRes = execSync(
      'curl.exe -s -A "UniversalPOS-E2E" "https://api.github.com/repos/imovi/bangladesh-universal-pos-management-system/actions/runs?per_page=100"',
      { maxBuffer: 10 * 1024 * 1024 }
    ).toString();
    const batchData = JSON.parse(batchRes);
    if (batchData.message && batchData.message.includes('API rate limit exceeded')) {
      console.error('RATE_LIMITED by GitHub API');
      process.exit(2);
    }
    if (Array.isArray(batchData.workflow_runs)) {
      for (const r of batchData.workflow_runs) {
        cachedRuns.set(String(r.id), r);
      }
    }
  } catch (e) {}
}

let missingRuns = 0;
let conclusionMismatches = 0;

for (const entry of runEntries) {
  const { runId, lineText, writtenConclusion } = entry;
  try {
    let data = cachedRuns.get(String(runId));
    if (!data && !process.env.VERIFY_MOCK_RUNS) {
      const res = execSync(
        `curl.exe -s -A "UniversalPOS-E2E" "https://api.github.com/repos/imovi/bangladesh-universal-pos-management-system/actions/runs/${runId}"`,
        { maxBuffer: 10 * 1024 * 1024 }
      ).toString();
      data = JSON.parse(res);
      if (data.message && data.message.includes('API rate limit exceeded')) {
        console.error('RATE_LIMITED by GitHub API');
        process.exit(2);
      }
    }

    if (!data || !data.id || String(data.id) !== String(runId)) {
      console.error(`[FAIL] run ${runId} not found in GitHub Actions API (${data?.message || 'unknown error'})`);
      missingRuns++;
      continue;
    }

    const realConclusion = data.conclusion || (data.status === 'in_progress' ? 'in_progress' : data.status);
    console.log(`[PASS] run: ${runId} (status: ${data.status}, conclusion: ${data.conclusion})`);

    if (writtenConclusion) {
      const normalizedReal = realConclusion === 'success' ? 'success' :
                             realConclusion === 'failure' ? 'failure' :
                             realConclusion === 'cancelled' ? 'cancelled' :
                             realConclusion === 'in_progress' ? 'in_progress' : realConclusion;

      if (writtenConclusion !== normalizedReal) {
        console.error(`[FAIL] Conclusion mismatch for run ${runId}: written '${writtenConclusion}' vs actual '${normalizedReal}'`);
        console.error(`  Line: ${lineText}`);
        conclusionMismatches++;
      } else {
        console.log(`  [PASS] Conclusion matches: ${writtenConclusion}`);
      }
    } else {
      console.warn(`  [WARN] No explicit conclusion word found on line for run ${runId}: "${lineText}"`);
    }
  } catch (err) {
    console.error(`[FAIL] error verifying run ${runId}:`, err.message);
    missingRuns++;
  }
}

console.log('--- Verification Summary ---');
console.log(`Missing commits: ${missingCommits}`);
console.log(`Missing run IDs: ${missingRuns}`);
console.log(`Conclusion mismatches: ${conclusionMismatches}`);

if (missingCommits > 0 || missingRuns > 0 || conclusionMismatches > 0) {
  process.exit(1);
} else {
  console.log('ALL REFERENCES AND CONCLUSIONS VERIFIED SUCCESSFULLY.');
  process.exit(0);
}
