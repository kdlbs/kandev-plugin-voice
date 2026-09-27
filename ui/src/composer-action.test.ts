import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearHost, type PluginComposerSlotProps } from "./host";
import { resetActions } from "./active-action";
import type { DictationSnapshot } from "./dictation";
import type { VoiceSettings } from "./settings";

const actionHarness = vi.hoisted(() => ({
  settings: {
    enabled: true,
    engine: "webSpeech" as const,
    language: "en-US",
    mode: "toggle" as "hold" | "toggle",
    autoSend: false,
    whisperWebModel: "base" as const,
  } as VoiceSettings,
  coarse: false,
  supported: true,
  snapshot: {
    state: "idle" as DictationSnapshot["state"],
    error: null,
    modelLoad: { state: "idle" as DictationSnapshot["modelLoad"]["state"], progress: 0 },
  } as DictationSnapshot,
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
  onTranscript: ((_text: string) => {}) as (text: string) => void,
  runScope: "",
  setSnapshot: ((_patch: Record<string, unknown>) => {}) as (patch: Record<string, unknown>) => void,
}));

vi.mock("./use-dictation", async () => {
  const ReactRuntime = await import("react");
  return {
    useVoiceSettings: () => actionHarness.settings,
    useIsCoarsePointer: () => actionHarness.coarse,
    useDictation: ({
      onTranscript,
      runScope,
    }: {
      onTranscript: (text: string) => void;
      runScope: string;
    }) => {
      const [snapshot, setSnapshot] = ReactRuntime.useState<DictationSnapshot>(
        actionHarness.snapshot,
      );
      actionHarness.onTranscript = onTranscript;
      actionHarness.runScope = runScope;
      actionHarness.setSnapshot = (patch) =>
        setSnapshot((current) => ({ ...current, ...patch }) as typeof current);

      return {
        supported: actionHarness.supported,
        snapshot,
        start: () => {
          actionHarness.start();
          setSnapshot((current) => ({ ...current, state: "recording" }));
        },
        stop: () => {
          actionHarness.stop();
          setSnapshot((current) => ({ ...current, state: "idle" }));
        },
        cancel: () => {
          actionHarness.cancel();
          setSnapshot((current) => ({ ...current, state: "idle" }));
        },
      };
    },
  };
});

import { VoiceComposerAction } from "./composer-action";
import { DEFAULT_SETTINGS } from "./settings";
import { installFakeHost, type FakeHost } from "./test-host";

type HostActionProps = {
  label: string;
  icon?: React.ReactNode;
  pressed?: boolean;
  disabled?: boolean;
  busy?: boolean;
  tone?: string;
  tooltip?: string;
  "data-testid"?: string;
  "data-state"?: string;
  ref?: React.Ref<HTMLButtonElement>;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  onPointerDown?: React.PointerEventHandler<HTMLButtonElement>;
  onPointerUp?: React.PointerEventHandler<HTMLButtonElement>;
  onPointerCancel?: React.PointerEventHandler<HTMLButtonElement>;
  onLostPointerCapture?: React.PointerEventHandler<HTMLButtonElement>;
};

const actionPropsSeen: HostActionProps[] = [];

function HostAction(props: HostActionProps) {
  actionPropsSeen.push(props);
  return React.createElement(
    "button",
    {
      ref: props.ref,
      type: "button",
      "aria-label": props.label,
      "aria-pressed": props.pressed,
      "aria-busy": props.busy,
      title: props.tooltip,
      disabled: props.disabled,
      "data-testid": props["data-testid"],
      "data-state": props["data-state"],
      "data-tone": props.tone,
      onClick: props.onClick,
      onPointerDown: props.onPointerDown,
      onPointerUp: props.onPointerUp,
      onPointerCancel: props.onPointerCancel,
      onLostPointerCapture: props.onLostPointerCapture,
    },
    props.icon,
  );
}

const LegacyButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }
>(function LegacyButton(props, ref) {
  return React.createElement("button", { ...props, ref });
});

function Passthrough({ children }: { children?: React.ReactNode }) {
  return React.createElement(React.Fragment, null, children);
}

function Progress({ value, className }: { value: number; className?: string }) {
  return React.createElement("progress", { value, max: 100, className });
}

let fakeHost: FakeHost;

