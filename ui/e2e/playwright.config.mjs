import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, "../..");
const hostRoot = process.env.KANDEV_HOST_ROOT;
const variant = process.env.VOICE_HOST_VARIANT;

if (
  !hostRoot ||
  !["modern", "legacy", "below-minimum", "below-minimum-0871"].includes(
    variant ?? "",
  )
) {
  throw new Error(
    "Set KANDEV_HOST_ROOT and VOICE_HOST_VARIANT=modern|legacy|below-minimum|below-minimum-0871 before running Voice host smoke tests.",
  );
}

export default {
  testDir: here,
  testMatch: [`voice-action-${variant}.spec.ts`],
  tsconfig: path.join(hostRoot, "apps/web/tsconfig.json"),
  globalSetup: path.join(hostRoot, "apps/web/e2e/global-setup.ts"),
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 5_000 },
  outputDir: path.join(pluginRoot, ".tmp/voice-e2e-results"),
  reporter: "list",
  use: {
    actionTimeout: 15_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "mobile-chrome", use: { browserName: "chromium" } },
  ],
};
