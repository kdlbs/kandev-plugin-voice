/**
 * The server-side engine: uploads the recording to this plugin's own
 * authenticated `transcribe` webhook, which relays it to the operator's
 * OpenAI-compatible endpoint. The key never reaches the browser.
 */
import { host } from "../host";

export class TranscribeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TranscribeError";
  }
}

/** Whether the operator saved a key, i.e. whether this engine can be offered. */
export async function serverRelayAvailable(signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await host().api.fetch(`webhooks/transcribe?probe=1`, {
      method: "POST",
      signal,
    });
    // 503 is the plugin backend's "no key configured". Anything else means the
    // relay exists and would have tried: 400 for the probe's missing audio is
    // the expected healthy answer.
    return response.status !== 503;
  } catch {
    return false;
  }
}

export async function transcribeViaServer(
  blob: Blob,
  filename: string,
  signal?: AbortSignal,
): Promise<string> {
  const formData = new FormData();
  formData.append("audio", blob, filename);

  // Deliberately no Content-Type header: the browser must set
  // multipart/form-data with its own boundary for a FormData body.
  const response = await host().api.fetch("webhooks/transcribe", {
    method: "POST",
    body: formData,
    signal,
  });

  if (!response.ok) {
    throw new TranscribeError(await errorMessage(response), response.status);
  }
  const parsed = (await response.json()) as { text?: unknown };
  return typeof parsed.text === "string" ? parsed.text.trim() : "";
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Fall through to the generic message below.
  }
  return `Transcription failed: ${response.status}`;
}