function makeSlotProps(
  overrides: Partial<PluginComposerSlotProps> = {},
): PluginComposerSlotProps {
  return {
    surface: "task-chat",
    presentation: "desktop",
    taskId: "task-1",
    taskTitle: "Voice task",
    activeSessionId: "session-1",
    sessionIds: ["session-1"],
    disabled: false,
    submittable: true,
    composer: {
      insertText: vi.fn(() => ({ status: "inserted" as const })),
      focus: vi.fn(() => ({ status: "focused" as const })),
      submit: vi.fn(async () => ({ status: "submitted" as const })),
    },
    ...overrides,
  };
}

function renderAction(slotProps: PluginComposerSlotProps, withAction = true) {
  const ui: Record<string, unknown> = {
    Button: LegacyButton,
    Tooltip: Passthrough,
    TooltipTrigger: Passthrough,
    TooltipContent: () => null,
    Progress,
  };
  if (withAction) ui.Action = HostAction;
  fakeHost = installFakeHost({ ui });
  return render(React.createElement(VoiceComposerAction, { slotProps }));
}

function pointerEvent(target: HTMLElement, type: string, pointerId = 7) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: "mouse" },
    isPrimary: { value: true },
    button: { value: 0 },
  });
  act(() => target.dispatchEvent(event));
  return event;
}

import { act } from "react";

beforeEach(() => {
  actionHarness.settings = { ...DEFAULT_SETTINGS, engine: "webSpeech" };
  actionHarness.coarse = false;
  actionHarness.supported = true;
  actionHarness.snapshot = {
    state: "idle",
    error: null,
    modelLoad: { state: "idle", progress: 0 },
  };
  actionHarness.start.mockClear();
  actionHarness.stop.mockClear();
  actionHarness.cancel.mockClear();
  actionPropsSeen.length = 0;
  actionHarness.onTranscript = () => {};
  actionHarness.runScope = "";
  fakeHost = installFakeHost();
});

afterEach(() => {
  cleanup();
  resetActions();
  clearHost();
  vi.unstubAllGlobals();
});

