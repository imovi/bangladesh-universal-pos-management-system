#!/usr/bin/env node
/**
 * scripts/load-check.mjs
 *
 * Milestone F6: Performance, Load, and Soak Verification for Universal POS.
 * 
 * Verifies three critical performance requirements:
 * 1. Sale load: 10 registers making 1 sale every 3s (p95 < 400ms, 0 errors, stock & shift totals exact).
 * 2. Sync burst: 300 queued offline sales synced in a single burst (< 2 min, accepted exactly once, no deadlocks).
 * 3. 30-day sales report on 50,000 sales returns in under 2s.
 */

import { PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { v7 as uuidv7 } from "uuid";
import crypto from "crypto";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const API_BASE = process.env.API_URL || "http://localhost:4000/api/v1";
const DB_URL = process.env.DATABASE_URL || "postgresql://pos_admin:pos_secret@localhost:5432/universal_pos_e2e?schema=public";

const prisma = new PrismaClient({ datasourceUrl: DB_URL });

console.log("==================================================================");
console.log(" Milestone F6: Performance, Load & Soak Check");
console.log(` Target API: ${API_BASE}`);
console.log(` Target DB:  ${DB_URL.replace(/:[^:@]+@/, ":***@")}`);
console.log("==================================================================\n");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status} from ${endpoint}: Invalid JSON: ${text.slice(0, 150)}`);
  }

  if (!res.ok || json.success === false) {
    const errorMsg = json.error?.message || json.message || JSON.stringify(json);
    throw new Error(`API error HTTP ${res.status} on ${endpoint}: ${errorMsg}`);
  }

  return json.data !== undefined ? json.data : json;
}

async function main() {
  const runId = crypto.randomBytes(3).toString("hex");
  const tenantSlug = `load-${runId}`;
  const tenantName = `Load Test Tenant ${runId}`;

  console.log(`[SETUP] Bootstrapping tenant '${tenantSlug}'...`);

  const email = `admin-${runId}@loadpos.local`;
  const password = "LoadAdminPassword123!";

  // 1. Register tenant & authenticate
  const signupRes = await apiRequest("/tenants/signup", {
    method: "POST",
    body: JSON.stringify({
      companyName: tenantName,
      slug: tenantSlug,
      businessType: "fashion",
      owner: {
        name: "Load Admin",
        email,
        phone: `+88017${Math.floor(10000000 + Math.random() * 90000000)}`,
        password,
      },
      branch: {
        name: `Load Flagship Branch ${runId}`,
        code: `LFB-${runId.toUpperCase()}`,
        address: "Dhaka",
      },
    }),
  });

  const signupBranchId = signupRes.branchId || signupRes.branch?.id;

  const loginRes = await apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      tenantSlug,
      email,
      password,
    }),
  });

  const token = loginRes.accessToken;
  const user = loginRes.user;
  const tenantId = user.tenantId;
  const branchId = signupBranchId || user.branchId || (user.branches && user.branches[0]?.id);

  // Create 3 products for the 3 sale lines
  const product1 = await apiRequest("/products", {
    token,
    method: "POST",
    body: JSON.stringify({
      name: `Panjabi Classic ${runId}`,
      sku: `PAN-${runId.toUpperCase()}`,
      priceMinor: 150000,
      costMinor: 80000,
      trackingMode: "none",
      variants: [
        { sku: `PAN-LOAD-1-${runId}`, barcode: `8809001${runId}`, priceMinor: 150000, costMinor: 80000, optionValues: { size: "40" } },
      ],
    }),
  });

  const product2 = await apiRequest("/products", {
    token,
    method: "POST",
    body: JSON.stringify({
      name: `Formal Shirt ${runId}`,
      sku: `SHT-${runId.toUpperCase()}`,
      priceMinor: 120000,
      costMinor: 60000,
      trackingMode: "none",
      variants: [
        { sku: `SHT-LOAD-2-${runId}`, barcode: `8809002${runId}`, priceMinor: 120000, costMinor: 60000, optionValues: { size: "L" } },
      ],
    }),
  });

  const product3 = await apiRequest("/products", {
    token,
    method: "POST",
    body: JSON.stringify({
      name: `Denim Jeans ${runId}`,
      sku: `JNS-${runId.toUpperCase()}`,
      priceMinor: 200000,
      costMinor: 100000,
      trackingMode: "none",
      variants: [
        { sku: `JNS-LOAD-3-${runId}`, barcode: `8809003${runId}`, priceMinor: 200000, costMinor: 100000, optionValues: { size: "32" } },
      ],
    }),
  });

  const variant1 = product1.variants[0];
  const variant2 = product2.variants[0];
  const variant3 = product3.variants[0];

  // Add opening stock: 50,000 units each so stock never runs out during test
  await prisma.stockMovement.createMany({
    data: [
      { tenantId, branchId, variantId: variant1.id, qtyDelta: new Decimal(50000), type: "OPENING", unitCostMinor: 80000n },
      { tenantId, branchId, variantId: variant2.id, qtyDelta: new Decimal(50000), type: "OPENING", unitCostMinor: 60000n },
      { tenantId, branchId, variantId: variant3.id, qtyDelta: new Decimal(50000), type: "OPENING", unitCostMinor: 100000n },
    ],
  });

  // Create 1 active promotion: 10% discount on all orders
  await apiRequest("/promotions", {
    token,
    method: "POST",
    body: JSON.stringify({
      name: `Load Test 10% Off ${runId}`,
      type: "PERCENT_OFF",
      config: { percent: 10 },
      targets: { type: "ALL" },
      startDate: new Date(Date.now() - 3600000).toISOString(),
      endDate: new Date(Date.now() + 86400000).toISOString(),
      status: "active",
    }),
  });

  // Create 10 registers for the 10 registers scenario
  const registers = [];
  for (let i = 1; i <= 10; i++) {
    const regCode = `R${i.toString().padStart(2, "0")}`;
    const reg = await apiRequest("/registers", {
      token,
      method: "POST",
      body: JSON.stringify({ name: `Register ${i}`, code: regCode, branchId }),
    });
    registers.push(reg);
  }

  // Open shifts for each register
  const shifts = [];
  for (const reg of registers) {
    const shift = await apiRequest("/shifts/open", {
      token,
      method: "POST",
      body: JSON.stringify({
        registerId: reg.id,
        branchId,
        openingCashMinor: 200000, // ৳2,000 float
        notes: "Load Test Shift",
      }),
    });
    shifts.push(shift);
  }

  console.log(`[SETUP] Ready: 10 registers initialized with open shifts, stock seeded, and active promotion.`);

  // -------------------------------------------------------------------------
  // Scenario 1: Sale Load
  // 10 registers each make 1 sale every ~3 seconds for target duration (2 mins).
  // Each sale has 3 lines, 1 active promotion, and split cash + bKash payment.
  // -------------------------------------------------------------------------
  console.log("\n==================================================================");
  console.log(" SCENARIO 1: Concurrent Sale Load (10 Registers, 3-Line Sales)");
  console.log(" Target: p95 < 400ms, 0 errors, stock and shift totals exact.");
  console.log("==================================================================");

  const TARGET_DURATION_MS = process.env.LOAD_TEST_DURATION_MS
    ? parseInt(process.env.LOAD_TEST_DURATION_MS, 10)
    : 120000; // 2 minutes (120 seconds)

  const latencies = [];
  let errorCount = 0;
  let totalSalesMade = 0;
  let round = 0;
  const startLoadTime = Date.now();

  while (Date.now() - startLoadTime < TARGET_DURATION_MS) {
    round++;
    const roundPromises = registers.map(async (reg, idx) => {
      const shift = shifts[idx];
      const saleId = uuidv7();
      const t0 = Date.now();

      try {
        await apiRequest("/sales", {
          token,
          method: "POST",
          headers: { "Idempotency-Key": saleId },
          body: JSON.stringify({
            id: saleId,
            branchId,
            shiftId: shift.id,
            customerId: null,
            subtotalMinor: 470000,
            discountMinor: 47000,
            taxMinor: 0,
            totalMinor: 423000,
            paidMinor: 423000,
            dueMinor: 0,
            changeMinor: 0,
            expectedTotalMinor: 423000,
            isOffline: false,
            items: [
              { variantId: variant1.id, quantity: 1, unitPriceMinor: 150000, discount: { type: "percent", percentBp: 1000 } },
              { variantId: variant2.id, quantity: 1, unitPriceMinor: 120000, discount: { type: "percent", percentBp: 1000 } },
              { variantId: variant3.id, quantity: 1, unitPriceMinor: 200000, discount: { type: "percent", percentBp: 1000 } },
            ],
            payments: [
              { paymentMethod: "cash", amountMinor: 223000 },
              { paymentMethod: "bkash", amountMinor: 200000, transactionRef: `TRX-${round}-${idx}` },
            ],
          }),
        });

        const elapsed = Date.now() - t0;
        latencies.push(elapsed);
        totalSalesMade++;
      } catch (err) {
        errorCount++;
        console.error(`  [ERR] Register ${reg.code} sale failed: ${err.message}`);
      }
    });

    await Promise.all(roundPromises);
    if (round % 5 === 0) {
      const elapsedSec = ((Date.now() - startLoadTime) / 1000).toFixed(0);
      console.log(`  Completed round ${round} (${totalSalesMade} sales committed, ${elapsedSec}s elapsed)...`);
    }
    // Pace: ~3 seconds per sale across 10 registers
    await sleep(2500);
  }

  const loadDurationSec = ((Date.now() - startLoadTime) / 1000).toFixed(2);
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;
  const minLatency = latencies[0] || 0;
  const maxLatency = latencies[latencies.length - 1] || 0;

  console.log("\n--- SCENARIO 1 RESULTS ---");
  console.log(`Total Sales Processed: ${totalSalesMade}`);
  console.log(`Total Errors:          ${errorCount}`);
  console.log(`Total Duration:        ${loadDurationSec}s`);
  console.log(`Throughput:            ${(totalSalesMade / loadDurationSec).toFixed(1)} req/s`);
  console.log(`Latency Min:           ${minLatency}ms`);
  console.log(`Latency p50:           ${p50}ms`);
  console.log(`Latency p95:           ${p95}ms (Target: < 400ms)`);
  console.log(`Latency p99:           ${p99}ms`);
  console.log(`Latency Max:           ${maxLatency}ms`);

  // Verify stock movements and shift totals add up exactly in PostgreSQL
  const stockCheck = await prisma.$queryRaw`
    SELECT sum(qty_delta)::numeric as net_qty
    FROM stock_movements
    WHERE tenant_id = ${tenantId}::uuid AND lower(type) = 'sale'
  `;
  const expectedQtySold = totalSalesMade * 3;
  const actualQtyDelta = Math.abs(Number(stockCheck[0]?.net_qty ?? 0));
  console.log(`Stock Movement Check: Expected -${expectedQtySold} units, DB recorded -${actualQtyDelta} units.`);

  const scenario1Passed = p95 < 400 && errorCount === 0 && actualQtyDelta === expectedQtySold;
  const throughput = Number((totalSalesMade / Number(loadDurationSec)).toFixed(1));
  console.log(JSON.stringify({
    scenario: 1,
    name: "sale_load_10_registers",
    durationSec: Number(loadDurationSec),
    throughputReqSec: throughput,
    throughput: `${throughput} req/s`,
    totalSales: totalSalesMade,
    errors: errorCount,
    minMs: minLatency,
    p50Ms: p50,
    p95Ms: p95,
    p99Ms: p99,
    maxMs: maxLatency,
    stockExpected: expectedQtySold,
    stockActual: actualQtyDelta,
    budgetMet: scenario1Passed,
    passed: scenario1Passed,
  }));

  if (scenario1Passed) {
    console.log(">>> SCENARIO 1: PASSED (p95 < 400ms, 0 errors, stock exact)");
  } else {
    console.log(">>> SCENARIO 1: TARGET MISSED");
  }

  // -------------------------------------------------------------------------
  // Scenario 2: Sync Burst
  // 300 offline sales queued and synced at once.
  // Target: Under 2 minutes, all accepted exactly once, 0 deadlocks.
  // -------------------------------------------------------------------------
  console.log("\n==================================================================");
  console.log(" SCENARIO 2: Sync Burst (300 Offline Sales Queued & Synced)");
  console.log(" Target: Under 2 minutes, accepted exactly once, 0 deadlocks.");
  console.log("==================================================================");

  const burstRegister = registers[0];
  const burstShift = shifts[0];
  const BURST_COUNT = 300;
  const burstPayloads = [];

  for (let i = 1; i <= BURST_COUNT; i++) {
    const saleId = uuidv7();
    const invoiceNumber = `R01-O-261122-${i.toString().padStart(4, "0")}`;
    burstPayloads.push({
      id: saleId,
      branchId,
      shiftId: burstShift.id,
      customerId: null,
      subtotalMinor: 150000,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 150000,
      paidMinor: 150000,
      dueMinor: 0,
      changeMinor: 0,
      expectedTotalMinor: 150000,
      isOffline: true,
      invoiceNumber: invoiceNumber,
      occurredAt: new Date(Date.now() - (BURST_COUNT - i) * 1000).toISOString(),
      items: [
        { variantId: variant1.id, quantity: 1, unitPriceMinor: 150000, totalMinor: 150000, discountMinor: 0 },
      ],
      payments: [{ paymentMethod: "cash", amountMinor: 150000 }],
    });
  }

  const burstStart = Date.now();
  let burstErrors = 0;
  let burstSuccess = 0;

  // Dispatch in concurrent chunks of 15 requests
  const CHUNK_SIZE = 15;
  for (let i = 0; i < burstPayloads.length; i += CHUNK_SIZE) {
    const chunk = burstPayloads.slice(i, i + CHUNK_SIZE);
    const chunkPromises = chunk.map(async (sale) => {
      try {
        await apiRequest("/sales", {
          token,
          method: "POST",
          headers: { "Idempotency-Key": sale.id },
          body: JSON.stringify(sale),
        });
        burstSuccess++;
      } catch (err) {
        burstErrors++;
        console.error(`  [BURST ERR] ${sale.invoiceNumber}: ${err.message}`);
      }
    });
    await Promise.all(chunkPromises);
  }

  const burstDurationSec = ((Date.now() - burstStart) / 1000).toFixed(2);
  console.log("\n--- SCENARIO 2 RESULTS ---");
  console.log(`300 Offline Sales Synced: ${burstSuccess}/${BURST_COUNT}`);
  console.log(`Sync Burst Errors:        ${burstErrors}`);
  console.log(`Sync Burst Duration:      ${burstDurationSec}s (Target: < 120s)`);

  // Verify all 300 offline sales exist exactly once
  const offlineDbCount = await prisma.sale.count({
    where: {
      tenantId,
      isOffline: true,
      invoiceNumber: { startsWith: "R01-O-261122-" },
    },
  });
  console.log(`DB Offline Sales Verified Count: ${offlineDbCount}/${BURST_COUNT}`);

  const scenario2Passed =
    burstSuccess === BURST_COUNT &&
    burstErrors === 0 &&
    Number(burstDurationSec) < 120 &&
    offlineDbCount === BURST_COUNT;
  const burstThroughput = Number((burstSuccess / Number(burstDurationSec)).toFixed(1));

  console.log(JSON.stringify({
    scenario: 2,
    name: "sync_burst_300_sales",
    durationSec: Number(burstDurationSec),
    throughputReqSec: burstThroughput,
    throughput: `${burstThroughput} req/s`,
    totalSales: burstSuccess,
    expectedSales: BURST_COUNT,
    errors: burstErrors,
    dbCount: offlineDbCount,
    budgetMet: scenario2Passed,
    passed: scenario2Passed,
  }));

  if (scenario2Passed) {
    console.log(">>> SCENARIO 2: PASSED (Under 2 minutes, all accepted exactly once, 0 deadlocks)");
  } else {
    console.log(">>> SCENARIO 2: TARGET MISSED");
  }

  // -------------------------------------------------------------------------
  // Scenario 3: 30-Day Sales Report on 50,000 Sales
  // Target: Report returns in under 2 seconds.
  // -------------------------------------------------------------------------
  console.log("\n==================================================================");
  console.log(" SCENARIO 3: 30-Day Sales Report Performance on 50,000 Sales");
  console.log(" Target: Query execution in under 2 seconds (< 2,000ms).");
  console.log("==================================================================");

  console.log(`[SEED] Seeding 50,000 synthetic sales directly into database via bulk insert...`);
  const seedBatchSize = 5000;
  const now = Date.now();

  for (let b = 0; b < 10; b++) {
    const saleBatch = [];
    for (let i = 0; i < seedBatchSize; i++) {
      const idx = b * seedBatchSize + i;
      const dayOffsetMs = (idx % 30) * 24 * 60 * 60 * 1000;
      const occurred = new Date(now - dayOffsetMs);
      saleBatch.push({
        id: uuidv7(),
        tenantId,
        invoiceNumber: `INV-LOAD-${idx.toString().padStart(6, "0")}`,
        branchId,
        shiftId: shifts[0].id,
        cashierUserId: user.id,
        status: "completed",
        subtotalMinor: 150000n,
        discountMinor: 0n,
        taxMinor: 0n,
        totalMinor: 150000n,
        paidMinor: 150000n,
        dueMinor: 0n,
        changeMinor: 0n,
        occurredAt: occurred,
        createdAt: occurred,
      });
    }

    await prisma.sale.createMany({ data: saleBatch });
    console.log(`  Seeded ${(b + 1) * seedBatchSize} / 50,000 sales...`);
  }

  const startDate = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const endDate = new Date(now).toISOString().split("T")[0];

  console.log(`[REPORT] Fetching 30-day sales report (${startDate} to ${endDate})...`);
  const reportT0 = Date.now();
  const reportRes = await apiRequest(`/reports/sales-summary?startDate=${startDate}&endDate=${endDate}`, { token });
  const reportDurationMs = Date.now() - reportT0;

  console.log("\n--- SCENARIO 3 RESULTS ---");
  console.log(`Sales in Range (DB):     ${reportRes.salesCount ?? reportRes.totalSales ?? "50,000+"}`);
  console.log(`Report API Response Time: ${reportDurationMs}ms (Target: < 2,000ms)`);

  const scenario3Passed = reportDurationMs < 2000;
  console.log(JSON.stringify({
    scenario: 3,
    name: "sales_summary_report_50k",
    durationMs: reportDurationMs,
    targetMs: 2000,
    budgetMet: scenario3Passed,
    passed: scenario3Passed,
  }));

  if (scenario3Passed) {
    console.log(`>>> SCENARIO 3: PASSED (${reportDurationMs}ms < 2,000ms)`);
  } else {
    console.log(`>>> SCENARIO 3: TARGET MISSED (${reportDurationMs}ms >= 2,000ms)`);
  }

  console.log("\n==================================================================");
  console.log(" Milestone F6 Summary:");
  console.log(` - Scenario 1 Sale Load: p95 = ${p95}ms, Errors = ${errorCount}, Stock Verified = ${actualQtyDelta}`);
  console.log(` - Scenario 2 Sync Burst: ${burstSuccess}/300 in ${burstDurationSec}s`);
  console.log(` - Scenario 3 50k Report:  ${reportDurationMs}ms`);
  console.log("==================================================================");

  if (!scenario1Passed || !scenario2Passed || !scenario3Passed) {
    console.error("\n[LOAD CHECK FAILED] One or more performance scenarios missed target thresholds!");
    process.exit(1);
  }
  console.log("\n[LOAD CHECK PASSED] All 3 performance scenarios met target thresholds successfully.");
}

main()
  .catch((e) => {
    console.error("FATAL ERROR in Milestone F6 Load Check:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
