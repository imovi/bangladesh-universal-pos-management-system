import { describe, it, expect } from "vitest";
import { bn } from "../src/i18n/bn";
import { en } from "../src/i18n/en";

function getLeafKeys(obj: Record<string, any>, prefix = ""): string[] {
  let keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      keys = keys.concat(getLeafKeys(v, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

describe("i18n Key Parity & Clean Translation Check", () => {
  it("ensures every key present in bn is also defined in en", () => {
    const bnKeys = getLeafKeys(bn).sort();
    const enKeys = getLeafKeys(en).sort();

    const missingInEn = bnKeys.filter((k) => !enKeys.includes(k));
    const missingInBn = enKeys.filter((k) => !bnKeys.includes(k));

    expect(missingInEn, `Keys missing in English: ${missingInEn.join(", ")}`).toEqual([]);
    expect(missingInBn, `Keys missing in Bangla: ${missingInBn.join(", ")}`).toEqual([]);
  });

  it("ensures no translation leaf string is empty", () => {
    const bnLeaves = getLeafKeys(bn);
    for (const key of bnLeaves) {
      const parts = key.split(".");
      let cur: any = bn;
      for (const p of parts) cur = cur[p];
      expect(typeof cur === "string" && cur.trim().length > 0, `Empty string in bn for ${key}`).toBe(true);
    }

    const enLeaves = getLeafKeys(en);
    for (const key of enLeaves) {
      const parts = key.split(".");
      let cur: any = en;
      for (const p of parts) cur = cur[p];
      expect(typeof cur === "string" && cur.trim().length > 0, `Empty string in en for ${key}`).toBe(true);
    }
  });

  it("ensures no mixed parenthesized translations exist in bn (e.g. '(Cash)', '(Voided)')", () => {
    const mixedPattern = /\([A-Za-z\s/+-]+\)/;
    const bnLeaves = getLeafKeys(bn);
    const mixedKeys: string[] = [];

    for (const key of bnLeaves) {
      const parts = key.split(".");
      let cur: any = bn;
      for (const p of parts) cur = cur[p];
      // Exclude sample placeholder values like "user@example.com" or "artisan-apparel"
      if (key.includes("Placeholder") || key.includes("email")) continue;
      if (typeof cur === "string" && mixedPattern.test(cur)) {
        mixedKeys.push(`${key}: "${cur}"`);
      }
    }

    expect(mixedKeys, `Found mixed English labels in Bangla translations: ${mixedKeys.join("; ")}`).toEqual([]);
  });

  it("ensures all standard system enums are completely translated", () => {
    expect(bn.enums.paymentMethod.cash).toBe("ক্যাশ");
    expect(en.enums.paymentMethod.cash).toBe("Cash");
    expect(bn.enums.paymentMethod.bkash).toBe("বিকাশ");
    expect(en.enums.paymentMethod.bkash).toBe("bKash");
    expect(bn.enums.paymentMethod.nagad).toBe("নগদ");
    expect(en.enums.paymentMethod.nagad).toBe("Nagad");
    expect(bn.enums.paymentMethod.rocket).toBe("রকেট");
    expect(en.enums.paymentMethod.rocket).toBe("Rocket");

    expect(bn.enums.saleStatus.completed).toBe("সম্পন্ন");
    expect(bn.enums.saleStatus.voided).toBe("বাতিলকৃত");
    expect(en.enums.saleStatus.completed).toBe("Completed");
    expect(en.enums.saleStatus.voided).toBe("Voided");

    expect(bn.enums.customer.walkIn).toBe("সাধারণ ক্রেতা");
    expect(en.enums.customer.walkIn).toBe("Walk-in Customer");
  });
});
