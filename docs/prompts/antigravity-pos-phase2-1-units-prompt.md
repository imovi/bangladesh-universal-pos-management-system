Prompt for Antigravity — Phase 2.1: units and unit conversion (module units)
Copy everything below the line into Antigravity.

0. Before you start
Review accepted Phase 2.0. CI for 04eb7a9 (run 45892387422) and 74a1bf2 (run 45948824755) is green, with 162 passed. Review found three things to fix. Do them first, in section 0.1, before any unit work.

This phase uses what Phase 2.0 built:

@RequireModule in apps/api/src/common/decorators/require-module.decorator.ts;
ModuleGuard in apps/api/src/common/guards/module.guard.ts;
the MODULE_DISABLED code;
useModules() in apps/admin/src/lib/auth-context.tsx;
the module field on sidebar items;
the chemical-demo seed tenant.
ModuleGuard is not used by any real endpoint yet. Every controller in this phase that uses @RequireModule must add it after the auth guard: @UseGuards(JwtAuthGuard, PermissionsGuard, ModuleGuard). Check that TenantContextService is available in that Nest module.

0.1 Phase 2.0 review fixes
Commit these as their own commit(s) before section 2, and check CI on them.

A module whose dependency is not active must not be active.
Today the owner cannot turn off units while pharmacy_catalog is on. But when the platform admin sets units to not allowed, pharmacy_catalog still counts as active, though it needs units.
Fix it in one place. Add getActiveModules(flags): ModuleKey[] to packages/shared/src/modules.ts. A module is active only when it is allowed, enabled, and every module in its dependsOn is active, checked the whole way down the chain.
Use this one function everywhere "active" is worked out:
ModuleGuard;
GET /auth/me in auth.service.ts;
GET /settings/pos in settings.controller.ts;
the active field of GET /modules and of PATCH /modules/:key in modules.service.ts;
the dependency checks in modules.service.ts;
the platform tenants list.
Make isModuleActive use it too, or remove isModuleActive if nothing needs it any more.
Do not change the enabled value when the platform blocks a dependency. When the platform allows units again, pharmacy_catalog is active again by itself.
The owner's module page shows such a module as নির্ভরশীল মডিউল বন্ধ with the name of the missing module, not as active.
Tests:
a shared unit test for a 3-level chain: prescription → pharmacy_catalog → units;
an API test: all of them active, the platform sets units to not allowed, then GET /modules, GET /auth/me and the guard all treat pharmacy_catalog and prescription as inactive, while their enabled value stays true.
The offline POS must read the module list it saves.
apps/admin/src/app/pos/page.tsx around line 583 saves activeModules to db.settings, and hides any error with .catch(() => {}). Nothing ever reads it.
Fix:
When /settings/pos cannot be reached, the POS reads activeModules from db.settings and uses it.
If both fail, the POS uses an empty list, so no module feature shows.
A failed save is written to the console with console.error, not hidden.
Add a usePosModules() hook, or extend useModules(), so the POS uses the saved list when offline. Section 5 of this phase needs it for the unit select.
Add a unit test with the network off and a saved list.
Platform module update with a bad tenant id returns 500.
In PATCH /platform/tenants/:tenantId/modules/:key:
check tenantId with z.string().uuid() and return 400 when it is not a UUID;
return 404 with code TENANT_NOT_FOUND when no tenant has that id.
Add an API test for both.
Small fix, platform login timing. When the email is unknown, platform.service.ts returns before running argon2.verify. So an unknown email answers faster than a wrong password, and that shows which emails exist. Run argon2.verify against a fixed dummy hash in that case too, so both paths take about the same time. Keep the same error message.
Missing proof from Phase 2.0. Under a heading ### Phase 2.0 proof (added later) in the log, paste:
the whole API test suite summary, not only modules.spec.ts;
one full local E2E run with retries: 0;
the output of git grep -n "PLATFORM_JWT_SECRET" -- . ":!*.md", with one line saying that every value in it is a test value, a placeholder or a variable reference.
This is Phase 2.1. It is about 6 to 7 hours of work. Do it unattended, top to bottom. Do not stop to ask. If something is unclear, choose the safer option, write down why in the log, and go on.

Save this text as docs/prompts/antigravity-pos-phase2-1-units-prompt.md in your first commit. Log the work under a new heading ## Phase 2.1: units at the end of docs/overnight-log.md. Add a table ## Phase 2.1 to docs/overnight-report.md with one row per commit.

All rules still apply:

