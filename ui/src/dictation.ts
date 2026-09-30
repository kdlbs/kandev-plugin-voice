/**
 * The dictation state machine, deliberately free of React so it can be tested
 * against fake engines and driven by both the composer button and the
 * keyboard shortcut.
 *
 * One controller instance belongs to one mounted composer action. It owns at
 * most one recognition run at a time and guarantees that cancelling releases
 * the microphone and drops any transcript still in flight.
 */
import {
  collectFinalTranscripts,
  createSpeechRecognition,
  type SpeechRecognitionInstance,
} from "./engines/web-speech";
import {
  startCapture,
  stopCapture,
  teardownCapture,
  type CaptureHandle,
} from "./engines/recorder";
import { transcribeViaServer } from "./engines/server-relay";
import { WhisperWebClient } from "./engines/whisper-web";
import {
  mapMicError,
  mapSpeechError,
  mapTranscribeError,
  mapWhisperError,
  type VoiceError,
} from "./errors";
import type { ResolvedEngine } from "./capabilities";
import type { WhisperWebModelSize } from "./settings";
import { t } from "./strings";

export type DictationState = "idle" | "requesting" | "recording" | "processing";

export type ModelLoadState = {
  state: "idle" | "loading" | "ready" | "error";
  progress: number;
};

export type DictationSnapshot = {
  state: DictationState;
  error: VoiceError | null;
  modelLoad: ModelLoadState;
};

export type DictationOptions = {
  /** Reads the settings that matter at the moment a run starts. */
  readConfig(): {
    engine: ResolvedEngine | null;
    language: string;
    whisperWebModel: WhisperWebModelSize;
  };
  onTranscript(text: string): void;
  onError?(error: VoiceError): void;
  /** Injected in tests; production uses the real worker-backed client. */
  createWhisperClient?(
    onProgress: (progress: number) => void,
  ): WhisperWebClient;
};

type Driver =
  | { kind: "webSpeech"; recognition: SpeechRecognitionInstance }
  | {
      kind: "capture";
      handle: CaptureHandle;
      engine: "whisperWeb" | "whisperServer";
    };

const IDLE_MODEL_LOAD: ModelLoadState = { state: "idle", progress: 0 };

export class DictationController {
  private snapshot: DictationSnapshot = {
    state: "idle",
    error: null,
    modelLoad: IDLE_MODEL_LOAD,
  };
  private listeners = new Set<() => void>();
  private driver: Driver | null = null;
  /**
   * Lifetime of one dictation run, which outlives its driver: `finishCapture`
   * releases the microphone and clears `driver` while transcription is still
   * in flight. Cancelling in that window is the common case (the user
   * switches task or session mid-upload), so the abort signal has to be
   * reachable from somewhere the driver no longer occupies.
   */
  private run: AbortController | null = null;
  private whisper: WhisperWebClient | null = null;
  private whisperModel: WhisperWebModelSize | null = null;
  private disposed = false;

  constructor(private options: DictationOptions) {}

  getSnapshot(): DictationSnapshot {
    return this.snapshot;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Starts a run. A no-op unless currently idle, so a double tap cannot stack runs. */
  async start(): Promise<void> {
    if (this.disposed || this.snapshot.state !== "idle") return;
    const { engine, language } = this.options.readConfig();
    if (!engine) {
      this.fail({ code: "unsupported", message: t("unavailableBrowser") });
      return;
    }
    this.patch({ error: null });
    this.run = new AbortController();
    if (engine === "webSpeech") {
      this.runWebSpeech(resolveSpeechLang(language));
      return;
    }
    await this.beginCapture(engine);
  }

  /** Ends a run and delivers its transcript. Safe to call when nothing is running. */
  async stop(): Promise<void> {
    const driver = this.driver;
    if (!driver) return;
    if (driver.kind === "webSpeech") {
      driver.recognition.stop();
      return;
    }
    await this.finishCapture(driver);
  }

  /**
   * Abandons a run: releases the microphone, aborts an in-flight upload and
   * drops any transcript that arrives afterwards. This is what a task or
   * session switch calls, so a recording started on one conversation can
   * never land in another.
   */
  cancel(): void {
    this.abortRun();
    this.patch({ state: "idle", error: null });
  }

  /** Cancels, then releases the Whisper model. Call on unmount. */
  dispose(): void {
    this.disposed = true;
    this.abortRun();
    this.whisper?.dispose();
    this.whisper = null;
    this.whisperModel = null;
    this.listeners.clear();
  }

  /** Drops a loaded model after the user picks a different size. */
  releaseWhisperModel(): void {
    this.whisper?.dispose();
    this.whisper = null;
    this.whisperModel = null;
    this.patch({ modelLoad: IDLE_MODEL_LOAD });
  }

  // ── internals ────────────────────────────────────────────────────────

  private patch(next: Partial<DictationSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...next };
    for (const listener of [...this.listeners]) listener();
  }

  private fail(error: VoiceError): void {
    this.patch({ state: "idle", error });
    this.options.onError?.(error);
  }

  private deliver(text: string): void {
    const trimmed = text.trim();
    if (trimmed) this.options.onTranscript(trimmed);
  }

