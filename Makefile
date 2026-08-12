.PHONY: build ui ui-install test test-go test-ui typecheck fmt vet package package-host clean

BIN := bin/kandev-plugin-voice
VERSION := 0.1.0
STAGE := .build/stage
PKG_OUT := kandev-plugin-voice-$(VERSION).tar.gz

## Build the plugin binary for the host platform (development use). kandev
## installs from `make package`/`package-host` output, not this.
build:
	mkdir -p bin
	go build -o $(BIN) ./server/...

## Install the UI toolchain. Needed once before `make ui`.
ui-install:
	cd ui && pnpm install --frozen-lockfile

## Build ui/bundle.js and ui/whisper-worker.js with esbuild.
ui:
	cd ui && node build.mjs

test: test-go test-ui

test-go:
	go test ./server/...

test-ui:
	cd ui && pnpm exec vitest run

typecheck:
	cd ui && pnpm exec tsc --noEmit

fmt:
	gofmt -l .

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
	go run github.com/kandev/kandev/cmd/plugin-pack -dir $(STAGE) -out $(PKG_OUT)
	rm -rf $(STAGE)
	@echo "Wrote $(PKG_OUT)"

## Host platform only — faster local iteration than the full 5-platform build.
package-host: ui
	$(stage_common)
	go build -o $(STAGE)/server/plugin-$$(go env GOOS)-$$(go env GOARCH)$$(go env GOEXE) ./server
	go run github.com/kandev/kandev/cmd/plugin-pack -dir $(STAGE) -out $(PKG_OUT) -platform-only
	rm -rf $(STAGE)
	@echo "Wrote $(PKG_OUT)"

clean:
	rm -rf bin $(STAGE) ui/bundle.js ui/whisper-worker.js kandev-plugin-voice-*.tar.gz
