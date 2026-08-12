package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kandev/kandev/pkg/pluginsdk"
	"github.com/stretchr/testify/require"
)

// audioUpload builds the multipart body the plugin UI posts, and returns it
// with the Content-Type header (carrying the boundary) kandev relays verbatim.
func audioUpload(t *testing.T, field, filename, mimeType string, payload []byte) ([]byte, string) {
	t.Helper()
	buf := &bytes.Buffer{}
	w := multipart.NewWriter(buf)
	part, err := w.CreateFormFile(field, filename)
	require.NoError(t, err)
	_, err = part.Write(payload)
	require.NoError(t, err)
	if mimeType != "" {
		require.NoError(t, w.WriteField("mime", mimeType))
	}
	require.NoError(t, w.Close())
	return buf.Bytes(), w.FormDataContentType()
}

func transcribeRequest(body []byte, contentType string) *pluginsdk.WebhookRequest {
	return &pluginsdk.WebhookRequest{
		WebhookKey: "transcribe",
		Method:     http.MethodPost,
		Headers:    map[string]string{"Content-Type": contentType},
		Body:       body,
	}
}

// upstreamStub stands in for OpenAI. It records the request it saw so tests
// can assert what the plugin forwarded.
type upstreamStub struct {
	server        *httptest.Server
	authorization string
	model         string
	filename      string
	fileBytes     []byte
}

func newUpstreamStub(t *testing.T, status int, responseBody string) *upstreamStub {
	t.Helper()
	stub := &upstreamStub{}
	stub.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		stub.authorization = r.Header.Get("Authorization")
		require.NoError(t, r.ParseMultipartForm(32<<20))
		stub.model = r.FormValue("model")
		file, header, err := r.FormFile("file")
		if err == nil {
			defer func() { _ = file.Close() }()
			stub.filename = header.Filename
			buf := &bytes.Buffer{}
			_, _ = buf.ReadFrom(file)
			stub.fileBytes = buf.Bytes()
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(responseBody))
	}))
	t.Cleanup(stub.server.Close)
	return stub
}

func configuredPlugin(t *testing.T, stub *upstreamStub, extra map[string]any) *voicePlugin {
	t.Helper()
	config := map[string]any{"openai_api_key": "sk-test-key"}
	if stub != nil {
		config["openai_base_url"] = stub.server.URL
	}
	for k, v := range extra {
		config[k] = v
	}
	p := &voicePlugin{httpClient: &http.Client{}}
	p.SetHost(newFakeHost(config))
	return p
}

func decodeBody(t *testing.T, resp *pluginsdk.WebhookResponse) map[string]string {
	t.Helper()
	var out map[string]string
	require.NoError(t, json.Unmarshal(resp.Body, &out))
	return out
}

func TestHandleWebhook_RelaysAudioAndReturnsTranscript(t *testing.T) {
	stub := newUpstreamStub(t, http.StatusOK, `{"text":"  ship the release  "}`)
	p := configuredPlugin(t, stub, nil)
	body, contentType := audioUpload(t, audioFormField, "recording.webm", "", []byte("fake-opus-bytes"))

	resp, err := p.HandleWebhook(context.Background(), transcribeRequest(body, contentType))

	require.NoError(t, err)
	require.Equal(t, int32(http.StatusOK), resp.Status)
	require.Equal(t, "ship the release", decodeBody(t, resp)["text"])
	require.Equal(t, "Bearer sk-test-key", stub.authorization)
	require.Equal(t, "whisper-1", stub.model)
	require.Equal(t, "recording.webm", stub.filename)
	require.Equal(t, []byte("fake-opus-bytes"), stub.fileBytes)
}

