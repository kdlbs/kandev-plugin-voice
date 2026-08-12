/**
 * The microphone button kandev renders in every composer toolbar. One
 * component serves all four surfaces (task chat, Quick Chat, task creation,
 * new-session creation); only the slot name differs.
 *
 * Styling comes from this plugin's own ui/plugin.css rather than kandev's
 * Tailwind utilities, which are not compiled for code outside kandev's source
 * tree. See the header comment in that file.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { IconLoader2, IconMicrophone, IconPlayerStopFilled } from "@tabler/icons-react";
import { host, type PluginComposerSlotProps } from "./host";
import { registerAction } from "./active-action";
import { useDictation, useIsCoarsePointer, useVoiceSettings } from "./use-dictation";
import { whisperModelConfig } from "./models";
import { t, type StringKey } from "./strings";
import type { DictationState, ModelLoadState } from "./dictation";
import type { VoiceError } from "./errors";

const TOOLTIP_KEY_BY_STATE: Record<DictationState, StringKey> = {
  idle: "tooltipIdle",
  requesting: "tooltipRequesting",
  recording: "tooltipRecording",
  processing: "tooltipProcessing",
};

const LABEL_KEY_BY_STATE: Record<DictationState, StringKey> = {
  idle: "actionLabelIdle",
  requesting: "actionLabelRequesting",
  recording: "actionLabelRecording",
  processing: "actionLabelProcessing",
};

type Component = React.ComponentType<Record<string, unknown>>;

type UiExports = {
  Button: Component;
  Tooltip: Component;
  TooltipTrigger: Component;
  TooltipContent: Component;
  Progress: Component;
};

function ui(): UiExports {
  return host().ui as unknown as UiExports;
}

function classes(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function percent(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(100, Math.max(0, Math.round(progress * 100)));
}

function ButtonIcon({ state, modelLoad }: { state: DictationState; modelLoad: ModelLoadState }) {
  if (state === "processing" || state === "requesting" || modelLoad.state === "loading") {
    return <IconLoader2 className="kv-icon kv-spin" />;
  }
  if (state === "recording") return <IconPlayerStopFilled className="kv-icon kv-icon--stop" />;
  return <IconMicrophone className="kv-icon" />;
}

/**
 * Hold-to-talk claims the pointer on pointerdown. Without capture, any drift
 * across the button's bounds — a small finger shift, a soft-keyboard reflow,
 * an OS gesture handoff — fires pointerleave and cuts the sentence short.
 */
function safePointerCapture(target: Element, pointerId: number): void {
  try {
    target.setPointerCapture(pointerId);
  } catch {
    // Older WebKit throws InvalidPointerId after releasing implicit capture.
    // Worst case we fall back to the pre-capture behaviour.
  }
}

function safePointerRelease(target: Element, pointerId: number): void {
  try {
    if (typeof target.hasPointerCapture === "function" && !target.hasPointerCapture(pointerId)) {
      return;
    }
    target.releasePointerCapture(pointerId);
  } catch {
    // Safari can throw when capture was already released.
  }
}

function buildHoldHandlers(start: () => void, stop: () => void) {
  return {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      safePointerCapture(e.currentTarget as Element, e.pointerId);
      start();
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.preventDefault();
      safePointerRelease(e.currentTarget as Element, e.pointerId);
      stop();
    },
    onPointerCancel: (e: React.PointerEvent) => {
      safePointerRelease(e.currentTarget as Element, e.pointerId);
      stop();
    },
  };
}

/**
 * Hold is unreliable on touch even with pointer capture: the platform reclaims
 * the pointer for system gestures, and the stored preference becomes a trap.
 * Coarse-pointer devices silently get toggle; the saved preference is left
 * alone so docking a keyboard restores the user's choice without a save.
 */
export function resolveEffectiveMode(
  prefMode: "hold" | "toggle",
  coarse: boolean,
): "hold" | "toggle" {
  return prefMode === "hold" && !coarse ? "hold" : "toggle";
}

export function unsupportedReasonKey(): StringKey {
  if (typeof window === "undefined") return "unavailableHere";
  if (!window.isSecureContext) return "unavailableInsecure";
  return "unavailableBrowser";
}

/**
 * Rendered instead of a working button when no engine is available. It stays
 * visible and tappable on purpose: hiding it left mobile users with no way to
 * discover that dictation needs a secure context.
 */
function UnsupportedAction({ disabled }: { disabled: boolean }) {
  const { Button, Tooltip, TooltipTrigger, TooltipContent } = ui();
  const onClick = () =>
    host().toast.error(t("unavailableTitle"), { description: t(unsupportedReasonKey()) });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("unavailableTitle")}
          data-testid="voice-plugin-button"
          data-state="unsupported"
          disabled={disabled}
          onClick={onClick}
          className="kv-btn kv-btn--unsupported"
        >
          <IconMicrophone className="kv-icon" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("unavailableTapForDetails")}</TooltipContent>
    </Tooltip>
  );
}

