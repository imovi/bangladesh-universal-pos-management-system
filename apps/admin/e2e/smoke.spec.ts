import { test, expect } from "@playwright/test";

test.describe("Admin Dashboard Smoke Test", () => {
  test("loads landing page and renders heading", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toContainText("Universal POS Admin");
    await expect(page.getByText("Phase 1B Ready")).toBeVisible();
  });
});
