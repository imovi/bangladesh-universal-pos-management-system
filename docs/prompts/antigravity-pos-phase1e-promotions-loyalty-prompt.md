# Prompt for Antigravity — Phase 1E: promotions, coupons and loyalty points
Copy everything below the line into Antigravity.

You are working in D:\pos system (repo imovi/bangladesh-universal-pos-management-system). I am going to sleep. You will work alone for 5 to 7 hours, and nobody will answer questions.

Why this phase matters. Fashion shops in Bangladesh sell most during Eid, Pohela Boishakh and winter sales, and they run offers like "২০% ছাড়", "২টা কিনলে ১টা ফ্রি" and "৳৫,০০০ কিনলে ৳৫০০ ছাড়". Customers come back for points. A wrong discount loses money on every sale of the busiest days, so every number must be correct to the poisha, the same on the client, the server, the receipt and the reports, online and offline.

Save this file as docs/prompts/antigravity-pos-phase1e-promotions-loyalty-prompt.md and commit it with your first commit. Log in docs/overnight-log.md under ## Phase 1E.

Unattended mode
All rules of these prompts apply unchanged:

docs/prompts/antigravity-pos-overnight-run-prompt.md ("Unattended mode" items 1 to 11);
the additional rules of docs/prompts/antigravity-pos-phase1c-returns-due-transfers-prompt.md;
docs/prompts/antigravity-pos-phase1d-fixes-prompt.md (the two extra rules).
CI:

After every push, check the API for that exact head_sha before you start the next item.
If CI is red, fixing it is the next item.
After 3 failed attempts, write BLOCKED: CI red with the failing test names, and stop building features.
"All tests pass locally" never counts as green.
No credentials. Never read, print or use any credential from this computer: Git Credential Manager, tokens, plugin accounts. Use only the public GitHub API without auth.

Hashes and run ids:

Never write a hash or run id you did not just copy from git log or the API.
Before you write the final report, run node scripts/verify-report-refs.cjs "## Phase 1E" and paste its output into the log. If it reports anything missing, the report is not finished.
When a command hangs with no output for 10 minutes, kill it, log it, and continue. Never stop working without writing in the log why you stopped.

Step 0. Leftovers from Phase 1D (30 minutes, one commit)
Partial seed. seed:demo deletes the old tenant after the app boots. If seeding then fails halfway, the dev database is left with half a tenant. Seed under a temporary slug, and swap or delete the old tenant only after the whole seed succeeded.
Boot-failure test. In db-protection-guard.spec.ts, the boot-failure test throws before the delete in any code order, so it would not catch the old bug. Make the failure happen inside the seed, after the app has booted, and assert that the old tenant is still there.
Step 1. Design decisions (decided; do not ask)
Read all of this before you write code. Write docs/promotions-and-loyalty.md describing the design as built, with worked number examples.

1.1 One calculation, shared
Put the whole promotion calculation in packages/shared/src/promotions.ts, as a pure function with no I/O:
Input: cart lines, promotions, the coupon code, the customer, the branch, and the time.
Output: the applied promotions per line and per bill, the discount in minor units, and the reason for each.
/pos (online and offline) and the API both call this same function. Do not write a second copy anywhere.
Promotion discounts feed into the existing calculateSaleTotals in money.ts, before VAT, in the same way as the existing line and bill discounts. Do not change how VAT or rounding works.
All money is BigInt minor units. A rounding remainder goes to lines by the largest remainder, in the same way as distributeBillDiscount.
1.2 Promotion types
Type	Example	Rule
PERCENT_OFF	ঈদ অফার: Panjabi 20% off	percent off each qualifying unit; optional cap per line
AMOUNT_OFF	৳300 off each Denim	flat amount off per unit; never below 0
FIXED_PRICE	any Kurti for ৳999	unit price becomes this; only if lower than the current price
BUY_X_GET_Y	buy 2 get 1 free, or buy 2 get the 3rd at 50%	the cheapest qualifying units are the "get" units
BUNDLE_PRICE	any 3 T-shirts for ৳1,500	groups of N qualifying units at a fixed total; the most expensive units are grouped first
BILL_THRESHOLD	spend ৳5,000, get 10% off (max ৳1,000), or ৳500 off	on the bill after line promotions
What a promotion can target:

all products;
a list of products or variants;
categories, brands or collections;
an exclusion list, for example "not on new arrivals".
Conditions:

