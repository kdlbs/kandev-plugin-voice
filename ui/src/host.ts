/**
 * The host handle, plus the slice of kandev's plugin contract this bundle
 * uses. The types mirror `apps/web/lib/plugins/types.ts` — kandev does not
 * publish them as a package yet, so they are restated here and must be kept
 * in step with `docs/plans/plugins/PLUGIN-API.md`.
 */

export const PLUGIN_ID = "kandev-plugin-voice";

export type PluginComposerSurface = "task-chat" | "quick-chat" | "task-create" | "new-session";
export type PluginPresentation = "desktop" | "mobile";

export type PluginComposerSubmitResult =
  | { status: "submitted" }
  | { status: "blocked"; reason?: string }
  | { status: "unavailable" };

export interface PluginComposerCapability {
  insertText(text: string): { status: "inserted" | "ignored" | "unavailable" };
  focus(): { status: "focused" | "unavailable" };
  submit(): Promise<PluginComposerSubmitResult>;
}

export interface PluginComposerSlotProps {
  surface: PluginComposerSurface;
  presentation: PluginPresentation;
  taskId: string | null;
  taskTitle?: string;
  activeSessionId: string | null;
  sessionIds: string[];
  disabled: boolean;
  submittable: boolean;
  disabledReason?: string;
  composer: PluginComposerCapability;
}

export type PluginStorageScope = "instance" | "workspace" | "task" | "session" | "repository";

export interface PluginStorageEntry {
  key: string;
  value: unknown;
  updatedAt: string;
}

export interface PluginStorageApi {
  get(scope: PluginStorageScope, scopeId: string, key: string): Promise<PluginStorageEntry | undefined>;
  set(
    scope: PluginStorageScope,
    scopeId: string,
    key: string,
    value: unknown,
    options?: { ifUnmodifiedSince?: string; writerId?: string },
  ): Promise<{ updatedAt: string }>;
  delete(scope: PluginStorageScope, scopeId: string, key: string): Promise<void>;
  list(scope: PluginStorageScope, scopeId: string): Promise<PluginStorageEntry[]>;
  subscribe(
    filter: { scope?: PluginStorageScope; scopeId?: string; key?: string; writerId?: string },
    handler: (change: { scope: string; scopeId: string; key: string; value?: unknown; deleted?: boolean }) => void,
  ): () => void;
}

export interface PluginToastApi {
  (message: string, options?: Record<string, unknown>): string | number;
  success(message: string, options?: Record<string, unknown>): string | number;
  error(message: string, options?: Record<string, unknown>): string | number;
  warning(message: string, options?: Record<string, unknown>): string | number;
  info(message: string, options?: Record<string, unknown>): string | number;
}

export interface PluginHostApi {
  pluginId: string;
  React: Record<string, unknown> & { createElement: unknown; Fragment: unknown };
  jsx: unknown;
  store: { getState(): unknown; subscribe(listener: () => void): () => void };
  api: { fetch(path: string, init?: RequestInit): Promise<Response>; baseUrl: string };
  ui: Record<string, unknown>;
  readonly theme: "light" | "dark";
  onThemeChange(listener: (theme: "light" | "dark") => void): () => void;
  navigate(href: string, options?: { replace?: boolean }): void;
  toast: PluginToastApi;
  utils: { cn(...inputs: unknown[]): string };
  storage: PluginStorageApi;
}

export interface PluginRegistry {
  registerComponent(slot: string, Component: unknown): void;
  registerSettingsRoute(path: string, Component: unknown): void;
  registerKeybinding(id: string, handler: (event: KeyboardEvent) => void): void;
}

let current: PluginHostApi | null = null;

export function setHost(host: PluginHostApi): void {
  current = host;
}

export function clearHost(): void {
  current = null;
}

export function host(): PluginHostApi {
  if (!current) {
    throw new Error(`${PLUGIN_ID}: host API used before initialize()`);
  }
  return current;
}

/** Non-throwing variant for teardown paths that may run after `destroy`. */
export function maybeHost(): PluginHostApi | null {
  return current;
}

export function hostReact(): PluginHostApi["React"] {
  return host().React;
}

/**
 * Absolute URL of a file shipped inside the installed package. kandev serves
 * package-relative paths under /api/plugins/{id}/ui/*, so a file the manifest
 * calls "/ui/x.js" is requested at ".../ui/ui/x.js".
 */
export function assetUrl(packagePath: string): string {
  const base = host().api.baseUrl || "";
  const normalized = packagePath.startsWith("/") ? packagePath : `/${packagePath}`;
  return `${base}/api/plugins/${PLUGIN_ID}/ui${normalized}`;
}
