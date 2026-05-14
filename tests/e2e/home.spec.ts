import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
});

test("home — hero, palette hotkey, project grid", async ({ page }) => {
  // The home shows live thumbnails of saved projects, so multiple h1s exist.
  // Scope to the hero (first h1). Words are wrapped in motion.span with
  // CSS margins (not real space chars), so the textContent reads as one run.
  await expect(page.locator("section h1").first()).toContainText(/prototype,?\s*without\s*writing\s*JSX/i);
  await expect(page.getByRole("button", { name: /New prototype/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Import/i })).toBeVisible();

  // Cmd/Ctrl+K opens palette
  await page.keyboard.press("Control+K");
  await expect(page.getByPlaceholder("Type a command or search…")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByPlaceholder("Type a command or search…")).toBeHidden();

  // Project grid has at least one card (we know prior seed exists)
  const cards = page.locator(".grid .group");
  expect(await cards.count()).toBeGreaterThan(0);
});

test("home — create project via Cmd+N navigates to workspace", async ({ page }) => {
  const before = await page.locator(".grid .group").count();
  await page.keyboard.press("Control+N");
  await page.waitForURL(/#\/p\//, { timeout: 8_000 });
  await expect(page.url()).toMatch(/#\/p\/[A-Z0-9]+/);
  // Topbar should show some title (Untitled <date>)
  await expect(page.locator("header h1")).toBeVisible();

  // Go back, count should be +1
  await page.locator("button[aria-label='Back to projects']").click();
  await page.waitForURL((u) => !u.hash.startsWith("#/p/"));
  await expect.poll(() => page.locator(".grid .group").count()).toBeGreaterThan(before);
});
