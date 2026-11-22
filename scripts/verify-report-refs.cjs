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
const rawLines = sectionContent.split('\n');
const lines = []; // { text, lineNum }

let inCodeBlock = false;
rawLines.forEach((lineText, idx) => {
  if (lineText.trim().startsWith('```')) {
    inCodeBlock = !inCodeBlock;
    return;
  }
  if (inCodeBlock) {
    return;
  }

  // If this is a markdown table row with <br> separating attempts in columns, expand into sub-rows
  if (lineText.trim().startsWith('|') && lineText.trim().endsWith('|') && lineText.includes('<br>')) {
    const cols = lineText.split('|');
    const colParts = cols.map(c => c.split(/<br\s*\/?>/i).map(p => p.trim()));
    const maxLen = Math.max(...colParts.map(p => p.length));
    for (let i = 0; i < maxLen; i++) {
      const subCols = colParts.map(parts => parts[i] || '');
      lines.push({ text: subCols.join(' | '), lineNum: idx + 1 });
    }
  } else {
    lines.push({ text: lineText, lineNum: idx + 1 });
  }
});

const runEntries = []; // Array of { runId, pairedCommit, lineText, writtenConclusion, lineNumber }
const runIds = new Set();

const conclusionRegex = /\b(success|failure|cancelled|green|red|in_progress)\b/gi;
const lineHashRegex = /\[`([0-9a-f]{7,40})`\]|(?<!\[)`([0-9a-f]{7,40})`(?!\])/gi;

function extractRunIdsFromLine(lineText) {
  const matches = [];

  // 1. URLs: actions/runs/<id>
  const urlRegex = /actions\/runs\/(\d{10,12})/gi;
  let m;
  while ((m = urlRegex.exec(lineText)) !== null) {
    if (!matches.some((e) => e.id === m[1])) {
      matches.push({ id: m[1], index: m.index });
    }
  }

  // 2. Labelled as a run, e.g. "run 45060429437", "run `45060429437`", "CI Run 1: 450...", "run: 450..."
  const labelRegex = /\b(?:CI\s+)?runs?(?:\s+id|\s+number)?[:\s#→>]+[`\[]?(\d{10,12})[`\]]?/gi;
  while ((m = labelRegex.exec(lineText)) !== null) {
    if (!matches.some((e) => e.id === m[1])) {
      matches.push({ id: m[1], index: m.index });
    }
  }

  // 3. In brackets or markdown table cells: [45060429437] or | 45060429437 |
  const bracketOrTableRegex = /\[(\d{10,12})\]|(?<=\|\s*`?)(\d{10,12})(?=`?\s*\|)/g;
  while ((m = bracketOrTableRegex.exec(lineText)) !== null) {
    const rId = m[1] || m[2];
    if (rId && !matches.some((e) => e.id === rId)) {
      matches.push({ id: rId, index: m.index });
    }
  }

  return matches;
}

lines.forEach(({ text: lineText, lineNum }) => {
  // Extract all commits on this line with their index positions
  const commitMatches = [];
  let cMatch;
  while ((cMatch = lineHashRegex.exec(lineText)) !== null) {
    const val = (cMatch[1] || cMatch[2]).toLowerCase();
    if (/^[0-9a-f]{7,40}$/i.test(val)) {
      commitMatches.push({ hash: val, index: cMatch.index });
    }
  }

  // Extract unique runs on this line with their index positions
  const runMatches = extractRunIdsFromLine(lineText);

  // Extract conclusion words with index positions
  const wordMatches = [];
  let wMatch;
  while ((wMatch = conclusionRegex.exec(lineText)) !== null) {
    let w = wMatch[1].toLowerCase();
    if (w === 'green') w = 'success';
    if (w === 'red') w = 'failure';
    wordMatches.push({ word: w, index: wMatch.index });
  }

  runMatches.forEach(run => {
    runIds.add(run.id);

    // Fail if run ID has no commit hash on the same line
    let pairedCommit = null;
    if (commitMatches.length === 0) {
      console.error(`[FAIL] Run ${run.id} on line ${lineNum} has no commit hash on the same line:`);
      console.error(`  Line: ${lineText}`);
    } else {
      const precedingCommits = commitMatches.filter(c => c.index < run.index);
      if (precedingCommits.length > 0) {
        pairedCommit = precedingCommits[precedingCommits.length - 1].hash;
      } else {
        pairedCommit = commitMatches[0].hash;
      }
    }

    // Find closest conclusion word to the run
    let written = null;
    if (wordMatches.length > 0) {
      let closest = wordMatches[0];
      let minDiff = Math.abs(closest.index - run.index);
      for (let i = 1; i < wordMatches.length; i++) {
        const diff = Math.abs(wordMatches[i].index - run.index);
        if (diff < minDiff) {
          minDiff = diff;
          closest = wordMatches[i];
        }
      }
      written = closest.word;
    }

    runEntries.push({
      runId: run.id,
      pairedCommit,
      lineText: lineText.trim(),
      writtenConclusion: written,
      lineNumber: lineNum,
    });
  });
});

// Fail if section contains words "CI Run" or "Run <number>", but no run id is found
const mentionsRunWords = /\b(?:CI\s+Run|Run\s+\d+)\b/i.test(sectionContent);
if (mentionsRunWords && runIds.size === 0) {
  console.error(`[FAIL] Section contains 'CI Run' or 'Run <number>' but no run ID was found!`);
  process.exit(1);
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
let shaMismatches = 0;

for (const entry of runEntries) {
  const { runId, pairedCommit, lineText, writtenConclusion, lineNumber } = entry;
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

    // Verify Head SHA matches the commit on the same line
    if (!pairedCommit) {
      console.error(`[FAIL] Run ${runId} on line ${lineNumber} has no commit hash on the same line`);
      console.error(`  Line: ${lineText}`);
      shaMismatches++;
    } else {
      const actualSha = data.head_sha ? data.head_sha.toLowerCase() : "";
      if (!actualSha.startsWith(pairedCommit.toLowerCase())) {
        console.error(`[FAIL] Head SHA mismatch for run ${runId} on line ${lineNumber}: expected commit '${pairedCommit}' but run head_sha is '${actualSha.slice(0, 7)}'`);
        console.error(`  Line: ${lineText}`);
        shaMismatches++;
      } else {
        console.log(`  [PASS] Head SHA matches commit: ${pairedCommit}`);
      }
    }

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
console.log(`Head SHA mismatches: ${shaMismatches}`);

if (missingCommits > 0 || missingRuns > 0 || conclusionMismatches > 0 || shaMismatches > 0) {
  process.exit(1);
} else {
  console.log('ALL REFERENCES AND CONCLUSIONS VERIFIED SUCCESSFULLY.');
  process.exit(0);
}
