import { TranscribeError } from "./engines/server-relay";
import { t } from "./strings";

export type VoiceErrorCode =
  | "permission-denied"
  | "no-speech"
  | "not-configured"
  | "network"
  | "unsupported"
  | "model-load"
  | "unknown";

export type VoiceError = { code: VoiceErrorCode; message: string };

export function mapSpeechError(code: string): VoiceError {
  if (code === "not-allowed" || code === "service-not-allowed") {
    return { code: "permission-denied", message: t("errPermissionDenied") };
  }
  if (code === "no-speech") return { code: "no-speech", message: t("errNoSpeech") };
  if (code === "network") return { code: "network", message: t("errSpeechNetwork") };
  if (code === "audio-capture") return { code: "unknown", message: t("errNoMicrophone") };
  return { code: "unknown", message: t("errSpeechGeneric", { code }) };
}

export function mapMicError(err: unknown): VoiceError {
  if (err && typeof err === "object" && "name" in err) {
    const name = (err as { name: string }).name;
    if (name === "NotAllowedError" || name === "SecurityError") {
      return { code: "permission-denied", message: t("errPermissionDenied") };
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      return { code: "unknown", message: t("errNoMicrophone") };
    }
  }
  return { code: "unknown", message: t("errRecordingStart") };
}

export function mapTranscribeError(err: unknown): VoiceError {
  if (err instanceof TranscribeError && err.status === 503) {
    return { code: "not-configured", message: t("errRelayNotConfigured") };
  }
  if (err instanceof TranscribeError && err.status === 413) {
    return { code: "network", message: t("errRecordingTooLong") };
  }
  return { code: "network", message: t("errTranscriptionFailed") };
}

export function mapWhisperError(err: unknown): VoiceError {
  return {
    code: "model-load",
    message: err instanceof Error ? err.message : t("errWhisperFailed"),
  };
}
