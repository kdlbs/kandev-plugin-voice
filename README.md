# kandev-plugin-template

A starter template for building a [kandev](https://github.com/kdlbs/kandev)
**native-UI plugin** — its own git repo, packaged into a versioned tarball and
installed against a running kandev instance. Click **“Use this template”** on
GitHub (or copy this repo) to bootstrap your own plugin.

It is a small, complete, working example of everything a kandev plugin can do,
wired together so you can delete what you don't need rather than assemble it
from scratch:

- **Native nav item + route** — `ui/bundle.js` adds a sidebar entry that opens
  `/template`, a page rendered natively inside the kandev SPA (not an iframe)
  using the host's own React instance.
- **Chat toolbar action** — a component registered into the `chat-input-actions`
  slot renders an icon button in the chat composer toolbar, with the current
  `{ sessionId, taskId, taskTitle }` as `slotProps`.
- **Live WS-driven counter** — a `registerWsHandler("task.created", ...)`
  handler updates module state that the page re-renders from, live, with no
  reload.
- **Backend event handling with Host state** — `OnEvent` counts `task.created`
  deliveries in a persistent counter via the `Host.GetState`/`SetState` round
  trip, so restarts don't reset it.
- **Backend webhook** — `HandleWebhook` answers the `ping` webhook kandev
  proxies to the plugin, building its reply from the operator settings.
- **Operator settings (`config_schema`)** — a `greeting` string and a secret
  `api_token`, rendered as a form at **Settings > Plugins > Template Plugin**
  and read by the plugin process via `host.GetConfig(ctx)`. Secret fields are
  vault-stored and masked everywhere outside the plugin process.

## Make it yours

The plugin **id** appears in four places that must stay in sync. Rename all of
them from `kandev-plugin-template` to your own id (e.g. `kandev-plugin-acme`):

1. `manifest.yaml` — `id`, plus `display_name` / `description` / `author`.
2. `go.mod` — the `module` line.
3. `Makefile` — `BIN` and `PKG_OUT` (and `VERSION` to match the manifest).
4. `ui/bundle.js` — the id passed to `window.registerKandevPlugin(...)`.

Then trim the scaffolding: drop the webhook / event / config blocks in
`manifest.yaml` you don't use, delete the matching handlers in
`server/plugin.go`, and keep only the `registry.register*` calls in
`ui/bundle.js` your plugin actually contributes. Update `server/plugin_test.go`
to cover what remains.

## How a plugin runs (gRPC subprocess, not HTTP)

kandev spawns the platform-matching binary from `runtime.executables` in
`manifest.yaml` as a subprocess and talks to it over a private gRPC connection
([hashicorp/go-plugin](https://github.com/hashicorp/go-plugin)) — there is no
HTTP listen address, no shared secret, and no manual wiring: `pluginsdk.Serve`
in `server/main.go` owns the entire transport. You implement three RPCs and
get a `Host` handle back:

```go
type Plugin interface {
    OnEvent(ctx context.Context, e *Event) error
    HandleWebhook(ctx context.Context, req *WebhookRequest) (*WebhookResponse, error)
}
```

`server/plugin.go`'s `templatePlugin` embeds `pluginsdk.UnimplementedPlugin`
(a no-op default for both RPCs, plus `Host()`/`SetHost()` accessors) and
overrides what it needs. `server/main.go` is just
`pluginsdk.Serve(&templatePlugin{})`.

## Developing against the SDK

`pkg/pluginsdk` is not published as its own module yet, so `go.mod` here uses a
local `replace`:

```
replace github.com/kandev/kandev => ../kandev/apps/backend
```

This assumes your plugin repo is checked out as a **sibling** of the `kandev`
monorepo:

```
some-dir/
├── kandev/                   # https://github.com/kdlbs/kandev, Go module at apps/backend/
└── kandev-plugin-template/   # this repo
```

Note the module root is `kandev/apps/backend`, not the repo root — `kandev` is
a monorepo and the Go backend (including `pkg/pluginsdk`) lives one level down.
Adjust the `replace` path if your layout differs. Once `pkg/pluginsdk` ships as
a standalone, versioned module, this repo will drop the `replace` and pin a
real version instead.

## Layout

```
manifest.yaml          # plugin manifest — id, capabilities, runtime.executables, ui.bundle, config_schema
server/
  main.go              # pluginsdk.Serve wiring — no flags, no HTTP, no secrets
  plugin.go            # templatePlugin: OnEvent / InvokeTool / HandleWebhook
  plugin_test.go       # tests against a fake Host, no subprocess spawn needed
ui/
  bundle.js            # hand-written, no-build ES module — the plugin's frontend half
```

`ui/bundle.js` is hand-written, dependency-free ES module JavaScript. There is
no build step: it ships byte-for-byte inside the package tar.gz, and kandev
serves it directly. Edit the file and repackage — nothing else to run.

## Build and test

```sh
make build   # go build -o bin/... ./server/...
make test    # go test ./server/...
make vet     # go vet ./server/...
```

> Note: bare `go build ./server/...` (no `-o`) fails with `build output
> "server" already exists and is a directory` — Go's default output name for a
> lone main package is the last path element ("server"), which collides with
> the `server/` source directory. Always pass `-o`, run `go build .` from
> inside `server/`, or use `make build`. `go vet`/`go test` are unaffected.

## Package it

```sh
make package        # cross-compiles linux/darwin (amd64+arm64) + windows/amd64,
                    # then packs manifest + ui/ + binaries into a versioned .tar.gz

make package-host   # host platform only — faster local iteration
```

Both stage `manifest.yaml` + `ui/` alongside the freshly built
`server/plugin-<goos>-<goarch>[.exe]` binaries, then pack the tree with
`github.com/kandev/kandev/cmd/plugin-pack` (resolved through this repo's
`replace` directive), which computes `checksums.txt` and writes the tarball.

## Install it against a running kandev

Either through the UI (**Settings > Plugins > Install plugin**, URL or file
upload), or directly:

```sh
curl -F package=@kandev-plugin-template-0.1.0.tar.gz \
  http://localhost:<kandev-port>/api/plugins/install
```

kandev verifies `checksums.txt`, validates the manifest, extracts the package,
spawns the host-matching binary, and — once the go-plugin handshake completes —
marks the plugin active. Sideloaded plugins register **disabled/unverified**;
enable yours in **Settings > Plugins** (the `plugins` feature flag must be on).
Reinstalling the same version returns 409 — bump `version` in `manifest.yaml`.

## Publish a release

Pull requests run `.github/workflows/ci.yml` (tidy, format, vet, and test) and
`.github/workflows/build.yml` (host build plus a five-platform package). Push a
tag that matches the manifest version to run `.github/workflows/release.yml`:
it repeats verification, cross-compiles all platforms, packs the tarball, and
creates a GitHub Release with the two assets the kandev
[marketplace](https://github.com/kdlbs/kandev/blob/main/docs/public/plugins-marketplace.md)
install pipeline expects:

- `<id>-<version>.tar.gz` — the plugin package (with its own internal
  `checksums.txt` verified on install), and
- `checksums.txt` — the package's internal file checksums, extracted from the
  tarball for inspection and marketplace tooling.

```sh
# bump VERSION in Makefile + version in manifest.yaml first, then:
git tag v0.1.0
git push origin v0.1.0
```

The workflow checks out the kandev monorepo as a sibling so the `replace`
directive resolves (see "Developing against the SDK"); pin a kandev ref in the
workflow if you need reproducible SDK versions.

## License

MIT — see [LICENSE](LICENSE). This template is meant to be copied and made your
own; your resulting plugin can carry whatever license you choose.
