import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerAction, resetActions, selectTargetAction, toggleFocusedAction } from "./active-action";

function mountAction(options: { usable?: boolean } = {}) {
  const container = document.createElement("div");
  const input = document.createElement("input");
  container.appendChild(input);
  document.body.appendChild(container);
  const toggle = vi.fn();
  const unregister = registerAction({
    element: container,
    usable: () => options.usable !== false,
    toggle,
  });
  return { container, input, toggle, unregister };
}

beforeEach(() => {
  resetActions();
  document.body.innerHTML = "";
});

describe("selectTargetAction", () => {
  it("returns nothing when no composer is mounted", () => {
    expect(selectTargetAction(null)).toBeNull();
  });

  it("skips an action whose composer is disabled", () => {
    mountAction({ usable: false });

    expect(selectTargetAction(null)).toBeNull();
  });

  it("targets the composer that holds focus, not the most recent one", () => {
    const first = mountAction();
    mountAction();

    const target = selectTargetAction(first.input);

    expect(target?.toggle).toBe(first.toggle);
  });

  it("falls back to the most recently mounted composer when focus is elsewhere", () => {
    mountAction();
    const second = mountAction();
    const unrelated = document.createElement("button");
    document.body.appendChild(unrelated);

    const target = selectTargetAction(unrelated);

    expect(target?.toggle).toBe(second.toggle);
  });

  it("prefers the nearest enclosing composer when one is nested inside another", () => {
    const outer = mountAction();
    const innerContainer = document.createElement("div");
    const innerInput = document.createElement("input");
    innerContainer.appendChild(innerInput);
    outer.container.appendChild(innerContainer);
    const innerToggle = vi.fn();
    registerAction({ element: innerContainer, usable: () => true, toggle: innerToggle });

    expect(selectTargetAction(innerInput)?.toggle).toBe(innerToggle);
  });
});

describe("toggleFocusedAction", () => {
  it("toggles the focused composer and reports that it claimed the keypress", () => {
    const action = mountAction();
    action.input.focus();

    expect(toggleFocusedAction()).toBe(true);
    expect(action.toggle).toHaveBeenCalledTimes(1);
  });

  it("declines the keypress when no composer can take it", () => {
    expect(toggleFocusedAction()).toBe(false);
  });

  it("stops targeting an unmounted composer", () => {
    const action = mountAction();
    action.unregister();

    expect(toggleFocusedAction()).toBe(false);
    expect(action.toggle).not.toHaveBeenCalled();
  });
});
