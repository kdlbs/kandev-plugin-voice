/**
 * MediaRecorder capture, shared by the two engines that upload audio
 * (in-browser Whisper and the server relay). Web Speech does its own capture.
 */

export type CaptureHandle = {
  stream: MediaStream;
  recorder: MediaRecorder;
  chunks: Blob[];
  mime: string;
  ext: string;
};

/**
 * First container this browser can record. Ordered by transcription quality
 * per byte; the empty mime lets MediaRecorder choose when none match.
 */
export function pickRecorderMime(): { mime: string; ext: string } {
  if (
    typeof window === "undefined" ||
    typeof window.MediaRecorder === "undefined"
  ) {
    return { mime: "", ext: "webm" };
  }
  const candidates = [
    { mime: "audio/webm;codecs=opus", ext: "webm" },
    { mime: "audio/webm", ext: "webm" },
    { mime: "audio/mp4", ext: "m4a" },
    { mime: "audio/ogg;codecs=opus", ext: "ogg" },
    { mime: "audio/wav", ext: "wav" },
  ];
  for (const candidate of candidates) {
    if (window.MediaRecorder.isTypeSupported(candidate.mime)) return candidate;
  }
  return { mime: "", ext: "webm" };
}

export async function startCapture(
  signal?: AbortSignal,
): Promise<CaptureHandle | null> {
  const { mime, ext } = pickRecorderMime();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  // getUserMedia cannot be aborted consistently across browsers. A permission
  // grant can arrive after the composer that requested it has unmounted, so
  // stop the fresh stream before constructing or starting a recorder.
  if (signal?.aborted) {
    for (const track of stream.getTracks()) track.stop();
    return null;
  }
  const recorder = new MediaRecorder(
    stream,
    mime ? { mimeType: mime } : undefined,
  );
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  });
  recorder.start();
  return { stream, recorder, chunks, mime, ext };
}

/** Releases the microphone. Always call this, including on cancel. */
export function teardownCapture(handle: CaptureHandle | null): void {
  if (!handle) return;
  for (const track of handle.stream.getTracks()) track.stop();
}

/** Stops recording and resolves the recorded blob, or null if nothing landed. */
export function stopCapture(handle: CaptureHandle): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (handle.recorder.state === "inactive") {
      teardownCapture(handle);
      resolve(null);
      return;
    }
    handle.recorder.addEventListener(
      "stop",
      () => {
        const type = handle.recorder.mimeType || handle.mime || "audio/webm";
        const blob =
          handle.chunks.length > 0 ? new Blob(handle.chunks, { type }) : null;
        teardownCapture(handle);
        resolve(blob);
      },
      { once: true },
    );
    handle.recorder.stop();
  });
}
