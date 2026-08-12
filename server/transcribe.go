package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strings"
	"time"
)

// ErrNotConfigured is returned when no OpenAI key is saved on the plugin's
// settings page. The webhook maps it to 503 so the UI can steer the user to
// a browser engine instead of retrying a relay that will never succeed.
var ErrNotConfigured = errors.New("voice transcription is not configured")

// UpstreamError wraps a non-2xx response from the transcription endpoint.
// The status and body stay inside the plugin process: the webhook answers
// 502 with a generic message so an upstream error can never leak key state,
// account details or quota information to the browser.
type UpstreamError struct {
	StatusCode int
	Body       string
}

func (e *UpstreamError) Error() string {
	return fmt.Sprintf("transcription upstream error: status=%d", e.StatusCode)
}

const (
	defaultEndpoint = "https://api.openai.com/v1/audio/transcriptions"
	defaultModel    = "whisper-1"
	requestTimeout  = 120 * time.Second
)

// Transcriber relays recorded audio to an OpenAI-compatible transcription
// endpoint. It is rebuilt per request from the plugin's current config, so a
// key the operator just saved takes effect without a restart.
type Transcriber struct {
	apiKey   string
	endpoint string
	model    string
	client   *http.Client
}

// NewTranscriber builds a Transcriber. Empty endpoint and model fall back to
// OpenAI's defaults; an empty key leaves the transcriber unconfigured.
func NewTranscriber(apiKey, endpoint, model string, client *http.Client) *Transcriber {
	t := &Transcriber{
		apiKey:   strings.TrimSpace(apiKey),
		endpoint: strings.TrimSpace(endpoint),
		model:    strings.TrimSpace(model),
		client:   client,
	}
	if t.endpoint == "" {
		t.endpoint = defaultEndpoint
	}
	if t.model == "" {
		t.model = defaultModel
	}
	if t.client == nil {
		t.client = &http.Client{Timeout: requestTimeout}
	}
	return t
}

// Configured reports whether a key is present, so the caller can answer 503
// before reading an audio payload it cannot use.
func (t *Transcriber) Configured() bool {
	return t != nil && t.apiKey != ""
}

// Transcribe posts audio to the configured endpoint and returns the text.
// filename matters: the upstream detects the container from its extension.
func (t *Transcriber) Transcribe(ctx context.Context, audio []byte, mimeType, filename string) (string, error) {
	if !t.Configured() {
		return "", ErrNotConfigured
	}
	if len(audio) == 0 {
		return "", errors.New("audio payload is empty")
	}

	body, contentType, err := buildMultipart(audio, mimeType, filename, t.model)
	if err != nil {
		return "", fmt.Errorf("build multipart body: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, t.endpoint, body)
	if err != nil {
		return "", fmt.Errorf("build transcription request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+t.apiKey)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Accept", "application/json")

	resp, err := t.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("call transcription endpoint: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	rawBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", &UpstreamError{StatusCode: resp.StatusCode, Body: string(rawBody)}
	}

	var parsed struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(rawBody, &parsed); err != nil {
		return "", fmt.Errorf("decode transcription response: %w", err)
	}
	return strings.TrimSpace(parsed.Text), nil
}

// buildMultipart assembles the multipart/form-data body the endpoint expects:
// `file`, `model`, and `response_format=json`.
func buildMultipart(audio []byte, mimeType, filename, model string) (io.Reader, string, error) {
	buf := &bytes.Buffer{}
	w := multipart.NewWriter(buf)

	if filename == "" {
		filename = "recording" + extensionForMime(mimeType)
	}
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename=%q`, filename))
	if mimeType != "" {
		header.Set("Content-Type", mimeType)
	}
	filePart, err := w.CreatePart(header)
	if err != nil {
		return nil, "", err
	}
	if _, err := filePart.Write(audio); err != nil {
		return nil, "", err
	}

	if err := w.WriteField("model", model); err != nil {
		return nil, "", err
	}
	if err := w.WriteField("response_format", "json"); err != nil {
		return nil, "", err
	}
	if err := w.Close(); err != nil {
		return nil, "", err
	}
	return buf, w.FormDataContentType(), nil
}

// extensionForMime maps the containers MediaRecorder commonly emits to the
// file extensions the transcription endpoint recognises. Unknown types get
// ".webm", the most common MediaRecorder default.
func extensionForMime(mime string) string {
	mime = strings.ToLower(mime)
	switch {
	case strings.Contains(mime, "wav"):
		return ".wav"
	case strings.Contains(mime, "mp4"), strings.Contains(mime, "m4a"):
		return ".m4a"
	case strings.Contains(mime, "mpeg"), strings.Contains(mime, "mp3"):
		return ".mp3"
	case strings.Contains(mime, "ogg"):
		return ".ogg"
	default:
		return ".webm"
	}
}
