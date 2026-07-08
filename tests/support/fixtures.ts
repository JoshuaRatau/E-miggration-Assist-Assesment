import { test as base, expect, type Page } from "@playwright/test";
import { adminLoginOrThrow } from "./api";

/**
 * Shared fixtures:
 *  - automatic console-error + failed-network capture, attached to the report
 *    for every test (execution requirement: console/network error capture);
 *  - `adminPage`: a page whose context already holds a valid admin session
 *    cookie (logged in via the real login API, not a mock).
 */
export const test = base.extend<{
  errorCapture: void;
  adminPage: Page;
}>({
  errorCapture: [
    async ({ page }, use, testInfo) => {
      const lines: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") lines.push(`CONSOLE ERROR: ${msg.text()}`);
      });
      page.on("pageerror", (err) => lines.push(`PAGE ERROR: ${err.message}`));
      page.on("requestfailed", (req) =>
        lines.push(
          `REQUEST FAILED: ${req.method()} ${req.url()} — ${req.failure()?.errorText ?? "?"}`,
        ),
      );
      page.on("response", (res) => {
        if (res.status() >= 500)
          lines.push(`HTTP ${res.status()}: ${res.request().method()} ${res.url()}`);
      });
      await use();
      if (lines.length > 0) {
        await testInfo.attach("console-and-network-errors", {
          body: lines.join("\n"),
          contentType: "text/plain",
        });
      }
    },
    { auto: true },
  ],

  adminPage: async ({ page }, use) => {
    // page.request shares the browser context's cookie jar, so the session
    // cookie set by the login API is visible to subsequent page navigations.
    await adminLoginOrThrow(page.request);
    await use(page);
  },
});

export { expect };
