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

    const resJson = await res.json();
    const data = (resJson.data || resJson) as PosCatalogResponse;

    // Update clock offset
    if (data.serverTime) {
      await updateServerClockOffset(data.serverTime);
    }

    const products = data.products || [];
    const variants = data.variants || [];

    // Group variants by productId and normalize to PosProductVariant
    const variantsByProductId = new Map<string, any[]>();
    for (const v of variants) {
      const normalizedVariant = {
        ...v,
        stockLevels: [
          {
            branchId: options.branchId,
            qty: String(v.stockQty ?? 0),
          },
        ],
        optionValues: (v.optionValues || []).map((ov: any) => ({
          optionValue: {
            value: ov.value,
            option: {
              name: ov.optionName || ov.name,
            },
          },
        })),
      };

      if (!variantsByProductId.has(v.productId)) {
        variantsByProductId.set(v.productId, []);
      }
      variantsByProductId.get(v.productId)!.push(normalizedVariant);
    }

    // Write to Dexie in a single transaction
    await targetDb.transaction("rw", [targetDb.catalog, targetDb.stock, targetDb.settings], async () => {
      if (options.fullSync || !since) {
        await targetDb.catalog.clear();
        await targetDb.stock.clear();
      }

      // 1. Update stock table
      for (const v of variants) {
        await targetDb.stock.put({
          variantId: v.id,
          stockQty: v.stockQty ?? 0,
          updatedAt: v.updatedAt || new Date().toISOString(),
        });
      }

      // 2. Update catalog products
      for (const prod of products) {
        const prodVariants = variantsByProductId.get(prod.id) || (prod.variants || []);
        const allBarcodes: string[] = [];
        for (const v of prodVariants) {
          if (Array.isArray(v.barcodes)) {
            allBarcodes.push(...v.barcodes);
          }
        }
        const fullProd = {
          ...prod,
          variants: prodVariants,
          barcodes: Array.from(new Set(allBarcodes)),
        };
        await targetDb.catalog.put(fullProd);
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
