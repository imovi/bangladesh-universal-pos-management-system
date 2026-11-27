import { describe, it, expect } from "vitest";
import {
  MODULE_KEYS,
  MODULE_INFO,
  DEFAULT_MODULES_BY_BUSINESS_TYPE,
  getActiveModules,
  isModuleActive,
  findMissingDependencies,
  type ModuleKey,
} from "../src/modules.js";

describe("Module Registry & Helper Functions", () => {
  it("defines all 8 required module keys", () => {
    expect(MODULE_KEYS).toEqual([
      "units",
      "batch_expiry",
      "chemical_safety",
      "b2b_wholesale",
      "pharmacy_catalog",
      "prescription",
      "serial_tracking",
      "vat_mushak",
    ]);
  });

  it("provides MODULE_INFO with Bangla/English names and descriptions", () => {
    for (const key of MODULE_KEYS) {
      const info = MODULE_INFO[key];
      expect(info).toBeDefined();
      expect(info.key).toBe(key);
      expect(info.nameBn.length).toBeGreaterThan(0);
      expect(info.nameEn.length).toBeGreaterThan(0);
      expect(info.descriptionBn.length).toBeGreaterThan(0);
      expect(Array.isArray(info.dependsOn)).toBe(true);
    }
  });

  it("enforces correct module dependencies", () => {
    expect(MODULE_INFO.pharmacy_catalog.dependsOn).toEqual(["units", "batch_expiry"]);
    expect(MODULE_INFO.prescription.dependsOn).toEqual(["pharmacy_catalog"]);

    const otherKeys = MODULE_KEYS.filter(
      (k) => k !== "pharmacy_catalog" && k !== "prescription"
    );
    for (const k of otherKeys) {
      expect(MODULE_INFO[k].dependsOn).toEqual([]);
    }
  });

  it("maps default modules by business type correctly", () => {
    expect(DEFAULT_MODULES_BY_BUSINESS_TYPE.fashion).toEqual([]);
    expect(DEFAULT_MODULES_BY_BUSINESS_TYPE.chemical).toEqual([
      "units",
      "batch_expiry",
      "chemical_safety",
      "b2b_wholesale",
    ]);
    expect(DEFAULT_MODULES_BY_BUSINESS_TYPE.pharmacy).toEqual([
      "units",
      "batch_expiry",
      "pharmacy_catalog",
      "prescription",
    ]);
    expect(DEFAULT_MODULES_BY_BUSINESS_TYPE.grocery).toEqual([
      "units",
      "batch_expiry",
      "b2b_wholesale",
    ]);
    expect(DEFAULT_MODULES_BY_BUSINESS_TYPE.electronics).toEqual(["serial_tracking"]);
    expect(DEFAULT_MODULES_BY_BUSINESS_TYPE.retail).toEqual([]);
    expect(DEFAULT_MODULES_BY_BUSINESS_TYPE.other).toEqual([]);

    for (const type of Object.keys(DEFAULT_MODULES_BY_BUSINESS_TYPE)) {
      expect(DEFAULT_MODULES_BY_BUSINESS_TYPE[type]).not.toContain("vat_mushak");
    }
  });

  describe("isModuleActive", () => {
    it("returns false for null, undefined, or empty flags", () => {
      expect(isModuleActive(null, "units")).toBe(false);
      expect(isModuleActive(undefined, "units")).toBe(false);
      expect(isModuleActive([], "units")).toBe(false);
      expect(isModuleActive({}, "units")).toBe(false);
    });

    it("returns true only when allowed AND enabled are both true (array format)", () => {
      const flags = [
        { key: "module.units", allowed: true, enabled: true },
        { key: "module.batch_expiry", allowed: true, enabled: false },
        { key: "module.chemical_safety", allowed: false, enabled: true },
        { key: "module.serial_tracking", allowed: false, enabled: false },
      ];

      expect(isModuleActive(flags, "units")).toBe(true);
      expect(isModuleActive(flags, "batch_expiry")).toBe(false);
      expect(isModuleActive(flags, "chemical_safety")).toBe(false);
      expect(isModuleActive(flags, "serial_tracking")).toBe(false);
      expect(isModuleActive(flags, "vat_mushak")).toBe(false);
    });

    it("supports raw key without module. prefix in array format", () => {
      const flags = [{ key: "units", allowed: true, enabled: true }];
      expect(isModuleActive(flags, "units")).toBe(true);
    });

    it("supports record/map format", () => {
      const flagsRecord = {
        "module.units": { allowed: true, enabled: true },
        "module.batch_expiry": { allowed: true, enabled: false },
        b2b_wholesale: { allowed: true, enabled: true },
      };
      expect(isModuleActive(flagsRecord, "units")).toBe(true);
      expect(isModuleActive(flagsRecord, "batch_expiry")).toBe(false);
      expect(isModuleActive(flagsRecord, "b2b_wholesale")).toBe(true);
      expect(isModuleActive(flagsRecord, "vat_mushak")).toBe(false);
    });

    it("supports boolean active map", () => {
      const activeMap = { units: true, batch_expiry: false };
      expect(isModuleActive(activeMap, "units")).toBe(true);
      expect(isModuleActive(activeMap, "batch_expiry")).toBe(false);
    });

    it("supports string array of active keys or Set", () => {
      const activeList = ["units", "batch_expiry"];
      expect(isModuleActive(activeList, "units")).toBe(true);
      expect(isModuleActive(activeList, "b2b_wholesale")).toBe(false);

      const activeSet = new Set(["units", "module.chemical_safety"]);
      expect(isModuleActive(activeSet, "units")).toBe(true);
      expect(isModuleActive(activeSet, "chemical_safety")).toBe(true);
      expect(isModuleActive(activeSet, "b2b_wholesale")).toBe(false);
    });
  });

  describe("findMissingDependencies", () => {
    it("returns empty array for modules with no dependencies", () => {
      expect(findMissingDependencies([], "units")).toEqual([]);
      expect(findMissingDependencies([], "batch_expiry")).toEqual([]);
      expect(findMissingDependencies([], "chemical_safety")).toEqual([]);
      expect(findMissingDependencies([], "b2b_wholesale")).toEqual([]);
      expect(findMissingDependencies([], "serial_tracking")).toEqual([]);
      expect(findMissingDependencies([], "vat_mushak")).toEqual([]);
    });

    it("detects missing dependencies for pharmacy_catalog", () => {
      expect(findMissingDependencies([], "pharmacy_catalog")).toEqual([
        "units",
        "batch_expiry",
      ]);
      expect(findMissingDependencies(["units"], "pharmacy_catalog")).toEqual([
        "batch_expiry",
      ]);
      expect(findMissingDependencies(["batch_expiry"], "pharmacy_catalog")).toEqual([
        "units",
      ]);
      expect(
        findMissingDependencies(["units", "batch_expiry"], "pharmacy_catalog")
      ).toEqual([]);
    });

    it("detects missing dependencies for prescription", () => {
      expect(findMissingDependencies([], "prescription")).toEqual(["pharmacy_catalog"]);
      expect(
        findMissingDependencies(["units", "batch_expiry"], "prescription")
      ).toEqual(["pharmacy_catalog"]);
      expect(findMissingDependencies(["pharmacy_catalog"], "prescription")).toEqual([]);
    });

    it("works with Set input", () => {
      const activeSet = new Set<string>(["units"]);
      expect(findMissingDependencies(activeSet, "pharmacy_catalog")).toEqual([
        "batch_expiry",
      ]);
    });
  });

  describe("getActiveModules & 3-level dependency chain", () => {
    it("returns all modules when allowed, enabled and all dependencies in chain are active", () => {
      const flags = [
        { key: "units", allowed: true, enabled: true },
        { key: "batch_expiry", allowed: true, enabled: true },
        { key: "pharmacy_catalog", allowed: true, enabled: true },
        { key: "prescription", allowed: true, enabled: true },
      ];
      const active = getActiveModules(flags);
      expect(active).toContain("units");
      expect(active).toContain("batch_expiry");
      expect(active).toContain("pharmacy_catalog");
      expect(active).toContain("prescription");
    });

    it("prescription -> pharmacy_catalog -> units: blocks entire 3-level chain when units is not active", () => {
      // units is NOT allowed
      const flags = [
        { key: "units", allowed: false, enabled: true },
        { key: "batch_expiry", allowed: true, enabled: true },
        { key: "pharmacy_catalog", allowed: true, enabled: true },
        { key: "prescription", allowed: true, enabled: true },
      ];

      const active = getActiveModules(flags);
      expect(active).toEqual(["batch_expiry"]);
      expect(isModuleActive(flags, "units")).toBe(false);
      expect(isModuleActive(flags, "pharmacy_catalog")).toBe(false);
      expect(isModuleActive(flags, "prescription")).toBe(false);
      expect(isModuleActive(flags, "batch_expiry")).toBe(true);
    });

    it("prescription -> pharmacy_catalog -> units: blocks prescription when pharmacy_catalog is disabled", () => {
      const flags = [
        { key: "units", allowed: true, enabled: true },
        { key: "batch_expiry", allowed: true, enabled: true },
        { key: "pharmacy_catalog", allowed: true, enabled: false }, // disabled by owner
        { key: "prescription", allowed: true, enabled: true },
      ];

      const active = getActiveModules(flags);
      expect(active).toContain("units");
      expect(active).toContain("batch_expiry");
      expect(active).not.toContain("pharmacy_catalog");
      expect(active).not.toContain("prescription");
    });
  });
});