func TestHandleWebhook_UsesOperatorModelOverride(t *testing.T) {
	stub := newUpstreamStub(t, http.StatusOK, `{"text":"hi"}`)
	p := configuredPlugin(t, stub, map[string]any{"openai_model": "gpt-4o-transcribe"})
	body, contentType := audioUpload(t, audioFormField, "recording.webm", "", []byte("bytes"))

	_, err := p.HandleWebhook(context.Background(), transcribeRequest(body, contentType))

	require.NoError(t, err)
	require.Equal(t, "gpt-4o-transcribe", stub.model)
}

func TestHandleWebhook_WithoutKeyReturns503AndNeverCallsUpstream(t *testing.T) {
	stub := newUpstreamStub(t, http.StatusOK, `{"text":"should not happen"}`)
	p := &voicePlugin{httpClient: &http.Client{}}
	p.SetHost(newFakeHost(map[string]any{"openai_base_url": stub.server.URL}))
	body, contentType := audioUpload(t, audioFormField, "recording.webm", "", []byte("bytes"))

	resp, err := p.HandleWebhook(context.Background(), transcribeRequest(body, contentType))

	require.NoError(t, err)
	require.Equal(t, int32(http.StatusServiceUnavailable), resp.Status)
	require.Empty(t, stub.authorization, "unconfigured relay must not reach the upstream")
}

func TestHandleWebhook_WithoutHostReturns503(t *testing.T) {
	p := &voicePlugin{}
	body, contentType := audioUpload(t, audioFormField, "recording.webm", "", []byte("bytes"))

	resp, err := p.HandleWebhook(context.Background(), transcribeRequest(body, contentType))

	require.NoError(t, err)
	require.Equal(t, int32(http.StatusServiceUnavailable), resp.Status)
}

func TestHandleWebhook_ConfigErrorReturns503(t *testing.T) {
	p := &voicePlugin{}
	host := newFakeHost(nil)
	host.configErr = errors.New("config store unavailable")
	p.SetHost(host)
	body, contentType := audioUpload(t, audioFormField, "recording.webm", "", []byte("bytes"))

	resp, err := p.HandleWebhook(context.Background(), transcribeRequest(body, contentType))

	require.NoError(t, err)
	require.Equal(t, int32(http.StatusServiceUnavailable), resp.Status)
}

func TestHandleWebhook_UpstreamFailureIsNotEchoedToTheBrowser(t *testing.T) {
	stub := newUpstreamStub(t, http.StatusUnauthorized,
		`{"error":{"message":"Incorrect API key provided: sk-test-key"}}`)
	p := configuredPlugin(t, stub, nil)
	body, contentType := audioUpload(t, audioFormField, "recording.webm", "", []byte("bytes"))

	resp, err := p.HandleWebhook(context.Background(), transcribeRequest(body, contentType))

	require.NoError(t, err)
	require.Equal(t, int32(http.StatusBadGateway), resp.Status)
	require.Equal(t, "upstream transcription error", decodeBody(t, resp)["error"])
	require.NotContains(t, string(resp.Body), "sk-test-key")
}

func TestHandleWebhook_RejectsUnknownKey(t *testing.T) {
	p := configuredPlugin(t, nil, nil)

	resp, err := p.HandleWebhook(context.Background(), &pluginsdk.WebhookRequest{
		WebhookKey: "exfiltrate",
		Method:     http.MethodPost,
	})

	require.NoError(t, err)
	require.Equal(t, int32(http.StatusNotFound), resp.Status)
}

func TestHandleWebhook_RejectsNonPost(t *testing.T) {
	p := configuredPlugin(t, nil, nil)

	resp, err := p.HandleWebhook(context.Background(), &pluginsdk.WebhookRequest{
		WebhookKey: "transcribe",
		Method:     http.MethodGet,
	})

	require.NoError(t, err)
	require.Equal(t, int32(http.StatusMethodNotAllowed), resp.Status)
}

