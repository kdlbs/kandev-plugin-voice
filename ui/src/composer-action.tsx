/**
 * The microphone button kandev renders in every composer toolbar. One
 * component serves all four surfaces (task chat, Quick Chat, task creation,
 * new-session creation); only the slot name differs.
 *
 * Styling comes from this plugin's own ui/plugin.css rather than kandev's
 * Tailwind utilities, which are not compiled for code outside kandev's source
 * tree. See the header comment in that file.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { IconLoader, IconMicrophone, IconPlayerStopFilled } from "./icons";
import { host, type PluginComposerSlotProps } from "./host";
import { registerAction } from "./active-action";
import type { PluginActionElement, PluginActionProps } from "@kandev/plugin-sdk";
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
  Action?: React.ComponentType<PluginActionProps>;
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

function ButtonIcon({
  state,
  modelLoad,
  showLoader = true,
}: {
  state: DictationState;
  modelLoad: ModelLoadState;
  showLoader?: boolean;
}) {
  if (showLoader && (state === "processing" || state === "requesting" || modelLoad.state === "loading")) {
    return <IconLoader className="kv-icon kv-spin" />;
  }
  if (state === "recording") return <IconPlayerStopFilled className="kv-icon kv-icon--stop" />;
  return <IconMicrophone className="kv-icon" />;
}

function ActionIcon({
  state,
  modelLoad,
  recording,
}: {
  state: DictationState;
  modelLoad: ModelLoadState;
  recording: boolean;
}) {
  return (
    <span className="kv-action-icon">
      <ButtonIcon key="voice-icon" state={state} modelLoad={modelLoad} showLoader={false} />
      {recording && <span key="recording-pulse" aria-hidden className="kv-pulse-ring" />}
    </span>
  );
}

/**
 * Hold-to-talk claims the pointer on pointerdown. Without capture, any drift
 * across the button's bounds — a small finger shift, a soft-keyboard reflow,
 * an OS gesture handoff — fires pointerleave and cuts the sentence short.
 */
function safePointerCapture(target: PluginActionElement, pointerId: number): void {
  try {
    target.setPointerCapture(pointerId);
  } catch {
    // Older WebKit throws InvalidPointerId after releasing implicit capture.
    // Worst case we fall back to the pre-capture behaviour.
  }
}

function safePointerRelease(target: PluginActionElement, pointerId: number): void {
  try {
    if (typeof target.hasPointerCapture === "function" && !target.hasPointerCapture(pointerId)) {
      return;
    }
    target.releasePointerCapture(pointerId);
  } catch {
    // Safari can throw when capture was already released.
  }
}

