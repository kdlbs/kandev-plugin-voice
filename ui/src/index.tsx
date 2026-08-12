/**
 * kandev Voice Mode — plugin entry point.
 *
 * Registers one composer action for each of the four native prompt composers,
 * a settings surface, and the dictation keyboard shortcut. Everything else is
 * host-owned: kandev keeps ownership of the draft, of submission, and of the
 * shortcut registry.
 */
import { PLUGIN_ID, setHost, clearHost, type PluginHostApi, type PluginRegistry } from "./host";
import { VoiceComposerAction } from "./composer-action";
import { VoiceSettingsPage } from "./settings-page";
import { toggleFocusedAction, resetActions } from "./active-action";
import { loadSettings, resetSettingsStore, startSettingsSync } from "./settings";
import { resetRelayProbe } from "./use-dictation";

/**
 * The composer slots kandev renders. `chat-input-actions` covers task chat and
 * Quick Chat; the creation forms have their own slots because their
 * identifiers and submit lifecycles differ.
 */
const COMPOSER_SLOTS = [
  "chat-input-actions",
  "task-create-input-actions",
  "new-session-input-actions",
] as const;

/** Must match the `ui.keybindings[].id` in manifest.yaml. */
const TOGGLE_KEYBINDING_ID = "toggle-dictation";

export const plugin = {
  initialize(registry: PluginRegistry, host: PluginHostApi): void {
    setHost(host);

    for (const slot of COMPOSER_SLOTS) {
      registry.registerComponent(slot, VoiceComposerAction);
    }
    // The owner-scoped `plugin-settings` slot, not a settings route: kandev
    // renders it inline at the top of this plugin's own page
    // (Settings > Plugins > Voice Mode), right above the operator config form
    // that holds the OpenAI key. A route would have to invent a URL and would
    // sit somewhere the user has no reason to look.
    registry.registerComponent("plugin-settings", VoiceSettingsPage);
    registry.registerKeybinding(TOGGLE_KEYBINDING_ID, (event) => {
      // Only claim the keypress when a composer actually took it. Returning
      // without acting lets whatever else is bound to the combo run.
      if (toggleFocusedAction()) event.preventDefault();
    });

    // Warm the cache and follow other tabs. Both are best-effort: a failure
    // leaves the defaults in place rather than hiding the button.
    void loadSettings();
    startSettingsSync();
  },

  destroy(): void {
    // kandev revokes the registrations itself; this clears the module state
    // those registrations closed over, so a disable/enable cycle in the same
    // tab starts clean rather than replaying a stale host or settings cache.
    resetActions();
    resetSettingsStore();
    resetRelayProbe();
    clearHost();
  },
};

declare global {
  interface Window {
    registerKandevPlugin?: (id: string, plugin: unknown) => void;
  }
}

window.registerKandevPlugin?.(PLUGIN_ID, plugin);

export default plugin;
