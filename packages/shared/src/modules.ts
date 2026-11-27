import type { BusinessType } from "./types.js";

export const MODULE_KEYS = [
  "units",
  "batch_expiry",
  "chemical_safety",
  "b2b_wholesale",
  "pharmacy_catalog",
  "prescription",
  "serial_tracking",
  "vat_mushak",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export interface ModuleInfo {
  key: ModuleKey;
  nameBn: string;
  nameEn: string;
  descriptionBn: string;
  dependsOn: ModuleKey[];
}

export const MODULE_INFO: Record<ModuleKey, ModuleInfo> = {
  units: {
    key: "units",
    nameBn: "পরিমাপের একক ও রূপান্তর",
    nameEn: "Units & Conversion",
    descriptionBn: "পণ্য পরিমাপের বিভিন্ন একক এবং তাদের পারস্পরিক রূপান্তর",
    dependsOn: [],
  },
  batch_expiry: {
    key: "batch_expiry",
    nameBn: "ব্যাচ ও মেয়াদ ট্র্যাকিং",
    nameEn: "Batch & Expiry",
    descriptionBn: "ব্যাচ, লট ও মেয়াদ উত্তীর্ণের ট্র্যাকিং এবং FEFO নিয়ন্ত্রণ",
    dependsOn: [],
  },
  chemical_safety: {
    key: "chemical_safety",
    nameBn: "রাসায়নিক নিরাপত্তা ও তথ্য",
    nameEn: "Chemical Safety",
    descriptionBn: "ঝুঁকি শ্রেণী (Hazard Class), CAS নম্বর, গ্রেড ও MSDS তথ্য",
    dependsOn: [],
  },
  b2b_wholesale: {
    key: "b2b_wholesale",
    nameBn: "পাইকারি ও করপোরেট বিক্রয়",
    nameEn: "B2B & Wholesale",
    descriptionBn: "গ্রাহক গ্রুপ ভিত্তিক মূল্য, কোটেশন, চালান ও বাকির সীমা",
    dependsOn: [],
  },
  pharmacy_catalog: {
    key: "pharmacy_catalog",
    nameBn: "ফার্মেসি ক্যাটালগ",
    nameEn: "Pharmacy Catalog",
    descriptionBn: "জেনেরিক নাম, শক্তি (Strength), সেবনবিধি ও সর্বোচ্চ খুচরা মূল্য (MRP)",
    dependsOn: ["units", "batch_expiry"],
  },
  prescription: {
    key: "prescription",
    nameBn: "প্রেসক্রিপশন রেকর্ড",
    nameEn: "Prescription Records",
    descriptionBn: "নিয়ন্ত্রিত ও শিডিউলড ওষুধের প্রেসক্রিপশন সংরক্ষণ ও যাচাই",
    dependsOn: ["pharmacy_catalog"],
  },
  serial_tracking: {
    key: "serial_tracking",
    nameBn: "সিরিয়াল ও আইএমইআই ট্র্যাকিং",
    nameEn: "Serial & IMEI Tracking",
    descriptionBn: "স্বতন্ত্র ডিভাইসের সিরিয়াল নম্বর ও IMEI ট্র্যাকিং",
    dependsOn: [],
  },
  vat_mushak: {
    key: "vat_mushak",
    nameBn: "ভ্যাট চালান (মূসক ৬.৩)",
    nameEn: "VAT Mushak 6.3",
    descriptionBn: "জাতীয় রাজস্ব বোর্ডের নিয়ম অনুযায়ী মূসক ৬.৩ চালান তৈরি",
    dependsOn: [],
  },
};

export const DEFAULT_MODULES_BY_BUSINESS_TYPE: Record<string, ModuleKey[]> = {
  fashion: [],
  chemical: ["units", "batch_expiry", "chemical_safety", "b2b_wholesale"],
  pharmacy: ["units", "batch_expiry", "pharmacy_catalog", "prescription"],
  grocery: ["units", "batch_expiry", "b2b_wholesale"],
  electronics: ["serial_tracking"],
  retail: [],
  ecommerce: [],
  other: [],
};

export interface ModuleFlagState {
  allowed?: boolean;
  enabled?: boolean;
}

export type ModuleFlagInput =
  | { key: string; allowed?: boolean; enabled?: boolean }[]
  | Record<string, ModuleFlagState | boolean>
  | readonly string[]
  | Set<string>;

/**
 * Returns the list of active module keys for a tenant.
 * A module is active only when it is allowed, enabled, and every module in its
 * dependsOn chain is active the entire way down the chain.
 */
export function getActiveModules(
  flags: ModuleFlagInput | null | undefined
): ModuleKey[] {
  if (!flags) return [];

  function isCandidate(k: ModuleKey): boolean {
    if (!flags) return false;
    if (flags instanceof Set) {
      return flags.has(k) || flags.has(`module.${k}`);
    }
    if (Array.isArray(flags)) {
      if (flags.length === 0) return false;
      const first = flags[0];
      if (typeof first === "string") {
        const arr = flags as unknown as readonly string[];
        return arr.includes(k) || arr.includes(`module.${k}`);
      }
      const objList = flags as { key: string; allowed?: boolean; enabled?: boolean }[];
      const match = objList.find((f) => f.key === k || f.key === `module.${k}`);
      return Boolean(match?.allowed && match?.enabled);
    }
    if (typeof flags === "object") {
      const rawVal =
        (flags as Record<string, ModuleFlagState | boolean>)[k] ??
        (flags as Record<string, ModuleFlagState | boolean>)[`module.${k}`];
      if (rawVal === undefined) return false;
      if (typeof rawVal === "boolean") return rawVal;
      return Boolean(rawVal.allowed && rawVal.enabled);
    }
    return false;
  }

  const memo = new Map<ModuleKey, boolean>();
  const visiting = new Set<ModuleKey>();

  function checkActive(k: ModuleKey): boolean {
    if (memo.has(k)) return memo.get(k)!;
    if (visiting.has(k)) return false; // Cycle prevention
    if (!isCandidate(k)) {
      memo.set(k, false);
      return false;
    }
    visiting.add(k);
    const deps = MODULE_INFO[k]?.dependsOn ?? [];
    for (const dep of deps) {
      if (!checkActive(dep)) {
        visiting.delete(k);
        memo.set(k, false);
        return false;
      }
    }
    visiting.delete(k);
    memo.set(k, true);
    return true;
  }

  return MODULE_KEYS.filter((k) => checkActive(k));
}

/**
 * Returns true if a module is active (allowed, enabled, and all dependencies active).
 */
export function isModuleActive(
  flags: ModuleFlagInput | null | undefined,
  key: ModuleKey
): boolean {
  return getActiveModules(flags).includes(key);
}

/**
 * Given the currently active module keys and a target key,
 * returns an array of dependency keys that are missing (not active).
 */
export function findMissingDependencies(
  activeKeys: readonly ModuleKey[] | readonly string[] | Set<string>,
  key: ModuleKey
): ModuleKey[] {
  const info = MODULE_INFO[key];
  if (!info || !info.dependsOn || info.dependsOn.length === 0) {
    return [];
  }

  const activeSet = activeKeys instanceof Set ? activeKeys : new Set(activeKeys);
  return info.dependsOn.filter((dep) => !activeSet.has(dep));
}
