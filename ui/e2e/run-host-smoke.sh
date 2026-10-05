#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PLUGIN_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
TASK_TMPDIR=${VOICE_TMPDIR:-"${HOME:-/tmp}/.cache/kandev-plugin-voice-e2e"}
VARIANT=${VOICE_HOST_VARIANT:-modern}

case "$VARIANT" in
  modern)
    HOST_ROOT=${KANDEV_HOST_ROOT:-"$PLUGIN_ROOT/../kandev"}
    EXPECT_ACTION_API=action
    ;;
  legacy)
    HOST_ROOT=${KANDEV_HOST_ROOT:-"$PLUGIN_ROOT/../kandev-fallback-088"}
    EXPECT_ACTION_API=legacy
    ;;
  below-minimum)
    HOST_ROOT=${KANDEV_HOST_ROOT:-"$PLUGIN_ROOT/../kandev-min"}
    EXPECT_ACTION_API=below-minimum
    ;;
  below-minimum-0871)
    HOST_ROOT=${KANDEV_HOST_ROOT:-"$PLUGIN_ROOT/../kandev-fallback"}
    EXPECT_ACTION_API=below-minimum
    ;;
  *)
    echo "VOICE_HOST_VARIANT must be modern, legacy, below-minimum, or below-minimum-0871" >&2
    exit 2
    ;;
esac

PACKAGE_PATH=${VOICE_PACKAGE_PATH:-"$PLUGIN_ROOT/kandev-plugin-voice-0.1.1.tar.gz"}
HOST_BACKEND=${KANDEV_E2E_BIN:-"$HOST_ROOT/apps/backend/bin/kandev"}
if [ ! -x "$HOST_BACKEND" ]; then
  echo "Missing host backend: $HOST_BACKEND" >&2
  exit 2
fi
if [ ! -f "$HOST_ROOT/apps/web/dist/index.html" ]; then
  echo "Missing host web build: $HOST_ROOT/apps/web/dist/index.html" >&2
  exit 2
fi
if [ ! -f "$PACKAGE_PATH" ]; then
  echo "Missing Voice package: $PACKAGE_PATH" >&2
  exit 2
fi
if [ -n "${KANDEV_E2E_BIN:-}" ]; then
  HOST_MOCK_AGENT="$HOST_ROOT/apps/backend/bin/mock-agent"
  RUNTIME_MOCK_AGENT="$(dirname -- "$KANDEV_E2E_BIN")/mock-agent"
  if [ ! -x "$HOST_MOCK_AGENT" ]; then
    echo "Missing E2E mock-agent fixture: $HOST_MOCK_AGENT (run make -C $HOST_ROOT/apps/backend build-mock-agent)" >&2
    exit 2
  fi
  if [ ! -x "$RUNTIME_MOCK_AGENT" ] || ! cmp -s "$HOST_MOCK_AGENT" "$RUNTIME_MOCK_AGENT"; then
    cp "$HOST_MOCK_AGENT" "$RUNTIME_MOCK_AGENT"
    chmod 0755 "$RUNTIME_MOCK_AGENT"
  fi
  export KANDEV_E2E_SKIP_FRESHNESS=${KANDEV_E2E_SKIP_FRESHNESS:-1}
fi

export KANDEV_HOST_ROOT="$HOST_ROOT"
export VOICE_HOST_VARIANT="$VARIANT"
export VOICE_EXPECT_ACTION_API="$EXPECT_ACTION_API"
export VOICE_PACKAGE_PATH="$PACKAGE_PATH"
mkdir -p "$TASK_TMPDIR"
export TMPDIR=${TMPDIR:-"$TASK_TMPDIR"}
export PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH:-"$TASK_TMPDIR/browsers"}
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--import=$PLUGIN_ROOT/ui/e2e/host-path-aliases.mjs"

cd "$HOST_ROOT/apps/web"
pnpm exec playwright test \
  --config="$PLUGIN_ROOT/ui/e2e/playwright.config.mjs" \
  --project=chromium \
  --project=mobile-chrome \
  "$@"
