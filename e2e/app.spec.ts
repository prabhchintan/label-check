import { test, expect } from "@playwright/test";

// Core user journeys, driven against the real app in mock mode. These prove the
// unified flow, the deterministic result table, the 300-label batch, the glass
// reveal, and graceful errors actually work in a browser, not just in unit tests.

test("landing shows the federal shell and a single call to action", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".disclaim-banner")).toContainText("Not affiliated with TTB");
  await expect(page.locator(".masthead-name")).toHaveText("Label Check");
  await expect(page.locator(".hero-l1")).toHaveText("Verify an alcohol label");
  await expect(page.locator("#open-tool")).toBeVisible();
  // No Treasury seal or "official website" banner is impersonated.
  await expect(page.locator("body")).not.toContainText("official website of the United States");
});

test("the sample gallery sits behind glass and reveals on scroll", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".gallery-glass")).toBeAttached();
  // Wait for the gallery to render, so the reveal listeners are wired before we scroll.
  await page.locator("#landing-gallery .tile").first().waitFor();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.locator(".reveal-zone")).toHaveClass(/revealed/);
});

test("a real demo label returns all seven element verdicts", async ({ page }) => {
  await page.goto("/#demo-casamigos");
  const rows = page.locator("#result .result-table tbody tr");
  await expect(rows).toHaveCount(7);
  await expect(page.locator("#result .tier-banner")).toBeVisible();
  // The application panel opens so the field-by-field comparison is visible.
  await expect(page.locator("#app-details")).toHaveJSProperty("open", true);
});

test("the stress test screens 300 labels in one pass", async ({ page }) => {
  await page.goto("/#check");
  await page.locator("#stress-btn").click();
  await expect(page.locator("#progress-text")).toHaveText(/300 of 300/, { timeout: 90_000 });
  await expect(page.locator("#batch-grid .batch-card")).toHaveCount(300);
  await expect(page.locator("#batch-grid .batch-card.pending")).toHaveCount(0);
  await expect(page.locator("#batch-summary")).toContainText("passed");
});

test("checking with no image is a clear message, not a crash", async ({ page }) => {
  await page.goto("/#check");
  await page.locator("#verify-btn").click();
  await expect(page.locator("#result .error-box")).toContainText("Drop a label image first");
});

test("the approach page loads and links back cleanly", async ({ page }) => {
  await page.goto("/tests.html");
  await expect(page.locator(".eng-h1")).toHaveText("How it works");
  await expect(page.locator("#stress-gallery .demo-card").first()).toBeVisible();
  // tests.js retargets the back link to the clean app root (/ at a root deploy).
  await expect(page.locator('a[data-home]').first()).toHaveAttribute("href", "/");
});
