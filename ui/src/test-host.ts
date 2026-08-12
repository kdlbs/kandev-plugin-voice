import { vi } from "vitest";
import { setHost, type PluginHostApi } from "./host";

export type FakeStorage = {
  values: Map<string, unknown>;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  /** Delivers a change as if another tab had written it. */
  emit: (change: { key: string; value?: unknown; deleted?: boolean }) => void;
};

export type FakeHost = PluginHostApi & {
  storage: FakeStorage;
  fetchMock: ReturnType<typeof vi.fn>;
  toasts: Array<{ level: string; message: string }>;
};

function storageKey(scope: string, scopeId: string, key: string): string {
  return `${scope}/${scopeId}/${key}`;
}

export function installFakeHost(overrides: Partial<PluginHostApi> = {}): FakeHost {
  const values = new Map<string, unknown>();
  const subscribers: Array<(change: Record<string, unknown>) => void> = [];
  const toasts: Array<{ level: string; message: string }> = [];

  const storage = {
    values,
    get: vi.fn(async (scope: string, scopeId: string, key: string) => {
      const composite = storageKey(scope, scopeId, key);
      if (!values.has(composite)) return undefined;
      return { key, value: values.get(composite), updatedAt: "2026-08-12T00:00:00Z" };
    }),
    set: vi.fn(async (scope: string, scopeId: string, key: string, value: unknown) => {
      values.set(storageKey(scope, scopeId, key), value);
      return { updatedAt: "2026-08-12T00:00:00Z" };
    }),
    delete: vi.fn(async (scope: string, scopeId: string, key: string) => {
      values.delete(storageKey(scope, scopeId, key));
    }),
    list: vi.fn(async () => []),
    subscribe: vi.fn((_filter: unknown, handler: (change: Record<string, unknown>) => void) => {
      subscribers.push(handler);
      return () => {
        const index = subscribers.indexOf(handler);
        if (index >= 0) subscribers.splice(index, 1);
      };
    }),
    emit: (change: { key: string; value?: unknown; deleted?: boolean }) => {
      for (const handler of [...subscribers]) {
        handler({ scope: "instance", scopeId: "", ...change });
      }
    },
  } as unknown as FakeStorage;

  const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));

  const toast = Object.assign(
    (message: string) => {
      toasts.push({ level: "default", message });
      return 1;
    },
    {
      success: (message: string) => (toasts.push({ level: "success", message }), 1),
      error: (message: string) => (toasts.push({ level: "error", message }), 1),
      warning: (message: string) => (toasts.push({ level: "warning", message }), 1),
      info: (message: string) => (toasts.push({ level: "info", message }), 1),
    },
  ) as unknown as PluginHostApi["toast"];

  const host = {
    pluginId: "kandev-plugin-voice",
    React: { createElement: vi.fn(), Fragment: Symbol("Fragment") },
    jsx: vi.fn(),
    store: { getState: () => ({}), subscribe: () => () => {} },
    api: { fetch: fetchMock, baseUrl: "" },
    ui: {},
    theme: "light" as const,
    onThemeChange: () => () => {},
    navigate: vi.fn(),
    toast,
    utils: { cn: (...inputs: unknown[]) => inputs.filter(Boolean).join(" ") },
    storage,
    ...overrides,
  } as unknown as FakeHost;

  host.fetchMock = fetchMock;
  host.toasts = toasts;
  setHost(host);
  return host;
}
