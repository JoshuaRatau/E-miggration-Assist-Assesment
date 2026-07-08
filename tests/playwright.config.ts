import { defineConfig, devices } from "@playwright/test";
import { execSync } from "node:child_process";

// Playwright's bundled chromium cannot run on NixOS (missing shared libs);
// use the system chromium installed via Nix. Override with E2E_CHROMIUM.
function systemChromium(): string | undefined {
  if (process.env.E2E_CHROMIUM) return process.env.E2E_CHROMIUM;
  try {
    return execSync("which chromium", { encoding: "utf8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * E2E suite for the EMA leads funnel.
 *
 * Runs against the local dev stack via the shared proxy (web at "/",
 * API at "/api"). Override with E2E_BASE_URL to point at another env.
 *
 * Workers are pinned to 1 because all tests share one Postgres database;
 * parallel mutation of the leads table makes count/pipeline assertions flaky.
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:80",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { executablePath: systemChromium() },
      },
    },
  ],
});
