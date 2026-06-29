// Package config manages OSH's persistent configuration, including the vault
// registry. All operations are safe for concurrent use.
package config

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const Version = "1.12.7"

// VaultEntry holds the metadata for a single registered vault.
type VaultEntry struct {
	Path string `json:"path"`
	Ts   int64  `json:"ts"`
}

// Config is the top-level on-disk structure stored at
// ~/.config/osh/config.json.
type Config struct {
	Vaults  map[string]*VaultEntry `json:"vaults"`
	Version string                 `json:"version"`
}

var (
	mu      sync.RWMutex
	cfg     *Config
	cfgFile string

	homeDir     string
	homeDirOnce sync.Once
)

// HomeDir returns the effective root directory for file browsing.
// Reads OSH_HOME from the environment; falls back to the OS home directory.
func HomeDir() string {
	homeDirOnce.Do(func() {
		if v := os.Getenv("OSH_HOME"); v != "" {
			if abs, err := filepath.Abs(v); err == nil {
				homeDir = abs
				return
			}
		}
		if h, err := os.UserHomeDir(); err == nil {
			homeDir = h
		}
	})
	return homeDir
}

// configFilePath returns the path for config.json.
func configFilePath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "osh", "config.json"), nil
}

// Load reads (or initialises) the config from disk. It must be called once at
// startup before any other function in this package.
func Load() error {
	path, err := configFilePath()
	if err != nil {
		return err
	}

	mu.Lock()
	defer mu.Unlock()

	cfgFile = path

	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		cfg = &Config{
			Vaults:  make(map[string]*VaultEntry),
			Version: Version,
		}
		return nil
	}
	if err != nil {
		return err
	}

	c := &Config{}
	if err := json.Unmarshal(data, c); err != nil {
		return err
	}
	if c.Vaults == nil {
		c.Vaults = make(map[string]*VaultEntry)
	}
	cfg = c
	return nil
}

// save writes the current in-memory config to disk. Caller must hold mu (write).
func save() error {
	if err := os.MkdirAll(filepath.Dir(cfgFile), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(cfgFile, data, 0o644)
}

// VaultList returns a snapshot copy of the vault map.
func VaultList() map[string]VaultEntry {
	mu.RLock()
	defer mu.RUnlock()
	out := make(map[string]VaultEntry, len(cfg.Vaults))
	for id, v := range cfg.Vaults {
		out[id] = *v
	}
	return out
}

// VaultByID returns the filesystem path for the vault with the given id.
func VaultByID(id string) (path string, ok bool) {
	mu.RLock()
	defer mu.RUnlock()
	v, ok := cfg.Vaults[id]
	if !ok {
		return "", false
	}
	return v.Path, true
}

// VaultByPath returns the id for the vault at the given filesystem path.
func VaultByPath(path string) (id string, ok bool) {
	mu.RLock()
	defer mu.RUnlock()
	for id, v := range cfg.Vaults {
		if v.Path == path {
			return id, true
		}
	}
	return "", false
}

// AddVault registers path as a vault, creating a new id if it doesn't already
// exist. Returns the vault's id.
func AddVault(path string) (string, error) {
	mu.Lock()
	defer mu.Unlock()

	for id, v := range cfg.Vaults {
		if v.Path == path {
			v.Ts = time.Now().UnixMilli()
			return id, save()
		}
	}

	id := generateID()
	cfg.Vaults[id] = &VaultEntry{
		Path: path,
		Ts:   time.Now().UnixMilli(),
	}
	return id, save()
}

// RemoveVault removes the vault with the given filesystem path. Returns true if
// a vault was removed.
func RemoveVault(path string) (bool, error) {
	mu.Lock()
	defer mu.Unlock()

	for id, v := range cfg.Vaults {
		if v.Path == path {
			delete(cfg.Vaults, id)
			return true, save()
		}
	}
	return false, nil
}

// MoveVault updates the filesystem path for an existing vault. Returns true if
// a vault was found and updated.
func MoveVault(oldPath, newPath string) (bool, error) {
	mu.Lock()
	defer mu.Unlock()

	for _, v := range cfg.Vaults {
		if v.Path == oldPath {
			v.Path = newPath
			return true, save()
		}
	}
	return false, nil
}

// generateID returns a random 8-character lowercase hex string.
func generateID() string {
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		// Fallback: use timestamp-based generation
		ts := time.Now().UnixNano()
		return hex.EncodeToString([]byte{
			byte(ts >> 56), byte(ts >> 48), byte(ts >> 40), byte(ts >> 32),
		})
	}
	return hex.EncodeToString(b)
}
