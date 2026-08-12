package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"mime/multipart"
	"net/http"
	"strings"

	"github.com/kandev/kandev/pkg/pluginsdk"
)

// audioFormField is the multipart field the UI uploads the recording under.
const audioFormField = "audio"

// maxAudioBytes caps what this plugin will read out of the multipart body.
// kandev already enforces the manifest's max_body_bytes before we are called;
// this is the second, plugin-owned bound so a manifest edit cannot make the
// plugin buffer an unbounded recording in memory.
const maxAudioBytes = 16 << 20

// voicePlugin is the backend half of Voice Mode. It owns exactly one job:
// relaying a recording to the operator's transcription endpoint so the
// OpenAI key stays out of the browser. It subscribes to no events, reads no
// kandev data and writes nothing.
type voicePlugin struct {
	pluginsdk.UnimplementedPlugin

	// httpClient is nil in production (the transcriber builds its own) and
	// injected by tests pointing at an httptest server.
	httpClient *http.Client
}

var _ pluginsdk.Plugin = (*voicePlugin)(nil)

// HandleWebhook serves POST /api/plugins/kandev-plugin-voice/webhooks/transcribe.
// The manifest declares the key as `access: authenticated`, so kandev has
// already rejected anonymous callers before this runs.
func (p *voicePlugin) HandleWebhook(ctx context.Context, req *pluginsdk.WebhookRequest) (*pluginsdk.WebhookResponse, error) {
	if req.WebhookKey != "transcribe" {
		return jsonError(http.StatusNotFound, "unknown webhook"), nil
	}
	if !strings.EqualFold(req.Method, http.MethodPost) {
		return jsonError(http.StatusMethodNotAllowed, "transcribe accepts POST"), nil
	}

	transcriber, err := p.transcriber(ctx)
	if err != nil {
		log.Printf("voice: reading plugin config: %v", err)
		return jsonError(http.StatusServiceUnavailable, "voice transcription is not configured"), nil
	}
	if !transcriber.Configured() {
		return jsonError(http.StatusServiceUnavailable, "voice transcription is not configured"), nil
	}

	audio, mimeType, filename, err := parseAudioUpload(req)
	if err != nil {
		if errors.Is(err, errAudioTooLarge) {
			return jsonError(http.StatusRequestEntityTooLarge, "audio payload too large"), nil
		}
		return jsonError(http.StatusBadRequest, err.Error()), nil
	}

	text, err := transcriber.Transcribe(ctx, audio, mimeType, filename)
	if err != nil {
		return transcribeErrorResponse(err), nil
	}

	// Only the byte count and result length are logged. Audio, transcripts,
	// keys and request headers never reach the log.
	log.Printf("voice: transcribed %d bytes into %d characters", len(audio), len(text))

	body, err := json.Marshal(map[string]string{"text": text})
	if err != nil {
		return jsonError(http.StatusInternalServerError, "failed to encode transcript"), nil
	}
	return &pluginsdk.WebhookResponse{
		Status:  http.StatusOK,
		Headers: map[string]string{"Content-Type": "application/json"},
		Body:    body,
	}, nil
}

// transcriber builds a Transcriber from the operator's saved settings. kandev
// restarts the plugin when config is saved, but reading on demand also keeps
// a long-lived process honest about a key rotated underneath it.
func (p *voicePlugin) transcriber(ctx context.Context) (*Transcriber, error) {
	host := p.Host()
	if host == nil {
		return nil, errors.New("host not injected")
	}
	config, err := host.GetConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("get config: %w", err)
	}
	key, _ := config["openai_api_key"].(string)
	endpoint, _ := config["openai_base_url"].(string)
	model, _ := config["openai_model"].(string)
	return NewTranscriber(key, endpoint, model, p.httpClient), nil
}

// transcribeErrorResponse maps a relay failure onto a status the UI can act
// on, without echoing the upstream body back to the browser.
func transcribeErrorResponse(err error) *pluginsdk.WebhookResponse {
	if errors.Is(err, ErrNotConfigured) {
		return jsonError(http.StatusServiceUnavailable, "voice transcription is not configured")
	}
	var upstream *UpstreamError
	if errors.As(err, &upstream) {
		log.Printf("voice: transcription upstream returned %d", upstream.StatusCode)
		return jsonError(http.StatusBadGateway, "upstream transcription error")
	}
	log.Printf("voice: transcription failed: %v", err)
	return jsonError(http.StatusInternalServerError, "transcription failed")
}

func jsonError(status int, message string) *pluginsdk.WebhookResponse {
	body, err := json.Marshal(map[string]string{"error": message})
	if err != nil {
		body = []byte(`{"error":"transcription failed"}`)
	}
	return &pluginsdk.WebhookResponse{
		Status:  int32(status),
		Headers: map[string]string{"Content-Type": "application/json"},
		Body:    body,
	}
}

var errAudioTooLarge = errors.New("audio payload too large")

// parseAudioUpload pulls the `audio` part out of the multipart body kandev
// relayed verbatim. kandev hands the plugin the raw bytes plus the original
// headers, so the boundary comes from Content-Type.
func parseAudioUpload(req *pluginsdk.WebhookRequest) (audio []byte, mimeType, filename string, err error) {
	contentType := headerValue(req.Headers, "Content-Type")
	if contentType == "" {
		return nil, "", "", errors.New("missing Content-Type")
	}
	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil || !strings.HasPrefix(mediaType, "multipart/") {
		return nil, "", "", errors.New("expected a multipart/form-data body")
	}
	boundary := params["boundary"]
	if boundary == "" {
		return nil, "", "", errors.New("multipart body has no boundary")
	}
	if len(req.Body) > maxAudioBytes {
		return nil, "", "", errAudioTooLarge
	}

	reader := multipart.NewReader(strings.NewReader(string(req.Body)), boundary)
	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, "", "", errors.New("malformed multipart body")
		}
		if part.FormName() != audioFormField {
			_ = part.Close()
			continue
		}
		// LimitReader is one byte over the cap so a payload that exactly
		// fills it is still distinguishable from one that overflows.
		data, readErr := io.ReadAll(io.LimitReader(part, maxAudioBytes+1))
		_ = part.Close()
		if readErr != nil {
			return nil, "", "", errors.New("cannot read uploaded audio")
		}
		if len(data) > maxAudioBytes {
			return nil, "", "", errAudioTooLarge
		}
		if len(data) == 0 {
			return nil, "", "", errors.New("audio file is empty")
		}
		return data, part.Header.Get("Content-Type"), part.FileName(), nil
	}
	return nil, "", "", fmt.Errorf("audio file is required (multipart field %q)", audioFormField)
}

// headerValue looks a header up case-insensitively. kandev canonicalises
// header names before relaying them, but the plugin should not depend on it.
func headerValue(headers map[string]string, name string) string {
	if v, ok := headers[name]; ok {
		return v
	}
	for k, v := range headers {
		if strings.EqualFold(k, name) {
			return v
		}
	}
	return ""
}
