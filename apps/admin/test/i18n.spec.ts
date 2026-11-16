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

describe("i18n Key Parity Check", () => {
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
});
