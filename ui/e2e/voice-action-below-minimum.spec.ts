import {
  expect,
  test as hostTest,
} from "../../../kandev-min/apps/web/e2e/fixtures/test-base";
import { withVoiceMobilePage } from "./host-mobile-fixture";

const test = withVoiceMobilePage(hostTest, false);

const PLUGIN_ID = "kandev-plugin-voice";
const SETTINGS_PATH = `/api/plugins/${PLUGIN_ID}/user-state/instance/global/voice-mode`;

test.describe("Voice package below its minimum host version", () => {
  test.afterEach(async ({ apiClient }: any) => {
    await apiClient.rawRequest("DELETE", `/api/plugins/${PLUGIN_ID}`).catch(() => undefined);
  });

  test("v0.87.0 keeps the composer action hidden when the package is installed", async ({
    testPage,
    voiceMobilePage,
    apiClient,
    seedData,
  }: any, testInfo) => {
    const page = testInfo.project.name === "mobile-chrome" ? voiceMobilePage : testPage;
    const pageErrors: string[] = [];
    page.on("pageerror", (error: Error) => pageErrors.push(error.message));

    const health = await apiClient.rawRequest("GET", "/health");
    expect(health.ok).toBe(true);
    expect((await health.json()).version).toBe("v0.87.0");

    await page.goto("/settings/plugins");
    await page.getByTestId("install-plugin-trigger").click();
    await expect(page.getByTestId("install-plugin-dialog")).toBeVisible();
    await page.getByTestId("install-plugin-tab-upload").click();
    await page
      .getByTestId("install-plugin-file-input")
      .setInputFiles(process.env.VOICE_PACKAGE_PATH!);
    await page.getByTestId("install-plugin-upload-submit").click();
    await expect(page.getByTestId("install-plugin-dialog")).toBeHidden({
      timeout: 30_000,
    });
    await expect(page.getByTestId(`plugin-row-${PLUGIN_ID}`)).toBeVisible({
      timeout: 30_000,
    });

    const saved = await apiClient.rawRequest("PUT", SETTINGS_PATH, {
      value: {
        enabled: true,
        engine: "webSpeech",
        language: "en-US",
        mode: "toggle",
        autoSend: false,
        whisperWebModel: "tiny",
      },
    });
    expect(saved.ok).toBe(true);

    const task = await apiClient.createTaskWithAgent(
      seedData.workspaceId,
      `Voice below-minimum guard ${testInfo.project.name}`,
      seedData.agentProfileId,
      {
        description: "/e2e:simple-message",
        workflow_id: seedData.workflowId,
        workflow_step_id: seedData.startStepId,
        repository_ids: [seedData.repositoryId],
      },
    );
    if (!task.session_id) throw new Error("below-minimum task has no session id");
    await expect
      .poll(
        async () => {
          const { sessions } = await apiClient.listTaskSessions(task.id);
          return sessions.find((session: any) => session.id === task.session_id)?.state;
        },
        {
          timeout: 30_000,
          message: "below-minimum mock session should finish before navigation",
        },
      )
      .toBe("WAITING_FOR_INPUT");
    await page.goto(`/t/${task.id}`);
    const chat = page.locator('[data-testid="session-chat"]:visible').first();
    const editor = chat.locator('.tiptap.ProseMirror[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await expect(editor).toBeEditable({ timeout: 30_000 });
    await expect(chat.getByTestId("voice-plugin-button")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });
});
