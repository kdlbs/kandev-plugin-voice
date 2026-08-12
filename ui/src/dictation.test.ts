import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeHost, type FakeHost } from "./test-host";
import {
  DictationController,
  resolveSpeechLang,
  resolveWhisperLang,
  type DictationOptions,
} from "./dictation";
import type { WhisperWebClient } from "./engines/whisper-web";

let host: FakeHost;

// ── Fakes for the browser APIs the controller drives ───────────────────

type FakeRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: ReturnType<typeof vi.fn>;
  onresult: ((ev: unknown) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
};

let lastRecognition: FakeRecognition | null = null;
let recognitionStartThrows = false;

function installSpeechRecognition() {
  lastRecognition = null;
  recognitionStartThrows = false;
  vi.stubGlobal(
    "SpeechRecognition",
    function SpeechRecognitionCtor(this: FakeRecognition) {
      const instance = this;
      instance.start = () => {
        if (recognitionStartThrows) throw new Error("busy");
      };
      instance.stop = () => instance.onend?.();
      instance.abort = vi.fn();
      instance.onresult = null;
      instance.onerror = null;
      instance.onend = null;
      lastRecognition = instance;
    },
  );
}

function speechResults(...phrases: string[]) {
  return {
    resultIndex: 0,
    results: Object.assign(
      phrases.map((phrase) => ({ isFinal: true, 0: { transcript: phrase }, length: 1 })),
      { length: phrases.length },
    ),
  };
}

type FakeRecorder = {
  state: string;
  mimeType: string;
  start: () => void;
  stop: () => void;
  addEventListener: (type: string, handler: () => void, options?: unknown) => void;
};

let stoppedTracks = 0;
let recorderProducesData = true;

function installMediaRecorder() {
  stoppedTracks = 0;
  recorderProducesData = true;
  vi.stubGlobal(
    "MediaRecorder",
    Object.assign(
      function MediaRecorderCtor(this: FakeRecorder) {
        const instance = this;
        // Per-instance, like the real thing: a shared listener map would let
        // one recording's handlers fire for the next one's stop.
        const listeners = new Map<string, Array<(event?: unknown) => void>>();
        instance.state = "recording";
        instance.mimeType = "audio/webm";
        instance.start = () => {};
        instance.addEventListener = (type, handler) => {
          const bucket = listeners.get(type) ?? [];
          bucket.push(handler as (event?: unknown) => void);
          listeners.set(type, bucket);
        };
        instance.stop = () => {
          instance.state = "inactive";
          if (recorderProducesData) {
            for (const handler of listeners.get("dataavailable") ?? []) {
              handler({ data: new Blob(["audio"], { type: "audio/webm" }) });
            }
          }
          for (const handler of listeners.get("stop") ?? []) handler();
        };
      },
      { isTypeSupported: () => true },
    ),
  );
  vi.stubGlobal("navigator", {
    language: "en-GB",
    mediaDevices: {
      getUserMedia: async () => ({
        getTracks: () => [{ stop: () => stoppedTracks++ }],
      }),
    },
  });
}

function controllerFor(overrides: Partial<DictationOptions> = {}) {
  const transcripts: string[] = [];
  const errors: string[] = [];
  const controller = new DictationController({
    readConfig: () => ({ engine: "webSpeech", language: "auto", whisperWebModel: "base" }),
    onTranscript: (text) => transcripts.push(text),
    onError: (error) => errors.push(error.code),
    ...overrides,
  });
  return { controller, transcripts, errors };
}

