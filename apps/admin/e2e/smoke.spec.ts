import { test, expect } from "@playwright/test";

test.describe("Admin Dashboard Smoke Test", () => {
  test("loads login page and renders branding", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("h3")).toContainText("দোকানের ব্যাক অফিসে লগইন");
    await expect(page.getByText("Universal POS Admin", { exact: true })).toBeVisible();
  });
});
