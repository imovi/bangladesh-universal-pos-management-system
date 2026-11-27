import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { db } from "../src/lib/pos/offline/db";
import { usePosModules } from "../src/lib/pos/use-pos-modules";
import * as authContext from "../src/lib/auth-context";

describe("usePosModules() Offline Unit Tests", () => {
  beforeEach(async () => {
    await db.settings.clear();
  });

  it("reads activeModules from db.settings when offline and user activeModules is empty", async () => {
    vi.spyOn(authContext, "useAuth").mockReturnValue({
      user: { activeModules: [] } as any,
    } as any);

    // Save active modules to offline db
    await db.settings.put({ key: "activeModules", value: ["units", "chemical_safety"] });

    const { result } = renderHook(() => usePosModules());

    await waitFor(() => {
      expect(result.current.activeModules).toEqual(["units", "chemical_safety"]);
    });

    expect(result.current.isModuleActive("units")).toBe(true);
    expect(result.current.isModuleActive("chemical_safety")).toBe(true);
    expect(result.current.isModuleActive("batch_expiry")).toBe(false);
  });

  it("falls back to empty list when offline db has no saved activeModules", async () => {
    vi.spyOn(authContext, "useAuth").mockReturnValue({
      user: { activeModules: [] } as any,
    } as any);

    const { result } = renderHook(() => usePosModules());

    await waitFor(() => {
      expect(result.current.activeModules).toEqual([]);
    });

    expect(result.current.isModuleActive("units")).toBe(false);
    expect(result.current.isModuleActive("batch_expiry")).toBe(false);
  });
});
