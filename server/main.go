// Command kandev-plugin-voice is the backend half of the kandev Voice Mode
// plugin. kandev spawns it as a gRPC subprocess; pluginsdk.Serve owns the
// entire transport, so there is no listen address here.
//
// Its only job is the `transcribe` webhook: relay a recording to the
// operator-configured OpenAI-compatible endpoint so the API key stays on the
// server. The two browser engines (Web Speech and in-browser Whisper) never
// reach this process at all.
package main

import "github.com/kandev/kandev/pkg/pluginsdk"

func main() {
	pluginsdk.Serve(&voicePlugin{})
}
