import path from "node:path";
import { createRequire } from "node:module";

const hostRoot = process.env.KANDEV_HOST_ROOT;
if (!hostRoot) throw new Error("KANDEV_HOST_ROOT is required for Voice host tests");
const hostRequire = createRequire(path.join(hostRoot, "apps/web/package.json"));
const { devices } = hostRequire("@playwright/test");

/**
 * Older host E2E fixtures create their own browser contexts without applying
 * Playwright project device settings. Recreate the Pixel 5 context for those
 * hosts while keeping their normal testPage fixture responsible for setup and
 * backend reset.
 */
export function withVoiceMobilePage(test: any, useHostMobilePage: boolean) {
  return test.extend({
    voiceMobilePage: async (
      { browser, backend, testPage }: any,
      use: (page: any) => Promise<void>,
      testInfo: any,
    ) => {
      if (testInfo.project.name !== "mobile-chrome" || useHostMobilePage) {
        await use(testPage);
        return;
      }

      const context = await browser.newContext({
        ...devices["Pixel 5"],
        baseURL: backend.frontendUrl,
      });
      const page = await context.newPage();
      await page.addInitScript((backendPort: string) => {
        localStorage.setItem("kandev.onboarding.completed", "true");
        (window as any).__KANDEV_API_PORT = backendPort;
        (window as any).__KANDEV_E2E_EXPOSE_STORE__ = true;
        class NotificationStub {
          static permission: NotificationPermission = "granted";
          static async requestPermission(): Promise<NotificationPermission> {
            return "granted";
          }
          close() {}
          addEventListener() {}
          removeEventListener() {}
          dispatchEvent() {
            return false;
          }
        }
        Object.defineProperty(window, "Notification", {
          configurable: true,
          writable: true,
          value: NotificationStub,
        });
      }, String(backend.port));

      try {
        await use(page);
      } finally {
        await context.close();
      }
    },
  });
}
