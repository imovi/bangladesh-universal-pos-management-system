import { describe, it, expect } from "vitest";
import {
  evaluatePromotions,
  distributeProportional,
  isPromotionTimeActive,
  earnPoints,
  maxRedeemablePoints,
  reversePoints,
  PromotionRule,
  PromotionEvaluationInput,
  DEFAULT_LOYALTY_SETTINGS,
} from "../src/promotions.js";

describe("Milestone E1: Promotions & Loyalty Engine", () => {
  // -------------------------------------------------------------------------
  // 1. Worked Examples from Prompt Section 1.3
  // -------------------------------------------------------------------------
  describe("1.3 Worked Examples to the poisha", () => {
    it("20% off: 2 Panjabi at ৳2,200 -> discount ৳880, line total ৳3,520", () => {
      const promo: PromotionRule = {
        id: "p-eid-20",
        name: "ঈদ অফার ২০% ছাড়",
        type: "PERCENT_OFF",
        status: "active",
        priority: 1,
        stackableWithBill: true,
        membersOnly: false,
        targetType: "ALL",
        startAt: new Date(Date.now() - 3600000),
        endAt: new Date(Date.now() + 3600000),
        config: {
          percentBp: 2000, // 20.00%
        },
      };

      const result = evaluatePromotions({
        lines: [
          {
            variantId: "v-panjabi",
            productId: "p-panjabi",
            unitPriceMinor: 220000n, // ৳2,200.00
            quantity: "2",
          },
        ],
        promotions: [promo],
      });

      expect(result.grossMinor).toBe(440000n); // ৳4,400.00
      expect(result.linePromotionDiscountMinor).toBe(88000n); // ৳880.00
      expect(result.totalDiscountMinor).toBe(88000n);
      expect(result.netMinor).toBe(352000n); // ৳3,520.00
      expect(result.totalMinor).toBe(352000n);
      expect(result.lines[0].promotionDiscountMinor).toBe(88000n);
      expect(result.lines[0].effectiveLineNetMinor).toBe(352000n);
    });

    it("Buy 2 get 1 free: Panjabi ৳3,000, ৳2,500, ৳2,000 -> discount ৳2,000 spread 800.00, 666.67, 533.33; return ৳3,000 refunds ৳2,200.00", () => {
      const b2g1Promo: PromotionRule = {
        id: "p-b2g1",
        name: "Buy 2 Get 1 Free",
        type: "BUY_X_GET_Y",
        status: "active",
        priority: 1,
        stackableWithBill: true,
        membersOnly: false,
        targetType: "ALL",
        startAt: new Date(Date.now() - 3600000),
        endAt: new Date(Date.now() + 3600000),
        config: {
          buyQty: 2,
          getQty: 1,
          getDiscountPercentBp: 10000, // 100% free
        },
      };

      const result = evaluatePromotions({
        lines: [
          {
            lineId: "line-3000",
            variantId: "v-p3000",
            productId: "prod-panjabi",
            unitPriceMinor: 300000n, // ৳3,000
            quantity: "1",
          },
          {
            lineId: "line-2500",
            variantId: "v-p2500",
            productId: "prod-panjabi",
            unitPriceMinor: 250000n, // ৳2,500
            quantity: "1",
          },
          {
            lineId: "line-2000",
            variantId: "v-p2000",
            productId: "prod-panjabi",
            unitPriceMinor: 200000n, // ৳2,000
            quantity: "1",
          },
        ],
        promotions: [b2g1Promo],
      });

      expect(result.grossMinor).toBe(750000n); // ৳7,500.00
      expect(result.linePromotionDiscountMinor).toBe(200000n); // ৳2,000.00 discount (cheapest unit free)
      expect(result.netMinor).toBe(550000n); // ৳5,500.00

      const line3000 = result.lines.find((l) => l.lineId === "line-3000")!;
      const line2500 = result.lines.find((l) => l.lineId === "line-2500")!;
      const line2000 = result.lines.find((l) => l.lineId === "line-2000")!;

      // Proportional spread 3000 : 2500 : 2000 of ৳2,000:
      // 300000 * 200000 / 750000 = 80000 (৳800.00)
      // 250000 * 200000 / 750000 = 66666.666 -> 66667 (৳666.67)
      // 200000 * 200000 / 750000 = 53333.333 -> 53333 (৳533.33)
      expect(line3000.promotionDiscountMinor).toBe(80000n);
      expect(line2500.promotionDiscountMinor).toBe(66667n);
      expect(line2000.promotionDiscountMinor).toBe(53333n);

      // Line nets:
      expect(line3000.effectiveLineNetMinor).toBe(220000n); // ৳2,200.00
      expect(line2500.effectiveLineNetMinor).toBe(183333n); // ৳1,833.33
      expect(line2000.effectiveLineNetMinor).toBe(146667n); // ৳1,466.67

      // Sum of line nets equals total
      expect(
        line3000.effectiveLineNetMinor +
          line2500.effectiveLineNetMinor +
          line2000.effectiveLineNetMinor,
      ).toBe(550000n);

      // "Returning the ৳3,000 Panjabi alone refunds ৳2,200.00"
      expect(line3000.effectiveLineNetMinor).toBe(220000n);
    });

    it("Bill threshold: 10% off over ৳5,000 (max ৳1,000) -> ৳4,999.99 = 0, ৳12,000 = ৳1,000", () => {
      const billPromo: PromotionRule = {
        id: "p-thresh",
        name: "৳৫,০০০ কিনলে ১০% ছাড়",
        type: "BILL_THRESHOLD",
        status: "active",
        priority: 1,
        stackableWithBill: true,
        membersOnly: false,
        targetType: "ALL",
        startAt: new Date(Date.now() - 3600000),
        endAt: new Date(Date.now() + 3600000),
        config: {
          thresholdMinor: 500000n, // ৳5,000.00
          discountType: "PERCENT",
          percentBp: 1000, // 10.00%
          maxDiscountMinor: 100000n, // Max ৳1,000.00
        },
      };

      // 1. Below threshold: ৳4,999.99 (499999 poisha) -> no discount
      const resBelow = evaluatePromotions({
        lines: [
          {
            variantId: "v-item",
            productId: "p-item",
            unitPriceMinor: 499999n,
            quantity: "1",
          },
        ],
        promotions: [billPromo],
      });
      expect(resBelow.billPromotionDiscountMinor).toBe(0n);
      expect(resBelow.totalDiscountMinor).toBe(0n);
      expect(resBelow.netMinor).toBe(499999n);

      // 2. High amount: ৳12,000 (1200000 poisha) -> 10% = ৳1,200 capped at ৳1,000
      const resAbove = evaluatePromotions({
        lines: [
          {
            variantId: "v-item",
            productId: "p-item",
            unitPriceMinor: 1200000n,
            quantity: "1",
          },
        ],
        promotions: [billPromo],
      });
      expect(resAbove.billPromotionDiscountMinor).toBe(100000n); // ৳1,000.00
      expect(resAbove.totalDiscountMinor).toBe(100000n);
      expect(resAbove.netMinor).toBe(1100000n); // ৳11,000.00
    });
  });

  // -------------------------------------------------------------------------
  // 2. Each Promotion Type Alone at its Edges
  // -------------------------------------------------------------------------
  describe("Promotion types alone at edges", () => {
    it("PERCENT_OFF with cap per line", () => {
      const promo: PromotionRule = {
        id: "p-cap",
        name: "50% off max ৳100",
        type: "PERCENT_OFF",
        status: "active",
        priority: 1,
        stackableWithBill: true,
        membersOnly: false,
        targetType: "ALL",
        startAt: new Date(Date.now() - 3600000),
        endAt: new Date(Date.now() + 3600000),
        config: {
          percentBp: 5000,
          maxDiscountMinor: 10000n, // ৳100 cap
        },
      };

      const res = evaluatePromotions({
        lines: [
          {
            variantId: "v1",
            productId: "p1",
            unitPriceMinor: 50000n, // ৳500 -> 50% = ৳250 -> capped to ৳100
            quantity: "1",
          },
        ],
        promotions: [promo],
      });

      expect(res.linePromotionDiscountMinor).toBe(10000n);
      expect(res.netMinor).toBe(40000n);
    });

    it("AMOUNT_OFF never reduces unit price below zero", () => {
      const promo: PromotionRule = {
        id: "p-amt",
        name: "৳300 off",
        type: "AMOUNT_OFF",
        status: "active",
        priority: 1,
        stackableWithBill: true,
        membersOnly: false,
        targetType: "ALL",
        startAt: new Date(Date.now() - 3600000),
        endAt: new Date(Date.now() + 3600000),
        config: {
          amountMinor: 30000n, // ৳300
        },
      };

      const res = evaluatePromotions({
        lines: [
          {
            variantId: "v1",
            productId: "p1",
            unitPriceMinor: 20000n, // ৳200 (< ৳300)
            quantity: "1",
          },
        ],
        promotions: [promo],
      });

      expect(res.linePromotionDiscountMinor).toBe(20000n); // capped to unit price
      expect(res.netMinor).toBe(0n);
    });

    it("FIXED_PRICE: applies only if fixed price is lower than current price", () => {
      const promo: PromotionRule = {
        id: "p-fp",
        name: "Any Kurti ৳999",
        type: "FIXED_PRICE",
        status: "active",
        priority: 1,
        stackableWithBill: true,
        membersOnly: false,
        targetType: "ALL",
        startAt: new Date(Date.now() - 3600000),
        endAt: new Date(Date.now() + 3600000),
        config: {
          fixedPriceMinor: 99900n, // ৳999
        },
      };

      // 1. Current price ৳1,200 (> ৳999) -> discount ৳201
      const resLower = evaluatePromotions({
        lines: [
          {
            variantId: "v1",
            productId: "p1",
            unitPriceMinor: 120000n,
            quantity: "1",
          },
        ],
        promotions: [promo],
      });
      expect(resLower.linePromotionDiscountMinor).toBe(20100n); // ৳201.00
      expect(resLower.netMinor).toBe(99900n);

      // 2. Current price ৳800 (< ৳999) -> 0 discount
      const resHigher = evaluatePromotions({
        lines: [
          {
            variantId: "v2",
            productId: "p2",
            unitPriceMinor: 80000n,
            quantity: "1",
          },
        ],
        promotions: [promo],
      });
      expect(resHigher.linePromotionDiscountMinor).toBe(0n);
      expect(resHigher.netMinor).toBe(80000n);
    });

    it("BUY_X_GET_Y with 2, 3, 5, 6 units", () => {
      const b2g1: PromotionRule = {
        id: "b2g1",
        name: "Buy 2 Get 1 Free",
        type: "BUY_X_GET_Y",
        status: "active",
        priority: 1,
        stackableWithBill: true,
        membersOnly: false,
        targetType: "ALL",
        startAt: new Date(Date.now() - 3600000),
        endAt: new Date(Date.now() + 3600000),
        config: {
          buyQty: 2,
          getQty: 1,
          getDiscountPercentBp: 10000,
        },
      };

      // 2 units: not enough (needs 3) -> 0 discount
      const res2 = evaluatePromotions({
        lines: [{ variantId: "v", productId: "p", unitPriceMinor: 100000n, quantity: "2" }],
        promotions: [b2g1],
      });
      expect(res2.linePromotionDiscountMinor).toBe(0n);

      // 3 units: exactly 1 free unit
      const res3 = evaluatePromotions({
        lines: [{ variantId: "v", productId: "p", unitPriceMinor: 100000n, quantity: "3" }],
        promotions: [b2g1],
      });
      expect(res3.linePromotionDiscountMinor).toBe(100000n);
      expect(res3.netMinor).toBe(200000n);

      // 5 units: 1 deal (3 units) + 2 leftovers -> 1 free unit
      const res5 = evaluatePromotions({
        lines: [{ variantId: "v", productId: "p", unitPriceMinor: 100000n, quantity: "5" }],
        promotions: [b2g1],
      });
      expect(res5.linePromotionDiscountMinor).toBe(100000n);
      expect(res5.netMinor).toBe(400000n);

      // 6 units: 2 deals -> 2 free units
      const res6 = evaluatePromotions({
        lines: [{ variantId: "v", productId: "p", unitPriceMinor: 100000n, quantity: "6" }],
        promotions: [b2g1],
      });
      expect(res6.linePromotionDiscountMinor).toBe(200000n);
      expect(res6.netMinor).toBe(400000n);
    });

    it("BUNDLE_PRICE with leftovers: 3 for ৳1,500 on 4 units", () => {
      const bundlePromo: PromotionRule = {
        id: "p-bundle",
        name: "3 T-shirts for ৳1,500",
        type: "BUNDLE_PRICE",
        status: "active",
        priority: 1,
        stackableWithBill: true,
        membersOnly: false,
        targetType: "ALL",
        startAt: new Date(Date.now() - 3600000),
        endAt: new Date(Date.now() + 3600000),
        config: {
          bundleQty: 3,
          bundlePriceMinor: 150000n, // ৳1,500.00
        },
      };

      // 4 units: ৳700, ৳600, ৳500, ৳400.
      // Top 3 units (700 + 600 + 500 = 1800) grouped into bundle of 1500 -> discount ৳300.
      // Leftover ৳400 at regular price.
      const res = evaluatePromotions({
        lines: [
          { variantId: "v1", productId: "p", unitPriceMinor: 70000n, quantity: "1" },
          { variantId: "v2", productId: "p", unitPriceMinor: 60000n, quantity: "1" },
          { variantId: "v3", productId: "p", unitPriceMinor: 50000n, quantity: "1" },
          { variantId: "v4", productId: "p", unitPriceMinor: 40000n, quantity: "1" },
        ],
        promotions: [bundlePromo],
      });

      expect(res.grossMinor).toBe(220000n);
      expect(res.linePromotionDiscountMinor).toBe(30000n); // ৳300.00
      expect(res.netMinor).toBe(190000n); // 1500 + 400 = ৳1,900.00
    });
  });

  // -------------------------------------------------------------------------
  // 3. Competing Promotions: Best for Customer Wins, Ties Broken by Priority
  // -------------------------------------------------------------------------
  describe("Competing promotions", () => {
    it("chooses the promotion giving the largest discount", () => {
      // 10% off vs ৳300 off on a ৳2,000 item
      // 10% of 2000 = 200. ৳300 off = 300. ৳300 off should win!
      const p10Percent: PromotionRule = {
        id: "p1",
        name: "10% off",
        type: "PERCENT_OFF",
        status: "active",
        priority: 1,
        stackableWithBill: true,
        membersOnly: false,
        targetType: "ALL",
        startAt: new Date(Date.now() - 3600000),
        endAt: new Date(Date.now() + 3600000),
        config: { percentBp: 1000 },
      };

      const p300Off: PromotionRule = {
        id: "p2",
        name: "৳300 off",
        type: "AMOUNT_OFF",
        status: "active",
        priority: 1,
        stackableWithBill: true,
        membersOnly: false,
        targetType: "ALL",
        startAt: new Date(Date.now() - 3600000),
        endAt: new Date(Date.now() + 3600000),
        config: { amountMinor: 30000n },
      };

      const res = evaluatePromotions({
        lines: [{ variantId: "v1", productId: "p1", unitPriceMinor: 200000n, quantity: "1" }],
        promotions: [p10Percent, p300Off],
      });

      expect(res.linePromotionDiscountMinor).toBe(30000n); // ৳300 wins
      expect(res.appliedPromotions[0].id).toBe("p2");
    });

    it("tie-break: higher priority wins on equal discount", () => {
      const promoLowPriority: PromotionRule = {
        id: "p-low",
        name: "৳100 off low prio",
        type: "AMOUNT_OFF",
        status: "active",
        priority: 5,
        stackableWithBill: true,
        membersOnly: false,
        targetType: "ALL",
        startAt: new Date(Date.now() - 3600000),
        endAt: new Date(Date.now() + 3600000),
        createdAt: "2026-01-01T00:00:00Z",
        config: { amountMinor: 10000n },
      };

      const promoHighPriority: PromotionRule = {
        id: "p-high",
        name: "৳100 off high prio",
        type: "AMOUNT_OFF",
        status: "active",
        priority: 10,
        stackableWithBill: true,
        membersOnly: false,
        targetType: "ALL",
        startAt: new Date(Date.now() - 3600000),
        endAt: new Date(Date.now() + 3600000),
        createdAt: "2026-01-02T00:00:00Z",
        config: { amountMinor: 10000n },
      };

      const res = evaluatePromotions({
        lines: [{ variantId: "v1", productId: "p1", unitPriceMinor: 50000n, quantity: "1" }],
        promotions: [promoLowPriority, promoHighPriority],
      });

      expect(res.appliedPromotions[0].id).toBe("p-high");
    });
  });

  // -------------------------------------------------------------------------
  // 4. Time Windows in Asia/Dhaka & Day of Week
  // -------------------------------------------------------------------------
  describe("Time window around midnight in Asia/Dhaka, day of week, inclusive/exclusive", () => {
    it("respects start (inclusive) and end (exclusive) instants", () => {
      const start = new Date("2026-11-20T00:00:00.000Z");
      const end = new Date("2026-11-20T12:00:00.000Z");

      const promo: PromotionRule = {
        id: "p-window",
        name: "Window promo",
        type: "PERCENT_OFF",
        status: "active",
        priority: 1,
        stackableWithBill: true,
        membersOnly: false,
        targetType: "ALL",
        startAt: start,
        endAt: end,
        config: { percentBp: 1000 },
      };

      // 1 ms before start -> inactive
      expect(isPromotionTimeActive(promo, new Date(start.getTime() - 1)).active).toBe(false);
      // exact start instant -> active (inclusive)
      expect(isPromotionTimeActive(promo, start).active).toBe(true);
      // inside window -> active
      expect(isPromotionTimeActive(promo, new Date(start.getTime() + 1000)).active).toBe(true);
      // exact end instant -> inactive (exclusive)
      expect(isPromotionTimeActive(promo, end).active).toBe(false);
    });

    it("respects day of week in Asia/Dhaka (e.g. Friday only)", () => {
      // 2026-11-20 is Friday in Asia/Dhaka
      const fridayDhaka = new Date("2026-11-20T06:00:00.000Z"); // 12:00 Friday in Dhaka (UTC+6)
      const saturdayDhaka = new Date("2026-11-21T06:00:00.000Z"); // Saturday

      const fridayOnlyPromo: PromotionRule = {
        id: "p-fri",
        name: "Friday Special",
        type: "PERCENT_OFF",
        status: "active",
        priority: 1,
        stackableWithBill: true,
        membersOnly: false,
        targetType: "ALL",
        startAt: new Date("2026-01-01T00:00:00Z"),
        endAt: new Date("2027-01-01T00:00:00Z"),
        daysOfWeek: [5], // 5 = Friday
        config: { percentBp: 1000 },
      };

      expect(isPromotionTimeActive(fridayOnlyPromo, fridayDhaka, "Asia/Dhaka").active).toBe(true);
      expect(isPromotionTimeActive(fridayOnlyPromo, saturdayDhaka, "Asia/Dhaka").active).toBe(false);
    });

    it("respects hours in Asia/Dhaka around afternoon/evening", () => {
      // 15:00 to 21:00 (3pm to 9pm in Dhaka)
      const promo: PromotionRule = {
        id: "p-hours",
        name: "Evening flash sale",
        type: "PERCENT_OFF",
        status: "active",
        priority: 1,
        stackableWithBill: true,
        membersOnly: false,
        targetType: "ALL",
        startAt: new Date("2026-01-01T00:00:00Z"),
        endAt: new Date("2027-01-01T00:00:00Z"),
        hours: { start: "15:00", end: "21:00" },
        config: { percentBp: 1000 },
      };

      // 10:00 UTC = 16:00 (4pm) Dhaka -> inside
      const insideTime = new Date("2026-11-20T10:00:00.000Z");
      expect(isPromotionTimeActive(promo, insideTime, "Asia/Dhaka").active).toBe(true);

      // 06:00 UTC = 12:00 (12pm) Dhaka -> outside
      const outsideTime = new Date("2026-11-20T06:00:00.000Z");
      expect(isPromotionTimeActive(promo, outsideTime, "Asia/Dhaka").active).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 5. VAT-Inclusive and VAT-Exclusive Tax Classes
  // -------------------------------------------------------------------------
  describe("VAT with promotions", () => {
    it("applies VAT on line net after promotion discount", () => {
      // Panjabi ৳2,000 with 10% off -> net ৳1,800.
      // Standard 7.5% VAT (750 bp) on ৳1,800 = ৳135.
      // Total = ৳1,935.
      const promo: PromotionRule = {
        id: "p-vat",
        name: "10% off",
        type: "PERCENT_OFF",
        status: "active",
        priority: 1,
        stackableWithBill: true,
        membersOnly: false,
        targetType: "ALL",
        startAt: new Date(Date.now() - 3600000),
        endAt: new Date(Date.now() + 3600000),
        config: { percentBp: 1000 },
      };

      const res = evaluatePromotions({
        lines: [
          {
            variantId: "v1",
            productId: "p1",
            unitPriceMinor: 200000n, // ৳2,000
            quantity: "1",
            taxRateBp: 750, // 7.5%
          },
        ],
        promotions: [promo],
      });

      expect(res.grossMinor).toBe(200000n);
      expect(res.linePromotionDiscountMinor).toBe(20000n);
      expect(res.netMinor).toBe(180000n);
      expect(res.taxMinor).toBe(13500n); // 7.5% of 1800.00 = 135.00
      expect(res.totalMinor).toBe(193500n); // 1800 + 135 = 1935.00
    });
  });

  // -------------------------------------------------------------------------
  // 6. 1,000 Seeded Random Carts Property Tests
  // -------------------------------------------------------------------------
  describe("1,000 Seeded Random Carts Property Invariants", () => {
    it("guarantees: line total >= 0, discount <= gross, sum of line nets = total net, order invariance", () => {
      // Simple PRNG (Mulberry32) for reproducible property testing
      function mulberry32(seed: number) {
        return function () {
          let t = (seed += 0x6d2b79f5);
          t = Math.imul(t ^ (t >>> 15), t | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }

      const random = mulberry32(42);

      const promoPool: PromotionRule[] = [
        {
          id: "p-percent",
          name: "15% off",
          type: "PERCENT_OFF",
          status: "active",
          priority: 2,
          stackableWithBill: true,
          membersOnly: false,
          targetType: "ALL",
          startAt: new Date("2026-01-01"),
          endAt: new Date("2027-01-01"),
          config: { percentBp: 1500 },
        },
        {
          id: "p-b2g1",
          name: "Buy 2 Get 1 Free",
          type: "BUY_X_GET_Y",
          status: "active",
          priority: 3,
          stackableWithBill: true,
          membersOnly: false,
          targetType: "ALL",
          startAt: new Date("2026-01-01"),
          endAt: new Date("2027-01-01"),
          config: { buyQty: 2, getQty: 1, getDiscountPercentBp: 10000 },
        },
        {
          id: "p-bundle",
          name: "3 for ৳1,000",
          type: "BUNDLE_PRICE",
          status: "active",
          priority: 1,
          stackableWithBill: true,
          membersOnly: false,
          targetType: "ALL",
          startAt: new Date("2026-01-01"),
          endAt: new Date("2027-01-01"),
          config: { bundleQty: 3, bundlePriceMinor: 100000n },
        },
        {
          id: "p-bill",
          name: "৳3,000 spend ৳300 off",
          type: "BILL_THRESHOLD",
          status: "active",
          priority: 1,
          stackableWithBill: true,
          membersOnly: false,
          targetType: "ALL",
          startAt: new Date("2026-01-01"),
          endAt: new Date("2027-01-01"),
          config: { thresholdMinor: 300000n, discountType: "AMOUNT", amountMinor: 30000n },
        },
      ];

      for (let cartIdx = 0; cartIdx < 1000; cartIdx++) {
        const numLines = 1 + Math.floor(random() * 5); // 1 to 5 lines
        const lines = [];

        for (let l = 0; l < numLines; l++) {
          const price = 5000n + BigInt(Math.floor(random() * 50000)); // ৳50 to ৳550
          const qty = 1 + Math.floor(random() * 4); // 1 to 4 units
          lines.push({
            lineId: `line-${l}`,
            variantId: `var-${l}`,
            productId: `prod-${l}`,
            unitPriceMinor: price,
            quantity: String(qty),
            taxRateBp: random() > 0.5 ? 500 : 0, // 5% VAT or 0%
          });
        }

        const input: PromotionEvaluationInput = {
          lines,
          promotions: promoPool,
          evaluationTime: new Date("2026-06-15T12:00:00Z"),
        };

        const res = evaluatePromotions(input);

        // Invariant 1: No line total is below 0
        for (const line of res.lines) {
          expect(line.effectiveLineNetMinor >= 0n).toBe(true);
          expect(line.totalMinor >= 0n).toBe(true);
        }

        // Invariant 2: Total discount is never larger than gross
        expect(res.totalDiscountMinor <= res.grossMinor).toBe(true);

        // Invariant 3: Sum of line nets equals the sale net
        const sumLineNets = res.lines.reduce((acc, l) => acc + l.effectiveLineNetMinor, 0n);
        expect(sumLineNets).toBe(res.netMinor);

        // Invariant 4: Order invariance (shuffling lines produces identical totals)
        if (lines.length > 1) {
          const reversedLines = [...lines].reverse();
          const resReversed = evaluatePromotions({
            ...input,
            lines: reversedLines,
          });

          expect(resReversed.grossMinor).toBe(res.grossMinor);
          expect(resReversed.totalDiscountMinor).toBe(res.totalDiscountMinor);
          expect(resReversed.netMinor).toBe(res.netMinor);
          expect(resReversed.taxMinor).toBe(res.taxMinor);
          expect(resReversed.totalMinor).toBe(res.totalMinor);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // 7. Loyalty Points Math
  // -------------------------------------------------------------------------
  describe("Loyalty Points Calculation", () => {
    it("earnPoints: 1 point per ৳100 spent, rounded down to whole points", () => {
      // ৳450 spent = 4 points (not 4.5)
      expect(earnPoints(45000n)).toBe(4);
      // ৳99.99 spent = 0 points
      expect(earnPoints(9999n)).toBe(0);
      // ৳1,000 spent with ৳200 paid with points -> base ৳800 -> 8 points
      expect(earnPoints(100000n, 20000n)).toBe(8);
    });

    it("maxRedeemablePoints: respects balance, min threshold, and max bill share", () => {
      // Bill ৳1,000 (100,000 poisha). Max 50% = ৳500 (500 points at ৳1/pt)
      // Customer has 200 points (> min 100) -> can redeem 200 points (৳200)
      const res1 = maxRedeemablePoints(100000n, 200);
      expect(res1.maxPoints).toBe(200);
      expect(res1.maxDiscountMinor).toBe(20000n);

      // Customer has 800 points -> capped at 50% of bill = 500 points
      const res2 = maxRedeemablePoints(100000n, 800);
      expect(res2.maxPoints).toBe(500);
      expect(res2.maxDiscountMinor).toBe(50000n);

      // Customer has 50 points (< min 100) -> 0 redeemable
      const res3 = maxRedeemablePoints(100000n, 50);
      expect(res3.maxPoints).toBe(0);
      expect(res3.maxDiscountMinor).toBe(0n);
    });

    it("reversePoints: reverses points in exact proportion on partial and full return", () => {
      // Sale earned 10 points on ৳1,000 net.
      // Full return of ৳1,000 -> reverses 10 points
      expect(reversePoints(10, 100000n, 100000n)).toBe(10);

      // Partial return of ৳500 -> reverses 5 points
      expect(reversePoints(10, 50000n, 100000n)).toBe(5);

      // Partial return of ৳250 -> reverses 2.5 rounded to 3 points
      expect(reversePoints(10, 25000n, 100000n)).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // 8. Stacking with bill = false & Cashier Override Permission
  // -------------------------------------------------------------------------
  describe("Stacking and Override Behavior", () => {
    it("stackableWithBill = false leaves line net out of bill promotion base", () => {
      const linePromoNonStackable: PromotionRule = {
        id: "p-clearance",
        name: "Clearance 50% off",
        type: "PERCENT_OFF",
        status: "active",
        priority: 1,
        stackableWithBill: false, // NON-STACKABLE
        membersOnly: false,
        targetType: "PRODUCTS",
        targetIds: ["p1"],
        startAt: new Date(Date.now() - 3600000),
        endAt: new Date(Date.now() + 3600000),
        config: { percentBp: 5000 },
      };

      const billThresholdPromo: PromotionRule = {
        id: "p-bill-thresh",
        name: "৳5,000 spend 10% off",
        type: "BILL_THRESHOLD",
        status: "active",
        priority: 1,
        stackableWithBill: true,
        membersOnly: false,
        targetType: "ALL",
        startAt: new Date(Date.now() - 3600000),
        endAt: new Date(Date.now() + 3600000),
        config: { thresholdMinor: 500000n, discountType: "PERCENT", percentBp: 1000 },
      };

      // Item 1: ৳6,000 clearance -> 50% off = ৳3,000 net (non-stackable with bill)
      // Item 2: ৳3,000 regular item -> regular item subtotal = ৳3,000 (< ৳5,000 threshold)
      // Because Item 1 is non-stackable, bill base is only ৳3,000 -> threshold NOT met!
      const res = evaluatePromotions({
        lines: [
          { variantId: "v1", productId: "p1", unitPriceMinor: 600000n, quantity: "1" },
          { variantId: "v2", productId: "p2", unitPriceMinor: 300000n, quantity: "1" },
        ],
        promotions: [linePromoNonStackable, billThresholdPromo],
      });

      expect(res.linePromotionDiscountMinor).toBe(300000n);
      expect(res.billPromotionDiscountMinor).toBe(0n); // Bill threshold not met due to non-stackable exclusion!
    });

    it("manual line discount on promoted line is blocked without allowPromotionOverride", () => {
      const promo: PromotionRule = {
        id: "p1",
        name: "10% off",
        type: "PERCENT_OFF",
        status: "active",
        priority: 1,
        stackableWithBill: true,
        membersOnly: false,
        targetType: "ALL",
        startAt: new Date(Date.now() - 3600000),
        endAt: new Date(Date.now() + 3600000),
        config: { percentBp: 1000 },
      };

      // 1. Without allowPromotionOverride -> manual discount ignored
      const resBlocked = evaluatePromotions({
        lines: [
          {
            variantId: "v1",
            productId: "p1",
            unitPriceMinor: 100000n,
            quantity: "1",
            manualDiscount: { type: "fixed", amountMinor: 5000n },
          },
        ],
        promotions: [promo],
        allowPromotionOverride: false,
      });

      expect(resBlocked.linePromotionDiscountMinor).toBe(10000n);
      expect(resBlocked.manualDiscountMinor).toBe(0n); // Blocked!

      // 2. With allowPromotionOverride = true -> manual discount applied to remaining net
      const resAllowed = evaluatePromotions({
        lines: [
          {
            variantId: "v1",
            productId: "p1",
            unitPriceMinor: 100000n,
            quantity: "1",
            manualDiscount: { type: "fixed", amountMinor: 5000n },
          },
        ],
        promotions: [promo],
        allowPromotionOverride: true,
      });

      expect(resAllowed.linePromotionDiscountMinor).toBe(10000n);
      expect(resAllowed.manualDiscountMinor).toBe(5000n); // Allowed!
      expect(resAllowed.netMinor).toBe(85000n); // 1000 - 100 - 50 = ৳850.00
    });
  });

  // -------------------------------------------------------------------------
  // 9. Targeting, Exclusions, Conditions, Coupons, and Hints Coverage
  // -------------------------------------------------------------------------
  describe("Targeting, Exclusions, Conditions, Coupons, and Hints", () => {
    it("distributeProportional edge cases", () => {
      expect(distributeProportional([], 1000n)).toEqual([]);
      expect(distributeProportional([{ valueMinor: 100n }], 0n)).toEqual([0n]);
      expect(distributeProportional([{ valueMinor: 0n }], 500n)).toEqual([0n]);
      // discount > totalValue clamps to totalValue
      expect(distributeProportional([{ valueMinor: 100n }, { valueMinor: 200n }], 500n)).toEqual([
        100n,
        200n,
      ]);
    });

    it("targetType variants, categories, brands, collections and exclusions", () => {
      const promoVariants: PromotionRule = {
        id: "p-var",
        name: "Variant target",
        type: "AMOUNT_OFF",
        status: "active",
        priority: 1,
        stackableWithBill: true,
        membersOnly: false,
        targetType: "VARIANTS",
        targetIds: ["var-match"],
        exclusionIds: ["prod-excluded", "cat-excluded", "brand-excluded", "col-excluded"],
        startAt: new Date("2026-01-01"),
        endAt: new Date("2027-01-01"),
        config: { amountMinor: 1000n },
      };

      const promoCat: PromotionRule = {
        id: "p-cat",
        name: "Cat target",
        type: "AMOUNT_OFF",
        status: "active",
        priority: 1,
        stackableWithBill: true,
        membersOnly: false,
        targetType: "CATEGORIES",
        targetIds: ["cat-match"],
        startAt: new Date("2026-01-01"),
        endAt: new Date("2027-01-01"),
        config: { amountMinor: 500n },
      };

      const promoBrand: PromotionRule = {
        id: "p-brand",
        name: "Brand target",
        type: "AMOUNT_OFF",
        status: "active",
        priority: 1,
        stackableWithBill: true,
        membersOnly: false,
        targetType: "BRANDS",
        targetIds: ["brand-match"],
        startAt: new Date("2026-01-01"),
        endAt: new Date("2027-01-01"),
        config: { amountMinor: 500n },
      };

      const promoCol: PromotionRule = {
        id: "p-col",
        name: "Col target",
        type: "AMOUNT_OFF",
        status: "active",
        priority: 1,
        stackableWithBill: true,
        membersOnly: false,
        targetType: "COLLECTIONS",
        targetIds: ["col-match"],
        startAt: new Date("2026-01-01"),
        endAt: new Date("2027-01-01"),
        config: { amountMinor: 500n },
      };

      // Test variant match
      const resVar = evaluatePromotions({
        lines: [
          { variantId: "var-match", productId: "p1", unitPriceMinor: 10000n, quantity: "1" },
          { variantId: "var-other", productId: "p2", unitPriceMinor: 10000n, quantity: "1" },
          {
            variantId: "var-match",
            productId: "prod-excluded",
            unitPriceMinor: 10000n,
            quantity: "1",
          }, // Excluded by product
          {
            variantId: "var-match",
            productId: "p3",
            categoryId: "cat-excluded",
            unitPriceMinor: 10000n,
            quantity: "1",
          }, // Excluded by cat
          {
            variantId: "var-match",
            productId: "p4",
            brandId: "brand-excluded",
            unitPriceMinor: 10000n,
            quantity: "1",
          }, // Excluded by brand
          {
            variantId: "var-match",
            productId: "p5",
            collectionId: "col-excluded",
            unitPriceMinor: 10000n,
            quantity: "1",
          }, // Excluded by col
        ],
        promotions: [promoVariants],
      });
      expect(resVar.linePromotionDiscountMinor).toBe(1000n); // only line 0 matched and not excluded

      // Test Category, Brand, Collection targeting
      const resOtherTargets = evaluatePromotions({
        lines: [
          {
            variantId: "v1",
            productId: "p1",
            categoryId: "cat-match",
            unitPriceMinor: 10000n,
            quantity: "1",
          },
          {
            variantId: "v2",
            productId: "p2",
            brandId: "brand-match",
            unitPriceMinor: 10000n,
            quantity: "1",
          },
          {
            variantId: "v3",
            productId: "p3",
            collectionId: "col-match",
            unitPriceMinor: 10000n,
            quantity: "1",
          },
        ],
        promotions: [promoCat, promoBrand, promoCol],
      });
      expect(resOtherTargets.linePromotionDiscountMinor).toBe(1500n);
    });

    it("conditions: membersOnly, usage limits, branchIds, minQuantity", () => {
      const promo: PromotionRule = {
        id: "p-cond",
        name: "Conditions promo",
        type: "AMOUNT_OFF",
        status: "active",
        priority: 1,
        stackableWithBill: true,
        membersOnly: true,
        branchIds: ["branch-1"],
        minQuantity: 2,
        usageLimitTotal: 10,
        usedCount: 5,
        usageLimitPerCustomer: 2,
        customerUsageCount: 1,
        targetType: "ALL",
        startAt: new Date("2026-01-01"),
        endAt: new Date("2027-01-01"),
        config: { amountMinor: 2000n },
      };

      // 1. Without customer -> fails membersOnly
      const resNoCust = evaluatePromotions({
        lines: [{ variantId: "v1", productId: "p1", unitPriceMinor: 10000n, quantity: "2" }],
        promotions: [promo],
        branchId: "branch-1",
      });
      expect(resNoCust.linePromotionDiscountMinor).toBe(0n);

      // 2. Wrong branch -> fails
      const resWrongBranch = evaluatePromotions({
        lines: [{ variantId: "v1", productId: "p1", unitPriceMinor: 10000n, quantity: "2" }],
        promotions: [promo],
        customerId: "cust-1",
        branchId: "branch-2",
      });
      expect(resWrongBranch.linePromotionDiscountMinor).toBe(0n);

      // 3. Min quantity not met -> fails
      const resLowQty = evaluatePromotions({
        lines: [{ variantId: "v1", productId: "p1", unitPriceMinor: 10000n, quantity: "1" }],
        promotions: [promo],
        customerId: "cust-1",
        branchId: "branch-1",
      });
      expect(resLowQty.linePromotionDiscountMinor).toBe(0n);

      // 4. Total usage exceeded -> fails
      const promoLimitExceeded: PromotionRule = { ...promo, usedCount: 10 };
      const resLimitExceeded = evaluatePromotions({
        lines: [{ variantId: "v1", productId: "p1", unitPriceMinor: 10000n, quantity: "2" }],
        promotions: [promoLimitExceeded],
        customerId: "cust-1",
        branchId: "branch-1",
      });
      expect(resLimitExceeded.linePromotionDiscountMinor).toBe(0n);

      // 5. Customer usage exceeded -> fails
      const promoCustExceeded: PromotionRule = { ...promo, customerUsageCount: 2 };
      const resCustExceeded = evaluatePromotions({
        lines: [{ variantId: "v1", productId: "p1", unitPriceMinor: 10000n, quantity: "2" }],
        promotions: [promoCustExceeded],
        customerId: "cust-1",
        branchId: "branch-1",
      });
      expect(resCustExceeded.linePromotionDiscountMinor).toBe(0n);

      // 6. Valid conditions -> passes
      const resValid = evaluatePromotions({
        lines: [{ variantId: "v1", productId: "p1", unitPriceMinor: 10000n, quantity: "2" }],
        promotions: [promo],
        customerId: "cust-1",
        branchId: "branch-1",
      });
      expect(resValid.linePromotionDiscountMinor).toBe(4000n); // 2 units * 2000n
    });

    it("evaluates all coupon invalid reasons and valid amount/percent with cap", () => {
      const baseCoupon: PromotionRule = {
        id: "cp-1",
        name: "Eid Coupon",
        type: "BILL_THRESHOLD",
        status: "active",
        priority: 1,
        stackableWithBill: true,
        membersOnly: false,
        couponRequired: true,
        couponCodes: ["EID500", "EIDPERCENT"],
        branchIds: ["branch-1"],
        usageLimitTotal: 5,
        usedCount: 2,
        usageLimitPerCustomer: 1,
        customerUsageCount: 0,
        targetType: "ALL",
        startAt: new Date("2026-05-01"),
        endAt: new Date("2026-05-10"),
        config: {
          thresholdMinor: 200000n, // ৳2,000 threshold
          discountType: "AMOUNT",
          amountMinor: 50000n, // ৳500
        },
      };

      // 1. INVALID_CODE
      const resInvalid = evaluatePromotions({
        lines: [{ variantId: "v1", productId: "p1", unitPriceMinor: 300000n, quantity: "1" }],
        promotions: [baseCoupon],
        couponCode: "WRONGCODE",
      });
      expect(resInvalid.couponState?.invalidReason).toBe("INVALID_CODE");

      // 2. NOT_STARTED
      const resNotStarted = evaluatePromotions({
        lines: [{ variantId: "v1", productId: "p1", unitPriceMinor: 300000n, quantity: "1" }],
        promotions: [baseCoupon],
        couponCode: "EID500",
        evaluationTime: new Date("2026-04-01"),
      });
      expect(resNotStarted.couponState?.invalidReason).toBe("NOT_STARTED");

      // 3. EXPIRED
      const resExpired = evaluatePromotions({
        lines: [{ variantId: "v1", productId: "p1", unitPriceMinor: 300000n, quantity: "1" }],
        promotions: [baseCoupon],
        couponCode: "EID500",
        evaluationTime: new Date("2026-05-20"),
      });
      expect(resExpired.couponState?.invalidReason).toBe("EXPIRED");

      // 4. WRONG_BRANCH
      const resWrongBranch = evaluatePromotions({
        lines: [{ variantId: "v1", productId: "p1", unitPriceMinor: 300000n, quantity: "1" }],
        promotions: [baseCoupon],
        couponCode: "EID500",
        branchId: "branch-other",
        evaluationTime: new Date("2026-05-05"),
      });
      expect(resWrongBranch.couponState?.invalidReason).toBe("WRONG_BRANCH");

      // 5. USAGE_LIMIT_EXCEEDED
      const couponUsageMax = { ...baseCoupon, usedCount: 5 };
      const resMaxUsage = evaluatePromotions({
        lines: [{ variantId: "v1", productId: "p1", unitPriceMinor: 300000n, quantity: "1" }],
        promotions: [couponUsageMax],
        couponCode: "EID500",
        branchId: "branch-1",
        evaluationTime: new Date("2026-05-05"),
      });
      expect(resMaxUsage.couponState?.invalidReason).toBe("USAGE_LIMIT_EXCEEDED");

      // 6. CUSTOMER_LIMIT_EXCEEDED
      const couponCustMax = { ...baseCoupon, customerUsageCount: 1 };
      const resMaxCust = evaluatePromotions({
        lines: [{ variantId: "v1", productId: "p1", unitPriceMinor: 300000n, quantity: "1" }],
        promotions: [couponCustMax],
        couponCode: "EID500",
        customerId: "c1",
        branchId: "branch-1",
        evaluationTime: new Date("2026-05-05"),
      });
      expect(resMaxCust.couponState?.invalidReason).toBe("CUSTOMER_LIMIT_EXCEEDED");

      // 7. THRESHOLD_NOT_MET
      const resThresholdNotMet = evaluatePromotions({
        lines: [{ variantId: "v1", productId: "p1", unitPriceMinor: 100000n, quantity: "1" }], // ৳1,000 < ৳2,000
        promotions: [baseCoupon],
        couponCode: "EID500",
        customerId: "c1",
        branchId: "branch-1",
        evaluationTime: new Date("2026-05-05"),
      });
      expect(resThresholdNotMet.couponState?.invalidReason).toBe("THRESHOLD_NOT_MET");

      // 8. Valid AMOUNT coupon
      const resValidAmount = evaluatePromotions({
        lines: [{ variantId: "v1", productId: "p1", unitPriceMinor: 300000n, quantity: "1" }],
        promotions: [baseCoupon],
        couponCode: "EID500",
        customerId: "c1",
        branchId: "branch-1",
        evaluationTime: new Date("2026-05-05"),
      });
      expect(resValidAmount.couponState?.valid).toBe(true);
      expect(resValidAmount.billPromotionDiscountMinor).toBe(50000n);
      expect(resValidAmount.appliedPromotions[0].reason).toContain("কুপন: EID500");

      // 9. Valid PERCENT coupon with cap
      const percentCoupon: PromotionRule = {
        ...baseCoupon,
        couponCodes: ["EIDPERCENT"],
        config: {
          thresholdMinor: 200000n,
          discountType: "PERCENT",
          percentBp: 2000, // 20%
          maxDiscountMinor: 30000n, // Max ৳300 cap
        },
      };
      const resValidPercent = evaluatePromotions({
        lines: [{ variantId: "v1", productId: "p1", unitPriceMinor: 300000n, quantity: "1" }], // 20% of 3,000 = 600 -> capped to 300
        promotions: [percentCoupon],
        couponCode: "EIDPERCENT",
        customerId: "c1",
        branchId: "branch-1",
        evaluationTime: new Date("2026-05-05"),
      });
      expect(resValidPercent.couponState?.valid).toBe(true);
      expect(resValidPercent.billPromotionDiscountMinor).toBe(30000n);
    });

    it("displays billThresholdHint when within 20% of threshold", () => {
      const promo: PromotionRule = {
        id: "p-hint",
        name: "৳5,000 অফার",
        type: "BILL_THRESHOLD",
        status: "active",
        priority: 1,
        stackableWithBill: true,
        membersOnly: false,
        targetType: "ALL",
        startAt: new Date("2026-01-01"),
        endAt: new Date("2027-01-01"),
        config: {
          thresholdMinor: 500000n, // ৳5,000
          discountType: "AMOUNT",
          amountMinor: 50000n,
        },
      };

      // 85% of threshold = ৳4,250 (within 20% of 5,000)
      const resHint = evaluatePromotions({
        lines: [{ variantId: "v1", productId: "p1", unitPriceMinor: 425000n, quantity: "1" }],
        promotions: [promo],
      });

      expect(resHint.billThresholdHint).toBeDefined();
      expect(resHint.billThresholdHint?.remainingMinor).toBe(75000n); // ৳750 remaining
      expect(resHint.billThresholdHint?.hintText).toContain("আর ৳750 কিনলে অফার পাবেন");
    });

    it("evaluates manual line percent and manual bill fixed and percent discounts", () => {
      // 1. Manual line percent discount
      const resLinePercent = evaluatePromotions({
        lines: [
          {
            variantId: "v1",
            productId: "p1",
            unitPriceMinor: 100000n,
            quantity: "1",
            manualDiscount: { type: "percent", percentBp: 1500 }, // 15%
          },
        ],
        promotions: [],
      });
      expect(resLinePercent.manualDiscountMinor).toBe(15000n);
      expect(resLinePercent.netMinor).toBe(85000n);

      // 2. Manual bill fixed discount
      const resBillFixed = evaluatePromotions({
        lines: [{ variantId: "v1", productId: "p1", unitPriceMinor: 100000n, quantity: "1" }],
        promotions: [],
        manualBillDiscount: { type: "fixed", amountMinor: 20000n }, // ৳200
      });
      expect(resBillFixed.manualDiscountMinor).toBe(20000n);
      expect(resBillFixed.netMinor).toBe(80000n);

      // 3. Manual bill percent discount with cap exceeding subtotal
      const resBillPercent = evaluatePromotions({
        lines: [{ variantId: "v1", productId: "p1", unitPriceMinor: 100000n, quantity: "1" }],
        promotions: [],
        manualBillDiscount: { type: "percent", percentBp: 15000 }, // 150% -> capped to 100% (postManualLineSubtotal)
      });
      expect(resBillPercent.manualDiscountMinor).toBe(100000n);
      expect(resBillPercent.netMinor).toBe(0n);

      // 4. Default in switch for invalid targetType
      const resInvalidTarget = evaluatePromotions({
        lines: [{ variantId: "v1", productId: "p1", unitPriceMinor: 100000n, quantity: "1" }],
        promotions: [{
          id: "p-invalid-target",
          name: "Invalid target",
          type: "AMOUNT_OFF",
          status: "active",
          priority: 1,
          stackableWithBill: true,
          membersOnly: false,
          targetType: "UNKNOWN" as any,
          targetIds: ["dummy-target"],
          startAt: new Date("2026-01-01"),
          endAt: new Date("2027-01-01"),
          config: { amountMinor: 1000n },
        }],
      });
      expect(resInvalidTarget.linePromotionDiscountMinor).toBe(0n);
    });

    it("loyalty edge cases: negative/zero earn, zero balance, reverse with zero", () => {
      expect(earnPoints(0n)).toBe(0);
      expect(earnPoints(100000n, 100000n)).toBe(0); // net paid is fully points
      expect(earnPoints(100000n, 0n, 0n)).toBe(0); // 0 earn rate

      expect(maxRedeemablePoints(100000n, 0).maxPoints).toBe(0);
      expect(maxRedeemablePoints(0n, 500).maxPoints).toBe(0);
      expect(maxRedeemablePoints(100000n, 500, { enabled: false }).maxPoints).toBe(0);

      expect(reversePoints(0, 50000n, 100000n)).toBe(0);
      expect(reversePoints(10, 0n, 100000n)).toBe(0);
      expect(reversePoints(10, 50000n, 0n)).toBe(0);
    });

    it("a decimal quantity line does not break any promotion type", () => {
      const now = new Date();
      const promos: PromotionRule[] = [
        {
          id: "p-percent",
          name: "10% off",
          type: "PERCENT_OFF",
          status: "active",
          priority: 1,
          stackableWithBill: true,
          membersOnly: false,
          targetType: "ALL",
          startAt: new Date(now.getTime() - 10000),
          endAt: new Date(now.getTime() + 10000),
          config: { percentBp: 1000 },
        },
        {
          id: "p-amount",
          name: "20 Tk off",
          type: "AMOUNT_OFF",
          status: "active",
          priority: 1,
          stackableWithBill: true,
          membersOnly: false,
          targetType: "ALL",
          startAt: new Date(now.getTime() - 10000),
          endAt: new Date(now.getTime() + 10000),
          config: { amountMinor: 2000n },
        },
        {
          id: "p-fixed",
          name: "Fixed 80 Tk",
          type: "FIXED_PRICE",
          status: "active",
          priority: 1,
          stackableWithBill: true,
          membersOnly: false,
          targetType: "ALL",
          startAt: new Date(now.getTime() - 10000),
          endAt: new Date(now.getTime() + 10000),
          config: { fixedPriceMinor: 8000n },
        },
        {
          id: "p-b2g1",
          name: "Buy 2 Get 1",
          type: "BUY_X_GET_Y",
          status: "active",
          priority: 1,
          stackableWithBill: true,
          membersOnly: false,
          targetType: "ALL",
          startAt: new Date(now.getTime() - 10000),
          endAt: new Date(now.getTime() + 10000),
          config: { buyQty: 2, getQty: 1, getDiscountPercentBp: 10000 },
        },
        {
          id: "p-bill",
          name: "Bill threshold",
          type: "BILL_THRESHOLD",
          status: "active",
          priority: 1,
          stackableWithBill: true,
          membersOnly: false,
          targetType: "ALL",
          startAt: new Date(now.getTime() - 10000),
          endAt: new Date(now.getTime() + 10000),
          config: { minSpendMinor: 10000n, discountPercentBp: 500 },
        },
      ];

      for (const promo of promos) {
        expect(() => {
          evaluatePromotions({
            lines: [{ variantId: "v1", productId: "p1", unitPriceMinor: 10000n, quantity: "2.500" }],
            promotions: [promo],
          });
        }).not.toThrow();
      }
    });

    it("a buy-2-get-1 promotion on cans counts cans, not liters", () => {
      // 3 cans of 5 liters each = 15 liters base quantity.
      // Line is 3 cans @ ৳225 (22500 poisha).
      // buy-2-get-1 promotion on cans counts whole cans (3 units), awarding 1 free can (22500 poisha discount).
      const b2g1: PromotionRule = {
        id: "b2g1-cans",
        name: "Buy 2 Cans Get 1 Free",
        type: "BUY_X_GET_Y",
        status: "active",
        priority: 1,
        stackableWithBill: true,
        membersOnly: false,
        targetType: "ALL",
        startAt: new Date(Date.now() - 3600000),
        endAt: new Date(Date.now() + 3600000),
        config: {
          buyQty: 2,
          getQty: 1,
          getDiscountPercentBp: 10000,
        },
      };

      const result = evaluatePromotions({
        lines: [
          {
            variantId: "v-hcl",
            productId: "p-hcl",
            unitPriceMinor: 22500n,
            quantity: "3", // 3 cans
          },
        ],
        promotions: [b2g1],
      });

      // 3 cans @ 22500 = 67500 gross. Exactly 1 free can = 22500 discount.
      expect(result.linePromotionDiscountMinor).toBe(22500n);
      expect(result.netMinor).toBe(45000n);
    });
  });

});