describe("Voice composer Action compatibility", () => {
  it.each([
    ["task-chat", "desktop"],
    ["quick-chat", "mobile"],
    ["task-create", "desktop"],
    ["new-session", "mobile"],
  ] as const)("renders one host Action for %s on %s", (surface, presentation) => {
    renderAction(makeSlotProps({ surface, presentation }));

    const button = screen.getByRole("button", { name: "Start dictation" }) as HTMLButtonElement;
    expect(button.tagName).toBe("BUTTON");
    expect(button.type).toBe("button");
    expect(button.parentElement?.getAttribute("data-surface")).toBe(surface);
    expect(button.querySelector("button")).toBeNull();
    expect(actionPropsSeen).toHaveLength(1);
    expect(actionPropsSeen[0]).not.toHaveProperty("className");
    expect(actionPropsSeen[0]).not.toHaveProperty("style");
    expect(actionPropsSeen[0]).not.toHaveProperty("size");
    expect(actionPropsSeen[0]).not.toHaveProperty("variant");
  });

  it("keeps one keyboard-activatable legacy Button when Action is absent", async () => {
    const user = userEvent.setup();
    renderAction(makeSlotProps(), false);

    const button = screen.getByRole("button", { name: "Start dictation" });
    button.focus();
    await user.keyboard("{Enter}");

    expect(actionHarness.start).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Stop dictation" })).toBe(button);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("does not render or request a microphone when the host has no composer contract", () => {
    renderAction(
      {
        taskId: "task-1",
        taskTitle: "Voice task",
        activeSessionId: "session-1",
        sessionIds: ["session-1"],
      } as PluginComposerSlotProps,
      false,
    );

    expect(screen.queryByTestId("voice-plugin-button")).toBeNull();
    expect(actionHarness.start).not.toHaveBeenCalled();
    expect(actionHarness.runScope).toBe("");
  });

  it("keeps the real button ref and keyboard focus on the host Action", async () => {
    const user = userEvent.setup();
    renderAction(makeSlotProps());

    const button = screen.getByRole("button", { name: "Start dictation" });
    const buttonRef = actionPropsSeen[0]?.ref as React.RefObject<HTMLButtonElement | null>;
    expect(buttonRef.current).toBe(button);

    button.focus();
    expect(document.activeElement).toBe(button);
    await user.keyboard("{Enter}");
    expect(actionHarness.start).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Stop dictation" })).toBe(button);
  });

  it("uses the phone toggle fallback for a saved hold preference", () => {
    actionHarness.settings = { ...actionHarness.settings, mode: "hold" };
    renderAction(makeSlotProps({ presentation: "mobile" }));

    const button = screen.getByRole("button", { name: "Start dictation" });
    expect(button.parentElement?.getAttribute("data-effective-mode")).toBe("toggle");
    expect(actionPropsSeen[0]?.onPointerDown).toBeUndefined();
    fireEvent.click(button);
    expect(actionHarness.start).toHaveBeenCalledOnce();
  });

  it("stops and releases capture on pointer cancellation and lost capture only once", () => {
    actionHarness.settings = { ...actionHarness.settings, mode: "hold" };
    renderAction(makeSlotProps());
    const button = screen.getByRole("button", { name: "Start dictation" }) as HTMLButtonElement & {
      setPointerCapture: ReturnType<typeof vi.fn>;
      releasePointerCapture: ReturnType<typeof vi.fn>;
      hasPointerCapture: ReturnType<typeof vi.fn>;
    };
    let captured = false;
    button.setPointerCapture = vi.fn(() => {
      captured = true;
    });
    button.hasPointerCapture = vi.fn(() => captured);
    button.releasePointerCapture = vi.fn(() => {
      captured = false;
    });

    const down = pointerEvent(button, "pointerdown", 12);
    expect(down.defaultPrevented).toBe(true);
    expect(button.setPointerCapture).toHaveBeenCalledWith(12);
    expect(actionHarness.start).toHaveBeenCalledOnce();

    pointerEvent(button, "pointercancel", 12);
    pointerEvent(button, "lostpointercapture", 12);
    expect(button.releasePointerCapture).toHaveBeenCalledOnce();
    expect(actionHarness.stop).toHaveBeenCalledOnce();
  });

  it("stops on pointerup and does not stop again when capture is then lost", () => {
    actionHarness.settings = { ...actionHarness.settings, mode: "hold" };
    renderAction(makeSlotProps());
    const button = screen.getByRole("button", { name: "Start dictation" }) as HTMLButtonElement & {
      setPointerCapture: ReturnType<typeof vi.fn>;
      releasePointerCapture: ReturnType<typeof vi.fn>;
      hasPointerCapture: ReturnType<typeof vi.fn>;
    };
    let captured = false;
    button.setPointerCapture = vi.fn(() => {
      captured = true;
    });
    button.hasPointerCapture = vi.fn(() => captured);
    button.releasePointerCapture = vi.fn(() => {
      captured = false;
    });

    pointerEvent(button, "pointerdown", 9);
    pointerEvent(button, "pointerup", 9);
    pointerEvent(button, "lostpointercapture", 9);

    expect(actionHarness.start).toHaveBeenCalledOnce();
    expect(actionHarness.stop).toHaveBeenCalledOnce();
    expect(button.releasePointerCapture).toHaveBeenCalledOnce();
  });

  it("preserves pointer cancellation on the legacy host fallback", () => {
    actionHarness.settings = { ...actionHarness.settings, mode: "hold" };
    renderAction(makeSlotProps(), false);
    const button = screen.getByRole("button", { name: "Start dictation" }) as HTMLButtonElement & {
      setPointerCapture: ReturnType<typeof vi.fn>;
      releasePointerCapture: ReturnType<typeof vi.fn>;
      hasPointerCapture: ReturnType<typeof vi.fn>;
    };
    let captured = false;
    button.setPointerCapture = vi.fn(() => {
      captured = true;
    });
    button.hasPointerCapture = vi.fn(() => captured);
    button.releasePointerCapture = vi.fn(() => {
      captured = false;
    });

    pointerEvent(button, "pointerdown", 21);
    pointerEvent(button, "pointercancel", 21);
    pointerEvent(button, "lostpointercapture", 21);

    expect(actionHarness.start).toHaveBeenCalledOnce();
    expect(actionHarness.stop).toHaveBeenCalledOnce();
    expect(button.releasePointerCapture).toHaveBeenCalledOnce();
  });

  it("keeps the complete busy label accessible when it grows", () => {
    actionHarness.snapshot = {
      state: "requesting",
      error: null,
      modelLoad: { state: "idle", progress: 0 },
    };
    renderAction(makeSlotProps());

    const button = screen.getByRole("button", { name: "Requesting microphone permission" });
    expect(button.getAttribute("aria-label")).toBe("Requesting microphone permission");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(actionPropsSeen[0]?.busy).toBe(true);
  });

  it("shows download progress and leaves a recording stop action enabled while busy", () => {
    actionHarness.snapshot = {
      state: "processing",
      error: null,
      modelLoad: { state: "loading", progress: 0.42 },
    };
    renderAction(makeSlotProps());

    const progress = screen.getByTestId("voice-plugin-model-load");
    expect(progress.getAttribute("aria-label")).toBe("Downloading Whisper Base");
    expect(screen.getByText("42%")).toBeTruthy();
    expect(actionPropsSeen[0]?.busy).toBe(true);
    expect(actionPropsSeen[0]?.disabled).toBe(true);

    act(() => actionHarness.setSnapshot({ state: "recording" }));
    const stop = screen.getByRole("button", { name: "Stop dictation" });
    expect(stop.getAttribute("aria-pressed")).toBe("true");
    expect(stop.getAttribute("data-tone")).toBe("danger");
    expect(stop.hasAttribute("disabled")).toBe(false);
    expect(actionPropsSeen.at(-1)?.busy).toBe(true);
  });

  it("cancels when disabled, then becomes usable again after re-enable", () => {
    const props = makeSlotProps();
    const view = renderAction(props);
    fireEvent.click(screen.getByRole("button", { name: "Start dictation" }));
    expect(screen.getByRole("button", { name: "Stop dictation" })).toBeTruthy();

    view.rerender(
      React.createElement(VoiceComposerAction, {
        slotProps: { ...props, disabled: true },
      }),
    );
    expect(actionHarness.cancel).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Start dictation" }).hasAttribute("disabled")).toBe(
      true,
    );

    view.rerender(React.createElement(VoiceComposerAction, { slotProps: props }));
    const enabled = screen.getByRole("button", { name: "Start dictation" });
    expect(enabled.hasAttribute("disabled")).toBe(false);
    fireEvent.click(enabled);
    expect(actionHarness.start).toHaveBeenCalledTimes(2);
  });

  it("releases a held pointer when the composer becomes disabled", () => {
    actionHarness.settings = { ...actionHarness.settings, mode: "hold" };
    const props = makeSlotProps();
    const view = renderAction(props);
    const button = screen.getByRole("button", { name: "Start dictation" }) as HTMLButtonElement & {
      setPointerCapture: ReturnType<typeof vi.fn>;
      releasePointerCapture: ReturnType<typeof vi.fn>;
      hasPointerCapture: ReturnType<typeof vi.fn>;
    };
    let captured = false;
    button.setPointerCapture = vi.fn(() => {
      captured = true;
    });
    button.hasPointerCapture = vi.fn(() => captured);
    button.releasePointerCapture = vi.fn(() => {
      captured = false;
    });
    pointerEvent(button, "pointerdown", 17);

    view.rerender(
      React.createElement(VoiceComposerAction, {
        slotProps: { ...props, disabled: true },
      }),
    );

    expect(actionHarness.cancel).toHaveBeenCalledOnce();
    expect(button.releasePointerCapture).toHaveBeenCalledOnce();
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("drops a late result from the previous session and fences deferred auto-send", () => {
    actionHarness.settings = { ...actionHarness.settings, autoSend: true };
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const oldComposer = makeSlotProps().composer;
    const newComposer = makeSlotProps().composer;
    const props = makeSlotProps({ composer: oldComposer });
    const view = renderAction(props);
    fireEvent.click(screen.getByRole("button", { name: "Start dictation" }));
    const lateDelivery = actionHarness.onTranscript;

    lateDelivery("fresh words");
    expect(oldComposer.insertText).toHaveBeenCalledWith("fresh words");
    expect(frames).toHaveLength(1);

    view.rerender(
      React.createElement(VoiceComposerAction, {
        slotProps: { ...props, activeSessionId: "session-2", composer: newComposer },
      }),
    );
    act(() => frames[0]?.(0));

    expect(newComposer.insertText).not.toHaveBeenCalled();
    expect(oldComposer.submit).not.toHaveBeenCalled();
    expect(newComposer.submit).not.toHaveBeenCalled();
  });

  it("keeps the unavailable action discoverable on both host paths", () => {
    actionHarness.supported = false;
    renderAction(makeSlotProps());
    expect(screen.getByRole("button", { name: "Dictation unavailable" })).toBeTruthy();
    expect(actionPropsSeen[0]?.["data-state"]).toBe("unsupported");

    cleanup();
    actionPropsSeen.length = 0;
    renderAction(makeSlotProps(), false);
    expect(screen.getByRole("button", { name: "Dictation unavailable" })).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
