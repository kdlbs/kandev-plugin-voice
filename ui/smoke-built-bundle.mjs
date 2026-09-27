import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import React from "react";
import { act } from "react";

const uiRoot = path.dirname(fileURLToPath(import.meta.url));
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "https://voice-plugin.test/",
});
const { window } = dom;

Object.defineProperty(globalThis, "window", { configurable: true, value: window });
Object.defineProperty(globalThis, "document", { configurable: true, value: window.document });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: window.navigator });
Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: window.HTMLElement });
Object.defineProperty(globalThis, "Element", { configurable: true, value: window.Element });
Object.defineProperty(globalThis, "Event", { configurable: true, value: window.Event });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

window.matchMedia = (media) => ({
  matches: false,
  media,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent() {
    return false;
  },
});

const recognitions = [];
class FakeSpeechRecognition {
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onresult = null;
  onerror = null;
  onend = null;

  constructor() {
    recognitions.push(this);
  }

  start() {}
  abort() {}

  stop() {
    this.onend?.();
  }

  transcript(text) {
    this.onresult?.({
      resultIndex: 0,
      results: Object.assign([{ isFinal: true, 0: { transcript: text }, length: 1 }], { length: 1 }),
    });
  }
}
window.SpeechRecognition = FakeSpeechRecognition;

const { createRoot } = await import("react-dom/client");
const { default: userEvent } = await import("@testing-library/user-event");

const Action = (props) =>
  React.createElement(
    "button",
    {
      ref: props.ref,
      type: "button",
      "aria-label": props.label,
      "aria-pressed": props.pressed,
      "aria-busy": props.busy,
      disabled: props.disabled,
      title: props.tooltip,
      "data-state": props["data-state"],
      "data-testid": props["data-testid"],
      onClick: props.onClick,
      onPointerDown: props.onPointerDown,
      onPointerUp: props.onPointerUp,
      onPointerCancel: props.onPointerCancel,
      onLostPointerCapture: props.onLostPointerCapture,
    },
    props.icon,
  );

const Button = React.forwardRef((props, ref) =>
  React.createElement("button", { ...props, ref }),
);
const PassThrough = ({ children }) => React.createElement(React.Fragment, null, children);
const Progress = ({ value, className }) =>
  React.createElement("progress", { value, max: 100, className });

let registeredPluginId = "";
let registeredPlugin;
window.registerKandevPlugin = (id, plugin) => {
  registeredPluginId = id;
  registeredPlugin = plugin;
};

await import(`${pathToFileURL(path.join(uiRoot, "bundle.js")).href}?artifact-smoke`);
assert.equal(registeredPluginId, "kandev-plugin-voice");
assert.ok(registeredPlugin);

function hostFixture(withAction) {
  const saved = {
    enabled: true,
    engine: "webSpeech",
    language: "en-US",
    mode: "toggle",
    autoSend: false,
    whisperWebModel: "base",
  };
  const storageValues = new Map([["instance/global/voice-mode", saved]]);
  const toast = Object.assign(() => "toast", { error: () => "toast" });
  const ui = {
    Button,
    Tooltip: PassThrough,
    TooltipTrigger: PassThrough,
    TooltipContent: () => null,
    Progress,
  };
  if (withAction) ui.Action = Action;
  return {
    pluginId: "kandev-plugin-voice",
    React,
    jsx: React.createElement,
    store: { getState: () => ({}), subscribe: () => () => {} },
    api: {
      fetch: async () => new Response("{}", { status: 200 }),
      baseUrl: "https://voice-plugin.test",
    },
    ui,
    theme: "light",
    onThemeChange: () => () => {},
    navigate() {},
    toast,
    utils: { cn: (...values) => values.filter(Boolean).join(" ") },
    storage: {
      get: async (scope, scopeId, key) => {
        const value = storageValues.get(`${scope}/${scopeId}/${key}`);
        return value === undefined ? undefined : { key, value, updatedAt: "2026-09-27T00:00:00Z" };
      },
      set: async () => ({ updatedAt: "2026-09-27T00:00:00Z" }),
      delete: async () => {},
      list: async () => [],
      subscribe: () => () => {},
    },
  };
}

const surfaceCases = [
  ["chat-input-actions", "task-chat", "desktop"],
  ["chat-input-actions", "quick-chat", "mobile"],
  ["task-create-input-actions", "task-create", "desktop"],
  ["new-session-input-actions", "new-session", "mobile"],
];

for (const withAction of [true, false]) {
  for (const [slot, surface, presentation] of surfaceCases) {
    const components = new Map();
    const host = hostFixture(withAction);
    registeredPlugin.initialize(
      {
        registerComponent(name, component) {
          components.set(name, component);
        },
        registerKeybinding() {},
      },
      host,
    );

    const composer = {
      insertText: (text) => {
        composer.inserted.push(text);
        return { status: "inserted" };
      },
      focus: () => ({ status: "focused" }),
      submit: async () => ({ status: "submitted" }),
      inserted: [],
    };
    const slotProps = {
      surface,
      presentation,
      taskId: "task-fixture",
      activeSessionId: "session-fixture",
      sessionIds: ["session-fixture"],
      disabled: false,
      submittable: true,
      composer,
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const user = userEvent.setup();

    await act(async () => {
      root.render(React.createElement(components.get(slot), { slotProps }));
    });

    const button = container.querySelector('[data-testid="voice-plugin-button"]');
    assert.ok(button, `${surface} renders an action`);
    assert.equal(button.type, "button");
    button.focus();
    assert.equal(document.activeElement, button);

    await act(async () => {
      await user.keyboard("{Enter}");
    });
    assert.equal(button.getAttribute("aria-label"), "Stop dictation");
    assert.equal(button.getAttribute("aria-pressed"), "true");

    const recognition = recognitions.at(-1);
    assert.ok(recognition);
    await act(async () => {
      recognition.transcript(`fixture transcript for ${surface}`);
      await user.keyboard("{Enter}");
    });
    assert.deepEqual(composer.inserted, [`fixture transcript for ${surface}`]);

    await act(async () => root.unmount());
    container.remove();
    registeredPlugin.destroy();
  }
}

window.close();
console.log("built bundle smoke passed on all four composer surfaces and both host paths");
