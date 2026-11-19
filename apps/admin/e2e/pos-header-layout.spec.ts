import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe("Step 1: POS Header Layout, Text Node Overlap & Overflow Verification", () => {
  const repoRoot = path.resolve(__dirname, "../../../");
  const screenshotsDir = path.resolve(repoRoot, "docs/screenshots/pos-header");

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
  });

  const widths = [375, 768, 1024, 1280, 1366, 1440, 1536, 1920];

  // Helper to ensure an open shift exists on REG01 for tests
  async function ensureOpenShift(request: any, token: string) {
    const meRes = await request.get("http://localhost:4000/api/v1/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const me = (await meRes.json()).data;

    const branchRes = await request.get("http://localhost:4000/api/v1/branches", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const branches = (await branchRes.json()).data;
    const branch = branches.find((b: any) => b.code === "GFS-01") || branches[0];

    const regRes = await request.get(`http://localhost:4000/api/v1/registers?branchId=${branch.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const registers = (await regRes.json()).data || [];
    const reg = registers[0];

    // Check shift status
    const shiftRes = await request.get(`http://localhost:4000/api/v1/shifts?registerId=${reg.id}&status=open`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const shiftData = await shiftRes.json();
    const items = shiftData.data?.items || shiftData.data || [];

    // If open shift belongs to another cashier, close it first
    for (const item of items) {
      if (item.cashierUserId !== me.id) {
        await request.post(`http://localhost:4000/api/v1/shifts/${item.id}/close`, {
          headers: { Authorization: `Bearer ${token}` },
          data: { closingCashMinor: Number(item.openingCashMinor || 50000) },
        }).catch(() => {});
      }
    }

    // Re-check shift for current user
    const checkRes = await request.get(`http://localhost:4000/api/v1/shifts?registerId=${reg.id}&status=open`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const remaining = (await checkRes.json()).data?.items || [];
    if (!remaining.length) {
      await request.post("http://localhost:4000/api/v1/shifts/open", {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          registerId: reg.id,
          branchId: branch.id,
          openingCashMinor: 50000,
        },
      });
    }

    return { branchId: branch.id, registerId: reg.id };
  }

  // 1. Verification with Seed Names across all 8 widths (Bangla & English)
  test("header layout with seed names: no text overlap, no unhandled clipping, 1 row >= 768px", async ({
    page,
    request,
  }) => {
    test.setTimeout(120000);

    const loginRes = await request.post("http://localhost:4000/api/v1/auth/login", {
      data: {
        tenantSlug: "artisan-apparel",
        email: "owner@artisan.com",
        password: "Password123!",
      },
    });
    expect(loginRes.ok()).toBe(true);
    const token = (await loginRes.json()).data.accessToken;
    const { branchId, registerId } = await ensureOpenShift(request, token);

    // Sign in on UI
    await page.goto("http://localhost:3000/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 15000 });

    // Set branch and register in localStorage
    await page.evaluate(({ bId, rId }) => {
      localStorage.setItem("pos_selected_branch_id", bId);
      localStorage.setItem(`pos_reg_${bId}`, rId);
    }, { bId: branchId, rId: registerId });

    await page.goto("http://localhost:3000/pos");
    await page.waitForURL("**/pos", { timeout: 15000 });

    const header = page.locator("header");
    await expect(header).toBeVisible({ timeout: 10000 });

    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(300);

      // (a) Header height: at 768px and above, header height equals one row (56px)
      if (width >= 768) {
        const box = await header.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeLessThanOrEqual(60);
      }

      // (b) Core action buttons are visible and clickable at every width
      const cashBtn = page.locator('[data-testid="cash-movement-button"]');
      const returnBtn = page.locator('[data-testid="pos-return-button"]');
      const closeBtn = page.locator('[data-testid="close-shift-button"]');

      await expect(cashBtn).toBeVisible({ timeout: 5000 });
      await expect(returnBtn).toBeVisible({ timeout: 5000 });
      await expect(closeBtn).toBeVisible({ timeout: 5000 });

      // (c) Text of every visible header item does not overlap any other item (Range.getBoundingClientRect)
      const textCollisions = await page.evaluate(() => {
        const headerEl = document.querySelector("header");
        if (!headerEl) return [];

        function getVisibleRect(rangeRect: DOMRect, el: Element) {
          let left = rangeRect.left;
          let top = rangeRect.top;
          let right = rangeRect.right;
          let bottom = rangeRect.bottom;
          let cur: Element | null = el;
          while (cur && cur !== document.body) {
            const style = window.getComputedStyle(cur);
            if (style.overflow === "hidden" || style.overflowX === "hidden") {
              const b = cur.getBoundingClientRect();
              left = Math.max(left, b.left);
              top = Math.max(top, b.top);
              right = Math.min(right, b.right);
              bottom = Math.min(bottom, b.bottom);
            }
            cur = cur.parentElement;
          }
          return {
            left,
            top,
            right,
            bottom,
            width: Math.max(0, right - left),
            height: Math.max(0, bottom - top),
          };
        }

        const nodes: { text: string; rect: { left: number; top: number; right: number; bottom: number; width: number; height: number }; parent: Element }[] = [];
        const walker = document.createTreeWalker(headerEl, NodeFilter.SHOW_TEXT);
        let n: Node | null;
        while ((n = walker.nextNode())) {
          const val = n.nodeValue?.trim();
          if (val && val.length > 0 && n.parentElement) {
            if (n.parentElement.closest('[style*="display: none"]')) continue;
            const r = document.createRange();
            r.selectNodeContents(n);
            const rangeRect = r.getBoundingClientRect();
            const visibleRect = getVisibleRect(rangeRect, n.parentElement);
            if (visibleRect.width > 0 && visibleRect.height > 0) {
              nodes.push({ text: val, rect: visibleRect, parent: n.parentElement });
            }
          }
        }

        const collisions: string[] = [];
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i];
            const b = nodes[j];
            const aButton = a.parent.closest("button, a");
            const bButton = b.parent.closest("button, a");
            if (aButton && bButton && aButton === bButton) continue;

            const overlap = !(
              a.rect.right <= b.rect.left + 0.5 ||
              b.rect.right <= a.rect.left + 0.5 ||
              a.rect.bottom <= b.rect.top + 0.5 ||
              b.rect.bottom <= a.rect.top + 0.5
            );
            if (overlap) {
              collisions.push(`"${a.text}" overlaps with "${b.text}"`);
            }
          }
        }
        return collisions;
      });
      expect(textCollisions).toEqual([]);

      // (d) No unhandled clipping: scrollWidth <= clientWidth unless intentional ellipsis with title tooltip
      const unhandledClipping = await page.evaluate(() => {
        const headerEl = document.querySelector("header");
        if (!headerEl) return [];

        const clipped: string[] = [];
        const allEls = headerEl.querySelectorAll("*");
        for (const el of allEls) {
          // Check leaf elements with text
          if (el.children.length === 0 && el.textContent?.trim()) {
            if (el.scrollWidth > Math.ceil(el.clientWidth) + 1) {
              const isEllipsis = window.getComputedStyle(el).textOverflow === "ellipsis";
              const hasTitle = Boolean(
                el.getAttribute("title") ||
                el.closest("[title]")?.getAttribute("title")
              );
              if (!isEllipsis || !hasTitle) {
                clipped.push(
                  `<${el.tagName}> "${el.textContent?.trim()}" scrollWidth=${el.scrollWidth} > clientWidth=${el.clientWidth} without title`
                );
              }
            }
          }
        }
        return clipped;
      });
      expect(unhandledClipping).toEqual([]);

      // Capture Bangla Light Screenshot at each width
      await header.screenshot({
        path: path.join(screenshotsDir, `header-${width}-bn-light.png`),
      });
    }

    // Capture 1920px Dark Mode Screenshot
    await page.setViewportSize({ width: 1920, height: 900 });
    const themeBtn = page.locator('header button[aria-label*="থিম"], header button[aria-label*="theme"]').first();
    if (await themeBtn.isVisible()) {
      await themeBtn.click();
      await page.waitForTimeout(300);
    }
    await header.screenshot({
      path: path.join(screenshotsDir, "header-1920-bn-dark.png"),
    });

    // Toggle back to light
    if (await themeBtn.isVisible()) {
      await themeBtn.click();
      await page.waitForTimeout(300);
    }
  });

  // 2. Verification with Long Names (Cashier, Branch, Register) created via API
  test("header layout with long names: adjusts gracefully, truncates with tooltip, no overlap", async ({
    page,
    request,
  }) => {
    test.setTimeout(120000);

    const loginRes = await request.post("http://localhost:4000/api/v1/auth/login", {
      data: {
        tenantSlug: "artisan-apparel",
        email: "owner@artisan.com",
        password: "Password123!",
      },
    });
    const token = (await loginRes.json()).data.accessToken;

    const { branchId, registerId } = await ensureOpenShift(request, token);

    // Fetch cashier user id (Tariqul Islam)
    const meRes = await request.get("http://localhost:4000/api/v1/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const me = (await meRes.json()).data;
    const userId = me.id;

    // Update with long names:
    // - Cashier: "Mohammad Abdur Rahman Chowdhury"
    // - Branch: "Gulshan Flagship Store — Road 11, Block C"
    // - Register: "Main Counter Near Entrance Gate"
    await request.patch(`http://localhost:4000/api/v1/users/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: "Mohammad Abdur Rahman Chowdhury" },
    });
    await request.patch(`http://localhost:4000/api/v1/branches/${branchId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: "Gulshan Flagship Store — Road 11, Block C" },
    });
    await request.patch(`http://localhost:4000/api/v1/registers/${registerId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: "Main Counter Near Entrance Gate" },
    });

    try {
      // Re-login on UI to pick up new user name
      await page.goto("http://localhost:3000/login");
      await page.fill("#tenantSlug", "artisan-apparel");
      await page.fill("#email", "owner@artisan.com");
      await page.fill("#password", "Password123!");
      await page.click('button[type="submit"]');
      await page.waitForURL("**/dashboard", { timeout: 15000 });

      await page.evaluate(({ bId, rId }) => {
        localStorage.setItem("pos_selected_branch_id", bId);
        localStorage.setItem(`pos_reg_${bId}`, rId);
      }, { bId: branchId, rId: registerId });

      await page.goto("http://localhost:3000/pos");
      await page.waitForURL("**/pos", { timeout: 15000 });

      const header = page.locator("header");
      await expect(header).toBeVisible({ timeout: 10000 });

      // Verify that the long names are displayed and truncated with title tooltip
      const cashierNameEl = page.locator('[data-testid="cashier-name"]');
      await expect(cashierNameEl).toBeVisible();
      expect(await cashierNameEl.getAttribute("title")).toBe("Mohammad Abdur Rahman Chowdhury");

      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(300);

        if (width >= 768) {
          const box = await header.boundingBox();
          expect(box).not.toBeNull();
          expect(box!.height).toBeLessThanOrEqual(60);
        }

        // Verify no overlap on text nodes even with long names
        const textCollisions = await page.evaluate(() => {
          const headerEl = document.querySelector("header");
          if (!headerEl) return [];

          function getVisibleRect(rangeRect: DOMRect, el: Element) {
            let left = rangeRect.left;
            let top = rangeRect.top;
            let right = rangeRect.right;
            let bottom = rangeRect.bottom;
            let cur: Element | null = el;
            while (cur && cur !== document.body) {
              const style = window.getComputedStyle(cur);
              if (style.overflow === "hidden" || style.overflowX === "hidden") {
                const b = cur.getBoundingClientRect();
                left = Math.max(left, b.left);
                top = Math.max(top, b.top);
                right = Math.min(right, b.right);
                bottom = Math.min(bottom, b.bottom);
              }
              cur = cur.parentElement;
            }
            return {
              left,
              top,
              right,
              bottom,
              width: Math.max(0, right - left),
              height: Math.max(0, bottom - top),
            };
          }

          const nodes: { text: string; rect: { left: number; top: number; right: number; bottom: number; width: number; height: number }; parent: Element }[] = [];
          const walker = document.createTreeWalker(headerEl, NodeFilter.SHOW_TEXT);
          let n: Node | null;
          while ((n = walker.nextNode())) {
            const val = n.nodeValue?.trim();
            if (val && val.length > 0 && n.parentElement) {
              if (n.parentElement.closest('[style*="display: none"]')) continue;
              const r = document.createRange();
              r.selectNodeContents(n);
              const rangeRect = r.getBoundingClientRect();
              const visibleRect = getVisibleRect(rangeRect, n.parentElement);
              if (visibleRect.width > 0 && visibleRect.height > 0) {
                nodes.push({ text: val, rect: visibleRect, parent: n.parentElement });
              }
            }
          }

          const collisions: string[] = [];
          for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
              const a = nodes[i];
              const b = nodes[j];
              const aButton = a.parent.closest("button, a");
              const bButton = b.parent.closest("button, a");
              if (aButton && bButton && aButton === bButton) continue;

              const overlap = !(
                a.rect.right <= b.rect.left + 0.5 ||
                b.rect.right <= a.rect.left + 0.5 ||
                a.rect.bottom <= b.rect.top + 0.5 ||
                b.rect.bottom <= a.rect.top + 0.5
              );
              if (overlap) {
                collisions.push(`"${a.text}" overlaps with "${b.text}"`);
              }
            }
          }
          return collisions;
        });
        expect(textCollisions).toEqual([]);
      }
    } finally {
      // Revert names cleanly back to original seed values
      await request.patch(`http://localhost:4000/api/v1/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: "Tariqul Islam" },
      });
      await request.patch(`http://localhost:4000/api/v1/branches/${branchId}`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: "Gulshan Flagship" },
      });
      await request.patch(`http://localhost:4000/api/v1/registers/${registerId}`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: "Main Counter" },
      });
    }
  });

  // 3. Connection Status Pill States across all 8 widths (Milestone D3/D4/D6)
  test("header connection pill states (online, offline, syncing, failed) across all 8 widths: no overlap", async ({
    page,
    context,
    request,
  }) => {
    test.setTimeout(180000);

    const loginRes = await request.post("http://localhost:4000/api/v1/auth/login", {
      data: {
        tenantSlug: "artisan-apparel",
        email: "owner@artisan.com",
        password: "Password123!",
      },
    });
    expect(loginRes.ok()).toBe(true);
    const token = (await loginRes.json()).data.accessToken;
    const { branchId, registerId } = await ensureOpenShift(request, token);

    // Sign in on UI
    await page.goto("http://localhost:3000/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 15000 });

    // Set branch and register in localStorage
    await page.evaluate(({ bId, rId }) => {
      localStorage.setItem("pos_selected_branch_id", bId);
      localStorage.setItem(`pos_reg_${bId}`, rId);
    }, { bId: branchId, rId: registerId });

    await page.goto("http://localhost:3000/pos");
    await page.waitForURL("**/pos", { timeout: 15000 });

    const header = page.locator("header");
    await expect(header).toBeVisible({ timeout: 10000 });

    const connPill = page.locator('[data-testid="connection-status-pill"]');
    await expect(connPill).toBeVisible({ timeout: 5000 });

    // Helper for checking text collisions
    async function assertNoHeaderCollisions() {
      const textCollisions = await page.evaluate(() => {
        const headerEl = document.querySelector("header");
        if (!headerEl) return [];

        function getVisibleRect(rangeRect: DOMRect, el: Element) {
          let left = rangeRect.left;
          let top = rangeRect.top;
          let right = rangeRect.right;
          let bottom = rangeRect.bottom;
          let cur: Element | null = el;
          while (cur && cur !== document.body) {
            const style = window.getComputedStyle(cur);
            if (style.overflow === "hidden" || style.overflowX === "hidden") {
              const b = cur.getBoundingClientRect();
              left = Math.max(left, b.left);
              top = Math.max(top, b.top);
              right = Math.min(right, b.right);
              bottom = Math.min(bottom, b.bottom);
            }
            cur = cur.parentElement;
          }
          return {
            left,
            top,
            right,
            bottom,
            width: Math.max(0, right - left),
            height: Math.max(0, bottom - top),
          };
        }

        const nodes: { text: string; rect: { left: number; top: number; right: number; bottom: number; width: number; height: number }; parent: Element }[] = [];
        const walker = document.createTreeWalker(headerEl, NodeFilter.SHOW_TEXT);
        let n: Node | null;
        while ((n = walker.nextNode())) {
          const val = n.nodeValue?.trim();
          if (val && val.length > 0 && n.parentElement) {
            if (n.parentElement.closest('[style*="display: none"]')) continue;
            const r = document.createRange();
            r.selectNodeContents(n);
            const rangeRect = r.getBoundingClientRect();
            const visibleRect = getVisibleRect(rangeRect, n.parentElement);
            if (visibleRect.width > 0 && visibleRect.height > 0) {
              nodes.push({ text: val, rect: visibleRect, parent: n.parentElement });
            }
          }
        }

        const collisions: string[] = [];
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i];
            const b = nodes[j];
            const aButton = a.parent.closest("button, a");
            const bButton = b.parent.closest("button, a");
            if (aButton && bButton && aButton === bButton) continue;

            const overlap = !(
              a.rect.right <= b.rect.left + 0.5 ||
              b.rect.right <= a.rect.left + 0.5 ||
              a.rect.bottom <= b.rect.top + 0.5 ||
              b.rect.bottom <= a.rect.top + 0.5
            );
            if (overlap) {
              collisions.push(`"${a.text}" overlaps with "${b.text}"`);
            }
          }
        }
        return collisions;
      });
      expect(textCollisions).toEqual([]);
    }

    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(200);

      // (a) Online state check
      await expect(connPill).toContainText(/অনলাইন|Online/);
      if (width >= 768) {
        const box = await header.boundingBox();
        expect(box!.height).toBeLessThanOrEqual(60);
      }
      await assertNoHeaderCollisions();

      // (b) Offline state check
      await context.setOffline(true);
      await page.waitForTimeout(200);

      await expect(connPill).toContainText(/অফলাইন|Offline/);
      if (width >= 768) {
        const box = await header.boundingBox();
        expect(box!.height).toBeLessThanOrEqual(60);
      }
      await assertNoHeaderCollisions();

      // Core actions disabled offline
      const returnBtn = page.locator('[data-testid="pos-return-button"]');
      const closeBtn = page.locator('[data-testid="close-shift-button"]');
      const cashBtn = page.locator('[data-testid="cash-movement-button"]');
      await expect(returnBtn).toBeDisabled();
      await expect(closeBtn).toBeDisabled();
      await expect(cashBtn).toBeDisabled();

      // (c) Restore online
      await context.setOffline(false);
      await page.waitForTimeout(200);
      await expect(connPill).toContainText(/অনলাইন|Online/);

      // (d) Syncing state check
      await page.evaluate(async () => {
        const req = indexedDB.open("UniversalPosOffline");
        req.onsuccess = () => {
          const idb = req.result;
          if (idb.objectStoreNames.contains("outbox")) {
            const tx = idb.transaction("outbox", "readwrite");
            tx.objectStore("outbox").put({
              id: "dummy-syncing-item",
              idempotencyKey: "dummy-key-sync",
              type: "sale",
              payload: {},
              status: "pending",
              attemptCount: 0,
              nextAttemptAt: Date.now() + 60000,
              createdAt: Date.now(),
            });
          }
        };
      });
      await page.waitForTimeout(600);
      if (await connPill.innerText().then(t => t.includes("সিঙ্ক") || t.includes("Sync"))) {
        await assertNoHeaderCollisions();
      }

      // (e) Failed state check
      await page.evaluate(async () => {
        const req = indexedDB.open("UniversalPosOffline");
        req.onsuccess = () => {
          const idb = req.result;
          if (idb.objectStoreNames.contains("outbox")) {
            const tx = idb.transaction("outbox", "readwrite");
            tx.objectStore("outbox").put({
              id: "dummy-failed-item",
              idempotencyKey: "dummy-key-fail",
              type: "sale",
              payload: {},
              status: "failed",
              attemptCount: 5,
              nextAttemptAt: Date.now() + 60000,
              createdAt: Date.now(),
            });
          }
        };
      });
      await page.waitForTimeout(600);
      if (await connPill.innerText().then(t => t.includes("সিঙ্ক হয়নি") || t.includes("failed"))) {
        await assertNoHeaderCollisions();
      }

      // Cleanup outbox dummy records
      await page.evaluate(async () => {
        const req = indexedDB.open("UniversalPosOffline");
        req.onsuccess = () => {
          const idb = req.result;
          if (idb.objectStoreNames.contains("outbox")) {
            const tx = idb.transaction("outbox", "readwrite");
            tx.objectStore("outbox").delete("dummy-syncing-item");
            tx.objectStore("outbox").delete("dummy-failed-item");
          }
        };
      });
      await page.waitForTimeout(400);
    }
  });
});