start and end date-time, read in Asia/Dhaka;
optional days of the week and hours, for example "Friday 3pm to 9pm";
branches (default all);
a minimum quantity or amount;
"members only", meaning the sale has a customer attached;
a usage limit, in total and per customer.
Status: draft, active, paused or ended. Only active promotions inside their time window apply.

1.3 Stacking: always the same order, best for the customer
Line promotions (PERCENT_OFF, AMOUNT_OFF, FIXED_PRICE, BUY_X_GET_Y, BUNDLE_PRICE): at most one per unit.
When several could apply, choose the combination that gives the customer the largest total discount.
On a tie, the higher priority wins, then the earlier created_at.
Write the selection so it stays fast with 50 lines and 20 active promotions. A greedy method with a proof in the doc is fine; log what you chose.
Bill promotion (BILL_THRESHOLD, or a coupon): at most one, the largest.
The threshold is checked against the subtotal after line promotions.
The cashier's manual line or bill discount comes last, on what is left.
The cashier's discount limit (maxDiscountPercent) counts only the manual part. Promotions never use up the cashier's limit.
A manual line discount on a line that already has a promotion needs the permission promotion.override. Without it, the field is disabled, with a tooltip.
A promotion can be marked stackable_with_bill = false. Then units it applies to are left out of the bill promotion's base.

Every discount is spread over the lines it came from. A BUY_X_GET_Y or BUNDLE_PRICE discount is spread over all the units in the deal, in proportion to their price, not put entirely on the "free" unit. A bill discount is spread over all lines in the base. So each sale line stores what the customer really paid for it, and a return of any single unit refunds a fair amount.

Worked examples (these numbers must appear as tests):

20% off: Panjabi ৳2,200 × 2 with 20% off. The discount is ৳880, and the line total is ৳3,520.
Buy 2 get 1 free:
Three Panjabi at ৳3,000, ৳2,500 and ৳2,000. The free unit is the ৳2,000 one, so the discount is ৳2,000.
Spread 3000 : 2500 : 2000, it gives ৳800.00, ৳666.67 and ৳533.33.
Returning the ৳3,000 Panjabi alone refunds ৳2,200.00.
Bill threshold:
The rule is 10% off over ৳5,000, max ৳1,000.
On a subtotal of ৳4,999.99 after line promotions, there is no discount.
On ৳12,000, the discount is ৳1,000 (capped).
1.4 What happens when a return breaks a deal
A return refunds what the customer paid for the returned units, as stored on the line. Never re-run the promotion on the remaining units.
So a customer who bought 3 for 2 and returns 1 unit gets back that unit's stored net amount, and keeps the other two at their stored price. Write this in the doc as a decision I may want to change.
1.5 Coupons
A coupon is a bill promotion that needs a code, or a set of generated codes (for example 200 one-time codes for an SMS campaign later).
Codes are case-insensitive and stored uppercase. Each has a usage limit in total and per customer.
At /pos, the cashier types the code in a "কুপন কোড" field in the cart panel:
A valid code shows its name and the saving.
An invalid one shows why: expired, not started, wrong branch, limit used, or bill too small.
Usage limit:
Usage is counted only when a sale is saved, in the same transaction.
It must hold under concurrency: two sales using the last use of a code at the same time means one succeeds and one gets the error COUPON_LIMIT_REACHED.
A return of the whole sale gives the use back. A partial return does not.
1.6 Loyalty points
Tenant settings (/settings/loyalty, permission loyalty.manage):

on/off;
earn rate (default 1 point per ৳100 of net paid);
point value (default 1 point = ৳1);
minimum points to redeem (default 100);
maximum share of a bill payable with points (default 50%);
points expiry in months (default 12, or 0 for never).
Ledger:

Points live in an append-only ledger table, loyalty_ledger. Its fields are: id, tenant, customer, sale or return id, type (EARN, REDEEM, REVERSE_EARN, REFUND_REDEEM, EXPIRE, ADJUST), points (signed), created_at and expires_at.
The customer's balance is the sum of the ledger. You may keep a cached balance on customers too, if it is updated in the same transaction and a test checks it against the sum.
Never update or delete a ledger row.
Earning:

Earning happens only when the sale has a customer.
The base is the net sale total minus the part paid with points. Round down to whole points.
Credit ("baki") sales earn too. This is a decision I may want to change.
Redeeming:

Points are spent as a payment method, points ("পয়েন্ট").
They work only online, because the balance must be checked. Offline, the method is disabled with "অনলাইনে ফিরলে করা যাবে".
Show the balance and the maximum usable on this bill.
Two sales redeeming the same points at the same time cannot both succeed.
Returns:

