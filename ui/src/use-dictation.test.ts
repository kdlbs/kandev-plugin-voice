import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearHost } from "./host";
import { resetRelayProbe, useDictation } from "./use-dictation";
import { DEFAULT_SETTINGS, resetSettingsStore } from "./settings";
import { installFakeHost, type FakeHost } from "./test-host";

let fakeHost: FakeHost;
let grantMicrophone: ((stream: MediaStream) => void) | undefined;
const recorderStarted = vi.fn(() => {});

class PendingPermissionRecorder {
  static isTypeSupported = () => true;
  state = "inactive";
  mimeType = "audio/webm";
  private listeners = new Map<string, Array<(event: { data: Blob }) => void>>();

  constructor(_stream: MediaStream, _options?: MediaRecorderOptions) {}

  addEventListener(type: string, listener: (event: { data: Blob }) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  start() {
    this.state = "recording";
    recorderStarted();
  }

  stop() {
    this.state = "inactive";
    for (const listener of this.listeners.get("dataavailable") ?? []) {
      listener({ data: new Blob(["fixture"], { type: "audio/webm" }) });
    }
    for (const listener of this.listeners.get("stop") ?? []) listener({ data: new Blob() });
  }
}

beforeEach(() => {
  resetSettingsStore();
  resetRelayProbe();
  fakeHost = installFakeHost();
  fakeHost.storage.values.set("instance/global/voice-mode", {
    ...DEFAULT_SETTINGS,
    engine: "whisperWeb",
  });
  recorderStarted.mockClear();
  grantMicrophone = undefined;
  vi.stubGlobal("MediaRecorder", PendingPermissionRecorder);
  vi.stubGlobal("Worker", class WorkerFixture {});
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(
        () =>
          new Promise<MediaStream>((resolve) => {
            grantMicrophone = resolve;
          }),
      ),
    },
  });
});

afterEach(() => {
  resetSettingsStore();
  clearHost();
  vi.unstubAllGlobals();
});

describe("useDictation lifecycle", () => {
  it("releases a microphone grant that arrives after the action unmounts", async () => {
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] } as unknown as MediaStream;
    const onTranscript = vi.fn();
    const { result, unmount } = renderHook(() =>
      useDictation({ onTranscript, runScope: "task-chat:task-1:session-1" }),
    );

    await waitFor(() => expect(result.current.engine).toBe("whisperWeb"));
    act(() => result.current.start());
    expect(result.current.snapshot.state).toBe("requesting");

    unmount();
    await act(async () => {
      grantMicrophone?.(stream);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(recorderStarted).toHaveBeenCalledOnce();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(onTranscript).not.toHaveBeenCalled();
  });
});
