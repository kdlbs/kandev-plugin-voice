/**
 * React bindings over the framework-free pieces: settings, capabilities and
 * the dictation controller.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { detectVoiceCapabilities, resolveActiveEngine, type ResolvedEngine, type VoiceCapabilities } from "./capabilities";
import { DictationController, type DictationSnapshot } from "./dictation";
import { serverRelayAvailable } from "./engines/server-relay";
import { getSettings, loadSettings, subscribeSettings, type VoiceSettings } from "./settings";
import type { VoiceError } from "./errors";

export function useVoiceSettings(): VoiceSettings {
  useEffect(() => {
    void loadSettings();
  }, []);
  return useSyncExternalStore(subscribeSettings, getSettings, getSettings) as VoiceSettings;
}

export function useVoiceCapabilities(): VoiceCapabilities {
  return useMemo(() => detectVoiceCapabilities(), []);
}

/**
 * Whether the operator configured a server key. Probed once per bundle
 * lifetime and shared, so mounting five composers does not fire five probes.
 */
let relayProbe: Promise<boolean> | null = null;
let relayKnown: boolean | null = null;

export function resetRelayProbe(): void {
  relayProbe = null;
  relayKnown = null;
}

export function useServerRelayAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(relayKnown);
  useEffect(() => {
    if (relayKnown !== null) return;
    let cancelled = false;
    relayProbe ??= serverRelayAvailable().then((result) => {
      relayKnown = result;
      return result;
    });
    void relayProbe.then((result) => {
      if (!cancelled) setAvailable(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return available;
}

export type UseDictationResult = {
  engine: ResolvedEngine | null;
  supported: boolean;
  snapshot: DictationSnapshot;
  start: () => void;
  stop: () => void;
  cancel: () => void;
};

export type UseDictationOptions = {
  onTranscript: (text: string) => void;
  onError?: (error: VoiceError) => void;
  /** Cancels the run whenever this changes: the task/session/composer identity. */
  runScope: string;
};

export function useDictation(options: UseDictationOptions): UseDictationResult {
  const settings = useVoiceSettings();
  const caps = useVoiceCapabilities();
  const relayAvailable = useServerRelayAvailable();
  const engine = useMemo(
    () => resolveActiveEngine(settings.engine, caps, relayAvailable !== false),
    [settings.engine, caps, relayAvailable],
  );

  // Latest-value refs so the controller, which outlives any single render,
  // always reads current settings and callbacks.
  const latest = useRef({ settings, engine, onTranscript: options.onTranscript, onError: options.onError });
  useEffect(() => {
    latest.current = { settings, engine, onTranscript: options.onTranscript, onError: options.onError };
  });

  const controller = useMemo(
    () =>
      new DictationController({
        readConfig: () => ({
          engine: latest.current.engine,
          language: latest.current.settings.language,
          whisperWebModel: latest.current.settings.whisperWebModel,
        }),
        onTranscript: (text) => latest.current.onTranscript(text),
        onError: (error) => latest.current.onError?.(error),
      }),
    [],
  );

  useEffect(() => () => controller.dispose(), [controller]);

  // A task, session or composer switch abandons whatever is recording. The
  // transcript belongs to the conversation the user was looking at when they
  // started speaking, and there is no safe way to move it.
  const { runScope } = options;
  useEffect(() => {
    return () => controller.cancel();
  }, [controller, runScope]);

  // Switching Whisper size mid-session must drop the old model rather than
  // keep hundreds of megabytes resident.
  const modelSize = settings.whisperWebModel;
  const previousModel = useRef(modelSize);
  useEffect(() => {
    if (previousModel.current === modelSize) return;
    previousModel.current = modelSize;
    controller.releaseWhisperModel();
  }, [controller, modelSize]);

  const snapshot = useSyncExternalStore(
    controller.subscribe,
    () => controller.getSnapshot(),
    () => controller.getSnapshot(),
  ) as DictationSnapshot;

  const start = useCallback(() => void controller.start(), [controller]);
  const stop = useCallback(() => void controller.stop(), [controller]);
  const cancel = useCallback(() => controller.cancel(), [controller]);

  return { engine, supported: engine !== null, snapshot, start, stop, cancel };
}

/**
 * Tracks `(pointer: coarse)` so the button re-renders when an external
 * pointer is docked or undocked (Surface, iPad with a Magic Keyboard).
 */
export function useIsCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribeCoarsePointer,
    getCoarsePointerSnapshot,
    getCoarsePointerServerSnapshot,
  ) as boolean;
}

function subscribeCoarsePointer(callback: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mql = window.matchMedia("(pointer: coarse)");
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getCoarsePointerSnapshot(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(pointer: coarse)").matches;
}

function getCoarsePointerServerSnapshot(): boolean {
  return false;
}
