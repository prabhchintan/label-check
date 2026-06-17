import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Accessibility is a stated need in the brief: agents over 50, varied tech
// comfort, "clean, obvious, no hunting." These scan each screen against WCAG
// 2.0/2.1 A and AA and fail the build on any violation. Reporting the rule ids
// makes a regression legible at a glance.

async function violations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return result.violations.map((v) => `${v.id} (${v.nodes.length})`);
}

test("landing is accessible", async ({ page }) => {
  await page.goto("/");
  expect(await violations(page)).toEqual([]);
});

test("the unified tool screen is accessible", async ({ page }) => {
  await page.goto("/#check");
  await page.locator("#dropzone").waitFor();
  expect(await violations(page)).toEqual([]);
});

test("a rendered result is accessible", async ({ page }) => {
  await page.goto("/#demo-casamigos");
  await expect(page.locator("#result .result-table")).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test("the approach page is accessible", async ({ page }) => {
  await page.goto("/tests.html");
  await page.locator("#stress-gallery .demo-card").first().waitFor();
  expect(await violations(page)).toEqual([]);
});
