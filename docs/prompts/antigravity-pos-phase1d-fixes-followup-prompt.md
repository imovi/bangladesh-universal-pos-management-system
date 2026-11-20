# Prompt for Antigravity — Phase 1D fixes, follow-up (report truth + seed guard)

You are working in D:\pos system (repo imovi/bangladesh-universal-pos-management-system). You will work alone, and nobody will answer questions. This is a short run: about 1 to 2 hours.

Save this file as docs/prompts/antigravity-pos-phase1d-fixes-followup-prompt.md and commit it with your first commit. Log under ## Phase 1D, fixes follow-up in docs/overnight-log.md.

All rules of docs/prompts/antigravity-pos-phase1d-fixes-prompt.md still apply. That includes never reading or using a credential from this computer, and never writing a hash or run id you did not just copy from git log or the API.

What the hands-on test found
Fix 1, Fix 2 and Fix 3 were tested by hand on the dev database, with the API stopped while the browser stayed online. They work:

The pill showed অফলাইন.
Return, cash management and close shift were disabled, and F6 did nothing.
The receipts REG01-O-261120-0001 and -0002 synced once each, under the same number, with is_offline = true and the real sale time.
The shift list showed the unsynced sale with its badge.
An online sale got its server number, and localSales kept one row per sale.
Good work. The problems are in the report and in one guard.

Step 1. The ## Phase 1D, fixes report contains things that do not exist (docs only)
Checked against git log and the public API:

In the report	Real value
Step 0 commit 33b45ca	does not exist. Step 0 was 21b5fc1, run 44570867855
Fix 4 runs 44583726514, 44584285743	do not exist. Real: 44580903756 (c6283c2, failure), 44581892201 (442dbd4, failure)
Fix 2 & 6 run 44594314189	does not exist. Real: 44593757883 (70e12c1, failure)
Step 0 run 44583151326	does not exist
apps/api/src/common/db-protection.ts	file does not exist
Also:

Section 2, "What wiped the dev database": it blames reset-dev-db.ts. Your own log for this run blames seed-demo.ts: clearExistingTenant() deletes the tenant first, and if the app boot fails afterwards, the database is left empty. Write the cause that the evidence supports, and say what is proven and what is a guess.
Section 1 says "zero test skips, retries, or weakenings". 83170f7 raised the Playwright timeout to 60 s after a failure whose log you could not read. Say that plainly. It is a reasonable change, but it is not "zero weakenings".
Section 3 says CI was checked "exclusively against the unauthenticated public GitHub Actions web interface". If you used the API, say the API.
How to fix it:

Build every row of the table with a script, not by hand. Run git log --format='%h %s' 21b5fc1~1..HEAD. Then, for each hash, look up its run in https://api.github.com/repos/imovi/bangladesh-universal-pos-management-system/actions/runs?head_sha=<full sha>. Paste the script's output into the table.
Add scripts/verify-report-refs.cjs. It finds every 7- to 40-character hex hash and every 11-digit run id in a given section of docs/overnight-report.md, then checks each against git cat-file -t and the public runs API. It exits 1 if any are missing. Run it on the Phase 1D, fixes section and on this run's section, and paste its output into the log.
Log, in one sentence, why this happened again, and what you will do differently.
Step 2. seed:demo can still empty the dev database
442dbd4 removed the --yes guard for universal_pos so that CI would pass. Now npm run seed:demo on the dev database deletes the tenant again with no confirmation, and the delete-then-boot order is unchanged.

Fix both:

Order: boot the Nest app context and check that it works before clearExistingTenant(). Even better, seed under a new tenant slug, and delete the old tenant only after the whole seed succeeded. Whichever way you choose, a failed seed must leave the old data in place. Log your choice.
Guard: restore the rule from the fixes prompt. A destructive action on a database whose name does not end in _e2e or _test needs --yes. In CI, pass the flag explicitly (npm run seed:demo -- --yes in the workflow), or point CI at a _test database. Do not loosen the guard to make CI pass.
Test: in apps/api/test/db-protection-guard.spec.ts:
seed:demo without --yes on a database named universal_pos exits non-zero and deletes nothing;
a seed that fails during app boot leaves the existing tenant in place. Simulate the failure, for example with an env flag that throws during boot, and run it only on the _e2e database.
Commit, push, check CI for that exact head_sha.

Step 3. Two small items
Lost-response path without a flag. In sales.service.ts, the second isOffline && invoiceNumber mismatch branch (the unique-conflict / race path) returns the existing sale without adding the NUMBER_MISMATCH flag or setting offline_invoice_number. Make both paths share one helper, so both always link and flag. Add an API test that goes through the race path.
Return dialog search by offline number. On /pos, press F6 and type an -O- number of a sale that the server stored under its server number (the lost-response case). Check that the sale is found. If it is not, fix the lookup. Add a Playwright assertion to the lost-response test.
Final report
Add ## Phase 1D, fixes follow-up to docs/overnight-report.md and print the same in chat:

the table, generated by the script, and the output of verify-report-refs.cjs showing 0 missing;
what changed in seed:demo;
every BLOCKED entry and every rule you could not follow.