CI results only from scripts/ci-status.cjs output, or from the public jobs and annotations API, pasted as they are;
each CI line in the form - CI: `<sha>` → run `<id>` → <status> <conclusion>;
never skip, add retries, fixme, or a longer blind timeout;
every number and output block must be copied from real command output;
wait about 12 minutes after a push, then check at most once every 5 minutes;
never delete or rewrite earlier lines in docs/overnight-log.md. Only add new lines at the end;
add files by name. Never use git add . or git add -A. Restore docs/screenshots with git restore docs/screenshots before each commit;
never write a real secret into any file;
shift cleanup in E2E uses only closeAllOpenShifts(request), never inside try/catch;
new migrations only. Never edit an old migration.
Why this phase
A chemical shop buys hydrochloric acid in 200 liter drums and sells it by the liter, by the 5 liter can, or by the whole drum. Caustic soda comes in 25 kg bags and sells by the kg, including 2.5 kg. A pharmacy (later) buys boxes and sells strips and tablets. Today the POS only knows "1 piece".

This phase adds units, for tenants whose units module is active. For every other tenant nothing changes. Every existing product gets base unit pcs and factor 1, and the fashion tenant must look and work exactly as before.

1. The rules (read before you code)
Stock is always kept in the product's base unit. stock_levels.qty, stock_movements.qty_delta, transfers, adjustments and opening stock all stay in the base unit, as now.
A sale or purchase line is kept in the unit the customer or supplier saw. The price and quantity on the line are per that unit, so the money math stays exact. For example, 2 drum × ৳18,000 is stored as quantity 2 at ৳18,000. It is not stored as 400 liters at ৳45, because a per-liter price can need fractions of a poisha.
Each such line also keeps its unit snapshot and its base quantity: unitName, unitFactor (base units per one of this unit) and baseQuantity = quantity × factor. Stock, reports and returns use baseQuantity.
Existing rows: a migration sets unitName = 'pcs', unitFactor = 1 and baseQuantity = quantity for every existing sale item, purchase order item and goods receipt item. Check the counts before and after, and paste them.
Quantities keep 3 decimals, like the existing Decimal(14, 3) columns and parseQuantityThousandths in packages/shared/src/money.ts. baseQuantity is rounded to 3 decimals, half up. Write down this rule in docs/units.md.
The server never trusts a factor or price sent by the client. It loads the unit from the database. This is the same rule the existing server-side pricing follows (apps/api/test/fix2-server-pricing.spec.ts).
2. Data model
Add one new migration for all of this:

Product:

baseUnit String @default("pcs") @map("base_unit");
allowDecimalQty Boolean @default(false) @map("allow_decimal_qty").
A new model ProductUnit (product_units). It is a packing unit of one product, and applies to all its variants. Fields:

id, tenantId, productId;
name: free text, for example ড্রাম, বস্তা, 5 লিটার ক্যান;
factor Decimal(14, 3): base units in one of this unit, more than 0;
isSaleUnit Boolean @default(true), isPurchaseUnit Boolean @default(true), isActive Boolean @default(true);
sortOrder Int @default(0), createdAt, updatedAt.
Name is unique per product (@@unique([productId, name])). Use the same RLS policy as the other tenant tables.

A new model VariantUnitPrice (variant_unit_prices): tenantId, variantId, productUnitId, priceMinor BigInt, unique on (variantId, productUnitId). This is an optional override. Without it, the price of a unit = the variant's priceMinor × factor, rounded to the nearest poisha. Bulk discounts like a cheaper drum price use the override.

VariantBarcode: add a nullable productUnitId. Scanning that barcode adds one of that unit. A barcode with no unit means the base unit, as now.

SaleItem, PurchaseOrderItem, GoodsReceiptItem: add

nullable productUnitId;
unitName String @default("pcs");
unitFactor Decimal(14, 3) @default(1);
baseQuantity Decimal(14, 3). For goods receipt items, name it baseQtyReceived.
Fill these for old rows as in rule 4, then make baseQuantity not null.

SaleReturnItem: add baseQuantity Decimal(14, 3). Fill it for old rows from the sale item's factor.

A unit used by any sale or purchase line can never be deleted. It can only be set inactive.

Add the base unit list to packages/shared/src/units.ts. Each entry has a code, a Bangla name and an English name:

Code	Bangla	English
pcs	পিস	piece
kg	কেজি	kg
g	গ্রাম	gram
l	লিটার	liter
ml	মিলি	ml
m	মিটার	meter
ft	ফুট	foot
dozen	ডজন	dozen
tablet	ট্যাবলেট	tablet
capsule	ক্যাপসুল	capsule
Validate baseUnit against this list.

3. API
Every new endpoint and every new field uses @RequireModule("units"). When the module is not active:

