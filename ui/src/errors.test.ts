import { describe, expect, it } from "vitest";
import { TranscribeError } from "./engines/server-relay";
import { mapMicError, mapSpeechError, mapTranscribeError, mapWhisperError } from "./errors";
import { t } from "./strings";

describe("strings", () => {
  it("interpolates named values and leaves unknown placeholders alone", () => {
    expect(t("tooltipDownloading", { modelLabel: "Whisper Base", pct: 42 })).toBe(
      "Downloading Whisper Base (42%)",
    );
    expect(t("tooltipHold", {})).toContain("{{tooltip}}");
  });
});

describe("mapSpeechError", () => {
  it("distinguishes the outcomes a user can act on", () => {
    expect(mapSpeechError("not-allowed").code).toBe("permission-denied");
    expect(mapSpeechError("service-not-allowed").code).toBe("permission-denied");
    expect(mapSpeechError("no-speech").code).toBe("no-speech");
    expect(mapSpeechError("network").code).toBe("network");
    expect(mapSpeechError("audio-capture").code).toBe("unknown");
  });

  it("names an unrecognised code so a bug report can quote it", () => {
    expect(mapSpeechError("language-not-supported").message).toContain("language-not-supported");
  });
});

describe("mapMicError", () => {
  it("maps the DOMException names getUserMedia actually throws", () => {
    expect(mapMicError({ name: "NotAllowedError" }).code).toBe("permission-denied");
    expect(mapMicError({ name: "SecurityError" }).code).toBe("permission-denied");
    expect(mapMicError({ name: "NotFoundError" }).code).toBe("unknown");
    expect(mapMicError(new Error("boom")).code).toBe("unknown");
    expect(mapMicError(undefined).code).toBe("unknown");
  });
});

describe("mapTranscribeError", () => {
  it("steers the user to a browser engine when the relay has no key", () => {
    const mapped = mapTranscribeError(new TranscribeError("nope", 503));
    expect(mapped.code).toBe("not-configured");
    expect(mapped.message).toContain("Voice Mode settings");
  });

  it("explains an oversized recording rather than blaming the network", () => {
    expect(mapTranscribeError(new TranscribeError("too big", 413)).message).toContain("too long");
  });

  it("keeps every other failure generic", () => {
    expect(mapTranscribeError(new TranscribeError("boom", 502)).code).toBe("network");
    expect(mapTranscribeError(new Error("offline")).code).toBe("network");
  });
});

describe("mapWhisperError", () => {
  it("surfaces the underlying message, which names the missing model file", () => {
    expect(mapWhisperError(new Error("failed to fetch decoder_model_merged")).message).toContain(
      "decoder_model_merged",
    );
    expect(mapWhisperError("odd").code).toBe("model-load");
  });
});
