const PLUGIN_ID = "kandev-plugin-voice";
const SETTINGS_PATH = `/api/plugins/${PLUGIN_ID}/user-state/instance/global/voice-mode`;
const PACKAGE_PATH = process.env.VOICE_PACKAGE_PATH;

const webSpeechSettings = {
  enabled: true,
  engine: "webSpeech",
  language: "en-US",
  mode: "toggle",
  autoSend: false,
  whisperWebModel: "tiny",
};

const whisperSettings = {
  ...webSpeechSettings,
  engine: "whisperWeb",
};

const FAKE_APIS = () => {
  const target = window as any;
  const state: any = {
    speech: [],
    mediaDeferred: false,
    resolveMedia: null,
    trackStops: 0,
    recorderStarts: 0,
    workerInstances: [],
    holdWhisperReady: false,
  };
  target.__voiceE2E = state;

  class FakeSpeechRecognition {
    lang = "";
    continuous = false;
    interimResults = false;
    maxAlternatives = 1;
    onresult: ((event: unknown) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    onend: (() => void) | null = null;

    constructor() {
      state.speech.push(this);
    }

    start() {}

    stop() {
      state.speechStopCalls = (state.speechStopCalls ?? 0) + 1;
    }

    abort() {
      state.speechAbortCalls = (state.speechAbortCalls ?? 0) + 1;
    }

    emit(text: string) {
      const result = { isFinal: true, 0: { transcript: text }, length: 1 };
      this.onresult?.({ resultIndex: 0, results: [result] });
    }

    finish() {
      this.onend?.();
    }
  }

  Object.defineProperty(window, "SpeechRecognition", {
    configurable: true,
    value: FakeSpeechRecognition,
  });

  const makeStream = () => {
    const track = { stop: () => (state.trackStops += 1) };
    return { getTracks: () => [track] };
  };
  Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
    configurable: true,
    value: () => {
      if (state.mediaDeferred) {
        return new Promise((resolve) => {
          state.resolveMedia = () => resolve(makeStream());
        });
      }
      return Promise.resolve(makeStream());
    },
  });

  const wavBytes = (() => {
    const samples = 16000;
    const bytes = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(bytes);
    const write = (offset: number, value: string) => {
      for (let index = 0; index < value.length; index += 1) {
        view.setUint8(offset + index, value.charCodeAt(index));
      }
    };
    write(0, "RIFF");
    view.setUint32(4, 36 + samples * 2, true);
    write(8, "WAVE");
    write(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true);
    view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, "data");
    view.setUint32(40, samples * 2, true);
    return new Uint8Array(bytes);
  })();

  class FakeMediaRecorder extends EventTarget {
    static isTypeSupported(type: string) {
      return type === "audio/wav";
    }

    state = "inactive";
    mimeType = "audio/wav";

    start() {
      this.state = "recording";
      state.recorderStarts += 1;
    }

    stop() {
      this.state = "inactive";
      this.dispatchEvent(
        new BlobEvent("dataavailable", {
          data: new Blob([wavBytes], { type: this.mimeType }),
        }),
      );
      this.dispatchEvent(new Event("stop"));
    }
  }
  Object.defineProperty(window, "MediaRecorder", {
    configurable: true,
    value: FakeMediaRecorder,
  });

  class FakeWorker extends EventTarget {
    constructor(readonly url: string) {
      super();
      state.workerInstances.push(this);
    }

    postMessage(message: any) {
      if (message.type === "init") {
        queueMicrotask(() =>
          this.send({ type: "progress", stage: "download", progress: 42 }),
        );
        if (!state.holdWhisperReady) {
          queueMicrotask(() => this.send({ type: "ready" }));
        }
      } else if (message.type === "transcribe") {
        queueMicrotask(() =>
          this.send({ type: "result", text: "FAKE WHISPER RESULT" }),
        );
      }
    }

    send(data: unknown) {
      this.dispatchEvent(new MessageEvent("message", { data }));
    }

    terminate() {}
  }
  const NativeWorker = window.Worker;
  window.Worker = new Proxy(NativeWorker, {
    construct(Target, args: [string | URL, WorkerOptions?]) {
      if (String(args[0]).includes("whisper-worker.js")) {
        return new FakeWorker(String(args[0]));
      }
      return Reflect.construct(Target, args);
    },
  });
  state.releaseWhisper = () => {
    state.holdWhisperReady = false;
    for (const worker of state.workerInstances) worker.send({ type: "ready" });
  };
};

