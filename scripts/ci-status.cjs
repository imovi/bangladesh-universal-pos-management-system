#!/usr/bin/env node
/**
 * scripts/ci-status.cjs
 *
 * Mechanical checker for GitHub Actions run conclusion.
 * Usage: node scripts/ci-status.cjs <sha>
 * Output: <run id> <short sha> <status> <conclusion>
 *
 * Exits with:
 *  0: successfully fetched and printed runs
 *  1: error / invalid args / no runs found
 *  2: RATE_LIMITED
 */

const { execSync } = require("child_process");
const { githubGet, printAuthStatus } = require("./lib/github-api.cjs");

printAuthStatus();

const inputSha = process.argv[2];
if (!inputSha) {
  console.error("Usage: node scripts/ci-status.cjs <sha>");
  process.exit(1);
}

let fullSha = inputSha;
try {
  fullSha = execSync(`git rev-parse ${inputSha}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
} catch {
  // If git rev-parse fails, proceed with inputSha
}

const shortSha = fullSha.slice(0, 7);

async function main() {
  const url = `/repos/imovi/bangladesh-universal-pos-management-system/actions/runs?head_sha=${fullSha}`;

  try {
    const json = await githubGet(url);

    if (json.rateLimited || (json.message && json.message.includes("API rate limit exceeded"))) {
      console.log(`RATE_LIMITED reset=${json.reset || "unknown"}`);
      process.exit(2);
    }

    const runs = json.workflow_runs;
    if (!Array.isArray(runs)) {
      if (json.message) {
        console.error(`API Error: ${json.message}`);
      } else {
        console.error("No workflow_runs array in response");
      }
      process.exit(1);
    }

    if (runs.length === 0) {
      // Fallback: query recent runs without head_sha filter in case indexing is delayed
      const fallbackUrl = `/repos/imovi/bangladesh-universal-pos-management-system/actions/runs?per_page=10`;
      const fbJson = await githubGet(fallbackUrl);

      if (fbJson.rateLimited || (fbJson.message && fbJson.message.includes("API rate limit exceeded"))) {
        console.log(`RATE_LIMITED reset=${fbJson.reset || "unknown"}`);
        process.exit(2);
      }

      const matched = (fbJson.workflow_runs || []).filter(
        (r) => r.head_sha && (r.head_sha === fullSha || r.head_sha.startsWith(shortSha))
      );
      if (matched.length > 0) {
        for (const r of matched) {
          console.log(`${r.id} ${shortSha} ${r.status || "unknown"} ${r.conclusion || "in_progress"}`);
        }
        process.exit(0);
      }
      console.log(`NO_RUNS_FOUND ${shortSha}`);
      process.exit(0);
    }

    for (const r of runs) {
      const runId = r.id;
      const status = r.status || "unknown";
      const conclusion = r.conclusion || "in_progress";
      console.log(`${runId} ${shortSha} ${status} ${conclusion}`);
    }
    process.exit(0);
  } catch (err) {
    console.error(`Network error: ${err.message}`);
    process.exit(1);
  }
}

main();
