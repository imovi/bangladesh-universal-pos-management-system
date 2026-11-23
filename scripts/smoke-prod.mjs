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
    throw new Error(`HTTP ${res.status} from ${endpoint}: Invalid JSON response: ${text.slice(0, 200)}`);
  }

  if (!res.ok || json.success === false) {
    const errorMsg = json.error?.message || json.message || JSON.stringify(json);
    throw new Error(`API error HTTP ${res.status} on ${endpoint}: ${errorMsg}`);
  }

  return json.data !== undefined ? json.data : json;
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
  let backupStatus = null;
  for (let attempt = 1; attempt <= 15; attempt++) {
    try {
      backupStatus = await apiRequest("/settings/backups", {
        method: "GET",
        token,
      });
      if (backupStatus?.lastBackupAt && (backupStatus.ok === true || backupStatus.ok === undefined)) {
        break;
      }
    } catch {
      // Backup service may still be performing initial dump
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (!backupStatus || !backupStatus.lastBackupAt) {
    throw new Error("Backup service did not complete initial backup within 30 seconds");
  }
  if (backupStatus.ok === false) {
    throw new Error(`Backup service reported failure: ${backupStatus.reason}`);
  }
  if (!backupStatus.lastBackupFilename || !backupStatus.lastBackupSizeBytes) {
    throw new Error("Backup status missing valid filename or size in bytes");
  }
  console.log(`  -> Initial backup verified: File: ${backupStatus.lastBackupFilename}, Size: ${backupStatus.lastBackupSizeBytes} B, Timestamp: ${backupStatus.lastBackupAt}`);

  console.log(`\n=== [SUCCESS] All 8 production smoke test steps completed successfully! ===\n`);
}

runSmokeTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\n[FAIL] Smoke test failed: ${err.message}\n`, err.stack);
    process.exit(1);
  });
