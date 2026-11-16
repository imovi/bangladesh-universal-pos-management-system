import { test, expect } from "@playwright/test";

test.describe("Milestone A8: Settings, Staff, Roles & Audit Flow", () => {
  const timestamp = Date.now();
  const testBranchName = `Uttara Hub ${timestamp}`;
  const testBranchCode = `UTT${timestamp.toString().slice(-4)}`;
  const testRoleName = `Limited Cashier ${timestamp}`;
  const testUserEmail = `junior.${timestamp}@artisan.com`;

  test("full settings lifecycle: shop policies, branch creation, role with 5% discount cap, user assignment, restricted access verification, and audit logs", async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // 1. Sign in as Owner
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 15000 });

    // 2. Shop Settings (/settings/shop)
    await page.goto("/settings/shop");
    await expect(page.locator("h1")).toContainText(/দোকানের সেটিংস|Shop Settings/i);

    // Update receipt text
    await page.fill('[data-testid="shop-receipt-header"]', `Artisan Official #${timestamp}`);
    await page.fill('[data-testid="shop-receipt-footer"]', `Exchange within 7 days #${timestamp}`);
    await page.click('[data-testid="save-shop-settings-btn"]');

    // If an error alert appeared, log it
    const errAlert = page.locator('[role="alert"].bg-destructive\\/10');
    if (await errAlert.isVisible().catch(() => false)) {
      console.log("PAGE ERROR ALERT:", await errAlert.innerText());
    }

    // Verify success banner
    await expect(page.locator('[data-testid="shop-settings-saved-banner"]')).toBeVisible({
      timeout: 10000,
    });

    // 3. Branches Management (/settings/branches)
    await page.goto("/settings/branches");
    await expect(page.locator("h1")).toContainText(/শাখা ব্যবস্থাপনা|Branch Management/i);

    // Open create branch modal
    await page.click('[data-testid="create-branch-button"]');
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    await page.fill('[data-testid="branch-name-input"]', testBranchName);
    await page.fill('[data-testid="branch-code-input"]', testBranchCode);
    await page.fill('[data-testid="branch-phone-input"]', "01712000000");
    await page.fill('[data-testid="branch-address-input"]', "Sector 3, Uttara, Dhaka");
    await page.click('[data-testid="save-branch-button"]');

    // Wait for branch modal to close and branch to appear in table
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByText(testBranchName)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(testBranchCode)).toBeVisible();

    // 4. Roles & Permissions (/settings/roles)
    await page.goto("/settings/roles");
    await expect(page.locator("h1")).toContainText(/রোল ও পারমিশন|Roles & Permissions/i);

    // Create limited role with 5% discount limit
    await page.click('[data-testid="create-role-button"]');
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    await page.fill('[data-testid="role-name-input"]', testRoleName);
    await page.fill('[data-testid="role-max-discount-input"]', "5");

    // Save role
    await page.click('[data-testid="save-role-button"]');
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 10000 });

    // Verify role in table with 5% discount badge
    await expect(page.getByText(testRoleName)).toBeVisible({ timeout: 10000 });
    const roleRow = page.locator(`tr:has-text("${testRoleName}")`);
    await expect(roleRow.getByText("5%")).toBeVisible();

    // 5. Users & Staff (/settings/users)
    await page.goto("/settings/users");
    await expect(page.locator("h1")).toContainText(/ব্যবহারকারী ও কর্মী|Users & Staff/i);

    // Create new staff user with the 5% limited role
    await page.click('[data-testid="create-user-button"]');
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    await page.fill('[data-testid="user-name-input"]', `Staff ${timestamp}`);
    await page.fill('[data-testid="user-email-input"]', testUserEmail);
    await page.fill('[data-testid="user-password-input"]', "Password123!");

    // Select the new limited role
    const roleCheckbox = page.locator(`label:has-text("${testRoleName}") input[type="checkbox"]`);
    await roleCheckbox.check();

    await page.click('[data-testid="save-user-button"]');
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 10000 });

    // Verify new user appears in table
    await expect(page.getByText(testUserEmail)).toBeVisible({ timeout: 10000 });

    // 6. Sign in as newly created user with limited role
    await context.clearCookies();
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", testUserEmail);
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');

    // Wait for redirect to /pos
    await page.waitForURL(/\/(pos|dashboard)/, { timeout: 15000 });

    // Verify 5% discount limit on POS screen
    if (page.url().includes("/pos")) {
      const discountLimitBadge = page.locator('[data-testid="cashier-discount-limit"]');
      await expect(discountLimitBadge).toBeVisible({ timeout: 10000 });
      await expect(discountLimitBadge).toContainText("5%");
    }

    // Verify restricted pages are blocked (Access Denied)
    await page.goto("/settings/shop");
    await expect(page.locator("text=Access Denied").or(page.locator("text=প্রবেশাধিকার নেই"))).toBeVisible({
      timeout: 10000,
    });

    await page.goto("/purchasing/orders");
    await expect(page.locator("text=Access Denied").or(page.locator("text=প্রবেশাধিকার নেই"))).toBeVisible({
      timeout: 10000,
    });

    // 7. Sign back in as Owner and verify Audit Logs (/settings/audit)
    await context.clearCookies();
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 15000 });

    await page.goto("/settings/audit");
    await expect(page.locator("h1")).toContainText(/সিস্টেম অডিট লগ|System Audit Logs/i);

    // Verify audit logs table rendered with rows
    const firstDetailsBtn = page.locator('button:has-text("বিস্তারিত"), button:has-text("Details")').first();
    await expect(firstDetailsBtn).toBeVisible({ timeout: 10000 });
    await firstDetailsBtn.click();

    // Verify modal opened with before/after state
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await expect(page.locator(':text("পূর্বের মান"), :text("Before State")')).toBeVisible();
    await page.keyboard.press("Escape");
  });
});