beforeEach(() => {
  host = installFakeHost();
  installSpeechRecognition();
  installMediaRecorder();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Language resolution ────────────────────────────────────────────────

describe("language resolution", () => {
  it("follows the browser for auto and the preference otherwise", () => {
    expect(resolveSpeechLang("auto")).toBe("en-GB");
    expect(resolveSpeechLang("")).toBe("en-GB");
    expect(resolveSpeechLang("pt-BR")).toBe("pt-BR");
  });

  it("strips the region for Whisper, whose tokenizer only knows ISO 639-1", () => {
    expect(resolveWhisperLang("pt-BR")).toBe("pt");
    expect(resolveWhisperLang("EN")).toBe("en");
    expect(resolveWhisperLang("auto")).toBeUndefined();
    expect(resolveWhisperLang("")).toBeUndefined();
  });
});

// ── Web Speech ─────────────────────────────────────────────────────────

describe("web speech engine", () => {
  it("records, then delivers the joined final transcript", async () => {
    const { controller, transcripts } = controllerFor();

    await controller.start();
    expect(controller.getSnapshot().state).toBe("recording");
    lastRecognition?.onresult?.(speechResults(" ship it ", "today"));
    await controller.stop();

    expect(transcripts).toEqual(["ship it today"]);
    expect(controller.getSnapshot().state).toBe("idle");
  });

  it("delivers nothing when the user said nothing", async () => {
    const { controller, transcripts } = controllerFor();

    await controller.start();
    await controller.stop();

    expect(transcripts).toEqual([]);
  });

  it("ignores a second start while already recording", async () => {
    const { controller } = controllerFor();

    await controller.start();
    const first = lastRecognition;
    await controller.start();

    expect(lastRecognition).toBe(first);
  });

  it("maps a denied microphone to a permission error", async () => {
    const { controller, errors } = controllerFor();

    await controller.start();
    lastRecognition?.onerror?.({ error: "not-allowed" });

    expect(errors).toEqual(["permission-denied"]);
    expect(controller.getSnapshot().state).toBe("idle");
  });

  it("reports a failed start instead of pretending to record", async () => {
    recognitionStartThrows = true;
    const { controller, errors } = controllerFor();

    await controller.start();

    expect(errors).toEqual(["unknown"]);
    expect(controller.getSnapshot().state).toBe("idle");
  });

  it("cancel detaches the callbacks so a trailing event cannot deliver a transcript", async () => {
    const { controller, transcripts } = controllerFor();
    await controller.start();
    const recognition = lastRecognition;

    controller.cancel();

    expect(recognition?.abort).toHaveBeenCalled();
    expect(recognition?.onend).toBeNull();
    expect(recognition?.onresult).toBeNull();
    expect(transcripts).toEqual([]);
  });

  it("fails closed when no engine is available", async () => {
    const { controller, errors } = controllerFor({
      readConfig: () => ({ engine: null, language: "auto", whisperWebModel: "base" }),
    });

    await controller.start();

    expect(errors).toEqual(["unsupported"]);
  });
});

// ── Capture engines ────────────────────────────────────────────────────

function fakeWhisperClient(result: string | Error) {
  const client = {
    init: vi.fn(async () => {}),
    transcribe: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
    dispose: vi.fn(),
  };
  return client as unknown as WhisperWebClient & typeof client;
}

describe("in-browser whisper engine", () => {
  const config = () =>
    ({ engine: "whisperWeb", language: "pt-BR", whisperWebModel: "base" }) as const;

  it("records, transcribes locally, and releases the microphone", async () => {
    const client = fakeWhisperClient("  falar agora  ");
    const { controller, transcripts } = controllerFor({
      readConfig: config,
      createWhisperClient: () => client,
    });

    await controller.start();
    expect(controller.getSnapshot().state).toBe("recording");
    await controller.stop();

    expect(transcripts).toEqual(["falar agora"]);
    expect(client.transcribe).toHaveBeenCalledWith(expect.anything(), "pt");
    expect(stoppedTracks).toBe(1);
    expect(controller.getSnapshot().state).toBe("idle");
  });

  it("reports model-load failure through the error channel", async () => {
    const client = fakeWhisperClient(new Error("model download failed"));
    const { controller, errors } = controllerFor({
      readConfig: config,
      createWhisperClient: () => client,
    });

    await controller.start();
    await controller.stop();

    expect(errors).toEqual(["model-load"]);
  });

  it("publishes download progress as a 0-1 fraction", async () => {
    const reports: number[] = [];
    // transformers.js reports 0-100; a UI that renders it as a percentage of
    // 1 would show "4200%", so the controller has to divide.
    const client = {
      init: vi.fn(async () => {}),
      transcribe: vi.fn(async () => "ok"),
      dispose: vi.fn(),
    } as unknown as WhisperWebClient;
    const { controller } = controllerFor({
      readConfig: config,
      createWhisperClient: (onProgress) => {
        onProgress(42);
        return client;
      },
    });
    controller.subscribe(() => reports.push(controller.getSnapshot().modelLoad.progress));

    await controller.start();
    await controller.stop();

    expect(reports).toContain(0.42);
    expect(controller.getSnapshot().modelLoad).toEqual({ state: "ready", progress: 1 });
  });

  it("releases the loaded model when the user picks another size", async () => {
    const client = fakeWhisperClient("ok");
    const { controller } = controllerFor({
      readConfig: config,
      createWhisperClient: () => client,
    });
    await controller.start();
    await controller.stop();

    controller.releaseWhisperModel();

    expect(client.dispose).toHaveBeenCalled();
    expect(controller.getSnapshot().modelLoad).toEqual({ state: "idle", progress: 0 });
  });

  it("drops a transcript that arrives after the run was cancelled", async () => {
    let release: (value: string) => void = () => {};
    const client = {
      init: vi.fn(async () => {}),
      transcribe: vi.fn(() => new Promise<string>((resolve) => (release = resolve))),
      dispose: vi.fn(),
    } as unknown as WhisperWebClient;
    const { controller, transcripts, errors } = controllerFor({
      readConfig: config,
      createWhisperClient: () => client,
    });

    await controller.start();
    const stopping = controller.stop();
    controller.cancel();
    release("this belongs to the previous conversation");
    await stopping;

    expect(transcripts).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("releases the microphone if cancel lands while permission is still pending", async () => {
    let grant: (stream: unknown) => void = () => {};
    vi.stubGlobal("navigator", {
      language: "en-GB",
      mediaDevices: {
        getUserMedia: () => new Promise((resolve) => (grant = resolve)),
      },
    });
    const { controller } = controllerFor({ readConfig: config });

    const starting = controller.start();
    controller.cancel();
    grant({ getTracks: () => [{ stop: () => stoppedTracks++ }] });
    await starting;

    expect(stoppedTracks).toBe(1);
    expect(controller.getSnapshot().state).toBe("idle");
  });
});

describe("server relay engine", () => {
  const config = () =>
    ({ engine: "whisperServer", language: "auto", whisperWebModel: "base" }) as const;

  it("uploads to the authenticated webhook and inserts the transcript", async () => {
    host.fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ text: "  from the server  " }), { status: 200 }),
    );
    const { controller, transcripts } = controllerFor({ readConfig: config });

    await controller.start();
    await controller.stop();

    expect(transcripts).toEqual(["from the server"]);
    const [path, init] = host.fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("webhooks/transcribe");
    expect(init.method).toBe("POST");
    // The browser must own the multipart boundary, so no Content-Type here.
    expect(init.headers).toBeUndefined();
  });

  it("turns a 503 into the not-configured message rather than a generic failure", async () => {
    host.fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "voice transcription is not configured" }), {
        status: 503,
      }),
    );
    const { controller, errors } = controllerFor({ readConfig: config });

    await controller.start();
    await controller.stop();

    expect(errors).toEqual(["not-configured"]);
  });

  it("aborts an upload already in flight and drops its transcript", async () => {
    let observedSignal: AbortSignal | undefined;
    let uploadStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => (uploadStarted = resolve));
    host.fetchMock.mockImplementationOnce(
      (_path: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          observedSignal = init.signal ?? undefined;
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          uploadStarted();
        }),
    );
    const { controller, transcripts, errors } = controllerFor({ readConfig: config });

    await controller.start();
    const stopping = controller.stop();
    await started;
    // The user switches task or session while the audio is uploading.
    controller.cancel();
    await stopping;

    expect(observedSignal?.aborted).toBe(true);
    expect(transcripts).toEqual([]);
    // A cancelled run reports nothing: the user chose to abandon it.
    expect(errors).toEqual([]);
    expect(controller.getSnapshot().state).toBe("idle");
  });

  it("never starts the upload when the run was cancelled before it began", async () => {
    const { controller, transcripts } = controllerFor({ readConfig: config });

    await controller.start();
    const stopping = controller.stop();
    controller.cancel();
    await stopping;

    expect(host.fetchMock).not.toHaveBeenCalled();
    expect(transcripts).toEqual([]);
  });
});

describe("dispose", () => {
  it("cancels an active run and releases the model", async () => {
    const client = fakeWhisperClient("ok");
    const { controller } = controllerFor({
      readConfig: () => ({ engine: "whisperWeb", language: "auto", whisperWebModel: "base" }),
      createWhisperClient: () => client,
    });
    await controller.start();
    await controller.stop();

    controller.dispose();

    expect(client.dispose).toHaveBeenCalled();
    await controller.start();
    expect(controller.getSnapshot().state).toBe("idle");
  });
});
