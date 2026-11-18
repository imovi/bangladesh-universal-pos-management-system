import { db, PosOfflineDatabase } from "./db";
import { updateServerClockOffset } from "./clock";
import type { PosCatalogResponse } from "./types";

export interface SyncCatalogOptions {
  branchId: string;
  baseUrl?: string;
  token?: string;
  fullSync?: boolean;
  database?: PosOfflineDatabase;
  customFetcher?: (url: string, init?: RequestInit) => Promise<Response>;
}

export async function syncCatalog(
  options: SyncCatalogOptions
): Promise<{ success: boolean; version: number; count: number; error?: string }> {
  const targetDb = options.database || db;
  const baseUrl = options.baseUrl || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";

  try {
    let since: string | undefined = undefined;
    if (!options.fullSync) {
      const storedCursor = await targetDb.settings.get("catalogCursor");
      if (storedCursor && typeof storedCursor.value === "string") {
        since = storedCursor.value;
      }
    }

    const query = new URLSearchParams({ branchId: options.branchId });
    if (since) {
      query.set("since", since);
    }

    const url = `${baseUrl}/pos/catalog?${query.toString()}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (options.token) {
      headers["Authorization"] = `Bearer ${options.token}`;
    }

    const fetchFn = options.customFetcher || fetch;
    const res = await fetchFn(url, { headers });

    if (!res.ok) {
      const errText = await res.text();
      return {
        success: false,
        version: 0,
        count: 0,
        error: `HTTP ${res.status}: ${errText}`,
      };
    }

    const data = (await res.json()) as PosCatalogResponse;

    // Update clock offset
    if (data.serverTime) {
      await updateServerClockOffset(data.serverTime);
    }

    // Write to Dexie in a single transaction
    await targetDb.transaction("rw", [targetDb.catalog, targetDb.stock, targetDb.settings], async () => {
      if (options.fullSync || !since) {
        await targetDb.catalog.clear();
        await targetDb.stock.clear();
      }

      for (const prod of data.products) {
        // Collect barcodes from product variants
        const allBarcodes: string[] = [];
        if (prod.variants) {
          for (const v of prod.variants) {
            if (Array.isArray(v.barcodes)) {
              allBarcodes.push(...v.barcodes);
            }
            // Update stock
            await targetDb.stock.put({
              variantId: v.id,
              stockQty: v.stockQty ?? 0,
              updatedAt: new Date().toISOString(),
            });
          }
        }
        prod.barcodes = Array.from(new Set(allBarcodes));
        await targetDb.catalog.put(prod);
      }

      await targetDb.settings.put({
        key: "catalogVersion",
        value: data.catalogVersion,
      });

      if (data.cursor) {
        await targetDb.settings.put({
          key: "catalogCursor",
          value: data.cursor,
        });
      }

      await targetDb.settings.put({
        key: "catalogLastSyncedAt",
        value: Date.now(),
      });
    });

    return {
      success: true,
      version: data.catalogVersion,
      count: data.products.length,
    };
  } catch (err: any) {
    return {
      success: false,
      version: 0,
      count: 0,
      error: err.message || String(err),
    };
  }
}