a create or update request that sends any unit field other than the default (baseUnit not pcs, allowDecimalQty true, any productUnitId, any unit list) returns 403 MODULE_DISABLED;
reads still return the fields, with their default values;
a sale line with a decimal quantity for a product with allowDecimalQty = false returns 400, as it should today.
Catalog:
CreateProductSchema and UpdateProductSchema get baseUnit and allowDecimalQty.
New endpoints to list, create, update and deactivate the ProductUnit rows of a product, and to set or clear a VariantUnitPrice.
Changing baseUnit is allowed only while the product has no stock movement and no sale. Otherwise return 409 with a Bangla message.
Changing a unit's factor is allowed only while no sale or purchase line uses it. Otherwise return 409 and tell the user to make a new unit. Old lines keep their snapshot either way.
Barcodes: creating a barcode can take an optional productUnitId of the same product.
Sales (online and offline sync), in sales.service.ts:
Each line takes an optional productUnitId.
The server loads the unit, checks that it belongs to the variant's product and is an active sale unit, and takes the price from VariantUnitPrice or base price × factor.
It computes baseQuantity and uses baseQuantity for the stock check, the stock movement and allowNegativeStock.
A decimal quantity is allowed only when allowDecimalQty is true. When it is false, both the quantity and the baseQuantity must be whole numbers.
Add productUnitId to the sale hash in sales-hash.helper.ts, so an offline sale with the same lines in another unit is not seen as a duplicate.
An offline sale whose unit was deactivated or changed before sync is still accepted, with the unit as it is now in the database. Also add a SaleReviewFlag with a clear reason. Do not reject a sale the customer already paid for.
Void, returns and exchanges (sales.service.ts, returns.service.ts, returns-common.helper.ts, exchanges.service.ts):
The returned quantity is in the sale line's unit. The restock uses the returned quantity × the line's stored unitFactor, not the product's current factor.
The check "cannot return more than sold" compares in the line's unit, as now.
Refund money uses the line's unit price, as now.
Purchasing:
Purchase order and goods receipt lines take an optional productUnitId, which must be a purchase unit. The cost on the line is per that unit.
The stock movement uses the base quantity. Its unitCostMinor = line cost ÷ factor, rounded to the nearest poisha. Write this rounding in docs/units.md.
Received quantity checks against the ordered quantity compare in the line's unit.
Transfers, stock adjustments, opening stock: base unit only in this phase. Show the base unit name next to the quantity in their screens.
POS catalog (pos-catalog.service.ts):
Add baseUnit and allowDecimalQty to each product.
Add each product's active sale units with factor and name.
Add each variant's unit prices.
Add the unit of each barcode.
Keep the payload the same as today for tenants without the module: the new arrays are empty, and baseUnit is pcs.
Reports:
Every "quantity sold" figure uses baseQuantity and shows the base unit.
Money totals do not change.
Low stock uses the base unit, as now.
Promotions: packages/shared/src/promotions.ts counts whole units at line 382 for buy-X-get-Y. Keep that count in the line's sale unit, rounded down. Add tests:
a decimal quantity line does not break any promotion type;
a buy-2-get-1 promotion on cans counts cans, not liters.
4. Admin UI
All of this is shown only when units is active (useModules()).

Product form:
a base unit select, with Bangla names;
an "allow decimal quantity" switch;
a "units" table: name, factor, written as "১ ড্রাম = ২০০ লিটার"; sale and purchase checkboxes; active; and the price per variant, with the derived price shown as a placeholder.
Show the 409 errors from section 3 in Bangla.
Barcode screen: choose the unit of a new barcode. The barcode label shows the unit name.
Purchase order and goods receipt forms: a unit select per line. Show "= N base unit" under the quantity.
Stock pages: stock in the base unit. Next to it, also show the biggest active unit, for example ৪৫০ লিটার (২ ড্রাম ৫০ লিটার).
5. POS
Fix the existing allowDecimals in apps/admin/src/app/pos/page.tsx around line 988. It reads product.allowDecimals, which no API ever sends. Read allowDecimalQty from the catalog instead. Keep the step at 0.001 when it is true, and 1 when it is false.
When a product has sale units, each cart line gets a small unit select. Changing the unit changes the price to that unit's price and keeps the quantity number.
Scanning a barcode with a unit adds one of that unit. Scanning the same barcode again adds to that line. The same variant in another unit is a separate line.
The cart, the hold or park list, the receipt preview and the printed receipt show the unit name, for example ২ ড্রাম × ৳১৮,০০০.
Update packages/shared/src/printing.ts, which only knows a number today.
Fashion receipts must print exactly as today, with no pcs text.
The stock check before adding to the cart compares baseQuantity.
Offline:
The offline catalog in apps/admin/src/lib/pos/offline/ stores the new fields.
The outbox sale carries productUnitId, quantity, unitName and unitFactor. The server ignores the client's factor and price, as rule 6 says. The client's values are only for the offline receipt.
Bump the IndexedDB version and migrate the existing stores without losing queued sales. Write a unit test for the upgrade with a queued sale in the old shape.
6. Seed
In the chemical-demo tenant from Phase 2.0, add:

