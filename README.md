# kandev-plugin-voice

Voice Mode for [kandev](https://github.com/kdlbs/kandev): dictate a prompt into
any native composer instead of typing it.

The microphone button appears beside the existing composer controls in task
chat, Quick Chat, task creation and new-session creation, on desktop and on a
phone. Speak, and the transcript is inserted at your cursor. kandev keeps
ownership of the draft and of submission throughout — the plugin never builds
or sends a message itself.

![The kandev chat composer with the dictation button beside the native controls](docs/media/composer.png)

Press it and it records; press again and the transcript lands at the caret.

![The composer while recording, the dictation button tinted and pulsing](docs/media/recording.png)

This plugin was extracted from kandev core, which shipped Voice Mode until the
composer capability and authenticated-webhook host APIs made a standalone
plugin possible.

## Engines

Three recognizers, picked automatically or chosen per user in
**Settings → Plugins → Voice Mode**:

| Engine | Where the audio goes | Trade-off |
| --- | --- | --- |
| Browser speech | The browser vendor's servers | Fastest, free, no download. Chromium only. |
| In-browser Whisper | Nowhere: it stays on the device | Fully private. Downloads a 40–240 MB model once, then a few seconds per recording. |
| Server transcription | Your kandev server, which relays it to OpenAI | Most accurate, works in every browser. Needs an operator API key and is billed per minute. |

`Automatic` picks the first of those the browser can run, in that order. A
pinned engine that turns out to be unusable degrades the same way rather than
leaving a dead button.

## Setup

1. Install the plugin (Settings → Plugins → Install, or the tarball upload
   below). It requires kandev **0.87.0** or newer.
2. Optional: paste an **OpenAI API key** into the plugin's settings form to
   enable the server engine for everyone on the install. Without it, the two
   browser engines still work and no audio ever reaches your server.
3. Each user picks their engine, language, activation style and auto-send under
   Settings → Plugins → Voice Mode. Those preferences are per-user, not shared.

The key is an operator setting, rendered by kandev from the manifest's
`config_schema` and stored in its encrypted vault. It never reaches the browser:
the plugin's Go half relays the audio server-side.

![The plugin's operator settings: OpenAI API key, endpoint and transcription model](docs/media/operator-key.png)

Everything below that is per-user, and every control explains what it changes
and what it costs:

![Per-user Voice Mode settings: enable, engine, language, Whisper model, activation and auto-send](docs/media/settings.png)

The dictation shortcut defaults to `Cmd/Ctrl+Shift+M` and is rebindable under
Settings → Keyboard shortcuts like any other kandev shortcut. It is one of the
few plugin bindings that fires while a composer has focus (manifest
`allow_in_editor`), because dictating into the field you are typing in is the
entire point.

### On a phone

Same capability, same composer, a 40px touch target. Hold-to-talk silently
becomes press-to-toggle on a coarse pointer, because the platform reclaims a
held finger for system gestures mid-sentence; your saved preference is left
alone so docking a keyboard restores it.

<img src="docs/media/recording-mobile.png" alt="The mobile composer while recording" width="420">

## Privacy and cost

- **Browser speech** streams audio to the browser vendor. Chromium sends it to
  Google.
- **In-browser Whisper** downloads model weights from the Hugging Face CDN on
  first use and then runs entirely offline. No audio leaves the device.
- **Server transcription** uploads the recording to this plugin's authenticated
  `transcribe` webhook, which relays it to OpenAI with the operator's key and
  returns only the text. The key never reaches the browser, the webhook rejects
  anonymous callers, and an upstream error is never echoed back to the page.
- Nothing is stored. The plugin keeps no recordings, no transcripts and no
  history; its only persisted data is your per-user preferences.

## Repository layout

```text
kandev-plugin-voice/
├── manifest.yaml         # id, capabilities, webhook, keybinding, config schema
├── server/               # Go: the transcribe webhook and the OpenAI relay
└── ui/
    ├── src/              # TypeScript: engines, composer action, settings page
    ├── build.mjs         # esbuild: bundle.js + whisper-worker.js
    └── plugin.css        # plugin-owned styling (see the note below)
```

The UI ships its own CSS rather than using kandev's Tailwind utilities:
Tailwind v4 only compiles classes it finds while scanning kandev's own sources,
so a utility that works today would break the moment kandev deletes its last
use of it.

## Development

The Go half builds against kandev's `pkg/pluginsdk`, which is not published as
a standalone module yet, so `go.mod` resolves it through a sibling checkout:

```text
parent/
├── kandev/                 # github.com/kdlbs/kandev
└── kandev-plugin-voice/    # this repo
```

```bash
make ui-install       # once: install the UI toolchain
make test             # Go tests + UI tests
make typecheck        # tsc over ui/src
make package-host     # build a tarball for this platform only
```

Install the result into a **disposable** kandev instance:

```bash
curl -F package=@kandev-plugin-voice-0.1.1.tar.gz \
  http://localhost:8080/api/plugins/install
```

kandev rejects reinstalling the same id and version, so bump
`manifest.yaml`'s `version` (and the Makefile's `VERSION`) or uninstall first.

## License

MIT. See [LICENSE](LICENSE).
