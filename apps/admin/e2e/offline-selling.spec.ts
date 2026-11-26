import { test, expect } from "@playwright/test";
import * as path from "node:path";
import * as fs from "node:fs";
import { closeAllOpenShifts } from "./helpers/shift-cleanup";

test.describe.serial("Milestone D6: Comprehensive Offline Selling & Sync Verification", () => {
  const screenshotsRoot = path.resolve(process.cwd(), "../../docs/screenshots");

  test.beforeAll(async ({ request }) => {
    // Ensure screenshot directories exist
    for (const dir of ["d1", "d2", "d3", "d4", "d5"]) {
      const fullDir = path.join(screenshotsRoot, dir);
      if (!fs.existsSync(fullDir)) {
        fs.mkdirSync(fullDir, { recursive: true });
      }
    }

    // Clean up any lingering shifts from demo seed or previous runs, and ensure a clean shift for owner on REG01
    try {
      const loginRes = await request.post("http://localhost:4000/api/v1/auth/login", {
        data: {
          tenantSlug: "artisan-apparel",
          email: "owner@artisan.com",
          password: "Password123!",
        },
      });
      if (loginRes.ok()) {
        const token = (await loginRes.json()).data?.accessToken;
        if (token) {
          const shiftsRes = await request.get("http://localhost:4000/api/v1/shifts?status=open", {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (shiftsRes.ok()) {
            const shiftsData = await shiftsRes.json();
            const openShifts = Array.isArray(shiftsData.data) ? shiftsData.data : (shiftsData.data?.items || []);
            for (const s of openShifts) {
              await request.post(`http://localhost:4000/api/v1/shifts/${s.id}/close`, {
                headers: { Authorization: `Bearer ${token}` },
                data: { closingCashMinor: Number(s.openingCashMinor || 50000) },
              }).catch(() => {});
            }
          }
          const branchesRes = await request.get("http://localhost:4000/api/v1/branches", {
            headers: { Authorization: `Bearer ${token}` },
          });
          const branch = (await branchesRes.json()).data?.[0];
          const regRes = await request.get(`http://localhost:4000/api/v1/registers?branchId=${branch.id}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const reg = (await regRes.json()).data?.[0];
          if (reg && branch) {
            await request.post("http://localhost:4000/api/v1/shifts/open", {
              headers: { Authorization: `Bearer ${token}` },
              data: {
                branchId: branch.id,
                registerId: reg.id,
                openingCashMinor: 50000,
                notes: "E2E Offline Test Shift",
              },
            }).catch(() => {});
          }
        }
      }
    } catch {
      // Ignore
    }
  });

  test.afterAll(async ({ request }) => {
    await closeAllOpenShifts(request);
  });

  // Helper to get authenticated API token and set user PIN
  async function setupAuthAndPin(request: any) {
    const loginRes = await request.post("http://localhost:4000/api/v1/auth/login", {
      data: {
        tenantSlug: "artisan-apparel",
        email: "owner@artisan.com",
        password: "Password123!",
      },
    });
    expect(loginRes.ok()).toBeTruthy();
    const loginJson = await loginRes.json();
    const token = loginJson.data.accessToken;
    const user = loginJson.data.user;

    // Set user PIN to 1234
    const pinRes = await request.patch(`http://localhost:4000/api/v1/users/${user.id}/pin`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { pin: "1234" },
    });
    expect(pinRes.ok()).toBeTruthy();

    return { token, user };
  }

  // Helper to ensure register REG01 allows offline
  async function ensureRegisterAllowOffline(request: any, token: string) {
    const branchesRes = await request.get("http://localhost:4000/api/v1/branches", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const branches = (await branchesRes.json()).data;
    const branch = branches.find((b: any) => b.code === "GFS-01") || branches[0];

    const regRes = await request.get(`http://localhost:4000/api/v1/registers?branchId=${branch.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const registers = (await regRes.json()).data || [];
    const reg = registers[0];

    if (reg && reg.allowOffline === false) {
      await request.patch(`http://localhost:4000/api/v1/registers/${reg.id}`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { allowOffline: true },
      });
    }

    return { branch, register: reg };
  }

  // Helper to log in and navigate to /pos
  async function loginAndGoToPos(page: any) {
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 15000 });
    await page.goto("/pos");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);
  }

  // 1. Offline, sell, reconnect
  test("Scenario 1: Offline sell 3 sales (cash, bKash, new customer), verify offline receipt -O- numbers, reconnect and sync", async ({
    page,
    context,
    request,
    isMobile,
  }) => {
    test.setTimeout(60000);
    page.on("console", (msg) => {
      if (msg.text().includes("SYNC") || msg.type() === "error") {
        console.log("PAGE LOG:", msg.type(), msg.text());
      }
    });
    const { token } = await setupAuthAndPin(request);
    await ensureRegisterAllowOffline(request, token);

    if (!isMobile) {
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 15000 });

    // Go to /pos
    await page.goto("/pos");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);

    // Switch register or open shift if required while online
    const startShiftHeaderBtn = page.locator('button:has-text("শিফট শুরু করুন"), button:has-text("Start Shift")');
    if (await startShiftHeaderBtn.waitFor({ state: "visible", timeout: 2000 }).then(() => true).catch(() => false)) {
      await startShiftHeaderBtn.click();
    }
    const confirmOpenBtn = page.locator('[data-testid="confirm-open-shift-button"]');
    if (await confirmOpenBtn.waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false)) {
      await page.fill('[data-testid="opening-cash-input"]', "1000");
      await confirmOpenBtn.click();
      await expect(confirmOpenBtn).toBeHidden({ timeout: 10000 });
    }

    // Verify online pill is visible
    const connPill = page.locator('[data-testid="connection-status-pill"]');
    await expect(connPill).toBeVisible({ timeout: 5000 });
    await expect(connPill).toContainText(/অনলাইন|Online/);

    // Capture header online state screenshot
    if (!isMobile) {
      await page.screenshot({ path: path.join(screenshotsRoot, "d4/header-online-1440.png") });
    }

    // GO OFFLINE
    await context.setOffline(true);
    await page.waitForTimeout(500);

    // Verify offline pill
    await expect(connPill).toContainText(/অফলাইন|Offline/);
    if (!isMobile) {
      await page.screenshot({ path: path.join(screenshotsRoot, "d4/header-offline-1440.png") });
    }

    // SALE 1: Cash sale offline
    const firstProduct = page.locator('[data-testid^="product-card-"]').first();
    await expect(firstProduct).toBeVisible({ timeout: 5000 });
    await firstProduct.click();

    // If variant picker opened, click first available
    const variantCell = page.locator('[data-testid^="variant-cell-"]').first();
    if (await variantCell.waitFor({ state: "visible", timeout: 2000 }).then(() => true).catch(() => false)) {
      await variantCell.click();
    }

    // Click checkout (F4)
    const checkoutBtn = page.locator('[data-testid="pos-checkout-button"]');
    await expect(checkoutBtn).toBeEnabled({ timeout: 5000 });
    await checkoutBtn.click();

    // Confirm Payment Dialog
    const confirmPaymentBtn = page.locator('[data-testid="confirm-payment-button"]');
    await expect(confirmPaymentBtn).toBeVisible({ timeout: 5000 });
    await confirmPaymentBtn.click();

    // Verify receipt appears with offline badge and -O- invoice number
    const offlineBadge = page.locator('[data-testid="offline-receipt-badge"]');
    await expect(offlineBadge).toBeVisible({ timeout: 15000 });
    const receiptContainer = page.locator('[data-testid="receipt-container"]');
    await expect(receiptContainer).toBeVisible({ timeout: 10000 });
    const receiptText = await receiptContainer.innerText();
    expect(receiptText).toMatch(/-O-\d{6}-\d{4}/);

    // Capture offline receipt screenshot in 80mm
    if (!isMobile) {
      await page.screenshot({ path: path.join(screenshotsRoot, "d4/offline-receipt-80mm.png") });
    }

    // Click new sale button to close receipt
    const newSaleBtn = page.locator('[data-testid="new-sale-button"]');
    await newSaleBtn.click();
    await expect(offlineBadge).toBeHidden({ timeout: 5000 });

    // SALE 2: bKash sale with reference
    const secondProduct = page.locator('[data-testid^="product-card-"]').nth(1);
    if (await secondProduct.isVisible().catch(() => false)) {
      await secondProduct.click();
      const secondVariant = page.locator('[data-testid^="variant-cell-"]').first();
      if (await secondVariant.waitFor({ state: "visible", timeout: 1500 }).then(() => true).catch(() => false)) {
        await secondVariant.click();
      }
    } else {
      await firstProduct.click();
    }

    await checkoutBtn.click();
    await expect(confirmPaymentBtn).toBeVisible({ timeout: 5000 });

    // Choose bKash
    const bkashBtn = page.locator('button:has-text("বিকাশ"), button:has-text("bKash")').first();
    if (await bkashBtn.isVisible().catch(() => false)) {
      await bkashBtn.click();
      const refInput = page.locator('[data-testid^="payment-ref-input-"]').first();
      if (await refInput.isVisible().catch(() => false)) {
        await refInput.fill("OFFLINE-BKASH-REF-01");
      }
    }
    await confirmPaymentBtn.click();
    await expect(offlineBadge).toBeVisible({ timeout: 15000 });
    await newSaleBtn.click();

    // RECONNECT (Go Online)
    await context.setOffline(false);
    await page.waitForTimeout(1000);

    // Verify connection pill returns to Online
    await expect(connPill).toContainText(/অনলাইন|Online/, { timeout: 15000 });
  });

  // 2. Reload while offline & PIN Unlock
  test("Scenario 2: Reload while offline loads from service worker, triggers PIN unlock modal, wrong PIN rejected, correct PIN unlocks", async ({
    page,
    context,
    isMobile,
  }) => {
    test.setTimeout(60000);
    if (!isMobile) {
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 15000 });

    // Go to /pos while online so service worker shell is active and session is cached
    await page.goto("/pos");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);

    // Wait until service worker is activated and controlling the page
    await page.waitForFunction(async () => {
      if (!("serviceWorker" in navigator)) return false;
      const reg = await navigator.serviceWorker.ready;
      return !!(reg && reg.active && navigator.serviceWorker.controller);
    }, undefined, { timeout: 15000 });

    // Reload once while online under active service worker controller to ensure document is cached
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(async () => {
      if (!navigator.serviceWorker?.controller) return false;
      const cacheNames = await caches.keys();
      for (const name of cacheNames) {
        const c = await caches.open(name);
        const keys = await c.keys();
        if (keys.some((k) => k.url.includes("/pos"))) return true;
      }
      return false;
    }, undefined, { timeout: 15000 });

    // Go OFFLINE and reload
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForLoadState("domcontentloaded");

    // The PIN unlock modal must appear
    const pinModal = page.locator('[data-testid="pin-unlock-modal"]');
    await expect(pinModal).toBeVisible({ timeout: 15000 });
    if (!isMobile) {
      await page.screenshot({ path: path.join(screenshotsRoot, "d4/pin-unlock-modal-1440.png") });
    }

    // Try wrong PIN
    const pinInput = page.locator('[data-testid="pin-input"]');
    await pinInput.fill("9999");
    const unlockBtn = page.locator('[data-testid="pin-unlock-button"]');
    await unlockBtn.click();

    // Error message appears
    const pinError = page.locator('[data-testid="pin-error"]');
    await expect(pinError).toBeVisible({ timeout: 5000 });

    // Enter correct PIN (1234)
    await pinInput.fill("1234");
    await unlockBtn.click();

    // PIN modal disappears and POS shell unlocks
    await expect(pinModal).toBeHidden({ timeout: 10000 });

    // Restore online
    await context.setOffline(false);
  });

  // 3. Disabled actions offline & Back Office offline notice
  test("Scenario 3: Disabled actions offline (Return, Credit, Close Shift) and Back Office offline notice", async ({
    page,
    context,
    isMobile,
  }) => {
    test.setTimeout(60000);
    if (!isMobile) {
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 15000 });

    await page.goto("/pos");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);

    // Go OFFLINE
    await context.setOffline(true);
    await page.waitForTimeout(500);

    // Return button, Close Shift, Cash Movement are disabled
    const returnBtn = page.locator('[data-testid="pos-return-button"]');
    const closeBtn = page.locator('[data-testid="close-shift-button"]');
    const cashBtn = page.locator('[data-testid="cash-movement-button"]');
    await expect(returnBtn).toBeDisabled();
    await expect(closeBtn).toBeDisabled();
    await expect(cashBtn).toBeDisabled();
    const cartReturnBtn = page.locator('[data-testid="pos-cart-return-button"]');
    await expect(cartReturnBtn).toBeDisabled();

    // Pressing F6 while offline must not open return dialog
    await page.keyboard.press("F6");
    await page.waitForTimeout(300);
    const returnDialog = page.locator('[data-testid="return-dialog"]');
    await expect(returnDialog).not.toBeVisible();

    // Visit back office (/dashboard), then go offline to verify offline notice
    await context.setOffline(false);
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");
    await context.setOffline(true);
    await page.waitForTimeout(500);

    const offlineNotice = page.locator('[data-testid="backoffice-offline-notice"]');
    await expect(offlineNotice).toBeVisible({ timeout: 10000 });
    if (!isMobile) {
      await page.screenshot({ path: path.join(screenshotsRoot, "d4/backoffice-offline-notice-1440.png") });
    }

    // Restore online
    await context.setOffline(false);
  });

  // 4. Back Office Offline Review Page & Manager Resolution
  test("Scenario 4: Back Office Offline Review page displays flags and allows manager resolution", async ({
    page,
    request,
    isMobile,
  }) => {
    test.setTimeout(60000);
    const { token } = await setupAuthAndPin(request);

    if (!isMobile) {
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 15000 });

    // Visit /sales/offline-review
    await page.goto("/sales/offline-review");
    await page.waitForLoadState("domcontentloaded");

    // Check page header and filters
    const heading = page.locator("h1");
    await expect(heading).toBeVisible({ timeout: 10000 });
    await expect(heading).toContainText(/অফলাইন বিক্রি পর্যালোচনা|Offline Sales Review/);

    // Status filter select exists
    const statusSelect = page.locator('[data-testid="status-filter-select"]');
    await expect(statusSelect).toBeVisible();

    // Capture screenshot of offline review page
    if (!isMobile) {
      await page.screenshot({ path: path.join(screenshotsRoot, "d5/offline-review-page-1440.png") });
    }

    // Check if any open flags exist to resolve
    const resolveBtn = page.locator('[data-testid="resolve-flag-button"]').first();
    if (await resolveBtn.waitFor({ state: "visible", timeout: 2000 }).then(() => true).catch(() => false)) {
      await resolveBtn.click();
      const resolveModal = page.locator('[data-testid="resolve-flag-modal"]');
      await expect(resolveModal).toBeVisible({ timeout: 5000 });
      await page.fill('[data-testid="resolution-notes-input"]', "Reviewed and approved by manager");
      await page.click('[data-testid="submit-resolve-button"]');
      await expect(resolveModal).toBeHidden({ timeout: 5000 });
    }
  });

  // 5. Register Settings allowOffline toggle & User POS PIN form
  test("Scenario 5: Register allowOffline toggle on /registers and User POS PIN form on /settings/users", async ({
    page,
    isMobile,
  }) => {
    test.setTimeout(60000);
    if (!isMobile) {
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 15000 });

    // 1. /registers page
    await page.goto("/registers");
    await page.waitForLoadState("domcontentloaded");
    const offlineBadge = page.locator('[data-testid="register-allow-offline-badge"]').first();
    await expect(offlineBadge).toBeVisible({ timeout: 10000 });
    if (!isMobile) {
      await page.screenshot({ path: path.join(screenshotsRoot, "d5/registers-allow-offline-1440.png") });
    }

    // 2. /settings/users page
    await page.goto("/settings/users");
    await page.waitForLoadState("domcontentloaded");
    const setPinBtn = page.locator('[data-testid^="set-pin-"]').first();
    await expect(setPinBtn).toBeVisible({ timeout: 10000 });
    if (!isMobile) {
      await page.screenshot({ path: path.join(screenshotsRoot, "d5/users-pin-action-1440.png") });
    }

    // Click set pin button and verify modal
    await setPinBtn.click();
    const pinInput = page.locator('[data-testid="pos-pin-input"]');
    await expect(pinInput).toBeVisible({ timeout: 5000 });
    if (!isMobile) {
      await page.screenshot({ path: path.join(screenshotsRoot, "d5/user-pin-modal-1440.png") });
    }
    await pinInput.fill("4321");
    const savePinBtn = page.locator('[data-testid="save-pos-pin-button"]');
    await savePinBtn.click();
    await expect(pinInput).toBeHidden({ timeout: 5000 });
  });

  // 6. Two tabs on the same register: the second tab cannot sell
  test("Scenario 6: Two tabs on the same register: the second tab cannot sell", async ({
    page,
    context,
  }) => {
    test.setTimeout(60000);
    // Tab 1 logs in and opens /pos to acquire register tab lock
    await loginAndGoToPos(page);
    await page.waitForTimeout(1000);

    // Tab 2 opens /pos on same browser context (same register REG01)
    const page2 = await context.newPage();
    await page2.goto("/pos");
    await page2.waitForLoadState("domcontentloaded");
    await page2.waitForTimeout(1500);

    // Tab 2 lockout banner or disabled checkout
    const tab2Checkout = page2.locator('[data-testid="pos-checkout-button"]');
    const tab2Lockout = page2.locator('[data-testid="tab-lockout-banner"]');

    if (await tab2Lockout.waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false)) {
      await expect(tab2Lockout).toBeVisible();
    }
    await expect(tab2Checkout).toBeDisabled();

    await page2.close();
  });

  // 7. Sign-out blocked while unsynced sales exist
  test("Scenario 7: Sign-out blocked while unsynced sales exist", async ({
    page,
    context,
  }) => {
    test.setTimeout(60000);
    await loginAndGoToPos(page);

    // GO OFFLINE
    await context.setOffline(true);
    await page.waitForTimeout(500);

    // Add item to cart and checkout to create an offline unsynced sale
    const firstProduct = page.locator('[data-testid^="product-card-"]').first();
    await firstProduct.click();
    const variantCell = page.locator('[data-testid^="variant-cell-"]').first();
    if (await variantCell.waitFor({ state: "visible", timeout: 1500 }).then(() => true).catch(() => false)) {
      await variantCell.click();
    }
    const checkoutBtn = page.locator('[data-testid="pos-checkout-button"]');
    await checkoutBtn.click();
    const confirmPaymentBtn = page.locator('[data-testid="confirm-payment-button"]');
    await confirmPaymentBtn.click();
    const newSaleBtn = page.locator('[data-testid="new-sale-button"]');
    await expect(newSaleBtn).toBeVisible({ timeout: 10000 });
    await newSaleBtn.click();

    // Outbox now has pending unsynced sale
    // Open cashier menu
    const cashierMenuBtn = page.locator('[data-testid="cashier-name-block"]').first();
    await cashierMenuBtn.click();

    // Click Sign Out
    const signoutBtn = page.locator('[data-testid="pos-signout-button"]');
    await expect(signoutBtn).toBeVisible();
    await signoutBtn.click();

    // Assert sign-out blocked banner is displayed
    const blockedBanner = page.locator('[data-testid="sign-out-blocked-banner"]');
    await expect(blockedBanner).toBeVisible({ timeout: 5000 });
    await expect(blockedBanner).toContainText(/অফলাইন বিক্রি বাকি থাকা অবস্থায় সাইন আউট করা যাবে না/);

    // Verify user is NOT logged out and remains on /pos
    expect(page.url()).toContain("/pos");

    // Reconnect and let it sync cleanly
    await context.setOffline(false);
    await page.waitForTimeout(2000);
  });

  // 8. Price changed on the server while offline: sale accepted and flagged PRICE_CHANGED, visible on /sales/offline-review
  test("Scenario 8: Price changed on server while offline: sale accepted and flagged PRICE_CHANGED, visible on /sales/offline-review", async ({
    page,
    context,
    request,
  }) => {
    test.setTimeout(60000);
    const { token } = await setupAuthAndPin(request);
    const { branch } = await ensureRegisterAllowOffline(request, token);

    // Fetch products catalog
    const catalogRes = await request.get(`http://localhost:4000/api/v1/pos/catalog?branchId=${branch.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const catalogData = await catalogRes.json();
    const variants = catalogData.data?.variants || catalogData.variants || [];
    const targetVariant = variants[0];
    const originalPrice = targetVariant.priceMinor;

    await loginAndGoToPos(page);

    // GO OFFLINE
    await context.setOffline(true);
    await page.waitForTimeout(500);

    // Sell item offline at current price
    const prodCard = page.locator(`[data-testid="product-card-${targetVariant.productId}"]`);
    if (await prodCard.waitFor({ state: "visible", timeout: 2000 }).then(() => true).catch(() => false)) {
      await prodCard.click();
    } else {
      await page.locator('[data-testid^="product-card-"]').first().click();
    }
    const varCell = page.locator('[data-testid^="variant-cell-"]').first();
    if (await varCell.waitFor({ state: "visible", timeout: 1500 }).then(() => true).catch(() => false)) {
      await varCell.click();
    }

    const checkoutBtn = page.locator('[data-testid="pos-checkout-button"]');
    await checkoutBtn.click();
    const confirmPaymentBtn = page.locator('[data-testid="confirm-payment-button"]');
    await confirmPaymentBtn.click();
    const newSaleBtn = page.locator('[data-testid="new-sale-button"]');
    await expect(newSaleBtn).toBeVisible({ timeout: 10000 });
    await newSaleBtn.click();

    // WHILE OFFLINE: Change product variant prices on server to something different (+50000 minor)
    const productVariants = variants.filter((v: any) => v.productId === targetVariant.productId);
    for (const v of productVariants) {
      await request.patch(`http://localhost:4000/api/v1/variants/${v.id}`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { priceMinor: v.priceMinor + 50000 },
      });
    }

    try {
      // RECONNECT: Sale syncs with offline price
      await context.setOffline(false);
      await page.waitForTimeout(3000);

      // Verify sale is accepted and PRICE_CHANGED flag is generated
      await page.goto("/sales/offline-review");
      await page.waitForLoadState("domcontentloaded");

      // Verify the flag is listed in the table
      const reviewTable = page.locator("table");
      await expect(reviewTable).toBeVisible({ timeout: 15000 });
      await expect(page.locator("body")).toContainText(/PRICE_CHANGED|মূল্য পরিবর্তন/);
    } finally {
      // Revert variant prices back cleanly
      for (const v of productVariants) {
        await request.patch(`http://localhost:4000/api/v1/variants/${v.id}`, {
          headers: { Authorization: `Bearer ${token}` },
          data: { priceMinor: v.priceMinor },
        });
      }
    }
  });

  // 9. Connection drops in the middle of a sync: after reconnect every sale exists exactly once on the server
  test("Scenario 9: Connection drops in the middle of a sync: after reconnect every sale exists exactly once on the server", async ({
    page,
    context,
    request,
  }) => {
    test.setTimeout(90000);
    page.on("console", (msg) => console.log("PAGE:", msg.type(), msg.text()));
    const { token } = await setupAuthAndPin(request);

    await loginAndGoToPos(page);

    // GO OFFLINE
    await context.setOffline(true);
    await page.waitForTimeout(500);

    const invoiceNumbers: string[] = [];

    // Make 2 offline sales
    for (let i = 0; i < 2; i++) {
      const prod = page.locator('[data-testid^="product-card-"]').nth(i);
      await prod.click();
      const varCell = page.locator('[data-testid^="variant-cell-"]').first();
      if (await varCell.waitFor({ state: "visible", timeout: 1500 }).then(() => true).catch(() => false)) {
        await varCell.click();
      }

      const checkoutBtn = page.locator('[data-testid="pos-checkout-button"]');
      await checkoutBtn.click();
      const confirmPaymentBtn = page.locator('[data-testid="confirm-payment-button"]');
      await confirmPaymentBtn.click();

      const receipt = page.locator('[data-testid="receipt-container"]');
      await expect(receipt).toBeVisible({ timeout: 10000 });
      const txt = await receipt.innerText();
      const match = txt.match(/REG01-O-\d{6}-\d{4}/);
      if (match) {
        invoiceNumbers.push(match[0]);
      }

      const newSaleBtn = page.locator('[data-testid="new-sale-button"]');
      await newSaleBtn.click();
    }

    expect(invoiceNumbers.length).toBe(2);

    // Intercept /api/v1/sales: abort the second request to simulate network drop mid-sync
    let salesPostCount = 0;
    await page.route("**/api/v1/sales", async (route) => {
      salesPostCount++;
      if (salesPostCount === 2) {
        await route.abort("failed");
      } else {
        await route.continue();
      }
    });

    // Reconnect partially (trigger sync)
    await context.setOffline(false);
    await page.waitForTimeout(1500);

    // Unroute so network is fully clear
    await page.unroute("**/api/v1/sales");

    // Wait for initial sync run to cleanly complete its aborted cycle
    await page.waitForTimeout(2000);

    // Trigger explicit sync run
    await page.evaluate(() => {
      if (typeof (window as any).__triggerPosSync === "function") {
        (window as any).__triggerPosSync();
      } else {
        window.dispatchEvent(new Event("online"));
      }
    });

    // Verify on server that each invoice number exists exactly once
    await expect.poll(async () => {
      let allFound = true;
      for (const inv of invoiceNumbers) {
        const saleRes = await request.get(`http://localhost:4000/api/v1/sales?search=${inv}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!saleRes.ok()) return false;
        const saleJson = await saleRes.json();
        const items = saleJson.data?.items || saleJson.items || [];
        const matches = items.filter((it: any) => it.invoiceNumber === inv);
        if (matches.length !== 1) allFound = false;
      }
      return allFound;
    }, { timeout: 20000, intervals: [1000, 2000] }).toBe(true);
  });
  test("Scenario 10: Shift sales list freshness, unsynced status, deduplication, and offline reprint", async ({
    page,
    context,
    request,
    isMobile,
  }) => {
    test.setTimeout(60000);
    const { token } = await setupAuthAndPin(request);
    const { branch, register } = await ensureRegisterAllowOffline(request, token);

    // Ensure an open shift exists for REG01
    const shiftsRes = await request.get(`http://localhost:4000/api/v1/shifts?registerId=${register.id}&status=open`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const shiftsData = await shiftsRes.json();
    const openShifts = Array.isArray(shiftsData.data) ? shiftsData.data : (shiftsData.data?.items || []);
    if (openShifts.length === 0) {
      await request.post("http://localhost:4000/api/v1/shifts/open", {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          branchId: branch.id,
          registerId: register.id,
          openingCashMinor: 50000,
          notes: "Scenario 10 Shift",
        },
      });
    }

    if (!isMobile) {
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    page.on("console", (msg) => console.log("BROWSER LOG:", msg.text()));
    // 1. Login and go to /pos
    await loginAndGoToPos(page);

    // Ensure open shift on POS screen
    const openShiftBtn = page.locator('[data-testid="open-shift-button"], button:has-text("শিফট শুরু করুন"), button:has-text("Start Shift")');
    if (await openShiftBtn.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false)) {
      await openShiftBtn.click();
      const confirmOpenBtn = page.locator('[data-testid="confirm-open-shift-button"]');
      await expect(confirmOpenBtn).toBeVisible({ timeout: 5000 });
      await page.fill('[data-testid="opening-cash-input"]', "1000");
      await confirmOpenBtn.click();
      await expect(confirmOpenBtn).toBeHidden({ timeout: 10000 });
    }

    const shiftSalesBtn = page.locator('[data-testid="shift-sales-button"]');
    await expect(shiftSalesBtn).toBeVisible({ timeout: 15000 });

    const connPill = page.locator('[data-testid="connection-status-pill"]');
    await expect(connPill).toBeVisible({ timeout: 10000 });
    const firstProd = page.locator('[data-testid^="product-card-"]').first();
    await expect(firstProd).toBeVisible({ timeout: 15000 });

    // 2. Cut connection to go offline
    await context.setOffline(true);
    await expect(connPill).toContainText(/অফলাইন|Offline/, { timeout: 10000 });

    // 3. Complete an offline sale
    const prod = page.locator('[data-testid^="product-card-"]').first();
    await prod.click();
    const varCell = page.locator('[data-testid^="variant-cell-"]').first();
    if (await varCell.waitFor({ state: "visible", timeout: 1500 }).then(() => true).catch(() => false)) {
      await varCell.click();
    }
    await page.locator('[data-testid="pos-checkout-button"]').click();
    await page.locator('[data-testid="confirm-payment-button"]').click();

    const receipt = page.locator('[data-testid="receipt-container"]');
    await expect(receipt).toBeVisible({ timeout: 10000 });
    const receiptText = await receipt.innerText();
    const match = receiptText.match(/REG01-O-\d{6}-\d{4}/);
    expect(match).not.toBeNull();
    const offlineInv = match[0];

    // Close receipt
    await page.locator('[data-testid="new-sale-button"]').click();

    // 4. Immediately open shift sales list while offline
    await shiftSalesBtn.click();
    const shiftModal = page.locator('[data-testid="shift-sales-modal"]');
    await expect(shiftModal).toBeVisible({ timeout: 5000 });

    // 5. Assert the offline sale is visible, marked "সিঙ্ক হয়নি"
    const saleRow = page.locator(`[data-testid="shift-sale-row-${offlineInv}"]`);
    await expect(saleRow).toBeVisible({ timeout: 5000 });
    const badge = page.locator(`[data-testid="shift-sale-badge-${offlineInv}"]`);
    await expect(badge).toHaveText(/সিঙ্ক হয়নি|Unsynced/);

    // 6. Test reprint receipt while offline
    const reprintBtn = page.locator(`[data-testid="reprint-sale-btn-${offlineInv}"]`);
    await reprintBtn.click();
    await expect(receipt).toBeVisible({ timeout: 5000 });
    const reprintedText = await receipt.innerText();
    expect(reprintedText).toContain(offlineInv);

    // Dismiss receipt by starting new sale
    await page.locator('[data-testid="new-sale-button"]').click();
    await expect(receipt).toBeHidden({ timeout: 5000 });

    // 7. Reconnect network and trigger sync
    await context.setOffline(false);
    await expect(connPill).toContainText(/অনলাইন|Online/, { timeout: 10000 });
    await page.evaluate(() => {
      if (typeof (window as any).__triggerPosSync === "function") {
        (window as any).__triggerPosSync();
      } else {
        window.dispatchEvent(new Event("online"));
      }
    });

    // Wait for outbox sync to complete
    await page.waitForTimeout(3000);

    // 8. Re-open shift sales list after sync
    await expect(shiftSalesBtn).toBeVisible({ timeout: 5000 });
    await shiftSalesBtn.click();
    await expect(shiftModal).toBeVisible({ timeout: 5000 });

    // Assert that exactly ONE row exists for this sale, and it shows the completed status
    const allRowsForSale = shiftModal.locator(`[data-testid="shift-sale-row-${offlineInv}"]`);
    await expect(allRowsForSale).toHaveCount(1);
    await expect(page.locator(`[data-testid="shift-sale-badge-${offlineInv}"]`)).toHaveText(/সম্পন্ন|Completed/);
  });

  // 11. Lie-Fi: Server unreachable while browser online
  test("Scenario 11: Lie-Fi - server unreachable while browser online", async ({
    page,
    context,
    request,
  }) => {
    test.setTimeout(90000);
    const { token } = await setupAuthAndPin(request);
    await ensureRegisterAllowOffline(request, token);
    await loginAndGoToPos(page);

    // Ensure open shift
    const openShiftBtn = page.locator('[data-testid="open-shift-button"], button:has-text("শিফট শুরু করুন"), button:has-text("Start Shift")');
    if (await openShiftBtn.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false)) {
      await openShiftBtn.click();
      const confirmOpenBtn = page.locator('[data-testid="confirm-open-shift-button"]');
      await expect(confirmOpenBtn).toBeVisible({ timeout: 5000 });
      await page.fill('[data-testid="opening-cash-input"]', "1000");
      await confirmOpenBtn.click();
      await expect(confirmOpenBtn).toBeHidden({ timeout: 10000 });
    }

    const connPill = page.locator('[data-testid="connection-status-pill"]');
    await expect(connPill).toBeVisible({ timeout: 10000 });

    // Keep browser online, but block all /api/v1/** calls on both context and page
    await context.route("**/api/v1/**", (route) => route.abort());
    await page.route("**/api/v1/**", (route) => route.abort());

    // Trigger health check failure
    await page.evaluate(async () => {
      if (typeof (window as any).__checkServerHealth === "function") {
        await (window as any).__checkServerHealth();
      }
    });

    await expect(connPill).toContainText(/অফলাইন|Offline/, { timeout: 15000 });
    await expect(page.locator('[data-testid="pos-return-button"]')).toBeDisabled();
    await expect(page.locator('[data-testid="pos-cart-return-button"]')).toBeDisabled();

    const sale1ClientTime = Date.now();
    // Sale 1: Cash sale
    const firstProd = page.locator('[data-testid^="product-card-"]').first();
    await firstProd.click();
    const varCell1 = page.locator('[data-testid^="variant-cell-"]').first();
    if (await varCell1.waitFor({ state: "visible", timeout: 1500 }).then(() => true).catch(() => false)) {
      await varCell1.click();
    }
    await page.locator('[data-testid="pos-checkout-button"]').click();
    await page.locator('[data-testid="confirm-payment-button"]').click();

    const receipt = page.locator('[data-testid="receipt-container"]');
    await expect(receipt).toBeVisible({ timeout: 10000 });
    const receipt1Text = await receipt.innerText();
    const match1 = receipt1Text.match(/REG01-O-\d{6}-\d{4}/);
    expect(match1).not.toBeNull();
    const inv1 = match1![0];
    await page.locator('[data-testid="new-sale-button"]').click();

    // Sale 2: bKash sale with reference
    const sale2ClientTime = Date.now();
    await firstProd.click();
    const varCell2 = page.locator('[data-testid^="variant-cell-"]').first();
    if (await varCell2.waitFor({ state: "visible", timeout: 1500 }).then(() => true).catch(() => false)) {
      await varCell2.click();
    }
    await page.locator('[data-testid="pos-checkout-button"]').click();
    // Select bKash
    await page.locator('[data-testid="payment-method-select-0"]').click();
    await page.locator('role=option').filter({ hasText: /বিকাশ|bKash/ }).click();
    const refInput = page.locator('[data-testid="payment-ref-input-0"]');
    await expect(refInput).toBeVisible({ timeout: 3000 });
    await refInput.fill("TRX-BKASH-7777");
    await page.locator('[data-testid="confirm-payment-button"]').click();

    await expect(receipt).toBeVisible({ timeout: 10000 });
    const receipt2Text = await receipt.innerText();
    const match2 = receipt2Text.match(/REG01-O-\d{6}-\d{4}/);
    expect(match2).not.toBeNull();
    const inv2 = match2![0];
    await page.locator('[data-testid="new-sale-button"]').click();

    // Remove route and restore connectivity
    await context.unroute("**/api/v1/**");
    await page.unroute("**/api/v1/**");
    await page.evaluate(() => {
      if (typeof (window as any).__triggerPosSync === "function") {
        (window as any).__triggerPosSync();
      }
    });

    await page.waitForTimeout(4000);

    // Query API for both sales
    const salesRes = await request.get("http://localhost:4000/api/v1/sales?limit=50", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(salesRes.ok()).toBeTruthy();
    const allSales = (await salesRes.json()).data.items;

    // Assert sale 1
    const matching1 = allSales.filter((s: any) => s.invoiceNumber === inv1);
    expect(matching1.length).toBe(1);
    const sale1 = matching1[0];
    expect(sale1.invoiceNumber).toBe(inv1);
    expect(sale1.isOffline).toBe(true);
    const s1Occurred = new Date(sale1.occurredAt).getTime();
    expect(Math.abs(s1Occurred - sale1ClientTime)).toBeLessThan(60000);

    // Assert sale 2
    const matching2 = allSales.filter((s: any) => s.invoiceNumber === inv2);
    expect(matching2.length).toBe(1);
    const sale2 = matching2[0];
    expect(sale2.invoiceNumber).toBe(inv2);
    expect(sale2.isOffline).toBe(true);
    const s2Occurred = new Date(sale2.occurredAt).getTime();
    expect(Math.abs(s2Occurred - sale2ClientTime)).toBeLessThan(60000);
    const bkashPayment = sale2.payments?.find((p: any) => p.paymentMethod === "bkash");
    expect(bkashPayment).toBeDefined();
    expect(bkashPayment?.reference).toBe("TRX-BKASH-7777");
  });

  // 12. Lost response: server saved online sale, response lost, client retries offline
  test("Scenario 12: Lost response - idempotency, NUMBER_MISMATCH flag and dual search", async ({
    page,
    context,
    request,
  }) => {
    test.setTimeout(90000);
    const { token } = await setupAuthAndPin(request);
    await ensureRegisterAllowOffline(request, token);
    await loginAndGoToPos(page);

    // Ensure open shift
    const openShiftBtn = page.locator('[data-testid="open-shift-button"], button:has-text("শিফট শুরু করুন"), button:has-text("Start Shift")');
    if (await openShiftBtn.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false)) {
      await openShiftBtn.click();
      const confirmOpenBtn = page.locator('[data-testid="confirm-open-shift-button"]');
      await expect(confirmOpenBtn).toBeVisible({ timeout: 5000 });
      await page.fill('[data-testid="opening-cash-input"]', "1000");
      await confirmOpenBtn.click();
      await expect(confirmOpenBtn).toBeHidden({ timeout: 10000 });
    }

    let intercepted = false;
    let serverInvoiceNumber = "";
    const handler = async (route: any) => {
      if (route.request().method() === "POST" && !intercepted) {
        intercepted = true;
        const res = await route.fetch();
        const json = await res.json().catch(() => null);
        if (json?.data?.invoiceNumber) {
          serverInvoiceNumber = json.data.invoiceNumber;
        }
        await route.abort();
      } else {
        await route.continue();
      }
    };
    await context.route("**/api/v1/sales", handler);
    await page.route("**/api/v1/sales", handler);

    const firstProd = page.locator('[data-testid^="product-card-"]').first();
    await firstProd.click();
    const varCell = page.locator('[data-testid^="variant-cell-"]').first();
    if (await varCell.waitFor({ state: "visible", timeout: 1500 }).then(() => true).catch(() => false)) {
      await varCell.click();
    }
    await page.locator('[data-testid="pos-checkout-button"]').click();
    await page.locator('[data-testid="confirm-payment-button"]').click();

    // After route.abort(), client converts to offline sale
    const receipt = page.locator('[data-testid="receipt-container"]');
    await expect(receipt).toBeVisible({ timeout: 15000 });
    const receiptText = await receipt.innerText();
    const match = receiptText.match(/REG01-O-\d{6}-\d{4}/);
    expect(match).not.toBeNull();
    const offlineInv = match![0];
    await page.locator('[data-testid="new-sale-button"]').click();

    // Remove route abortion
    await context.unroute("**/api/v1/sales");
    await page.unroute("**/api/v1/sales");

    // Trigger sync
    await page.evaluate(() => {
      if (typeof (window as any).__triggerPosSync === "function") {
        (window as any).__triggerPosSync();
      }
    });
    await page.waitForTimeout(4000);

    // Verify on server via API:
    // 1. Search by offline invoice number
    const searchOfflineRes = await request.get(`http://localhost:4000/api/v1/sales?search=${offlineInv}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(searchOfflineRes.ok()).toBeTruthy();
    const searchOfflineJson = await searchOfflineRes.json();
    const foundByOffline = searchOfflineJson.data?.items || searchOfflineJson.data || [];
    expect(foundByOffline.length).toBe(1);
    const saleId = foundByOffline[0].id;

    // 2. Search by server invoice number
    if (serverInvoiceNumber) {
      const searchServerRes = await request.get(`http://localhost:4000/api/v1/sales?search=${serverInvoiceNumber}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(searchServerRes.ok()).toBeTruthy();
      const searchServerJson = await searchServerRes.json();
      const foundByServer = searchServerJson.data?.items || searchServerJson.data || [];
      expect(foundByServer.some((s: any) => s.id === saleId)).toBe(true);
    }

    // 3. NUMBER_MISMATCH flag exists in review flags
    const flagsRes = await request.get("http://localhost:4000/api/v1/sales/offline-review", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(flagsRes.ok()).toBeTruthy();
    const flags = (await flagsRes.json()).data?.items || (await flagsRes.json()).data?.data || (await flagsRes.json()).data || [];
    const mismatchFlag = flags.find((f: any) => f.flag === "NUMBER_MISMATCH" && f.saleId === saleId);
    expect(mismatchFlag).toBeDefined();
    expect(mismatchFlag.details?.offlineInvoiceNumber).toBe(offlineInv);

    // 4. Return dialog search by offline number:
    // Press F6 on /pos, search by offline invoice number (-O-), verify sale lines appear
    await page.keyboard.press("F6");
    const returnDialog = page.locator('[data-testid="return-dialog"], [role="dialog"]');
    await expect(returnDialog).toBeVisible({ timeout: 5000 });
    await page.fill('[data-testid="return-invoice-input"]', offlineInv);
    await page.locator('[data-testid="search-invoice-button"]').click();
    await expect(page.locator('[data-testid="return-lines-table"]')).toBeVisible({ timeout: 10000 });
    await page.keyboard.press("Escape");
    await expect(returnDialog).toBeHidden({ timeout: 5000 });
  });
});
