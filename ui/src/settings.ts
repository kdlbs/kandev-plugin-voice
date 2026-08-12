/**
 * Per-user Voice Mode preferences.
 *
 * These lived in kandev's `userSettings.voiceMode` while Voice Mode was a
 * core feature. They now live in the plugin's own per-user storage
 * (`host.storage`, scope "instance"), which is authenticated and scoped to
 * the calling user exactly the same way, so two people on one install still
 * keep separate engines and languages.
 *
 * A single module-level cache backs every surface (each composer action, the
 * settings page, the keybinding handler) so they cannot disagree, and a
 * `host.storage.subscribe` feed keeps a second tab in step.
 */
import { host, maybeHost, type PluginStorageEntry } from "./host";

export const SETTINGS_KEY = "voice-mode";
const SETTINGS_SCOPE = "instance" as const;
// The instance scope still needs a path segment: kandev validates :scopeId
// against ^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$, so an empty string is a 400.
export const SETTINGS_SCOPE_ID = "global";

export type VoiceEngine = "auto" | "webSpeech" | "whisperWeb" | "whisperServer";
export type VoiceActivationMode = "hold" | "toggle";
export type WhisperWebModelSize = "tiny" | "base" | "small";

export type VoiceSettings = {
  enabled: boolean;
  engine: VoiceEngine;
  /** BCP-47 tag, or "auto" to follow the browser locale. */
  language: string;
  mode: VoiceActivationMode;
  autoSend: boolean;
  whisperWebModel: WhisperWebModelSize;
};

export const DEFAULT_SETTINGS: VoiceSettings = {
  enabled: true,
  engine: "auto",
  language: "auto",
  mode: "toggle",
  autoSend: false,
  whisperWebModel: "base",
};

const ENGINES: VoiceEngine[] = ["auto", "webSpeech", "whisperWeb", "whisperServer"];
const MODES: VoiceActivationMode[] = ["hold", "toggle"];
const MODEL_SIZES: WhisperWebModelSize[] = ["tiny", "base", "small"];

function pick<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : fallback;
}

/**
 * Normalizes whatever is in storage into a complete VoiceSettings. Storage is
 * schemaless JSON that an older or newer plugin version may have written, so
 * every field is validated rather than trusted.
 */
export function normalizeSettings(raw: unknown): VoiceSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SETTINGS };
  const value = raw as Partial<Record<keyof VoiceSettings, unknown>>;
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULT_SETTINGS.enabled,
    engine: pick(value.engine, ENGINES, DEFAULT_SETTINGS.engine),
    language:
      typeof value.language === "string" && value.language.trim() !== ""
        ? value.language
        : DEFAULT_SETTINGS.language,
    mode: pick(value.mode, MODES, DEFAULT_SETTINGS.mode),
    autoSend: typeof value.autoSend === "boolean" ? value.autoSend : DEFAULT_SETTINGS.autoSend,
    whisperWebModel: pick(value.whisperWebModel, MODEL_SIZES, DEFAULT_SETTINGS.whisperWebModel),
  };
}

type Listener = () => void;

let cached: VoiceSettings = { ...DEFAULT_SETTINGS };
let loaded = false;
let loading: Promise<VoiceSettings> | null = null;
let unsubscribeRemote: (() => void) | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

function apply(next: VoiceSettings): void {
  cached = next;
  loaded = true;
  emit();
}

/** Current value. Returns defaults until the first load resolves. */
export function getSettings(): VoiceSettings {
  return cached;
}

export function isLoaded(): boolean {
  return loaded;
}

export function subscribeSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Loads once per bundle lifetime; concurrent callers share the same request. */
export function loadSettings(): Promise<VoiceSettings> {
  if (loaded) return Promise.resolve(cached);
  if (loading) return loading;
  loading = host()
    .storage.get(SETTINGS_SCOPE, SETTINGS_SCOPE_ID, SETTINGS_KEY)
    .then((entry: PluginStorageEntry | undefined) => {
      apply(normalizeSettings(entry?.value));
      return cached;
    })
    .catch((error: unknown) => {
      // A storage read failure must not disable dictation: fall back to
      // defaults and let the next save try again.
      console.warn("[kandev-plugin-voice] could not read saved settings:", error);
      apply({ ...DEFAULT_SETTINGS });
      return cached;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/**
 * Applies a partial change optimistically, then persists. A rejected write
 * rolls the cache back so the UI never claims a preference that did not save.
 */
export async function updateSettings(patch: Partial<VoiceSettings>): Promise<void> {
  const previous = cached;
  const next = normalizeSettings({ ...cached, ...patch });
  apply(next);
  try {
    await host().storage.set(SETTINGS_SCOPE, SETTINGS_SCOPE_ID, SETTINGS_KEY, next);
  } catch (error) {
    apply(previous);
    throw error;
  }
}

/** Mirrors writes made from another tab or device into this bundle's cache. */
export function startSettingsSync(): void {
  if (unsubscribeRemote) return;
  unsubscribeRemote = host().storage.subscribe(
    { scope: SETTINGS_SCOPE, scopeId: SETTINGS_SCOPE_ID, key: SETTINGS_KEY },
    (change) => {
      if (change.deleted) {
        apply({ ...DEFAULT_SETTINGS });
        return;
      }
      apply(normalizeSettings(change.value));
    },
  );
}

/** Full teardown, so `destroy` followed by `initialize` starts clean. */
export function resetSettingsStore(): void {
  unsubscribeRemote?.();
  unsubscribeRemote = null;
  listeners.clear();
  cached = { ...DEFAULT_SETTINGS };
  loaded = false;
  loading = null;
  maybeHost();
}
