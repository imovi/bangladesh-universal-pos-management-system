Prompt for Antigravity — Phase 1E, mid-run fix (offline promotion sales must never be rejected)
Copy everything below the line into Antigravity.

Stop after your current commit and do this fix before you continue with the next milestone. It takes about 45 to 90 minutes. Then go back to the Phase 1E plan exactly where you left it. All Phase 1E rules still apply: no credentials, CI checked on the exact head_sha, and every hash and run id copied, never typed from memory.

Log it under ### Mid-run fix: offline PROMOTION_CHANGED inside ## Phase 1E in docs/overnight-log.md. Save this text as docs/prompts/antigravity-pos-phase1e-midrun-fix-prompt.md in the same commit.

The bug
This was found by review in apps/api/src/modules/sales/sales.service.ts, around lines 489 to 503 at e641606.

Take an offline sale where expectedTotalMinor differs from the server's evaluatePromotions result. The code then does two things:

It pushes PROMOTION_CHANGED.
It calls computeAndValidateTotals(dto, lineInputs, ...). That function recalculates the sale without any promotion and throws TOTALS_MISMATCH when the client total differs, which it always will, because the client's total included the promotion.
So when an offline sale used a promotion that was then ended, paused, edited or used up before sync, the sale is rejected. The Phase 1E prompt (section 1.7) says such sales are accepted and flagged, never rejected. No test covers PROMOTION_CHANGED. Running grep -rn PROMOTION_CHANGED apps/api/test apps/admin/e2e finds nothing.

The sale already happened in the shop: the customer paid the promoted price and left. The server must record what happened, not what the server would have charged today.

The fix
Send what the till applied. The sale DTO already has per-line promotionId, promotionDiscountMinor and promotionLabel. Add billPromotionId and billPromotionDiscountMinor to the sale DTO in packages/shared/src/schemas/sales.schemas.ts. The offline POS must fill all of these from its own evaluatePromotions result when it queues a sale. Check that the online POS sends them too.

Offline sale whose total differs from today's promotions:

Rebuild the sale from the client's applied values. Treat each line's promotionDiscountMinor as a fixed line discount, applied before any manual line discount. Treat billPromotionDiscountMinor as a fixed bill discount, applied before the manual bill discount.
Run it through the same shared money code (calculateSaleTotals / distributeProportional), not a new formula.
Basic sanity checks, each one a 400 because it means a broken or tampered payload, not a promotion change:
every discount is ≥ 0;
no line's discount is greater than that line's gross;
every promotionId that is set belongs to this tenant. It may now be ended or deleted, and that is fine.
If the rebuilt total equals expectedTotalMinor, then:
accept the sale;
store the client's promotion columns on sale_items and sales;
add PROMOTION_CHANGED with details: the client total, today's server total, and the list of promotion ids that differ.
If the rebuilt total still does not equal expectedTotalMinor, the client's own numbers do not add up. Keep the existing TOTALS_MISMATCH behaviour from Phase 1D for that case only.
Usage counters and reports. A flagged sale still counts toward its promotion's use count and discount total, because the discount really was given. It must not push a coupon or promotion past its limit in a way that blocks other sales. Over-limit use from offline sales is already flagged as COUPON_LIMIT_EXCEEDED (section 1.7). Make sure the two flags can appear on the same sale.

Online sales stay strict. For a non-offline sale, a mismatch is still an error, through the existing price-changed error path, so the till refreshes its promotions and shows the new total. Do not change that.

Returns. A return on a flagged sale refunds the stored line net, as section 1.4 says. Add one assertion for it.

Tests (write them first and watch them fail on the current code)
In apps/api/test/promotions.spec.ts, or in a new promotions-offline.spec.ts:

Ended promotion.
Create a 20% promotion on a ৳2,200 variant.
Build an offline sale of 2 units with expectedTotalMinor = 352000 and the line promo fields set.
End the promotion, then post the sale with isOffline: true.
Expect: 201; total_minor = 352000; the line has promotion_discount_minor = 88000 and its promotion_id; the flag PROMOTION_CHANGED is present; the promotion's discount total went up by ৳880.
Edited promotion. Same as test 1, but change the promotion to 10% instead of ending it. Expect the same result as test 1: the client's 20% is stored, and the flag records today's total.
Lost bill threshold. An offline sale with a bill promotion (10% over ৳5,000, cap ৳1,000), and the promotion paused before sync. The sale is accepted, the bill discount is stored, and the flag is set.
Tampered payload. An offline sale whose line promotionDiscountMinor is greater than the line gross. Expect 400, and nothing is stored.
Inconsistent payload. The client's applied values do not add up to expectedTotalMinor. Expect TOTALS_MISMATCH, as before.
Online stays strict. The same changed promotion with isOffline: false is rejected with the price-changed error.
Return on a flagged sale. Return 1 unit of the sale from test 1. The refund is ৳1,760.
Add one Playwright step to promotions-pos-flow.spec.ts (or to the offline spec):

go offline;
sell with the promotion;
end the promotion through the API;
go online.
The sale must sync, with no item stuck in the outbox, and show the review badge.

Finish
Commit, push, and check CI for that exact head_sha.
Also write the E2 run for e641606 into the log. It is missing right now.
Run node scripts/verify-report-refs.cjs "Phase 1E" on the log section and paste the output.
Then continue with E3.
In the final Phase 1E report, add one line under "Problems found during the run" that names this bug and the commit that fixed it.
