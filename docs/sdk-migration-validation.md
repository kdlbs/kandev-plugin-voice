# Public SDK migration validation — 2026-11-08

Work started on 2026-11-05 from the current default branch `main` at
`df33a474b6e04db427f04317797a87e835ad80c4`. There was no plugin `AGENTS.md`
in the checkout or on default branch. Followed the parent repository's
[create-kandev-plugin workflow](https://github.com/kdlbs/kandev/blob/pluginsdk/v0.1.0/.agents/skills/create-kandev-plugin/SKILL.md),
[public authoring guide](https://github.com/kdlbs/kandev/blob/pluginsdk/v0.1.0/docs/public/plugins-authoring.md),
and [approved migration handoff](https://github.com/kdlbs/kandev/blob/pluginsdk/v0.1.0/docs/plans/plugin-sdk-publishing/template-migration.md).

The [verified SDK release](https://github.com/kdlbs/kandev/releases/tag/pluginsdk/v0.1.0)
comes from `f0e2e774cfe2df8a0d15e4c21dea7b48580e38fb`. Both installed release
records declare SDK `0.1.0`, `host_release: 0.99.0`,
`min_kandev_version: 0.99.0` and `api_versions: [1,2]`. The plugin retains
version `0.2.0`, API 1, its declared UI/keybinding/webhook/user-state surfaces,
and all five full-package platforms. Source builds now require `v0.99.0`.
Previously released binaries and their manifests are not modified.

## Standalone source validation

A separate clone at `/tmp/voice-sdk-migration/standalone/voice` has no sibling
`kandev` directory and no workspace/module/TypeScript substitution. Packaging
sources live separately at `/tmp/voice-sdk-migration/tooling`; they do not
supply the plugin's SDK dependencies. Go is `go1.26.6 linux/amd64`, Node is
`v24.19.0`, and the plugin uses pnpm `10.34.5`.

Exact commands run from the standalone clone:

```bash
export GOWORK=off
export GOPROXY=https://proxy.golang.org
export GOSUMDB=sum.golang.org
export GOMODCACHE=/tmp/voice-sdk-migration/standalone/go-mod-cache
go mod tidy
git diff --exit-code -- go.mod go.sum
go mod verify
go list -m all
corepack pnpm@10.34.5 --dir ui install --frozen-lockfile --ignore-scripts
make sdk-check check-format vet test typecheck build PNPM='corepack pnpm@10.34.5'
```

Passed: tidy leaves dependency files unchanged; all modules verified; frozen
frontend install succeeds without install scripts. The module graph has 63
entries and its only Kandev module is
`github.com/kdlbs/kandev/pluginsdk v0.1.0`; it has no backend module or SDK
replacement. `go.sum` records SDK digest
`h1:Pov5zE2gGf53FslhpcoGgx6E3nu6kjizT69x3MlEEEs=`. The generated pnpm lock
pins `@kdlbs/plugin-sdk` at exactly `0.1.0` with public registry integrity.

The Make invocation runs the actual commands `go vet ./server/...`,
`go test ./server/...`, `vitest run`, `tsc --noEmit`, `node build.mjs`,
`node ui/smoke-built-bundle.mjs`, both shell verifier test suites, and
`go build -o bin/kandev-plugin-voice ./server/...`. All passed: 7 frontend
files / 75 tests, bundle smoke on all four composer surfaces with modern and
legacy host adapters, and package/release verifier regression cases.
There are no recipe subprojects or recipe commands in this repository.

The compatibility target runs from `ui`, beside its pnpm dependency evidence:

```bash
cd ui
go run github.com/kdlbs/kandev/pluginsdk/cmd/kandev-sdk-check@v0.1.0 \
  --manifest ../manifest.yaml --frontend-sdk node_modules/@kdlbs/plugin-sdk
```

Passed for both installed SDK records: `SDK 0.1.0: compatible (minimum Kandev 0.99.0)`.

## Packaging

The backend-owned packager remains a separate, explicit source input at
`.kandev-tooling-ref` = `f0e2e774cfe2df8a0d15e4c21dea7b48580e38fb`.
Its module needs the root `pluginsdk/` directory; this local replacement is
inside the packaging tool's module, not the plugin's module. SDK compilation
is independent of this checkout; packaging still requires it.

```bash
make verify-package-host KANDEV_TOOLING=/tmp/voice-sdk-migration/tooling/apps/backend \
  PNPM='corepack pnpm@10.34.5'
sh scripts/verify-release-version.sh v0.2.0 kandev-plugin-voice-0.2.0.tar.gz
CGO_ENABLED=0 make verify-package KANDEV_TOOLING=/tmp/voice-sdk-migration/tooling/apps/backend \
  PNPM='corepack pnpm@10.34.5'
sh scripts/verify-release-version.sh v0.2.0 kandev-plugin-voice-0.2.0.tar.gz
tar -tzf kandev-plugin-voice-0.2.0.tar.gz
sha256sum kandev-plugin-voice-0.2.0.tar.gz
```

Both package modes passed exact file inventory, declared executables and every
internal SHA-256 checksum. Host-only mode contains six files: manifest, Linux
amd64 binary, UI bundle, worker, CSS and checksums. Full mode contains ten
files, including Linux amd64/arm64, Darwin amd64/arm64 and Windows amd64 binaries.
No dependency trees, source tests, SDK sources or development files enter either archive.

Recorded artifact SHA-256 values (local artifacts, not published releases):

- Host-only: `681d3a2c1041f65b7ce639e4349071bfaf6f22a369053f905e051bd3cba6fbcd`.
- Full: `c639c98b429a30e23f8dc6499dd54e9a13dd41badf6d6e1a0d5dde44f6edc185`.

The first host-package verification exposed the current packager's manifest
rewrite: host-only declarations, four-space YAML indentation and unquoted
scalars. Regression fixtures failed before adapting the plugin's inventory
and release checks; they now pass. Full packages still require all five
platforms; host-only packages must declare exactly their packaged platform.
The first full local build inherited `CGO_ENABLED=1` and failed at the ARM64 C
assembler. The explicit `CGO_ENABLED=0` invocation above passed all five builds.

## Minimum-host smoke

Runtime: official Kandev `v0.99.0` Linux x64 release archive, source
`f0e2e774cfe2df8a0d15e4c21dea7b48580e38fb`.
`sha256sum -c kandev-linux-x64.tar.gz.sha256` passed; archive SHA-256:
`a60656b3dbce2c663965270b22b81301e568ab39c9906f331280b4eda84294bb`.
The extracted runtime reports `v0.99.0` with `--version`.

Browser validation completed on 2026-11-08. The full archive above passed
**16 tests, with two expected phone-only skips**, in 3.2 minutes. Both desktop
and Pixel 5 contexts verified `/health` reports exactly `v0.99.0`. The two
skips cover mouse pointer capture and hardware keyboard shortcuts on phones.

The suite exercised install, all four composer surfaces, focused shortcut
routing, pointer capture/cancellation, busy/download/permission states,
microphone cleanup and re-enable behavior. A real SDK subprocess relayed
multipart audio through the host to a local fake transcription provider;
config restart, masked secret reads and user-state persistence across
lifecycle restart passed in both browser contexts. The settings-page extension
then passed a focused rerun: **4 passed in 15.3 seconds**, including both host
version checks and both settings/relay cases. The settings cases mounted the
native plugin settings surface, toggled its enable switch twice, and confirmed
the persisted values through the host API.

Setup used the matching release checkout's pnpm `9.15.9`, `build:e2e`,
`build-mock-agent`, `build-e2e-delivery-fixture`, `build-e2e-send-now-fixture`,
`e2e-plugin-package`, and Chromium install. The interrupted fixture build was
resumed successfully with:

```bash
PATH=/tmp/voice-sdk-migration/bin:$PATH make -C /tmp/voice-sdk-migration/tooling/apps/backend \
  build-e2e-send-now-fixture e2e-plugin-package
```

The smoke wrapper used the following exact child environment. On this Nix
executor, `browser-libs.env` sets `LD_LIBRARY_PATH` to the installed Playwright
compatibility, libxcb and systemd library directories. The wrapper does not
modify the parent environment or any shared host instance.

```sh
#!/bin/sh
set -eu
. /tmp/voice-sdk-migration/browser-libs.env
VOICE_SMOKE_ROOT=/tmp/voice-sdk-migration/minimum-host-smoke
mkdir -p "$VOICE_SMOKE_ROOT/home" "$VOICE_SMOKE_ROOT/config" "$VOICE_SMOKE_ROOT/data" "$VOICE_SMOKE_ROOT/cache" "$VOICE_SMOKE_ROOT/tmp"
exec env -i \
  PATH=/tmp/voice-sdk-migration/bin:/run/current-system/sw/bin \
  HOME="$VOICE_SMOKE_ROOT/home" \
  XDG_CONFIG_HOME="$VOICE_SMOKE_ROOT/config" \
  XDG_DATA_HOME="$VOICE_SMOKE_ROOT/data" \
  XDG_CACHE_HOME="$VOICE_SMOKE_ROOT/cache" \
  TMPDIR="$VOICE_SMOKE_ROOT/tmp" \
  LANG=C.UTF-8 \
  NIX_LD_LIBRARY_PATH=/run/current-system/sw/share/nix-ld/lib \
  LD_LIBRARY_PATH="$LD_LIBRARY_PATH" \
  PLAYWRIGHT_BROWSERS_PATH=/home/zeval/.cache/ms-playwright \
  KANDEV_HOST_ROOT=/tmp/voice-sdk-migration/tooling \
  KANDEV_E2E_BIN=/tmp/voice-sdk-migration/runtime/kandev/bin/kandev \
  KANDEV_SERVER_HOST=127.0.0.1 \
  VOICE_TMPDIR="$VOICE_SMOKE_ROOT/tmp" \
  VOICE_PACKAGE_PATH=/tmp/voice-sdk-migration/standalone/voice/kandev-plugin-voice-0.2.0.tar.gz \
  VOICE_EXPECT_HOST_VERSION=v0.99.0 \
  VOICE_HOST_VARIANT=modern \
  /tmp/voice-sdk-migration/standalone/voice/ui/e2e/run-host-smoke.sh "$@"
```

Executed commands and results:

```bash
/tmp/voice-sdk-migration/run-min-host.sh
# 16 passed, 2 expected skips (3.2m)
/tmp/voice-sdk-migration/run-min-host.sh --grep 'relays transcription|reports the expected host version'
# 4 passed (15.3s), including the added native settings controls
```

The running child process was also inspected: HOME and KANDEV_HOME_DIR were
fixture-owned paths, XDG paths were under the task-owned smoke directory,
KANDEV_SERVER_HOST was `127.0.0.1`, and KANDEV_BUNDLE_DIR/KANDEV_VERSION were
unset. Runtime identity was established by the actual `/health` checks.

No live provider credentials/audio or external transcription service were used.
These are local auth-disabled host fixtures with synthetic caller identity;
they do not certify an auth-enabled deployment's anonymous-caller policy.
Non-Linux platforms were cross-compiled and packaged, not executed. Historical
below-floor host fixtures were not rerun as minimum-host coverage.

## PR checks

[PR #9](https://github.com/kdlbs/kandev-plugin-voice/pull/9) targets the actual
default branch `main`. Before the final evidence push, both CI jobs passed on
`adbb20f358a80f573d710da8e2e437547d27c3ca`:
[package build](https://github.com/kdlbs/kandev-plugin-voice/actions/runs/42102327160)
and [tests/vet/typecheck](https://github.com/kdlbs/kandev-plugin-voice/actions/runs/42102327277).
The final pushed head is checked separately before declaring readiness.

Workflow syntax validation also passed:

```bash
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7 -color \
  .github/workflows/ci.yml .github/workflows/build.yml .github/workflows/release.yml
```

No SDK or plugin releases, version tags, marketplace/catalog changes, author
notifications, or merges were performed.
