/**
 * Client wrapper around the whisper worker: hides the postMessage protocol
 * behind promises and owns the decode/resample step, so callers only see
 * "Blob in, transcript out".
 */
import { assetUrl } from "../host";
import { whisperModelConfig } from "../models";
import type { WhisperWebModelSize } from "../settings";

/** Sample rate Whisper expects; we hand the worker mono Float32 at this rate. */
const WHISPER_SAMPLE_RATE = 16000;

/** Package-relative path of the built worker (see ui/build.mjs). */
export const WHISPER_WORKER_PATH = "/ui/whisper-worker.js";

export type WhisperWebProgress = { stage: string; progress: number };
export type WhisperWebHandlers = { onProgress?: (p: WhisperWebProgress) => void };

type WorkerMessage =
  | { type: "progress"; stage: string; progress: number }
  | { type: "ready" }
  | { type: "result"; text: string }
  | { type: "error"; message: string };

type Pending = {
  resolve: (value: string | undefined) => void;
  reject: (err: Error) => void;
};

export class WhisperWebClient {
  private worker: Worker | null = null;
  private pending: Pending | null = null;
  private ready = false;
  private loadedModelId: string | null = null;

  constructor(private handlers: WhisperWebHandlers = {}) {}

  /** Lazily creates the worker; resolves once the model is loaded. */
  async init(size: WhisperWebModelSize): Promise<void> {
    const config = whisperModelConfig(size);
    if (this.ready && this.loadedModelId === config.modelId) return;
    this.ensureWorker();
    this.loadedModelId = config.modelId;
    this.ready = false;
    await this.send({ type: "init", model: config.modelId });
    this.ready = true;
  }

  /**
   * Transcribes a recorded blob in any container the browser can decode
   * (webm/opus, mp4/aac, wav, ogg): everything is resampled to 16 kHz mono
   * Float32 before it reaches the worker.
   */
  async transcribe(blob: Blob, language?: string): Promise<string> {
    if (!this.ready || !this.worker) throw new Error("WhisperWebClient: not initialized");
    const audio = await blobToWhisperFloat32(blob);
    const text = await this.send({ type: "transcribe", audio, language }, [audio.buffer]);
    return text ?? "";
  }

  /** Tears the worker down and releases the loaded model. */
  dispose(): void {
    if (this.worker) {
      try {
        this.worker.postMessage({ type: "dispose" });
      } catch {
        // The worker may already be gone; terminate below regardless.
      }
      this.worker.terminate();
      this.worker = null;
    }
    this.ready = false;
    this.loadedModelId = null;
    if (this.pending) {
      this.pending.reject(new Error("WhisperWebClient disposed"));
      this.pending = null;
    }
  }

  private ensureWorker() {
    if (this.worker) return;
    this.worker = new Worker(assetUrl(WHISPER_WORKER_PATH), { type: "module" });
    this.worker.addEventListener("message", (e: MessageEvent<WorkerMessage>) =>
      this.handleMessage(e.data),
    );
    // Capture the worker at listener-attach time: a late error from a worker
    // we already replaced must not terminate its successor.
    const ownWorker = this.worker;
    this.worker.addEventListener("error", (e) => {
      const err = new Error(e.message || "Whisper worker crashed");
      ownWorker?.terminate();
      if (this.worker === ownWorker) {
        this.worker = null;
        this.ready = false;
        this.loadedModelId = null;
      }
      if (this.pending) {
        this.pending.reject(err);
        this.pending = null;
      }
    });
  }

  private send(payload: object, transfer: Transferable[] = []): Promise<string | undefined> {
    if (!this.worker) throw new Error("WhisperWebClient: worker not initialized");
    if (this.pending) {
      return Promise.reject(new Error("WhisperWebClient: another request is in flight"));
    }
    return new Promise<string | undefined>((resolve, reject) => {
      this.pending = { resolve, reject };
      this.worker?.postMessage(payload, transfer);
    });
  }

  private handleMessage(msg: WorkerMessage) {
    if (msg.type === "progress") {
      this.handlers.onProgress?.({ stage: msg.stage, progress: msg.progress });
      return;
    }
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    if (msg.type === "error") {
      pending.reject(new Error(msg.message));
      return;
    }
    if (msg.type === "ready") {
      pending.resolve(undefined);
      return;
    }
    pending.resolve(msg.text);
  }
}

/** Decodes an audio Blob into 16 kHz mono Float32, the format Whisper wants. */
export async function blobToWhisperFloat32(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) throw new Error("AudioContext is not available in this browser");
  const decodeCtx = new AudioCtor();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuffer);
  } finally {
    await decodeCtx.close();
  }
  return resampleToMono16k(decoded);
}

async function resampleToMono16k(buf: AudioBuffer): Promise<Float32Array> {
  const length = Math.ceil(buf.duration * WHISPER_SAMPLE_RATE);
  const offline = new OfflineAudioContext(1, length, WHISPER_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = buf;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}