func TestHandleWebhook_MalformedBodiesReturn400(t *testing.T) {
	stub := newUpstreamStub(t, http.StatusOK, `{"text":"nope"}`)
	body, contentType := audioUpload(t, audioFormField, "recording.webm", "", []byte("bytes"))
	wrongField, wrongFieldType := audioUpload(t, "attachment", "recording.webm", "", []byte("bytes"))

	cases := []struct {
		name        string
		contentType string
		body        []byte
	}{
		{"no content type", "", body},
		{"not multipart", "application/json", []byte(`{"audio":"..."}`)},
		{"multipart without boundary", "multipart/form-data", body},
		{"truncated multipart", contentType, body[:len(body)/2]},
		{"wrong field name", wrongFieldType, wrongField},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := configuredPlugin(t, stub, nil)
			resp, err := p.HandleWebhook(context.Background(), transcribeRequest(tc.body, tc.contentType))
			require.NoError(t, err)
			require.Equal(t, int32(http.StatusBadRequest), resp.Status)
		})
	}
}

func TestHandleWebhook_EmptyAudioReturns400(t *testing.T) {
	stub := newUpstreamStub(t, http.StatusOK, `{"text":"nope"}`)
	p := configuredPlugin(t, stub, nil)
	body, contentType := audioUpload(t, audioFormField, "recording.webm", "", nil)

	resp, err := p.HandleWebhook(context.Background(), transcribeRequest(body, contentType))

	require.NoError(t, err)
	require.Equal(t, int32(http.StatusBadRequest), resp.Status)
	require.Empty(t, stub.fileBytes)
}

func TestHandleWebhook_OversizedAudioReturns413WithoutBufferingUpstream(t *testing.T) {
	stub := newUpstreamStub(t, http.StatusOK, `{"text":"nope"}`)
	p := configuredPlugin(t, stub, nil)
	body, contentType := audioUpload(t, audioFormField, "recording.wav", "",
		bytes.Repeat([]byte("a"), maxAudioBytes+1))

	resp, err := p.HandleWebhook(context.Background(), transcribeRequest(body, contentType))

	require.NoError(t, err)
	require.Equal(t, int32(http.StatusRequestEntityTooLarge), resp.Status)
	require.Empty(t, stub.authorization, "an oversized payload must not reach the upstream")
}

func TestHandleWebhook_TenMiBUploadSucceeds(t *testing.T) {
	stub := newUpstreamStub(t, http.StatusOK, `{"text":"long recording"}`)
	p := configuredPlugin(t, stub, nil)
	payload := bytes.Repeat([]byte("a"), 10<<20)
	body, contentType := audioUpload(t, audioFormField, "recording.wav", "", payload)

	resp, err := p.HandleWebhook(context.Background(), transcribeRequest(body, contentType))

	require.NoError(t, err)
	require.Equal(t, int32(http.StatusOK), resp.Status)
	require.Len(t, stub.fileBytes, 10<<20)
}

func TestHandleWebhook_HonoursContextCancellation(t *testing.T) {
	stub := newUpstreamStub(t, http.StatusOK, `{"text":"too late"}`)
	p := configuredPlugin(t, stub, nil)
	body, contentType := audioUpload(t, audioFormField, "recording.webm", "", []byte("bytes"))

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	resp, err := p.HandleWebhook(ctx, transcribeRequest(body, contentType))

	require.NoError(t, err)
	require.Equal(t, int32(http.StatusInternalServerError), resp.Status)
}

func TestHandleWebhook_FindsContentTypeRegardlessOfHeaderCase(t *testing.T) {
	stub := newUpstreamStub(t, http.StatusOK, `{"text":"ok"}`)
	p := configuredPlugin(t, stub, nil)
	body, contentType := audioUpload(t, audioFormField, "recording.webm", "", []byte("bytes"))

	resp, err := p.HandleWebhook(context.Background(), &pluginsdk.WebhookRequest{
		WebhookKey: "transcribe",
		Method:     strings.ToLower(http.MethodPost),
		Headers:    map[string]string{"content-type": contentType},
		Body:       body,
	})

	require.NoError(t, err)
	require.Equal(t, int32(http.StatusOK), resp.Status)
}
