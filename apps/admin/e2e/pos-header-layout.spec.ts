import { test, expect } from "@playwright/test";

function doBoxesOverlap(
  b1: { x: number; y: number; width: number; height: number },
  b2: { x: number; y: number; width: number; height: number },
): boolean {
  const separated =
    b1.x + b1.width <= b2.x ||
    b2.x + b2.width <= b1.x ||
    b1.y + b1.height <= b2.y ||
    b2.y + b2.height <= b1.y;
  return !separated;
}

test.describe("Item 0: POS Header Layout and Bounding Box Verification", () => {
  test("header elements (shift badge, cashier block, discount limit) do not overlap at 1366, 1024, and 375 px", async ({
    page,
  }) => {
    // 1. Sign in as cashier
    await page.goto("/login");
    await page.fill('input[id="tenantSlug"]', "artisan-apparel");
    await page.fill('input[id="email"]', "cashier@artisan.com");
    await page.fill('input[id="password"]', "Password123!");
    await page.click('button[type="submit"]');

    await page.waitForURL("**/pos", { timeout: 15000 });
    expect(page.url()).toContain("/pos");

    // Close any modal if visible
    const switchBtn = page.locator('[data-testid="switch-register-btn"]');
    if (await switchBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await switchBtn.click();
      await expect(switchBtn).toBeHidden({ timeout: 3000 });
    }

    const viewports = [
      { width: 1366, height: 768, name: "desktop-1366" },
      { width: 1024, height: 768, name: "tablet-1024" },
      { width: 375, height: 667, name: "mobile-375" },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(400);

      const shiftBadge = page.locator('[data-testid="shift-status-badge"]').first();
      await expect(shiftBadge).toBeVisible({ timeout: 5000 });
      const shiftBox = await shiftBadge.boundingBox();
      expect(shiftBox).not.toBeNull();

      const cashierBlock = page.locator('[data-testid="cashier-name-block"]').first();
      await expect(cashierBlock).toBeVisible({ timeout: 5000 });
      const cashierBox = await cashierBlock.boundingBox();
      expect(cashierBox).not.toBeNull();

      // Check shift badge and cashier block do not overlap
      expect(
        doBoxesOverlap(shiftBox!, cashierBox!),
        `Shift badge and cashier block must not overlap at ${vp.width}px`,
      ).toBe(false);

      if (vp.width >= 640) {
        // Desktop / Tablet: standalone discount limit is visible on header
        const discountLimit = page.locator('[data-testid="cashier-discount-limit"]:visible').first();
        await expect(discountLimit).toBeVisible({ timeout: 5000 });
        const discountBox = await discountLimit.boundingBox();
        expect(discountBox).not.toBeNull();

        expect(
          doBoxesOverlap(shiftBox!, discountBox!),
          `Shift badge and discount limit must not overlap at ${vp.width}px`,
        ).toBe(false);
        expect(
          doBoxesOverlap(cashierBox!, discountBox!),
          `Cashier block and discount limit must not overlap at ${vp.width}px`,
        ).toBe(false);
      } else {
        // Mobile (375px): standalone discount limit is moved into cashier menu
        // Clicking cashier block opens dropdown menu containing discount limit
        await cashierBlock.click();
        await page.waitForTimeout(300);

        const discountInMenu = page.locator('[data-testid="cashier-discount-limit"]:visible').first();
        await expect(discountInMenu).toBeVisible({ timeout: 5000 });
        const discountBox = await discountInMenu.boundingBox();
        expect(discountBox).not.toBeNull();

        // Ensure menu discount item doesn't collide with shift badge
        expect(
          doBoxesOverlap(shiftBox!, discountBox!),
          `Shift badge and discount limit in menu must not overlap at ${vp.width}px`,
        ).toBe(false);

        // Close menu for clean state
        await cashierBlock.click();
        await page.waitForTimeout(200);
      }
    }
  });
});
