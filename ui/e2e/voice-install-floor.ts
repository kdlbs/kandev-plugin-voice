export function registerRejectedMinimumInstallTest(
  test: any,
  expect: any,
  hostVersion: string,
) {
  const pluginId = "kandev-plugin-voice";

  test.describe(`Voice package minimum host guard on ${hostVersion}`, () => {
    test.afterEach(async ({ apiClient }: any) => {
      await apiClient
        .rawRequest("DELETE", `/api/plugins/${pluginId}`)
        .catch(() => undefined);
    });

    test("rejects the final archive before installing it", async ({
      testPage,
      voiceMobilePage,
      apiClient,
    }: any, testInfo: any) => {
      const page =
        testInfo.project.name === "mobile-chrome" ? voiceMobilePage : testPage;
      const health = await apiClient.rawRequest("GET", "/health");
      expect(health.ok).toBe(true);
      expect((await health.json()).version).toBe(hostVersion);

      await page.goto("/settings/plugins");
      await page.getByTestId("install-plugin-trigger").click();
      await expect(page.getByTestId("install-plugin-dialog")).toBeVisible();
      await page.getByTestId("install-plugin-tab-upload").click();
      await page
        .getByTestId("install-plugin-file-input")
        .setInputFiles(process.env.VOICE_PACKAGE_PATH!);

      const installResponse = page.waitForResponse(
        (response: any) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/api/plugins/install"),
      );
      await page.getByTestId("install-plugin-upload-submit").click();
      const response = await installResponse;
      const responseBody = await response.json();

      expect(response.ok()).toBe(false);
      expect(responseBody.error).toContain(
        `requires kandev >= v0.88.0, running ${hostVersion}`,
      );
      await expect(page.getByTestId("install-plugin-error")).toContainText(
        "requires kandev >= v0.88.0",
      );
      await expect(page.getByTestId(`plugin-row-${pluginId}`)).toHaveCount(0);
    });
  });
}
