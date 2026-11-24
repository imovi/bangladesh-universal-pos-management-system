#!/usr/bin/env node
/**
 * scripts/smoke-prod.mjs
 *
 * Production smoke test for Universal POS.
 * Verifies core critical path against a running production environment:
 * 1. Sign up a tenant
 * 2. Log in
 * 3. Create a product with 2 variants
 * 4. Open a shift
 * 5. Make a cash sale
 * 6. Fetch the receipt
 * 7. Close the shift
 * 8. Verify automated backup container first run & /settings/backups status
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import child_process from "child_process";

// Allow self-signed certificates when testing against Caddy internal TLS on localhost
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const API_BASE = process.env.API_URL || "http://localhost:4000/api/v1";

console.log(`=== Starting Production Smoke Test against ${API_BASE} ===`);

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
    const err = new Error(`HTTP ${res.status} from ${endpoint}: Invalid JSON response: ${text.slice(0, 200)}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }

  if (!res.ok || json.success === false) {
    const errorMsg = json.error?.message || json.message || JSON.stringify(json);
    const err = new Error(`API error HTTP ${res.status} on ${endpoint}: ${errorMsg}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }

  return json.data !== undefined ? json.data : json;
}

function readBackupStatusFromVolume() {
  if (process.env.BACKUP_DIR) {
    const localStatus = path.join(process.env.BACKUP_DIR, "last-backup.json");
    if (fs.existsSync(localStatus)) {
      try {
        return JSON.parse(fs.readFileSync(localStatus, "utf8"));
      } catch {}
    }
  }
  // Try docker compose exec or docker exec
  try {
    const envArg = fs.existsSync("deploy/.env.production") ? " --env-file deploy/.env.production" : "";
    const out = child_process.execSync(
      `docker compose -f deploy/docker-compose.prod.yml${envArg} exec -T backup cat /backups/last-backup.json`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
    return JSON.parse(out.trim());
  } catch {
    try {
      const out = child_process.execSync(
        `docker exec universal-pos-prod-backup-1 cat /backups/last-backup.json`,
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
      );
      return JSON.parse(out.trim());
    } catch {
      return null;
    }
  }
}

async function runSmokeTest() {
  const runId = crypto.randomBytes(4).toString("hex");
  const slug = `smoke-${runId}`;
  const email = `smoke-${runId}@artisan.com`;
  const password = "SmokePassword123!";

  // 1. Sign up a tenant
  console.log(`[1/7] Signing up tenant '${slug}'...`);
  const signupRes = await apiRequest("/tenants/signup", {
    method: "POST",
    body: JSON.stringify({
      companyName: `Smoke Test Shop ${runId}`,
      slug,
      businessType: "fashion",
      owner: {
        name: "Smoke Owner",
        email,
        phone: `+88017${Math.floor(10000000 + Math.random() * 90000000)}`,
        password,
      },
      branch: {
        name: "Smoke Flagship Branch",
        code: `SFB-${runId.toUpperCase()}`,
        address: "Gulshan 2, Dhaka",
      },
    }),
  });

  const tenantId = signupRes.tenantId || signupRes.id;
  const branchId = signupRes.branchId || signupRes.branch?.id;
  console.log(`  -> Tenant created: ${tenantId}, Branch: ${branchId}`);

  // 2. Log in
  console.log(`[2/7] Logging in as ${email}...`);
  const loginRes = await apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      tenantSlug: slug,
      email,
      password,
    }),
  });

  const token = loginRes.accessToken;
  const user = loginRes.user;
  const activeBranchId = branchId || user.branchId || (user.branches && user.branches[0]?.id);
  console.log(`  -> Logged in successfully. Access token acquired.`);

  // 3. Create a product with 2 variants
  console.log(`[3/7] Creating product with 2 variants...`);
  const productRes = await apiRequest("/products", {
    method: "POST",
    token,
    body: JSON.stringify({
      name: `Smoke Classic Panjabi ${runId}`,
      sku: `PANJABI-${runId.toUpperCase()}`,
      priceMinor: 150000,
      costMinor: 80000,
      trackingMode: "none",
      variants: [
        {
          sku: `PANJABI-${runId.toUpperCase()}-M`,
          priceMinor: 150000,
          costMinor: 80000,
          optionValues: { Size: "M" },
        },
        {
          sku: `PANJABI-${runId.toUpperCase()}-L`,
          priceMinor: 150000,
          costMinor: 80000,
          optionValues: { Size: "L" },
        },
      ],
    }),
  });

  const productId = productRes.id;
  const variants = productRes.variants || [];
  if (variants.length < 2) {
    throw new Error(`Expected at least 2 variants created, got ${variants.length}`);
  }
  const variantM = variants[0];
  console.log(`  -> Product created (${productId}) with variants: ${variants.map(v => v.sku).join(", ")}`);

  // Add opening stock so variants can be sold
  console.log(`  -> Adding initial stock for variant ${variantM.sku}...`);
  await apiRequest("/inventory/opening-stock", {
    method: "POST",
    token,
    body: JSON.stringify({
      branchId: activeBranchId,
      items: [
        {
          variantId: variantM.id,
          quantity: 20,
          unitCostMinor: 80000,
        },
      ],
    }),
  });

  // Create register
  console.log(`  -> Creating register for branch ${activeBranchId}...`);
  const registerRes = await apiRequest("/registers", {
    method: "POST",
    token,
    body: JSON.stringify({
      branchId: activeBranchId,
      name: `Register 1 (${runId})`,
      code: `REG-${runId.slice(0, 4).toUpperCase()}`,
    }),
  });
  const registerId = registerRes.id;

  // 4. Open a shift
  console.log(`[4/7] Opening shift for register ${registerId}...`);
  const shiftRes = await apiRequest("/shifts/open", {
    method: "POST",
    token,
    body: JSON.stringify({
      registerId,
      branchId: activeBranchId,
      openingCashMinor: 50000, // ৳500.00
      notes: "Smoke test opening shift",
    }),
  });
  const shiftId = shiftRes.id;
  console.log(`  -> Shift opened: ${shiftId}`);

  // 5. Make a cash sale
  console.log(`[5/7] Making cash sale for variant ${variantM.sku}...`);
  const saleId = crypto.randomUUID();
  const saleRes = await apiRequest("/sales", {
    method: "POST",
    token,
    headers: {
      "Idempotency-Key": saleId,
    },
    body: JSON.stringify({
      id: saleId,
      shiftId,
      branchId: activeBranchId,
      expectedTotalMinor: 150000,
      items: [
        {
          variantId: variantM.id,
          quantity: 1,
          unitPriceMinor: 150000,
        },
      ],
      payments: [
        {
          paymentMethod: "cash",
          amountMinor: 150000,
        },
      ],
      notes: "Smoke test sale",
    }),
  });
  const invoiceNumber = saleRes.invoiceNumber || saleRes.invoice_number;
  console.log(`  -> Sale committed: ${saleId}, Invoice: ${invoiceNumber}, Total: ৳${(saleRes.totalMinor / 100).toFixed(2)}`);

  // 6. Fetch the receipt
  console.log(`[6/7] Fetching receipt for sale ${saleId}...`);
  const receiptRes = await apiRequest(`/sales/${saleId}`, {
    method: "GET",
    token,
  });
  if (!receiptRes.id || receiptRes.id !== saleId) {
    throw new Error(`Receipt fetch returned invalid sale id: ${receiptRes.id}`);
  }
  console.log(`  -> Receipt verified: Invoice ${receiptRes.invoiceNumber}, Items: ${receiptRes.items?.length || 0}`);

  // 7. Close the shift
  console.log(`[7/8] Closing shift ${shiftId}...`);
  const closeRes = await apiRequest(`/shifts/${shiftId}/close`, {
    method: "POST",
    token,
    body: JSON.stringify({
      closingCashMinor: 200000, // ৳500 opening + ৳1500 sale = ৳2000
      notes: "Smoke test closing shift",
    }),
  });
  console.log(`  -> Shift closed: Status ${closeRes.status}`);

  // 8. Verify automated backup container first run & /settings/backups
  console.log(`[8/8] Verifying backup container first run & /settings/backups status...`);
  let backupApiResponse = null;
  let lastError = null;
  for (let attempt = 1; attempt <= 15; attempt++) {
    try {
      backupApiResponse = await apiRequest("/settings/backups", {
        method: "GET",
        token,
      });
      if (backupApiResponse?.lastBackupAt && (backupApiResponse.ok === true || backupApiResponse.ok === undefined)) {
        break;
      }
    } catch (err) {
      lastError = err;
      if (err.status === 401 || err.status === 403) {
        throw new Error(
          `Immediate failure on HTTP ${err.status} accessing /settings/backups: ${err.message}\nAPI Response Body: ${JSON.stringify(err.body, null, 2)}`
        );
      }
      // Backup service may still be performing initial dump
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (!backupApiResponse || !backupApiResponse.lastBackupAt) {
    if (lastError) {
      console.error(`Last error received from /settings/backups (HTTP ${lastError.status}):`, lastError.body);
    }
    throw new Error(`Backup service did not complete initial backup within 30 seconds. Last error: ${lastError?.message}`);
  }
  if (backupApiResponse.ok === false) {
    throw new Error(`Backup service reported failure: ${backupApiResponse.reason}`);
  }
  if (!backupApiResponse.lastBackupFilename || !backupApiResponse.lastBackupSizeBytes) {
    throw new Error("Backup status missing valid filename or size in bytes");
  }

  const backupStatusJson = readBackupStatusFromVolume();
  console.log(`[BACKUP_CONTAINER] Backup container first backup finished successfully.`);
  console.log(`[BACKUP_STATUS_JSON] ${JSON.stringify(backupStatusJson, null, 2)}`);
  console.log(`[BACKUPS_API_RESPONSE] ${JSON.stringify(backupApiResponse, null, 2)}`);

  // Assert matching filename
  if (backupStatusJson?.filename && backupApiResponse.lastBackupFilename) {
    if (backupStatusJson.filename !== backupApiResponse.lastBackupFilename) {
      throw new Error(
        `Filename mismatch: API returned '${backupApiResponse.lastBackupFilename}' but volume status JSON has '${backupStatusJson.filename}'`
      );
    }
  }

  console.log(
    `  -> Initial backup verified: File: ${backupApiResponse.lastBackupFilename}, Size: ${backupApiResponse.lastBackupSizeBytes} B, Timestamp: ${backupApiResponse.lastBackupAt}`
  );

  console.log(`\n=== [SUCCESS] All 8 production smoke test steps completed successfully! ===\n`);
}

runSmokeTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\n[FAIL] Smoke test failed: ${err.message}\n`, err.stack);
    process.exit(1);
  });
