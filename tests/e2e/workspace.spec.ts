import { test, expect } from "@playwright/test";

const DAEMON = process.env.DAEMON_URL ?? "http://127.0.0.1:7457";

/* Open a project that actually has a tree. We ask the daemon directly which
 * project is non-empty (the home grid is a sea of empties from prior tests)
 * and navigate via hash. */
async function openProjectWithTree(page: import("@playwright/test").Page): Promise<boolean> {
  const list = await fetch(`${DAEMON}/api/projects`).then((r) => r.json());
  for (const p of list.projects) {
    const proj = await fetch(`${DAEMON}/api/projects/${p.id}`).then((r) => r.json());
    if (proj.prototype?.root) {
      await page.goto(`/#/p/${p.id}`);
      await page.locator("[data-node-id]").first().waitFor({ timeout: 10_000 });
      // Beaver components stamp data-bvr — wait for the rendered DS code.
      await page.locator("[data-bvr]").first().waitFor({ timeout: 10_000 });
      return true;
    }
  }
  return false;
}

test("workspace — topbar + preview renders for a non-empty project", async ({ page }) => {
  const ok = await openProjectWithTree(page);
  test.skip(!ok, "no project with nodes; create one before running this suite");

  await expect(page.url()).toMatch(/#\/p\//);

  // Topbar has rev chip + nodes chip
  await expect(page.locator("header").getByText(/^rev /i)).toBeVisible();
  await expect(page.locator("header").getByText(/nodes?$/i)).toBeVisible();

  // Zoom badge in preview controls
  await expect(page.locator("button[aria-label='Reset zoom']")).toContainText("100%");

  // Preview has rendered content. Beaver's PageShell stamps `data-bvr` on its
  // root DOM element — that's the most stable assertion that the real DS code
  // executed (not just our wrapper span).
  await expect(page.locator("[data-bvr='page-shell']").first()).toBeAttached();
});

test("workspace — click a node opens inspector, Esc closes it", async ({ page }) => {
  const ok = await openProjectWithTree(page);
  test.skip(!ok, "no project with nodes");

  const target = page.locator("[data-node-id] > *").first();
  await target.click({ force: true });
  await expect(page.getByText("INSPECTOR")).toBeVisible();
  await expect(page.getByRole("tab", { name: /Props/ })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByText("INSPECTOR")).toBeHidden();
});

test("workspace — palette → 'Back to projects' navigates home", async ({ page }) => {
  const ok = await openProjectWithTree(page);
  test.skip(!ok, "no project with nodes");

  await page.keyboard.press("Control+K");
  const input = page.getByPlaceholder("Type a command or search…");
  await expect(input).toBeVisible();
  await input.fill("back");
  await expect(page.locator("[cmdk-item]", { hasText: /Back to projects/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await page.waitForURL((u) => !u.hash.startsWith("#/p/"));
});
