import { test, expect } from "@playwright/test";

test.describe("Milestone C3: Stock Transfers End-to-End Flow", () => {
  let ownerToken: string;
  let branchAId: string; // GFS-01
  let branchBId: string; // DF-01

  test.beforeAll(async ({ request }) => {
    // 1. Authenticate Owner
    const loginRes = await request.post("http://localhost:4000/api/v1/auth/login", {
      data: {
        tenantSlug: "artisan-apparel",
        email: "owner@artisan.com",
        password: "Password123!",
      },
    });
    expect(loginRes.status()).toBe(200);
    const loginData = await loginRes.json();
    ownerToken = loginData.data.accessToken;

    // 2. Fetch Branches (create Destination branch DF-01 if it doesn't exist)
    const branchesRes = await request.get("http://localhost:4000/api/v1/branches", {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(branchesRes.status()).toBe(200);
    const branches = (await branchesRes.json()).data;
    const gfs = branches.find((b: any) => b.code === "GFS-01") || branches[0];
    let df = branches.find((b: any) => b.code === "DF-01");

    if (!df) {
      const createBranchRes = await request.post("http://localhost:4000/api/v1/branches", {
        headers: { Authorization: `Bearer ${ownerToken}` },
        data: {
          name: "Dhanmondi Fashion Outlet",
          code: "DF-01",
          address: "Road 27, Dhanmondi, Dhaka",
        },
      });
      expect(createBranchRes.status()).toBe(201);
      df = (await createBranchRes.json()).data;
    }

    branchAId = gfs.id;
    branchBId = df.id;
  });

  test("Full Transfer Lifecycle: Create draft -> Send dispatch -> Partial receive with loss reason -> Check stock & transit", async ({
    page,
    request,
  }) => {
    test.setTimeout(90000);

    // 1. Login via UI as Owner
    await page.goto("/login");
    await page.fill('input[name="tenantSlug"], [data-testid="tenant-slug-input"]', "artisan-apparel");
    await page.fill('input[name="email"], [data-testid="email-input"]', "owner@artisan.com");
    await page.fill('input[name="password"], [data-testid="password-input"]', "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 15000 });

    // 2. Navigate to Transfers List
    await page.goto("/inventory/transfers");
    await page.waitForSelector('[data-testid="transfers-table"]');
    await expect(page.locator("h1")).toContainText(/স্টক ট্রান্সফার|Stock Transfers/);

    // 3. Click New Transfer
    await page.click('[data-testid="new-transfer-button"]');
    await page.waitForURL("**/inventory/transfers/new");

    // Select Source & Destination Branches
    await page.selectOption('[data-testid="source-branch-select"]', branchAId);
    await page.selectOption('[data-testid="destination-branch-select"]', branchBId);

    // Enter notes
    await page.fill('[data-testid="transfer-notes-input"]', "E2E Inter-branch Transfer Test");

    // Select product
    await page.waitForSelector('[data-testid="transfer-product-select"]');
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="transfer-product-select"] option').length > 1,
      { timeout: 15000 }
    );
    const productOptions = await page.$$eval('[data-testid="transfer-product-select"] option', (opts) =>
      opts.map((o) => ({ value: (o as HTMLOptionElement).value, text: o.textContent || "" })).filter((o) => o.value)
    );
    expect(productOptions.length).toBeGreaterThan(0);
    const selectedProdId = productOptions[0].value;
    await page.selectOption('[data-testid="transfer-product-select"]', selectedProdId);

    // Wait for Size-Color Grid to load
    await page.waitForSelector('[data-testid="grid-bulk-input"]');
    await page.fill('[data-testid="grid-bulk-input"]', "10");
    await page.click('[data-testid="grid-bulk-apply-btn"]');

    // Click "Add to Transfer List"
    await page.click('[data-testid="add-grid-to-transfer-btn"]');

    // Verify item appeared in transfer list table
    await page.waitForSelector('[data-testid="transfer-draft-items-table"] tbody tr');
    const itemCount = await page.locator('[data-testid="transfer-draft-items-table"] tbody tr').count();
    expect(itemCount).toBeGreaterThan(0);

    // Save as Draft
    await page.click('[data-testid="save-draft-transfer-btn"]');

    // Wait for redirect to detail view
    await page.waitForURL(/\/inventory\/transfers\/[0-9a-f-]+/, { timeout: 15000 });
    await page.waitForSelector('[data-testid="transfer-number-title"]');
    const transferNumber = await page.textContent('[data-testid="transfer-number-title"]');
    expect(transferNumber).toMatch(/^TRF-\d{6}-\d{4}$/);

    // Verify Draft Status
    await expect(page.locator('[data-testid="transfer-status-badge"]')).toContainText(/খসড়া|Draft/i);

    // Dispatch / Send the transfer
    await page.click('[data-testid="send-transfer-btn"]');
    await page.waitForTimeout(2000);

    // Verify status changed to In Transit
    await expect(page.locator('[data-testid="transfer-status-badge"]')).toContainText(/ট্রানজিটে আছে|In Transit/i);

    // Check in-transit stock on destination branch via API
    const inTransitRes = await request.get(`http://localhost:4000/api/v1/inventory/transfers/in-transit?branchId=${branchBId}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(inTransitRes.status()).toBe(200);
    const inTransitData = (await inTransitRes.json()).data;
    const totalInTransit = Object.values(inTransitData).reduce((a: any, b: any) => Number(a) + Number(b), 0);
    expect(totalInTransit).toBeGreaterThanOrEqual(10);

    // Now on Detail page: verify Receive section is visible
    await page.waitForSelector('[data-testid="receive-section"]');

    // Set partial receive quantity: change 10 to 8 on the first receive input
    const receiveInput = page.locator('[data-testid^="receive-qty-input-"]').first();
    await receiveInput.fill("8");

    // First attempt to confirm receipt without loss reason -> must show validation error
    await page.click('[data-testid="confirm-receive-btn"]');
    await page.waitForTimeout(1000);
    await expect(page.locator("body")).toContainText(/ঘাটতি|ক্ষতি|reason|Discrepancy/i);

    // Fill in loss reason
    const lossInput = page.locator('[data-testid^="loss-reason-input-"]').first();
    await lossInput.fill("2 units damaged by water leak during road transit");

    // Confirm receipt with loss reason provided
    await page.click('[data-testid="confirm-receive-btn"]');
    await page.waitForTimeout(3000);

    // Verify status updated to Received
    await expect(page.locator('[data-testid="transfer-status-badge"]')).toContainText(/গৃহীত|Received/i);

    // Verify Printable Transfer Note is present in DOM
    const printNote = page.locator("#printable-transfer-note");
    await expect(printNote).toBeVisible();
    await expect(printNote).toContainText(transferNumber || "");
    await expect(printNote).toContainText(/চালান|TRANSFER/i);
  });
});
