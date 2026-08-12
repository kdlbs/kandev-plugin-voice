/**
 * Routes the dictation keyboard shortcut to one composer.
 *
 * Several composers can be mounted at once (a task chat behind an open
 * task-create dialog, Quick Chat beside a session). The shortcut has to reach
 * the one the user is actually looking at, which is the one whose composer
 * holds focus. When nothing composer-like has focus we fall back to the most
 * recently mounted action, so the shortcut still works right after a dialog
 * opens and before the user has clicked into the field.
 */

export type RegisteredAction = {
  /** The element the action renders into, used to test focus containment. */
  element: HTMLElement | null;
  /** False while the action is disabled or its engine is unavailable. */
  usable: () => boolean;
  toggle: () => void;
};

const actions: RegisteredAction[] = [];

export function registerAction(action: RegisteredAction): () => void {
  actions.push(action);
  return () => {
    const index = actions.indexOf(action);
    if (index >= 0) actions.splice(index, 1);
  };
}

export function resetActions(): void {
  actions.length = 0;
}

/**
 * How many ancestors above `element` you must climb before reaching one that
 * also contains `target`. Infinity when they share no ancestor. This is a
 * DOM-generic proximity measure on purpose: keying off kandev's own class
 * names or wrapper markup would break the shortcut the next time the composer
 * is restyled.
 */
function ancestorDistance(element: HTMLElement | null, target: Element): number {
  let node: HTMLElement | null = element;
  let distance = 0;
  while (node) {
    if (node.contains(target)) return distance;
    node = node.parentElement;
    distance++;
  }
  return Number.POSITIVE_INFINITY;
}

/** Exposed for tests; production code goes through `toggleFocusedAction`. */
export function selectTargetAction(activeElement: Element | null): RegisteredAction | null {
  const usable = actions.filter((action) => action.usable());
  if (usable.length === 0) return null;

  if (activeElement) {
    let best: RegisteredAction | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    // Iterate newest-first so the most recently mounted composer wins a tie,
    // which is what an opening dialog should do to the page behind it.
    for (let i = usable.length - 1; i >= 0; i--) {
      const candidate = usable[i];
      if (!candidate) continue;
      const distance = ancestorDistance(candidate.element, activeElement);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    if (best) return best;
  }
  return usable[usable.length - 1] ?? null;
}

export function toggleFocusedAction(): boolean {
  const active = typeof document === "undefined" ? null : document.activeElement;
  const target = selectTargetAction(active);
  if (!target) return false;
  target.toggle();
  return true;
}
