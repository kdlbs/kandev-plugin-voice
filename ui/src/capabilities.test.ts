import { afterEach, describe, expect, it, vi } from "vitest";
import { detectVoiceCapabilities, resolveActiveEngine, type VoiceCapabilities } from "./capabilities";

const ALL: VoiceCapabilities = { webSpeech: true, whisperWeb: true, audioCapture: true };
const NONE: VoiceCapabilities = { webSpeech: false, whisperWeb: false, audioCapture: false };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("detectVoiceCapabilities", () => {
  it("reports nothing when the browser has neither recognizer nor recorder", () => {
    vi.stubGlobal("navigator", { mediaDevices: {} });
    vi.stubGlobal("MediaRecorder", undefined);

    expect(detectVoiceCapabilities()).toEqual(NONE);
  });

  it("treats MediaRecorder plus getUserMedia as the floor for the uploading engines", () => {
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => {} } });
    vi.stubGlobal("MediaRecorder", function MediaRecorder() {});
    // jsdom ships no Worker; the real browsers that have MediaRecorder do.
    vi.stubGlobal("Worker", function Worker() {});

    const caps = detectVoiceCapabilities();
    expect(caps.audioCapture).toBe(true);
    expect(caps.whisperWeb).toBe(true);
    expect(caps.webSpeech).toBe(false);
  });

  it("detects the vendor-prefixed SpeechRecognition", () => {
    vi.stubGlobal("webkitSpeechRecognition", function SpeechRecognition() {});
    vi.stubGlobal("navigator", { mediaDevices: {} });

    expect(detectVoiceCapabilities().webSpeech).toBe(true);
  });
});

describe("resolveActiveEngine", () => {
  it("prefers the cheapest usable engine on auto", () => {
    expect(resolveActiveEngine("auto", ALL, true)).toBe("webSpeech");
    expect(resolveActiveEngine("auto", { ...ALL, webSpeech: false }, true)).toBe("whisperWeb");
    expect(
      resolveActiveEngine("auto", { webSpeech: false, whisperWeb: false, audioCapture: true }, true),
    ).toBe("whisperServer");
  });

  it("honours a pinned engine that the browser can run", () => {
    expect(resolveActiveEngine("whisperWeb", ALL, true)).toBe("whisperWeb");
    expect(resolveActiveEngine("whisperServer", ALL, true)).toBe("whisperServer");
  });

  it("degrades instead of leaving a dead button when the pinned engine is unusable", () => {
    expect(resolveActiveEngine("webSpeech", { ...ALL, webSpeech: false }, true)).toBe("whisperWeb");
  });

  it("never selects the server relay when the operator saved no key", () => {
    const captureOnly: VoiceCapabilities = {
      webSpeech: false,
      whisperWeb: false,
      audioCapture: true,
    };
    expect(resolveActiveEngine("whisperServer", captureOnly, false)).toBeNull();
    expect(resolveActiveEngine("auto", captureOnly, false)).toBeNull();
  });

  it("returns null when nothing is usable", () => {
    expect(resolveActiveEngine("auto", NONE, true)).toBeNull();
    expect(resolveActiveEngine("whisperWeb", NONE, true)).toBeNull();
  });
});