A return reverses the points earned on the returned part, in proportion.
The part originally paid with points goes back as points first, and the rest goes back by the normal refund method.
If reversing makes the balance negative, allow it. The customer cannot redeem until the balance is positive again. Show this on the customer page.
Other rules:

Expiry: a daily job writes EXPIRE rows, oldest earn first (FIFO). Make it safe to run twice on the same day.
Manual adjust: permission loyalty.adjust. It needs a reason and writes an audit log entry.
Shift figures: the points payment method counts in the shift's method totals but not in expected cash.
1.7 Offline rules (keep everything from Phase 1D)
Active promotions and coupons without a usage limit are cached in the offline catalog, and a promotion change bumps catalogVersion. Offline sales apply them with the same shared function.
Coupons with a usage limit cannot be used offline. The field says why.
The server keeps the client's promotion result for an offline sale and never rejects one for a promotion reason. Instead it adds a review flag:
PROMOTION_CHANGED: the promotion was edited, ended or paused before the sync, so the server would compute a different discount. Details hold both amounts.
COUPON_LIMIT_EXCEEDED: an unlimited coupon became limited, or the limit was already used.
Online sales are the same as for prices in Phase 1D. The server recomputes the promotion. If the result differs from the expectedTotalMinor the client sent, it answers the same price-changed error the client already handles, and the cart refreshes.
Points earned offline are written when the sale syncs.
1.8 What the sale stores
On sale_items: promotion_id (nullable), promotion_discount_minor, and a short promotion_label snapshot. A later rename of the promotion must not change old receipts.
On sales: bill_promotion_id, bill_promotion_discount_minor, coupon_code (snapshot), points_earned and points_redeemed.
discount_minor keeps meaning the total discount on the line or sale. Do not change the meaning of an existing column; add new ones.
1.9 Permissions (add to packages/shared/src/permissions.ts)
Permission	Default roles
promotion.view	Owner, Manager
promotion.manage	Owner, Manager
promotion.override	Owner, Manager
loyalty.manage	Owner
loyalty.adjust	Owner, Manager
Step 2. Work list (each milestone its own commits, with tests)
E1. The shared calculation and the schema (do this first, and test it hardest)
Prisma models and migration. RLS on every new table, with the same policies and grants as the existing tenant tables. Check that pos_app and pos_runtime can do what the app needs, and nothing more.
Build promotions.ts and the loyalty point math (earnPoints, maxRedeemable, reversePoints) in packages/shared.
Unit tests, table-driven, with every worked example from 1.3 to the poisha, plus:
each promotion type alone, at its edges: a cap, FIXED_PRICE above the current price, a BUY_X_GET_Y with 2, 3, 5 and 6 units, and a bundle with leftovers;
two promotions competing for the same units, where the best combination wins;
a time window around midnight in Asia/Dhaka, a day-of-week window, and the start and end instants (inclusive start, exclusive end);
VAT-inclusive and VAT-exclusive tax classes with a promotion;
a property test with fast-check if it is already a dependency, or 1,000 seeded random carts if not:
no line total is below 0;
the discount is never larger than the gross;
the sum of line nets equals the sale total;
the result does not depend on the order of the cart lines.
Coverage of promotions.ts at 95% or more. Log the number.
E2. Promotions in the back office and at /pos
Back office:

/promotions list:
filter by status and type;
columns: name, type, target, time window, branches, uses, discount given so far;
pause, resume, end, duplicate.
Create/edit form:
the type decides which fields show;
target picker for products, variants, categories, brands and collections;
date-time pickers in Asia/Dhaka.
A preview box: pick up to 5 products and quantities, and it shows the result of the shared function. This is how a manager checks an offer before the sale day.
An ended or used promotion cannot be deleted, only ended.
Editing a promotion that has already been used creates a change entry in the audit log with the old and new values.
At /pos:

Promotions apply automatically as the cart changes.
Each line shows a small badge with the promotion label and the saving.
The bill promotion shows as its own line in the totals.
A hint like "আর ৳৫০০ কিনলে ১০% ছাড়" appears when a bill threshold is within 20% of being reached.
Receipt (80 mm and 58 mm):

the promotion label under each line;
the bill promotion line;
"আপনি সাশ্রয় করলেন ৳X" (promotions plus manual discounts).
Tests:

