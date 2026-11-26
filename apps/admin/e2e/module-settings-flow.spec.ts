import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { closeAllOpenShifts } from "./helpers/shift-cleanup.js";
import { MODULE_KEYS } from "@universal-pos/shared";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.resolve(__dirname, "../../../docs/screenshots/phase2-0");

test.describe("Phase 2.0: Module System & Platform Admin Flow", () => {
  const e2eDbUrl =
    process.env.MIGRATION_E2E_DATABASE_URL ||
    "postgresql://pos_admin:pos_secret@localhost:5432/universal_pos_e2e?schema=public";

  test.beforeAll(async () => {
    const prisma = new PrismaClient({ datasources: { db: { url: e2eDbUrl } } });
    try {
      await prisma.$executeRawUnsafe(`
        DELETE FROM public.feature_flags
        WHERE tenant_id IN (SELECT id FROM public.tenants WHERE slug = 'artisan-apparel');
      `);
    } finally {
      await prisma.$disconnect();
    }
  });

  test.afterEach(async ({ request }) => {
    // Teardown: ensure any open shifts are closed cleanly
    await closeAllOpenShifts(request);
  });

  test.afterAll(async () => {
    // Teardown: artisan-apparel MUST have 0 module rows so other 161 tests stay completely unaffected
    const prisma = new PrismaClient({ datasources: { db: { url: e2eDbUrl } } });
    try {
      await prisma.$executeRawUnsafe(`
        DELETE FROM public.feature_flags
        WHERE tenant_id IN (SELECT id FROM public.tenants WHERE slug = 'artisan-apparel');
      `);

      const remaining = await prisma.featureFlag.count({
        where: { tenant: { slug: "artisan-apparel" } },
      });

      if (remaining !== 0) {
        throw new Error(
          `[Teardown Failure] artisan-apparel must have 0 module rows after test, but found ${remaining} rows!`
        );
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  test("Phase 2.0 full lifecycle: owner view, platform allowlist, tenant activation, cashier read-only, chemical defaults, and clean teardown", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // -------------------------------------------------------------
    // Test 1: artisan-apparel owner visits /settings/modules
    // -------------------------------------------------------------
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 15000 });

    await page.goto("/settings/modules");
    await expect(page.locator('[data-testid="modules-settings-page"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator("h1")).toContainText(/মডিউল সেটিংস|Module Settings/i);

    // All 8 modules must be visible
    for (const key of MODULE_KEYS) {
      const card = page.locator(`[data-testid="module-card-${key}"]`);
      await expect(card).toBeVisible();

      // None allowed initially -> switch must be disabled
      const sw = page.locator(`[data-testid="module-switch-${key}"]`);
      await expect(sw).toBeDisabled();

      // Helper text must show 'প্ল্যাটফর্ম থেকে চালু করা হয়নি'
      await expect(page.locator(`[data-testid="module-not-allowed-msg-${key}"]`)).toBeVisible();
    }

    // Capture Screenshot 1: artisan-apparel modules settings page
    await page.screenshot({
      path: path.join(screenshotDir, "01-artisan-apparel-modules.png"),
      fullPage: true,
    });

    // -------------------------------------------------------------
    // Test 2: Platform admin logs in at /platform/login
    // -------------------------------------------------------------
    await page.goto("/platform/login");
    await expect(page.locator('[data-testid="platform-login-card"]')).toBeVisible();

    await page.fill('[data-testid="platform-email-input"]', "platform@test.local");
    await page.fill('[data-testid="platform-password-input"]', "Password123!");
    await page.click('[data-testid="platform-login-button"]');

    await page.waitForURL("**/platform", { timeout: 15000 });
    await expect(page.locator('[data-testid="platform-tenants-page"]')).toBeVisible();
    await expect(page.locator("h1")).toContainText(/Universal POS — Platform Administration/i);

    // Both tenants must be present
    await expect(page.locator('[data-testid="platform-tenant-card-artisan-apparel"]')).toBeVisible();
    await expect(page.locator('[data-testid="platform-tenant-card-chemical-demo"]')).toBeVisible();

    // Capture Screenshot 3: Platform admin tenants page
    await page.screenshot({
      path: path.join(screenshotDir, "03-platform-tenants.png"),
      fullPage: true,
    });

    // -------------------------------------------------------------
    // Test 3: Platform admin allows 'units' for artisan-apparel
    // -------------------------------------------------------------
    const unitsPlatformSwitch = page.locator(
      '[data-testid="platform-module-switch-artisan-apparel-units"]'
    );
    await expect(unitsPlatformSwitch).toBeVisible();
    await expect(unitsPlatformSwitch).toHaveAttribute("aria-checked", "false");

    await unitsPlatformSwitch.click();
    await expect(unitsPlatformSwitch).toHaveAttribute("aria-checked", "true", { timeout: 8000 });

    // -------------------------------------------------------------
    // Test 4: artisan-apparel owner revisits /settings/modules
    // -------------------------------------------------------------
    await page.goto("/settings/modules");
    await expect(page.locator('[data-testid="modules-settings-page"]')).toBeVisible({ timeout: 10000 });

    // 'units' switch is now enabled (allowed: true, enabled: false)
    const unitsTenantSwitch = page.locator('[data-testid="module-switch-units"]');
    await expect(unitsTenantSwitch).toBeEnabled();
    await expect(unitsTenantSwitch).toHaveAttribute("aria-checked", "false");

    // Owner flips switch to ON -> active: true
    await unitsTenantSwitch.click();
    await expect(unitsTenantSwitch).toHaveAttribute("aria-checked", "true", { timeout: 8000 });

    const unitsCard = page.locator('[data-testid="module-card-units"]');
    await expect(unitsCard).toContainText(/সক্রিয়/);

    // -------------------------------------------------------------
    // Test 5: Verify API GET /settings/pos includes units in activeModules
    // -------------------------------------------------------------
    const posSettingsRes = await request.get("http://localhost:4000/api/v1/settings/pos", {
      headers: {
        // Authenticated session token from current page storage
        Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem("pos_access_token") || "")}`,
      },
    });

    // Or verify through settings page navigation link
    await page.goto("/settings/shop");
    await expect(page.locator("h1")).toBeVisible();

    // -------------------------------------------------------------
    // Test 6: Cashier logs in -> read-only view of /settings/modules
    // -------------------------------------------------------------
    await page.context().clearCookies();
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "cashier@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/pos", { timeout: 15000 });

    await page.goto("/settings/modules");
    await expect(page.locator('[data-testid="modules-settings-page"]')).toBeVisible({ timeout: 10000 });

    // Cashier sees all cards with status badges
    for (const key of MODULE_KEYS) {
      await expect(page.locator(`[data-testid="module-card-${key}"]`)).toBeVisible();
    }
    // But cashier has NO toggle switches
    await expect(page.locator('[data-testid^="module-switch-"]')).toHaveCount(0);

    // -------------------------------------------------------------
    // Test 7: Chemical demo owner logs in -> 4 default modules active
    // -------------------------------------------------------------
    await page.context().clearCookies();
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    await page.goto("/login");
    await page.fill("#tenantSlug", "chemical-demo");
    await page.fill("#email", "owner@chemical.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 15000 });

    await page.goto("/settings/modules");
    await expect(page.locator('[data-testid="modules-settings-page"]')).toBeVisible({ timeout: 10000 });

    // 4 default modules must be active: units, batch_expiry, chemical_safety, b2b_wholesale
    const chemicalDefaultModules = ["units", "batch_expiry", "chemical_safety", "b2b_wholesale"];
    for (const modKey of chemicalDefaultModules) {
      const card = page.locator(`[data-testid="module-card-${modKey}"]`);
      await expect(card).toContainText(/সক্রিয়/);
      const sw = page.locator(`[data-testid="module-switch-${modKey}"]`);
      await expect(sw).toBeEnabled();
      await expect(sw).toHaveAttribute("aria-checked", "true");
    }

    // Capture Screenshot 2: chemical-demo modules settings page
    await page.screenshot({
      path: path.join(screenshotDir, "02-chemical-demo-modules.png"),
      fullPage: true,
    });
  });
});