function registerVoiceActionTests(test: any, expect: any) {
  function selectProjectPage(testPage: any, voiceMobilePage: any, testInfo: any) {
    return testInfo.project.name === "mobile-chrome" ? voiceMobilePage : testPage;
  }

  test.describe("Voice composer action against a real Kandev host", () => {
    test.beforeEach(async ({ testPage, voiceMobilePage }: any, testInfo: any) => {
      const page = selectProjectPage(testPage, voiceMobilePage, testInfo);
      await page.addInitScript(FAKE_APIS);
    });

    test.afterEach(async ({ apiClient }: any) => {
      await apiClient
        .rawRequest("DELETE", `/api/plugins/${PLUGIN_ID}`)
        .catch(() => undefined);
    });

    async function installVoice(
      testPage: any,
      apiClient: any,
      settings = webSpeechSettings,
    ) {
      if (!PACKAGE_PATH)
        throw new Error(
          "VOICE_PACKAGE_PATH must point at the built Voice package",
        );
      await testPage.goto("/settings/plugins");
      await testPage.getByTestId("install-plugin-trigger").click();
      await expect(testPage.getByTestId("install-plugin-dialog")).toBeVisible();
      await testPage.getByTestId("install-plugin-tab-upload").click();
      await testPage
        .getByTestId("install-plugin-file-input")
        .setInputFiles(PACKAGE_PATH);
      await testPage.getByTestId("install-plugin-upload-submit").click();
      await expect(testPage.getByTestId("install-plugin-dialog")).toBeHidden({
        timeout: 30_000,
      });
      await expect(testPage.getByTestId(`plugin-row-${PLUGIN_ID}`)).toBeVisible(
        { timeout: 30_000 },
      );

      const saved = await apiClient.rawRequest("PUT", SETTINGS_PATH, {
        value: settings,
      });
      if (!saved.ok) {
        throw new Error(
          `Saving Voice E2E settings failed (${saved.status}): ${await saved.text()}`,
        );
      }
    }

    async function createTask(
      testPage: any,
      apiClient: any,
      seedData: any,
      title: string,
    ) {
      const task = await apiClient.createTaskWithAgent(
        seedData.workspaceId,
        title,
        seedData.agentProfileId,
        {
          description: "/e2e:simple-message",
          workflow_id: seedData.workflowId,
          workflow_step_id: seedData.startStepId,
          repository_ids: [seedData.repositoryId],
        },
      );
      if (!task.session_id) throw new Error("Voice E2E task has no session id");
      await expect
        .poll(
          async () => {
            const { sessions } = await apiClient.listTaskSessions(task.id);
            return sessions.find((session: any) => session.id === task.session_id)?.state;
          },
          {
            timeout: 30_000,
            message: "Voice mock session should finish before composer interaction",
          },
        )
        .toBe("WAITING_FOR_INPUT");
      await testPage.goto(`/t/${task.id}`);
      const chat = testPage
        .locator('[data-testid="session-chat"]:visible')
        .first();
      const editor = chat
        .locator('.tiptap.ProseMirror[contenteditable="true"]')
        .first();
      await expect(editor).toBeVisible({ timeout: 30_000 });
      await expect(editor).toBeEditable({ timeout: 30_000 });
      return { task, chat, editor };
    }

    async function openQuickChat(testPage: any, touch: boolean) {
      if (touch) {
        const navigationTrigger = testPage.getByTestId("app-nav-trigger");
        if (
          (await navigationTrigger.count()) > 0 &&
          (await navigationTrigger.isVisible().catch(() => false))
        ) {
          await navigationTrigger.tap();
        }
        await testPage.getByTestId("mobile-quick-chat-button").tap();
      } else {
        await testPage.keyboard.press("Control+Shift+q");
      }
      const dialog = testPage.getByRole("dialog", { name: "Quick Chat" });
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      const setup = dialog.getByTestId("quick-chat-setup");
      if (!(await setup.isVisible().catch(() => false))) {
        await dialog.getByTestId("quick-chat-add-menu-trigger").click();
        await testPage.getByTestId("quick-chat-new-agent").click();
      }
      const selector = dialog.getByTestId("agent-profile-selector");
      if ((await selector.innerText()).includes("Select agent")) {
        await selector.click();
        await testPage.getByRole("option").first().click();
      }
      await dialog.getByTestId("quick-chat-start").click();
      const editor = dialog
        .locator('.tiptap.ProseMirror[contenteditable="true"]:visible')
        .first();
      await expect(editor).toBeVisible({ timeout: 20_000 });
      await expect(
        dialog.getByTestId("submit-message-button").first(),
      ).toBeEnabled({ timeout: 30_000 });
      return { dialog, editor };
    }

    async function openNewSession(testPage: any, touch: boolean) {
      if (touch) {
        await testPage.getByTestId("mobile-sessions-pill").tap();
        await testPage.getByTestId("mobile-launch-session").tap();
      } else {
        await testPage.getByTestId("dockview-add-panel-btn").first().click();
        await testPage.getByTestId("new-session-button").click();
      }
      const dialog = testPage
        .getByRole("dialog")
        .filter({ hasText: "New agent in" });
      await expect(dialog).toBeVisible();
      return dialog;
    }

    async function expectActionPathAndGeometry(
      button: any,
      surface: string,
      touch: boolean,
      expectedPluginSurface = surface,
    ) {
      await expect(button).toBeVisible();
      await expect(button).toHaveAttribute("type", "button");
      await expect(button).toHaveAttribute("aria-label", "Start dictation");
      const path = await button.getAttribute("data-slot");
      if (process.env.VOICE_EXPECT_ACTION_API === "action") {
        expect(path).toBe("surface-action");
        await expect(button).toHaveAttribute("data-surface", "composer");
      } else {
        expect(path).not.toBe("surface-action");
        await expect(button).toHaveClass(/kv-btn/);
      }

      const [box, iconBox, wrapper] = await Promise.all([
        button.boundingBox(),
        button.locator("svg").first().boundingBox(),
        button.evaluate((element: HTMLElement) =>
          element.closest(".kv-action")?.getAttribute("data-surface"),
        ),
      ]);
      if (process.env.VOICE_EXPECT_ACTION_API === "action") {
        expect(wrapper).toBe(expectedPluginSurface);
      } else {
        expect(wrapper).toBe(expectedPluginSurface);
      }
      expect(box).not.toBeNull();
      expect(iconBox).not.toBeNull();
      expect(iconBox!.width).toBeCloseTo(16, 0);
      expect(iconBox!.height).toBeCloseTo(16, 0);
      const expectedSize = touch
        ? process.env.VOICE_EXPECT_ACTION_API === "action"
          ? 44
          : 40
        : 28;
      expect(box!.width).toBeCloseTo(expectedSize, 0);
      expect(box!.height).toBeCloseTo(expectedSize, 0);
    }

    async function speechCount(testPage: any) {
      return testPage.evaluate(() => (window as any).__voiceE2E.speech.length);
    }

    async function finishSpeech(testPage: any, index: number, text: string) {
      await testPage.evaluate(
        ({ index, text }: { index: number; text: string }) => {
          const recognition = (window as any).__voiceE2E.speech[index];
          recognition?.emit(text);
          recognition?.finish();
        },
        { index, text },
      );
    }

    async function exerciseAction(
      testPage: any,
      button: any,
      editor: any,
      touch: boolean,
      surface: string,
    ) {
      await editor.fill("VOICE PREFIX ");
      const before = await speechCount(testPage);
      if (touch) {
        await button.tap();
      } else {
        await button.focus();
        await button.press("Space");
      }
      await expect(button).toHaveAttribute("data-state", "recording");
      const activeSpeech = before;
      expect(await speechCount(testPage)).toBe(before + 1);
      if (touch) {
        await button.tap();
      } else {
        await button.press("Space");
      }
      await finishSpeech(testPage, activeSpeech, `VOICE ${surface} RESULT`);
      await expect(button).toHaveAttribute("data-state", "idle");
      if (
        await editor.evaluate(
          (element: HTMLElement) => element.tagName === "TEXTAREA",
        )
      ) {
        await expect(editor).toHaveValue(
          /VOICE task-create RESULT|VOICE new-session RESULT/,
        );
      } else {
        await expect(editor).toContainText(`VOICE ${surface} RESULT`);
      }
    }

    test("uses one correctly sized action in task chat, Quick Chat, task creation, and new-session", async ({
      testPage,
      voiceMobilePage,
      apiClient,
      seedData,
    }: any, testInfo: any) => {
      testPage = selectProjectPage(testPage, voiceMobilePage, testInfo);
      test.setTimeout(180_000);
      const touch = testInfo.project.name === "mobile-chrome";
      await installVoice(testPage, apiClient);

      // Launch Quick Chat before opening a task so the host gives it an
      // independent quick-chat composer identity.
      await testPage.goto("/");
      const { dialog: quickDialog, editor: quickEditor } = await openQuickChat(
        testPage,
        touch,
      );
      const quickButton = quickDialog.getByTestId("voice-plugin-button");
      // Current Quick Chat sessions are task-backed; the host reports their
      // composer surface as task-chat while keeping the composer session ID
      // distinct for stale-result fencing.
      await expectActionPathAndGeometry(
        quickButton,
        "quick-chat",
        touch,
        "task-chat",
      );
      await exerciseAction(
        testPage,
        quickButton,
        quickEditor,
        touch,
        "quick-chat",
      );

      const { task, chat, editor } = await createTask(
        testPage,
        apiClient,
        seedData,
        `Voice host smoke ${testInfo.project.name}`,
      );
      const taskButton = chat.getByTestId("voice-plugin-button");
      await expectActionPathAndGeometry(taskButton, "task-chat", touch);
      await exerciseAction(testPage, taskButton, editor, touch, "task-chat");

      await testPage.goto("/");
      if (touch) {
        await testPage.getByTestId("mobile-fab").tap();
      } else {
        await testPage.getByTestId("create-task-button").first().click();
      }
      const createDialog = testPage.getByTestId("create-task-dialog");
      const description = createDialog.getByTestId("task-description-input");
      const createButton = createDialog.getByTestId("voice-plugin-button");
      await expect(description).toBeVisible();
      await expectActionPathAndGeometry(createButton, "task-create", touch);
      await exerciseAction(
        testPage,
        createButton,
        description,
        touch,
        "task-create",
      );
      await createDialog
        .getByRole("button", { name: "Cancel", exact: true })
        [touch ? "tap" : "click"]();
      await expect(createDialog).toBeHidden();

      await testPage.goto(`/t/${task.id}`);
      await testPage
        .locator('[data-testid="session-chat"]:visible')
        .first()
        .waitFor();
      const launchDialog = await openNewSession(testPage, touch);
      const newSessionDescription = launchDialog.getByTestId(
        "task-description-input",
      );
      const newSessionButton = launchDialog.getByTestId("voice-plugin-button");
      await expect(newSessionDescription).toBeVisible();
      await expectActionPathAndGeometry(newSessionButton, "new-session", touch);
      await exerciseAction(
        testPage,
        newSessionButton,
        newSessionDescription,
        touch,
        "new-session",
      );
    });

    test("delivers dictation into the task chat composer on the legacy host", async ({
      testPage,
      voiceMobilePage,
      apiClient,
      seedData,
    }: any, testInfo: any) => {
      testPage = selectProjectPage(testPage, voiceMobilePage, testInfo);
      const touch = testInfo.project.name === "mobile-chrome";
      await installVoice(testPage, apiClient);
      const { chat, editor } = await createTask(
        testPage,
        apiClient,
        seedData,
        "Voice legacy delivery",
      );
      const button = chat.getByTestId("voice-plugin-button");
      await expectActionPathAndGeometry(button, "task-chat", touch);
      await editor.fill("VOICE PREFIX ");
      const before = await speechCount(testPage);
      if (touch) await button.tap();
      else {
        await button.focus();
        await button.press("Space");
      }
      await expect(button).toHaveAttribute("data-state", "recording");
      if (touch) await button.tap();
      else await button.press("Space");
      await finishSpeech(testPage, before, "VOICE TASK CHAT RESULT");
      await expect(editor).toContainText("VOICE TASK CHAT RESULT");
    });

    test("uses real pointer capture for hold-to-talk and stops on release, cancel, and lost capture", async ({
      testPage,
      voiceMobilePage,
      apiClient,
      seedData,
    }: any, testInfo: any) => {
      testPage = selectProjectPage(testPage, voiceMobilePage, testInfo);
      test.skip(
        testInfo.project.name === "mobile-chrome",
        "phones use the touch toggle fallback",
      );
      await installVoice(testPage, apiClient, {
        ...webSpeechSettings,
        mode: "hold",
      });
      const { chat } = await createTask(
        testPage,
        apiClient,
        seedData,
        "Voice pointer capture",
      );
      const button = chat.getByTestId("voice-plugin-button");
      await expectActionPathAndGeometry(button, "task-chat", false);
      await button.evaluate((element: HTMLElement) => {
        element.addEventListener(
          "pointerdown",
          (event) =>
            ((window as any).__voiceE2E.lastPointerId = event.pointerId),
          { capture: true },
        );
      });
      const box = await button.boundingBox();
      if (!box) throw new Error("Voice action has no hit target");
      const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

      await testPage.mouse.move(center.x, center.y);
      await testPage.mouse.down();
      await expect(button).toHaveAttribute("data-state", "recording");
      const pointerHeld = await button.evaluate((element: HTMLElement) => {
        const pointerId = (window as any).__voiceE2E.lastPointerId;
        return element.hasPointerCapture(pointerId);
      });
      expect(pointerHeld).toBe(true);
      let index = (await speechCount(testPage)) - 1;
      await testPage.mouse.up();
      await finishSpeech(testPage, index, "VOICE POINTER RELEASE");
      await expect(button).toHaveAttribute("data-state", "idle");

      await testPage.mouse.move(center.x, center.y);
      await testPage.mouse.down();
      await expect(button).toHaveAttribute("data-state", "recording");
      index = (await speechCount(testPage)) - 1;
      await button.evaluate((element: HTMLElement) => {
        const pointerId = (window as any).__voiceE2E.lastPointerId;
        element.dispatchEvent(
          new PointerEvent("pointercancel", { bubbles: true, pointerId }),
        );
      });
      await finishSpeech(testPage, index, "");
      await expect(button).toHaveAttribute("data-state", "idle");
      await testPage.mouse.up();

      await testPage.mouse.move(center.x, center.y);
      await testPage.mouse.down();
      await expect(button).toHaveAttribute("data-state", "recording");
      index = (await speechCount(testPage)) - 1;
      await button.evaluate((element: HTMLElement) => {
        const pointerId = (window as any).__voiceE2E.lastPointerId;
        element.releasePointerCapture(pointerId);
      });
      await finishSpeech(testPage, index, "");
      await expect(button).toHaveAttribute("data-state", "idle");
      await testPage.mouse.up();
    });

    test("routes the dictation shortcut to the focused composer and delivers only there", async ({
      testPage,
      voiceMobilePage,
      apiClient,
      seedData,
    }: any, testInfo: any) => {
      testPage = selectProjectPage(testPage, voiceMobilePage, testInfo);
      test.skip(
        testInfo.project.name === "mobile-chrome",
        "mobile coverage uses touch activation",
      );
      await installVoice(testPage, apiClient);
      const { chat, editor: taskEditor } = await createTask(
        testPage,
        apiClient,
        seedData,
        "Voice focus target",
      );
      const taskButton = chat.getByTestId("voice-plugin-button");
      const { dialog, editor: quickEditor } = await openQuickChat(
        testPage,
        false,
      );
      const quickButton = dialog.getByTestId("voice-plugin-button");

      await taskEditor.fill("TASK DRAFT");
      await quickEditor.fill("QUICK CHAT DRAFT");
      const before = await speechCount(testPage);
      await quickEditor.focus();
      await testPage.keyboard.press("Control+Shift+m");
      await expect(quickButton).toHaveAttribute("data-state", "recording");
      await expect(taskButton).toHaveAttribute("data-state", "idle");
      await testPage.keyboard.press("Control+Shift+m");
      await finishSpeech(testPage, before, "QUICK CHAT ONLY");

      await expect(quickEditor).toContainText("QUICK CHAT ONLY");
      await expect(taskEditor).not.toContainText("QUICK CHAT ONLY");
    });

    test("reports permission and model-download busy states without label-driven overflow", async ({
      testPage,
      voiceMobilePage,
      apiClient,
      seedData,
    }: any, testInfo: any) => {
      testPage = selectProjectPage(testPage, voiceMobilePage, testInfo);
      test.setTimeout(120_000);
      const touch = testInfo.project.name === "mobile-chrome";
      await installVoice(testPage, apiClient, whisperSettings);
      const { chat, editor } = await createTask(
        testPage,
        apiClient,
        seedData,
        "Voice model loading",
      );
      const button = chat.getByTestId("voice-plugin-button");
      await expectActionPathAndGeometry(button, "task-chat", touch);
      await testPage.evaluate(() => {
        const state = (window as any).__voiceE2E;
        state.mediaDeferred = true;
        state.holdWhisperReady = true;
      });

      if (touch) await button.tap();
      else await button.press("Enter");
      await expect(button).toHaveAttribute("data-state", "requesting");
      await expect(button).toHaveAccessibleName(
        "Requesting microphone permission",
      );
      await expect(button).toBeDisabled();
      const permissionBox = await button.boundingBox();
      expect(permissionBox).not.toBeNull();
      const expectedSize = touch
        ? process.env.VOICE_EXPECT_ACTION_API === "action"
          ? 44
          : 40
        : 28;
      expect(permissionBox!.width).toBeCloseTo(expectedSize, 0);

      await testPage.evaluate(() => (window as any).__voiceE2E.resolveMedia());
      await expect(button).toHaveAttribute("data-state", "recording");
      if (touch) await button.tap();
      else await button.press("Enter");

      const download = testPage.getByTestId("voice-plugin-model-load");
      await expect(download).toBeVisible({ timeout: 15_000 });
      await expect(download).toContainText("42%");
      await expect(button).toHaveAccessibleName("Transcribing dictation");
      await expect(button).toBeDisabled();
      const downloadingBox = await button.boundingBox();
      expect(downloadingBox).not.toBeNull();
      expect(downloadingBox!.width).toBeCloseTo(permissionBox!.width, 0);
      if (process.env.VOICE_EXPECT_ACTION_API === "action") {
        await expect(button).toHaveAttribute("aria-busy", "true");
      }

      await testPage.evaluate(() =>
        (window as any).__voiceE2E.releaseWhisper(),
      );
      await expect(button).toHaveAttribute("data-state", "idle", {
        timeout: 30_000,
      });
      await expect(editor).toContainText("FAKE WHISPER RESULT", {
        timeout: 30_000,
      });
      await expect(download).toBeHidden();
    });

    test("cancels a pending microphone request when its composer unmounts", async ({
      testPage,
      voiceMobilePage,
      apiClient,
      seedData,
    }: any, testInfo: any) => {
      testPage = selectProjectPage(testPage, voiceMobilePage, testInfo);
      const touch = testInfo.project.name === "mobile-chrome";
      await installVoice(testPage, apiClient, whisperSettings);
      const { task } = await createTask(
        testPage,
        apiClient,
        seedData,
        "Voice async unmount",
      );
      const dialog = await openNewSession(testPage, touch);
      const button = dialog.getByTestId("voice-plugin-button");
      await testPage.evaluate(() => {
        (window as any).__voiceE2E.mediaDeferred = true;
      });

      if (touch) await button.tap();
      else await button.press("Enter");
      await expect(button).toHaveAttribute("data-state", "requesting");
      await dialog
        .getByRole("button", { name: "Cancel" })
        [touch ? "tap" : "click"]();
      await expect(dialog).toBeHidden();
      await testPage.evaluate(() => (window as any).__voiceE2E.resolveMedia());
      await expect
        .poll(() =>
          testPage.evaluate(() => (window as any).__voiceE2E.trackStops),
        )
        .toBe(1);
      expect(
        await testPage.evaluate(
          () => (window as any).__voiceE2E.recorderStarts,
        ),
      ).toBe(0);
      await expect(testPage.getByTestId("voice-plugin-button")).toHaveCount(1);
      await expect(testPage).toHaveURL(new RegExp(`/t/${task.id}`));
    });

    test("cancels and re-enables the chat action around a submitted native turn", async ({
      testPage,
      voiceMobilePage,
      apiClient,
      seedData,
    }: any, testInfo: any) => {
      testPage = selectProjectPage(testPage, voiceMobilePage, testInfo);
      test.setTimeout(150_000);
      const touch = testInfo.project.name === "mobile-chrome";
      await installVoice(testPage, apiClient);
      const { chat, editor } = await createTask(
        testPage,
        apiClient,
        seedData,
        "Voice disable re-enable",
      );
      const button = chat.getByTestId("voice-plugin-button");
      const before = await speechCount(testPage);
      if (touch) await button.tap();
      else await button.press("Enter");
      await expect(button).toHaveAttribute("data-state", "recording");
      await editor.fill(
        [
          'e2e:thinking("Voice composer disabled-state fixture")',
          "e2e:delay(8000)",
          'e2e:message("Voice composer re-enabled")',
        ].join("\n"),
      );
      const submit = chat.getByTestId("submit-message-button").first();
      await expect(submit).toBeEnabled({ timeout: 30_000 });
      if (touch) await submit.tap();
      else await submit.click();

      await expect(button).toHaveAttribute("data-state", "idle");
      await expect(button).toBeDisabled({ timeout: 30_000 });
      await finishSpeech(testPage, before, "STALE VOICE RESULT");
      await expect(editor).not.toContainText("STALE VOICE RESULT");
      await expect(button).toBeEnabled({ timeout: 60_000 });
      await expect(button).toHaveAccessibleName("Start dictation");
    });
  });
}

export { registerVoiceActionTests };