function ModelLoadIndicator({
  modelLoad,
  modelLabel,
}: {
  modelLoad: ModelLoadState;
  modelLabel: string;
}) {
  const { Progress } = ui();
  if (modelLoad.state !== "loading") return null;
  const pct = percent(modelLoad.progress);
  return (
    <div
      className="kv-model-load"
      data-testid="voice-plugin-model-load"
      aria-label={t("modelDownloading", { modelLabel })}
    >
      <Progress value={pct} className="kv-model-load__bar" />
      <span className="kv-model-load__pct">{`${pct}%`}</span>
    </div>
  );
}

export function VoiceComposerAction({ slotProps }: { slotProps?: unknown }) {
  const props = slotProps as PluginComposerSlotProps | undefined;
  const settings = useVoiceSettings();
  // Turning Voice Mode off must cost nothing, including the capability probes
  // and the microphone permission prompt, so the real work lives in a child.
  if (!props || !settings.enabled) return null;
  return <EnabledVoiceComposerAction {...props} />;
}

function EnabledVoiceComposerAction(props: PluginComposerSlotProps) {
  const { Button, Tooltip, TooltipTrigger, TooltipContent } = ui();
  const settings = useVoiceSettings();
  const coarse = useIsCoarsePointer();
  const containerRef = useRef<HTMLDivElement | null>(null);

  // The capability object is stable for the composer's mount, but read it back
  // through a ref anyway: an insertion happens seconds after the button was
  // pressed, long after this render's props were captured, and kandev may
  // hand out a fresh object if the composer remounts in between.
  const composerRef = useRef(props.composer);
  const autoSendRef = useRef(settings.autoSend);
  useEffect(() => {
    composerRef.current = props.composer;
    autoSendRef.current = settings.autoSend;
  });

  const onTranscript = useCallback((text: string) => {
    const inserted = composerRef.current.insertText(text);
    if (inserted.status === "unavailable") {
      host().toast.error(t("errComposerGone"));
      return;
    }
    if (inserted.status === "ignored" || !autoSendRef.current) return;
    // Defer one frame so the composer's own onChange has flushed before the
    // native submit handler reads the draft back.
    requestAnimationFrame(() => {
      void composerRef.current.submit();
    });
  }, []);

  const onError = useCallback((error: VoiceError) => {
    // "No speech" is an ordinary outcome of a short press, not a failure.
    if (error.code === "no-speech") host().toast(error.message);
    else host().toast.error(error.message);
  }, []);

  const runScope = `${props.surface}:${props.taskId ?? ""}:${props.activeSessionId ?? ""}`;
  const { supported, snapshot, start, stop, cancel } = useDictation({
    onTranscript,
    onError,
    runScope,
  });
  const { state, modelLoad } = snapshot;

  // A composer that goes disabled mid-recording (the agent started, the form
  // is submitting) must not leave the microphone indicator burning.
  useEffect(() => {
    if (props.disabled && (state === "recording" || state === "requesting")) cancel();
  }, [props.disabled, state, cancel]);

  const effectiveMode = resolveEffectiveMode(settings.mode, coarse);
  const toggle = useCallback(() => {
    if (state === "idle") start();
    else if (state === "recording") stop();
  }, [state, start, stop]);

  // The keyboard shortcut resolves its target at press time, so keep the
  // registered entry pointed at the current closures.
  const usable = supported && !props.disabled;
  const live = useRef({ toggle, usable });
  useEffect(() => {
    live.current = { toggle, usable };
  });
  useEffect(
    () =>
      registerAction({
        element: containerRef.current,
        usable: () => live.current.usable,
        toggle: () => live.current.toggle(),
      }),
    [],
  );

  const modelLabel = whisperModelConfig(settings.whisperWebModel).label;
  const tooltip = useMemo(() => {
    if (modelLoad.state === "loading") {
      return t("tooltipDownloading", { modelLabel, pct: percent(modelLoad.progress) });
    }
    const base = t(TOOLTIP_KEY_BY_STATE[state]);
    return effectiveMode === "hold" && state === "idle" ? t("tooltipHold", { tooltip: base }) : base;
  }, [modelLoad, modelLabel, state, effectiveMode]);

  if (!supported) {
    return (
      <div ref={containerRef} className="kv-action">
        <UnsupportedAction disabled={props.disabled} />
      </div>
    );
  }

  const holdMode = effectiveMode === "hold";
  const isRecording = state === "recording";
  const isBusy = state === "requesting" || state === "processing" || modelLoad.state === "loading";
  const touchSized = coarse || props.presentation === "mobile";

  return (
    <div ref={containerRef} className="kv-action">
      <ModelLoadIndicator modelLoad={modelLoad} modelLabel={modelLabel} />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t(LABEL_KEY_BY_STATE[state])}
            aria-pressed={isRecording}
            data-testid="voice-plugin-button"
            data-state={state}
            data-surface={props.surface}
            data-mode={settings.mode}
            data-effective-mode={effectiveMode}
            disabled={props.disabled || (isBusy && !isRecording)}
            onClick={holdMode ? undefined : toggle}
            {...(holdMode ? buildHoldHandlers(start, stop) : {})}
            className={classes(
              "kv-btn",
              touchSized && "kv-btn--touch",
              isRecording && "kv-btn--recording",
            )}
          >
            <ButtonIcon state={state} modelLoad={modelLoad} />
            {isRecording && <span aria-hidden className="kv-pulse-ring" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </div>
  );
}
