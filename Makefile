.PHONY: build ui ui-install test test-go test-ui smoke-bundle test-package-verifier test-release-version typecheck fmt check-format vet package package-host verify-package verify-package-host package-file clean

BIN := bin/kandev-plugin-voice
VERSION := 0.1.0
STAGE := .build/stage
PKG_OUT := kandev-plugin-voice-$(VERSION).tar.gz
KANDEV_SDK := ../kandev/apps/backend
PNPM ?= pnpm

## Build the plugin binary for the host platform (development use). kandev
## installs from `make package`/`package-host` output, not this.
build:
	mkdir -p bin
	go build -o $(BIN) ./server/...

## Install the UI toolchain. Needed once before `make ui`.
ui-install:
	cd ui && $(PNPM) install --frozen-lockfile

## Build ui/bundle.js and ui/whisper-worker.js with esbuild.
ui:
	cd ui && node build.mjs

test: test-go test-ui smoke-bundle test-package-verifier test-release-version

test-go:
	go test ./server/...

test-ui:
	cd ui && $(PNPM) exec vitest run

smoke-bundle: ui
	node ui/smoke-built-bundle.mjs

test-package-verifier:
	sh scripts/test-verify-package.sh

test-release-version:
	sh scripts/test-verify-release-version.sh

typecheck:
	cd ui && $(PNPM) exec tsc --noEmit

fmt:
	gofmt -l .

check-format:
	@test -z "$$(gofmt -l .)" || { echo "gofmt needed:"; gofmt -l .; exit 1; }

vet:
	go vet ./server/...

## Stage manifest + built UI assets + server binaries, then pack with the
## kandev plugin-pack CLI (resolved through this repo's go.mod `replace`).
define stage_common
	rm -rf $(STAGE)
	mkdir -p $(STAGE)/server $(STAGE)/ui
	cp manifest.yaml $(STAGE)/manifest.yaml
	cp ui/bundle.js ui/whisper-worker.js ui/plugin.css $(STAGE)/ui/
endef

package: ui
	$(stage_common)
	GOOS=linux   GOARCH=amd64 go build -o $(STAGE)/server/plugin-linux-amd64       ./server
	GOOS=linux   GOARCH=arm64 go build -o $(STAGE)/server/plugin-linux-arm64       ./server
	GOOS=darwin  GOARCH=amd64 go build -o $(STAGE)/server/plugin-darwin-amd64      ./server
	GOOS=darwin  GOARCH=arm64 go build -o $(STAGE)/server/plugin-darwin-arm64      ./server
	GOOS=windows GOARCH=amd64 go build -o $(STAGE)/server/plugin-windows-amd64.exe ./server
	cd $(KANDEV_SDK) && go run ./cmd/plugin-pack -dir $(CURDIR)/$(STAGE) -out $(CURDIR)/$(PKG_OUT)
	rm -rf $(STAGE)
	@echo "Wrote $(PKG_OUT)"

## Host platform only — faster local iteration than the full 5-platform build.
package-host: ui
	$(stage_common)
	go build -o $(STAGE)/server/plugin-$$(go env GOOS)-$$(go env GOARCH)$$(go env GOEXE) ./server
	cd $(KANDEV_SDK) && go run ./cmd/plugin-pack -dir $(CURDIR)/$(STAGE) -out $(CURDIR)/$(PKG_OUT) -platform-only
	rm -rf $(STAGE)
	@echo "Wrote $(PKG_OUT)"

## Validate the all-platform tarball's exact files, declared binaries, and checksums.
verify-package: package
	@set -eu; \
		tmp="$$(mktemp -d)"; \
		trap 'rm -rf "$$tmp"' EXIT; \
		tar -xzf "$(PKG_OUT)" -C "$$tmp"; \
		sh scripts/verify-package.sh "$$tmp" full

## Validate a host-only tarball's exact files, declared binary, and checksums.
verify-package-host: package-host
	@set -eu; \
		tmp="$$(mktemp -d)"; \
		trap 'rm -rf "$$tmp"' EXIT; \
		tar -xzf "$(PKG_OUT)" -C "$$tmp"; \
		sh scripts/verify-package.sh "$$tmp" host "$$(go env GOOS)-$$(go env GOARCH)"

package-file:
	@printf '%s\n' "$(PKG_OUT)"

clean:
	rm -rf bin $(STAGE) ui/bundle.js ui/whisper-worker.js kandev-plugin-voice-*.tar.gz