function buildHoldHandlers(
  start: () => void,
  stop: () => void,
  activePointerId: { current: number | null },
) {
  type ActionPointerEvent = Parameters<NonNullable<PluginActionProps["onPointerDown"]>>[0];
  const finish = (e: ActionPointerEvent, release: boolean) => {
    if (activePointerId.current !== e.pointerId) return;
    activePointerId.current = null;
    if (release) safePointerRelease(e.currentTarget, e.pointerId);
    stop();
  };

  return {
    onPointerDown: (e: ActionPointerEvent) => {
      if (activePointerId.current !== null) return;
      e.preventDefault();
      safePointerCapture(e.currentTarget, e.pointerId);
      activePointerId.current = e.pointerId;
      start();
    },
    onPointerUp: (e: ActionPointerEvent) => {
      e.preventDefault();
      finish(e, true);
    },
    onPointerCancel: (e: ActionPointerEvent) => {
      finish(e, true);
    },
    onLostPointerCapture: (e: ActionPointerEvent) => {
      finish(e, false);
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
function UnsupportedAction({
  disabled,
  buttonRef,
}: {
  disabled: boolean;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const { Action, Button, Tooltip, TooltipTrigger, TooltipContent } = ui();
  const onClick = () =>
    host().toast.error(t("unavailableTitle"), { description: t(unsupportedReasonKey()) });
  if (typeof Action === "function") {
    return (
      <Action
        ref={buttonRef}
        label={t("unavailableTitle")}
        icon={<IconMicrophone className="kv-icon" />}
        tooltip={t("unavailableTapForDetails")}
        disabled={disabled}
        data-testid="voice-plugin-button"
        data-state="unsupported"
        onClick={onClick}
      />
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger key="unavailable-trigger" asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          ref={buttonRef}
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
      <TooltipContent key="unavailable-tooltip">{t("unavailableTapForDetails")}</TooltipContent>
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
  const { Action, Button, Tooltip, TooltipTrigger, TooltipContent } = ui();
  const settings = useVoiceSettings();
  const coarse = useIsCoarsePointer();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const activePointerId = useRef<number | null>(null);
  const runScope = `${props.surface}:${props.taskId ?? ""}:${props.activeSessionId ?? ""}`;
  const currentRunScope = useRef(runScope);
  const activeRunScope = useRef<string | null>(null);
  const releaseActivePointer = useCallback(() => {
    const pointerId = activePointerId.current;
    activePointerId.current = null;
    if (pointerId !== null && buttonRef.current) {
      safePointerRelease(buttonRef.current, pointerId);
    }
  }, []);

  // The capability object is stable for the composer's mount, but read it back
  // through a ref anyway: an insertion happens seconds after the button was
  // pressed, long after this render's props were captured, and kandev may
  // hand out a fresh object if the composer remounts in between.
  const composerRef = useRef(props.composer);
  const autoSendRef = useRef(settings.autoSend);
  useLayoutEffect(() => {
    composerRef.current = props.composer;
    autoSendRef.current = settings.autoSend;
    if (currentRunScope.current !== runScope) {
      currentRunScope.current = runScope;
      activeRunScope.current = null;
      releaseActivePointer();
    }
  }, [props.composer, settings.autoSend, runScope, releaseActivePointer]);

  const onTranscript = useCallback((text: string) => {
    const transcriptScope = activeRunScope.current;
    if (!transcriptScope || transcriptScope !== currentRunScope.current) return;

    const composer = composerRef.current;
    const inserted = composer.insertText(text);
    if (inserted.status === "unavailable") {
      host().toast.error(t("errComposerGone"));
      return;
    }
    if (inserted.status === "ignored" || !autoSendRef.current) return;
    // Defer one frame so the composer's own onChange has flushed before the
    // native submit handler reads the draft back.
    requestAnimationFrame(() => {
      if (currentRunScope.current !== transcriptScope) return;
      void composer.submit();
    });
  }, []);

  const onError = useCallback((error: VoiceError) => {
    // "No speech" is an ordinary outcome of a short press, not a failure.
    if (error.code === "no-speech") host().toast(error.message);
    else host().toast.error(error.message);
  }, []);

  const { supported, snapshot, start, stop, cancel } = useDictation({
    onTranscript,
    onError,
    runScope,
  });
  const { state, modelLoad } = snapshot;

  const startInCurrentScope = useCallback(() => {
    activeRunScope.current = currentRunScope.current;
    start();
  }, [start]);
  const cancelCurrentRun = useCallback(() => {
    activeRunScope.current = null;
    releaseActivePointer();
    cancel();
  }, [cancel, releaseActivePointer]);

  // A composer that goes disabled mid-recording (the agent started, the form
  // is submitting) must not leave the microphone indicator burning.
  useEffect(() => {
    if (props.disabled && (state === "recording" || state === "requesting")) cancelCurrentRun();
  }, [props.disabled, state, cancelCurrentRun]);

  const effectiveMode = resolveEffectiveMode(settings.mode, coarse || props.presentation === "mobile");
  const toggle = useCallback(() => {
    if (state === "idle") startInCurrentScope();
    else if (state === "recording") stop();
  }, [state, startInCurrentScope, stop]);

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
      <div
        ref={containerRef}
        className="kv-action"
        data-surface={props.surface}
        data-mode={settings.mode}
        data-effective-mode={effectiveMode}
      >
        <UnsupportedAction disabled={props.disabled} buttonRef={buttonRef} />
      </div>
    );
  }

  const holdMode = effectiveMode === "hold";
  const isRecording = state === "recording";
  const isBusy = state === "requesting" || state === "processing" || modelLoad.state === "loading";
  const pointerHandlers = holdMode
    ? buildHoldHandlers(startInCurrentScope, stop, activePointerId)
    : {};

  return (
    <div
      ref={containerRef}
      className="kv-action"
      data-surface={props.surface}
      data-mode={settings.mode}
      data-effective-mode={effectiveMode}
    >
      <ModelLoadIndicator key="model-load" modelLoad={modelLoad} modelLabel={modelLabel} />
      {typeof Action === "function" ? (
        <Action
          key="voice-action"
          ref={buttonRef}
          label={t(LABEL_KEY_BY_STATE[state])}
          icon={<ActionIcon state={state} modelLoad={modelLoad} recording={isRecording} />}
          tone={isRecording ? "danger" : "neutral"}
          pressed={isRecording}
          disabled={props.disabled || (isBusy && !isRecording)}
          busy={isBusy}
          tooltip={tooltip}
          data-testid="voice-plugin-button"
          data-state={state}
          onClick={holdMode ? undefined : toggle}
          {...pointerHandlers}
        />
      ) : (
        <Tooltip key="legacy-voice-action">
          <TooltipTrigger key="legacy-trigger" asChild>
            <Button
              type="button"
              ref={buttonRef}
              variant="ghost"
              size="icon"
              aria-label={t(LABEL_KEY_BY_STATE[state])}
              aria-pressed={isRecording}
              data-testid="voice-plugin-button"
              data-state={state}
              disabled={props.disabled || (isBusy && !isRecording)}
              onClick={holdMode ? undefined : toggle}
              {...pointerHandlers}
              className={classes(
                "kv-btn",
                (coarse || props.presentation === "mobile") && "kv-btn--touch",
                isRecording && "kv-btn--recording",
              )}
            >
              <ButtonIcon key="legacy-icon" state={state} modelLoad={modelLoad} />
              {isRecording && <span key="legacy-recording-pulse" aria-hidden className="kv-pulse-ring" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent key="legacy-tooltip">{tooltip}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
