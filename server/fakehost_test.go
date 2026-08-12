package main

import (
	"context"
	"errors"
	"sync"

	"github.com/kandev/kandev/pkg/pluginsdk"
)

// fakeHost is an in-memory pluginsdk.Host double. Voice Mode only ever calls
// GetConfig, so the rest is inert; UnimplementedHostData satisfies the data
// accessors this plugin deliberately does not use.
type fakeHost struct {
	pluginsdk.UnimplementedHostData
	mu        sync.Mutex
	config    map[string]any
	configErr error
}

func newFakeHost(config map[string]any) *fakeHost {
	return &fakeHost{config: config}
}

func (h *fakeHost) GetConfig(context.Context) (map[string]any, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.configErr != nil {
		return nil, h.configErr
	}
	if h.config == nil {
		return map[string]any{}, nil
	}
	return h.config, nil
}

func (h *fakeHost) GetState(context.Context, string, string, string) (map[string]any, bool, error) {
	return nil, false, errors.New("state capability not declared")
}

func (h *fakeHost) SetState(context.Context, string, string, string, map[string]any) error {
	return errors.New("state capability not declared")
}

func (h *fakeHost) DeleteState(context.Context, string, string, string) error {
	return errors.New("state capability not declared")
}

func (h *fakeHost) ListState(context.Context, string, string) ([]pluginsdk.StateEntry, error) {
	return nil, errors.New("state capability not declared")
}

func (h *fakeHost) RevealSecret(context.Context, string) (string, error) { return "", nil }

func (h *fakeHost) GetSecret(context.Context, string) (string, bool, error) { return "", false, nil }

func (h *fakeHost) SetSecret(context.Context, string, string) error { return nil }

func (h *fakeHost) DeleteSecret(context.Context, string) error { return nil }

func (h *fakeHost) EmitEvent(context.Context, string, map[string]any) error { return nil }

var _ pluginsdk.Host = (*fakeHost)(nil)