Product	Base unit	Decimal	Base price	Units
হাইড্রোক্লোরিক অ্যাসিড (HCl)	l	yes	৳45 per liter	5 লিটার ক্যান = 5, ড্রাম = 200, with a drum price override of ৳8,500
কস্টিক সোডা	kg	yes	৳120 per kg	বস্তা = 25
ডিস্টিলড ওয়াটার	l	no	৳30 per liter	কার্টন = 12
Each product gets a base barcode, and a barcode for each unit. Give them opening stock in the chemical-demo branch: 1000 l, 500 kg and 240 l.

artisan-apparel stays as it is.

7. Tests
API tests (apps/api/test/units-*.spec.ts):

A sale of 2.5 kg caustic soda: total ৳300, stock -2.5.
A sale of 1 drum HCl: price ৳8,500 (the override), stock -200.
A sale of 2 cans: price 2 × ৳225, stock -10.
Decimal quantity on distilled water: 400.
A sale line with a unit of another product: 400.
Return 1 of 2 drums: restock +200, refund ৳8,500.
Return after the drum factor was blocked from changing: restock still uses the stored factor. Prove the 409 on a factor change.
Goods receipt of 2 drums at ৳8,000 each: stock +400, stock movement unit cost ৳40.
An offline sale with a unit deactivated before sync: accepted, with a review flag.
The sale hash differs for the same variant in two units.
Module off: product create with baseUnit: "kg" returns 403 MODULE_DISABLED; a normal fashion sale works as before.
Migration backfill: old sale items have factor 1 and baseQuantity = quantity.
The promotion tests from section 3.
E2E spec apps/admin/e2e/units-pos-flow.spec.ts, as the chemical-demo owner:

Open a shift. Sell 2.5 kg caustic soda by typing the quantity, scan the drum barcode, and switch an HCl line from liter to can. Check the cart totals and the receipt text. Pay.
Check on the stock page that the stock dropped by the right base quantities.
Return 1 drum from that sale, and check the stock again.
Receive 2 drums with a goods receipt, and check the stock.
Go offline (the same way offline-selling.spec.ts does), sell 1 can, go online, wait for sync, and check that the sale is on the server with unitName can and stock -5.
In afterAll, close shifts with closeAllOpenShifts(request).
The fashion E2E specs must not change, apart from any test that needs a new field in a fixture. If one does, explain it in the log.

8. Docs
Write docs/units.md:

the rules from section 1;
the rounding rules;
how a unit is priced;
what happens to old data;
why a factor cannot change once a unit is used;
that transfers and adjustments are in the base unit for now.
9. Proof
Paste the counts before and after the backfill migration from section 2: sale items, purchase order items, goods receipt items, return items, and how many have factor 1.

Run npx tsc --noEmit in apps/api, apps/admin and packages/shared. Only the known offline-selling.spec.ts error may remain.

Run the API unit tests and paste the summary.

Run the new E2E spec with --repeat-each=5 and retries: 0. It must have 0 failed.

Run the whole E2E suite locally once with retries: 0. Paste the summary. 0 failed.

Print one fashion receipt before and after this phase (an E2E receipt preview or the receipt text test). Paste both, and show they are the same.

Commit in small steps and push. Check every commit with ci-status.cjs on its exact head_sha. The last commit, including a docs-only one, must be green.

For the final commit, paste:

one line per job (test, smoke-prod, load-check);
the Playwright Run Summary annotation.
load-check must still pass with its old budgets. If a scenario gets more than 20% slower than in run 45876518382, say so in the log with both numbers.

Screenshots under docs/screenshots/phase2-1/:

the product form with units;
the POS cart with drum, can and kg lines;
the receipt;
the stock page with ৪৫০ লিটার (২ ড্রাম ৫০ লিটার)-style text.
Commit only those files.

If CI fails, read the annotation, fix the cause and log it. Three failed fix attempts on one test means BLOCKED: log it with the run URLs and the test name, and stop.

Then stop. Do not start Phase 2.2.
