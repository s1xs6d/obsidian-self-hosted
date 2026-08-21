// Package config policy support.
//
// Obsidian 1.13 reads a policy.json file (enterprise deployments) and gates
// features (plugins, themes, sync, publish, ...) on it. OSH mirrors that
// mechanism: the file lives next to config.json and defaults are seeded by the
// server on first start, so the exact same policy file Obsidian would accept
// can be dropped in here.
package config

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
)

// Policy mirrors Obsidian's policy.json schema. Plugins/Themes accept either
// true (allow all) or a non-empty string array (allowlist); the rest are
// strict booleans.
type Policy struct {
	Plugins   any   `json:"plugins"`
	Themes    any   `json:"themes"`
	Snippets  bool  `json:"snippets"`
	Sync      bool  `json:"sync"`
	Publish   bool  `json:"publish"`
	WebViewer bool  `json:"webViewer"`
	DevTools  bool  `json:"devTools"`
	Insider   bool  `json:"insider"`
}

// defaultPolicy is used when the policy file is missing, unparseable, or a key
// is absent/invalid. sync/publish stay enabled (they degrade gracefully when
// the official services are unreachable); webViewer needs Electron's webview
// and insider builds are not applicable, so both default to false.
var defaultPolicy = Policy{
	Plugins:   true,
	Themes:    true,
	Snippets:  true,
	Sync:      true,
	Publish:   true,
	WebViewer: false,
	DevTools:  true,
	Insider:   false,
}

var (
	policy     = defaultPolicy
	policyFile string
)

// LoadPolicy reads the policy file once at startup, seeding it with defaults
// on first run. Failures fall back to defaults per key (mirroring Obsidian's
// ao() normalization, except that invalid/missing keys keep the default value
// instead of disabling the feature).
func LoadPolicy() error {
	dir, err := os.UserConfigDir()
	if err != nil {
		return err
	}
	policyFile = filepath.Join(dir, "osh", "policy.json")

	data, err := os.ReadFile(policyFile)
	if os.IsNotExist(err) {
		policy = defaultPolicy
		if werr := writePolicyFile(); werr != nil {
			log.Printf("warning: could not write default policy file: %v", werr)
		}
		return nil
	}
	if err != nil {
		return err
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		log.Printf("warning: invalid policy file %s, using defaults: %v", policyFile, err)
		policy = defaultPolicy
		return nil
	}

	p := defaultPolicy
	if v, ok := raw["plugins"]; ok {
		if b, err := parsePluginsField(v); err == nil {
			p.Plugins = b
		}
	}
	if v, ok := raw["themes"]; ok {
		if b, err := parsePluginsField(v); err == nil {
			p.Themes = b
		}
	}
	for _, f := range []struct {
		key  string
		dest *bool
	}{
		{"snippets", &p.Snippets},
		{"sync", &p.Sync},
		{"publish", &p.Publish},
		{"webViewer", &p.WebViewer},
		{"devTools", &p.DevTools},
		{"insider", &p.Insider},
	} {
		if v, ok := raw[f.key]; ok {
			var b bool
			if err := json.Unmarshal(v, &b); err == nil {
				*f.dest = b
			}
		}
	}
	policy = p
	return nil
}

// parsePluginsField parses Obsidian's plugins/themes policy value: `true` or a
// non-empty array of strings. Anything else is an error.
func parsePluginsField(raw json.RawMessage) (any, error) {
	var b bool
	if err := json.Unmarshal(raw, &b); err == nil {
		return b, nil
	}
	var list []string
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return nil, os.ErrInvalid
	}
	return list, nil
}

func writePolicyFile() error {
	if err := os.MkdirAll(filepath.Dir(policyFile), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(defaultPolicy, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(policyFile, data, 0o644)
}

// PolicyResponse returns the policy in the shape Obsidian's renderer expects
// for the "policy" IPC channel.
func PolicyResponse() map[string]any {
	return map[string]any{
		"plugins":   policy.Plugins,
		"themes":    policy.Themes,
		"snippets":  policy.Snippets,
		"sync":      policy.Sync,
		"publish":   policy.Publish,
		"webViewer": policy.WebViewer,
		"devTools":  policy.DevTools,
		"insider":   policy.Insider,
	}
}