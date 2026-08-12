import { beforeEach, describe, expect, it } from "vitest";
import { installFakeHost, type FakeHost } from "./test-host";
import {
  DEFAULT_SETTINGS,
  getSettings,
  loadSettings,
  normalizeSettings,
  resetSettingsStore,
  SETTINGS_KEY,
  SETTINGS_SCOPE_ID,
  startSettingsSync,
  subscribeSettings,
  updateSettings,
} from "./settings";

let host: FakeHost;

beforeEach(() => {
  resetSettingsStore();
  host = installFakeHost();
});

describe("normalizeSettings", () => {
  it("returns the defaults for anything that is not an object", () => {
    for (const input of [undefined, null, 42, "engine", []]) {
      expect(normalizeSettings(input)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it("keeps recognised values and replaces the rest", () => {
    expect(
      normalizeSettings({
        enabled: false,
        engine: "whisperWeb",
        language: "pt-PT",
        mode: "hold",
        autoSend: true,
        whisperWebModel: "small",
      }),
    ).toEqual({
      enabled: false,
      engine: "whisperWeb",
      language: "pt-PT",
      mode: "hold",
      autoSend: true,
      whisperWebModel: "small",
    });
  });

  it("rejects a value an older or malicious writer could have left behind", () => {
    const result = normalizeSettings({
      engine: "sendEverythingToMyServer",
      mode: "record-forever",
      whisperWebModel: "gigantic",
      language: "   ",
      enabled: "yes",
      autoSend: 1,
    });
    expect(result).toEqual(DEFAULT_SETTINGS);
  });
});

describe("loadSettings", () => {
  it("falls back to defaults when nothing has been saved", async () => {
    await expect(loadSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it("reads a saved value once and shares it with concurrent callers", async () => {
    host.storage.values.set(`instance/${SETTINGS_SCOPE_ID}/${SETTINGS_KEY}`, { engine: "whisperWeb" });

    const [a, b] = await Promise.all([loadSettings(), loadSettings()]);

    expect(a.engine).toBe("whisperWeb");
    expect(b).toEqual(a);
    expect(host.storage.get).toHaveBeenCalledTimes(1);
  });

  it("keeps dictation working when storage is unreadable", async () => {
    host.storage.get.mockRejectedValueOnce(new Error("offline"));

    await expect(loadSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });
});

describe("updateSettings", () => {
  it("applies optimistically, persists, and notifies subscribers", async () => {
    const seen: boolean[] = [];
    subscribeSettings(() => seen.push(getSettings().autoSend));

    await updateSettings({ autoSend: true });

    expect(getSettings().autoSend).toBe(true);
    expect(seen).toContain(true);
    expect(host.storage.values.get(`instance/${SETTINGS_SCOPE_ID}/${SETTINGS_KEY}`)).toMatchObject({ autoSend: true });
  });

  it("rolls the cache back when the write fails, so the UI never shows an unsaved value", async () => {
    host.storage.set.mockRejectedValueOnce(new Error("conflict"));

    await expect(updateSettings({ engine: "whisperServer" })).rejects.toThrow("conflict");
    expect(getSettings().engine).toBe(DEFAULT_SETTINGS.engine);
  });

  it("refuses to persist an out-of-range value", async () => {
    await updateSettings({ engine: "nonsense" as never });

    expect(getSettings().engine).toBe(DEFAULT_SETTINGS.engine);
  });
});

describe("startSettingsSync", () => {
  it("adopts a write made in another tab", async () => {
    await loadSettings();
    startSettingsSync();

    host.storage.emit({ key: SETTINGS_KEY, value: { language: "de-DE" } });

    expect(getSettings().language).toBe("de-DE");
  });

  it("returns to defaults when the entry is deleted elsewhere", async () => {
    await updateSettings({ language: "de-DE" });
    startSettingsSync();

    host.storage.emit({ key: SETTINGS_KEY, deleted: true });

    expect(getSettings().language).toBe(DEFAULT_SETTINGS.language);
  });

  it("subscribes only once even if initialize runs again", () => {
    startSettingsSync();
    startSettingsSync();

    expect(host.storage.subscribe).toHaveBeenCalledTimes(1);
  });
});

describe("resetSettingsStore", () => {
  it("drops the cache and the remote subscription so a re-enable starts clean", async () => {
    await updateSettings({ language: "de-DE" });
    startSettingsSync();

    resetSettingsStore();

    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
    // A change delivered after teardown must not resurrect the old cache.
    host.storage.emit({ key: SETTINGS_KEY, value: { language: "fr-FR" } });
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