  /**
   * Abandons the whole run: the driver if one is still recording, and the
   * run-scoped abort signal, which is the only handle left once transcription
   * has started.
   */
  private abortRun(): void {
    const driver = this.driver;
    this.driver = null;
    this.run?.abort();
    this.run = null;
    if (!driver) return;
    if (driver.kind === "webSpeech") {
      // Detach first: some browsers fire a trailing onerror/onend after
      // abort(), which would otherwise resurrect state we just reset.
      driver.recognition.onresult = null;
      driver.recognition.onerror = null;
      driver.recognition.onend = null;
      driver.recognition.abort();
      return;
    }
    teardownCapture(driver.handle);
  }

  private runWebSpeech(lang: string): void {
    const recognition = createSpeechRecognition();
    if (!recognition) {
      this.fail({ code: "unsupported", message: t("unavailableBrowser") });
      return;
    }
    const transcripts: string[] = [];
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.lang = lang;
    recognition.onresult = (event) =>
      collectFinalTranscripts(event, transcripts);
    recognition.onerror = (event) => this.fail(mapSpeechError(event.error));
    recognition.onend = () => {
      this.driver = null;
      this.run = null;
      this.patch({ state: "idle" });
      this.deliver(transcripts.join(" "));
    };
    try {
      recognition.start();
      this.driver = { kind: "webSpeech", recognition };
      this.patch({ state: "recording" });
    } catch {
      this.fail({ code: "unknown", message: t("errRecordingStart") });
    }
  }

  private async beginCapture(
    engine: "whisperWeb" | "whisperServer",
  ): Promise<void> {
    this.patch({ state: "requesting" });
    const signal = this.run?.signal;
    try {
      const handle = await startCapture(signal);
      if (!handle) return;
      // A cancel that landed while getUserMedia was pending must win, or the
      // microphone stays hot with nothing owning it.
      if (
        this.disposed ||
        signal?.aborted ||
        this.snapshot.state !== "requesting"
      ) {
        teardownCapture(handle);
        return;
      }
      this.driver = { kind: "capture", handle, engine };
      this.patch({ state: "recording" });
    } catch (err) {
      if (
        this.disposed ||
        signal?.aborted ||
        this.snapshot.state !== "requesting"
      )
        return;
      this.fail(mapMicError(err));
    }
  }

  private async finishCapture(
    driver: Extract<Driver, { kind: "capture" }>,
  ): Promise<void> {
    // Claim the driver before the first await. In hold mode pointerup and
    // pointercancel can both fire in one task; without this the second call
    // would race the first and could clobber a brand-new run.
    this.driver = null;
    // Hold the run locally too: `cancel` replaces this.run with null, and a
    // late result must be judged against the signal of the run it came from.
    const signal = this.run?.signal ?? AbortSignal.abort();
    this.patch({ state: "processing" });
    const blob = await stopCapture(driver.handle);
    if (signal.aborted) return;
    if (!blob) {
      this.run = null;
      this.patch({ state: "idle" });
      return;
    }
    try {
      const text =
        driver.engine === "whisperServer"
          ? await transcribeViaServer(
              blob,
              `recording.${driver.handle.ext}`,
              signal,
            )
          : await this.transcribeLocally(blob, signal);
      if (signal.aborted) return;
      this.run = null;
      this.patch({ state: "idle" });
      this.deliver(text);
    } catch (err) {
      if (signal.aborted) return;
      this.run = null;
      this.fail(
        driver.engine === "whisperServer"
          ? mapTranscribeError(err)
          : mapWhisperError(err),
      );
    }
  }

  private async transcribeLocally(
    blob: Blob,
    signal: AbortSignal,
  ): Promise<string> {
    const { language, whisperWebModel } = this.options.readConfig();
    const client = await this.ensureWhisperClient(whisperWebModel);
    if (signal.aborted) return "";
    return client.transcribe(blob, resolveWhisperLang(language));
  }

  private async ensureWhisperClient(
    model: WhisperWebModelSize,
  ): Promise<WhisperWebClient> {
    if (this.whisper && this.whisperModel !== model) this.releaseWhisperModel();
    if (!this.whisper) {
      const create =
        this.options.createWhisperClient ??
        ((onProgress) =>
          new WhisperWebClient({ onProgress: (p) => onProgress(p.progress) }));
      // transformers.js reports 0-100; the rest of this plugin treats
      // modelLoad.progress as a 0-1 fraction, matching `ready: 1` below.
      this.whisper = create((progress) =>
        this.patch({
          modelLoad: { state: "loading", progress: progress / 100 },
        }),
      );
      this.patch({ modelLoad: { state: "loading", progress: 0 } });
    }
    try {
      await this.whisper.init(model);
      this.whisperModel = model;
      this.patch({ modelLoad: { state: "ready", progress: 1 } });
    } catch (err) {
      this.patch({ modelLoad: { state: "error", progress: 0 } });
      throw err;
    }
    return this.whisper;
  }
}

/** Web Speech takes a BCP-47 tag; "auto" means follow the browser. */
export function resolveSpeechLang(preference: string): string {
  if (preference && preference !== "auto") return preference;
  return typeof navigator !== "undefined" ? navigator.language : "en-US";
}

/**
 * Whisper's tokenizer only knows ISO 639-1 two-letter codes ("en", "pt"), but
 * settings store BCP-47 ("en-US", "pt-BR") so the UI can name the variant.
 * Strip the region, or the hint is silently dropped and the model
 * auto-detects, sometimes into the wrong dialect.
 */
export function resolveWhisperLang(preference: string): string | undefined {
  if (!preference || preference === "auto") return undefined;
  const dash = preference.indexOf("-");
  return dash > 0
    ? preference.slice(0, dash).toLowerCase()
    : preference.toLowerCase();
}
