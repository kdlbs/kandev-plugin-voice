package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNewTranscriber_AppliesDefaults(t *testing.T) {
	tr := NewTranscriber("  sk-key  ", "", "", nil)

	require.True(t, tr.Configured())
	require.Equal(t, "sk-key", tr.apiKey)
	require.Equal(t, defaultEndpoint, tr.endpoint)
	require.Equal(t, defaultModel, tr.model)
	require.NotNil(t, tr.client)
}

func TestTranscriber_NotConfiguredWithBlankKey(t *testing.T) {
	tr := NewTranscriber("   ", "", "", nil)

	require.False(t, tr.Configured())
	_, err := tr.Transcribe(context.Background(), []byte("bytes"), "", "a.webm")
	require.ErrorIs(t, err, ErrNotConfigured)
}

func TestTranscriber_RejectsEmptyAudio(t *testing.T) {
	tr := NewTranscriber("sk-key", "", "", nil)

	_, err := tr.Transcribe(context.Background(), nil, "", "a.webm")
	require.Error(t, err)
	require.NotErrorIs(t, err, ErrNotConfigured)
}

func TestTranscriber_UpstreamErrorKeepsBodyInsideThePlugin(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte("rate limited for org-123"))
	}))
	defer server.Close()
	tr := NewTranscriber("sk-key", server.URL, "", server.Client())

	_, err := tr.Transcribe(context.Background(), []byte("bytes"), "", "a.webm")

	var upstream *UpstreamError
	require.ErrorAs(t, err, &upstream)
	require.Equal(t, http.StatusTooManyRequests, upstream.StatusCode)
	require.Equal(t, "rate limited for org-123", upstream.Body)
	require.NotContains(t, upstream.Error(), "org-123", "Error() is log-safe; the body is not")
}

func TestTranscriber_RejectsUndecodableResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("not json"))
	}))
	defer server.Close()
	tr := NewTranscriber("sk-key", server.URL, "", server.Client())

	_, err := tr.Transcribe(context.Background(), []byte("bytes"), "", "a.webm")
	require.Error(t, err)
}

func TestTranscriber_DerivesFilenameFromMimeWhenMissing(t *testing.T) {
	var seen string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.NoError(t, r.ParseMultipartForm(1<<20))
		_, header, err := r.FormFile("file")
		require.NoError(t, err)
		seen = header.Filename
		_, _ = w.Write([]byte(`{"text":"ok"}`))
	}))
	defer server.Close()
	tr := NewTranscriber("sk-key", server.URL, "", server.Client())

	_, err := tr.Transcribe(context.Background(), []byte("bytes"), "audio/mp4", "")
	require.NoError(t, err)
	require.Equal(t, "recording.m4a", seen)
}

func TestExtensionForMime(t *testing.T) {
	cases := map[string]string{
		"audio/wav":                ".wav",
		"audio/x-wav":              ".wav",
		"audio/mp4":                ".m4a",
		"audio/m4a":                ".m4a",
		"audio/mpeg":               ".mp3",
		"audio/ogg;codecs=opus":    ".ogg",
		"audio/webm;codecs=opus":   ".webm",
		"":                         ".webm",
		"application/octet-stream": ".webm",
	}
	for mime, want := range cases {
		require.Equal(t, want, extensionForMime(mime), mime)
	}
}
