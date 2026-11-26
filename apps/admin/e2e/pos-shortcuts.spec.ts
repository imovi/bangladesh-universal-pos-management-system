import { test, expect } from "@playwright/test";
import { closeAllOpenShifts } from "./helpers/shift-cleanup";

test.describe("Step 2 (Item 1): POS Keyboard Shortcuts Flow (F2, F4, F6, F8, F9, Esc, Shortcuts Modal)", () => {
  let token: string;
  let branchId: string;
  let registerId: string;

  test.beforeAll(async ({ request }) => {
    // 1. Authenticate with API as Owner
    const loginRes = await request.post("http://localhost:4000/api/v1/auth/login", {
      data: {
        tenantSlug: "artisan-apparel",
        email: "owner@artisan.com",
        password: "Password123!",
      },
    });
    expect(loginRes.ok()).toBeTruthy();
    const loginData = await loginRes.json();
    token = loginData.data.accessToken;

    // 2. Fetch branch and register
    const branchesRes = await request.get("http://localhost:4000/api/v1/branches", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const branches = await branchesRes.json();
    branchId = branches.data.find((b: any) => b.code === "GFS-01")?.id || branches.data[0].id;

    const registersRes = await request.get(`http://localhost:4000/api/v1/registers?branchId=${branchId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const registers = await registersRes.json();
    registerId = registers.data[0].id;

    // 3. Ensure an open shift exists for owner on this register
    const meRes = await request.get("http://localhost:4000/api/v1/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const meId = (await meRes.json()).data.id;

    const shiftsRes = await request.get(
      `http://localhost:4000/api/v1/shifts?registerId=${registerId}&status=open`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const shiftsJson = await shiftsRes.json();
    const openShifts = Array.isArray(shiftsJson.data) ? shiftsJson.data : (shiftsJson.data?.items || []);
    for (const s of openShifts) {
      if (s.cashierUserId !== meId) {
        await request.post(`http://localhost:4000/api/v1/shifts/${s.id}/close`, {
          headers: { Authorization: `Bearer ${token}` },
          data: { closingCashMinor: Number(s.openingCashMinor || 50000) },
        }).catch(() => {});
      }
    }

    const checkRes = await request.get(
      `http://localhost:4000/api/v1/shifts?registerId=${registerId}&status=open`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const currentOpen = Array.isArray((await checkRes.json()).data) ? (await checkRes.json()).data : [];
    if (currentOpen.length === 0) {
      await request.post("http://localhost:4000/api/v1/shifts/open", {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          branchId,
          registerId,
          openingCashMinor: 100000,
          notes: "E2E shortcuts test shift",
        },
      });
    }
  });

  test.afterAll(async ({ request }) => {
    await closeAllOpenShifts(request);
  });

  test("F2, F4, F6, F8, F9, Esc shortcuts work from body and search box, and shortcuts modal lists all", async ({ page }) => {
    // 1. Sign in as Owner
    await page.goto("/login");
    await page.fill('input[id="tenantSlug"]', "artisan-apparel");
    await page.fill('input[id="email"]', "owner@artisan.com");
    await page.fill('input[id="password"]', "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 15000 });

    // 2. Go to /pos
    await page.goto("/pos");
    await page.waitForSelector('[data-testid="pos-search-input"]', { timeout: 15000 });

    // Handle shift-in-use or register modal if present
    const switchBtn = page.locator('[data-testid="switch-register-btn"]');
    if (await switchBtn.waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false)) {
      await switchBtn.click();
      await expect(switchBtn).toBeHidden({ timeout: 5000 });
    }

    // Ensure shift is open so returns and payments are enabled
    const startShiftBtn = page.locator('button:has-text("শিফট শুরু করুন"), [data-testid="open-shift-button"]');
    if (await startShiftBtn.waitFor({ state: "visible", timeout: 2000 }).then(() => true).catch(() => false)) {
      await startShiftBtn.click();
      const confirmOpenShiftBtn = page.locator('[data-testid="confirm-open-shift-button"]');
      await expect(confirmOpenShiftBtn).toBeVisible({ timeout: 5000 });
      await confirmOpenShiftBtn.click();
      await expect(confirmOpenShiftBtn).toBeHidden({ timeout: 5000 });
    }

    const searchInput = page.locator('[data-testid="pos-search-input"]');

    // --- TEST F2: Focus Search ---
    // Blur search input first to verify F2 focuses it
    await searchInput.blur();
    await expect(searchInput).not.toBeFocused();
    await page.keyboard.press("F2");
    await expect(searchInput).toBeFocused();

    // --- TEST F6: Returns Dialog (with focus in search box) ---
    await searchInput.focus();
    await expect(searchInput).toBeFocused();
    await page.keyboard.press("F6");
    const returnInput = page.locator('[data-testid="return-invoice-input"]');
    await expect(returnInput).toBeVisible({ timeout: 5000 });

    // --- TEST Esc: Closes Returns Dialog ---
    await page.keyboard.press("Escape");
    await expect(returnInput).toBeHidden({ timeout: 5000 });

    // --- TEST F6: Returns Dialog (with focus on page body) ---
    await page.locator("body").click({ position: { x: 100, y: 100 } });
    await page.keyboard.press("F6");
    await expect(returnInput).toBeVisible({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await expect(returnInput).toBeHidden({ timeout: 5000 });

    // --- TEST F8: Hold / Resume Carts ---
    // 1) From focus in search box
    await searchInput.focus();
    await page.keyboard.press("F8");
    const holdCartDialog = page.locator('[role="dialog"]:has-text("হোল্ড"), [role="dialog"]:has-text("Hold")');
    await expect(holdCartDialog).toBeVisible({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await expect(holdCartDialog).toBeHidden({ timeout: 5000 });

    // 2) From body focus
    await page.locator("body").click({ position: { x: 100, y: 100 } });
    await page.keyboard.press("F8");
    await expect(holdCartDialog).toBeVisible({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await expect(holdCartDialog).toBeHidden({ timeout: 5000 });

    // --- TEST F9: Customer Dialog ---
    await page.locator("body").click({ position: { x: 100, y: 100 } });
    await page.keyboard.press("F9");
    const customerInput = page.locator('[data-testid="customer-search-input"]');
    await expect(customerInput).toBeVisible({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await expect(customerInput).toBeHidden({ timeout: 5000 });

    // --- TEST F4: Payment Dialog ---
    // First, add an item to cart so cart is not empty
    const firstProduct = page.locator('[data-testid^="product-card-"]').first();
    await expect(firstProduct).toBeVisible({ timeout: 10000 });
    await firstProduct.click();

    // If variant picker opened, select first variant
    const variantBtn = page.locator('[data-testid^="variant-cell-"]:not([disabled])').first();
    if (await variantBtn.waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false)) {
      await variantBtn.click();
      await expect(variantBtn).toBeHidden({ timeout: 5000 });
    }

    // Verify cart now has item and checkout button is enabled
    const checkoutBtn = page.locator('[data-testid="pos-checkout-button"]');
    await expect(checkoutBtn).toBeEnabled({ timeout: 5000 });

    // Now press F4 to open payment dialog
    await page.locator("body").click({ position: { x: 100, y: 100 } });
    await page.keyboard.press("F4");
    const confirmPaymentBtn = page.locator('[data-testid="confirm-payment-button"]');
    await expect(confirmPaymentBtn).toBeVisible({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await expect(confirmPaymentBtn).toBeHidden({ timeout: 5000 });

    // --- TEST Shortcuts Modal: lists F2, F4, F6, F8, F9, Esc, Enter ---
    // Open shortcuts modal via header button or menu
    const shortcutsBtn = page.locator('[data-testid="shortcuts-button"], button[title*="শর্টকাট"], button[title*="Shortcuts"]');
    if (await shortcutsBtn.isVisible()) {
      await shortcutsBtn.click();
    } else {
      // Open via More ("⋯") menu
      const moreBtn = page.locator('[data-testid="pos-more-menu-btn"]');
      if (await moreBtn.isVisible()) {
        await moreBtn.click();
        const menuShortcutsBtn = page.locator('button:has-text("কীবোর্ড শর্টকাট"), button:has-text("Shortcuts")');
        await menuShortcutsBtn.click();
      }
    }

    const shortcutsModal = page.locator('[role="dialog"]:has-text("শর্টকাট"), [role="dialog"]:has-text("Shortcuts")');
    await expect(shortcutsModal).toBeVisible({ timeout: 5000 });

    // Verify all keys are present in modal
    await expect(shortcutsModal.locator("kbd:has-text('F2')")).toBeVisible();
    await expect(shortcutsModal.locator("kbd:has-text('F4')")).toBeVisible();
    await expect(shortcutsModal.locator("kbd:has-text('F6')")).toBeVisible();
    await expect(shortcutsModal.locator("kbd:has-text('F8')")).toBeVisible();
    await expect(shortcutsModal.locator("kbd:has-text('F9')")).toBeVisible();
    await expect(shortcutsModal.locator("kbd:has-text('Esc')")).toBeVisible();
    await expect(shortcutsModal.locator("kbd:has-text('Enter')")).toBeVisible();

    // Close shortcuts modal via Esc
    await page.keyboard.press("Escape");
    await expect(shortcutsModal).toBeHidden({ timeout: 5000 });
  });
});
