Prompt for Antigravity — optional GitHub token for CI scripts
Copy everything below the line into Antigravity.

Review and this workstation share one IP. Without sign-in, GitHub allows 60 API requests per hour per IP. scripts/ci-status.cjs and scripts/verify-report-refs.cjs call the API without a token, so the limit runs out and both scripts return RATE_LIMITED for up to an hour. With a token the limit is 5,000 per hour.

This is a small task, about 30 to 45 minutes. Do it unattended. Do not change any app code, test or CI job in this task.

Save this text as docs/prompts/antigravity-pos-github-token-support-note.md in your commit. Log the work under ## Tooling, GitHub token support at the end of docs/overnight-log.md.

Before the commit, run git status, and add files by name. Never use git add . or git add -A.

Security rules (read first)
Never write a token into any file. That means no token in the repo, the log, the report, .env.example or a commit message.
Never ask for a token, create one, or print one. The owner signs in and sets it up personally.
Never put the token on a command line, for example as a curl -H argument. Other processes on the machine can read command lines.
Never print the token or the Authorization header. That includes error messages and debug output.
The token is only read from the environment.
1. One shared GitHub request helper
Add scripts/lib/github-api.cjs with one function, for example githubGet(path). It:
calls https://api.github.com + path with Node's https module;
sends User-Agent: UniversalPOS-CI-Scripts and Accept: application/vnd.github+json;
reads the token from GITHUB_TOKEN, or GH_TOKEN if the first is empty. If one is set, it sends Authorization: Bearer <token>. If neither is set, it sends no Authorization header and works as before;
on HTTP 403 or 429 with x-ratelimit-remaining: 0, returns the same RATE_LIMITED reset=<epoch> result the scripts print today;
on HTTP 401, fails with GitHub token rejected (401). Check GITHUB_TOKEN., with no token text in the message.
Make scripts/ci-status.cjs use it for every request, the fallback request included. Keep its output format exactly as it is, because the log rules depend on it.
Make scripts/verify-report-refs.cjs use it in place of the curl.exe calls at about lines 284 and 309. Keep its output exactly the same.
Each script prints one line to stderr at start: GitHub API: authenticated or GitHub API: anonymous (60 requests/hour). Never print anything about the token itself.
2. Fewer requests
verify-report-refs.cjs must not ask for the same run twice in one run. Keep the responses in memory for that run. Do not cache to disk.

If an untracked or local polling script exists, for example scripts/poll-ci.cjs, do not commit it. When you wait for CI from now on:

wait about 12 minutes after a push;
then check once;
then check at most once every 5 minutes;
never loop faster than that.
Write this rule in the log.

3. Owner setup steps
Add a short section ### GitHub API token (optional) to docs/ where the CI scripts are already described, or to README.md if there is no such place. Write it in plain words:

Install the GitHub CLI and run gh auth login.
In PowerShell, for the current window only: $env:GITHUB_TOKEN = (gh auth token).
Run node scripts/ci-status.cjs <sha>. The first line should say GitHub API: authenticated.
A token is a password. Never paste it into a file, a chat or a commit.
4. Proof
Run with no token set:

node scripts/ci-status.cjs 31ee28b;
node scripts/verify-report-refs.cjs "## Phase 1F, follow-up" docs/overnight-report.md.
Paste both outputs. They must match the old format and show GitHub API: anonymous.

Set GITHUB_TOKEN=invalid-test-value and run ci-status.cjs once. Paste the output: it must show the 401 message and must not contain invalid-test-value.

Run git grep -n -i -E "ghp_|github_pat_|gho_" and paste the result. It must be empty.

Commit and push. Check the commit with ci-status.cjs on its exact head_sha. Paste one line per job from the jobs API: test, smoke-prod and load-check, all success.

Then stop. Do not start Phase 3.
