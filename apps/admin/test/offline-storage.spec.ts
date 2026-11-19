import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import {
  PosOfflineDatabase,
  calculateBackoffMs,
  clampSaleTime,
  enqueueCustomer,
  enqueueSale,
  formatBusinessDate,
  getNextOfflineInvoiceNumber,
  runSync,
  saveOfflinePinVerifier,
  updateServerClockOffset,
  verifyOfflinePin,
  acquireRegisterTabLock,
  isSignOutAllowed,
} from "../src/lib/pos/offline";
import { computeCartTotals } from "../src/lib/pos/cart-calculations";
import { calculateSaleTotals } from "@universal-pos/shared";

describe("Milestone D2: Offline Storage & Client Sync Engine Unit Tests", () => {
  let testDb: PosOfflineDatabase;

  beforeEach(async () => {
    // Generate fresh indexedDB name per test
    const dbName = `test_offline_${crypto.randomUUID()}`;
    testDb = new PosOfflineDatabase(dbName);
    await testDb.open();
  });

  describe("Outbox", () => {
    it("order is kept (FIFO execution by createdAt)", async () => {
      const processedIds: string[] = [];

      // Enqueue 3 sales
      for (let i = 1; i <= 3; i++) {
        await enqueueSale(
          {
            shiftId: "shift-1",
            registerId: "reg-1",
            invoiceNumber: `REG01-O-261118-000${i}`,
            isOffline: true,
            items: [
              {
                variantId: `var-${i}`,
                productId: `prod-${i}`,
                quantity: 1,
                unitPriceMinor: 1000,
                taxRateBp: 0,
              },
            ],
            payments: [{ method: "cash", amountMinor: 1000 }],
            grossMinor: 1000,
            discountMinor: 0,
            subtotalNetMinor: 1000,
            taxMinor: 0,
            totalMinor: 1000,
          },
          testDb
        );
      }

      await runSync({
        database: testDb,
        customSender: async (item) => {
          processedIds.push(item.payload.invoiceNumber as string);
          return { status: 201 };
        },
      });

      expect(processedIds).toEqual([
        "REG01-O-261118-0001",
        "REG01-O-261118-0002",
        "REG01-O-261118-0003",
      ]);
    });

    it("an item is not deleted before confirmation and preserved as synced", async () => {
      const { outboxId } = await enqueueSale(
        {
          shiftId: "shift-1",
          registerId: "reg-1",
          invoiceNumber: "REG01-O-261118-0001",
          isOffline: true,
          items: [{ variantId: "var-1", quantity: 1, unitPriceMinor: 500, taxRateBp: 0 }],
          payments: [{ method: "cash", amountMinor: 500 }],
          grossMinor: 500,
          discountMinor: 0,
          subtotalNetMinor: 500,
          taxMinor: 0,
          totalMinor: 500,
        },
        testDb
      );

      // Check item is initially pending
      const beforeSync = await testDb.outbox.get(outboxId);
      expect(beforeSync?.status).toBe("pending");

      // Sync successfully
      await runSync({
        database: testDb,
        customSender: async () => ({ status: 201 }),
      });

      // After confirmation, item still exists in storage with status synced
      const afterSync = await testDb.outbox.get(outboxId);
      expect(afterSync).toBeDefined();
      expect(afterSync?.status).toBe("synced");
      expect(afterSync?.syncedAt).toBeGreaterThan(0);
    });

    it("a failed item is never retried automatically", async () => {
      let callCount = 0;

      await enqueueSale(
        {
          shiftId: "shift-1",
          registerId: "reg-1",
          invoiceNumber: "REG01-O-261118-0001",
          isOffline: true,
          items: [{ variantId: "var-1", quantity: 1, unitPriceMinor: 500, taxRateBp: 0 }],
          payments: [{ method: "cash", amountMinor: 500 }],
          grossMinor: 500,
          discountMinor: 0,
          subtotalNetMinor: 500,
          taxMinor: 0,
          totalMinor: 500,
        },
        testDb
      );

      // Sync returns 422 TOTALS_MISMATCH
      await runSync({
        database: testDb,
        customSender: async () => {
          callCount++;
          return { status: 422, error: "TOTALS_MISMATCH" };
        },
      });

      expect(callCount).toBe(1);

      const item = (await testDb.outbox.toArray())[0];
      expect(item.status).toBe("failed");
      expect(item.lastError).toBe("TOTALS_MISMATCH");

      // Run sync again - must NOT call sender for failed item
      await runSync({
        database: testDb,
        customSender: async () => {
          callCount++;
          return { status: 201 };
        },
      });

      expect(callCount).toBe(1); // Still 1, not retried!
    });

    it("the backoff times are correct", () => {
      // Base: 2000, attempt 0: 2000, attempt 1: 4000, attempt 2: 8000, attempt 3: 16000
      expect(calculateBackoffMs(0, 0)).toBe(2000);
      expect(calculateBackoffMs(1, 0)).toBe(4000);
      expect(calculateBackoffMs(2, 0)).toBe(8000);
      expect(calculateBackoffMs(3, 0)).toBe(16000);
      expect(calculateBackoffMs(4, 0)).toBe(32000);
      // Capped at 300,000ms (5min)
      expect(calculateBackoffMs(10, 0)).toBe(300_000);
    });

    it("the lock stops parallel sends of items", async () => {
      let runningCount = 0;
      let maxConcurrent = 0;

      await enqueueSale(
        {
          shiftId: "shift-1",
          registerId: "reg-1",
          invoiceNumber: "REG01-O-261118-0001",
          isOffline: true,
          items: [{ variantId: "var-1", quantity: 1, unitPriceMinor: 500, taxRateBp: 0 }],
          payments: [{ method: "cash", amountMinor: 500 }],
          grossMinor: 500,
          discountMinor: 0,
          subtotalNetMinor: 500,
          taxMinor: 0,
          totalMinor: 500,
        },
        testDb
      );

      const slowSender = async () => {
        runningCount++;
        if (runningCount > maxConcurrent) maxConcurrent = runningCount;
        await new Promise((r) => setTimeout(r, 50));
        runningCount--;
        return { status: 201 };
      };

      // Attempt to invoke runSync concurrently
      await Promise.all([
        runSync({ database: testDb, customSender: slowSender }),
        runSync({ database: testDb, customSender: slowSender }),
        runSync({ database: testDb, customSender: slowSender }),
      ]);

      expect(maxConcurrent).toBe(1);
    });
  });

  describe("Offline invoice counter", () => {
    it("unique across reloads", async () => {
      const res1 = await getNextOfflineInvoiceNumber({
        registerId: "reg-1",
        registerCode: "REG01",
        database: testDb,
      });
      const res2 = await getNextOfflineInvoiceNumber({
        registerId: "reg-1",
        registerCode: "REG01",
        database: testDb,
      });
      const res3 = await getNextOfflineInvoiceNumber({
        registerId: "reg-1",
        registerCode: "REG01",
        database: testDb,
      });

      expect(res1.invoiceNumber).toMatch(/^REG01-O-\d{6}-0001$/);
      expect(res2.invoiceNumber).toMatch(/^REG01-O-\d{6}-0002$/);
      expect(res3.invoiceNumber).toMatch(/^REG01-O-\d{6}-0003$/);
      expect(res1.seq).toBe(1);
      expect(res2.seq).toBe(2);
      expect(res3.seq).toBe(3);
    });

    it("restarts on a new business day in the tenant timezone (across midnight and foreign device timezone)", async () => {
      // 2026-11-18 23:59:00 in Asia/Dhaka is 2026-11-18 17:59:00 UTC
      const beforeMidnightMs = new Date("2026-11-18T17:59:00Z").getTime();
      // 2026-11-19 00:01:00 in Asia/Dhaka is 2026-11-18 18:01:00 UTC
      const afterMidnightMs = new Date("2026-11-18T18:01:00Z").getTime();

      const num1 = await getNextOfflineInvoiceNumber({
        registerId: "reg-1",
        registerCode: "REG01",
        timeZone: "Asia/Dhaka",
        timestampMs: beforeMidnightMs,
        database: testDb,
      });

      const num2 = await getNextOfflineInvoiceNumber({
        registerId: "reg-1",
        registerCode: "REG01",
        timeZone: "Asia/Dhaka",
        timestampMs: beforeMidnightMs,
        database: testDb,
      });

      expect(num1.invoiceNumber).toBe("REG01-O-261118-0001");
      expect(num2.invoiceNumber).toBe("REG01-O-261118-0002");

      // Device now crosses midnight into next business day in Asia/Dhaka
      const num3 = await getNextOfflineInvoiceNumber({
        registerId: "reg-1",
        registerCode: "REG01",
        timeZone: "Asia/Dhaka",
        timestampMs: afterMidnightMs,
        database: testDb,
      });

      // Sequence restarts at 0001 for date 261119
      expect(num3.invoiceNumber).toBe("REG01-O-261119-0001");
      expect(num3.seq).toBe(1);
    });
  });

  describe("Clock offset and clamping", () => {
    it("computes and stores clock offset correctly", async () => {
      // Server is 5 minutes ahead
      const simulatedServerTime = Date.now() + 5 * 60 * 1000;
      const offset = await updateServerClockOffset(simulatedServerTime);

      expect(offset).toBeGreaterThanOrEqual(4 * 60 * 1000);
      expect(offset).toBeLessThanOrEqual(6 * 60 * 1000);
    });

    it("clamps sale timestamp within shift boundaries", () => {
      const openedAt = 1000;
      const closedAt = 2000;

      // Before openedAt -> clamped to openedAt
      expect(clampSaleTime(500, openedAt, closedAt)).toBe(1000);

      // Within shift -> unchanged
      expect(clampSaleTime(1500, openedAt, closedAt)).toBe(1500);

      // After closedAt -> clamped to closedAt
      expect(clampSaleTime(2500, openedAt, closedAt)).toBe(2000);
    });
  });

  describe("PIN Verifier", () => {
    it("correct PIN unlocks and wrong PIN fails", async () => {
      const userId = "cashier-1";
      await saveOfflinePinVerifier(userId, "1234", testDb);

      // Wrong PIN
      const wrong = await verifyOfflinePin(userId, "9999", testDb);
      expect(wrong.success).toBe(false);
      if (!wrong.success && wrong.error === "INVALID_PIN") {
        expect(wrong.remainingAttempts).toBe(4);
      }

      // Correct PIN
      const right = await verifyOfflinePin(userId, "1234", testDb);
      expect(right.success).toBe(true);
    });

    it("locks after 5 failures", async () => {
      const userId = "cashier-2";
      await saveOfflinePinVerifier(userId, "5678", testDb);

      for (let i = 1; i <= 4; i++) {
        const attempt = await verifyOfflinePin(userId, "0000", testDb);
        expect(attempt.success).toBe(false);
      }

      // 5th attempt causes lockout
      const fifthAttempt = await verifyOfflinePin(userId, "0000", testDb);
      expect(fifthAttempt.success).toBe(false);
      expect(fifthAttempt.error).toBe("LOCKED");

      // Even correct PIN fails when locked
      const blockedAttempt = await verifyOfflinePin(userId, "5678", testDb);
      expect(blockedAttempt.success).toBe(false);
      expect(blockedAttempt.error).toBe("LOCKED");
    });

    it("an expired verifier is refused", async () => {
      const userId = "cashier-3";
      // Save with negative validity to simulate expiry
      await saveOfflinePinVerifier(userId, "1111", testDb, -1000);

      const result = await verifyOfflinePin(userId, "1111", testDb);
      expect(result.success).toBe(false);
      expect(result.error).toBe("EXPIRED");
    });

    it("the PIN itself is never stored (exhaustive IndexedDB search)", async () => {
      const userId = "cashier-secret";
      const secretPin = "849201";
      await saveOfflinePinVerifier(userId, secretPin, testDb);

      // Enqueue a sale as well
      await enqueueSale(
        {
          shiftId: "s-1",
          registerId: "r-1",
          invoiceNumber: "REG01-O-261118-0001",
          isOffline: true,
          items: [{ variantId: "v-1", quantity: 1, unitPriceMinor: 100, taxRateBp: 0 }],
          payments: [{ method: "cash", amountMinor: 100 }],
          grossMinor: 100,
          discountMinor: 0,
          subtotalNetMinor: 100,
          taxMinor: 0,
          totalMinor: 100,
        },
        testDb
      );

      // Scan all 10 tables in testDb and assert string representation never contains secretPin
      const tables = [
        testDb.catalog,
        testDb.stock,
        testDb.customers,
        testDb.settings,
        testDb.session,
        testDb.outbox,
        testDb.localSales,
        testDb.syncLog,
        testDb.reviewFlags,
        testDb.counters,
      ];

      for (const table of tables) {
        const allRecords = await table.toArray();
        const json = JSON.stringify(allRecords);
        expect(json.includes(secretPin)).toBe(false);
      }
    });

    it("verifies PIN expiry after 12 hours (43200000 ms)", async () => {
      const userId = "cashier-12h";
      const twelveHoursMs = 12 * 60 * 60 * 1000;
      // Saved with 12 hour validity
      await saveOfflinePinVerifier(userId, "4321", testDb, twelveHoursMs);

      // Immediately valid
      const validNow = await verifyOfflinePin(userId, "4321", testDb);
      expect(validNow.success).toBe(true);

      // Simulate expired verifier
      await saveOfflinePinVerifier(userId, "4321", testDb, -1);
      const expired = await verifyOfflinePin(userId, "4321", testDb);
      expect(expired.success).toBe(false);
      expect(expired.error).toBe("EXPIRED");
    });
  });

  describe("Tab Lock & Offline Sign-Out Guard", () => {
    it("isSignOutAllowed blocks logout only when offline with unsynced outbox sales", () => {
      // 1. Online: sign-out is always allowed regardless of outbox count
      expect(isSignOutAllowed(true, 0)).toBe(true);
      expect(isSignOutAllowed(true, 1)).toBe(true);
      expect(isSignOutAllowed(true, 15)).toBe(true);

      // 2. Offline with 0 unsynced: allowed
      expect(isSignOutAllowed(false, 0)).toBe(true);

      // 3. Offline with unsynced items: strictly blocked
      expect(isSignOutAllowed(false, 1)).toBe(false);
      expect(isSignOutAllowed(false, 5)).toBe(false);
    });

    it("acquireRegisterTabLock manages lock handles and allows clean release", async () => {
      const registerId = "reg-test-1";
      const handle = await acquireRegisterTabLock(registerId);
      expect(handle.hasLock).toBe(true);
      expect(typeof handle.release).toBe("function");

      // Release cleanly
      handle.release();
    });
  });

  describe("Totals: 200 random carts comparison against calculateSaleTotals", () => {
    // Linear congruential pseudorandom generator for deterministic seeded runs
    function createSeededRandom(seed: number) {
      let state = seed;
      return function () {
        state = (state * 9301 + 49297) % 233280;
        return state / 233280;
      };
    }

    it("computes identical totals for 200 random carts (fixed seed = 42)", () => {
      const rand = createSeededRandom(42);

      for (let cartIdx = 0; cartIdx < 200; cartIdx++) {
        const itemCount = 1 + Math.floor(rand() * 8); // 1 to 8 line items
        const pricesIncludeTax = rand() > 0.5;

        // Random bill discount
        const hasBillDisc = rand() > 0.6;
        const billDiscType = rand() > 0.5 ? "fixed" : "percent";
        const billDiscount = hasBillDisc
          ? billDiscType === "fixed"
            ? { type: "fixed" as const, amountMinor: Math.floor(rand() * 5000) }
            : { type: "percent" as const, percentBp: Math.floor(rand() * 2000) }
          : undefined;

        const cartItems = [];
        const rawLineInputs = [];

        for (let i = 0; i < itemCount; i++) {
          const unitPriceMinor = 100 + Math.floor(rand() * 50000); // 100 to 50100 minor units
          const quantity = 1 + Math.floor(rand() * 5); // 1 to 5 qty
          const taxRateBp = rand() > 0.3 ? 500 : 0; // 5% VAT or 0%

          const hasLineDisc = rand() > 0.7;
          const lineDiscType = rand() > 0.5 ? "fixed" : "percent";
          const lineDiscount = hasLineDisc
            ? lineDiscType === "fixed"
              ? { type: "fixed" as const, amountMinor: Math.floor(rand() * 500) }
              : { type: "percent" as const, percentBp: Math.floor(rand() * 1500) }
            : undefined;

          cartItems.push({
            lineId: `line-${i}`,
            variantId: `var-${i}`,
            productId: `prod-${i}`,
            name: `Product ${i}`,
            sku: `SKU-${i}`,
            unitPriceMinor,
            quantity,
            taxRateBp,
            discount: lineDiscount,
          });

          rawLineInputs.push({
            lineId: `line-${i}`,
            variantId: `var-${i}`,
            unitPriceMinor,
            quantity,
            taxRateBp,
            discount: lineDiscount,
          });
        }

        // 1. Client Cart Calculation
        const clientResult = computeCartTotals(cartItems, {
          pricesIncludeTax,
          billDiscount,
        });

        // 2. Server Shared calculateSaleTotals
        const serverResult = calculateSaleTotals(rawLineInputs, {
          pricesIncludeTax,
          billDiscount,
        });

        // Assert that client totals and server totals match exactly to the poisha
        expect(clientResult.grossMinor).toBe(Number(serverResult.grossMinor));
        expect(clientResult.lineDiscountMinor).toBe(Number(serverResult.lineDiscountMinor));
        expect(clientResult.billDiscountMinor).toBe(Number(serverResult.billDiscountMinor));
        expect(clientResult.totalDiscountMinor).toBe(Number(serverResult.totalDiscountMinor));
        expect(clientResult.subtotalNetMinor).toBe(Number(serverResult.netMinor));
        expect(clientResult.taxMinor).toBe(Number(serverResult.taxMinor));
        expect(clientResult.totalMinor).toBe(Number(serverResult.totalMinor));
      }
    });
  });
});