An API test for every route, including cross-tenant: tenant A's token with tenant B's promotion id gives 404 with no data.
An API test that a sale's stored numbers equal the shared function's result.
Playwright as a cashier:
add 3 Panjabi under "buy 2 get 1";
check the badge, the total, and the receipt against GET /sales/:id;
then return the most expensive unit through F6, and check the refund equals the stored line net.
Global guard entries for /promotions and the form, in Bangla and English.
E3. Coupons
Coupon fields on bill promotions, plus generating N one-time codes with a CSV export.
The /pos coupon field, with the invalid-code reasons from 1.5.
Tests:
parallel use of the last code use: Promise.all, exactly one succeeds, and the count equals the limit;
idempotent retry of the same sale does not count a use twice;
a full return gives the use back, and a partial return does not;
offline: an unlimited code works and syncs; a limited code is disabled offline;
Playwright: type a code, see the saving, finish the sale, and the receipt shows the code.
E4. Loyalty points
Screens:

Settings page.
Customer detail: balance, points value in ৳, the ledger with filters, and the manual adjust dialog.
At /pos:
after a customer is attached, show the balance;
points as a payment method in the split payment, with the maximum usable;
the receipt shows points earned, points used and the new balance.
The expiry job:

Use the scheduler the API already has. If it has none, add @nestjs/schedule and log why.
Run it daily at 03:00 Asia/Dhaka.
Tests:

earn, redeem, return with reverse and refund of points, negative balance blocking redemption;
parallel redemption of the same points: exactly one succeeds;
the cached balance equals the ledger sum after each of these;
expiry FIFO with mixed earn dates, run twice on the same day: the result is the same;
an offline sale with a customer earns points when it syncs, exactly once;
shift figures: the points method is in the method totals and not in expected cash;
Playwright: a sale that earns points, then a second sale paying part with points, both checked against the API.
E5. Reports and dashboard
Promotion report:
for each promotion, the number of sales, units, gross, discount given and net, and returns on promoted lines;
by day and by branch;
CSV export.
Loyalty report:
points issued, redeemed, expired and reversed by month;
the outstanding balance and its value in ৳ (the shop's liability);
the top customers by balance.
Profit report: it must already subtract discounts. Add a test with a promoted sale and a partial return, with the expected profit to the poisha.
Dashboard: today's "অফারে ছাড়" (promotion discount given) and "পয়েন্টে বিক্রি" (paid with points). Add a Playwright assertion against the API for each.
Every report:
follows the branch in the header;
uses the shared date range picker;
is added to the global guard;
has screenshots in docs/screenshots/e5/ at 1440 px and 375 px.
Screenshots
Take these from the production build: docs/screenshots/e2/, e3/ and e4/. Include:

the promotion form with the preview;
/pos with promotion badges and a bill promotion;
the coupon field (valid and invalid);
the points payment;
the customer ledger;
both receipts.
Take them in Bangla, light mode, at 1440 px and 375 px, and /pos in dark mode too.

Pace: if a milestone takes more than 2 hours, stop adding extras, finish its required tests, push, and move on. E1 to E4 come before E5.

Things you must not do in this phase
Do not compute a discount anywhere except the shared function.
Do not change existing sales, receipts or reports so that old numbers change. Old sales have no promotion columns set, and that must keep working.
Do not count promotions against the cashier's manual discount limit.
Do not let points be redeemed offline, or let a coupon with a usage limit be used offline.
Do not update or delete loyalty ledger rows.
Do not reject an offline sale for a promotion reason.
If time remains
In this order, each its own commit:

A "এই অফারগুলো চলছে" list in the /pos cashier menu: active promotions today, with their end time.
Price tag labels (from Phase 1C barcode labels) that can show the offer price, with the original price crossed out.
Birthday points: add an optional customer birthday, and give N bonus points (a setting) once a year in the birthday week, through the daily job.
Out of scope: SMS sending, customer tiers (silver/gold), gift cards, e-commerce, payment gateways, customer self-service portal.

Final report
Add ## Phase 1E to docs/overnight-report.md and print the same in chat. Include:

A table of each item (Step 0, E1 to E5, extras): status, the real commit hash, and the CI run id and conclusion. Build it with a script from git log and the API, then run verify-report-refs.cjs and paste the output showing 0 missing.
New tables, columns, migrations, permissions, endpoints and jobs.
The stacking selection method, and its run time with 50 lines and 20 promotions.
Coverage of promotions.ts and the loyalty math.
Every BLOCKED entry, and every rule you could not follow, with the reason.
Decisions I may want to change. At least: returns that break a deal, credit sales earning points, the negative balance, the point value and the earn rate defaults.
What you could not verify, and what I should test by hand.
