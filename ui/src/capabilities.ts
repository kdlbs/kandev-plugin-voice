import type { VoiceEngine } from "./settings";

/**
 * Which voice engines the current browser can actually run. Shared by the
 * composer action (which picks the active engine) and the settings page
 * (which decides what to offer).
 */
export type VoiceCapabilities = {
  webSpeech: boolean;
  whisperWeb: boolean;
  /** MediaRecorder + getUserMedia: the floor for whisperWeb and whisperServer. */
  audioCapture: boolean;
};

export type ResolvedEngine = Exclude<VoiceEngine, "auto">;

const FALLBACK_ORDER: ResolvedEngine[] = ["webSpeech", "whisperWeb", "whisperServer"];

export function detectVoiceCapabilities(): VoiceCapabilities {
  if (typeof window === "undefined") {
    return { webSpeech: false, whisperWeb: false, audioCapture: false };
  }
  const w = window as Window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  const webSpeech = !!(w.SpeechRecognition || w.webkitSpeechRecognition);
  const audioCapture =
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof window.MediaRecorder !== "undefined";
  // whisper-web needs a Worker plus WebGPU or WebAssembly. Every browser with
  // MediaRecorder has one of those, so capture is the gating constraint.
  const whisperWeb = audioCapture && typeof Worker !== "undefined";
  return { webSpeech, whisperWeb, audioCapture };
}

/**
 * Resolves the engine to run for a stored preference.
 *
 * Auto order: Web Speech (cheapest, native) then Whisper Web (private,
 * heavier) then the server relay (always works, but needs an operator key and
 * costs money). A pinned engine that is not usable degrades along the same
 * order rather than leaving a dead button.
 *
 * `serverRelayAvailable` is false when the operator saved no OpenAI key, so
 * the relay is never selected only to answer 503 on the first recording.
 */
export function resolveActiveEngine(
  preference: VoiceEngine,
  caps: VoiceCapabilities,
  serverRelayAvailable: boolean,
): ResolvedEngine | null {
  const isUsable = (engine: ResolvedEngine) => {
    if (engine === "webSpeech") return caps.webSpeech;
    if (engine === "whisperWeb") return caps.whisperWeb;
    return caps.audioCapture && serverRelayAvailable;
  };

  if (preference === "auto") return FALLBACK_ORDER.find(isUsable) ?? null;
  if (isUsable(preference)) return preference;
  return FALLBACK_ORDER.find(isUsable) ?? null;
}
